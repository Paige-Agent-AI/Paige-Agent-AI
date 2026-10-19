import { beforeEach, describe, expect, it, vi } from "vitest";

// Round 2 (verifier §58 #9, compliance #8): the /app owner chat used to key on the "admin" role only, so a
// super_admin / platform_admin without it, a coach, or an agency team member on /app?stay=1 was told
// "ask them to send you a new invitation". Staff standing is every signal resolveLandingRoute already reads.
type Answer = { data: unknown; error: unknown };
const answers: Record<string, Answer> = {};
const calls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(table);
      const chain = {
        select: () => chain, eq: () => chain, limit: () => chain,
        maybeSingle: async () => answers[table] ?? { data: null, error: null },
        then: (resolve: (v: Answer) => void) => resolve(answers[table] ?? { data: [], error: null }),
      };
      return chain;
    },
  },
}));
const { readPortalStaffStanding, clearPortalStaffStanding } = await import("./portalStaffStanding");

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  calls.length = 0;
  clearPortalStaffStanding();
});

describe("readPortalStaffStanding", () => {
  it.each(["admin", "super_admin", "platform_admin", "owner", "sales_rep", "broker"])("a %s role is staff", async (role) => {
    answers.user_roles = { data: [{ role }], error: null };
    expect(await readPortalStaffStanding(`u-${role}`)).toBe(true);
  });
  it.each([
    ["a tenant member", "tenant_members", { tenant_id: "t1" }],
    ["a tenant owner", "tenants", { id: "t1" }],
    ["an agency team member", "agency_team_members", { agency_tenant_id: "a1" }],
  ])("%s with no staff role is staff", async (_label, table, row) => {
    answers.user_roles = { data: [{ role: "client" }], error: null };
    answers[table as string] = { data: row, error: null };
    expect(await readPortalStaffStanding(`u-${table}`)).toBe(true);
  });
  it("a client with nothing else is not staff", async () => {
    answers.user_roles = { data: [{ role: "client" }], error: null };
    expect(await readPortalStaffStanding("u-client")).toBe(false);
  });
  it("an unreadable role list is unknown, never staff and never not-staff", async () => {
    answers.user_roles = { data: null, error: { message: "boom" } };
    expect(await readPortalStaffStanding("u-err")).toBeNull();
  });
  it("reads once per person", async () => {
    answers.user_roles = { data: [{ role: "client" }], error: null };
    await readPortalStaffStanding("u-once"); await readPortalStaffStanding("u-once");
    expect(calls.filter(t => t === "user_roles")).toHaveLength(1);
  });
});
