import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyVoiceReadiness,
  hasTenantVoiceAuthority,
  type VoiceReadiness,
} from "../../../supabase/functions/voice-access-token/authorization";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// Type-level narrowing helper for the not-ok arm of the readiness union.
// Structural ("message" in) — truthiness on v.ok does not narrow under the
// non-strict app tsconfig, where the discriminant widens to boolean.
type NotOkVoiceReadiness = Extract<VoiceReadiness, { ok: false }>;
const notOk = (v: VoiceReadiness): NotOkVoiceReadiness => {
  if (!("message" in v)) throw new Error("expected a not-ready verdict");
  return v as NotOkVoiceReadiness;
};

// ── INT-345 failure-first fixtures ─────────────────────────────────────────────
// Synthetic, identifier-free fixtures reproducing the three generic production
// dialer states observed on structurally equivalent Solo workspaces. No real
// tenant ids, names, or phone numbers appear here or in the copies under test.
const ACTIVE_SUB = { id: "sub-a", active: true, status: "active" };
const QUALIFIED_PRIMARY = [{
  subaccount_id: "sub-a",
  twilio_sid: "PN-synthetic-1",
  capabilities: { voice: true },
}];

describe("tenant Voice authorization", () => {
  it("denies a global role or membership from another tenant", () => {
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: false,
      membershipTenantId: "tenant-a",
      activeTenantId: "tenant-b",
      membershipStatus: "active",
      membershipRole: "admin",
    })).toBe(false);
  });

  it.each(["owner", "admin"])("allows active %s authority in the resolved tenant", (role) => {
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: false,
      membershipTenantId: "tenant-a",
      activeTenantId: "tenant-a",
      membershipStatus: "active",
      membershipRole: role,
    })).toBe(true);
  });

  it("fails closed with actionable readiness states", () => {
    expect(notOk(classifyVoiceReadiness(null, null))).toMatchObject({ ok: false, code: "calling_not_configured" });
    expect(classifyVoiceReadiness(
      { id: "sub-a", active: true, status: "active" },
      [{ subaccount_id: "sub-b", twilio_sid: "PN", capabilities: { voice: true } }],
    )).toMatchObject({ ok: false, code: "calling_number_needs_verification" });
    expect(classifyVoiceReadiness(
      { id: "sub-a", active: true, status: "active" },
      [{ subaccount_id: "sub-a", twilio_sid: "PN", capabilities: { voice: true } }],
    )).toEqual({ ok: true });
  });
});

