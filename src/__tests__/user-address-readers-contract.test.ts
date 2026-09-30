// The RAG ingest, the security canary and the funding report read a person's address from
// user_contact_methods through the one shared read, and not from profiles, which has no email
// column (every such read failed with 42703). Their behaviour is proved in
// supabase/functions/_shared/user-contact-methods.test.ts and supabase/tests/user_address_readers.sql;
// this pins the wiring so the wrong read cannot come back in any of the three.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const code = (p: string) =>
  read(p).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

const FUNCTIONS = [
  "supabase/functions/ingest-rag-outcome/index.ts",
  "supabase/functions/security-canary-probe/index.ts",
  "supabase/functions/send-funding-report/index.ts",
];

// A profiles select naming an email column, or an `.email` read off a profile row.
const PROFILES_EMAIL =
  /from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?select\(\s*["'`][^"'`]*(?<!work_)\bemail\b|\bprofiles?\??\.email\b/;

describe("a user's address comes from user_contact_methods", () => {
  for (const f of FUNCTIONS) {
    it(`${f} reads it through the shared read, never from profiles`, () => {
      const src = code(f);
      expect(src).toMatch(/from "\.\.\/_shared\/user-contact-methods\.ts"/);
      expect(src).not.toMatch(PROFILES_EMAIL);
    });
  }

  it("the canary emails platform operators only, with a role list the enum accepts", () => {
    const src = code("supabase/functions/security-canary-probe/index.ts");
    expect(src).toMatch(/\.in\("role", \["super_admin", "platform_admin"\]\)/);
    expect(src).not.toMatch(/["']owner["']/);
  });

  it("the funding report goes to its owner's primary address, never one named in the request", () => {
    const src = code("supabase/functions/send-funding-report/index.ts");
    expect(src).toMatch(/recipientEmail = await primaryEmailForUser\(supabase, userId\)/);
    expect(src).not.toMatch(/\bemail\s*\|\|/);
    for (const caller of [
      "supabase/functions/schedule-automated-tasks/index.ts",
      "supabase/functions/voice-command-processor/index.ts",
    ]) {
      expect(code(caller)).not.toMatch(/email:\s*params\.email/);
    }
  });
});
