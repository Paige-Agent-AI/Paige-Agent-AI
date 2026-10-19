import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";

// E09 F2 — the /app funding and credit pages open only for a finance-entitled business (owner ruling 2026-10-19).
// Synthetic only (Northwind Studio, Jordan Rivera); never a real account.
const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => f.rpc(...a) } }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: false, loading: false }) }));
const { CustomerFinanceRoute } = await import("./FundingRoute");
const { resetFinanceEntitlementCache } = await import("@/hooks/useFinanceEntitlement");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every /app page that is funding or credit, as App.tsx mounts them. */
const FINANCE_PATHS = ["credit", "funding", "funding-journey", "disputes", "business", "business-profile", "financial-profile"];

const frame = (finance: boolean | undefined) => ({
  actorId: "u1", profile: { id: "c1", tenant_id: "t1", first_name: "Jordan", last_name: "Rivera", entity_name: null },
  brand: { tenant_id: "t1", tenant_name: "Northwind Studio" },
  config: finance === undefined ? {} : { entitlements: { finance } },
}) as unknown as CustomerIdentityState["frame"];

const VIEWERS: Record<string, { state: CustomerIdentityState; open: boolean; staffRead?: boolean }> = {
  "customer of an entitled business": { state: { frame: frame(true), phase: "ready" }, open: true },
  "customer of a business that is not entitled": { state: { frame: frame(false), phase: "ready" }, open: false },
  "customer whose config says nothing": { state: { frame: frame(undefined), phase: "ready" }, open: false },
  // Q5 (option a): staff keep what they had until their business has a deliberate install.
  "staff of a business that is not entitled": { state: { frame: null, phase: "not-client", staff: true }, open: true, staffRead: false },
  "a person whose access is not active": { state: { frame: null, phase: "not-client", staff: false }, open: false, staffRead: false },
  "a person whose access is not active, in an entitled current workspace": { state: { frame: null, phase: "not-client", staff: false }, open: true, staffRead: true },
};

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  resetFinanceEntitlementCache(); f.rpc.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const mount = async (path: string, state: CustomerIdentityState | null) => {
  const routes = (
    <MemoryRouter initialEntries={[`/app/${path}`]}>
      <Routes>
        <Route path="/app" element={<p>Portal home</p>} />
        <Route path={`/app/${path}`} element={<CustomerFinanceRoute><p>Finance page</p></CustomerFinanceRoute>} />
      </Routes>
    </MemoryRouter>
  );
  await act(async () => root.render(state ? <CustomerIdentityProvider state={state}>{routes}</CustomerIdentityProvider> : routes));
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
};

describe("CustomerFinanceRoute × every funding/credit path × viewer", () => {
  for (const path of FINANCE_PATHS) {
    for (const [name, v] of Object.entries(VIEWERS)) {
      it(`/app/${path} — ${name}`, async () => {
        f.rpc.mockResolvedValue({ data: v.staffRead ?? false, error: null });
        await mount(path, v.state);
        expect(host.textContent).toBe(v.open ? "Finance page" : "Portal home");
        // A customer's answer comes from their frame; nobody else's frame is consulted, and a customer never asks
        // the staff wrapper.
        if (v.state.frame) expect(f.rpc).not.toHaveBeenCalled();
      });
    }
  }

  it("holds a skeleton, never the page, while the viewer is still being checked", async () => {
    await mount("credit", { frame: null, phase: "loading" });
    expect(host.querySelector('[data-testid="customer-finance-route-loading"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Finance page");
  });

  it("outside the shell, a failed entitlement read is not entitled", async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await mount("credit", null);
    expect(f.rpc).toHaveBeenCalledWith("current_tenant_finance_entitled");
    expect(host.textContent).toBe("Portal home");
  });
});

describe("App.tsx mounts every funding/credit page behind the guard", () => {
  const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
  for (const path of FINANCE_PATHS) {
    it(`/app/${path}`, () => {
      const line = app.split("\n").find((l) => l.includes(`<Route path="${path}" element=`));
      expect(line, path).toBeDefined();
      expect(line).toMatch(/element=\{<CustomerFinanceRoute>/);
    });
  }
});
