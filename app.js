import { GomokuGame } from "./gomoku.js";
import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_PROTOCOL_ID,
  GOMOKU_SOURCE,
  gomokuProtocolSpec,
} from "./protocol.js";

const BOARD_SIZE = GOMOKU_BOARD_SIZE;
const CELL_SIZE = 40;
const PADDING = 20;
const CANVAS_SIZE = PADDING * 2 + CELL_SIZE * (BOARD_SIZE - 1);

/** @type {'local' | 'online'} */
let playMode = "local";
/** @type {'pvp' | 'ai' | 'aivsai'} */
let mode = "pvp";
let game = new GomokuGame(BOARD_SIZE);
/** @type {ReturnType<typeof setInterval> | null} */
let aiVsAiTimer = null;
let thinking = false;

// 最高分（人機連勝）— 透過 Playgrounds SDK 的 `window.PG.kv` 直接寫入
// 宿主內建的 `/api/kv` 路由（play 與 go 雙 shell 一致），持久化到 env.KV。
// 不依賴 localStorage→KV shim，故無同步讀取 race、刷新不歸零、清分可重設。
const HIGHSCORE_KEY = "pg-gomoku:highscore";
let highScore = 0;
let currentStreak = 0;
let gameOverHandled = false;

// 最高分（人機連勝）— 透過 Playgrounds SDK 的 `window.PG.kv` 直接寫入
// 宿主內建的 `/api/kv` 路由（play 與 go 雙 shell 一致），持久化到 env.KV。
// 不依賴 localStorage→KV shim，故無同步讀取 race、刷新不歸零、清分可重設。
const HIGHSCORE_KEY = "pg-gomoku:highscore";
let highScore = 0;
let currentStreak = 0;
let gameOverHandled = false;

/** Online host／player */
/** @type {'idle' | 'host' | 'player'} */
let onlineRole = "idle";
/** @type {BroadcastChannel | null} */
let sessionChannel = null;
let lastSeq = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let seatPollTimer = null;
let onlineStatus = "waiting";
let myOnlineStone = /** @type {null | 1 | 2} */ (null);
/** @type {"host" | "player"} */
let onlineFirstRole = "host";

const canvas = document.getElementById("game-board");
const ctx = canvas.getContext("2d");
const turnDisplay = document.getElementById("turn-display");
const gameStatus = document.getElementById("game-status");
const modeLabel = document.getElementById("mode-label");
const startAiBtn = document.getElementById("start-ai");
const startAiVsAiBtn = document.getElementById("start-ai-vs-ai");
const resetBtn = document.getElementById("reset-game");
const highScoreEl = document.getElementById("high-score");
const localToolbar = document.getElementById("local-toolbar");
const localAiControls = document.getElementById("local-ai-controls");
const playModeSection = document.getElementById("play-mode");
const onlinePanel = document.getElementById("online-panel");
const onlineControls = document.getElementById("online-controls");
const modeLocalBtn = document.getElementById("mode-local");
const modeOnlineBtn = document.getElementById("mode-online");
const onlineMeta = document.getElementById("online-meta");
const btnOpenSession = document.getElementById("btn-open-session");
const btnInvite = document.getElementById("btn-invite");
const btnStartMatch = document.getElementById("btn-start-match");
const btnRematch = document.getElementById("btn-rematch");
const btnCloseSession = document.getElementById("btn-close-session");
const firstMoveField = document.getElementById("first-move");
const inviteBox = document.getElementById("invite-box");
const inviteUrlInput = document.getElementById("invite-url");
const btnCopyInvite = document.getElementById("btn-copy-invite");

/** @param {"host" | "player"} role @param {"host" | "player"} firstRole */
function stoneForRole(role, firstRole) {
  const first = firstRole === "player" ? "player" : "host";
  return role === first ? 1 : 2;
}

function stoneLabel(stone) {
  return stone === 1 ? "黑" : stone === 2 ? "白" : "—";
}

