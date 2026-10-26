import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 Slice 6 (D6, §2, reviewer Minors 1 and 4): what Data & Privacy may say depends on who is looking.
// Synthetic business only (§63).
const f = vi.hoisted(() => ({
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null; support_email?: string | null },
  loading: false, error: false, multiple: false, funding: false, fundingLoading: false,
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({ useClientPortalBrandState: () => ({ brand: f.brand, loading: f.loading, error: f.error, multipleBusinesses: f.multiple }) }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: (key: string) => ({ enabled: key === "funding_readiness" && f.funding, loading: f.fundingLoading }) }));
vi.mock("@/components/security/SecurityBadge", async () => {
  const { createElement } = await import("react");
  return { SecurityBadge: () => createElement("span", { "data-testid": "security-badge" }, "Bank-Grade Security") };
});
vi.mock("@/lib/downloadMyUserData", () => ({ downloadMyUserData: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { DataPrivacyPanel } = await import("./DataPrivacyPanel");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FINANCE = /credit|fundab|financial|funding|lend|loan/i;
let root: Root, host: HTMLDivElement;
async function render() { await act(async () => root.render(<MemoryRouter><DataPrivacyPanel /></MemoryRouter>)); }
const manage = () => host.querySelector<HTMLAnchorElement>('a[href*="client-account"]');
const customer = () => { f.brand = { tenant_id: "e0960000-0000-4000-8000-00000000b001", tenant_name: "Northwind Studio", logo_url: null, primary_color: null }; };

beforeEach(() => {
  f.brand = null; f.loading = false; f.error = false; f.multiple = false; f.funding = false; f.fundingLoading = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Data & Privacy", () => {
  it("a customer sees no credit control or finance wording, even when the business's workspace has the funding preset (fail-safe)", async () => {
    customer(); f.funding = true; await render();
    expect(host.textContent).not.toMatch(FINANCE);
    expect(host.textContent).not.toContain("Delete Credit Data");
  });

  it("a customer's Manage goes to their own preferences, and the export says what it does not hold", async () => {
    customer(); await render();
    expect(manage()?.getAttribute("href")).toBe("/app/settings?view=client-account#preferences");
    expect(host.textContent).toContain("It doesn't include the records Northwind Studio keeps about you.");
  });

  it("deletion promises no timeframe and routes the business's records to the business (D6)", async () => {
    customer(); await render();
    expect(host.textContent).not.toMatch(/30 days|Processed within/);
    expect(host.textContent).toContain("Ask Northwind Studio to remove your access");
    expect(host.textContent).toContain("Your login and access to other businesses are separate.");
    expect(host.querySelector('a[href^="mailto:privacy@"]')).toBeNull();
    f.brand = null; await render();
    expect(host.textContent).not.toMatch(/30 days|Processed within/);
    expect(host.textContent).toContain("Nothing is deleted automatically.");
  });

  it("staff without the funding preset see no credit control and no dead Manage link", async () => {
    await render();
    expect(host.textContent).not.toMatch(FINANCE);
    expect(host.querySelector('a[href*="tab=notifications"]')).toBeNull();
    expect(manage()).toBeNull();
  });

  it("staff whose workspace chose the funding preset keep the credit control (§58: nothing removed for them)", async () => {
    f.funding = true; await render();
    expect(host.textContent).toContain("Delete Credit Data");
    expect(host.textContent).toContain("credit scores, fundability scores");
  });

  it("while it is unknown who is looking, nothing funding-flavoured renders", async () => {
    f.funding = true; f.loading = true; await render();
    expect(host.textContent).not.toMatch(FINANCE);
    f.loading = false; f.error = true; await render();
    expect(host.textContent).not.toMatch(FINANCE);
    f.error = false; f.fundingLoading = true; await render();
    expect(host.textContent).not.toMatch(FINANCE);
  });

  it("a customer of more than one business gets the customer wording and no Manage link", async () => {
    f.multiple = true; f.funding = true; await render();
    expect(host.textContent).not.toMatch(FINANCE);
    expect(manage()).toBeNull();
  });

  it("no hardcoded amber and no decorative gold (§11)", async () => {
    f.funding = true; await render();
    expect(host.innerHTML).not.toMatch(/amber-|text-accent|bg-accent/);
  });

  it("for a customer: no security pill, Paige by its name, one divided list with no nested cards, and no texts-on promise (should-fix 6/7)", async () => {
    customer(); await render();
    expect(host.querySelector('[data-testid="security-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("PaigeAgent");
    // One bordered card holds one divided list: no bordered box nested inside it (buttons aside).
    const card = host.firstElementChild!;
    expect(Array.from(card.querySelectorAll("div, li")).filter(el => /(^|\s)border(\s|$)|rounded-lg/.test(el.className))).toHaveLength(0);
    expect(card.querySelectorAll("ul.divide-y > li").length).toBeGreaterThanOrEqual(4);
    expect(host.textContent).not.toMatch(/email or text you|choose how .* texts/i);
  });

  it("staff keep the security pill (§58)", async () => {
    await render();
    expect(host.querySelector('[data-testid="security-badge"]')).toBeTruthy();
    expect(host.textContent).not.toContain("PaigeAgent");
  });

  it("uses only the selected business support address, and retires it on switching or losing authority", async () => {
    customer(); f.brand!.support_email = "care@northwind.example"; await render();
    expect(host.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe('mailto:care%40northwind.example');
    expect(host.textContent).toContain('care@northwind.example');
    f.brand = {...f.brand!, tenant_id:'test-business-b',tenant_name:'Harbor Lane',support_email:'help@harbor.example'}; await render();
    expect(host.textContent).not.toContain('northwind.example');
    expect(host.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe('mailto:help%40harbor.example');
    f.loading = true; await render(); expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
    f.loading = false; f.error = true; await render(); expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(host.textContent).not.toContain('help@harbor.example');
  });

  it.each([undefined, '', 'not-an-address', 'care@northwind.example\r\nBcc:private@example.com', 'privacy@paigeagent.ai', 'support@paigeagent.ai'])("keeps business Messages available without an eligible support address: %s", async email => {
    customer(); f.brand!.support_email=email; await render();
    expect(host.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(host.querySelector('a[href="/app/messages?topic=help"]')?.textContent).toBe('Message your business');
    expect(host.textContent).not.toContain('privacy@paigeagent.ai');
  });
});
