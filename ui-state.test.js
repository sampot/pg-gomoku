import { describe, expect, it } from "vitest";
import { deriveChromeState } from "./ui-state.js";

describe("deriveChromeState", () => {
  it("keeps local setup above the board before the first move", () => {
    expect(
      deriveChromeState({
        playMode: "local",
        localMode: "pvp",
        hasMove: false,
      }),
    ).toEqual({
      layout: "setup",
      phase: "setup",
      showSetup: true,
      showHud: false,
      showMatchMenu: false,
    });
  });

  it("hides setup chrome after local play begins", () => {
    expect(
      deriveChromeState({
        playMode: "local",
        localMode: "pvp",
        localStarted: true,
        hasMove: false,
      }),
    ).toMatchObject({
      layout: "match",
      phase: "active",
      showSetup: false,
      showHud: false,
      showMatchMenu: true,
    });
  });

  it("treats selecting an AI mode as starting local play", () => {
    expect(
      deriveChromeState({
        playMode: "local",
        localMode: "ai",
        hasMove: false,
      }),
    ).toMatchObject({
      layout: "match",
      phase: "active",
      showSetup: false,
      showMatchMenu: true,
    });
  });

  it("keeps online opening and ready controls in setup", () => {
    for (const onlineStatus of ["waiting", "ready"]) {
      expect(
        deriveChromeState({
          playMode: "online",
          onlineRole: "host",
          onlineStatus,
        }),
      ).toMatchObject({
        layout: "setup",
        phase: onlineStatus,
        showSetup: true,
        showMatchMenu: false,
      });
    }
  });

  it("shows only play information and match menu during online play", () => {
    expect(
      deriveChromeState({
        playMode: "online",
        onlineRole: "host",
        onlineStatus: "active",
      }),
    ).toEqual({
      layout: "match",
      phase: "active",
      showSetup: false,
      showHud: false,
      showMatchMenu: true,
    });
  });

  it("returns rematch setup to the top after an online game", () => {
    expect(
      deriveChromeState({
        playMode: "online",
        onlineRole: "host",
        onlineStatus: "ended",
      }),
    ).toMatchObject({
      layout: "setup",
      phase: "ended",
      showSetup: true,
      showMatchMenu: false,
    });
  });

  it("keeps guest play board-first without host setup", () => {
    expect(
      deriveChromeState({
        playMode: "online",
        onlineRole: "player",
        onlineStatus: "active",
      }),
    ).toMatchObject({
      layout: "guest",
      phase: "active",
      showSetup: false,
      showHud: false,
      showMatchMenu: false,
    });
  });
});
