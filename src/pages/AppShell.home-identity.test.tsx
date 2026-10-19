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

// Round 3 (verifier 7): the chat beside the home already greets the customer; the home pointed to the same
// agent with that greeting word for word. It now points to the agent once, in the welcome line, and leads
// with the customer's own things.
it("points a customer to the business's agent without repeating the chat's greeting", async () => {
  await render({ frame: frame("Ava"), phase: "ready" });
  expect(host.querySelector("h1")?.textContent).toBe("Welcome Back");
  expect(host.textContent).toContain("Ask Ava about your next steps.");
  expect(host.textContent).not.toContain("Hi — I’m Ava");
  expect(host.textContent).not.toContain("is here to help");
  expect(host.textContent).toContain("Home tiles");
  expect(host.textContent).toContain("Getting started checklist");
  expect(host.textContent).not.toMatch(/paige/i);
});

// Round 3 (verifier 7 + compliance): the home for a person whose access is not active was "Welcome" over an
// empty pane. It is the portal's empty state, says what will appear here, and never repeats the chat's status.
it("gives a person whose access is not active an empty state, not a bare welcome", async () => {
  await render({ frame: null, phase: "not-client", staff: false });
  expect(host.querySelector('[data-testid="no-access-home"]')).not.toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("Home");
  expect(host.textContent).toContain("Nothing is shared with you right now");
  expect(host.textContent).toContain("When a business gives you portal access, the documents, sessions and messages it shares with you appear here.");
  expect(host.textContent).not.toMatch(/Welcome/);
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

// Round 4 (compliance 6): a customer whose access ended during the session (frame phase "unavailable") kept the
// round-2 home, still "checking" their access, with tiles. Once the shell knows they are not staff, they get the
// same no-access home as anyone whose access is not active; staff keep theirs.
it("gives a customer whose access ended mid-session the no-access home", async () => {
  await render({ frame: null, phase: "unavailable", staff: false });
  expect(host.querySelector('[data-testid="no-access-home"]')).not.toBeNull();
  expect(host.textContent).not.toContain("once your customer access is checked");
  expect(host.textContent).not.toContain("Home tiles");
});

it("keeps staff whose customer frame ended on the owner's own home (§58)", async () => {
  await render({ frame: null, phase: "unavailable", staff: true, staffAssistantName: "Owner assistant" });
  expect(host.querySelector('[data-testid="no-access-home"]')).toBeNull();
  expect(host.textContent).toContain("Owner assistant is here to help");
});
