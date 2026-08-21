import { describe, expect, it } from "vitest";
import { readPgSurface } from "./shellSurface.js";

describe("readPgSurface", () => {
  it("reads query param first", () => {
    const loc = { search: "?v=1&pg_surface=room" };
    const doc = {
      querySelector: () => ({ getAttribute: () => "solo" }),
    };
    expect(readPgSurface(doc, loc)).toBe("room");
  });

  it("falls back to meta", () => {
    const loc = { search: "" };
    const doc = {
      querySelector: (sel) =>
        sel.includes("pg:surface")
          ? { getAttribute: () => "room" }
          : null,
    };
    expect(readPgSurface(doc, loc)).toBe("room");
  });

  it("defaults to solo", () => {
    expect(readPgSurface({ querySelector: () => null }, { search: "" })).toBe(
      "solo",
    );
  });
});
