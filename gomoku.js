/**
 * Gomoku (五子棋) core: board, win check, and heuristic AI.
 * Board is row-major: board[y][x], player 1 = black, 2 = white.
 */

const WIN_DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * Winning cells for the stone at `last` (if any). Usable for local + online boards.
 * @param {(null|1|2)[][]} board
 * @param {{ x: number, y: number, player?: number } | null | undefined} last
 * @param {number} [size]
 * @returns {{ x: number, y: number }[] | null}
 */
export function findWinningLine(board, last, size = board?.length ?? 15) {
  if (!board || !last) return null;
  const { x, y } = last;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  ) {
    return null;
  }
  const player = last.player ?? board[y]?.[x];
  if (player !== 1 && player !== 2) return null;
  if (board[y][x] !== player) return null;

  for (const [dx, dy] of WIN_DIRECTIONS) {
    const cells = [{ x, y }];
    for (let i = 1; ; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
      if (board[ny][nx] !== player) break;
      cells.push({ x: nx, y: ny });
    }
    for (let i = 1; ; i++) {
      const nx = x - dx * i;
      const ny = y - dy * i;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
      if (board[ny][nx] !== player) break;
      cells.unshift({ x: nx, y: ny });
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

export class GomokuGame {
  constructor(size = 15) {
    this.size = size;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () =>
      Array(this.size).fill(null),
    );
    this.currentPlayer = 1;
    this.gameOver = false;
    this.winner = null; // 1 | 2 | 0 (draw) | null
    this.lastMove = null;
    this.moveCount = 0;
    /** @type {{ x: number, y: number }[] | null} */
    this.winningLine = null;
  }

  getBoard() {
    return this.board;
  }

  getCurrentPlayer() {
    return this.currentPlayer;
  }

  getLastMove() {
    return this.lastMove;
  }

  isGameOver() {
    return this.gameOver;
  }

  getWinner() {
    return this.winner;
  }

  /** @returns {{ x: number, y: number }[] | null} */
  getWinningLine() {
    return this.winningLine;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  makeMove(x, y) {
    if (!this.inBounds(x, y) || this.gameOver || this.board[y][x] !== null) {
      return false;
    }

    const player = this.currentPlayer;
    this.board[y][x] = player;
    this.lastMove = { x, y, player };
    this.moveCount += 1;

    const line = findWinningLine(this.board, this.lastMove, this.size);
    if (line) {
      this.gameOver = true;
      this.winner = player;
      this.winningLine = line;
      return true;
    }

    if (this.moveCount >= this.size * this.size) {
      this.gameOver = true;
      this.winner = 0;
      return true;
    }

    this.currentPlayer = player === 1 ? 2 : 1;
    return true;
  }

  checkWin(x, y, player) {
    return (
      findWinningLine(this.board, { x, y, player }, this.size) != null
    );
  }

  /** Score-based AI; returns { x, y } or null. */
  getBestMove(player = this.currentPlayer) {
    const opponent = player === 1 ? 2 : 1;
    const candidates = this.getCandidateMoves();

    if (candidates.length === 0) {
      const mid = Math.floor(this.size / 2);
      return { x: mid, y: mid };
    }

    let bestScore = -Infinity;
    let bestMoves = [];

    for (const { x, y } of candidates) {
      const attack = this.evaluatePosition(x, y, player);
      const defense = this.evaluatePosition(x, y, opponent);
      // Slight attack bias; immediate win / block-four still dominate via scores.
      const total = attack * 1.15 + defense;

      if (total > bestScore) {
        bestScore = total;
        bestMoves = [{ x, y }];
      } else if (total === bestScore) {
        bestMoves.push({ x, y });
      }
    }

    if (bestMoves.length === 0) return null;
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  getCandidateMoves() {
    const candidates = [];
    const visited = new Set();
    let hasStone = false;

    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.board[y][x] === null) continue;
        hasStone = true;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inBounds(nx, ny) || this.board[ny][nx] !== null) continue;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);
            candidates.push({ x: nx, y: ny });
          }
        }
      }
    }

    if (!hasStone) {
      const mid = Math.floor(this.size / 2);
      return [{ x: mid, y: mid }];
    }

    return candidates;
  }

  evaluatePosition(x, y, player) {
    let score = 0;
    const directions = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ];
    for (const [dx, dy] of directions) {
      score += this.evaluateDirection(x, y, dx, dy, player);
    }
    // Prefer center slightly.
    const mid = (this.size - 1) / 2;
    const dist = Math.abs(x - mid) + Math.abs(y - mid);
    score += Math.max(0, 14 - dist);
    return score;
  }

  evaluateDirection(x, y, dx, dy, player) {
    let count = 1;
    let blockedEnds = 0;
    let openGaps = 0;

    for (const sign of [1, -1]) {
      let i = 1;
      let sawGap = false;
      while (true) {
        const nx = x + dx * i * sign;
        const ny = y + dy * i * sign;
        if (!this.inBounds(nx, ny)) {
          blockedEnds++;
          break;
        }
        const cell = this.board[ny][nx];
        if (cell === player) {
          if (sawGap) openGaps++;
          else count++;
          i++;
          continue;
        }
        if (cell === null) {
          if (!sawGap) {
            sawGap = true;
            i++;
            continue;
          }
          break;
        }
        blockedEnds++;
        break;
      }
    }

    if (count >= 5) return 100000;
    if (count === 4) {
      if (blockedEnds === 0) return 10000;
      if (blockedEnds === 1) return 1000;
    }
    if (count === 3) {
      if (blockedEnds === 0) return 1000;
      if (blockedEnds === 1) return 100;
    }
    if (count === 2) {
      if (blockedEnds === 0) return 100;
      if (blockedEnds === 1) return 10;
    }
    return count + openGaps;
  }
}
