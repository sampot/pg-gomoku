import { findWinningLine, GomokuGame } from "./gomoku.js";
import {
  planLifecycleResume,
  planLifecycleSuspend,
} from "./lifecycle.js";
import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_PROTOCOL_ID,
  GOMOKU_SOURCE,
  gomokuProtocolSpec,
} from "./protocol.js";
import { deriveChromeState } from "./ui-state.js";
import { readPgSurface } from "./shellSurface.js";

const BOARD_SIZE = GOMOKU_BOARD_SIZE;
const CELL_SIZE = 40;
const PADDING = 20;
const CANVAS_SIZE = PADDING * 2 + CELL_SIZE * (BOARD_SIZE - 1);

/** @type {"solo" | "room"} */
const shellSurface = readPgSurface();

/** @type {'local' | 'online'} */
let playMode = "local";
/** @type {'pvp' | 'ai' | 'aivsai'} */
let mode = "pvp";
let localStarted = false;
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

/** Online host／player */
/** @type {'idle' | 'host' | 'player'} */
let onlineRole = "idle";
/** @type {BroadcastChannel | null} */
let sessionChannel = null;
let lastSeq = 0;
/** @type {ReturnType<typeof setInterval> | null} */
let seatPollTimer = null;
let onlineStatus = "waiting";
let currentPlatformInviteId = null;
let myOnlineStone = /** @type {null | 1 | 2} */ (null);
/** @type {"host" | "player"} */
let onlineFirstRole = "host";
/** Guest display name from `/api/online/status` seats (Host UI). */
let opponentDisplayName = /** @type {string | null} */ (null);

function opponentLabel() {
  return opponentDisplayName || "對手";
}

const canvas = document.getElementById("game-board");
const ctx = canvas.getContext("2d");
const turnDisplay = document.getElementById("turn-display");
const gameStatus = document.getElementById("game-status");
const modeLabel = document.getElementById("mode-label");
const startAiBtn = document.getElementById("start-ai");
const startAiVsAiBtn = document.getElementById("start-ai-vs-ai");
const startLocalPvpBtn = document.getElementById("start-local-pvp");
const resetBtn = document.getElementById("reset-game");
const backToSetupBtn = document.getElementById("back-to-setup");
const matchMenu = document.getElementById("match-menu");
const highScoreEl = document.getElementById("high-score");
const highScoreWrap = document.getElementById("high-score-wrap");
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
const btnCloseSessionMatch = document.getElementById(
  "btn-close-session-match",
);
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

/** Logical board size in CSS px; backing store may be × DPR. */
const LOGICAL_SIZE = CANVAS_SIZE;

/** @type {HTMLCanvasElement | null} */
let boardTexture = null;
/** @type {string} */
let boardTextureKey = "";
/** Hover ghost for fine pointers only. */
let hoverCell = /** @type {{ x: number, y: number } | null} */ (null);
/** Last board snapshot used for hover redraw. */
let lastDrawnBoard = /** @type {(null|1|2)[][] | null} */ (null);
let lastDrawnMove = /** @type {{ x: number, y: number, player?: number } | null} */ (
  null
);

function syncCanvasBackingStore() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const bw = Math.round(LOGICAL_SIZE * dpr);
  const bh = Math.round(LOGICAL_SIZE * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function eventToCell(e) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // Map into logical canvas space (independent of DPR / CSS size).
  const px = ((e.clientX - rect.left) / rect.width) * LOGICAL_SIZE;
  const py = ((e.clientY - rect.top) / rect.height) * LOGICAL_SIZE;
  const x = Math.round((px - PADDING) / CELL_SIZE);
  const y = Math.round((py - PADDING) / CELL_SIZE);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  return { x, y };
}

