// @vitest-environment node
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

// Existing required verify installs Deno before the normal src/** Vitest pass.
// Wire the real pinned parser/integration suite into that existing discovery;
// do not create another workflow or silently skip native proof in CI.
const probe = spawnSync("deno", ["--version"], {encoding: "utf8", timeout: 15000});
const available = probe.status === 0;
describe("actual pinned CURA Word reader in Deno", () => {
  const nativeTest = !available && !process.env.CI ? it.skip : it;
  nativeTest("type-checks and executes the original source with runtime effects denied", () => {
    expect(available, "Deno is required by CI; local native proof needs the same existing test tool").toBe(true);
    const result = spawnSync("deno", ["test", "--no-lock", "--node-modules-dir=none",
      "--allow-import=registry.npmjs.org", "--deny-net", "--deny-env", "--deny-read", "--deny-write",
      "--deny-run", "--deny-ffi", "--deny-sys", "supabase/functions/_shared/client-portal-docx.test.ts"],
    {encoding: "utf8", timeout: 120000, maxBuffer: 1048576});
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const output = result.stdout.replace(/\[[0-9;]*m/g, "").split(String.fromCharCode(27)).join("");
    expect(output).toMatch(/\bok\s*\|\s*[1-9]\d* passed\s*\|\s*0 failed\b/);
  }, 150000);
});