function selectedFirstRole() {
  const checked = document.querySelector(
    'input[name="first-role"]:checked',
  );
  return checked && checked.value === "player" ? "player" : "host";
}

function setFirstRoleRadios(firstRole) {
  const value = firstRole === "player" ? "player" : "host";
  for (const input of document.querySelectorAll(
    'input[name="first-role"]',
  )) {
    input.checked = input.value === value;
  }
}

function applyFirstRole(firstRole) {
  if (firstRole !== "host" && firstRole !== "player") return;
  onlineFirstRole = firstRole;
  setFirstRoleRadios(firstRole);
  if (onlineRole === "host" || onlineRole === "player") {
    myOnlineStone = stoneForRole(onlineRole, firstRole);
  }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function syncCanvasBackingStore() {
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
}

function eventToCell(e) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const x = Math.round((px - PADDING) / CELL_SIZE);
  const y = Math.round((py - PADDING) / CELL_SIZE);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  return { x, y };
}

function drawBoardFrom(board, last) {
  const boardDark = cssVar("--board-dark") || "#bcaaa4";
  const boardLight = cssVar("--board-light") || "#deb887";
  const stoneBlack = cssVar("--stone-black") || "#1a1a1a";
  const stoneWhite = cssVar("--stone-white") || "#f5f5f5";

  ctx.fillStyle = boardDark;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = boardLight;
  ctx.lineWidth = 1;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = PADDING + i * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(PADDING, p);
    ctx.lineTo(canvas.width - PADDING, p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p, PADDING);
    ctx.lineTo(p, canvas.height - PADDING);
    ctx.stroke();
  }

  const stars = [3, 7, 11];
  ctx.fillStyle = boardLight;
  for (const sx of stars) {
    for (const sy of stars) {
      ctx.beginPath();
      ctx.arc(
        PADDING + sx * CELL_SIZE,
        PADDING + sy * CELL_SIZE,
        3.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[y]?.[x];
      if (player == null) continue;
      drawStone(x, y, player, stoneBlack, stoneWhite, last);
    }
  }
}

