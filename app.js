import { GomokuGame } from "./gomoku.js";

const BOARD_SIZE = 15;
const CELL_SIZE = 40;
const PADDING = 20;
const CANVAS_SIZE = PADDING * 2 + CELL_SIZE * (BOARD_SIZE - 1);

/** @type {'pvp' | 'ai' | 'aivsai'} */
let mode = "pvp";
let game = new GomokuGame(BOARD_SIZE);
/** @type {ReturnType<typeof setInterval> | null} */
let aiVsAiTimer = null;
let thinking = false;

const canvas = document.getElementById("game-board");
const ctx = canvas.getContext("2d");
const turnDisplay = document.getElementById("turn-display");
const gameStatus = document.getElementById("game-status");
const modeLabel = document.getElementById("mode-label");
const startAiBtn = document.getElementById("start-ai");
const startAiVsAiBtn = document.getElementById("start-ai-vs-ai");
const resetBtn = document.getElementById("reset-game");

function cssVar(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function syncCanvasBackingStore() {
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
}

/** Map pointer event → board cell, accounting for CSS scaling. */
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

function drawBoard() {
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

  const board = game.getBoard();
  const last = game.getLastMove();
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[y][x];
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

function updateChrome() {
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

function setStatus(message, tone = "") {
  gameStatus.textContent = message;
  gameStatus.dataset.tone = tone;
}

function refreshStatus() {
  if (game.isGameOver()) {
    const w = game.getWinner();
    if (w === 0) setStatus("平局！棋盤已滿。", "draw");
    else if (mode === "ai" && w === 2) setStatus("白棋（AI）獲勝！", "white");
    else if (mode === "ai" && w === 1) setStatus("黑棋（您）獲勝！", "black");
    else if (mode === "aivsai")
      setStatus(`${playerName(w)}（AI）獲勝！`, w === 1 ? "black" : "white");
    else setStatus(`${playerName(w)}獲勝！`, w === 1 ? "black" : "white");
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

function placeStone(x, y) {
  if (game.isGameOver() || thinking) return false;
  if (!game.makeMove(x, y)) return false;

  drawBoard();
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
  drawBoard();
  updateChrome();
  refreshStatus();
}

function startPvp() {
  stopAiVsAi();
  mode = "pvp";
  game.reset();
  thinking = false;
  drawBoard();
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

  // Resume an in-progress AI vs AI game; otherwise start fresh.
  const resume =
    mode === "aivsai" && !game.isGameOver() && game.getLastMove() != null;

  mode = "aivsai";
  thinking = false;
  if (!resume) {
    game.reset();
    drawBoard();
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
  drawBoard();
  updateChrome();
  refreshStatus();
}

startAiBtn.addEventListener("click", toggleAiMode);
startAiVsAiBtn.addEventListener("click", toggleAiVsAi);
resetBtn.addEventListener("click", restartGame);

canvas.addEventListener("click", (e) => {
  if (mode === "aivsai") return;
  if (mode === "ai" && game.getCurrentPlayer() === 2) return;
  if (game.isGameOver() || thinking) return;
  const cell = eventToCell(e);
  if (!cell) return;
  placeStone(cell.x, cell.y);
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => drawBoard());

syncCanvasBackingStore();
drawBoard();
updateChrome();
refreshStatus();