function hash2(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Procedural wood grain (cached per theme colors).
 * @param {string} boardDark
 * @param {string} boardLight
 */
function ensureBoardTexture(boardDark, boardLight) {
  const key = `${LOGICAL_SIZE}|${boardDark}|${boardLight}`;
  if (boardTexture && boardTextureKey === key) return boardTexture;

  const c = document.createElement("canvas");
  c.width = LOGICAL_SIZE;
  c.height = LOGICAL_SIZE;
  const g = c.getContext("2d");
  if (!g) return c;

  const base = g.createLinearGradient(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
  base.addColorStop(0, boardLight);
  base.addColorStop(0.45, boardDark);
  base.addColorStop(1, boardLight);
  g.fillStyle = base;
  g.fillRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);

  // Soft radial vignette (center brighter like lit table).
  const vig = g.createRadialGradient(
    LOGICAL_SIZE * 0.42,
    LOGICAL_SIZE * 0.38,
    LOGICAL_SIZE * 0.1,
    LOGICAL_SIZE * 0.5,
    LOGICAL_SIZE * 0.55,
    LOGICAL_SIZE * 0.78,
  );
  vig.addColorStop(0, "rgba(255,245,220,0.22)");
  vig.addColorStop(0.55, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(40,20,0,0.28)");
  g.fillStyle = vig;
  g.fillRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);

  // Vertical-ish grain streaks.
  for (let i = 0; i < 90; i++) {
    const x0 = hash2(i, 1) * LOGICAL_SIZE;
    const wobble = (hash2(i, 2) - 0.5) * 18;
    const alpha = 0.04 + hash2(i, 3) * 0.07;
    g.strokeStyle =
      hash2(i, 4) > 0.5
        ? `rgba(70,40,10,${alpha})`
        : `rgba(255,230,180,${alpha * 0.7})`;
    g.lineWidth = 0.6 + hash2(i, 5) * 1.8;
    g.beginPath();
    g.moveTo(x0, 0);
    for (let y = 0; y <= LOGICAL_SIZE; y += 24) {
      g.lineTo(x0 + Math.sin(y * 0.02 + i) * wobble, y);
    }
    g.stroke();
  }

  // Fine pores.
  for (let i = 0; i < 400; i++) {
    const px = hash2(i, 10) * LOGICAL_SIZE;
    const py = hash2(i, 11) * LOGICAL_SIZE;
    g.fillStyle = `rgba(50,28,8,${0.03 + hash2(i, 12) * 0.06})`;
    g.fillRect(px, py, 1.2, 1.2);
  }

  boardTexture = c;
  boardTextureKey = key;
  return c;
}

function drawBoardBevel() {
  const edge = 14;
  // Top-left highlight
  const hi = ctx.createLinearGradient(0, 0, 0, edge);
  hi.addColorStop(0, "rgba(255,255,255,0.38)");
  hi.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, LOGICAL_SIZE, edge);

  const hiX = ctx.createLinearGradient(0, 0, edge, 0);
  hiX.addColorStop(0, "rgba(255,255,255,0.28)");
  hiX.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hiX;
  ctx.fillRect(0, 0, edge, LOGICAL_SIZE);

  // Bottom-right shade (board thickness)
  const sh = ctx.createLinearGradient(
    0,
    LOGICAL_SIZE - edge,
    0,
    LOGICAL_SIZE,
  );
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, LOGICAL_SIZE - edge, LOGICAL_SIZE, edge);

  const shX = ctx.createLinearGradient(
    LOGICAL_SIZE - edge,
    0,
    LOGICAL_SIZE,
    0,
  );
  shX.addColorStop(0, "rgba(0,0,0,0)");
  shX.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = shX;
  ctx.fillRect(LOGICAL_SIZE - edge, 0, edge, LOGICAL_SIZE);

  // Inner rim around playable grid
  const inset = PADDING - 8;
  ctx.strokeStyle = "rgba(60,35,12,0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    inset,
    inset,
    LOGICAL_SIZE - inset * 2,
    LOGICAL_SIZE - inset * 2,
  );
  ctx.strokeStyle = "rgba(255,230,190,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    inset + 2,
    inset + 2,
    LOGICAL_SIZE - inset * 2 - 4,
    LOGICAL_SIZE - inset * 2 - 4,
  );
}

