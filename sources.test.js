import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `app.js` runs in the canvas, so a parse error is invisible to unit tests that
 * only import `gomoku.js` — the board silently never renders.
 */
const MODULES = [
  "app.js",
  "functions.js",
  "gomoku.js",
  "lifecycle.js",
  "protocol.js",
  "shellSurface.js",
  "ui-state.js",
];

function syntaxCheck(source) {
  return spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
  });
}

describe("browser modules", () => {
  for (const name of MODULES) {
    it(`${name} parses as an ES module`, () => {
      const res = syntaxCheck(readFileSync(join(here, name), "utf8"));
      expect(res.stderr).not.toMatch(/SyntaxError/);
      expect(res.status).toBe(0);
    });
  }

  it("reports duplicate top-level declarations", () => {
    const res = syntaxCheck('const A = 1;\nconst A = 2;\nexport { A };\n');
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/already been declared/);
  });

  it("app.js reads pg_surface and boots solo／room shells", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).toMatch(/readPgSurface/);
    expect(src).toMatch(/applySoloShell/);
    expect(src).toMatch(/tryBootAsRoomHost/);
    expect(src).toMatch(/shellSurface === "room"/);
  });

  it("index.html declares session:host and platform:invite", () => {
    const html = readFileSync(join(here, "index.html"), "utf8");
    expect(html).toMatch(/sam:capabilities/);
    expect(html).toMatch(/session:host/);
    expect(html).toMatch(/platform:invite/);
  });

  it("stops inviting and hides the invite action after a match starts", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).toMatch(/online\("\/invite\/revoke"/);
    expect(src).toMatch(/btnInvite\.disabled\s*=\s*!\(hosting\s*&&\s*canInvite\)/);
    expect(src).toMatch(/btnInvite\.hidden\s*=\s*!canInvite/);
  });

  it("does not let pre-game polling overwrite the Host's first-player choice", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).toMatch(
      /const shouldApplyFirstRole\s*=\s*onlineRole !== "host" \|\| onlineStatus === "active"/,
    );
    expect(src).toMatch(/if \(state\.firstRole && shouldApplyFirstRole\)/);
  });

  it("ends the Host UI when the session closed event arrives locally", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).toMatch(
      /if \(type === "session\.closed" \|\| type === "match\.closed"\) \{\s*applyHostEndedSession/,
    );
    expect(src).toMatch(/async function onCloseSession\(\)/);
    expect(src).toMatch(/applyHostEndedSession\(/);
    expect(src).toMatch(/已結束這一局|已結束邀請場/);
  });

  it("suspends AI／seat poll on visibility hidden (PG-GAME-AGENT-GUIDE §3.5)", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).toMatch(/visibilitychange/);
    expect(src).toMatch(/pagehide/);
    expect(src).toMatch(/function suspendGame\(/);
    expect(src).toMatch(/function resumeGame\(/);
  });

  it("sam-manifest lists every browser module app.js imports", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "sam-manifest.json"), "utf8")
    ) as { files: string[] };
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "app.js",
        "shellSurface.js",
        "index.html",
        "styles.css",
      ])
    );
    expect(manifest.files).toContain("shellSurface.js");
  });
});
