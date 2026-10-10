// INT-345 K-3 — the ONE provisioning core, unit-proved at the seams.
// Only _shared/twilio.ts (the provider seam) and the admin client are stubbed;
// the core's own logic — idempotency, adopt, dry-run, per-step failure
// reporting, the explicit-tenant INSERT — runs for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const twilio = vi.hoisted(() => ({
  masterCreds: vi.fn(() => ({ accountSid: "ACmaster", authToken: "x", apiKeySid: "SKmaster" })),
  createSubaccount: vi.fn(async () => ({ ok: true, data: { sid: "ACnew0000000000000000000000001", status: "active" } })),
  createSubaccountApiKey: vi.fn(async () => ({ ok: true, data: { sid: "SKsub000000000000000001", secret: "vault-me" } })),
  ensureTwimlApp: vi.fn(async () => ({ ok: true, data: { applicationSid: "APapp0000000000000000000001", created: true } })),
}));

vi.mock("../../supabase/functions/_shared/twilio.ts", () => twilio);

import { provisionTenantTwilio } from "../../supabase/functions/_shared/twilio-provision";

type Chain = { select: () => Chain; eq: () => Chain; maybeSingle: () => Promise<{ data: unknown; error: null }> };

function adminStub(overrides?: {
  existingRow?: unknown;
  insertError?: { code?: string; message: string } | null;
  vaultError?: unknown;
  providerAllowed?: unknown;
  boundaryError?: unknown;
}) {
  const calls = { insert: [] as unknown[], vault: [] as unknown[] };
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: overrides?.existingRow ?? null, error: null }),
  };
  const admin = {
    from: (table: string) => {
      if (table === "tenant_twilio_subaccounts") {
        return {
          ...chain,
          insert: async (row: unknown) => {
            calls.insert.push(row);
            return { error: overrides?.insertError ?? null };
          },
        };
      }
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      if (fn === "comms_provider_execution_allowed") {
        return { data: overrides && "providerAllowed" in overrides ? overrides.providerAllowed : true, error: overrides?.boundaryError ?? null };
      }
      if (fn === "write_channel_secret") {
        calls.vault.push(args);
        if (overrides?.vaultError) return { data: null, error: overrides.vaultError };
        const a = args as { _ref: string };
        return { data: a._ref, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { admin: admin as unknown as Parameters<typeof provisionTenantTwilio>[0], calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  twilio.masterCreds.mockReturnValue({ accountSid: "ACmaster", authToken: "x", apiKeySid: "SKmaster" });
});

describe("provisionTenantTwilio — the one core (INT-345 K-3)", () => {
  it.each([
    { providerAllowed: false },
    { providerAllowed: null },
    { providerAllowed: "true" },
    { providerAllowed: true, boundaryError: { message: "unavailable" } },
  ])("refuses restricted or unavailable boundary before any provider/Vault work: %j", async overrides => {
    const { admin, calls } = adminStub(overrides);
    const r = await provisionTenantTwilio(admin, { tenantId: "synthetic", tenantName: "QA" });
    expect(r.outcome).toBe("failed");
    expect(r.error).toBe("COMMS_PROVIDER_EXECUTION_DISABLED");
    expect(twilio.masterCreds).not.toHaveBeenCalled();
    expect(twilio.createSubaccount).not.toHaveBeenCalled();
    expect(twilio.createSubaccountApiKey).not.toHaveBeenCalled();
    expect(twilio.ensureTwimlApp).not.toHaveBeenCalled();
    expect(calls.insert).toHaveLength(0);
    expect(calls.vault).toHaveLength(0);
  });

  it("skips a tenant that already has a row — no provider call, no write", async () => {
    const { admin, calls } = adminStub({ existingRow: { twilio_subaccount_sid: "ACexisting", api_key_sid: "SKx", twiml_app_sid: "APx" } });
    const r = await provisionTenantTwilio(admin, { tenantId: "t-1", tenantName: "One" });
    expect(r.outcome).toBe("skipped_existing");
    expect(twilio.createSubaccount).not.toHaveBeenCalled();
    expect(calls.insert).toHaveLength(0);
    expect(r.subaccount_sid).toBe("ACexisting");
    expect(r.steps.map((s) => `${s.step}:${s.status}`)).toContain("row:skipped");
  });

  it("dry-run reports the plan and touches nothing", async () => {
    const { admin, calls } = adminStub();
    const r = await provisionTenantTwilio(admin, { tenantId: "t-2", tenantName: "Two", dryRun: true });
    expect(r.outcome).toBe("would_provision");
    expect(twilio.createSubaccount).not.toHaveBeenCalled();
    expect(calls.insert).toHaveLength(0);
    expect(calls.vault).toHaveLength(0);
    expect(r.steps.every((s) => s.status === "planned")).toBe(true);
  });

  it("master creds absent → blocked_needs_config, nothing attempted", async () => {
    twilio.masterCreds.mockReturnValue(null);
    const { admin } = adminStub();
    const r = await provisionTenantTwilio(admin, { tenantId: "t-3", tenantName: null });
    expect(r.outcome).toBe("blocked_needs_config");
    expect(twilio.createSubaccount).not.toHaveBeenCalled();
  });

  it("provisions: adopt-or-create → key → vault → row (explicit tenant) → TwiML app", async () => {
    const { admin, calls } = adminStub();
    const r = await provisionTenantTwilio(admin, { tenantId: "t-4", tenantName: "Four" });
    expect(r.outcome).toBe("provisioned");
    expect(twilio.createSubaccount).toHaveBeenCalledWith("Paige — Four");
    expect(calls.vault[0]).toMatchObject({ _ref: "twilio_subaccount_api_key_secret:t-4", _secret: "vault-me" });
    const inserted = calls.insert[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ tenant_id: "t-4", twilio_subaccount_sid: "ACnew0000000000000000000000001", api_key_sid: "SKsub000000000000000001", status: "active" });
    // inbound_webhook_secret deliberately NOT supplied — the DB default owns it.
    expect("inbound_webhook_secret" in inserted).toBe(false);
    expect(twilio.ensureTwimlApp).toHaveBeenCalledWith(
      admin,
      "t-4",
      expect.objectContaining({ creds: { accountSid: "ACnew0000000000000000000000001", authToken: "vault-me", apiKeySid: "SKsub000000000000000001" } }),
    );
    expect(r.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("adopt mints a key on the existing SID and never creates a subaccount", async () => {
    const { admin } = adminStub();
    const r = await provisionTenantTwilio(admin, { tenantId: "t-5", tenantName: null, adoptSid: "ACadopt0000000000000000000001" });
    expect(r.outcome).toBe("adopted");
    expect(twilio.createSubaccount).not.toHaveBeenCalled();
    expect(twilio.createSubaccountApiKey).toHaveBeenCalledWith("ACadopt0000000000000000000001");
  });

  it("a vault write failure fails AT that step and reports the real SID for reconciliation", async () => {
    const { admin } = adminStub({ vaultError: { message: "boom" } });
    const r = await provisionTenantTwilio(admin, { tenantId: "t-6", tenantName: "Six" });
    expect(r.outcome).toBe("failed");
    expect(r.steps.find((s) => s.step === "vault")?.status).toBe("failed");
    expect(r.subaccount_sid).toBe("ACnew0000000000000000000000001");
    expect(String(r.error)).toContain("vault_write_failed");
  });

  it("a 23505 insert race degrades to skipped_existing (idempotent)", async () => {
    const { admin } = adminStub({ insertError: { code: "23505", message: "duplicate" } });
    const r = await provisionTenantTwilio(admin, { tenantId: "t-7", tenantName: "Seven" });
    expect(r.outcome).toBe("skipped_existing");
  });
});