function drawBoardFrom(board, last) {
  syncCanvasBackingStore();
  lastDrawnBoard = board;
  lastDrawnMove = last;

  const boardDark = cssVar("--board-dark") || "#bcaaa4";
  const boardLight = cssVar("--board-light") || "#deb887";
  const stoneBlack = cssVar("--stone-black") || "#1a1a1a";
  const stoneWhite = cssVar("--stone-white") || "#f5f5f5";
  const lineInk = cssVar("--board-line") || "rgba(55, 32, 12, 0.55)";
  const starInk = cssVar("--board-star") || "rgba(45, 25, 8, 0.7)";

  const tex = ensureBoardTexture(boardDark, boardLight);
  ctx.drawImage(tex, 0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
  drawBoardBevel();

  ctx.strokeStyle = lineInk;
  ctx.lineWidth = 1.15;
  ctx.lineCap = "round";
  for (let i = 0; i < BOARD_SIZE; i++) {
    const p = PADDING + i * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(PADDING, p);
    ctx.lineTo(LOGICAL_SIZE - PADDING, p);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p, PADDING);
    ctx.lineTo(p, LOGICAL_SIZE - PADDING);
    ctx.stroke();
  }

  const stars = [3, 7, 11];
  for (const sx of stars) {
    for (const sy of stars) {
      const cx = PADDING + sx * CELL_SIZE;
      const cy = PADDING + sy * CELL_SIZE;
      ctx.beginPath();
      ctx.fillStyle = starInk;
      ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,235,200,0.35)";
      ctx.arc(cx - 0.8, cy - 0.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const winLine = findWinningLine(board, last, BOARD_SIZE);
  /** @type {Set<string> | null} */
  const winKeys = winLine
    ? new Set(winLine.map((c) => `${c.x},${c.y}`))
    : null;

  // Shadows first (under all stones), then bodies — reads more 3D.
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[y]?.[x];
      if (player == null) continue;
      drawStoneShadow(x, y);
    }
  }
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[y]?.[x];
      if (player == null) continue;
      drawStone(x, y, player, stoneBlack, stoneWhite, last, winKeys);
    }
  }

  if (winLine) drawWinningHighlight(winLine, board);

  if (
    !winLine &&
    hoverCell &&
    board[hoverCell.y]?.[hoverCell.x] == null &&
    !(last && last.x === hoverCell.x && last.y === hoverCell.y)
  ) {
    const ghostPlayer =
      playMode === "online" && myOnlineStone
        ? myOnlineStone
        : game.getCurrentPlayer();
    drawStoneGhost(hoverCell.x, hoverCell.y, ghostPlayer);
  }
}

/**
 * Highlight winning stones only — no connecting stroke.
 * @param {{ x: number, y: number }[]} cells
 * @param {(null|1|2)[][]} board
 */
