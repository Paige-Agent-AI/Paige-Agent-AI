// EXP03 email journey — the campaign lifecycle proof (supabase/tests/email_campaign_lifecycle.sql) is a
// required-CI database-contract step, rolled back, on synthetic test tenants, and it drives only the real
// seams (no direct writes standing in for a writer, except the fixtures and the tampering it labels as such).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const proof = readFileSync("supabase/tests/email_campaign_lifecycle.sql", "utf8");
// The proof without its SQL comments, so a phrase only in a comment never counts as an assertion.
const code = proof.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
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
    for (const [, domain] of proof.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+)/gi)) {
      expect(domain.toLowerCase().endsWith("tests.invalid")).toBe(true);
    }
  });

  it("plans exactly the assertions it makes", () => {
    const planned = Number(/SELECT plan\((\d+)\);/.exec(code)?.[1]);
    // Section 0 is one statement over two unnested arrays (roles × functions); count its rows.
    const section0 = /FROM unnest\(ARRAY\[([^\]]*)\]\) r,\s*unnest\(ARRAY\[([^\]]*)\]\) f;/.exec(code);
    expect(section0).not.toBeNull();
    const items = (list: string) => (list.match(/'[^']*'/g) ?? []).length; // quoted items; signatures hold commas
    const unnested = items(section0![1]) * items(section0![2]);
    const statements = (code.match(/^SELECT (is|isnt|ok|throws_ok)\(/gm) ?? []).length;
    expect(planned).toBe(statements - 1 + unnested);
  });

  it("covers every negative the email directive names", () => {
    for (const phrase of [
      "the saved draft reads back", "the second save kept what it did not name", "a member cannot approve", "another business's owner cannot approve",
      "no writer can change a frozen version's content", "an approval bound to other content is refused",
      "the stale version cannot be approved", "a generic approve of the queue row is refused",
      "approval with no signed-in person is refused", "an admin approves", "a cancelled campaign is never claimed again", "her repeat filing returns the same approval",
      "PAIGE cannot take over an approval the owner filed", "a decline from the approvals queue",
      "skipped at send, after approval", "an expired lease becomes outcome unknown",
      "a duplicate record of the same send is refused", "the leased recipient is refused at hand-off",
      "never planned again",
    ]) {
      expect(code.toLowerCase().replace(/''/g, "'")).toContain(phrase.toLowerCase());
    }
  });
});
