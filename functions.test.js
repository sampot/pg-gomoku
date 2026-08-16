/**
 * functions.js Host UI routes (DEC-053): UI → /api/online/* → env.HOST.
 * Domain authority stays on /api/session/* + env.KV; Guest still uses env.SESSION.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./functions.js";
import { GOMOKU_PROTOCOL_ID, GOMOKU_SOURCE, gomokuProtocolSpec } from "./protocol.js";

function jsonRequest(path, { method = "GET", body } = {}) {
  return new Request(`https://sandbox.test${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function mockKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    _store: store,
  };
}

function mockHost(overrides = {}) {
  return {
    openSession: vi.fn(async () => ({
      sessionId: "sess-1",
      channelName: "playgrounds-session:sess-1",
      protocolId: GOMOKU_PROTOCOL_ID,
      apiVersion: "1",
      roles: ["host", "player"],
    })),
    closeSession: vi.fn(async () => ({ ok: true })),
    getSession: vi.fn(async () => ({
      sessionId: "sess-1",
      channelName: "playgrounds-session:sess-1",
      protocolId: GOMOKU_PROTOCOL_ID,
      apiVersion: "1",
      status: "open",
      roles: ["host", "player"],
    })),
    listSeats: vi.fn(async () => [
      { seatId: "host", role: "host", kind: "human", sandboxId: null, paused: false },
    ]),
    hostSessionFetch: vi.fn(async () => ({
      ok: true,
      state: { status: "waiting", board: [] },
      events: [],
    })),
    createPlatformInvite: vi.fn(async () => ({
      invite_id: "inv-1",
      short_url: "https://go.samkuo.me/i/abc",
      deep_link: "https://go.samkuo.me/#pg=sec",
      secret: "sec",
      expires_at: Date.now() + 60_000,
      kind: "invite.compose",
    })),
    revokePlatformInvite: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("functions.js Host UI routes via env.HOST", () => {
  /** @type {ReturnType<typeof mockHost>} */
  let HOST;
  /** @type {ReturnType<typeof mockKv>} */
  let KV;

  beforeEach(() => {
    HOST = mockHost();
    KV = mockKv();
  });

  it("POST /api/online/open calls HOST.openSession", async () => {
    const res = await handler.fetch(jsonRequest("/api/online/open", { method: "POST" }), {
      HOST,
      KV,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(HOST.openSession).toHaveBeenCalledTimes(1);
    expect(data.sessionId).toBe("sess-1");
    expect(data.channelName).toBe("playgrounds-session:sess-1");
  });

  it("GET /api/online/status returns session + seats", async () => {
    const res = await handler.fetch(jsonRequest("/api/online/status"), { HOST, KV });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(HOST.getSession).toHaveBeenCalled();
    expect(HOST.listSeats).toHaveBeenCalled();
    expect(data.active).toBe(true);
    expect(data.sessionId).toBe("sess-1");
    expect(data.seats).toHaveLength(1);
  });

  it("POST /api/online/close calls HOST.closeSession", async () => {
    const res = await handler.fetch(jsonRequest("/api/online/close", { method: "POST" }), {
      HOST,
      KV,
    });
    expect(res.status).toBe(200);
    expect(HOST.closeSession).toHaveBeenCalledTimes(1);
  });

  it("POST /api/online/domain forwards to HOST.hostSessionFetch", async () => {
    const res = await handler.fetch(
      jsonRequest("/api/online/domain", {
        method: "POST",
        body: {
          path: "/api/session/act",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "host", payload: { type: "start", firstRole: "host" } }),
        },
      }),
      { HOST, KV },
    );
    expect(res.status).toBe(200);
    expect(HOST.hostSessionFetch).toHaveBeenCalledWith(
      "/api/session/act",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("POST /api/online/invite calls HOST.createPlatformInvite with gomoku intent", async () => {
    const res = await handler.fetch(
      jsonRequest("/api/online/invite", {
        method: "POST",
        body: {
          kind: "invite.compose",
          intent: {
            version: 1,
            sam: { source: GOMOKU_SOURCE, resolve: "install_if_missing", presentation: "maximize_preview" },
            session: { protocol: gomokuProtocolSpec(), role: "player", consent: "always_ask" },
            transport: { roster: { signal: true } },
          },
        },
      }),
      { HOST, KV },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(HOST.createPlatformInvite).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invite.compose" }),
    );
    expect(data.short_url).toContain("/i/");
  });

  it("returns host_unavailable when env.HOST is missing on online routes", async () => {
    const res = await handler.fetch(jsonRequest("/api/online/open", { method: "POST" }), {
      KV,
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe("host_unavailable");
  });

  it("maps HostBridgeError not_provisioned to 401", async () => {
    const err = Object.assign(new Error("尚未登入遊樂場通行證"), {
      code: "not_provisioned",
    });
    HOST.createPlatformInvite = vi.fn(async () => {
      throw err;
    });
    const res = await handler.fetch(
      jsonRequest("/api/online/invite", { method: "POST", body: { kind: "invite.compose" } }),
      { HOST, KV },
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("not_provisioned");
  });
});

describe("functions.js Guest env.SESSION path (unchanged)", () => {
  it("GET /api/session/seat uses SESSION when present", async () => {
    const SESSION = {
      getSeat: vi.fn(async () => ({ ready: true, role: "player", seatId: "s1" })),
    };
    const res = await handler.fetch(jsonRequest("/api/session/seat"), {
      SESSION,
      KV: mockKv(),
    });
    expect(res.status).toBe(200);
    expect(SESSION.getSeat).toHaveBeenCalled();
    const data = await res.json();
    expect(data.role).toBe("player");
  });
});