function drawStone(x, y, player, stoneBlack, stoneWhite, last) {
  const cx = PADDING + x * CELL_SIZE;
  const cy = PADDING + y * CELL_SIZE;
  const r = CELL_SIZE / 2 - 4;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, r);
  if (player === 1) {
    gradient.addColorStop(0, "#555");
    gradient.addColorStop(1, stoneBlack);
  } else {
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(1, stoneWhite);
  }
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = player === 1 ? "#222" : "#bbb";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (last && last.x === x && last.y === y) {
    ctx.beginPath();
    ctx.fillStyle = player === 1 ? "#fbbf24" : "#ef4444";
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function playerName(p) {
  return p === 1 ? "黑棋" : "白棋";
}

function setStatus(message, tone = "") {
  gameStatus.textContent = message;
  gameStatus.dataset.tone = tone;
}

function drawBoard() {
  if (playMode === "online" && onlineRole !== "idle") {
    // Online state applied via applyOnlineState
    return;
  }
  drawBoardFrom(game.getBoard(), game.getLastMove());
}

function updateChrome() {
  if (playMode === "online") {
    // Keep turn meta; hide local AI／重新開始 (邀請對弈 unrelated).
    localToolbar.hidden = false;
    localAiControls.hidden = true;
    modeLabel.textContent = "邀請對弈";
    return;
  }
  localToolbar.hidden = false;
  localAiControls.hidden = false;
  const labels = {
    pvp: "雙人輪流",
    ai: "人機對弈（您執黑）",
    aivsai: "AI 對 AI",
  };
  modeLabel.textContent = labels[mode];

  if (mode === "aivsai" && aiVsAiTimer) {
    turnDisplay.textContent = "AI 對弈中";
  } else if (game.isGameOver()) {
    turnDisplay.textContent = "—";
  } else {
    turnDisplay.textContent = playerName(game.getCurrentPlayer());
  }

  startAiBtn.textContent =
    mode === "ai" ? "改為雙人對弈" : "開始 AI 對弈";
  startAiVsAiBtn.textContent = aiVsAiTimer
    ? "停止 AI 對 AI"
    : "AI 對 AI 自動對弈";
  startAiBtn.disabled = Boolean(aiVsAiTimer);
  startAiVsAiBtn.disabled = thinking && mode !== "aivsai";
}

function refreshStatus() {
  if (playMode === "online") {
    refreshOnlineStatusText();
    return;
  }
  if (game.isGameOver()) {
    const w = game.getWinner();
    if (w === 0) setStatus("平局！棋盤已滿。", "draw");
    else if (mode === "ai" && w === 2) setStatus("白棋（AI）獲勝！", "white");
    else if (mode === "ai" && w === 1) setStatus("黑棋（您）獲勝！", "black");
    else if (mode === "aivsai")
      setStatus(`${playerName(w)}（AI）獲勝！`, w === 1 ? "black" : "white");
    else setStatus(`${playerName(w)}獲勝！`, w === 1 ? "black" : "white");
    onGameOver();
    return;
  }

  if (mode === "aivsai") {
    setStatus(
      aiVsAiTimer
        ? `AI 對弈進行中…輪到${playerName(game.getCurrentPlayer())}`
        : "已停止。可再按「AI 對 AI」繼續或「重新開始」。",
    );
    return;
  }

  if (mode === "ai") {
    if (thinking || game.getCurrentPlayer() === 2) {
      setStatus("AI 思考中…");
    } else {
      setStatus("輪到您（黑棋），請落子。");
    }
    return;
  }

  setStatus(`輪到${playerName(game.getCurrentPlayer())}，請落子。`);
}

function stopAiVsAi() {
  if (aiVsAiTimer) {
    clearInterval(aiVsAiTimer);
    aiVsAiTimer = null;
  }
}

// ─── 最高分（人機連勝），經 SDK `window.PG.kv` 寫入宿主 /api/kv ───

function renderHighScore() {
  if (highScoreEl) {
    highScoreEl.textContent = String(highScore);
  }
}

/** @returns {Promise<void>} */
async function loadHighScore() {
  try {
    const pg = /** @type {any} */ (window).PG;
    if (!pg || !pg.kv) return;
    if (typeof pg.ready?.then === "function") {
      await pg.ready;
    }
    const v = await pg.kv.get(HIGHSCORE_KEY);
    const n = v == null ? 0 : Number(v);
    highScore = Number.isFinite(n) && n > 0 ? n : 0;
    renderHighScore();
  } catch {
    /* KV 不可用時靜默降級，不影響對弈 */
  }
}

/** @returns {Promise<void>} */
async function saveHighScore() {
  try {
    const pg = /** @type {any} */ (window).PG;
    if (!pg || !pg.kv) return;
    if (typeof pg.ready?.then === "function") {
      await pg.ready;
    }
    await pg.kv.put(HIGHSCORE_KEY, String(highScore));
  } catch {
    /* 寫入失敗靜默降級 */
  }
}

/** 一局結束時更新連勝與最高分（僅人機模式計分）。 */
function onGameOver() {
  if (gameOverHandled) return;
  gameOverHandled = true;
  if (mode !== "ai") return; // 只有「人機對弈」計連勝
  const w = game.getWinner();
  const playerWon = w === 1; // 人執黑（1）
  if (playerWon) {
    currentStreak += 1;
    if (currentStreak > highScore) {
      highScore = currentStreak;
      renderHighScore();
      void saveHighScore();
    }
  } else {
    currentStreak = 0; // 敗或平局：連勝歸零
  }
}

function placeStone(x, y) {
  if (game.isGameOver() || thinking) return false;
  if (!game.makeMove(x, y)) return false;

  drawBoardFrom(game.getBoard(), game.getLastMove());
  updateChrome();
  refreshStatus();

  if (game.isGameOver()) {
    stopAiVsAi();
    updateChrome();
    return true;
  }

  if (mode === "ai" && game.getCurrentPlayer() === 2) {
    scheduleAiMove();
  }
  return true;
}

function scheduleAiMove() {
  if (thinking || game.isGameOver()) return;
  thinking = true;
  updateChrome();
  refreshStatus();
  setTimeout(() => {
    thinking = false;
    if (game.isGameOver()) {
      updateChrome();
      refreshStatus();
      return;
    }
    const move = game.getBestMove(game.getCurrentPlayer());
    if (!move) {
      updateChrome();
      refreshStatus();
      return;
    }
    placeStone(move.x, move.y);
  }, mode === "aivsai" ? 0 : 180);
}

function startHumanAi() {
  stopAiVsAi();
  mode = "ai";
  game.reset();
  thinking = false;
  currentStreak = 0;
  gameOverHandled = false;
  drawBoardFrom(game.getBoard(), game.getLastMove());
  updateChrome();
  refreshStatus();
}

function startPvp() {
  stopAiVsAi();
  mode = "pvp";
  game.reset();
  thinking = false;
  currentStreak = 0;
  gameOverHandled = false;
  drawBoardFrom(game.getBoard(), game.getLastMove());
  updateChrome();
  refreshStatus();
}

function toggleAiMode() {
  if (aiVsAiTimer) return;
  if (mode === "ai") startPvp();
  else startHumanAi();
}

function runAiVsAiLoop() {
  if (aiVsAiTimer) return;
  aiVsAiTimer = setInterval(() => {
    if (game.isGameOver()) {
      stopAiVsAi();
      updateChrome();
      refreshStatus();
      return;
    }
    if (thinking) return;
    scheduleAiMove();
  }, 700);
}

function toggleAiVsAi() {
  if (aiVsAiTimer) {
    stopAiVsAi();
    thinking = false;
    updateChrome();
    refreshStatus();
    return;
  }

  const resume =
    mode === "aivsai" && !game.isGameOver() && game.getLastMove() != null;

  mode = "aivsai";
  thinking = false;
  if (!resume) {
    game.reset();
    drawBoardFrom(game.getBoard(), game.getLastMove());
  }
  updateChrome();
  refreshStatus();

  scheduleAiMove();
  runAiVsAiLoop();
}

function restartGame() {
  stopAiVsAi();
  thinking = false;
  game.reset();
  if (mode === "aivsai") mode = "pvp";
  currentStreak = 0;
  gameOverHandled = false;
  drawBoardFrom(game.getBoard(), game.getLastMove());
  updateChrome();
  refreshStatus();
}

/* ——— Online (gomoku.v1) ——— */

async function shell(path, init) {
  const res = await fetch("/api/shell/session" + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.code || res.statusText);
    err.code = data.code;
    throw err;
  }
  return data;
}

