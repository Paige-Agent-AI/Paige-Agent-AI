import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerIdentityProvider, type CustomerIdentityState } from "@/lib/portal/customerIdentity";

// The /app home, by who is looking (owner ruling 2026-10-19: PAIGE is never in the Customer Portal).
// Synthetic business "Northwind Studio"; never a real account.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } } }));
vi.mock("@/components/app/PaigeChat", () => ({ PaigeChat: () => null }));
vi.mock("@/components/app/AppNav", () => ({ AppNav: () => null }));
vi.mock("@/components/app/QuickStatsBar", () => ({ QuickStatsBar: () => null }));
vi.mock("@/hooks/useCreditFactors", () => ({ useCreditFactors: () => ({ factors: null }) }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: false }) }));
vi.mock("@/components/admin/AdminViewBanner", () => ({ AdminViewBanner: () => null }));
vi.mock("@/hooks/useSessionTimeout", () => ({ useSessionTimeout: () => ({ showWarning: false, staySignedIn: () => {} }) }));
vi.mock("@/components/auth/SessionTimeoutWarning", () => ({ SessionTimeoutWarning: () => null }));
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: () => <div>Getting started checklist</div> }));
vi.mock("@/components/dashboard/OnboardingFlow", () => ({ OnboardingFlow: () => null }));
vi.mock("@/components/notifications/PushNotificationPrompt", () => ({ PushNotificationPrompt: () => null, pushTopicsSentence: () => null }));
vi.mock("@/components/legal/RequiredConsentsGate", () => ({ RequiredConsentsGate: () => null }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => ({ target: null, isImpersonating: false }) }));
vi.mock("@/components/client/ClientHomeTiles", () => ({ ClientHomeTiles: () => <div>Home tiles</div> }));
vi.mock("@/components/app/ClientActivityFeed", () => ({ ClientActivityFeed: () => null }));
vi.mock("@/components/planning/UpcomingWidget", () => ({ UpcomingWidget: () => null }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Owner assistant", greeting: "Owner playbook greeting" } }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfig: () => ({}) }));
vi.mock("@/hooks/usePresenceHeartbeat", () => ({ usePresenceHeartbeat: () => {} }));
vi.mock("@/lib/portal/portalStaffStanding", () => ({ usePortalStaffStanding: () => ({ loading: false, staff: null }) }));
const { AppDashboardHome } = await import("./AppShell");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const frame = (agent?: string) => ({
  actorId: "u1", profile: { id: "c1", tenant_id: "t1", first_name: "Jordan", last_name: "Rivera", entity_name: null },
  brand: { tenant_id: "t1", tenant_name: "Northwind Studio" }, config: agent ? { assistant: { display_name: agent } } : {},
}) as unknown as CustomerIdentityState["frame"];
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (state: CustomerIdentityState) => {
  await act(async () => root.render(
    <MemoryRouter><CustomerIdentityProvider state={state}><AppDashboardHome factors={null} userId="u1" /></CustomerIdentityProvider></MemoryRouter>,
  ));
};

it("greets a customer as the business's agent", async () => {
  await render({ frame: frame("Ava"), phase: "ready" });
  expect(host.textContent).toContain("Ava is here to help");
  expect(host.textContent).toContain("Hi — I’m Ava, the AI client success agent for Northwind Studio. How can I help?");
  expect(host.textContent).toContain("Home tiles");
  expect(host.textContent).not.toMatch(/paige/i);
});

it("offers a person whose access is not active no agent tiles, checklist or greeting, and does not repeat the chat's status", async () => {
  await render({ frame: null, phase: "not-client", staff: false });
  expect(host.querySelector("h1")?.textContent).toBe("Welcome");
  expect(host.textContent).not.toContain("isn’t active");
  expect(host.textContent).not.toContain("is here to help");
  expect(host.textContent).not.toContain("Home tiles");
  expect(host.textContent).not.toContain("Getting started checklist");
  expect(host.textContent).not.toMatch(/Cura|paige/i);
});

it("keeps staff on the owner's own assistant and greeting (§58)", async () => {
  await render({ frame: null, phase: "not-client", staff: true, staffAssistantName: "Owner assistant" });
  expect(host.textContent).toContain("Owner assistant is here to help");
  expect(host.textContent).toContain("Owner playbook greeting");
  expect(host.textContent).not.toContain("once your customer access is checked");
});
