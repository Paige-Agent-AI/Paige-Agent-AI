import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * §65 — the agency landing route.
 *
 * WHY THIS FILE EXISTS (§39): the bug it guards is invisible to every other
 * check. `resolveAgencyLanding` returning bare `/agency` instead of the numeric
 * URL type-checks, builds, lints, and renders — it just silently drops an agency
 * owner on the LEGACY board forever. A green pipeline proves nothing about it.
 * These cases drive the real resolver end-to-end against a mocked client, so a
 * regression fails here instead of in the owner's browser.
 *
 * The two properties worth protecting:
 *   1. §13 — a missing/garbage account number NEVER builds a URL from it. The
 *      fallback is the pre-change bare `/agency`, never `/agency/null/…`.
 *   2. §39 — the canary is honored. `/admin` Gate A gates the URL-driven shell on
 *      `agency_shell_enabled`, but `AgencyEntry` does NOT (a numeric segment goes
 *      straight to AgencyApp), so login must apply that gate itself or the two
 *      entry points disagree for the next agency provisioned.
 */

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));

const { resolveLandingRoute } = await import("./resolveLandingRoute");

/**
 * A signed-in user carrying the `admin` role and nothing else that redirects.
 *
 * `agencyVisible` models the §58 shell-visibility check: the RLS-gated `tenants`
 * read returns the agency row for a normal owner (a `tenant_members` row exists),
 * and NOTHING for a rail-only agency-team member — who is a manager to the RPC but
 * invisible to `AgencyApp`'s identity resolution.
 */
function mockTables(
  opts: {
    agencyLoginDefault?: string | null;
    agencyVisible?: boolean;
    tenantsError?: boolean;
    rolesError?: boolean;
    rolesThrow?: boolean;
    roles?: string[];
  } = {},
) {
  const agencyVisible = opts.agencyVisible ?? true;
  from.mockImplementation((table: string) => {
    const one = (data: unknown) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error: null }),
          limit: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }),
          eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) }),
        }),
      }),
    });
    if (table === "user_roles") {
      const roles = (opts.roles ?? ["admin"]).map((role) => ({ role }));
      return {
        select: () => ({
          eq: () => opts.rolesThrow
            ? Promise.reject(new Error("role transport failed"))
            : Promise.resolve({ data: roles, error: opts.rolesError ? { message: "role read failed" } : null }),
        }),
      };
    }
    if (table === "profiles") {
      return one({ agency_login_default: opts.agencyLoginDefault ?? "agency" });
    }
    if (table === "tenants") {
      // The §58 visibility probe (`.select("id").eq("id", …).maybeSingle()`) and the
      // pre-existing owned-tenant lookup both hit this table. `tenantsError` models a
      // transient failure, which must NOT demote (§13).
      if (opts.tenantsError) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }),
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
            }),
          }),
        };
      }
      return one(agencyVisible ? { id: AGENCY_ID } : null);
    }
    return one(null); // clients / tenant_members / agency_team_members
  });
}

/** The caller's operator tier, as the one server answer (`operator_standing()`) reports it. */
let tier: string | null = null;
/** What `agency_switch_context()` hands back. */
let ctx: Record<string, unknown> | null = null;
/** Answer the two RPCs the resolver makes. */
function answerRpcs() {
  rpc.mockImplementation((name: string) =>
    name === "operator_standing"
      ? Promise.resolve({ data: [{ tier, active_tenant_id: null }], error: null })
      : name === "agency_switch_context"
        ? Promise.resolve({ data: ctx, error: null })
        : Promise.resolve({ data: null, error: null }),
  );
}
function mockCtx(next: Record<string, unknown> | null) {
  ctx = next;
  answerRpcs();
}

const AGENCY_ID = "2de8ca80-0000-4000-8000-000000000000";
const MANAGER = {
  is_agency_manager: true,
  agency_id: AGENCY_ID,
  agency_shell_enabled: true,
  agency_account_number: 1924546,
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  tier = null;
  ctx = null;
  answerRpcs();
  mockTables();
});

