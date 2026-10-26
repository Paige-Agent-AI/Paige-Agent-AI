import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeAll, afterEach, beforeEach, expect, it, vi } from "vitest";

// D5 closeout regression: the REAL SoloSettings (no ./settings mock) mounted
// through the REAL SoloApp shell, against a backend double shaped like the
// production get_solo_business_context contract. The 2026-10-20 QA drive saw
// SoloScreenBoundary's "This page couldn't open" on the Setup entry; current
// main and the deployed bundle render the whole tree cleanly with the
// customer's exact payload (including the pending-proposal banner). This suite
// pins that: deep-link canonicalization, rail client-navigation, and the honest
// load-failure recovery state, so a shell-integration break in the settings
// subtree can never again land silently behind the operations-retention mock.
const port = vi.hoisted(() => {
  const healthyRow = {
    brief: { industry: "Consulting", provenance: {}, publicName: "Synthetic company", representativeUserIds: [], businessRegistrationNumberLast4: "" },
    tenantId: "22222222-2222-4222-8222-222222222222",
    tenantName: "Synthetic company",
    accessScope: "owner_full",
    managedEmail: { domain: "mail.paigeagent.ai", address: "synthetic-company@mail.paigeagent.ai", localPart: "synthetic-company", registrationAvailable: true },
    paigeProfile: {},
    voiceExamples: [],
    businessOwners: [],
    contextRevision: 3,
    pendingProposal: {
      id: "e4ec13a8-b629-492f-820c-e2fa29e6eec3",
      patch: { publicName: "Synthetic company", industry: "Consulting" },
      reason: "Synthetic reason prepared for review in Setup.",
      proposedAt: "2026-10-20T04:58:37.555005+00:00",
      proposedBy: "11111111-1111-4111-8111-111111111111",
    },
    knowledgeSources: [],
    primaryBusinessEmail: null,
    primaryEmailProvenance: { source: "needs_confirmation", confidence: "unknown" },
  };
  return {
    actor: "11111111-1111-4111-8111-111111111111",
    tenant: "22222222-2222-4222-8222-222222222222",
    healthyRow,
    contextCalls: 0,
    failContext: false,
  };
});
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: port.actor,
  activeTenantId: port.tenant, loading: false, accountContextStatus: "ready", isPlatformStaff: false,
  activeTenant: { account_number: "123", name: "Synthetic company", account_type: "standalone", features: { solo_setup_completed: false } } }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], allItems: [], loading: false, error: null, forbidden: false, refresh: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = new Proxy(function () {} as never, {
    get: (_t, prop: string) => {
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (prop === "rpc")
        return async (name: string) => {
          if (name === "get_solo_business_context") {
            port.contextCalls += 1;
            if (port.failContext) return { data: null, error: { code: "SETUP_REQUEST_FAILED" } };
            return { data: port.healthyRow, error: null };
          }
          return { data: null, error: null };
        };
      if (prop === "channel" || prop === "removeChannel") {
        const chan = { on: () => chan, subscribe: () => ({ unsubscribe: () => {} }) };
        return () => chan;
      }
      if (prop === "auth") return { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) };
      return (..._args: unknown[]) => chain;
    },
    apply: () => ({ data: [], error: null, count: 0 }),
  });
  return { supabase: chain };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("@/hooks/usePendingApprovals", () => ({ usePendingApprovals: () => ({ items: [] }) }));
vi.mock("@/components/auth/WorkspaceExitControl", () => ({ WorkspaceExitControl: () => null }));
vi.mock("@/components/admin/voice/DialPadSurface", () => ({ DialPadSurface: () => null }));
vi.mock("@/components/admin/voice/IncomingCallOverlay", () => ({ IncomingCallOverlay: () => null }));
vi.mock("@/components/admin/voice/LiveTranscriptPanel", () => ({ LiveTranscriptPanel: () => null }));
vi.mock("./SoloSetupReadinessNotice", () => ({ SoloSetupReadinessNotice: () => null }));
vi.mock("./SoloPaigeWorkspace", () => ({ SoloPaigeWorkspace: () => null }));
vi.mock("./CommandCenter", () => ({ CommandHub: () => null }));
vi.mock("./conversations", () => ({ ClientsHub: () => null }));
vi.mock("@/components/tenant-relationships/TenantRelationshipsClientsWorkspace", () => ({ TenantRelationshipsClientsWorkspace: () => null }));
vi.mock("./growth2", () => ({ GrowthHub: () => null }));
vi.mock("./AdsWorkspace", () => ({ AdsWorkspace: () => null }));
vi.mock("./SalesWorkspace", () => ({ SalesWorkspace: () => null }));
vi.mock("./finance/FinanceWorkspace", () => ({ FinanceWorkspace: () => null }));
vi.mock("@/components/tenant-calendar/TenantCanonicalCalendarWorkspace", () => ({ TenantCanonicalCalendarWorkspace: () => null }));
vi.mock("./marketplace", () => ({ Marketplace: () => null }));
vi.mock("./vault/useBusinessVault", () => ({ useVaultAccess: () => ({}), canShowVaultNavigation: () => false }));
vi.mock("./vibe", () => ({ VibeStudio: () => null }));
vi.mock("@/components/ui/paige", () => ({ AgentPresenceProvider: ({ children }: React.PropsWithChildren) => children,
  useAgentPresence: () => ({ expandRail: vi.fn(), railExpanded: false }) }));
