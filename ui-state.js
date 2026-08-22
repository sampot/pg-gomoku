/**
 * Convert gameplay state into the small set of page chrome phases.
 * Setup controls live above the board; active play keeps only status + menu.
 */
export function deriveChromeState({
  playMode,
  localMode = "pvp",
  localStarted = false,
  hasMove = false,
  onlineRole = "idle",
  onlineStatus = "waiting",
}) {
  if (playMode === "online") {
    const active = onlineStatus === "active";
    const guest =
      onlineRole === "player" || onlineRole === "spectator";
    return {
      layout: active && guest ? "guest" : active ? "match" : "setup",
      phase: onlineStatus,
      showSetup: !active && !guest,
      showHud: false,
      showMatchMenu: active && !guest,
    };
  }

  const active = localMode !== "pvp" || localStarted || hasMove;
  return {
    layout: active ? "match" : "setup",
    phase: active ? "active" : "setup",
    showSetup: !active,
    showHud: false,
    showMatchMenu: active,
  };
}
