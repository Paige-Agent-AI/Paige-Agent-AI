import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";

// E09 F2 — the one frontend reader of the business's finance entitlement, the config field it reads for a
// customer, and the credit-alerts read it switches off. Synthetic only; never a real account.
const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...a: unknown[]) => f.rpc(...a),
  from: (...a: unknown[]) => f.from(...a),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: () => {},
} }));
vi.mock("@/lib/scopedUser", () => ({ getEffectiveUserId: async () => "e0f20000-0000-4000-8000-0000000000a2" }));
const { useFinanceEntitlement, useFinancePortal, resetFinanceEntitlementCache } = await import("./useFinanceEntitlement");
const { normalizePortalConfig } = await import("./useClientPortalConfig");
const { useCreditAlerts } = await import("./useCreditAlerts");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => { resetFinanceEntitlementCache(); f.rpc.mockReset(); f.from.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };

function Probe() {
  const e = useFinanceEntitlement();
  const p = useFinancePortal();
  return <p>{JSON.stringify({ ...e, open: p.open })}</p>;
}
const read = () => JSON.parse(host.textContent || "{}");
const customer = (config: Record<string, unknown>) => ({ frame: { actorId: "u1", profile: { id: "c1", tenant_id: "t1" },
  brand: { tenant_id: "t1", tenant_name: "Northwind Studio" }, config }, phase: "ready" }) as unknown as CustomerIdentityState;

describe("normalizePortalConfig — entitlements", () => {
  it("only a literal true grants; anything else is not entitled; absent stays absent", () => {
    expect(normalizePortalConfig({ entitlements: { finance: true } }).entitlements).toEqual({ finance: true });
    for (const v of [false, "true", 1, null]) expect(normalizePortalConfig({ entitlements: { finance: v } }).entitlements).toEqual({ finance: false });
    expect(normalizePortalConfig({ entitlements: [true] }).entitlements).toBeUndefined();
    expect(normalizePortalConfig({}).entitlements).toBeUndefined();
  });
});

describe("useFinanceEntitlement", () => {
  it("a customer's answer is their frame's, and the staff wrapper is never asked", async () => {
    await act(async () => root.render(<CustomerIdentityProvider state={customer({ entitlements: { finance: true } })}><Probe /></CustomerIdentityProvider>));
    await flush();
    expect(read()).toMatchObject({ entitled: true, loading: false, open: true });
    await act(async () => root.render(<CustomerIdentityProvider state={customer({})}><Probe /></CustomerIdentityProvider>));
    await flush();
    expect(read()).toMatchObject({ entitled: false, open: false });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("staff of a business that is not entitled: not entitled, but the portal stays open for them (Q5)", async () => {
    f.rpc.mockResolvedValue({ data: false, error: null });
    await act(async () => root.render(<CustomerIdentityProvider state={{ frame: null, phase: "not-client", staff: true }}><Probe /></CustomerIdentityProvider>));
    await flush();
    expect(f.rpc).toHaveBeenCalledWith("current_tenant_finance_entitled");
    expect(read()).toMatchObject({ entitled: false, staffViewer: true, open: true });
  });

  it("outside the shell the caller's current business decides; a failed read is not entitled", async () => {
    f.rpc.mockResolvedValue({ data: true, error: null });
    await act(async () => root.render(<Probe />));
    await flush();
    expect(read()).toMatchObject({ entitled: true, loading: false });
    resetFinanceEntitlementCache();
    f.rpc.mockRejectedValue(new Error("network"));
    await act(async () => root.render(<CustomerIdentityProvider state={{ frame: null, phase: "not-client", staff: false }}><Probe /></CustomerIdentityProvider>));
    await flush();
    expect(read()).toMatchObject({ entitled: false, open: false });
  });

  it("while the shell is still checking who this is, it waits and asks nobody", async () => {
    await act(async () => root.render(<CustomerIdentityProvider state={{ frame: null, phase: "loading" }}><Probe /></CustomerIdentityProvider>));
    await flush();
    expect(read()).toMatchObject({ entitled: false, loading: true, open: false });
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("useCreditAlerts({ enabled: false })", () => {
  function Alerts({ enabled }: { enabled: boolean }) {
    const a = useCreditAlerts({ enabled, limit: 5 });
    return <p>{JSON.stringify({ n: a.alerts.length, loading: a.loading })}</p>;
  }
  it("reads nothing at all and is not loading", async () => {
    await act(async () => root.render(<Alerts enabled={false} />));
    await flush();
    expect(f.from).not.toHaveBeenCalled();
    expect(JSON.parse(host.textContent || "{}")).toEqual({ n: 0, loading: false });
  });
  it("CONTROL: enabled reads credit_alerts", async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain; chain.eq = () => chain; chain.order = () => chain;
    chain.limit = () => Promise.resolve({ data: [], error: null });
    f.from.mockReturnValue(chain);
    await act(async () => root.render(<Alerts enabled />));
    await flush();
    expect(f.from).toHaveBeenCalledWith("credit_alerts");
  });
});
