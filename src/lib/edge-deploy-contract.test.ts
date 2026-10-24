import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("original Edge deployment and downloaded-source contract", () => {
  it("runs the real Python regression suite with isolated CLI doubles", () => {
    const result = spawnSync(
      process.platform === "win32" ? "python" : "python3",
      ["-B", "-m", "unittest", "discover", "-s", ".github/scripts",
        "-p", "test_edge_source_readback.py", "-v"],
      {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.error, "Python runner must execute; no skipped proof").toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran \d+ tests/);
    expect(result.stderr).toMatch(/\bOK\b/);
  }, 125_000);
});