async function domain(path, init) {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.code || res.statusText);
    err.code = data.code;
    throw err;
  }
  return data;
}

/** Host UI acts must go through shell so Roster peers get event fanout. */
async function hostDomain(path, init) {
  const method = (init && init.method) || "GET";
  const headers = (init && init.headers) || undefined;
  const body = init && typeof init.body === "string" ? init.body : undefined;
  return shell("/host-domain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, method, headers, body }),
  });
}

function applyEventToOnlineBoard(event) {
  if (!event || typeof event !== "object") return;
  const type = String(event.type || "");
  if (type === "match.started") {
    onlineStatus = "active";
    if (event.firstRole) applyFirstRole(event.firstRole);
    window.__gomokuOnlineBoard = Array.from({ length: BOARD_SIZE }, () =>
      Array(BOARD_SIZE).fill(null),
    );
    drawBoardFrom(window.__gomokuOnlineBoard, null);
    turnDisplay.textContent = "黑棋";
    refreshOnlineStatusText();
    syncOnlineControls();
    return;
  }
  if (type === "match.reset") {
    onlineStatus = event.status || "active";
    if (event.firstRole) applyFirstRole(event.firstRole);
    window.__gomokuOnlineBoard = Array.from({ length: BOARD_SIZE }, () =>
      Array(BOARD_SIZE).fill(null),
    );
    drawBoardFrom(window.__gomokuOnlineBoard, null);
    turnDisplay.textContent =
      onlineStatus === "active"
        ? event.turn === "white"
          ? "白棋"
          : "黑棋"
        : "—";
    refreshOnlineStatusText();
    syncOnlineControls();
    return;
  }
  if (type === "session.closed" || type === "match.closed") {
    applyHostEndedSession(
      event.reason === "host_closed"
        ? "主持已結束這一場"
        : "這一場已結束",
    );
    return;
  }
  if (type === "match.status") {
    onlineStatus = event.status || onlineStatus;
    refreshOnlineStatusText();
    syncOnlineControls();
    return;
  }
  if (type === "match.placed") {
    const row = Number(event.row);
    const col = Number(event.col);
    const stone = event.stone === "white" ? 2 : 1;
    if (!window.__gomokuOnlineBoard) {
      window.__gomokuOnlineBoard = Array.from({ length: BOARD_SIZE }, () =>
        Array(BOARD_SIZE).fill(null),
      );
    }
    const board = window.__gomokuOnlineBoard;
    if (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      col >= 0 &&
      row < BOARD_SIZE &&
      col < BOARD_SIZE
    ) {
      board[row][col] = stone;
    }
    onlineStatus = event.status || onlineStatus;
    const last = { x: col, y: row, player: stone };
    drawBoardFrom(board, last);
    turnDisplay.textContent =
      event.turn === "white" ? "白棋" : event.turn === "black" ? "黑棋" : "—";
    if (event.winner === 1 || event.winner === 2 || event.winner === 0) {
      onlineStatus = "ended";
    }
    refreshOnlineStatusText();
    syncOnlineControls();
  }
}