describe("INT-345 voice readiness fixtures (generic states, no identifiers)", () => {
  it("Fixture A — READY: active subaccount + exactly one qualified primary", () => {
    expect(classifyVoiceReadiness(ACTIVE_SUB, QUALIFIED_PRIMARY)).toEqual({ ok: true });
  });

  it("Fixture C — NOT CONFIGURED: no active canonical subaccount row", () => {
    expect(notOk(classifyVoiceReadiness(null, null))).toMatchObject({
      ok: false,
      code: "calling_not_configured",
    });
    expect(notOk(classifyVoiceReadiness({ id: "sub-a", active: false, status: "pending" }, null)))
      .toMatchObject({ ok: false, code: "calling_not_configured" });
    expect(notOk(classifyVoiceReadiness({ id: "sub-a", active: true, status: "suspended" }, null)))
      .toMatchObject({ ok: false, code: "calling_not_configured" });
  });

  it("Fixture B1 — active subaccount, zero active primary numbers", () => {
    const verdict = notOk(classifyVoiceReadiness(ACTIVE_SUB, []));
    expect(verdict).toMatchObject({
      ok: false,
      code: "calling_number_needs_verification",
      reason_code: "no_active_primary_number",
    });
    expect(verdict.message).toContain("Settings");
  });

  it("Fixture B2 — more than one active primary", () => {
    const verdict = notOk(classifyVoiceReadiness(ACTIVE_SUB, [
      { ...QUALIFIED_PRIMARY[0], twilio_sid: "PN-synthetic-1" },
      { ...QUALIFIED_PRIMARY[0], twilio_sid: "PN-synthetic-2" },
    ]));
    expect(verdict).toMatchObject({
      ok: false,
      reason_code: "multiple_active_primary_numbers",
    });
    // Unreachable in practice (per-tenant partial unique index) — the honest
    // remedy is a platform-side data correction, never a self-service control.
    expect(verdict.message).toContain("support");
  });

  it("Fixture B3 — primary bound to a different subaccount", () => {
    const verdict = notOk(classifyVoiceReadiness(ACTIVE_SUB, [{
      subaccount_id: "sub-other",
      twilio_sid: "PN-synthetic-1",
      capabilities: { voice: true },
    }]));
    expect(verdict).toMatchObject({
      ok: false,
      reason_code: "primary_number_under_different_subaccount",
    });
  });

  it("Fixture B4 — primary missing its provider binding (SID)", () => {
    const verdict = notOk(classifyVoiceReadiness(ACTIVE_SUB, [{
      subaccount_id: "sub-a",
      twilio_sid: null,
      capabilities: { voice: true },
    }]));
    expect(verdict).toMatchObject({
      ok: false,
      reason_code: "primary_number_missing_provider_binding",
    });
  });

  it("Fixture B5 — primary without confirmed voice capability", () => {
    const verdict = notOk(classifyVoiceReadiness(ACTIVE_SUB, [{
      subaccount_id: "sub-a",
      twilio_sid: "PN-synthetic-1",
      capabilities: { voice: false },
    }]));
    expect(verdict).toMatchObject({
      ok: false,
      reason_code: "primary_number_voice_capability_unconfirmed",
    });
    expect(verdict.message).toContain("Settings");
  });

  it("every needs_verification state is distinguishable — five reason codes, no collapse", () => {
    const codes = new Set([
      notOk(classifyVoiceReadiness(ACTIVE_SUB, [])).reason_code,
      notOk(classifyVoiceReadiness(ACTIVE_SUB, [QUALIFIED_PRIMARY[0], { ...QUALIFIED_PRIMARY[0], twilio_sid: "PN2" }])).reason_code,
      notOk(classifyVoiceReadiness(ACTIVE_SUB, [{ ...QUALIFIED_PRIMARY[0], subaccount_id: "sub-other" }])).reason_code,
      notOk(classifyVoiceReadiness(ACTIVE_SUB, [{ ...QUALIFIED_PRIMARY[0], twilio_sid: null }])).reason_code,
      notOk(classifyVoiceReadiness(ACTIVE_SUB, [{ ...QUALIFIED_PRIMARY[0], capabilities: { voice: false } }])).reason_code,
    ]);
    expect(codes).toEqual(new Set([
      "no_active_primary_number",
      "multiple_active_primary_numbers",
      "primary_number_under_different_subaccount",
      "primary_number_missing_provider_binding",
      "primary_number_voice_capability_unconfirmed",
    ]));
  });
});

describe("INT-345 platform standing never widens another workspace's provider config", () => {
  it("authority and readiness are independent gates — owner standing passes authority yet readiness still fails closed on the acting tenant's rows", () => {
    // A platform owner acting inside an unconfigured workspace passes the AUTHORITY
    // gate (they may mint) but the READINESS gate is derived only from that
    // workspace's own provider rows — still calling_not_configured.
    expect(hasTenantVoiceAuthority({
      isPlatformOwner: true,
      membershipTenantId: null,
      activeTenantId: "tenant-b",
      membershipStatus: null,
      membershipRole: null,
    })).toBe(true);
    expect(notOk(classifyVoiceReadiness(null, null)).code).toBe("calling_not_configured");
  });

  it("pins the edge composition: readiness inputs are scoped to the JWT-resolved tenant and never consult caller standing", () => {
    const src = read("supabase/functions/voice-access-token/index.ts");
    const subQuery = src.indexOf('from("tenant_twilio_subaccounts")');
    const numQuery = src.indexOf('from("tenant_phone_numbers")');
    expect(subQuery).toBeGreaterThan(-1);
    expect(numQuery).toBeGreaterThan(-1);
    // Both readiness queries are scoped by the JWT-derived tenantId (never a body value).
    const classifyCallAt = src.indexOf("classifyVoiceReadiness(subaccount", numQuery);
    expect(classifyCallAt).toBeGreaterThan(-1);
    const between = (from: number, to: number) => src.slice(from, to);
    expect(between(subQuery, numQuery)).toContain('.eq("tenant_id", tenantId)');
    expect(between(numQuery, classifyCallAt)).toContain('.eq("tenant_id", tenantId)');
    // classifyVoiceReadiness receives no caller-standing input — its verdict cannot
    // depend on isPlatformOwner.
    const classifyCall = src.slice(src.indexOf("classifyVoiceReadiness("), src.indexOf("classifyVoiceReadiness(") + 80);
    expect(classifyCall).not.toContain("isOwner");
  });
});
