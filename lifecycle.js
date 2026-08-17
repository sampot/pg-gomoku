/**
 * Pure plans for §3.5 suspend／resume (no DOM／timers).
 * app.js applies the side effects.
 */

/**
 * @param {{ aiRunning: boolean, seatPollRunning: boolean }} flags
 */
export function planLifecycleSuspend(flags) {
  return {
    stopAi: Boolean(flags.aiRunning),
    stopSeatPoll: Boolean(flags.seatPollRunning),
    clearHover: true,
    clearThinking: true,
    resumeAi: Boolean(flags.aiRunning),
    resumeSeatPoll: Boolean(flags.seatPollRunning),
  };
}

/**
 * @param {{ resumeAi: boolean, resumeSeatPoll: boolean }} snap
 * @param {{ mode: string, gameOver: boolean, hosting: boolean }} ctx
 */
export function planLifecycleResume(snap, ctx) {
  return {
    resumeAi:
      Boolean(snap.resumeAi) && ctx.mode === "aivsai" && !ctx.gameOver,
    resumeSeatPoll: Boolean(snap.resumeSeatPoll) && ctx.hosting,
  };
}