function bindSessionChannel(channelName) {
  if (!channelName) return;
  if (sessionChannel) {
    try {
      sessionChannel.close();
    } catch {
      /* ignore */
    }
  }
  sessionChannel = new BroadcastChannel(channelName);
  sessionChannel.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.type !== "session-event") return;
    if (typeof msg.seq === "number" && msg.seq <= lastSeq) return;
    lastSeq = msg.seq || lastSeq;
    if (onlineRole === "player") {
      applyEventToOnlineBoard(msg.event);
      return;
    }
    void loadOnlineState().catch(() => {});
  };
}

/** Guest／local: Host closed the multiplayer session (keep board, leave online seat). */
function applyHostEndedSession(message) {
  stopSeatPoll();
  if (sessionChannel) {
    try {
      sessionChannel.close();
    } catch {
      /* ignore */
    }
    sessionChannel = null;
  }
  const wasPlayer = onlineRole === "player";
  onlineRole = "idle";
  myOnlineStone = null;
  onlineFirstRole = "host";
  onlineStatus = "waiting";
  inviteBox.hidden = true;
  inviteUrlInput.value = "";
  syncOnlineControls();
  setStatus(message, wasPlayer ? "danger" : "draw");
}

function applyOnlineState(state) {
  if (!state) return;
  onlineStatus = state.status || "waiting";
  if (state.firstRole) applyFirstRole(state.firstRole);
  const board = Array.isArray(state.board) ? state.board : null;
  if (board) {
    window.__gomokuOnlineBoard = board.map((row) => row.slice());
    drawBoardFrom(window.__gomokuOnlineBoard, state.lastMove || null);
  }
  turnDisplay.textContent =
    onlineStatus === "active"
      ? state.turn === "white"
        ? "白棋"
        : "黑棋"
      : "—";
  refreshOnlineStatusText();
  syncOnlineControls();
}

