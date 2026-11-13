import { describe, expect, it, vi } from "vitest";
import { callZapierWorkflowApi, type ZapierWorkflowApiDeps } from "../../../supabase/functions/_shared/zapier-workflow-transport";

const scope = { tenantId: "test-tenant-a", actorId: "test-owner-a" };
const steps = [
  { action: "discovered:paid-member", authentication: "skool-auth", inputs: {} },
  { action: "discovered:upsert-contact", authentication: "crm-auth", inputs: {} },
];
const zap = { type: "zap", id: "123", title: "Reviewed onboarding", is_enabled: true, updated_at: "2026-11-11T12:00:00Z" };
function harness() {
  const fetch = vi.fn<ZapierWorkflowApiDeps["fetch"]>(async () => new Response(JSON.stringify(zap), { status: 201 }));
  const verifyOriginalAuthority = vi.fn<ZapierWorkflowApiDeps["verifyOriginalAuthority"]>(async () => true);
  const loadGrant = vi.fn(async () => ({ tenantId: scope.tenantId, generation: "original-generation", accessToken: "test-secret-token",
    expiresAt: "2099-01-01T00:00:00Z", scopes: ["zap:write", "zap:update", "zap:pause", "zap:runs", "zap:account:all"] }));
  const deps: ZapierWorkflowApiDeps = { fetch, verifyOriginalAuthority, loadGrant };
  return { deps, fetch, verifyOriginalAuthority, loadGrant };
}

describe("existing Zapier API transport extension", () => {
  it("requires the original authority before any credential lookup or HTTP call", async () => {
    const h = harness(); h.verifyOriginalAuthority.mockResolvedValue(false);
    expect(await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps)).toMatchObject({ state: "refused", code: "authority_refused" });
    expect(h.loadGrant).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  });
  it("does not let a connection in another workspace satisfy the request", async () => {
    const h = harness(); h.loadGrant.mockResolvedValue({ ...(await h.loadGrant()), tenantId: "test-tenant-b" });
    expect(await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps)).toMatchObject({ state: "refused", code: "connection_scope_mismatch" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("requires the exact granted operation scope without silently upgrading or refreshing", async () => {
    const h = harness(); h.loadGrant.mockResolvedValue({ ...(await h.loadGrant()), scopes: ["profile", "zap:account:all"] });
    expect(await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps)).toMatchObject({ state: "refused", code: "scope_required" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("stops a disconnected or changed grant before sending", async () => {
    const h = harness(); h.verifyOriginalAuthority.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps)).toMatchObject({ state: "refused", code: "authority_refused" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("uses the fixed provider origin and never reports a new workflow as completed onboarding", async () => {
    const h = harness(); const result = await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.fetch.mock.calls[0][0]).toBe("https://api.zapier.com/v2/zaps");
    expect(result).toMatchObject({ state: "observed", provider: { workflow: { id: "123" }, onboarding_completed: null } });
    expect(JSON.stringify(result)).not.toContain("test-secret-token");
  });
  it("retains an uncertain write as unknown and never repeats the request", async () => {
    const h = harness(); h.fetch.mockRejectedValue(new Error("provider echoed test-secret-token"));
    const result = await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps);
    expect(result).toMatchObject({ state: "outcome_unknown", code: "provider_response_unconfirmed" });
    expect(h.fetch).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("test-secret-token");
  });
  it("does not invent an original workflow after mismatched update readback", async () => {
    const h = harness(); h.fetch.mockResolvedValue(new Response(JSON.stringify({ ...zap, id: "456" }), { status: 200 }));
    expect(await callZapierWorkflowApi(scope, "update", { workflow_id: "123", title: "Reviewed" }, h.deps))
      .toMatchObject({ state: "outcome_unknown" });
    expect(h.fetch).toHaveBeenCalledOnce();
  });
  it("keeps a provider pause acknowledgement unverified until original status readback", async () => {
    const h = harness(); h.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await callZapierWorkflowApi(scope, "pause", { workflow_id: "123" }, h.deps))
      .toMatchObject({ state: "acknowledged", provider: { workflow_id: "123", verified: false } });
  });
  it("does not disclose a late result after authority is lost", async () => {
    const h = harness(); h.verifyOriginalAuthority.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps))
      .toMatchObject({ state: "outcome_unknown", code: "authority_changed_after_dispatch" });
  });
  it("uses the same atomic native actor/tenant/grant check at dispatch and disclosure", async () => {
    const h = harness(); await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps);
    expect(h.verifyOriginalAuthority.mock.calls.map(call => call[2])).toEqual([null, "original-generation", "original-generation"]);
    for (const [actualScope, request] of h.verifyOriginalAuthority.mock.calls) {
      expect(actualScope).toEqual(scope); expect(request.effect).toBe("may_enable");
      expect(request.body).toContain('"Reviewed"'); expect(Object.isFrozen(request)).toBe(true);
    }
    expect("isCurrentGrant" in h.deps).toBe(false);
  });
  it("never sends after an authority check times out and later completes", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); let release!: (value: boolean) => void;
      h.verifyOriginalAuthority.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps);
      await vi.advanceTimersByTimeAsync(10001);
      expect(await pending).toMatchObject({ state: "unavailable" });
      release(true); await vi.advanceTimersByTimeAsync(1);
      expect(h.loadGrant).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("treats an oversized write response as unknown without returning provider content", async () => {
    const h = harness(); h.fetch.mockResolvedValue(new Response("private", { status: 201, headers: { "content-length": "262145" } }));
    const result = await callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps);
    expect(result.state).toBe("outcome_unknown"); expect(JSON.stringify(result)).not.toContain("private");
    expect(h.fetch).toHaveBeenCalledOnce();
  });
  it("does not wait for an unresponsive provider cancellation on refusal", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 403 }));
      let result: unknown; const pending = callZapierWorkflowApi(scope, "create", { title: "Reviewed", steps }, h.deps).then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(20);
      expect(result).toMatchObject({ state: "refused", code: "provider_authorization_refused" });
      await pending; expect(h.fetch).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("does not wait for unresponsive cancellation after an acknowledgement", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(); h.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 200 }));
      let result: unknown; const pending = callZapierWorkflowApi(scope, "pause", { workflow_id: "123" }, h.deps).then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(20);
      expect(result).toMatchObject({ state: "acknowledged" }); await pending;
    } finally { vi.useRealTimers(); }
  });
});
