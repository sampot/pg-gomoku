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
const MODULES = ["app.js", "functions.js", "gomoku.js", "protocol.js"];

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

  it("app.js does not call transitional /api/shell/* (DEC-053)", () => {
    const src = readFileSync(join(here, "app.js"), "utf8");
    expect(src).not.toMatch(/\/api\/shell\/session/);
    expect(src).not.toMatch(/\/api\/shell\/platform/);
    expect(src).toMatch(/\/api\/online\//);
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
});
