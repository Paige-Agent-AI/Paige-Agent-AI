// EXP03 email journey — the campaign lifecycle proof (supabase/tests/email_campaign_lifecycle.sql) is a
// required-CI database-contract step, rolled back, on synthetic test tenants, and it drives only the real
// seams (no direct writes standing in for a writer, except the fixtures and the tampering it says it does).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const proof = readFileSync("supabase/tests/email_campaign_lifecycle.sql", "utf8");
const workflow = readFileSync(".github/workflows/paige-spine-contract.yml", "utf8");

describe("email campaign lifecycle proof", () => {
  it("runs in the database-contract job", () => {
    expect(workflow).toContain("- run: supabase test db supabase/tests/email_campaign_lifecycle.sql");
  });

  it("is rolled back and uses only synthetic test tenants", () => {
    expect(proof.trimStart().split("\n").some((l) => l === "BEGIN;")).toBe(true);
    expect(proof.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(proof).toContain("'test-tenant-e03-lifecycle-alder'");
    expect(proof).toContain("'test-tenant-e03-lifecycle-birch'");
    expect(proof).not.toMatch(/@(?!tests\.invalid)[a-z0-9.-]+\.(com|ai|net|org)\b/i);
  });

  it("plans exactly the assertions it makes", () => {
    const planned = Number(/SELECT plan\((\d+)\);/.exec(proof)?.[1]);
    const unnested = 8; // section 0: four dispatcher functions × two roles in one statement
    const single = (proof.match(/^SELECT (is|isnt|ok|throws_ok)\(/gm) ?? []).length - 1;
    expect(planned).toBe(single + unnested);
  });

  it("covers every negative the email directive names", () => {
    for (const phrase of [
      "a saved draft reopens", "a member cannot approve", "another business's owner cannot approve",
      "no writer can change a frozen version's content", "an approval bound to other content is refused",
      "the stale version cannot be approved", "a generic approve of the queue row is refused",
      "approval with no signed-in person is refused", "her repeat filing returns the same approval",
      "PAIGE cannot take over an approval the owner filed", "a decline from the approvals queue",
      "skipped at send, after approval", "an expired lease becomes outcome unknown",
      "a duplicate record of the same send is refused", "the leased recipient is refused at hand-off",
      "never planned again",
    ]) {
      expect(proof.toLowerCase().replace(/''/g, "'")).toContain(phrase.toLowerCase());
    }
  });
});
