import { describe, expect, it } from "vitest";
import { findWinningLine, GomokuGame } from "./gomoku.js";

describe("GomokuGame", () => {
  it("places stones with row-major board[y][x]", () => {
    const g = new GomokuGame(15);
    expect(g.makeMove(3, 7)).toBe(true);
    expect(g.getBoard()[7][3]).toBe(1);
    expect(g.getCurrentPlayer()).toBe(2);
  });

  it("detects horizontal win", () => {
    const g = new GomokuGame(15);
    for (let x = 0; x < 4; x++) {
      g.makeMove(x, 5);
      g.makeMove(x, 6);
    }
    expect(g.makeMove(4, 5)).toBe(true);
    expect(g.isGameOver()).toBe(true);
    expect(g.getWinner()).toBe(1);
  });

  it("exposes the five winning cells after a horizontal win", () => {
    const g = new GomokuGame(15);
    for (let x = 0; x < 4; x++) {
      g.makeMove(x, 5);
      g.makeMove(x, 6);
    }
    g.makeMove(4, 5);
    const line = g.getWinningLine();
    expect(line).toEqual([
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ]);
  });

  it("exposes winning cells on a diagonal", () => {
    const g = new GomokuGame(15);
    // Black: (0,0)(1,1)(2,2)(3,3)(4,4); White fills elsewhere
    const white = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    for (let i = 0; i < 4; i++) {
      g.makeMove(i, i);
      g.makeMove(white[i][0], white[i][1]);
    }
    g.makeMove(4, 4);
    expect(g.getWinner()).toBe(1);
    expect(g.getWinningLine()).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
  });

  it("clears winning line on reset", () => {
    const g = new GomokuGame(15);
    for (let x = 0; x < 4; x++) {
      g.makeMove(x, 5);
      g.makeMove(x, 6);
    }
    g.makeMove(4, 5);
    expect(g.getWinningLine()).toBeTruthy();
    g.reset();
    expect(g.getWinningLine()).toBeNull();
  });

  it("rejects occupied cells", () => {
    const g = new GomokuGame(15);
    expect(g.makeMove(7, 7)).toBe(true);
    expect(g.makeMove(7, 7)).toBe(false);
  });

  it("AI returns a legal empty cell", () => {
    const g = new GomokuGame(15);
    g.makeMove(7, 7);
    const move = g.getBestMove(2);
    expect(move).toBeTruthy();
    expect(g.getBoard()[move.y][move.x]).toBeNull();
  });
});

describe("findWinningLine", () => {
  it("finds a line from board + last move without a game instance", () => {
    const board = Array.from({ length: 15 }, () => Array(15).fill(null));
    for (let x = 0; x < 5; x++) board[7][x] = 2;
    const line = findWinningLine(board, { x: 2, y: 7, player: 2 });
    expect(line).toEqual([
      { x: 0, y: 7 },
      { x: 1, y: 7 },
      { x: 2, y: 7 },
      { x: 3, y: 7 },
      { x: 4, y: 7 },
    ]);
  });

  it("returns null when last move is not a win", () => {
    const board = Array.from({ length: 15 }, () => Array(15).fill(null));
    board[7][7] = 1;
    expect(findWinningLine(board, { x: 7, y: 7, player: 1 })).toBeNull();
  });
});
