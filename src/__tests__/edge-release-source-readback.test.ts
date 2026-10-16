// @vitest-environment node
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { expect, test } from "vitest";

// Include the real stdlib verifier/fixture contract in the incumbent unit job.
// No Supabase process, credentials, project, or provider is used by these tests.
test("Edge release certifies exact downloaded source and rejects false success", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", [
    "-B", "-m", "unittest", "discover", "-s", ".github/scripts", "-p", "test_edge_source_readback.py", "-v",
  ], { cwd: root, encoding: "utf8", timeout: 180_000 });
  expect(result.error, "Fixture runner must actually start").toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const executed = Number(result.stderr.match(/Ran (\d+) tests/)?.[1] ?? 0);
  expect(executed, "The protected fixture suite must actually be collected").toBeGreaterThanOrEqual(58);
  expect(result.stderr).not.toContain("skipped=");
}, 185_000);
