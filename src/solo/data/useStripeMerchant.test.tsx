import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readStripeMerchantStatus, stripeHostedSetupUrl, useStripeMerchant } from "./useStripeMerchant";

const context = vi.hoisted(() => ({ activeTenantId: "test-tenant-a", activeUserId: "test-owner", loading: false }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => context }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ready = () => ({ tenant_id: context.activeTenantId, connected: true, can_manage: true,
  provider_environment: "test", binding_version: 2, charges_enabled: true, payouts_enabled: true,
  details_submitted: true, sales_payment_permission: true, checked_at: new Date().toISOString(), state: "ready" });
let merchant: ReturnType<typeof useStripeMerchant>;
function Probe() { merchant = useStripeMerchant(); return null; }
async function mount() {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  return { root, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

beforeEach(() => { context.activeTenantId = "test-tenant-a"; invoke.mockReset(); invoke.mockImplementation(async () => ({ data: ready(), error: null })); });

describe("canonical Stripe merchant safe projection", () => {
  it("accepts a fresh server-observed merchant without carrying provider payloads", () => {
    const parsed = readStripeMerchantStatus({ ...ready(), requirements: { secret: "never render" } }, context.activeTenantId);
    expect(parsed?.state).toBe("ready"); expect(JSON.stringify(parsed)).not.toContain("never render");
  });
  it("refuses foreign workspace and malformed environment", () => {
    expect(readStripeMerchantStatus(ready(), "test-tenant-b")).toBeNull();
    expect(readStripeMerchantStatus({ ...ready(), provider_environment: "sandbox" }, context.activeTenantId)).toBeNull();
    expect(readStripeMerchantStatus({ ...ready(), charges_enabled: undefined }, context.activeTenantId)).toBeNull();
  });
  it("never promotes stale, future or unpermitted facts to readiness", () => {
    for (const patch of [{ checked_at: new Date(Date.now() - 301000).toISOString() },
      { checked_at: new Date(Date.now() + 60000).toISOString() }, { sales_payment_permission: false }]) {
      expect(readStripeMerchantStatus({ ...ready(), ...patch }, context.activeTenantId)?.state).not.toBe("ready");
    }
  });
  it("only accepts Stripe-hosted setup links", () => {
    expect(stripeHostedSetupUrl("https://connect.stripe.com/setup/test" )).toBeTruthy();
    for (const url of ["https://connect.stripe.com.evil.test/setup", "http://connect.stripe.com/setup", "https://user:pass@connect.stripe.com/setup", "javascript:alert(1)"]) expect(stripeHostedSetupUrl(url)).toBeNull();
  });
});

describe("merchant scope and deliberate actions", () => {
  it("blocks another start after uncertain response until explicit reconciliation", async () => {
    const p = await mount(); invoke.mockResolvedValue({ data: null, error: { message: "timeout" } });
    await act(async () => { await merchant.begin("https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return"); });
    expect(merchant.state).toBe("outcome_unknown");
    await act(async () => { await merchant.begin("https://paigeagent.ai/solo/1/settings/integrations?stripe_setup=return"); });
    expect(invoke).toHaveBeenCalledTimes(2); await p.close();
  });
  it("reads status, not provider refresh or account creation, on mount", async () => {
    const p = await mount(); expect(invoke).toHaveBeenCalledWith("tenant-stripe-connect", { body: { action: "status", expected_tenant_id: "test-tenant-a" } }); await p.close();
  });
  it("refreshes provider facts only on explicit request", async () => {
    const p = await mount(); await act(async () => { await merchant.refresh(); });
    expect(invoke.mock.calls.at(-1)?.[1].body.action).toBe("refresh_status"); await p.close();
  });
  it("catches transport failure without showing provider errors or optimistic readiness", async () => {
    invoke.mockRejectedValue(new Error("secret provider response")); const p = await mount();
    expect(merchant.error).toBe(true); expect(merchant.message).not.toContain("secret"); expect(merchant.state).toBe("unverified"); await p.close();
  });
  it("drops late previous-workspace responses", async () => {
    let resolve!: (value: unknown) => void; invoke.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const p = await mount(); context.activeTenantId = "test-tenant-b";
    await act(async () => p.root.render(<Probe />));
    await act(async () => resolve({ data: { ...ready(), tenant_id: "test-tenant-a" }, error: null }));
    expect(merchant.tenantId).toBe("test-tenant-b"); expect(merchant.state).toBe("ready"); await p.close();
  });
  it("does not start account setup with unavailable or non-admin state", async () => {
    invoke.mockResolvedValue({ data: { ...ready(), can_manage: false }, error: null }); const p = await mount();
    await act(async () => { expect(await merchant.begin("https://paigeagent.ai/solo/1/settings/integrations")).toBeNull(); });
    expect(invoke).toHaveBeenCalledTimes(1); await p.close();
  });
});
