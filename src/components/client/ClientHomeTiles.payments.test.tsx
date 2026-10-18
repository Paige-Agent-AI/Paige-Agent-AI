import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientHomeTiles } from "./ClientHomeTiles";
import { PORTAL_MENU_ENTRIES } from "@/lib/portal/portalMenu";

// E09 Slice 5 — the quiet Payments line above the Home tiles. Synthetic tenant (Northwind Studio) only.
const T = "e0950000-0000-4000-8000-000000000001";
const f = vi.hoisted(() => ({
  invoices: vi.fn(),
  brand: null as null | { tenant_id: string; tenant_name: string },
  multiple: false,
  modules: [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }] as { key: string; label: string }[],
  overlay: undefined as undefined | { key: string; visible?: boolean }[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const counted = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain; chain.eq = () => chain; chain.neq = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve);
    return chain;
  };
  const rpc = (name: string, args: unknown) => (name === "client_portal_invoices" ? f.invoices(args) : Promise.resolve({ data: null, error: null }));
  return { supabase: { from: () => counted(), rpc } };
});
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Paige" }, quickActions: [], portal: { modules: f.modules } }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfigState: () => ({ config: { modules: f.overlay }, loading: false }) }));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrandState: () => ({ brand: f.brand, loading: false, error: false, multipleBusinesses: f.multiple }),
}));
vi.mock("@/hooks/useMyActions", () => ({ useMyActions: () => ({ open: [], loading: false, error: null }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const id = (n: number) => `e0950000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const inv = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n), invoice_number: `INV-00${n}`, status: "issued", currency: "usd", issued_at: "2026-10-02T15:00:00Z",
  due_date: "2026-10-30", amount_minor: "125000", remaining_minor: "125000", provider_verified_minor: "0",
  manual_recorded_minor: "0", test_provider_minor: "0", payable: false, past_due: false, ...extra,
});
const page = (invoices: unknown[], open: number, remaining: string) => ({
  data: {
    schema_version: 1, tenant_id: T, business_name: "Northwind Studio", invoices, invoice_count: Math.max(invoices.length, open), has_more: false,
    next_cursor: null, open_count: open, read_at: "2026-10-17T12:00:00Z",
    balances: [{ currency: "usd", remaining_minor: remaining, provider_verified_minor: "0", manual_recorded_minor: "0", test_provider_minor: "0" }],
  },
  error: null,
});

let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<ClientHomeTiles userId="u1" />} />
        <Route path="/app/billing" element={<p>Payments page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
};
const line = () => host.querySelector("[data-testid=payments-balance-line]");

beforeEach(() => {
  f.invoices.mockReset();
  f.multiple = false;
  f.modules = [{ key: "home", label: "Home" }, { key: "billing", label: "Billing" }];
  f.overlay = undefined;
  f.brand = { tenant_id: T, tenant_name: "Northwind Studio" };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("shows one quiet line while something is owed, and it opens Payments", async () => {
  f.invoices.mockResolvedValue(page([inv(1, { past_due: true }), inv(2)], 2, "250000"));
  await render();
  expect(line()?.textContent?.replace(/\s+/g, " ").trim()).toBe("$2,500.00 due · 2 open invoices from Northwind Studio · 1 past dueView payments");
  expect(line()?.getAttribute("href")).toBe("/app/billing");
  // It sits above the tile grid, never as a seventh tile.
  expect(host.firstElementChild).toBe(line());
  expect(f.invoices).toHaveBeenCalledWith({ p_tenant_id: null, p_limit: 40, p_after: null });
});

it("carries the Payments menu entry's own icon, so one destination has one mark", async () => {
  f.invoices.mockResolvedValue(page([inv(1)], 1, "125000"));
  await render();
  const MenuIcon = PORTAL_MENU_ENTRIES.find((e) => e.key === "billing")!.icon;
  const lucide = (cls: string | null | undefined) => (cls ?? "").split(/\s+/).filter((c) => c.startsWith("lucide-")).sort();
  const menuMark = lucide(/class="([^"]*)"/.exec(renderToStaticMarkup(<MenuIcon />))?.[1]);
  expect(menuMark.length).toBeGreaterThan(0);
  expect(lucide(line()!.querySelector("svg")?.getAttribute("class"))).toEqual(menuMark);
});

it("renders nothing when nothing is owed, on a failed read, or for someone who is not a customer", async () => {
  f.invoices.mockResolvedValue(page([inv(1, { remaining_minor: "0" })], 0, "0"));
  await render();
  expect(line()).toBeNull();
  act(() => root.unmount()); root = createRoot(host);
  f.invoices.mockResolvedValue({ data: null, error: { code: "PGRST000", message: "network" } });
  await render();
  expect(line()).toBeNull();
  act(() => root.unmount()); root = createRoot(host);
  f.invoices.mockClear();
  f.brand = null;
  await render();
  expect(line()).toBeNull();
  expect(f.invoices).not.toHaveBeenCalled();
});

// ── Round 2 ──────────────────────────────────────────────────────────────────────────────────────────

it("shows only when Payments is a menu entry for this customer: the same catalog and overlay decision the nav makes", async () => {
  f.invoices.mockResolvedValue(page([inv(1)], 1, "125000"));
  f.overlay = [{ key: "billing", visible: false }];
  await render();
  expect(line()).toBeNull();
  expect(f.invoices).not.toHaveBeenCalled();
  act(() => root.unmount()); root = createRoot(host);
  f.overlay = undefined;
  f.modules = [{ key: "home", label: "Home" }];
  await render();
  expect(line()).toBeNull();
  expect(f.invoices).not.toHaveBeenCalled();
});

it("on a phone the amount leads, the past-due count never splits, and the link sits under the words", async () => {
  f.invoices.mockResolvedValue(page([inv(1, { past_due: true }), inv(2)], 2, "250000"));
  await render();
  const owed = host.querySelector("[data-testid=payments-balance-owed]")!;
  expect(owed.textContent).toBe("$2,500.00 due");
  expect(owed.className).toMatch(/font-semibold/);
  expect(host.querySelector("[data-testid=payments-balance-past-due]")!.className).toMatch(/whitespace-nowrap/);
  // Stacked below the sm breakpoint, side by side from it.
  expect(line()!.className.split(" ")).toEqual(expect.arrayContaining(["flex-col", "sm:flex-row"]));
});