function drawWinningHighlight(cells, board) {
  if (!cells.length) return;
  const first = cells[0];
  const player = board[first.y]?.[first.x];

  ctx.save();
  for (const { x, y } of cells) {
    const cx = PADDING + x * CELL_SIZE;
    const cy = PADDING + y * CELL_SIZE;
    const r = CELL_SIZE / 2 - 2;
    ctx.beginPath();
    ctx.strokeStyle =
      player === 1 ? "rgba(251, 191, 36, 0.95)" : "rgba(248, 113, 113, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor =
      player === 1 ? "rgba(251, 191, 36, 0.55)" : "rgba(239, 68, 68, 0.5)";
    ctx.shadowBlur = 6;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStoneShadow(x, y) {
  const cx = PADDING + x * CELL_SIZE;
  const cy = PADDING + y * CELL_SIZE;
  const r = CELL_SIZE / 2 - 4;
  ctx.save();
  ctx.translate(cx + 2.2, cy + 3.5);
  ctx.scale(1, 0.55);
  const shadow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.05);
  shadow.addColorStop(0, "rgba(0,0,0,0.35)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * @param {number} x
 * @param {number} y
 * @param {1|2} player
 * @param {string} stoneBlack
 * @param {string} stoneWhite
 * @param {{ x: number, y: number } | null} last
 * @param {Set<string> | null} [winKeys]
 */
function drawStone(x, y, player, stoneBlack, stoneWhite, last, winKeys = null) {
  const cx = PADDING + x * CELL_SIZE;
  const cy = PADDING + y * CELL_SIZE;
  const r = CELL_SIZE / 2 - 4;
  const isBlack = player === 1;
  const isWin = winKeys?.has(`${x},${y}`);

  // Body
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(
    cx - r * 0.35,
    cy - r * 0.4,
    r * 0.08,
    cx + r * 0.1,
    cy + r * 0.15,
    r,
  );
  if (isBlack) {
    body.addColorStop(0, "#6a6a6a");
    body.addColorStop(0.35, "#2c2c2c");
    body.addColorStop(0.85, stoneBlack);
    body.addColorStop(1, "#0a0a0a");
  } else {
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.4, stoneWhite);
    body.addColorStop(0.85, "#d8d8d8");
    body.addColorStop(1, "#b8b8b8");
  }
  ctx.fillStyle = body;
  ctx.fill();

  // Rim
  ctx.strokeStyle = isBlack ? "rgba(0,0,0,0.65)" : "rgba(120,120,120,0.55)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Specular
  ctx.beginPath();
  const hx = cx - r * 0.32;
  const hy = cy - r * 0.38;
  const gloss = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.55);
  if (isBlack) {
    gloss.addColorStop(0, "rgba(255,255,255,0.42)");
    gloss.addColorStop(0.35, "rgba(255,255,255,0.12)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    gloss.addColorStop(0, "rgba(255,255,255,0.95)");
    gloss.addColorStop(0.4, "rgba(255,255,255,0.35)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
  }
  ctx.fillStyle = gloss;
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.fill();

  // Last-move ring; skip when win glow covers the stone
  if (!isWin && last && last.x === x && last.y === y) {
    ctx.beginPath();
    ctx.strokeStyle = isBlack ? "#fbbf24" : "#ef4444";
    ctx.lineWidth = 2.25;
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStoneGhost(x, y, player) {
  const cx = PADDING + x * CELL_SIZE;
  const cy = PADDING + y * CELL_SIZE;
  const r = CELL_SIZE / 2 - 4;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = player === 1 ? "#1a1a1a" : "#f7f7f7";
  ctx.fill();
  ctx.strokeStyle = player === 1 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function finePointerHover() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function redrawLastBoard() {
  if (!lastDrawnBoard) return;
  drawBoardFrom(lastDrawnBoard, lastDrawnMove);
}

function playerName(p) {
  return p === 1 ? "黑棋" : "白棋";
}

function setStatus(message, tone = "") {
  gameStatus.textContent = message;
  gameStatus.dataset.tone = tone;
  gameStatus.classList.remove("status-flash");
  // Retrigger CSS animation when status text／tone changes.
  void gameStatus.offsetWidth;
  gameStatus.classList.add("status-flash");
}

function syncLayoutChrome() {
  const chrome = deriveChromeState({
    playMode,
    localMode: mode,
    localStarted,
    hasMove: game.getLastMove() != null,
    onlineRole,
    onlineStatus,
  });
  const prev = document.body.dataset.layout;
  document.body.dataset.layout = chrome.layout;
  document.body.dataset.phase = chrome.phase;

  if (shellSurface === "room") {
    playModeSection.hidden = true;
    localToolbar.hidden = true;
    onlinePanel.hidden = !chrome.showSetup;
  } else if (shellSurface === "solo") {
    playModeSection.hidden = true;
    localToolbar.hidden = !(chrome.showSetup && playMode === "local");
    onlinePanel.hidden = true;
  } else {
    playModeSection.hidden = !chrome.showSetup;
    localToolbar.hidden = !(chrome.showSetup && playMode === "local");
    onlinePanel.hidden = !(chrome.showSetup && playMode === "online");
  }
  document.getElementById("match-hud").hidden = !chrome.showHud;
  matchMenu.hidden = !chrome.showMatchMenu;

  resetBtn.hidden = playMode !== "local";
  backToSetupBtn.hidden = playMode !== "local";
  btnCloseSessionMatch.hidden = !(
    playMode === "online" &&
    onlineRole === "host" &&
    onlineStatus === "active"
  );

  if (prev !== chrome.layout) {
    // Layout swap changes board CSS size — refresh backing store／hit map.
    requestAnimationFrame(() => {
      fitBoardSquare();
      redrawLastBoard();
    });
  }
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
    localToolbar.hidden = true;
    localAiControls.hidden = true;
    modeLabel.textContent = "邀請";
    if (highScoreWrap) highScoreWrap.hidden = true;
    if (onlineStatus !== "active") {
      // applyOnlineState owns the label while a match is live.
      if (onlineRole === "idle" || onlineStatus === "waiting") {
        turnDisplay.textContent = "—";
      }
    }
    syncLayoutChrome();
    return;
  }
  localToolbar.hidden = false;
  localAiControls.hidden = false;
  const labels = {
    pvp: "雙人",
    ai: "人機",
    aivsai: "AI對AI",
  };
  modeLabel.textContent = labels[mode];

  if (mode === "aivsai" && aiVsAiTimer) {
    turnDisplay.textContent = "進行中";
  } else if (game.isGameOver()) {
    turnDisplay.textContent = "—";
  } else {
    turnDisplay.textContent = playerName(game.getCurrentPlayer());
  }

  if (highScoreWrap) highScoreWrap.hidden = mode !== "ai";

  startAiBtn.textContent = "挑戰 AI";
  startAiVsAiBtn.textContent = aiVsAiTimer
    ? "停止 AI 對 AI"
    : "AI 對 AI";
  startAiBtn.disabled = Boolean(aiVsAiTimer);
  startAiVsAiBtn.disabled = thinking && mode !== "aivsai";
  syncLayoutChrome();
}

function refreshStatus() {
  if (playMode === "online") {
    refreshOnlineStatusText();
    return;
  }
  if (!localStarted && mode === "pvp" && game.getLastMove() == null) {
    setStatus("選擇對弈方式，或直接落子開始雙人對弈。");
    return;
  }
  if (game.isGameOver()) {
    const w = game.getWinner();
    if (w === 0) setStatus("平局 — 棋盤已滿，無人連五。", "draw");
    else if (mode === "ai" && w === 2)
      setStatus("白棋（AI）連五獲勝！", "white");
    else if (mode === "ai" && w === 1)
      setStatus("黑棋（您）連五獲勝！", "black");
    else if (mode === "aivsai")
      setStatus(
        `${playerName(w)}（AI）連五獲勝！`,
        w === 1 ? "black" : "white",
      );
    else
      setStatus(`${playerName(w)}連五獲勝！`, w === 1 ? "black" : "white");
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

/** @type {{ resumeAi: boolean, resumeSeatPoll: boolean } | null} */
let lifecycleSnap = null;

function suspendGame() {
  const plan = planLifecycleSuspend({
    aiRunning: Boolean(aiVsAiTimer),
    seatPollRunning: Boolean(seatPollTimer),
  });
  // Merge: visibilitychange + pagehide may both fire; keep prior resume flags.
  lifecycleSnap = {
    resumeAi: Boolean(lifecycleSnap?.resumeAi) || plan.resumeAi,
    resumeSeatPoll:
      Boolean(lifecycleSnap?.resumeSeatPoll) || plan.resumeSeatPoll,
  };
  if (plan.stopAi) stopAiVsAi();
  if (plan.stopSeatPoll) stopSeatPoll();
  if (plan.clearThinking) thinking = false;
  if (plan.clearHover && hoverCell) {
    hoverCell = null;
    redrawLastBoard();
  }
}

function resumeGame() {
  if (!lifecycleSnap) return;
  const plan = planLifecycleResume(lifecycleSnap, {
    mode,
    gameOver: game.isGameOver(),
    hosting: onlineRole === "host",
  });
  lifecycleSnap = null;
  if (plan.resumeAi) {
    scheduleAiMove();
    runAiVsAiLoop();
  }
  if (plan.resumeSeatPoll) startSeatPoll();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") suspendGame();
  else resumeGame();
});
window.addEventListener("pagehide", suspendGame);

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
    setStatus("連勝已更新（本機），但未能同步到遊樂場存檔。", "danger");
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

  localStarted = true;
  hoverCell = null;
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
  localStarted = true;
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
  localStarted = true;
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
  localStarted = true;
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

function returnToLocalSetup() {
  stopAiVsAi();
  mode = "pvp";
  localStarted = false;
  thinking = false;
  game.reset();
  currentStreak = 0;
  gameOverHandled = false;
  drawBoardFrom(game.getBoard(), game.getLastMove());
  updateChrome();
  refreshStatus();
}

/* ——— Online (gomoku.v1) via DEC-053 /api/online/* → env.HOST ——— */

async function online(path, init) {
  const res = await fetch("/api/online" + path, init);
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

/** Host UI acts must go through online/domain so Roster peers get event fanout. */
async function hostDomain(path, init) {
  const method = (init && init.method) || "GET";
  const headers = (init && init.headers) || undefined;
  const body = init && typeof init.body === "string" ? init.body : undefined;
  return online("/domain", {
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
        : event.reason === "opponent_left"
          ? `${opponentLabel()}已離開，請重新開場`
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
    const event = msg.event;
    const type =
      event && typeof event === "object" ? String(event.type || "") : "";
    // Host close also publishes locally; do not revive the board via state fetch.
    if (type === "session.closed" || type === "match.closed") {
      applyEventToOnlineBoard(event);
      return;
    }
    if (onlineRole === "player") {
      applyEventToOnlineBoard(event);
      return;
    }
    void loadOnlineState().catch(() => {});
  };
}

/** Leave the online seat; keep the last board, clear turn／host CTAs. */
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
  opponentDisplayName = null;
  onlineStatus = "waiting";
  currentPlatformInviteId = null;
  inviteBox.hidden = true;
  inviteUrlInput.value = "";
  turnDisplay.textContent = "—";
  syncOnlineControls();
  setStatus(message, wasPlayer ? "danger" : "draw");
}

function applyOnlineState(state) {
  if (!state) return;
  onlineStatus = state.status || "waiting";
  const shouldApplyFirstRole =
    onlineRole !== "host" || onlineStatus === "active";
  if (state.firstRole && shouldApplyFirstRole) applyFirstRole(state.firstRole);
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
        ? `${opponentLabel()}已入座 — 選誰先（執黑），再按「開始」`
        : "已入座 — 等待主持開始",
    );
  } else if (onlineStatus === "active") {
    const mine =
      myOnlineStone === 1 ? "black" : myOnlineStone === 2 ? "white" : null;
    const turn = turnDisplay.textContent.includes("白") ? "white" : "black";
    if (mine && turn === mine) setStatus(`輪到你（${stoneLabel(myOnlineStone)}），請落子。`);
    else setStatus(`等待${opponentLabel()}落子…`);
  } else if (onlineStatus === "ended") {
    const line = findWinningLine(lastDrawnBoard, lastDrawnMove, BOARD_SIZE);
    const winPlayer = line
      ? lastDrawnBoard?.[line[0].y]?.[line[0].x]
      : null;
    const outcome =
      winPlayer === 1 || winPlayer === 2
        ? `${playerName(winPlayer)}連五獲勝！`
        : "平局 — 棋盤已滿。";
    const tone =
      winPlayer === 1 ? "black" : winPlayer === 2 ? "white" : "draw";
    if (onlineRole === "host") {
      setStatus(`${outcome}可改先手後按「再來一局」。`, tone);
    } else {
      setStatus(`${outcome}等待主持再來一局…`, tone);
    }
  }
}

function syncOnlineControls() {
  const hosting = onlineRole === "host";
  const asPlayer = onlineRole === "player";
  const isWaiting = onlineStatus === "waiting";
  const isReady = onlineStatus === "ready";
  const isActive = onlineStatus === "active";
  const isEnded = onlineStatus === "ended";
  const room = shellSurface === "room";
  const canInvite = !room && hosting && (isWaiting || isReady);
  const showFirstPick = hosting && (isReady || isEnded);

  btnOpenSession.disabled = hosting;
  btnInvite.disabled = !(hosting && canInvite);
  btnCloseSession.disabled = !hosting;
  btnStartMatch.disabled = !(hosting && isReady);
  btnRematch.disabled = !(hosting && isEnded);
  firstMoveField.hidden = !showFirstPick;

  // Invitee / booth: hide mode switch + local-only host CTAs.
  playModeSection.hidden = asPlayer || room;
  onlineControls.hidden = asPlayer;

  const stoneTxt =
    myOnlineStone != null ? `你執${stoneLabel(myOnlineStone)}` : "先手待定";

  if (asPlayer) {
    onlineMeta.textContent = room
      ? `包廂對弈 · ${stoneTxt}`
      : `參與中 · ${stoneTxt}`;
    inviteBox.hidden = true;
    btnOpenSession.hidden = true;
    btnInvite.hidden = true;
    btnStartMatch.hidden = true;
    btnRematch.hidden = true;
    btnCloseSession.hidden = true;
  } else if (hosting) {
    const statusLabel = isWaiting
      ? room
        ? "等候對手入座"
        : "等候對手"
      : isReady
        ? "可開始"
        : isActive
          ? "對弈中"
          : isEnded
            ? "終局"
            : onlineStatus;
    onlineMeta.textContent = room
      ? `包廂主持 · ${statusLabel} · ${stoneTxt}`
      : `主持 · ${statusLabel} · ${stoneTxt}`;
    btnOpenSession.hidden = true;
    btnInvite.hidden = !canInvite;
    btnStartMatch.hidden = !isReady;
    btnRematch.hidden = !isEnded;
    btnCloseSession.hidden = false;
    if (isActive || isEnded || room) inviteBox.hidden = true;
  } else {
    onlineMeta.textContent = room
      ? "包廂開局中…"
      : "尚未開啟邀請場";
    btnOpenSession.hidden = room;
    btnInvite.hidden = true;
    btnStartMatch.hidden = true;
    btnRematch.hidden = true;
    btnCloseSession.hidden = true;
  }

  syncLayoutChrome();
}

async function loadOnlineState() {
  if (onlineRole === "idle") return null;
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
    const st = await online("/status");
    const playerSeat = (st.seats || []).find((s) => s.role === "player");
    const hasPlayer = Boolean(playerSeat);
    const seatName =
      playerSeat && typeof playerSeat.name === "string"
        ? playerSeat.name.trim()
        : "";
    if (seatName) opponentDisplayName = seatName;
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
    const opened = await online("/open", { method: "POST" });
    onlineRole = "host";
    onlineFirstRole = "host";
    myOnlineStone = null;
    opponentDisplayName = null;
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
  if (
    onlineRole !== "host" ||
    (onlineStatus !== "waiting" && onlineStatus !== "ready")
  ) {
    setStatus("開局後不能再邀請對手", "danger");
    return;
  }
  setStatus("建立邀請…");
  try {
    const created = await online("/invite", {
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
    });
    currentPlatformInviteId = created.invite_id || null;
    inviteUrlInput.value = created.short_url || created.deep_link || "";
    inviteBox.hidden = true;
    setStatus("短網址已在遊樂場彈出 — 可複製或掃 QR；保持本頁在線");
  } catch (e) {
    const msg = String(e.message || e);
    if (/not_provisioned|通行證|登入我的遊樂場|登入遊樂場/i.test(msg)) {
      setStatus(
        "尚未登入遊樂場通行證 — 請先到後台按「登入我的遊樂場」（或 go 右上角登入）",
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
    stopSeatPoll();
    const inviteId = currentPlatformInviteId;
    currentPlatformInviteId = null;
    inviteBox.hidden = true;
    inviteUrlInput.value = "";
    if (inviteId) {
      try {
        await online("/invite/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inviteId }),
        });
      } catch {
        // Match is already active; shell stopped local polling before revoke.
      }
    }
    syncOnlineControls();
    const mine = stoneLabel(myOnlineStone);
    setStatus(
      myOnlineStone === 1
        ? `已開局 — 你執${mine}先手，請落子`
        : `已開局 — 你執${mine}，等待${opponentLabel()}先手`,
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
          : `已開下一局 — 你執${stoneLabel(myOnlineStone)}，等待${opponentLabel()}先手`,
      );
    } else {
      setStatus(`棋盤已清空 — 等候${opponentLabel()}入座`);
    }
  } catch (e) {
    setStatus(String(e.message || e), "danger");
  }
}

async function onCloseSession() {
  try {
    stopSeatPoll();
    // Close the local channel first so HOST.closeSession's session.closed
    // echo cannot call loadOnlineState() and restore "等待對手落子…".
    if (sessionChannel) {
      try {
        sessionChannel.close();
      } catch {
        /* ignore */
      }
      sessionChannel = null;
    }
    await online("/close", { method: "POST" });
    applyHostEndedSession(
      shellSurface === "room" ? "已結束這一局" : "已結束邀請場",
    );
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

/** Booth Host: adopt shell-opened session (no 開場／邀請). */
async function tryBootAsRoomHost() {
  if (shellSurface !== "room") return false;
  try {
    const st = await online("/status");
    if (!st?.active || !st.channelName) return false;
    playMode = "online";
    onlineRole = "host";
    myOnlineStone = null;
    onlinePanel.hidden = false;
    modeLocalBtn.classList.toggle("is-active", false);
    modeOnlineBtn.classList.toggle("is-active", true);
    updateChrome();
    bindSessionChannel(st.channelName);
    lastSeq = 0;
    await loadOnlineState();
    startSeatPoll();
    syncOnlineControls();
    setStatus(
      onlineStatus === "ready"
        ? "對手已入座 — 選先手後按「開始」"
        : "包廂開局 — 等候對手入座",
    );
    return true;
  } catch {
    return false;
  }
}

function applySoloShell() {
  modeOnlineBtn.hidden = true;
  onlinePanel.hidden = true;
  const tag = document.querySelector(".tagline");
  if (tag) tag.textContent = "連成五子即勝 · 本機對弈";
  onlinePanel.setAttribute("aria-label", "本機（連線請走包廂）");
}

function applyRoomShell() {
  playMode = "online";
  playModeSection.hidden = true;
  localToolbar.hidden = true;
  onlinePanel.hidden = false;
  modeLocalBtn.classList.remove("is-active");
  modeOnlineBtn.classList.add("is-active");
  const tag = document.querySelector(".tagline");
  if (tag) tag.textContent = "連成五子即勝 · 包廂對弈";
  onlinePanel.setAttribute("aria-label", "包廂對弈");
  inviteBox.hidden = true;
  btnOpenSession.hidden = true;
  btnInvite.hidden = true;
  syncOnlineControls();
  updateChrome();
}

function setPlayMode(next) {
  if (shellSurface === "solo" && next === "online") return;
  if (shellSurface === "room" && next === "local") return;
  if (next === playMode) return;
  if (next === "local") {
    stopSeatPoll();
    playMode = "local";
    localStarted = game.getLastMove() != null;
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

startLocalPvpBtn.addEventListener("click", startPvp);
startAiBtn.addEventListener("click", toggleAiMode);
startAiVsAiBtn.addEventListener("click", toggleAiVsAi);
resetBtn.addEventListener("click", restartGame);
backToSetupBtn.addEventListener("click", returnToLocalSetup);
modeLocalBtn.addEventListener("click", () => setPlayMode("local"));
modeOnlineBtn.addEventListener("click", () => setPlayMode("online"));
btnOpenSession.addEventListener("click", () => void onOpenSession());
btnInvite.addEventListener("click", () => void onInviteOpponent());
btnStartMatch.addEventListener("click", () => void onStartMatch());
btnRematch.addEventListener("click", () => void onRematch());
btnCloseSession.addEventListener("click", () => void onCloseSession());
btnCloseSessionMatch.addEventListener("click", () => void onCloseSession());
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

function canShowHoverGhost() {
  if (!finePointerHover()) return false;
  if (playMode === "online") {
    if (onlineRole === "idle" || onlineStatus !== "active") return false;
    if (!myOnlineStone) return false;
    const turnIsBlack = turnDisplay.textContent.includes("黑");
    if (myOnlineStone === 1 && !turnIsBlack) return false;
    if (myOnlineStone === 2 && turnIsBlack) return false;
    return true;
  }
  if (mode === "aivsai") return false;
  if (mode === "ai" && game.getCurrentPlayer() === 2) return false;
  if (game.isGameOver() || thinking) return false;
  return true;
}

canvas.addEventListener("pointermove", (e) => {
  if (!canShowHoverGhost()) {
    if (hoverCell) {
      hoverCell = null;
      redrawLastBoard();
    }
    return;
  }
  const cell = eventToCell(e);
  const next =
    cell && lastDrawnBoard?.[cell.y]?.[cell.x] == null ? cell : null;
  if (
    (hoverCell?.x ?? null) === (next?.x ?? null) &&
    (hoverCell?.y ?? null) === (next?.y ?? null)
  ) {
    return;
  }
  hoverCell = next;
  redrawLastBoard();
});

canvas.addEventListener("pointerleave", () => {
  if (!hoverCell) return;
  hoverCell = null;
  redrawLastBoard();
});

canvas.addEventListener("pointerup", (e) => {
  if (e.button != null && e.button !== 0) return;
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
    boardTexture = null;
    boardTextureKey = "";
    if (playMode === "local") {
      drawBoardFrom(game.getBoard(), game.getLastMove());
    } else {
      void loadOnlineState().catch(() => {});
    }
  });

function fitBoardSquare() {
  const layout = document.body.dataset.layout;
  const box = document.querySelector(".board-container");
  if (!box) return;
  if (layout !== "match" && layout !== "guest") {
    canvas.style.width = "";
    canvas.style.height = "";
    return;
  }
  // Prefer CSS container units; fall back when CQ size is unavailable.
  const supportsCq =
    typeof CSS !== "undefined" &&
    CSS.supports &&
    CSS.supports("container-type: size");
  if (supportsCq) {
    canvas.style.width = "";
    canvas.style.height = "";
    return;
  }
  const side = Math.max(160, Math.floor(Math.min(box.clientWidth, box.clientHeight)));
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
}

let viewportFitRaf = 0;
function onViewportChromeChange() {
  if (viewportFitRaf) cancelAnimationFrame(viewportFitRaf);
  viewportFitRaf = requestAnimationFrame(() => {
    viewportFitRaf = 0;
    fitBoardSquare();
    syncCanvasBackingStore();
    redrawLastBoard();
  });
}

window.addEventListener("resize", onViewportChromeChange);
window.addEventListener("orientationchange", () => {
  // Wait a frame for visual viewport to settle after rotate.
  setTimeout(onViewportChromeChange, 60);
});

const boardContainerEl = document.querySelector(".board-container");
if (boardContainerEl && typeof ResizeObserver === "function") {
  const ro = new ResizeObserver(() => {
    onViewportChromeChange();
  });
  ro.observe(boardContainerEl);
}

syncCanvasBackingStore();
drawBoardFrom(game.getBoard(), game.getLastMove());
updateChrome();
fitBoardSquare();
refreshStatus();
void loadHighScore();

async function bootShellSurface() {
  if (shellSurface === "solo") {
    applySoloShell();
    return;
  }
  if (shellSurface === "room") {
    applyRoomShell();
    if (await tryBootAsPlayer()) return;
    for (let i = 0; i < 20; i++) {
      if (await tryBootAsRoomHost()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    setStatus("包廂開局中 — 等候通道就緒…");
    return;
  }
  void tryBootAsPlayer();
}

void bootShellSurface();