function refreshOnlineStatusText() {
  if (onlineRole === "player") {
    if (onlineStatus === "waiting" || onlineStatus === "ready") {
      setStatus("已入座 — 等待主持選先手並開始");
      return;
    }
  }
  if (onlineStatus === "waiting") {
    setStatus("等候對手加入…（可分享短網址）");
  } else if (onlineStatus === "ready") {
    setStatus(
      onlineRole === "host"
        ? "對手已入座 — 選誰先（執黑），再按「開始」"
        : "已入座 — 等待主持開始",
    );
  } else if (onlineStatus === "active") {
    const mine =
      myOnlineStone === 1 ? "black" : myOnlineStone === 2 ? "white" : null;
    const turn = turnDisplay.textContent.includes("白") ? "white" : "black";
    if (mine && turn === mine) setStatus(`輪到你（${stoneLabel(myOnlineStone)}），請落子。`);
    else setStatus("等待對手落子…");
  } else if (onlineStatus === "ended") {
    if (onlineRole === "host") {
      setStatus("這一局已結束。可改先手後按「再來一局」。", "draw");
    } else {
      setStatus("這一局已結束。等待主持再來一局…", "draw");
    }
  }
}

function syncOnlineControls() {
  const hosting = onlineRole === "host";
  const asPlayer = onlineRole === "player";
  const showFirstPick =
    hosting && (onlineStatus === "ready" || onlineStatus === "ended");
  btnOpenSession.disabled = hosting;
  btnInvite.disabled = !hosting;
  btnCloseSession.disabled = !hosting;
  btnStartMatch.disabled = !(hosting && onlineStatus === "ready");
  btnRematch.disabled = !(hosting && onlineStatus === "ended");
  firstMoveField.hidden = !showFirstPick;
  // Invitee: play-first — hide mode switch + host CTAs (開場／邀請／開始…).
  playModeSection.hidden = asPlayer;
  onlineControls.hidden = asPlayer;
  const stoneTxt =
    myOnlineStone != null ? `你執${stoneLabel(myOnlineStone)}` : "先手待定";
  if (asPlayer) {
    onlineMeta.textContent = `參與中 · ${GOMOKU_PROTOCOL_ID} · ${stoneTxt}`;
    inviteBox.hidden = true;
    btnOpenSession.hidden = true;
    btnInvite.hidden = true;
    btnStartMatch.hidden = true;
    btnRematch.hidden = true;
    btnCloseSession.hidden = true;
  } else if (hosting) {
    onlineMeta.textContent = `主持中 · ${GOMOKU_PROTOCOL_ID} · ${onlineStatus} · ${stoneTxt}`;
    btnOpenSession.hidden = false;
    btnInvite.hidden = false;
    btnStartMatch.hidden = onlineStatus === "ended";
    btnRematch.hidden = onlineStatus !== "ended";
    btnCloseSession.hidden = false;
  } else {
    onlineMeta.textContent = "尚未開啟邀請場";
    btnOpenSession.hidden = false;
    btnInvite.hidden = false;
    btnStartMatch.hidden = false;
    btnRematch.hidden = true;
    btnCloseSession.hidden = false;
  }
}

async function loadOnlineState() {
  if (onlineRole === "player") {
    const state = await domain("/api/session/state");
    if (typeof state.seq === "number") lastSeq = Math.max(lastSeq, state.seq);
    if (state.channelName) bindSessionChannel(state.channelName);
    applyOnlineState(state);
    return state;
  }
  const state = await hostDomain("/api/session/state", { method: "GET" });
  if (typeof state.seq === "number") lastSeq = Math.max(lastSeq, state.seq);
  if (state.channelName) bindSessionChannel(state.channelName);
  applyOnlineState(state);
  return state;
}

async function syncPlayerPresence() {
  if (onlineRole !== "host") return;
  try {
    const st = await shell("/status");
    const hasPlayer = (st.seats || []).some((s) => s.role === "player");
    const data = await hostDomain("/api/session/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerSeated: hasPlayer }),
    });
    applyOnlineState(data.state);
  } catch {
    /* ignore poll errors */
  }
}

function startSeatPoll() {
  stopSeatPoll();
  seatPollTimer = setInterval(() => {
    void syncPlayerPresence();
  }, 2000);
}

