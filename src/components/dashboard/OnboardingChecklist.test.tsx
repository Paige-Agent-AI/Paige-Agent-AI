import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";

// E09 F2 — Getting Started. Synthetic only (Northwind Studio, Jordan Rivera); never a real account.
const TENANT = "e0f20000-0000-4000-8000-00000000000a", CONTACT = "e0f20000-0000-4000-8000-0000000000c1", ACTOR = "e0f20000-0000-4000-8000-0000000000a2";
const f = vi.hoisted(() => ({
  reads: [] as { table: string; filters: [string, unknown][] }[],
  counts: {} as Record<string, number>,
  fundingReadiness: false,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const read = { table, filters: [] as [string, unknown][] };
  f.reads.push(read);
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => { read.filters.push([col, val]); return chain; };
  chain.maybeSingle = () => Promise.resolve({ data: { full_name: "" }, error: null });
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ count: f.counts[table] ?? 0, error: null }).then(ok);
  return chain;
} } }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: f.fundingReadiness, loading: false }) }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: () => Promise.resolve() }));
const { OnboardingChecklist } = await import("./OnboardingChecklist");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const customer = {
  frame: { actorId: ACTOR, profile: { id: CONTACT, tenant_id: TENANT, first_name: "Jordan", last_name: "Rivera", entity_name: null },
    brand: { tenant_id: TENANT, tenant_name: "Northwind Studio" }, config: {} },
  phase: "ready",
} as unknown as CustomerIdentityState;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  f.reads = []; f.counts = {}; f.fundingReadiness = false; localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (state: CustomerIdentityState, financePortal = false, userId = ACTOR) => {
  await act(async () => root.render(
    <CustomerIdentityProvider state={state}>
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route path="/app" element={<OnboardingChecklist userId={userId} financePortal={financePortal} />} />
          <Route path="/app/documents" element={<p>Documents page</p>} />
          <Route path="/app/credit" element={<p>Credit page</p>} />
        </Routes>
      </MemoryRouter>
    </CustomerIdentityProvider>,
  ));
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
};
const uploadRow = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Upload Your First Document"));

describe("the document step", () => {
  it("routes to /app/documents and counts the customer's OWN saved uploads in their Documents scope", async () => {
    await mount(customer);
    const files = f.reads.find((r) => r.table === "client_files");
    expect(files?.filters).toEqual([["tenant_id", TENANT], ["contact_id", CONTACT], ["uploaded_by_user_id", ACTOR], ["upload_state", "ready"]]);
    expect(f.reads.some((r) => r.table === "documents")).toBe(false);
    await act(async () => uploadRow()!.click());
    expect(host.textContent).toBe("Documents page");
  });

  it("ticks once the customer has saved one upload (§70: the step can be completed)", async () => {
    f.counts.client_files = 1;
    await mount(customer);
    const row = uploadRow()!;
    expect(row.disabled).toBe(true);
    expect(row.querySelector("p")?.className).toContain("line-through");
    expect(host.textContent).toMatch(/1\/3/);
  });

  it("a viewer with no customer frame keeps the legacy count, unchanged (§58)", async () => {
    await mount({ frame: null, phase: "not-client", staff: true });
    const legacy = f.reads.find((r) => r.table === "documents");
    expect(legacy?.filters).toEqual([["user_id", ACTOR]]);
    expect(f.reads.some((r) => r.table === "client_files")).toBe(false);
  });
});

describe("the credit-first steps need funding_readiness AND the entitlement", () => {
  const creditSteps = () => /Credit Report|Review Your Accounts|Business Profile/.test(host.textContent ?? "");
  it("funding_readiness alone: the neutral steps", async () => {
    f.fundingReadiness = true;
    await mount(customer, false);
    expect(creditSteps()).toBe(false);
    expect(f.reads.some((r) => r.table === "credit_report_uploads")).toBe(false);
  });
  it("the entitlement alone: the neutral steps (nothing dark becomes visible)", async () => {
    await mount(customer, true);
    expect(creditSteps()).toBe(false);
  });
  it("CONTROL: both — the credit-first steps, as before", async () => {
    f.fundingReadiness = true;
    await mount(customer, true);
    expect(creditSteps()).toBe(true);
  });
});
