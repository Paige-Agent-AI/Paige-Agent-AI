import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Support from "./Support";

const f = vi.hoisted(() => ({
  brand: null as null | { tenant_id: string; tenant_name: string; logo_url: null; primary_color: null },
  loading: false,
  error: false,
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrandState: () => ({ brand: f.brand, loading: f.loading, error: f.error }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));
vi.mock("@/components/support/NewTicketDialog", () => ({ NewTicketDialog: () => null }));
vi.mock("@/components/support/ClientTicketThread", () => ({ ClientTicketThread: () => null }));
vi.mock("@/components/support/NewFeatureRequestDialog", () => ({ NewFeatureRequestDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; }
let root: Root, host: HTMLDivElement;
const render = async () => act(async () => root.render(
  <MemoryRouter initialEntries={["/app/support"]}>
    <Routes>
      <Route path="/app/support" element={<Support />} />
      <Route path="/app/messages" element={<p>Customer thread</p>} />
    </Routes>
    <Where />
  </MemoryRouter>,
));
const where = () => host.querySelector('[data-testid="where"]')?.textContent;

beforeEach(() => {
  f.brand = null; f.loading = false; f.error = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("sends a customer of a business to Contact your team instead of the platform desk", async () => {
  f.brand = { tenant_id: "e0923000-0000-0000-0000-000000000001", tenant_name: "Northwind Studio", logo_url: null, primary_color: null };
  await render();
  expect(where()).toBe("/app/messages?topic=help");
  expect(host.textContent).toContain("Customer thread");
});

it("keeps the platform support desk for staff and owners with no customer relationship", async () => {
  await render();
  expect(where()).toBe("/app/support");
  expect(host.textContent).not.toContain("Customer thread");
  // The platform desk itself mounted (its own signed-out state, since the mocked session is empty).
  expect(host.textContent).toContain("Sign in to access support.");
});

it("renders nothing platform-side while the relationship is still resolving", async () => {
  f.loading = true;
  await render();
  expect(where()).toBe("/app/support");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading support");
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
});

it("does not guess when the relationship check fails", async () => {
  f.error = true;
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn't check your account");
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
});
