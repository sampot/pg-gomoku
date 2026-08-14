/**
 * Host session domain for gomoku.v1 (Playgrounds DEC-023／047).
 * Durable KV-backed so canvas /api and shell-forwarded calls share state.
 */

import { GomokuGame } from "./gomoku.js";
import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_PROTOCOL_API_VERSION,
  GOMOKU_PROTOCOL_ID,
  GOMOKU_ROLE_LIMITS,
  GOMOKU_ROLES,
  GOMOKU_STATE_KEY,
  GOMOKU_JOIN_POLICY,
  gomokuProtocolSpec,
} from "./protocol.js";

/**
 * @typedef {"waiting" | "ready" | "active" | "ended"} MatchStatus
 * @typedef {{
 *   sessionId: string | null;
 *   channelName: string | null;
 *   seq: number;
 *   status: MatchStatus;
 *   turn: "black" | "white";
 *   board: (null | 1 | 2)[][];
 *   winner: null | 1 | 2 | 0;
 *   lastMove: null | { x: number; y: number; player: 1 | 2 };
 *   playerSeated: boolean;
 *   firstRole: "host" | "player";
 * }} GomokuStore
 */

function emptyBoard() {
  return Array.from({ length: GOMOKU_BOARD_SIZE }, () =>
    Array(GOMOKU_BOARD_SIZE).fill(null),
  );
}

/** @returns {GomokuStore} */
function emptyStore() {
  return {
    sessionId: null,
    channelName: null,
    seq: 0,
    status: "waiting",
    turn: "black",
    board: emptyBoard(),
    winner: null,
    lastMove: null,
    playerSeated: false,
    /** Seat that moves first (= black). Host chooses on start／reset. */
    firstRole: "host",
  };
}

/** @param {unknown} raw */
function parseFirstRole(raw) {
  return raw === "player" || raw === "host" ? raw : null;
}

async function loadStore(env) {
  const raw = await env.KV.get(GOMOKU_STATE_KEY, "text");
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw);
    return {
      sessionId: parsed.sessionId || null,
      channelName: parsed.channelName || null,
      seq: Number(parsed.seq) || 0,
      status: ["waiting", "ready", "active", "ended"].includes(parsed.status)
        ? parsed.status
        : "waiting",
      turn: parsed.turn === "white" ? "white" : "black",
      board: Array.isArray(parsed.board) ? parsed.board : emptyBoard(),
      winner:
        parsed.winner === 1 || parsed.winner === 2 || parsed.winner === 0
          ? parsed.winner
          : null,
      lastMove: parsed.lastMove || null,
      playerSeated: Boolean(parsed.playerSeated),
      firstRole: parseFirstRole(parsed.firstRole) || "host",
    };
  } catch {
    return emptyStore();
  }
}

