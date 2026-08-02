import { describe, expect, it } from "vitest";
import { GomokuGame } from "./gomoku.js";

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
