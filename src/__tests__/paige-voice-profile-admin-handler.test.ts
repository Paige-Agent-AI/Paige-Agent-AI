// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ handler: null as null | ((req: Request) => Promise<Response>),
  createClient: vi.fn(), inspect: vi.fn(), envKey: vi.fn() }));
vi.mock("https://deno.land/std@0.190.0/http/server.ts", () => ({ serve: (fn: typeof mocks.handler) => { mocks.handler = fn; } }));
vi.mock("https://esm.sh/@supabase/supabase-js@2.75.0", () => ({ createClient: mocks.createClient }));
vi.mock("https://esm.sh/zod@3.22.4", () => ({ z }));
vi.mock("../../supabase/functions/_shared/env-key.ts", () => ({ envKey: mocks.envKey }));
vi.mock("../../supabase/functions/_shared/paige-voice-provider-inspection.ts", () => ({ inspectConfiguredVoiceProvider: mocks.inspect }));

describe("Voice Profile inspection request boundary", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.createClient.mockReset();
    mocks.inspect.mockReset();
    mocks.envKey.mockReset();
    vi.stubGlobal("Deno", { env: { get: (name: string) => name } });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network_forbidden"); }));
    // Execute the real Edge handler through Vitest's mocked runtime. Its Deno module
    // graph is typechecked by the affected-edge CI gate, not the browser TS project.
    const edgeHandlerPath = "../../supabase/functions/paige-voice-profile-admin/index.ts";
    await import(/* @vite-ignore */ edgeHandlerPath);
  });
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  const request = (body: unknown, auth = true) => new Request("https://example.test/voice-admin", {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer test-only" } : {}) }, body: JSON.stringify(body),
  });
  function ownerSetup(options: { profile?: unknown; profileError?: unknown; auditError?: unknown; outcomeError?: unknown;
    user?: { id: string } | null; owner?: unknown; ownerError?: unknown; tenant?: unknown; tenantError?: unknown;
    rpcError?: unknown; auditId?: string } = {}) {
    const caller = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user === undefined ? { id: "owner-id" } : options.user }, error: null }) },
      rpc: vi.fn(async (name: string) => {
        if (name === "is_platform_owner") return { data: options.owner === undefined ? true : options.owner, error: options.ownerError };
        if (name === "current_user_tenant_id") return { data: options.tenant === undefined ? "test-tenant-canonical" : options.tenant, error: options.tenantError };
        throw new Error("unexpected caller RPC " + name);
      }) };
    const profile = options.profile === undefined ? { revision: "candidate-r1", provider: "elevenlabs", provider_voice_ref: "ServerVoice123" } : options.profile;
    const profileQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: options.profileError }) };
    const auditQuery = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: options.auditError ? null : { id: options.auditId ?? "audit-id" }, error: options.auditError }),
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: options.outcomeError }) };
    const admin = { from: vi.fn((table: string) => table === "paige_voice_profiles" ? profileQuery : auditQuery), rpc: vi.fn().mockResolvedValue({ data: null, error: options.rpcError }) };
    mocks.createClient.mockReturnValueOnce(caller).mockReturnValueOnce(admin);
    mocks.envKey.mockReturnValue("test-secret-never-output");
    mocks.inspect.mockResolvedValue({ code: "metadata_only", voice: { accessible: true, referenceMatches: true }, subscription: { transport: "ok", tier: "creator" } });
    return { caller, admin, auditQuery };
  }
  it("rejects missing authentication before resolving any key or client", async () => {
    const response = await mocks.handler!(request({ action: "inspect-configured-account" }, false));
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.envKey).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("rejects an authenticated non-owner before privileged client or provider access", async () => {
    mocks.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }) }, rpc: async () => ({ data: false }) });
    expect((await mocks.handler!(request({ action: "inspect-configured-account" }))).status).toBe(403);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.envKey).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("rejects attempted key, URL or voice overrides", async () => {
    for (const field of ["apiKey", "url", "provider_voice_ref"]) {
      expect((await mocks.handler!(request({ action: "inspect-configured-account", [field]: "not-allowed" }))).status).toBe(400);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each([{ profile: null }, { profile: { provider: "other" } }, { profileError: { code: "test-failure" } }])("rejects unresolved candidate before key resolution: %j", async (options) => {
    const { admin, auditQuery } = ownerSetup(options);
    expect((await mocks.handler!(request({ action: "inspect-configured-account" }))).status).toBe(409);
    expect(mocks.envKey).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(auditQuery.insert).not.toHaveBeenCalled();
  });
  it("fails closed before any key/provider use if start attribution fails", async () => {
    const { admin } = ownerSetup({ auditError: { code: "audit-down" } });
    expect((await mocks.handler!(request({ action: "inspect-configured-account" }))).status).toBe(503);
    expect(mocks.envKey).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("records attribution before inspection, then only its sanitized outcome, without activation", async () => {
    const { admin, auditQuery } = ownerSetup();
    const result = await mocks.handler!(request({ action: "inspect-configured-account" }));
    expect(result.status).toBe(200);
    expect(auditQuery.single.mock.invocationCallOrder[0]).toBeLessThan(mocks.envKey.mock.invocationCallOrder[0]);
    expect(auditQuery.insert.mock.calls[0][0]).toMatchObject({ actor_user_id: "owner-id", payload: { profile_revision: "candidate-r1", phase: "inspection_started" } });
    expect(auditQuery.update.mock.calls[0][0]).toMatchObject({ payload: { phase: "inspection_completed", inspection: { code: "metadata_only" } } });
    const text = await result.text();
    expect(text).not.toMatch(/test-secret|ServerVoice123/);
    expect(JSON.stringify(auditQuery.insert.mock.calls)).not.toMatch(/test-secret|ServerVoice123/);
    expect(JSON.stringify(auditQuery.update.mock.calls)).not.toMatch(/test-secret|ServerVoice123/);
    expect(JSON.parse(text)).toMatchObject({ audio_enabled: false, retention_proof: "UNVERIFIED", live_audio_proof: "UNVERIFIED" });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("keeps the start attribution and refuses success if outcome persistence fails", async () => {
    const { admin, auditQuery } = ownerSetup({ outcomeError: { code: "audit-down" } });
    expect((await mocks.handler!(request({ action: "inspect-configured-account" }))).status).toBe(503);
    expect(auditQuery.insert).toHaveBeenCalledTimes(1);
    expect(mocks.inspect).toHaveBeenCalledTimes(1);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  const authorize = { action: "authorize-live-pilot", accept_default_provider_retention: true,
    accept_procedural_single_speaker: true, evidence_ref: "fa100000-0000-4000-8000-000000000123" };
  it("lets the authenticated platform owner revoke even with no selected workspace", async () => {
    const { caller, admin } = ownerSetup({ tenant: null });
    const response = await mocks.handler!(request({ action: "disable-live-pilot" }));
    expect(response.status).toBe(200);
    expect(caller.rpc).not.toHaveBeenCalledWith("current_user_tenant_id");
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith("set_paige_live_pilot_internal", {
      _actor_user_id: "owner-id", _tenant_id: null, _enabled: false,
      _evidence_ref: null, _inspection_id: null,
    });
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("accepts only a private evidence record identifier, not free text", async () => {
    ownerSetup();
    const response = await mocks.handler!(request({ ...authorize, evidence_ref: "free text is not an evidence record" }));
    expect(response.status).toBe(400);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each(["accept_default_provider_retention", "accept_procedural_single_speaker"])("requires literal true for %s", async (field) => {
    for (const value of [undefined, false, "true", 1, null]) {
      const response = await mocks.handler!(request({ ...authorize, [field]: value }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "invalid_request" });
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each(["inspection_id", "actor_user_id", "tenant_id", "provider_voice_ref"])("rejects caller-supplied %s before privileged work", async (field) => {
    const response = await mocks.handler!(request({ ...authorize, [field]: "caller-selected" }));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("requires a validated authenticated user before owner authorization", async () => {
    const { caller, admin } = ownerSetup({ user: null });
    expect((await mocks.handler!(request(authorize))).status).toBe(401);
    expect(caller.auth.getUser).toHaveBeenCalledOnce();
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each([{ owner: false }, { owner: "true" }, { owner: true, ownerError: { code: "fixture" } }])("requires canonical literal owner authority: %j", async (options) => {
    const { caller, admin } = ownerSetup(options);
    expect((await mocks.handler!(request(authorize))).status).toBe(403);
    expect(caller.rpc).toHaveBeenCalledWith("is_platform_owner");
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it.each([{ tenant: null }, { tenantError: { code: "fixture" } }])("requires a resolved canonical current tenant: %j", async (options) => {
    const { caller, admin } = ownerSetup(options);
    const response = await mocks.handler!(request(authorize));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "workspace_unresolved", audio_enabled: false });
    expect(caller.rpc).toHaveBeenCalledWith("current_user_tenant_id");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("uses this request's authenticated actor, canonical tenant and newly settled inspection", async () => {
    const { caller, admin, auditQuery } = ownerSetup({ auditId: "fresh-inspection-id" });
    const response = await mocks.handler!(request(authorize));
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenNthCalledWith(1, "SUPABASE_URL", "SUPABASE_ANON_KEY", {
      global: { headers: { Authorization: "Bearer test-only" } },
    });
    expect(caller.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(caller.rpc.mock.invocationCallOrder[0]);
    expect(auditQuery.single.mock.invocationCallOrder[0]).toBeLessThan(mocks.inspect.mock.invocationCallOrder[0]);
    expect(mocks.inspect.mock.invocationCallOrder[0]).toBeLessThan(auditQuery.update.mock.invocationCallOrder[0]);
    expect(auditQuery.eq).toHaveBeenCalledWith("id", "fresh-inspection-id");
    expect(auditQuery.eq.mock.invocationCallOrder[0]).toBeLessThan(admin.rpc.mock.invocationCallOrder[0]);
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith("set_paige_live_pilot_internal", {
      _actor_user_id: "owner-id", _tenant_id: "test-tenant-canonical", _enabled: true,
      _evidence_ref: "fa100000-0000-4000-8000-000000000123", _inspection_id: "fresh-inspection-id",
    });
    expect(await response.json()).toEqual({ ok: true, code: "scoped_pilot_authorized",
      retention_state: "default_provider_retention", zero_retention_state: "UNAVAILABLE",
      speaker_identity_system_enforced: false, live_audio_proof: "UNVERIFIED" });
  });
  it.each([{ auditError: { code: "fixture" } }, { outcomeError: { code: "fixture" } }])("never authorizes when fresh inspection attribution cannot settle: %j", async (options) => {
    const { admin } = ownerSetup(options);
    const response = await mocks.handler!(request(authorize));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "inspection_audit_unavailable", audio_enabled: false });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("preserves failed metadata in the audit and reports the canonical authorization refusal", async () => {
    const { admin, auditQuery } = ownerSetup({ rpcError: { code: "42501" } });
    const inspection = { code: "metadata_only", subscription: { transport: "unauthorized" },
      voice: { transport: "unauthorized", accessible: false, referenceMatches: false } };
    mocks.inspect.mockResolvedValue(inspection);
    const response = await mocks.handler!(request(authorize));
    expect(auditQuery.update).toHaveBeenCalledWith({ payload: expect.objectContaining({ phase: "inspection_completed", inspection }) });
    expect(admin.rpc).toHaveBeenCalledWith("set_paige_live_pilot_internal", expect.objectContaining({ _inspection_id: "audit-id" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "pilot_authorization_refused", audio_enabled: false });
  });
  it("does not claim success when the authorization RPC fails after successful metadata", async () => {
    ownerSetup({ rpcError: { code: "fixture" } });
    const response = await mocks.handler!(request(authorize));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "pilot_authorization_refused", audio_enabled: false });
  });
});