describe("resolveLandingRoute — agency landing (§65)", () => {
  it("sends an eligible manager to their REAL numeric URL, not the legacy board", async () => {
    mockCtx(MANAGER);
    expect(await resolveLandingRoute("u1")).toBe("/agency/1924546/command-center");
  });

  it("normalizes an account number arriving as a jsonb string", async () => {
    mockCtx({ ...MANAGER, agency_account_number: "1924546" });
    expect(await resolveLandingRoute("u1")).toBe("/agency/1924546/command-center");
  });

  // §39 — the case above passes the GUARD only because of the Number() coercion,
  // but it cannot prove the URL carries the COERCED value: "1924546" interpolates
  // byte-identically to 1924546. These two can only pass if the number that reaches
  // the template is the normalized one, so a regression that guards on Number() and
  // then interpolates the raw field still fails here.
  for (const [label, raw, expected] of [
    ["exponent notation", "1e6", 1000000],
    ["leading whitespace", " 1924546", 1924546],
  ] as const) {
    it(`interpolates the COERCED number, not the raw field (${label})`, async () => {
      mockCtx({ ...MANAGER, agency_account_number: raw });
      const route = await resolveLandingRoute("u1");
      expect(route).toBe(`/agency/${expected}/command-center`);
      expect(route).not.toContain(raw);
    });
  }

  // §13 — never construct a URL from a value we don't have.
  for (const [label, value] of [
    ["absent (migration not deployed yet)", undefined],
    ["explicitly null", null],
    ["garbage", "not-a-number"],
    ["zero", 0],
  ] as const) {
    it(`falls back to bare /agency when the account number is ${label}`, async () => {
      mockCtx({ ...MANAGER, agency_account_number: value });
      const route = await resolveLandingRoute("u1");
      expect(route).toBe("/agency");
      expect(route).not.toContain("null");
      expect(route).not.toContain("undefined");
      expect(route).not.toContain("NaN");
    });
  }

  // §39 — the canary must gate login exactly as it gates /admin Gate A.
  it("does NOT hand over the new shell when agency_shell_enabled is false", async () => {
    mockCtx({ ...MANAGER, agency_shell_enabled: false });
    expect(await resolveLandingRoute("u1")).toBe("/agency");
  });

  it("treats a missing agency_shell_enabled as OFF (strict === true)", async () => {
    mockCtx({ is_agency_manager: true, agency_account_number: 1924546 });
    expect(await resolveLandingRoute("u1")).toBe("/agency");
  });

  // §58 — a RAIL-ONLY agency-team member is a manager to the RPC but invisible to
  // AgencyApp (which resolves identity from the RLS-gated `tenants` read, and
  // `is_tenant_member` consults ONLY `tenant_members`, never the rail). Handing them
  // the numeric URL yields a shell with no identity — or, if they own a DIFFERENT
  // agency, silently bounces them onto it. They belong on the legacy board.
  it("keeps a rail-only agency-team member on the legacy /agency board", async () => {
    mockCtx(MANAGER);
    mockTables({ agencyVisible: false });
    expect(await resolveLandingRoute("u1")).toBe("/agency");
  });

  // §13 — a transient failure of that probe must NOT strand every agency owner on the
  // legacy board. Only a definitive "not visible" demotes.
  it("does NOT demote on a visibility-probe error (fails open to the new shell)", async () => {
    mockCtx(MANAGER);
    mockTables({ tenantsError: true });
    expect(await resolveLandingRoute("u1")).toBe("/agency/1924546/command-center");
  });

  // Pre-existing branches that must keep working (§58).
  it("honors the 'last_account' preference by falling through to /admin", async () => {
    mockCtx(MANAGER);
    mockTables({ agencyLoginDefault: "last_account" });
    expect(await resolveLandingRoute("u1")).toBe("/choose-account");
  });

  it("falls through to /admin when the caller is not an agency manager", async () => {
    mockCtx({ is_agency_manager: false, agency_account_number: null });
    expect(await resolveLandingRoute("u1")).toBe("/choose-account");
  });

  it("falls through to /admin when the RPC throws", async () => {
    rpc.mockImplementation((name: string) =>
      name === "operator_standing"
        ? Promise.resolve({ data: [{ tier: null, active_tenant_id: null }], error: null })
        : Promise.reject(new Error("boom")),
    );
    expect(await resolveLandingRoute("u1")).toBe("/choose-account");
  });

  // §53 + owner ruling 2026-09-07 — BOTH operator tiers pause at the chooser.
  //
  // A `platform_admin` holds no tenant membership, owns no tenant and has no client
  // row BY DESIGN, so every later branch of this resolver declines them and they
  // reach the "no role, no tenant, hasn't paid" fallback — which sends the platform's
  // own delegated operator to `/pricing`. `OperatorLogin` had papered over this at
  // its own door while naming the cause in a comment; the other entrances (the
  // ordinary `/auth` sign-in, the landing header) route through here and had no
  // such workaround.
  // Naming note (§13): against the pre-fix resolver this case returns `/admin`,
  // because the shared mock gives every user a tenant. The OWNER's real account has
  // no tenant at all — by design for this tier — so in production the same missing
  // branch carried him past every check to the `/pricing` fallback. Same root cause,
  // different landing depending on whether a tenant exists; the assertion is now
  // that an operator reaches the chooser and no context is silently selected.
  it("pauses a platform_admin at the chooser, not a tenant surface", async () => {
    mockTables({ roles: ["platform_admin"] });
    tier = "platform_admin";
    await expect(resolveLandingRoute("u-operator")).resolves.toBe("/choose-account");
  });

  it("also pauses a super_admin at the chooser", async () => {
    mockTables({ roles: ["super_admin"] });
    tier = "super_admin";
    await expect(resolveLandingRoute("u-god")).resolves.toBe("/choose-account");
  });

  // The operator tier forces deliberate choice even when the same person also holds
  // a tenant role: the Platform and tenant contexts are different §9 audiences.
  it("requires the chooser when a platform_admin also carries a tenant role", async () => {
    mockTables({ roles: ["admin", "platform_admin"] });
    tier = "platform_admin";
    await expect(resolveLandingRoute("u-both")).resolves.toBe("/choose-account");
  });

  it("fails closed to a retryable auth door when operator standing cannot be read", async () => {
    rpc.mockImplementation((name: string) =>
      name === "operator_standing"
        ? Promise.resolve({ data: null, error: { message: "network" } })
        : Promise.resolve({ data: null, error: null }),
    );
    await expect(resolveLandingRoute("u-standing-unknown")).resolves.toBe("/auth?mode=login&route=retry");
  });

  it("fails closed to a retryable auth door when role authority cannot be read", async () => {
    mockTables({ rolesError: true });
    await expect(resolveLandingRoute("u-unknown")).resolves.toBe("/auth?mode=login&route=retry");
  });

  it("fails closed to a retryable auth door when role resolution throws", async () => {
    mockTables({ rolesThrow: true });
    await expect(resolveLandingRoute("u-transport-error")).resolves.toBe("/auth?mode=login&route=retry");
  });
});
