/* eslint-disable @typescript-eslint/no-explicit-any -- Executed edge helper, exercised with a mock DB. */
// @vitest-environment node
//
// The Funding & Coaching Tools Harness gate (owner ruling 2026-09-13). Ten finance/credit providers belong
// to ONE optional Marketplace package and must FAIL CLOSED — refuse before any provider contact — unless
// the server confirms (1) the tenant holds the package and (2) a Financial connection/consent is on file.
// This exercises the SHIPPED gate module (not a double): the pure decision matrix, the connection read
// point, and the async resolver's EXACT is_finance predicate (active install of an is_finance item OR the
// features.finance_in_scope flag), with fail-closed-on-error proven end to end.
import { describe, it, expect } from "vitest";
import {
  decideFundingCoachingGate,
  resolveFundingProviderConnectionState,
  resolveFundingCoachingGate,
  fundingGateAuditRow,
  recordFundingGateDecision,
  FUNDING_TOOLS_REMEDIATION_LIVE,
  type FundingGateDb,
  type FundingConnectionFact,
} from "../../supabase/functions/_shared/funding-coaching-gate.ts";

// ── A mock supabase-js surface: chainable/thenable reads + an insert capture. ───────────────────────────
type MockCfg = {
  installs?: Array<{ item_id: string }>;
  installsError?: boolean;
  financeItems?: Array<{ id: string }>;
  itemsError?: boolean;
  tenantFeatures?: unknown;
  tenantRowMissing?: boolean;
  tenantError?: boolean;
  inserts?: Array<Record<string, unknown>>;
  reads?: string[];
};

function mockDb(cfg: MockCfg): FundingGateDb {
  cfg.inserts ??= [];
  cfg.reads ??= [];
  const make = (table: string) => {
    const q: any = {
      select() { return q; },
      eq() { return q; },
      in() { return q; },
      limit() { return q; },
      maybeSingle() {
        cfg.reads!.push(table);
        if (table === "tenants") {
          if (cfg.tenantError) return Promise.resolve({ data: null, error: { message: "tenants_read_failed" } });
          if (cfg.tenantRowMissing) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: { features: cfg.tenantFeatures ?? {} }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Record<string, unknown>) {
        cfg.inserts!.push(row);
        return Promise.resolve({ error: null });
      },
      then(onF: any, onR: any) {
        cfg.reads!.push(table);
        let data: unknown = [];
        let error: unknown = null;
        if (table === "marketplace_installs") {
          if (cfg.installsError) error = { message: "installs_read_failed" };
          else data = cfg.installs ?? [];
        } else if (table === "marketplace_items") {
          if (cfg.itemsError) error = { message: "items_read_failed" };
          else data = cfg.financeItems ?? [];
        }
        return Promise.resolve({ data, error }).then(onF, onR);
      },
    };
    return q;
  };
  // E09 F1b: the resolver asks the database (`_tenant_finance_entitled`) instead of reading the tables
  // itself. This stands in for that function over the same configured rows: an active install of a
  // finance item, OR the flag read the way SQL's ::boolean reads it; any configured read error fails.
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    cfg.reads!.push(`rpc:${fn}`);
    if (fn !== "_tenant_finance_entitled" || typeof args?._tenant !== "string") {
      return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
    }
    if (cfg.installsError || cfg.itemsError || cfg.tenantError) {
      return Promise.resolve({ data: null, error: { message: "entitlement_read_failed" } });
    }
    const finance = new Set((cfg.financeItems ?? []).map((r) => r.id));
    const viaInstall = (cfg.installs ?? []).some((r) => finance.has(r.item_id));
    const flag = cfg.tenantRowMissing ? undefined : (cfg.tenantFeatures as Record<string, unknown> | undefined)?.finance_in_scope;
    const viaFlag = flag === true || (typeof flag === "string" && ["t", "true", "y", "yes", "on", "1"].includes(flag.trim().toLowerCase()));
    return Promise.resolve({ data: viaInstall || viaFlag, error: null });
  };
  return { from: (t: string) => make(t), rpc };
}

