import { describe, expect, it } from "vitest";
import {
  planLifecycleResume,
  planLifecycleSuspend,
} from "./lifecycle.js";

describe("lifecycle suspend／resume plans", () => {
  it("records running AI and seat poll so they can resume", () => {
    expect(
      planLifecycleSuspend({
        aiRunning: true,
        seatPollRunning: true,
      }),
    ).toEqual({
      stopAi: true,
      stopSeatPoll: true,
      clearHover: true,
      clearThinking: true,
      resumeAi: true,
      resumeSeatPoll: true,
    });
  });

  it("does not ask to resume loops that were idle", () => {
    expect(
      planLifecycleSuspend({
        aiRunning: false,
        seatPollRunning: false,
      }),
    ).toMatchObject({
      stopAi: false,
      stopSeatPoll: false,
      resumeAi: false,
      resumeSeatPoll: false,
    });
  });

  it("keeps prior resume flags when merging repeated suspend snapshots", () => {
    const first = planLifecycleSuspend({
      aiRunning: true,
      seatPollRunning: false,
    });
    const second = planLifecycleSuspend({
      aiRunning: false,
      seatPollRunning: false,
    });
    const merged = {
      resumeAi: Boolean(first.resumeAi) || second.resumeAi,
      resumeSeatPoll:
        Boolean(first.resumeSeatPoll) || second.resumeSeatPoll,
    };
    expect(merged).toEqual({ resumeAi: true, resumeSeatPoll: false });
  });

  it("resumes AI only when still in aivsai and not over", () => {
    const snap = planLifecycleSuspend({
      aiRunning: true,
      seatPollRunning: false,
    });
    expect(
      planLifecycleResume(snap, {
        mode: "aivsai",
        gameOver: false,
        hosting: false,
      }),
    ).toEqual({ resumeAi: true, resumeSeatPoll: false });
    expect(
      planLifecycleResume(snap, {
        mode: "aivsai",
        gameOver: true,
        hosting: false,
      }),
    ).toEqual({ resumeAi: false, resumeSeatPoll: false });
  });

  it("resumes seat poll only while still hosting", () => {
    const snap = planLifecycleSuspend({
      aiRunning: false,
      seatPollRunning: true,
    });
    expect(
      planLifecycleResume(snap, {
        mode: "pvp",
        gameOver: false,
        hosting: true,
      }),
    ).toEqual({ resumeAi: false, resumeSeatPoll: true });
    expect(
      planLifecycleResume(snap, {
        mode: "pvp",
        gameOver: false,
        hosting: false,
      }),
    ).toEqual({ resumeAi: false, resumeSeatPoll: false });
  });
});
