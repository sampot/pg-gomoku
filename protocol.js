/** gomoku.v1 — shared protocol constants (UI + functions.js). */

export const GOMOKU_PROTOCOL_ID = "gomoku.v1";
export const GOMOKU_PROTOCOL_API_VERSION = "1";
export const GOMOKU_ROLES = ["host", "player"];
export const GOMOKU_ROLE_LIMITS = { host: 1, player: 1 };
export const GOMOKU_JOIN_POLICY = "invite_only";
export const GOMOKU_BOARD_SIZE = 15;
export const GOMOKU_STATE_KEY = "session:gomoku:v1";
export const GOMOKU_CATALOG_ID = "pg-gomoku";
export const GOMOKU_SOURCE = "sampot/pg-gomoku";

/** Full protocol object for invites / session meta (DEC-023／047). */
export function gomokuProtocolSpec() {
  return {
    protocolId: GOMOKU_PROTOCOL_ID,
    apiVersion: GOMOKU_PROTOCOL_API_VERSION,
    roles: [...GOMOKU_ROLES],
    roleLimits: { ...GOMOKU_ROLE_LIMITS },
    joinPolicy: GOMOKU_JOIN_POLICY,
    capabilities: ["start", "place"],
    boardSize: GOMOKU_BOARD_SIZE,
    acts: [
      { type: "start", roles: ["host"] },
      {
        type: "place",
        roles: ["host", "player"],
        payload: { row: "0..14", col: "0..14" },
      },
    ],
  };
}
