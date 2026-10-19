import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FileSignature, Home } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgreementsWaitingLine } from "./AgreementsWaitingLine";
import type { PortalNavSection } from "@/lib/portal/portalMenu";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-4000-8000-000000000002";
const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  sections: [] as PortalNavSection[],
  ready: true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => f.rpc(...a) } }));
vi.mock("@/hooks/useCustomerPortalNav", () => ({ useCustomerPortalNav: () => ({ sections: f.sections, ready: f.ready }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const withAgreements: PortalNavSection[] = [
  { id: "top", label: null, items: [{ key: "home", label: "Home", href: "/app", icon: Home }] },
  { id: "paperwork", label: "Paperwork", items: [{ key: "agreements", label: "Contracts", href: "/app/agreements", icon: FileSignature }] },
];
const page = (awaiting: number) => ({
  data: {
    tenant_id: T, business_name: "Northwind Studio", server_now: "2026-10-18T12:00:00Z",
    summary: { awaiting_you: awaiting, signed: 0 }, agreements: [], has_more: awaiting > 0,
  },
  error: null,
});

let root: Root, host: HTMLDivElement;
const render = async (enabled = true) => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<AgreementsWaitingLine enabled={enabled} />} />
        <Route path="/app/agreements" element={<p>Agreements page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
};
const line = () => host.querySelector('[data-testid="agreements-waiting-line"]');

beforeEach(() => {
  vi.clearAllMocks();
  f.sections = withAgreements; f.ready = true;
  f.rpc.mockResolvedValue(page(2));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("says how many agreements wait for a signature, from a one-row read, and opens Agreements", async () => {
  await render();
  expect(f.rpc).toHaveBeenCalledWith("client_portal_agreements", { p_tenant_id: null, p_limit: 1 });
  expect(line()?.textContent).toBe("2 agreements waiting for your signatureReview ");
  expect(line()?.getAttribute("href")).toBe("/app/agreements");
  await act(async () => (line() as HTMLElement).click());
  expect(host.textContent).toContain("Agreements page");
});

it("says agreement, singular, for one", async () => {
  f.rpc.mockResolvedValue(page(1));
  await render();
  expect(line()?.textContent).toContain("1 agreement waiting for your signature");
});

it("shows nothing when nothing waits — never a zero", async () => {
  f.rpc.mockResolvedValue(page(0));
  await render();
  expect(line()).toBeNull();
  expect(host.textContent).toBe("");
});

it("shows nothing, and reads nothing, when the business hid Agreements from this customer's menu", async () => {
  f.sections = [withAgreements[0]];
  await render();
  expect(line()).toBeNull();
  expect(f.rpc).not.toHaveBeenCalled();
});

it("waits for the menu to resolve before reading", async () => {
  f.ready = false;
  await render();
  expect(f.rpc).not.toHaveBeenCalled();
  expect(line()).toBeNull();
});

it("shows nothing for someone who is not a single-business customer, a failed read, or no relationship", async () => {
  await render(false);
  expect(f.rpc).not.toHaveBeenCalled();
  expect(line()).toBeNull();
  for (const answer of [{ data: null, error: { code: "PGRST000", message: "network" } }, { data: null, error: null }, { data: { tenant_id: T }, error: null }]) {
    act(() => root.unmount()); root = createRoot(host);
    f.rpc.mockResolvedValue(answer);
    await render();
    expect(line(), JSON.stringify(answer)).toBeNull();
  }
});
