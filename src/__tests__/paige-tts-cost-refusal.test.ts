// INT-321 — a refused voice-cost reservation reaches the owner as the state that actually refused it.
// Server half: supabase/functions/_shared/voice-cost-refusal.ts. Client half: src/lib/voice/messageTtsFailure.ts.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyVoiceCostRefusal,
  classifyVoiceProfileFailure,
  parseVoiceCostResetAt,
  voiceCostRefusalBody,
} from "../../supabase/functions/_shared/voice-cost-refusal.ts";
import { classifyTtsFailure } from "@/lib/voice/messageTtsFailure";

// The shape PostgREST returns for `RAISE EXCEPTION '<identity>' USING ERRCODE = …, DETAIL = …`.
const pgError = (message: string, code: string, details: string | null = null) => ({ message, code, details, hint: null });
const detail = (budgetMonth: string, resetsAt: string) => JSON.stringify({ budget_month: budgetMonth, resets_at: resetsAt });

describe("INT-321 reservation refusal → stable TTS code (server)", () => {
  it("1/4: the tenant allowance identity maps to tts_tenant_cost_limit with the proven reset instant", () => {
    const r = classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000", detail("2026-10-01", "2026-11-01T00:00:00Z")));
    expect(r).toEqual({ code: "tts_tenant_cost_limit", status: 429, resetAt: "2026-11-01T00:00:00Z", identity: "PAIGE_VOICE_TENANT_COST_LIMIT" });
  });

  it("4: accepts the exact DETAIL text Postgres renders for the migration's jsonb_build_object(...)::text", () => {
    // Captured verbatim from the new function on a throwaway PG16 cluster (GET STACKED DIAGNOSTICS).
    const pgRendered = '{"resets_at": "2026-11-01T00:00:00Z", "budget_month": "2026-10-01"}';
    expect(classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000", pgRendered)).resetAt).toBe("2026-11-01T00:00:00Z");
  });

  it("4: before the migration (no DETAIL) the tenant code survives and no reset date is invented", () => {
    const r = classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000"));
    expect(r.code).toBe("tts_tenant_cost_limit");
    expect(r.resetAt).toBeNull();
  });

  it("5/12: tenant and platform caps share SQLSTATE 54000 and still map to DIFFERENT codes", () => {
    const tenant = classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000"));
    const platform = classifyVoiceCostRefusal(pgError("PAIGE_VOICE_PLATFORM_COST_LIMIT", "54000", detail("2026-10-01", "2026-11-01T00:00:00Z")));
    expect(platform.code).toBe("tts_platform_cost_limit");
    expect(platform.resetAt).toBeNull();
    expect(tenant.code).not.toBe(platform.code);
    expect(tenant.status).not.toBe(platform.status);
  });

  it("12: the SQLSTATE alone never classifies — an unrecognised 54000 is generic", () => {
    expect(classifyVoiceCostRefusal(pgError("statement too complex", "54000")).code).toBe("tts_cost_limit_unavailable");
    expect(classifyVoiceCostRefusal({ code: "54000" }).code).toBe("tts_cost_limit_unavailable");
  });

  it("6/7: emergency brake, workspace switch-off and configuration each keep their own code", () => {
    expect(classifyVoiceCostRefusal(pgError("PAIGE_VOICE_EMERGENCY_DISABLED", "55000")).code).toBe("tts_emergency_disabled");
    expect(classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_BUDGET_DISABLED", "55000")).code).toBe("tts_workspace_voice_disabled");
    expect(classifyVoiceCostRefusal(pgError("PAIGE_VOICE_BUDGET_DISABLED", "55000")).code).toBe("tts_not_configured");
  });

  it("a profile refusal at RESERVE time is a revision race (retryable), never not-configured", () => {
    // The resolver approved this exact revision moments earlier; the reservation disagreeing means
    // the active profile changed in between. Not-configured would disable playback for the session.
    expect(classifyVoiceCostRefusal(pgError("PAIGE_VOICE_PROFILE_UNAVAILABLE", "55000"))).toEqual({
      code: "tts_voice_profile_changed", status: 503, resetAt: null, identity: "PAIGE_VOICE_PROFILE_UNAVAILABLE",
    });
  });

  it("everything it cannot name is generic, and nothing raw survives into the result", () => {
    for (const message of [
      "PAIGE_VOICE_COST_IDEMPOTENCY_MISMATCH",
      "PAIGE_VOICE_COST_FORBIDDEN",
      "PAIGE_VOICE_COST_SCOPE_MISMATCH",
      "PAIGE_VOICE_COST_INVALID",
      "permission denied for function reserve_paige_voice_cost_internal",
      " PAIGE_VOICE_TENANT_COST_LIMIT: extra",
      "toString",
      "__proto__",
    ]) {
      const r = classifyVoiceCostRefusal(pgError(message, "42501", detail("2026-10-01", "2026-11-01T00:00:00Z")));
      expect(r.code, message).toBe("tts_cost_limit_unavailable");
      expect(r.resetAt, message).toBeNull();
      expect(r.identity, message).toBeNull();
      expect(JSON.stringify({ error: r.code })).not.toMatch(/PAIGE_VOICE|permission|reserve_/);
    }
    expect(classifyVoiceCostRefusal(null).code).toBe("tts_cost_limit_unavailable");
    expect(classifyVoiceCostRefusal(undefined).code).toBe("tts_cost_limit_unavailable");
  });

  it("4: a reset instant is accepted only when it is the month after the canonical budget month", () => {
    expect(parseVoiceCostResetAt(detail("2026-12-01", "2027-01-01T00:00:00Z"))).toBe("2027-01-01T00:00:00Z");
    expect(parseVoiceCostResetAt(detail("2026-10-01", "2026-12-01T00:00:00Z"))).toBeNull();
    expect(parseVoiceCostResetAt(detail("2026-12-01", "2026-13-01T00:00:00Z"))).toBeNull();
    expect(parseVoiceCostResetAt(detail("2026-10-15", "2026-11-01T00:00:00Z"))).toBeNull();
    expect(parseVoiceCostResetAt(detail("2026-10-01", "2026-11-01T05:00:00Z"))).toBeNull();
    expect(parseVoiceCostResetAt(detail("2026-10-01", "2026-11-01"))).toBeNull();
    expect(parseVoiceCostResetAt("not json")).toBeNull();
    expect(parseVoiceCostResetAt("[1]")).toBeNull();
    expect(parseVoiceCostResetAt(null)).toBeNull();
    expect(parseVoiceCostResetAt(JSON.stringify({ resets_at: "2026-11-01T00:00:00Z" }))).toBeNull();
  });

  it("4 (F4): an unanchored or trailing-garbage value yields no reset date", () => {
    for (const [budgetMonth, resetsAt] of [
      ["2026-10-01", "2026-11-01T00:00:00Zjunk"],
      ["2026-10-01", "2026-11-01T00:00:00Z\n"],
      ["2026-10-01", "2026-11-01T00:00:00Z<script>"],
      ["2026-10-01", "x2026-11-01T00:00:00Z"],
      ["2026-10-01", " 2026-11-01T00:00:00Z"],
      ["2026-10-01", "2026-11-01T00:00:00.000Z"],
      ["2026-10-01x", "2026-11-01T00:00:00Z"],
      ["x2026-10-01", "2026-11-01T00:00:00Z"],
      ["2026-10-01\n", "2026-11-01T00:00:00Z"],
    ]) {
      expect(parseVoiceCostResetAt(detail(budgetMonth, resetsAt)), `${budgetMonth} → ${resetsAt}`).toBeNull();
      const r = classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000", detail(budgetMonth, resetsAt)));
      expect(r.code).toBe("tts_tenant_cost_limit");
      expect(r.resetAt).toBeNull();
      expect(voiceCostRefusalBody(r)).toEqual({ error: "tts_tenant_cost_limit" });
    }
  });

  it("2 (F2): the refusal body carries only `error` and, when proven, `reset_at` — nothing raw", () => {
    const hostileDetail = JSON.stringify({
      budget_month: "2026-10-01", resets_at: "2026-11-01T00:00:00Z", tenant_id: "secret-tenant", used_usd: 9.93,
    });
    const identities = [
      "PAIGE_VOICE_TENANT_COST_LIMIT", "PAIGE_VOICE_PLATFORM_COST_LIMIT", "PAIGE_VOICE_EMERGENCY_DISABLED",
      "PAIGE_VOICE_TENANT_BUDGET_DISABLED", "PAIGE_VOICE_BUDGET_DISABLED", "PAIGE_VOICE_PROFILE_UNAVAILABLE",
      "PAIGE_VOICE_COST_SCOPE_MISMATCH", "permission denied for function reserve_paige_voice_cost_internal",
    ];
    for (const message of identities) {
      for (const details of [null, hostileDetail, detail("2026-10-01", "2026-11-01T00:00:00Z")]) {
        const raw = { ...pgError(message, "54000", details), hint: "raw hint text" };
        const refusal = classifyVoiceCostRefusal(raw);
        const body = voiceCostRefusalBody(refusal);
        expect(Object.keys(body).every((k) => k === "error" || k === "reset_at"), message).toBe(true);
        expect(body.error).toBe(refusal.code);
        expect(typeof body.error).toBe("string");
        if ("reset_at" in body) expect(body.reset_at).toBe("2026-11-01T00:00:00Z");
        expect(JSON.stringify(body), message).not.toMatch(/PAIGE_VOICE|54000|permission|reserve_|secret-tenant|budget_month|raw hint|9\.93/);
      }
    }
    expect(Object.keys(voiceCostRefusalBody(
      classifyVoiceCostRefusal(pgError("PAIGE_VOICE_TENANT_COST_LIMIT", "54000", hostileDetail)),
    )).sort()).toEqual(["error", "reset_at"]);
  });
});

describe("INT-321 profile resolve failure → stable TTS code (server)", () => {
  it("a resolver that PROVED there is no usable profile is configuration", () => {
    expect(classifyVoiceProfileFailure(pgError("PAIGE_VOICE_PROFILE_UNAVAILABLE", "55000"), false))
      .toEqual({ code: "tts_not_configured", status: 503 });
    // Returned, but names a voice this edge does not support.
    expect(classifyVoiceProfileFailure(null, true)).toEqual({ code: "tts_not_configured", status: 503 });
  });

  it("a resolver CALL that failed is transient and retryable, never configuration", () => {
    for (const error of [
      pgError("FetchError: network request failed", ""),
      pgError("upstream connect error or disconnect/reset before headers", "PGRST000"),
      pgError("PAIGE_VOICE_PROFILE_FORBIDDEN", "42501"),
      pgError(" PAIGE_VOICE_PROFILE_UNAVAILABLE: extra", "55000"),
      { code: "55000" },
    ]) {
      expect(classifyVoiceProfileFailure(error, false), JSON.stringify(error)).toEqual({ code: "voice_profile_unavailable", status: 503 });
    }
    // No error and nothing returned is an anomaly, not an answer.
    expect(classifyVoiceProfileFailure(null, false)).toEqual({ code: "voice_profile_unavailable", status: 503 });
  });
});

describe("INT-321 end to end: reservation identity → paige-tts code → owner-facing state", () => {
  const ownerSees = (message: string, details: string | null = null) => {
    const r = classifyVoiceCostRefusal(pgError(message, message.includes("COST_LIMIT") ? "54000" : "55000", details));
    return classifyTtsFailure(r.code, r.status, r.resetAt);
  };
  const year = new Date().getUTCFullYear();

  it("1/2/3/4: the reproduced prod case reads as this workspace's allowance with its true reset day", () => {
    const fb = ownerSees("PAIGE_VOICE_TENANT_COST_LIMIT", detail(`${year}-10-01`, `${year}-11-01T00:00:00Z`));
    expect(fb.kind).toBe("allowance");
    expect(fb.message).toBe("Voice playback has reached this workspace’s monthly allowance. It resets November 1.");
    expect(fb.message).not.toMatch(/paused/i);
  });

  it("5/6/7: platform cap, emergency brake and not-configured are three different owner states", () => {
    expect(ownerSees("PAIGE_VOICE_PLATFORM_COST_LIMIT").kind).toBe("platform_unavailable");
    expect(ownerSees("PAIGE_VOICE_EMERGENCY_DISABLED").kind).toBe("paused");
    expect(ownerSees("PAIGE_VOICE_BUDGET_DISABLED").kind).toBe("not_configured");
    expect(ownerSees("PAIGE_VOICE_TENANT_BUDGET_DISABLED").kind).toBe("not_configured");
  });

  it("F1: a profile race at reserve, or a failed profile resolve, is a retry — playback stays enabled", () => {
    expect(ownerSees("PAIGE_VOICE_PROFILE_UNAVAILABLE").kind).toBe("retryable");
    const transient = classifyVoiceProfileFailure(pgError("upstream timeout", "PGRST000"), false);
    expect(classifyTtsFailure(transient.code, transient.status).kind).toBe("retryable");
    const proven = classifyVoiceProfileFailure(pgError("PAIGE_VOICE_PROFILE_UNAVAILABLE", "55000"), false);
    expect(classifyTtsFailure(proven.code, proven.status).kind).toBe("not_configured");
  });

  it("an unnamed refusal is a retry for the owner, never a platform pause", () => {
    expect(ownerSees("PAIGE_VOICE_COST_SCOPE_MISMATCH").kind).toBe("retryable");
  });
});

describe("INT-321 paige-tts wiring (structural)", () => {
  const tts = readFileSync("supabase/functions/paige-tts/index.ts", "utf8");
  // INT-324: the reserve/refuse block now precedes BOTH providers; the refusal branch ends where
  // the pre-dispatch release helper begins (it used to end at the ElevenLabs-only `let res`).
  const refusalBranch = tts.slice(
    tts.indexOf("if (reservationError || !reservationId) {"),
    tts.indexOf("const releaseIfPreDispatch"),
  );

  it("8/11: a refused reservation returns from the request — no provider call, no next attempt", () => {
    expect(refusalBranch.length).toBeGreaterThan(0);
    // INT-324: the one refusal branch sits before EITHER provider is entered.
    expect(tts.indexOf("if (reservationError || !reservationId) {")).toBeLessThan(tts.indexOf("elevenlabsTts({"));
    expect(tts.indexOf("if (reservationError || !reservationId) {")).toBeLessThan(tts.indexOf("synthesizeSpeechStream("));
    expect(refusalBranch).toContain("classifyVoiceCostRefusal(reservationError)");
    // 12/F2: the response is the one allow-listed body builder + the classifier's status — never a
    // hard-coded generic 503 and never a hand-built object that could grow a raw field.
    expect(refusalBranch).toContain("return json(voiceCostRefusalBody(refusal), refusal.status);");
    expect(refusalBranch.match(/return json\(/g)).toHaveLength(1);
    expect(refusalBranch).not.toMatch(/["']tts_[a-z_]+["']/);
    expect(refusalBranch).not.toMatch(/\bcontinue\b|elevenlabsTts|synthesizeSpeechStream|new Response\(/);
    // Raw database text never reaches the browser body.
    expect(refusalBranch).not.toMatch(/reservationError\??\.(message|details|hint)/);
  });

  it("F1: a failed profile resolve returns the classified code, never a hard-coded one", () => {
    const profileBranch = tts.slice(tts.indexOf("if (!resolvedVoice) {"), tts.indexOf("const voiceSource ="));
    expect(profileBranch.length).toBeGreaterThan(0);
    expect(profileBranch).toContain("classifyVoiceProfileFailure(profileError, profileRecord !== null)");
    expect(profileBranch).toContain("return json({ error: failure.code }, failure.status);");
    expect(profileBranch).not.toMatch(/["']voice_profile_unavailable["']|["']tts_[a-z_]+["']/);
    expect(profileBranch).not.toMatch(/profileError\??\.(message|details|hint)/);
  });

  it("9/10: cache lookup still precedes reservation, and settlement is unchanged in meaning", () => {
    const cache = tts.indexOf("download(cachePath)");
    const reserve = tts.indexOf('rpc("reserve_paige_voice_cost_internal"');
    expect(cache).toBeGreaterThan(-1);
    expect(cache).toBeLessThan(reserve);
    expect(tts).toContain('_outcome: "committed"');
    expect(tts).toContain("e instanceof NeedsConfigError");
    expect(tts).toContain("tts_cost_settlement_unavailable");
  });
});

describe("INT-321 migration (structural)", () => {
  const dir = "supabase/migrations";
  const defs = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /CREATE OR REPLACE FUNCTION public\.reserve_paige_voice_cost_internal\(/.test(readFileSync(`${dir}/${f}`, "utf8")));
  const latest = defs.at(-1)!;
  const sql = readFileSync(`${dir}/${latest}`, "utf8");

  it("the latest definition carries both reset DETAILs and the distinct emergency identity", () => {
    expect(latest).toBe("20270581000000_paige_voice_cost_refusal_identity.sql");
    expect(sql).toContain("'PAIGE_VOICE_TENANT_COST_LIMIT' USING ERRCODE = '54000', DETAIL = _limit_detail");
    expect(sql).toContain("'PAIGE_VOICE_PLATFORM_COST_LIMIT' USING ERRCODE = '54000', DETAIL = _limit_detail");
    expect(sql).toContain("'PAIGE_VOICE_EMERGENCY_DISABLED' USING ERRCODE = '55000'");
    expect(sql).toContain("'PAIGE_VOICE_BUDGET_DISABLED' USING ERRCODE = '55000'");
    expect(sql).toContain("IF auth.role() <> 'service_role' THEN");
    expect(sql).toMatch(/FOR UPDATE[\s\S]+ON CONFLICT/);
    expect(sql).not.toMatch(/\bGRANT\b[^;]*\b(anon|authenticated|PUBLIC)\b/);
  });
});