vi.mock("@/lib/voice/VoiceDeviceProvider", () => ({ VoiceDeviceProvider: ({ children }: React.PropsWithChildren) => children,
  useVoiceDevice: () => null }));
import SoloApp from "./SoloApp";

// Route-level code split (PR9): the settings screen loads lazily inside SoloApp.
// Vitest transforms it on FIRST import, which an in-test wait budget cannot
// honestly cover — pre-warm at file load (the eager world paid this same cost at
// module load). The lazy path itself is pinned by the tabSplit suite.
const settingsWarm = import("./settings");
beforeAll(async () => {
  await settingsWarm;
}, 60_000);

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { port.contextCalls = 0; port.failContext = false; sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Address() {
  const location = useLocation();
  const navigate = useNavigate();
  return <div><output data-actual-address>{location.pathname}{location.search}</output>
    {/* The readiness-notice CTA and every in-app Setup link navigate this exact path. */}
    <button onClick={() => navigate("/solo/123/settings/setup")}>Open Setup</button></div>;
}

// Route-level code split (PR9): SoloApp's screens load lazily; a mount or route
// change can briefly show the shell's "Opening …" fallback. Wait for the real
// screen instead of assuming one act flush covers the chunk resolution.
const waitForScreenReady = async (element: HTMLElement = host) => {
  for (let attempt = 0; attempt < 40 && element.textContent?.includes("Opening "); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  // Post-mount effects (address canonicalization, retained-state restore) land one
  // flush after the chunk does; settle once more so assertions see the settled screen.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
};
const mount = async (initial: string) => {
  await act(async () => root.render(<MemoryRouter initialEntries={[initial]}>
    <Address /><Routes><Route path="/solo/:account/*" element={<SoloApp />} /></Routes>
  </MemoryRouter>));
  await waitForScreenReady();
};
const address = () => host.querySelector("[data-actual-address]")?.textContent;
const text = () => host.textContent ?? "";
async function clickOpenSetup() {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === "Open Setup");
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await waitForScreenReady();
}

it("deep link to Setup mounts the real settings tree and canonicalizes to business-profile", async () => {
  await mount("/solo/123/settings/setup");
  await act(async () => { await Promise.resolve(); });
  expect(address()).toBe("/solo/123/settings/setup/business-profile");
  expect(text()).toContain("Review a proposed brief update");
  expect(text()).toContain("Synthetic reason prepared for review in Setup.");
  // The two failure presentations D5 conflated must both be absent on a healthy load:
  // SoloScreenBoundary's "This page couldn’t open" and the honest RPC-failure panel.
  expect(text()).not.toContain("This page couldn’t open");
  expect(text()).not.toContain("Setup could not load safely");
  // The boundary is keyed by pathname, so index canonicalization legitimately
  // remounts the settings screen; a load must have run, but its exact count is
  // the shell's own contract, not this regression's.
  expect(port.contextCalls).toBeGreaterThanOrEqual(1);
});

it("the in-app Setup link (readiness-CTA path) client-navigates onto the same real surface", async () => {
  await mount("/solo/123/command-center");
  await act(async () => { await Promise.resolve(); });
  expect(port.contextCalls).toBe(0);
  await clickOpenSetup();
  await act(async () => { await Promise.resolve(); });
  expect(address()).toBe("/solo/123/settings/setup/business-profile");
  expect(text()).toContain("Review a proposed brief update");
  expect(text()).not.toContain("This page couldn’t open");
  expect(port.contextCalls).toBeGreaterThanOrEqual(1);
});

it("a failed context load shows the honest recovery panel, and Retry reloads and recovers", async () => {
  port.failContext = true;
  await mount("/solo/123/settings/setup");
  await act(async () => { await Promise.resolve(); });
  expect(text()).toContain("Setup could not load safely");
  expect(text()).not.toContain("This page couldn’t open");
  const callsBeforeRetry = port.contextCalls;
  expect(callsBeforeRetry).toBeGreaterThanOrEqual(1);
  port.failContext = false;
  const retry = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent?.trim() === "Retry");
  expect(retry, "the recovery panel must offer Retry").toBeTruthy();
  await act(async () => retry!.click());
  expect(port.contextCalls).toBeGreaterThan(callsBeforeRetry);
  expect(text()).not.toContain("Setup could not load safely");
  expect(text()).toContain("Review a proposed brief update");
});