function stopSeatPoll() {
  if (seatPollTimer) {
    clearInterval(seatPollTimer);
    seatPollTimer = null;
  }
}

async function onOpenSession() {
  setStatus("開啟通道…");
  try {
    stopAiVsAi();
    const opened = await shell("/open", { method: "POST" });
    onlineRole = "host";
    onlineFirstRole = "host";
    myOnlineStone = null;
    setFirstRoleRadios("host");
    lastSeq = 0;
    bindSessionChannel(opened.channelName);
    await loadOnlineState();
    startSeatPoll();
    syncOnlineControls();
    setStatus("已開場 — 按「邀請對手」取得短網址");
  } catch (e) {
    setStatus(String(e.message || e), "danger");
  }
}

async function onInviteOpponent() {
  setStatus("建立邀請…");
  try {
    const created = await fetch("/api/shell/platform/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "invite.compose",
        intent: {
          version: 1,
          sam: {
            source: GOMOKU_SOURCE,
            resolve: "install_if_missing",
            presentation: "maximize_preview",
          },
          session: {
            protocol: gomokuProtocolSpec(),
            role: "player",
            consent: "always_ask",
          },
          transport: { roster: { signal: true } },
        },
      }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || data.code || res.statusText);
        err.code = data.code;
        throw err;
      }
      return data;
    });
    inviteUrlInput.value = created.short_url || created.deep_link || "";
    inviteBox.hidden = true;
    setStatus("短網址已在遊樂場彈出 — 可複製或掃 QR；保持本頁在線");
  } catch (e) {
    const msg = String(e.message || e);
    if (/not_provisioned|通行證|登入我的遊樂場/i.test(msg)) {
      setStatus(
        "尚未登入遊樂場通行證 — 請先到後台按「登入我的遊樂場」",
        "danger",
      );
    } else {
      setStatus(msg, "danger");
    }
  }
}

async function onStartMatch() {
  setStatus("開始中…");
  try {
    const firstRole = selectedFirstRole();
    const data = await hostDomain("/api/session/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "host",
        payload: { type: "start", firstRole },
      }),
    });
    applyOnlineState(data.state);
    const mine = stoneLabel(myOnlineStone);
    setStatus(
      myOnlineStone === 1
        ? `已開局 — 你執${mine}先手，請落子`
        : `已開局 — 你執${mine}，等待對手先手`,
    );
  } catch (e) {
    setStatus(String(e.message || e), "danger");
  }
}

async function onRematch() {
  setStatus("開下一局…");
  try {
    const firstRole = selectedFirstRole();
    const data = await hostDomain("/api/session/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "host",
        payload: { type: "reset", firstRole },
      }),
    });
    applyOnlineState(data.state);
    if (onlineStatus === "active") {
      setStatus(
        myOnlineStone === 1
          ? `已開下一局 — 你執${stoneLabel(myOnlineStone)}先手，請落子`
          : `已開下一局 — 你執${stoneLabel(myOnlineStone)}，等待對手先手`,
      );
    } else {
      setStatus("棋盤已清空 — 等候對手入座");
    }
  } catch (e) {
    setStatus(String(e.message || e), "danger");
  }
}

async function onCloseSession() {
  try {
    stopSeatPoll();
    await shell("/close", { method: "POST" });
    if (sessionChannel) {
      try {
        sessionChannel.close();
      } catch {
        /* ignore */
      }
      sessionChannel = null;
    }
    onlineRole = "idle";
    myOnlineStone = null;
    onlineFirstRole = "host";
    onlineStatus = "waiting";
    inviteBox.hidden = true;
    inviteUrlInput.value = "";
    drawBoardFrom(game.getBoard(), null);
    syncOnlineControls();
    setStatus("已結束邀請場");
  } catch (e) {
    setStatus(String(e.message || e), "danger");
  }
}

async function onlinePlace(row, col) {
  if (onlineRole === "host") {
    const data = await hostDomain("/api/session/act", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "host",
        payload: { type: "place", row, col },
      }),
    });
    applyOnlineState(data.state);
    return;
  }
  const data = await domain("/api/session/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "place",
      row,
      col,
    }),
  });
  applyOnlineState(data.state || data);
}

