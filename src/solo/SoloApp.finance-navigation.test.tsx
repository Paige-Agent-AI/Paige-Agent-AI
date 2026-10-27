import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi, beforeAll } from "vitest";

// Real SoloApp, boundary, Finance and route hook. Only account/source transports
// and unrelated departments are doubles; this does not establish customer QA.
const port = vi.hoisted(() => ({ actor: "test-owner-a", tenant: "test-business-a", metricPhase: "ready", metrics: [] as unknown[] }));
vi.mock("@/hooks/useTenantContext", () => {
 const tenantContext = () => ({ activeUserId: port.actor,
  activeTenantId: port.tenant, loading: false, accountContextStatus: "ready", isPlatformStaff: false,
  activeTenant: { account_number: "123", name: "Synthetic company", account_type: "standalone", features: { solo_setup_completed: true } } });
 return { useTenantContext: tenantContext, useOptionalTenantContext: tenantContext };
});
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], allItems: [], loading: false, error: null, forbidden: false, refresh: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = new Proxy(function () {} as never, {
    get: (_target, prop: string) => {
      if (["then", "catch", "finally"].includes(prop)) return undefined;
      if (prop === "rpc") return async () => ({ data: null, error: null });
      if (prop === "channel" || prop === "removeChannel") {
        const channel = { on: () => channel, subscribe: () => ({ unsubscribe: () => {} }) };
        return () => channel;
      }
      if (prop === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) };
      return () => chain;
    },
    apply: () => ({ data: [], error: null, count: 0 }),
  });
  return { supabase: chain };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/hooks/usePendingApprovals", () => ({ usePendingApprovals: () => ({ items: [] }) }));
