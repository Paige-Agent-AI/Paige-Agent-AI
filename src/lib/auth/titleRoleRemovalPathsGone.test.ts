// The paths that removed the retired title role are gone with the last rows that held it. No PAIGE
// operator tool, capability decision or risk class names the removal, because there is nothing left
// to remove and the value can no longer be stored. The database side is 20270511000000.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

describe("the removal paths for the retired title role are gone", () => {
  it("the operator toolset neither defines the removal tool nor calls the removal function", () => {
    const source = read("supabase/functions/paige-mcp/index.ts");
    expect(source).not.toMatch(/remove_coach_role/);
  });

  it("no capability decision or risk class names the removal", () => {
    for (const path of [
      "supabase/functions/_shared/paige-mcp/capability-policy.ts",
      "supabase/functions/_shared/action-risk.ts",
      "supabase/functions/paige-ai-chat/index.ts",
    ]) {
      expect(read(path), path).not.toMatch(/remove_coach_role|coach_revoke_role_globally/);
    }
    // The ledger's live entries only; its seeded list is a frozen record of the first seeding.
    const ledger = JSON.parse(read("scripts/ci/receipt-coverage-ledger.json")) as {
      entries: Array<{ tool: string }>;
    };
    expect(ledger.entries.map((e) => e.tool)).not.toContain("coach_revoke_role_globally");
  });
});
