/**
 * Shell → SAM surface (PG-GO-ROOM-PLAY-PLAN §6.0).
 * Query `pg_surface=solo|room`; memory canvas uses meta `pg:surface`.
 */

export function readPgSurface(doc = document, loc = location) {
  try {
    const q = new URLSearchParams(loc.search || "").get("pg_surface");
    if (q === "room" || q === "solo") return q;
  } catch {
    /* ignore */
  }
  try {
    const meta = doc.querySelector?.('meta[name="pg:surface"]');
    const c = meta?.getAttribute?.("content")?.trim();
    if (c === "room" || c === "solo") return c;
  } catch {
    /* ignore */
  }
  return "solo";
}