vi.mock("@/components/auth/WorkspaceExitControl", () => ({ WorkspaceExitControl: () => null }));
vi.mock("@/components/admin/voice/DialPadSurface", () => ({ DialPadSurface: () => null }));
vi.mock("@/components/admin/voice/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("@/components/admin/voice/LiveTranscriptPanel", () => ({ LiveTranscriptPanel: () => null }));
vi.mock("./SoloSetupReadinessNotice", () => ({ SoloSetupReadinessNotice: () => null }));
vi.mock("./SoloPaigeWorkspace", () => ({ SoloPaigeWorkspace: () => <textarea aria-label="Protected conversation draft" defaultValue="Unsent discussion" /> }));
vi.mock("./CommandCenter", () => ({ CommandHub: () => null }));
vi.mock("./conversations", () => ({ ClientsHub: () => null }));
vi.mock("@/components/tenant-relationships/TenantRelationshipsClientsWorkspace", () => ({ TenantRelationshipsClientsWorkspace: () => null }));
vi.mock("./growth2", () => ({ GrowthHub: () => null }));
vi.mock("./AdsWorkspace", () => ({ AdsWorkspace: () => null }));
vi.mock("./SalesWorkspace", () => ({ SalesWorkspace: () => null }));
vi.mock("./settings", () => ({ SoloSettings: () => null }));
vi.mock("@/components/tenant-calendar/TenantCanonicalCalendarWorkspace", () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock("./marketplace", () => ({ Marketplace: () => null }));
vi.mock("./vault/useBusinessVault", () => ({ useVaultAccess: () => ({}), canShowVaultNavigation: () => false }));
vi.mock("./vibe", () => ({ VibeStudio: () => null }));
vi.mock("@/components/ui/paige", () => ({ AgentPresenceProvider: ({ children }: React.PropsWithChildren) => children,
  useAgentPresence: () => ({ expandRail: vi.fn(), railExpanded: true }) }));
vi.mock("@/lib/voice/VoiceDeviceProvider", () => ({ VoiceDeviceProvider: ({ children }: React.PropsWithChildren) => children, useVoiceDevice: () => null }));
vi.mock("./sales/performance/useSalesPerformanceMetrics", () => ({ useSalesPerformanceMetrics: () => ({ phase: port.metricPhase, metrics: port.metrics, retry: vi.fn(), unavailableKeys: {} }) }));
vi.mock("./finance/useFinanceInvoices", () => ({ useFinanceInvoices: () => ({ identity: port.tenant, phase: "ready", rows: [], hasMore: false, readAt: null, retry: vi.fn() }) }));
vi.mock("./data/useBusinessReview", () => ({ useBusinessReview: () => ({ state: "failed", refresh: vi.fn() }) }));
import SoloApp from "./SoloApp";

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { port.actor = "test-owner-a"; port.tenant = "test-business-a"; port.metricPhase = "ready"; port.metrics = []; sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function Address() {
  const location = useLocation(), navigate = useNavigate();
  return <div><output data-actual-address>{location.pathname}</output><button onClick={() => navigate(-1)}>Previous address</button><button onClick={() => navigate(1)}>Next address</button></div>;
}
// Route-level code split (E01 PR9): the Finance screen loads lazily inside
// SoloApp. Pre-warm at file scope (vitest transforms on first import — the eager
// world paid this at module load) and wait for the real screen before asserting.
const financeWarm = import("./finance/FinanceWorkspace");
beforeAll(async () => { await financeWarm; }, 60_000);
const render = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/solo/123/finance/overview"]}><Address /><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes></MemoryRouter>));
  for (let attempt = 0; attempt < 40 && !host.querySelector(".finance-toolbar"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
};
const selected = () => host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
const draft = () => host.querySelector<HTMLTextAreaElement>('[aria-label="Protected conversation draft"]')!;
async function key(value: string) {
  // Dispatch to the ACTUAL active element; refocusing a queried tab per key
  // would conceal the released document-focus failure this suite reproduces.
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}

it("keeps one connected tablist for continuous End, arrows, wraparound and Home", async () => {
  await render(); const original = selected(), conversation = draft(); original.focus();
  for (const [press, label, slug] of [["End", "Budgeting & Forecasting", "budgeting-forecasting"], ["ArrowLeft", "Profitability", "profitability"], ["Home", "Overview", "overview"], ["ArrowLeft", "Budgeting & Forecasting", "budgeting-forecasting"], ["ArrowRight", "Overview", "overview"]]) {
    await key(press);
    expect(selected().textContent).toBe(label);
    expect(host.querySelector("output")?.textContent).toBe(`/solo/123/finance/${slug}`);
    expect(document.activeElement).toBe(selected()); expect(original.isConnected).toBe(true);
    expect(draft()).toBe(conversation); expect(conversation.value).toBe("Unsent discussion");
  }
});

it("retains healthy Finance state on subtab and history navigation, but resets it for another actor/business", async () => {
  await render(); const period = host.querySelector<HTMLSelectElement>(".finance-toolbar select")!, conversation = draft();
  await act(async () => { period.value = "quarter"; period.dispatchEvent(new Event("change", { bubbles: true })); });
  selected().focus(); await key("End"); await key("Home");
  expect(host.querySelector<HTMLSelectElement>(".finance-toolbar select")?.value).toBe("quarter");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Previous address")!.click());
  expect(selected().textContent).toBe("Budgeting & Forecasting");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Next address")!.click());
  expect(selected().textContent).toBe("Overview"); expect(draft()).toBe(conversation);
  const original = selected(); port.actor = "test-owner-b"; port.tenant = "test-business-b"; await render();
  expect(original.isConnected).toBe(false);
  expect(host.querySelector<HTMLSelectElement>(".finance-toolbar select")?.value).toBe("month");
});

it("retains the original departmental refusal rather than exposing finance actions", async () => {
  port.metricPhase = "denied"; await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Financial access is restricted");
  expect(host.querySelector(".finance-primary")).toBeNull();
});

it("closes source evidence on history navigation without restoring a retired page trigger", async () => {
  port.metrics = [{ metric_key: "sales.receivables.outstanding_current", label: "Original source amount", definition: "Synthetic source only",
    truth_state: "PARTIAL", evidence_ref: "synthetic-original-reference", reference_expires_at: "2099-01-01T00:00:00Z",
    values: { kind: "currency_totals", by_currency: [{ currency: "USD", amount_minor: "10000", record_count: 1 }] },
    coverage: { contributing_count: 1, excluded_count: 0 }, range: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z", semantics: "current_snapshot" },
    as_of: "2026-10-01T00:00:00Z", caveats: [], exclusions: [], source_refs: ["synthetic"] }];
  await render();
  selected().focus(); await key("ArrowRight"); await key("Home");
  const trigger = host.querySelector<HTMLButtonElement>(".finance-value")!;
  await act(async () => trigger.click()); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Previous address")!.click());
  expect(selected().textContent).toBe("Banking & Cash");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).not.toBe(trigger);
});