async function saveStore(env, store) {
  await env.KV.put(GOMOKU_STATE_KEY, JSON.stringify(store));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function err(code, error, status = 400) {
  return json({ error, code }, status);
}

function publicState(store) {
  return {
    protocolId: GOMOKU_PROTOCOL_ID,
    apiVersion: GOMOKU_PROTOCOL_API_VERSION,
    sessionId: store.sessionId,
    channelName: store.channelName,
    seq: store.seq,
    status: store.status,
    turn: store.turn,
    board: store.board,
    winner: store.winner,
    lastMove: store.lastMove,
    playerSeated: store.playerSeated,
    firstRole: store.firstRole,
    boardSize: GOMOKU_BOARD_SIZE,
  };
}

function gameFromStore(store) {
  const game = new GomokuGame(GOMOKU_BOARD_SIZE);
  game.board = store.board.map((row) => row.slice());
  game.currentPlayer = store.turn === "white" ? 2 : 1;
  game.gameOver = store.status === "ended";
  game.winner = store.winner;
  game.lastMove = store.lastMove;
  game.moveCount = store.board.reduce(
    (n, row) => n + row.filter((c) => c != null).length,
    0,
  );
  return game;
}

function applyGameToStore(store, game) {
  store.board = game.getBoard().map((row) => row.slice());
  store.turn = game.getCurrentPlayer() === 2 ? "white" : "black";
  store.lastMove = game.getLastMove();
  store.winner = game.getWinner();
  if (game.isGameOver()) store.status = "ended";
}

/**
 * First seat plays black (1); the other plays white (2).
 * @param {string} role
 * @param {"host" | "player"} firstRole
 */
function roleStone(role, firstRole) {
  if (role !== "host" && role !== "player") return null;
  const first = firstRole === "player" ? "player" : "host";
  return role === first ? 1 : 2;
}

/**
 * Resolve firstRole from act payload, else keep store, else host.
 * @param {Record<string, unknown>} payload
 * @param {GomokuStore} store
 */
function resolveFirstRole(payload, store) {
  const fromPayload =
    parseFirstRole(payload.firstRole) ||
    parseFirstRole(payload.first) ||
    null;
  return fromPayload || store.firstRole || "host";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // NOTE: `/api/kv/*` is provided by the host shell (play + go) as a
    // built-in route, so SAMs must NOT re-implement it here. The
    // localStorage→KV shim (PG-LOCALSTORAGE-SHIM-SPEC) relies on the shell
    // owning `/api/kv/<key>` (GET/PUT/DELETE) + `/api/kv/list`, which is what
    // persists user data such as high scores. This SAM keeps its own session
    // state via the direct `env.KV` binding below (not HTTP).

    // Participant / homePeer seat: prefer env.SESSION tunnel (DEC-023／045).
    if (env?.SESSION) {
      const isProbe =
        request.method === "GET" &&
        (path.endsWith("/api/session/seat") ||
          path.endsWith("/api/session/channel") ||
          path.endsWith("/api/session/state"));
      try {
        const SESSION = env.SESSION;
        if (path.endsWith("/api/session/seat") && request.method === "GET") {
          return json(await SESSION.getSeat());
        }
        if (path.endsWith("/api/session/channel") && request.method === "GET") {
          return json(await SESSION.getEventChannel());
        }
        if (path.endsWith("/api/session/state") && request.method === "GET") {
          return json(await SESSION.getState());
        }
        if (path.endsWith("/api/session/act") && request.method === "POST") {
          const body = await request.json();
          return json(await SESSION.act(body));
        }
        if (path.endsWith("/api/session/leave") && request.method === "POST") {
          return json(await SESSION.leave());
        }
        if (path.endsWith("/api/session/meta") && request.method === "GET") {
          return json({
            protocolId: GOMOKU_PROTOCOL_ID,
            apiVersion: GOMOKU_PROTOCOL_API_VERSION,
            roles: [...GOMOKU_ROLES],
          });
        }
      } catch (e) {
        if (e?.code === "session_inactive" && isProbe) {
          return json({
            ready: false,
            code: "session_inactive",
            error: e?.message || "未入座",
          });
        }
        const status = e?.code === "session_inactive" ? 409 : 400;
        return err(e?.code || "error", e?.message || String(e), status);
      }
    }

    if (path.endsWith("/api/session/meta") && request.method === "GET") {
      const spec = gomokuProtocolSpec();
      return json({
        protocolId: spec.protocolId,
        apiVersion: spec.apiVersion,
        roles: spec.roles,
        roleLimits: spec.roleLimits,
        joinPolicy: GOMOKU_JOIN_POLICY,
        capabilities: spec.capabilities,
      });
    }

    if (path.endsWith("/api/session/open") && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) || {};
      const store = emptyStore();
      store.sessionId = String(body.sessionId || "");
      store.channelName = String(body.channelName || "");
      store.status = "waiting";
      await saveStore(env, store);
      return json({
        ok: true,
        sessionId: store.sessionId,
        channelName: store.channelName,
      });
    }

    if (path.endsWith("/api/session/state") && request.method === "GET") {
      const store = await loadStore(env);
      return json(publicState(store));
    }

    if (path.endsWith("/api/session/presence") && request.method === "POST") {
      const store = await loadStore(env);
      if (!store.sessionId) {
        return err("session_inactive", "通道尚未開啟", 409);
      }
      const body = (await request.json().catch(() => null)) || {};
      const seated = Boolean(body.playerSeated);
      store.playerSeated = seated;
      if (store.status === "waiting" && seated) store.status = "ready";
      if (store.status === "ready" && !seated) store.status = "waiting";
      // Do not demote active/ended.
      store.seq += 1;
      await saveStore(env, store);
      const event = {
        type: "match.status",
        status: store.status,
        playerSeated: store.playerSeated,
        seq: store.seq,
      };
      return json({
        ok: true,
        events: [event],
        state: publicState(store),
        seq: store.seq,
        sessionId: store.sessionId,
        channelName: store.channelName,
      });
    }

    if (path.endsWith("/api/session/act") && request.method === "POST") {
      const store = await loadStore(env);
      if (!store.sessionId) {
        return err("session_inactive", "通道尚未開啟（請先開局邀請）", 409);
      }
      const body = (await request.json().catch(() => null)) || {};
      const role = String(body.role || "");
      if (!GOMOKU_ROLES.includes(role)) {
        return err("role_forbidden", "role 不允許");
      }
      const payload = body.payload && typeof body.payload === "object"
        ? body.payload
        : {};
      const type = String(payload.type || body.type || "").trim();

      if (type === "start") {
        if (role !== "host") {
          return err("role_forbidden", "僅主持可開始");
        }
        if (store.status !== "ready") {
          return err(
            "act_rejected",
            store.status === "waiting"
              ? "對手尚未入座"
              : store.status === "ended"
                ? "請先「再來一局」再開始"
                : "目前無法開始",
          );
        }
        store.firstRole = resolveFirstRole(payload, store);
        store.status = "active";
        store.turn = "black";
        store.winner = null;
        store.lastMove = null;
        store.board = emptyBoard();
        store.seq += 1;
        await saveStore(env, store);
        const event = {
          type: "match.started",
          status: store.status,
          turn: store.turn,
          firstRole: store.firstRole,
          seq: store.seq,
        };
        return json({
          ok: true,
          events: [event],
          state: publicState(store),
          seq: store.seq,
          sessionId: store.sessionId,
          channelName: store.channelName,
        });
      }

      if (type === "reset") {
        if (role !== "host") {
          return err("role_forbidden", "僅主持可再來一局");
        }
        if (store.status !== "ended") {
          return err("act_rejected", "僅在終局後可再來一局");
        }
        // Same session + seats: clear match and start next game immediately
        // (no second「開始」). If opponent left, fall back to waiting.
        store.firstRole = resolveFirstRole(payload, store);
        store.board = emptyBoard();
        store.turn = "black";
        store.winner = null;
        store.lastMove = null;
        store.status = store.playerSeated ? "active" : "waiting";
        store.seq += 1;
        await saveStore(env, store);
        const events = [
          {
            type: "match.reset",
            status: store.status,
            turn: store.turn,
            firstRole: store.firstRole,
            playerSeated: store.playerSeated,
            seq: store.seq,
          },
        ];
        if (store.status === "active") {
          events.push({
            type: "match.started",
            status: store.status,
            turn: store.turn,
            firstRole: store.firstRole,
            seq: store.seq,
            rematch: true,
          });
        }
        return json({
          ok: true,
          events,
          state: publicState(store),
          seq: store.seq,
          sessionId: store.sessionId,
          channelName: store.channelName,
        });
      }

      if (type === "place") {
        if (store.status !== "active") {
          return err("act_rejected", "尚未開始或已結束，無法落子");
        }
        const stone = roleStone(role, store.firstRole || "host");
        if (!stone) return err("role_forbidden", "role 不允許落子");
        const expected = store.turn === "black" ? 1 : 2;
        if (stone !== expected) {
          return err("act_rejected", "尚未輪到你");
        }
        const row = Number(payload.row);
        const col = Number(payload.col);
        if (
          !Number.isInteger(row) ||
          !Number.isInteger(col) ||
          row < 0 ||
          col < 0 ||
          row >= GOMOKU_BOARD_SIZE ||
          col >= GOMOKU_BOARD_SIZE
        ) {
          return err("act_rejected", "座標無效");
        }
        const game = gameFromStore(store);
        if (!game.makeMove(col, row)) {
          return err("act_rejected", "此格無法落子");
        }
        applyGameToStore(store, game);
        store.seq += 1;
        await saveStore(env, store);
        const event = {
          type: "match.placed",
          row,
          col,
          stone: stone === 1 ? "black" : "white",
          status: store.status,
          turn: store.turn,
          winner: store.winner,
          seq: store.seq,
        };
        return json({
          ok: true,
          events: [event],
          state: publicState(store),
          seq: store.seq,
          sessionId: store.sessionId,
          channelName: store.channelName,
        });
      }

      return err("act_rejected", "未知 act（需要 start、place 或 reset）");
    }

    return json({
      ok: true,
      name: "pg-gomoku",
      path,
      roles: GOMOKU_ROLES,
      roleLimits: GOMOKU_ROLE_LIMITS,
    });
  },
};
