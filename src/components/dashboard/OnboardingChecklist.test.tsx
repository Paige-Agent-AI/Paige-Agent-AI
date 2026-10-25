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
  pendingDocs: {} as Record<string, Promise<{ count: number; error: null }>>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const read = { table, filters: [] as [string, unknown][] };
  f.reads.push(read);
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => { read.filters.push([col, val]); return chain; };
  chain.maybeSingle = () => Promise.resolve({ data: { full_name: "" }, error: null });
  chain.then = (ok: (v: unknown) => unknown) => {
    const tenant = read.filters.find(([key]) => key === "tenant_id")?.[1];
    const pending = table === "client_files" && typeof tenant === "string" ? f.pendingDocs[tenant] : undefined;
    return (pending ?? Promise.resolve({ count: f.counts[table] ?? 0, error: null })).then(ok);
  };
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
  f.reads = []; f.counts = {}; f.pendingDocs = {}; f.fundingReadiness = false; localStorage.clear();
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
          <Route path="/app/account" element={<p>Customer profile and consent page</p>} />
          <Route path="/app/credit" element={<p>Credit page</p>} />
        </Routes>
      </MemoryRouter>
    </CustomerIdentityProvider>,
  ));
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
};
const uploadRow = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Upload Your First Document"));

describe("saved customer identity and relationship bookkeeping", () => {
  it("offers customer profile and Documents steps, never the unconnected legacy goal step", async () => {
    await mount(customer);
    expect(host.textContent).not.toContain("Set Your First Goal");
    expect(host.textContent).toMatch(/1\/2/);
    expect(f.reads.some(r => r.table === "client_goals")).toBe(false);
  });

  it("opens the original relationship profile when the customer's name is missing", async () => {
    const unnamed = { ...customer, frame: { ...customer.frame!, profile: { ...customer.frame!.profile,
      first_name: "", last_name: "", entity_name: null } } } as CustomerIdentityState;
    await mount(unnamed);
    const profile = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Complete Your Profile"))!;
    await act(async () => profile.click());
    expect(host.textContent).toBe("Customer profile and consent page");
  });

  it("finishes the optional customer checklist only from both saved original results", async () => {
    f.counts.client_files = 1;
    await mount(customer);
    expect(host.textContent).toBe("");
    expect(localStorage.getItem(`onboarding_dismissed_${TENANT}:${CONTACT}:${ACTOR}`)).toBe("true");
  });

  it("recognizes the saved CRM name without querying the legacy platform profile", async () => {
    await mount(customer);
    const profile = [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Complete Your Profile"));
    expect(profile?.disabled).toBe(true);
    expect(host.textContent).toMatch(/1\/2/);
    expect(f.reads.some(r => r.table === "profiles")).toBe(false);
  });

  it("does not reuse a legacy per-user dismissal for a customer business", async () => {
    localStorage.setItem(`onboarding_dismissed_${ACTOR}`, "true");
    await mount(customer);
    expect(host.textContent).toContain("Getting Started");
  });

  it("does not let an interrupted prior-business read change the next business", async () => {
    let settle!: (v: { count: number; error: null }) => void;
    f.pendingDocs[TENANT] = new Promise(resolve => { settle = resolve; });
    await mount(customer);
    const other = { ...customer, frame: { ...customer.frame!, profile: { ...customer.frame!.profile,
      tenant_id: "e0f20000-0000-4000-8000-00000000000b", first_name: "", last_name: "", entity_name: null },
      brand: { ...customer.frame!.brand, tenant_id: "e0f20000-0000-4000-8000-00000000000b" } } } as CustomerIdentityState;
    await mount(other);
    expect(host.textContent).toMatch(/0\/2/);
    await act(async () => { settle({ count: 1, error: null }); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    expect(host.textContent).toMatch(/0\/2/);
    expect(uploadRow()?.disabled).toBe(false);
  });

  it("keeps a business dismissal separate and restores it when returning", async () => {
    await mount(customer);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss getting started"]')!.click());
    expect(host.textContent).toBe("");
    const tenant = "e0f20000-0000-4000-8000-00000000000b";
    const other = { ...customer, frame: { ...customer.frame!, profile: { ...customer.frame!.profile, tenant_id: tenant },
      brand: { ...customer.frame!.brand, tenant_id: tenant } } } as CustomerIdentityState;
    await mount(other);
    expect(host.textContent).toContain("Getting Started");
    await mount(customer);
    expect(host.textContent).toBe("");
  });

  it("does not query or show a checklist for unknown or inactive customer standing", async () => {
    await mount({ frame: null, phase: "loading" });
    expect(f.reads).toEqual([]);
    expect(host.textContent).toBe("");
    await mount({ frame: null, phase: "unavailable", staff: false });
    expect(f.reads).toEqual([]);
    expect(host.textContent).toBe("");
  });

  it("ignores corrupt scoped bookkeeping without losing the saved-profile result", async () => {
    localStorage.setItem(`onboarding_steps_fired_${TENANT}:${CONTACT}:${ACTOR}`, "{");
    await mount(customer);
    expect(host.textContent).toMatch(/1\/2/);
  });

  it("keeps the saved-profile result usable when local storage is blocked", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Synthetic storage refusal"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Synthetic storage refusal"); });
    try { await mount(customer); expect(host.textContent).toMatch(/1\/2/); }
    finally { read.mockRestore(); write.mockRestore(); }
  });
});

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
    const unnamed = { ...customer, frame: { ...customer.frame!, profile: { ...customer.frame!.profile,
      first_name: "", last_name: "", entity_name: null } } } as CustomerIdentityState;
    await mount(unnamed);
    const row = uploadRow()!;
    expect(row.disabled).toBe(true);
    expect(row.querySelector("p")?.className).toContain("line-through");
    expect(host.textContent).toMatch(/1\/2/);
  });

  it("a viewer with no customer frame keeps the legacy count, unchanged (§58)", async () => {
    await mount({ frame: null, phase: "not-client", staff: true });
    const legacy = f.reads.find((r) => r.table === "documents");
    expect(legacy?.filters).toEqual([["user_id", ACTOR]]);
    expect(f.reads.some((r) => r.table === "client_files")).toBe(false);
    expect(f.reads.some((r) => r.table === "client_goals")).toBe(true);
    expect(host.textContent).toContain("Set Your First Goal");
    expect(host.textContent).toMatch(/0\/3/);
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
