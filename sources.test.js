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
});