async function tryBootAsPlayer() {
  try {
    const seat = await domain("/api/session/seat");
    if (!seat || seat.ready === false) return false;
    const role = String(seat.role || "");
    if (role !== "player" && role !== "host") return false;
    playMode = "online";
    onlineRole = role === "host" ? "host" : "player";
    myOnlineStone = null;
    onlinePanel.hidden = false;
    modeLocalBtn.classList.toggle("is-active", false);
    modeOnlineBtn.classList.toggle("is-active", true);
    updateChrome();
    const ch = await domain("/api/session/channel");
    if (ch?.name) bindSessionChannel(ch.name);
    await loadOnlineState();
    syncOnlineControls();
    setStatus(
      onlineRole === "player"
        ? "已入座 — 等待主持選先手並開始"
        : "主持席已就緒",
    );
    return true;
  } catch {
    return false;
  }
}

function setPlayMode(next) {
  if (next === playMode) return;
  if (next === "local") {
    stopSeatPoll();
    playMode = "local";
    onlinePanel.hidden = true;
    modeLocalBtn.classList.add("is-active");
    modeOnlineBtn.classList.remove("is-active");
    if (onlineRole === "host") {
      void onCloseSession();
    } else {
      onlineRole = "idle";
    }
    drawBoardFrom(game.getBoard(), game.getLastMove());
    updateChrome();
    refreshStatus();
    return;
  }
  stopAiVsAi();
  playMode = "online";
  onlinePanel.hidden = false;
  modeLocalBtn.classList.remove("is-active");
  modeOnlineBtn.classList.add("is-active");
  syncOnlineControls();
  updateChrome();
  drawBoardFrom(
    Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
    null,
  );
  setStatus("按「開場」後再邀請對手");
}

startAiBtn.addEventListener("click", toggleAiMode);
startAiVsAiBtn.addEventListener("click", toggleAiVsAi);
resetBtn.addEventListener("click", restartGame);
modeLocalBtn.addEventListener("click", () => setPlayMode("local"));
modeOnlineBtn.addEventListener("click", () => setPlayMode("online"));
btnOpenSession.addEventListener("click", () => void onOpenSession());
btnInvite.addEventListener("click", () => void onInviteOpponent());
btnStartMatch.addEventListener("click", () => void onStartMatch());
btnRematch.addEventListener("click", () => void onRematch());
btnCloseSession.addEventListener("click", () => void onCloseSession());
btnCopyInvite.addEventListener("click", async () => {
  const v = inviteUrlInput.value.trim();
  if (!v) return;
  try {
    await navigator.clipboard.writeText(v);
    setStatus("已複製短網址");
  } catch {
    inviteUrlInput.select();
    setStatus("請手動複製短網址");
  }
});

canvas.addEventListener("click", (e) => {
  const cell = eventToCell(e);
  if (!cell) return;

  if (playMode === "online") {
    if (onlineStatus !== "active") return;
    const stone = myOnlineStone;
    if (!stone) return;
    const turnIsBlack = turnDisplay.textContent.includes("黑");
    if (stone === 1 && !turnIsBlack) return;
    if (stone === 2 && turnIsBlack) return;
    void onlinePlace(cell.y, cell.x).catch((err) =>
      setStatus(String(err.message || err), "danger"),
    );
    return;
  }

  if (mode === "aivsai") return;
  if (mode === "ai" && game.getCurrentPlayer() === 2) return;
  if (game.isGameOver() || thinking) return;
  placeStone(cell.x, cell.y);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (playMode === "local") {
      drawBoardFrom(game.getBoard(), game.getLastMove());
    } else {
      void loadOnlineState().catch(() => {});
    }
  });

syncCanvasBackingStore();
drawBoardFrom(game.getBoard(), game.getLastMove());
updateChrome();
refreshStatus();
void loadHighScore();
void tryBootAsPlayer();
