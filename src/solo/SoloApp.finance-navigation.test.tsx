import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Real SoloApp, boundary, Finance and route hook. Only account/source transports
// and unrelated departments are doubles; this does not establish customer QA.
const port = vi.hoisted(() => ({ actor: "test-owner-a", tenant: "test-business-a", metricPhase: "ready" }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: port.actor,
  activeTenantId: port.tenant, loading: false, accountContextStatus: "ready", isPlatformStaff: false,
  activeTenant: { account_number: "123", name: "Synthetic company", account_type: "standalone", features: { solo_setup_completed: true } } }) }));
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
vi.mock("./sales/performance/useSalesPerformanceMetrics", () => ({ useSalesPerformanceMetrics: () => ({ phase: port.metricPhase, metrics: [], retry: vi.fn(), unavailableKeys: {} }) }));
vi.mock("./finance/useFinanceInvoices", () => ({ useFinanceInvoices: () => ({ identity: port.tenant, phase: "ready", rows: [], hasMore: false, readAt: null, retry: vi.fn() }) }));
vi.mock("./data/useBusinessReview", () => ({ useBusinessReview: () => ({ state: "failed", refresh: vi.fn() }) }));
import SoloApp from "./SoloApp";

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { port.actor = "test-owner-a"; port.tenant = "test-business-a"; port.metricPhase = "ready"; sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function Address() {
  const location = useLocation(), navigate = useNavigate();
  return <div><output data-actual-address>{location.pathname}</output><button onClick={() => navigate(-1)}>Previous address</button><button onClick={() => navigate(1)}>Next address</button></div>;
}
const render = () => act(async () => root.render(<MemoryRouter initialEntries={["/solo/123/finance/overview"]}><Address /><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes></MemoryRouter>));
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