const connAbsent: FundingConnectionFact = { satisfied: false, missing: "connection" };

describe("decideFundingCoachingGate — the pure decision matrix (fail-closed, most-restrictive)", () => {
  // When the remediation surfaces are LIVE, a refusal names the action (install/connect). Codex #1222.
  it("remediationLive: not entitled → setup_required / entitlement_missing, 'install the package' (entitlement decided first)", () => {
    const v = decideFundingCoachingGate({ entitlement: "not_entitled", connection: { satisfied: true, via: "connection" }, remediationLive: true });
    expect(v.allowed).toBe(false);
    expect(v.result).toBe("setup_required");
    expect(v.state).toBe("entitlement_missing");
    expect(v.reason).toMatch(/Install the Funding & Coaching Tools/);
  });

  // DEFAULT (surfaces NOT live — the shipped state today): a refusal must resolve `unavailable`, never a
  // dead "install/connect" instruction the tenant cannot act on (Codex #1222 · owner: keep it UNAVAILABLE).
  it("default (surfaces not live): not entitled → unavailable / entitlement_missing, NO 'install' instruction", () => {
    const v = decideFundingCoachingGate({ entitlement: "not_entitled", connection: { satisfied: true, via: "connection" } });
    expect(v.allowed).toBe(false);
    expect(v.result).toBe("unavailable");
    expect(v.state).toBe("entitlement_missing"); // state preserved for the audit trail
    expect(v.reason).not.toMatch(/Install/);
    expect(v.reason).toMatch(/isn't available/);
  });

  it("an entitlement READ ERROR → unavailable / entitlement_missing (fail closed — never a silent allow, never 'install')", () => {
    // read_error is unavailable regardless of remediationLive.
    for (const remediationLive of [true, false]) {
      const v = decideFundingCoachingGate({ entitlement: "read_error", connection: { satisfied: true, via: "connection" }, remediationLive });
      expect(v.allowed).toBe(false);
      expect(v.result).toBe("unavailable");
      expect(v.state).toBe("entitlement_missing");
      expect(v.reason).not.toMatch(/Install the Funding/); // a read error must NOT tell the tenant to install
    }
  });

  it("remediationLive: entitled but connection ABSENT → setup_required / connection_missing", () => {
    const v = decideFundingCoachingGate({ entitlement: "entitled", connection: connAbsent, remediationLive: true });
    expect(v.allowed).toBe(false);
    expect(v.result).toBe("setup_required");
    expect(v.state).toBe("connection_missing");
    expect(v.reason).toMatch(/Connect your Financial data source/);
  });

  it("default (surfaces not live): entitled but connection ABSENT → unavailable / connection_missing, NO 'connect' instruction", () => {
    const v = decideFundingCoachingGate({ entitlement: "entitled", connection: connAbsent });
    expect(v.allowed).toBe(false);
    expect(v.result).toBe("unavailable");
    expect(v.state).toBe("connection_missing"); // diagnostic state preserved
    expect(v.reason).not.toMatch(/Connect/);
  });

  it("remediationLive: entitled but CONSENT missing → setup_required / consent_missing; default → unavailable / consent_missing", () => {
    const live = decideFundingCoachingGate({ entitlement: "entitled", connection: { satisfied: false, missing: "consent" }, remediationLive: true });
    expect(live.state).toBe("consent_missing");
    expect(live.result).toBe("setup_required");
    const def = decideFundingCoachingGate({ entitlement: "entitled", connection: { satisfied: false, missing: "consent" } });
    expect(def.state).toBe("consent_missing");
    expect(def.result).toBe("unavailable");
  });

  it("entitled + connection satisfied → ok / allowed (remediationLive irrelevant to an allow)", () => {
    for (const via of ["connection", "consent"] as const) {
      for (const remediationLive of [true, false]) {
        const v = decideFundingCoachingGate({ entitlement: "entitled", connection: { satisfied: true, via }, remediationLive });
        expect(v.allowed).toBe(true);
        expect(v.result).toBe("ok");
        expect(v.state).toBe("allowed");
      }
    }
  });

  it("authority: entitled + authorized:false → unavailable / not_authorized (belt-and-suspenders, when routed through the gate)", () => {
    const v = decideFundingCoachingGate({ entitlement: "entitled", connection: { satisfied: true, via: "connection" }, authorized: false });
    expect(v.allowed).toBe(false);
    expect(v.state).toBe("not_authorized");
    expect(v.result).toBe("unavailable");
    // authorized:true (or omitted) does NOT block an entitled+connected caller
    expect(decideFundingCoachingGate({ entitlement: "entitled", connection: { satisfied: true, via: "connection" }, authorized: true }).allowed).toBe(true);
  });

  it("entitlement is decided BEFORE connection and authority — a not_entitled caller never leaks which other fact is missing", () => {
    const v = decideFundingCoachingGate({ entitlement: "not_entitled", connection: connAbsent, authorized: false });
    expect(v.state).toBe("entitlement_missing");
  });
});

describe("resolveFundingProviderConnectionState — ABSENT for every wired provider today (no Financial model yet)", () => {
  it("returns a not-satisfied 'connection' requirement for all three providers", () => {
    for (const p of ["smartcredit", "nav", "business_verifier"] as const) {
      expect(resolveFundingProviderConnectionState("t1", p)).toEqual({ satisfied: false, missing: "connection" });
    }
  });
});

describe("resolveFundingCoachingGate — the async resolver reads the EXACT is_finance predicate, fail-closed", () => {
  const call = (cfg: MockCfg, over: Partial<{ tenantId: string | null; authorized: boolean }> = {}) =>
    resolveFundingCoachingGate(mockDb(cfg), { tenantId: "t1", providerKey: "smartcredit", ...over });

  it("no active is_finance install and no finance_in_scope flag → not_entitled → unavailable (shipped: remediation surfaces not live)", async () => {
    const v = await call({ installs: [], tenantFeatures: {} });
    expect(v.state).toBe("entitlement_missing");
    // The SHIPPED resolver passes FUNDING_TOOLS_REMEDIATION_LIVE (false today), so a refusal is the honest
    // `unavailable`, never a dead "install the package" instruction (Codex #1222 · owner ruling).
    expect(v.result).toBe("unavailable");
  });

  it("SHIPPED DEFAULT: the resolver never emits a `setup_required` remediation while the surfaces are not live", async () => {
    // The constant is the single deliberate switch; assert it is false so a future flip is caught by review.
    expect(FUNDING_TOOLS_REMEDIATION_LIVE).toBe(false);
    // Entitled-but-connection-absent (the universal case today) also resolves unavailable, not "connect".
    const entitled = await call({ installs: [], tenantFeatures: { finance_in_scope: true } });
    expect(entitled.state).toBe("connection_missing");
    expect(entitled.result).toBe("unavailable");
    expect(entitled.reason).not.toMatch(/Connect|Install/);
  });

  it("an ACTIVE install of an is_finance item → entitled (then connection absent → connection_missing)", async () => {
    const v = await call({ installs: [{ item_id: "i1" }], financeItems: [{ id: "i1" }] });
    expect(v.state).toBe("connection_missing"); // entitled, so it advances past the package gate
  });

  it("an active install whose item is NOT is_finance → not_entitled (falls through to the flag, which is unset)", async () => {
    const v = await call({ installs: [{ item_id: "i1" }], financeItems: [], tenantFeatures: {} });
    expect(v.state).toBe("entitlement_missing");
  });

  it("the features.finance_in_scope flag (boolean true AND string \"true\") → entitled", async () => {
    expect((await call({ installs: [], tenantFeatures: { finance_in_scope: true } })).state).toBe("connection_missing");
    expect((await call({ installs: [], tenantFeatures: { finance_in_scope: "true" } })).state).toBe("connection_missing");
    // a falsey flag stays not_entitled
    expect((await call({ installs: [], tenantFeatures: { finance_in_scope: false } })).state).toBe("entitlement_missing");
  });

  it("FAIL CLOSED: an entitlement read error (the database call fails) → read_error → unavailable", async () => {
    expect((await call({ installsError: true })).result).toBe("unavailable");
    expect((await call({ installs: [{ item_id: "i1" }], itemsError: true })).result).toBe("unavailable");
    expect((await call({ installs: [], tenantError: true })).result).toBe("unavailable");
  });

  it("FAIL CLOSED: a null / empty tenant is read_error → unavailable, with NO DB read attempted", async () => {
    const cfg: MockCfg = { installs: [], reads: [] };
    const v = await resolveFundingCoachingGate(mockDb(cfg), { tenantId: null, providerKey: "nav" });
    expect(v.result).toBe("unavailable");
    expect(v.state).toBe("entitlement_missing");
    expect(cfg.reads).toEqual([]); // never touched the DB
  });

  it("entitled + authorized:false is passed through to a not_authorized verdict", async () => {
    const v = await call({ installs: [], tenantFeatures: { finance_in_scope: true } }, { authorized: false });
    expect(v.state).toBe("not_authorized");
  });
});

describe("fundingGateAuditRow + recordFundingGateDecision — honest governed receipt on the existing channel", () => {
  const verdict = { allowed: false, result: "setup_required" as const, state: "entitlement_missing" as const, reason: "Install the Funding & Coaching Tools package to enable this." };

  it("shapes a paige_audit_log row that names the ENTITLEMENT gate (never the 'authority' label)", () => {
    const row = fundingGateAuditRow({
      actionPrefix: "smartcredit_pull", capability: "smartcredit_pull_snapshot", targetType: "smartcredit_snapshot",
      providerKey: "smartcredit", tenantId: "t1", subjectKind: "contact", subjectId: "c1",
      verdict, startedAtMs: Date.now(), nowIso: "2026-09-13T00:00:00.000Z",
    });
    expect(row.action).toBe("smartcredit_pull_funding_gate_refuse");
    expect(row.tenant_id).toBe("t1");
    expect(row.target_type).toBe("smartcredit_snapshot");
    expect(row.target_id).toBeNull();
    expect(row.payload.enforcement).toBe("funding_coaching_entitlement_gate");
    expect(row.payload.package).toBe("funding_and_coaching_tools");
    expect(row.payload.provider).toBe("smartcredit");
    expect(row.payload.gate_state).toBe("entitlement_missing");
    expect(row.payload.decision).toBe("refuse");
    expect((row.payload as any).contact_id).toBe("c1");
    expect(row.payload.tenant_source).toBe("server");
  });

  it("an ALLOW verdict names the row _funding_gate_allow", () => {
    const row = fundingGateAuditRow({
      actionPrefix: "business_verify", capability: "business_verify", targetType: "business_verify",
      providerKey: "business_verifier", tenantId: "t2", subjectKind: "business", subjectId: "b1",
      verdict: { allowed: true, result: "ok", state: "allowed", reason: "" }, startedAtMs: Date.now(), nowIso: "2026-09-13T00:00:00.000Z",
    });
    expect(row.action).toBe("business_verify_funding_gate_allow");
    expect((row.payload as any).business_id).toBe("b1");
  });

  it("records the decision on paige_audit_log with actor_user_id + actor_role, non-fatally", async () => {
    const cfg: MockCfg = { inserts: [] };
    const row = fundingGateAuditRow({
      actionPrefix: "nav_pull", capability: "nav_pull_business_credit", targetType: "business_credit_profile",
      providerKey: "nav", tenantId: "t1", subjectKind: "contact", subjectId: "c1",
      verdict, startedAtMs: Date.now(), nowIso: "2026-09-13T00:00:00.000Z",
    });
    await recordFundingGateDecision(mockDb(cfg), { actorUserId: "u1", actorRole: "nav_pull:person", row });
    expect(cfg.inserts).toHaveLength(1);
    expect(cfg.inserts![0].actor_user_id).toBe("u1");
    expect(cfg.inserts![0].actor_role).toBe("nav_pull:person");
    expect(cfg.inserts![0].action).toBe("nav_pull_funding_gate_refuse");
  });
});
