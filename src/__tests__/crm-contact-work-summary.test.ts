// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("actual contact-work summary", () => {
  it("reads real relationship contracts without conferring execution or bypassing caller RLS", () => {
    const processKeys = ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC", "TEMP", "TMP"];
    const env = Object.fromEntries(processKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key] as string]));
    const output = execFileSync(process.execPath, ["--import", "./scripts/client-memory-authz/register.mjs", "scripts/crm-contact-work-summary-check.mjs"], {
      cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toContain("PASS 22 actual-handler contact-work summary checks");
  }, 125_000);
});
