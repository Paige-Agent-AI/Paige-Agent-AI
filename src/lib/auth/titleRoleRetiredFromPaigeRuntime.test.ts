// The retired title role grants nothing in Paige chat, the Paige runtime and the business-seat CRM
// paths. A person holding the platform-wide `coach` role, or a `coach` seat in a business, is not
// owner-ops eligible, is not an operator in chat, cannot file improvement proposals, delegate to or
// create specialists, propose outbound messages, run CRM commands, list users, get staff support
// tier, or write another person's record through write-back.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeWriteBackTarget } from "../../../supabase/functions/_shared/paige-write-back/governed-adapter";

const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

// Gates only. Seat and label values that are data, not authority, are named and excluded below.
const FILES = [
  "supabase/functions/paige-ai-chat/index.ts",
  "supabase/functions/_shared/paige-capability-status/gatherer.ts",
  "supabase/functions/_shared/paige-write-back/governed-adapter.ts",
  "supabase/functions/paige-write-back/index.ts",
  "supabase/functions/crm-command/index.ts",
  "supabase/functions/send-support-request/index.ts",
  "supabase/functions/admin-list-users/index.ts",
  "supabase/functions/paige-context-router/index.ts",
  "supabase/functions/skill-runner/index.ts",
];

const ROLE_READ = /includes\(\s*["']coach["']\s*\)|===?\s*["']coach["']|\[[^\]]*["']coach["'][^\]]*\]\.includes|\bisCoach\b|\bcoachAssigned\b|:\s*["']coach["'],?\s*$|priority = \[[^\]]*["']coach["']/;

// Data values, not authority: the contact-assignment seat named "coach" (a grant path, slice 3), the
// team-invite and seat-grant role enums (slice 3), the skill-run label a caller sends, and the
// context lens value.
const EXEMPT = [
  /enum: \["admin", "coach", "sales_rep", "broker", "cs_rep", "finance", "viewer"\]/,
  /enum: \["coach", "owner", "sales_rep", "cs"\]/,
  /p_role: args\.role \?\? "coach"/,
  /invoker_kind\?: "admin" \| "coach"/,
  /p_lens: body\.self \? "client" : "coach"/,
];

describe("the retired coach role grants nothing in Paige chat, runtime and seat CRM", () => {
  it("is read by none of the gates", () => {
    const offenders = FILES.flatMap((path) =>
      read(path)
        .split("\n")
        .map((line, i) => ({ line, at: `${path}:${i + 1}` }))
        .filter(({ line }) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .filter(({ line }) => ROLE_READ.test(line) && !EXEMPT.some((re) => re.test(line)))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it("does not let a coach seat write another person's record, even with an assignment", async () => {
    const verdict = await authorizeWriteBackTarget(
      {
        isPlatformOwner: async () => false,
        callerActiveTenant: async () => "tenant-A",
        callerRoleInTenant: async () => "coach",
        callerManagesTenantViaAgency: async () => false,
        resolveTargetTenant: async () => "tenant-A",
        targetSharesTenant: async () => true,
        coachAssigned: async () => true,
      } as Parameters<typeof authorizeWriteBackTarget>[0],
      { callerUserId: "seat-A", targetUserId: "client-A" },
    );
    expect(verdict.allowed).toBe(false);
  });
});
