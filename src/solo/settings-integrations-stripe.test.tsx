import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { StripeMerchantDrawer } from "./settings-integrations-stripe";
import type { useStripeMerchant } from "./data/useStripeMerchant";
import { armOAuthReturn } from "./data/oauthReturn";
vi.mock("./data/oauthReturn", () => ({ armOAuthReturn: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const status = (patch = {}) => ({ tenantId: "test-tenant", connected: false, canManage: true, environment: "test", bindingVersion: null,
  chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, paymentPermission: false, checkedAt: null,
  state: "not_connected", loading: false, error: false, busy: false, message: null,
  reload: vi.fn(), refresh: vi.fn(), begin: vi.fn().mockResolvedValue(null), ...patch }) as ReturnType<typeof useStripeMerchant>;
async function render(merchant: ReturnType<typeof useStripeMerchant>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const close = vi.fn();
  await act(async () => root.render(<StripeMerchantDrawer merchant={merchant} onClose={close} />));
  return { host, close, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}
describe("Stripe merchant owner experience", () => {
  it("does not navigate after a pending drawer is abandoned", async () => {
    let complete!: (value: string) => void;
    const merchant = status({ begin: vi.fn(() => new Promise<string>(resolve => { complete = resolve; })) });
    const p = await render(merchant); vi.mocked(armOAuthReturn).mockClear();
    await act(async () => Array.from(p.host.querySelectorAll("button")).find(b => b.textContent?.includes("Connect Stripe"))?.click());
    await p.dispose(); await act(async () => complete("https://connect.stripe.com/setup/test"));
    expect(armOAuthReturn).not.toHaveBeenCalled();
  });
  it("does not assert business details from stale facts or permissions from a read failure", async () => {
    const stale = await render(status({ state: "unverified", checkedAt: "2026-01-01T00:00:00Z", detailsSubmitted: true }));
    expect(stale.host.textContent).not.toContain("Submitted"); await stale.dispose();
    const failed = await render(status({ error: true, canManage: false }));
    expect(failed.host.textContent).not.toContain("Only a workspace owner"); await failed.dispose();
  });
  it("shows TEST plainly and keeps PAIGE billing separate", async () => {
    const p = await render(status()); expect(p.host.textContent).toContain("TEST · no real money");
    expect(p.host.textContent).toContain("Your PAIGE subscription stays separate");
    expect(p.host.textContent).not.toContain("tenant_stripe_accounts"); await p.dispose();
  });
  it("starts only on an explicit owner action", async () => {
    const merchant = status(); const p = await render(merchant); expect(merchant.begin).not.toHaveBeenCalled();
    await act(async () => (Array.from(p.host.querySelectorAll("button")).find(b => b.textContent?.includes("Connect Stripe")))?.click());
    expect(merchant.begin).toHaveBeenCalledOnce(); await p.dispose();
  });
  it("does not claim redirect means connected or settled", async () => {
    const p = await render(status({ state: "ready", connected: true, checkedAt: new Date().toISOString(), chargesEnabled: true, paymentPermission: true }));
    expect(p.host.textContent).toContain("not proof that a payment has settled"); await p.dispose();
  });
  it("unknown setup cannot start another account", async () => {
    const p = await render(status({ state: "outcome_unknown" }));
    expect(Array.from(p.host.querySelectorAll("button")).find(b => b.textContent?.includes("Connect Stripe"))?.disabled).toBe(true);
    expect(p.host.textContent).toContain("existing attempt"); await p.dispose();
  });
  it("restricted role cannot manage setup; reads remain available", async () => {
    const merchant = status({ canManage: false }); const p = await render(merchant);
    expect(p.host.textContent).not.toContain("Connect Stripe (");
    await act(async () => Array.from(p.host.querySelectorAll("button")).find(b => b.textContent?.includes("Refresh status"))?.click());
    expect(merchant.reload).toHaveBeenCalledOnce(); expect(merchant.refresh).not.toHaveBeenCalled(); await p.dispose();
  });
  it("error keeps readiness unclaimed and has a recovery action", async () => {
    const p = await render(status({ error: true, state: "unverified", message: "Refresh to check." }));
    expect(p.host.querySelector('[role="alert"]')?.textContent).toContain("Nothing is being claimed as ready");
    expect(Array.from(p.host.querySelectorAll("button")).find(b => b.textContent?.includes("Connect Stripe"))?.disabled).toBe(true); await p.dispose();
  });
  it("Escape closes the contextual drawer", async () => {
    const p = await render(status()); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(p.close).toHaveBeenCalledOnce(); await p.dispose();
  });
});
