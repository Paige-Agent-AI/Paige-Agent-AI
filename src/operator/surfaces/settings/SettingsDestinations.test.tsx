import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamSettings, ConnectionsSettings, BillingSettings, AnalyticsSettings } from "./SettingsDestinations";
import { useTeamPulse } from "@/operator/data/useTeamPulse";
import { useBillingOverview } from "@/operator/data/useBillingOverview";
vi.mock("@/operator/data/useTeamPulse", () => ({ useTeamPulse: vi.fn() }));
vi.mock("@/operator/data/useBillingOverview", () => ({ useBillingOverview: vi.fn() }));
let node: HTMLDivElement;
let root: Root;
async function mount(child: React.ReactNode) {
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  await act(async () => root.render(<MemoryRouter>{child}</MemoryRouter>));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); node?.remove(); vi.resetAllMocks(); });
describe("Operator Settings source and permission boundaries", () => {
  it("refused staff reads hide even a previously returned roster", async () => {
    vi.mocked(useTeamPulse).mockReturnValue({ loading: false, error: "42501", seats: [{ userId: "test", email: "private@example.test", fullName: "Private staff", role: "super_admin" }] });
    await mount(<TeamSettings />);
    expect(node.textContent).not.toContain("private@example.test");
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("access was refused");
  });
  it("distinguishes loading, no returned staff, and recorded seats without invitation controls", async () => {
    const mock = vi.mocked(useTeamPulse);
    mock.mockReturnValue({ loading: true, error: null, seats: [] }); await mount(<TeamSettings />);
    expect(node.textContent).toContain("Loading platform staff");
    mock.mockReturnValue({ loading: false, error: null, seats: [] }); await act(async () => root.render(<TeamSettings />));
    expect(node.textContent).toContain("No platform staff records returned");
    mock.mockReturnValue({ loading: false, error: null, seats: [{ userId: "test", email: "staff@example.test", fullName: "Test staff", role: "platform_admin" }] });
    await act(async () => root.render(<TeamSettings />));
    expect(node.textContent).toContain("Test staff"); expect(node.textContent).toContain("Platform administrator");
    expect(node.querySelector("form")).toBeNull(); expect(node.textContent).toContain("grants no new access");
  });
  it("connection destination stays truthful absence; billing exposes real reads with no action controls", async () => {
    // O-2: the billing desk reads the gated overview RPC — the test owns its double.
    vi.mocked(useBillingOverview).mockReturnValue({
      loading: false, error: null, funnel: [{ step: "signed_up", count: 1 }],
      data: {
        summary: {
          subscriptions_total: 1, trialing: 1, active_paid: 0, past_due: 0, canceled: 0,
          arr_cents: 0, collected_cash_cents: 0, open_receivables_cents: 0,
          failed_or_open_invoices: 0, upcoming_renewals_30d: 1, billing_accounts: 1,
        },
        subscriptions: [{
          tenant_id: "t1", tenant_name: "Acmey Advisory", plan_name: "Solo", plan_slug: "solo",
          status: "trialing", billing_period: "monthly", monthly_cents: 14900, annual_cents: 149000,
          trial_started_at: null, trial_ends_at: "2026-11-17T00:00:00Z",
          current_period_start: null, current_period_end: "2026-11-17T00:00:00Z",
          cancel_at_period_end: false, stripe_subscription_id: "sub_test", provider_mode: "live",
          offer_code: "paige-solo-beta-monthly-v1", is_paid: false,
        }],
        invoices: [],
        billing_accounts: [{ tenant_id: "t1", tenant_name: "Acmey Advisory", stripe_customer_id: "cus_test", payment_method_brand: null, payment_method_last4: null, payment_method_exp_month: null, payment_method_exp_year: null, payment_method_connected_at: null }],
      },
    });
    await mount(<><ConnectionsSettings /><BillingSettings /></>);
    expect(node.textContent).toContain("verified platform connection inventory");
    // Billing truth: collected cash reads from paid invoices only; trials are not cash.
    expect(node.textContent).toContain("Collected cash");
    expect(node.textContent).toContain("no paid invoice yet");
    expect(node.textContent).toContain("not cash yet");
    expect(node.textContent).toContain("performs no money action");
    expect(node.textContent).toContain("signed_up");
    expect(Array.from(node.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toContain("/operator/settings/connections/numbers");
    expect(node.querySelector("input")).toBeNull(); expect(node.querySelector("button")).toBeNull();
  });
  it("analytics uses all five existing destinations rather than a duplicate engine", async () => {
    await mount(<AnalyticsSettings />);
    const paths = Array.from(node.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(paths).toHaveLength(5); expect(paths.every((path) => path?.startsWith("/operator/analytics/"))).toBe(true);
    expect(new Set(paths).size).toBe(5);
  });
});
