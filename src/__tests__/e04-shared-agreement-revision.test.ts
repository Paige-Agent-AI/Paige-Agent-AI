// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("E04 PRE-1 shared agreement revision contract", () => {
  it("runs actual dispatch, fingerprint, uncertainty and successor-brake proof", () => {
    // Only OS process-launch configuration is inherited. Provider/auth values are fake and local
    // inside the inspected script; its fetch port never sends a request to a remote service.
    const processKeys = ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC", "TEMP", "TMP"];
    const env = Object.fromEntries(processKeys.filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key] as string]));
    const output = execFileSync(process.execPath, ["--import", "./scripts/knowledge-scope/register.mjs",
      "scripts/agreements/chat-draft-shared-integration.test.mjs", "--require-domain-contract"], {
      cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toContain("PASS 8 PRE-1 shared integration checks");
    expect(output).toContain("PASS actual handler brakes a successor agreement write after persisted uncertainty");
  }, 130_000);
});
