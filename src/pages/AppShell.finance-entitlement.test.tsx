import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 F2 — the /app shell's ONE funding/credit answer (useFinancePortal) and the funding_readiness flag together.
// Synthetic only; never a real account.

const actorId = "e0913000-0000-0000-0000-000000000001";
const nextActorId = "e0913000-0000-0000-0000-000000000002";
type TestSession = { user: { id: string; email: string } };
let session: TestSession | null;
let authListener: ((_event: string, next: TestSession | null) => void) | null;
const authListeners = new Set<NonNullable<typeof authListener>>();
const getSession = vi.fn(), unsubscribe = vi.fn(), invalidateQueries = vi.fn(), landing = vi.fn();
const channel = vi.fn(() => { throw new Error("Customer shell must not receive raw CRM rows"); });
const queryClient = { invalidateQueries };
const f = vi.hoisted(() => ({ financePortal: false, fundingReadiness: false, creditFactors: [] as { uid: string | null; enabled?: boolean }[], pushTopics: [] as boolean[] }));
const preview = vi.hoisted(() => ({target:null as null | {contactId:string;targetUserId:string;targetName:string},isImpersonating:false}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: () => getSession(), onAuthStateChange: (callback: NonNullable<typeof authListener>) => {
    // The real SDK supports independent Shell and customer-frame subscribers.
    // Retain the Shell cleanup spy without replacing its listener with a child.
    const shell = authListeners.size === 0;
    authListeners.add(callback);
    authListener = (event, next) => { for (const listener of [...authListeners]) listener(event, next); };
    return { data: { subscription: { unsubscribe: () => { authListeners.delete(callback); if (shell) unsubscribe(); } } } };
  } },
  channel,
} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@/components/app/PaigeChat", () => ({ PaigeChat: ({ user, clientId }: { user: { id: string };clientId?:string }) => <div data-testid="paige-chat" data-contact={clientId}>{user.id}</div> }));
vi.mock("@/components/app/AppNav", () => ({ AppNav: () => <nav>Existing navigation</nav> }));
vi.mock("@/components/app/QuickStatsBar", () => ({ QuickStatsBar: () => <div>Quick stats bar</div> }));
vi.mock("@/hooks/useCreditFactors", () => ({ useCreditFactors: (uid: string | null, options: { enabled?: boolean }) => { f.creditFactors.push({ uid, enabled: options?.enabled }); return { factors: null }; } }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: f.fundingReadiness, loading: false }) }));
vi.mock("@/hooks/useFinanceEntitlement", () => ({ useFinancePortal: () => ({ open: f.financePortal, loading: false }) }));
vi.mock("@/components/admin/AdminViewBanner", () => ({ AdminViewBanner: () => null }));
vi.mock("@/hooks/useSessionTimeout", () => ({ useSessionTimeout: () => ({ showWarning: false, staySignedIn: () => {} }) }));
vi.mock("@/components/auth/SessionTimeoutWarning", () => ({ SessionTimeoutWarning: () => null }));
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: (p: { financePortal?: boolean }) => <div data-testid="checklist" data-finance={String(p.financePortal)}>Existing checklist</div> }));
vi.mock("@/components/dashboard/OnboardingFlow", () => ({ OnboardingFlow: () => <div>Credit-first onboarding</div> }));
vi.mock("@/components/notifications/PushNotificationPrompt", () => ({ PushNotificationPrompt: () => null, pushTopicsSentence: (i: { creditAlerts: boolean }) => { f.pushTopics.push(i.creditAlerts); return null; } }));
vi.mock("@/components/ui/resizable", () => ({ ResizablePanelGroup: ({ children }: PropsWithChildren) => <div>{children}</div>, ResizablePanel: ({ children }: PropsWithChildren) => <div>{children}</div>, ResizableHandle: () => null }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: () => Promise.resolve() }));
vi.mock("@/lib/auth/resolveLandingRoute", () => ({ resolveLandingRoute: () => landing() }));
vi.mock("@/lib/onboardingOffer", () => ({ shouldOfferOnboarding: () => Promise.resolve(true) }));
vi.mock("@/components/legal/RequiredConsentsGate", () => ({ RequiredConsentsGate: ({ onBlockingChange }: { onBlockingChange: (b: boolean) => void }) => { queueMicrotask(() => onBlockingChange(false)); return null; } }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => preview }));
vi.mock("@/lib/scopedUser", () => ({ setScopedUserId: () => {} }));
vi.mock("@/components/client/ClientHomeTiles", () => ({ ClientHomeTiles: (p: { financePortal?: boolean }) => <div data-testid="tiles" data-finance={String(p.financePortal)}>Existing client tiles</div> }));
vi.mock("@/components/app/ClientActivityFeed", () => ({ ClientActivityFeed: () => <div>Existing canonical activity</div> }));
vi.mock("@/components/planning/UpcomingWidget", () => ({ UpcomingWidget: () => null }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Assistant", greeting: "Existing greeting" } }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfig: () => ({}) }));
vi.mock("@/hooks/usePresenceHeartbeat", () => ({ usePresenceHeartbeat: () => {} }));
const { default: AppShell } = await import("./AppShell");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
async function flush() { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); }
async function mount() {
  await act(async () => root.render(<MemoryRouter initialEntries={["/app"]}><Routes><Route path="/app/*" element={<AppShell />} /><Route path="/auth" element={<p>Sign in</p>} /></Routes></MemoryRouter>));
  await flush();
}
beforeEach(() => {
  authListeners.clear(); preview.target = null; preview.isImpersonating = false;
  session = { user: { id: actorId, email: "client@example.test" } }; authListener = null;
  getSession.mockReset(); getSession.mockImplementation(async () => ({ data: { session }, error: null }));
  landing.mockReset(); landing.mockResolvedValue("/app");
  f.financePortal = false; f.fundingReadiness = false; f.creditFactors = []; f.pushTopics = [];
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("E09 F2 — the shell's funding/credit surfaces", () => {
  it("a business that is not finance-entitled: no credit factor read, no credit chrome, tiles and checklist told so", async () => {
    await mount();
    expect(f.creditFactors.length).toBeGreaterThan(0);
    expect(f.creditFactors.every((c) => c.enabled === false)).toBe(true);
    expect(host.textContent).not.toContain("Quick stats bar");
    expect(host.textContent).not.toContain("Credit-first onboarding");
    expect(host.querySelector('[data-testid="tiles"]')?.getAttribute("data-finance")).toBe("false");
    expect(host.querySelector('[data-testid="checklist"]')?.getAttribute("data-finance")).toBe("false");
    expect(f.pushTopics.every((t) => t === false)).toBe(true);
  });

  it("NO EXPANSION: entitled but funding_readiness off — the funding_readiness surfaces stay dark", async () => {
    f.financePortal = true;
    await mount();
    expect(host.textContent).not.toContain("Quick stats bar");
    expect(host.textContent).not.toContain("Credit-first onboarding");
    expect(f.pushTopics.every((t) => t === false)).toBe(true);
    // ...while the surfaces with no gate before follow the entitlement alone.
    expect(f.creditFactors.some((c) => c.enabled === true)).toBe(true);
    expect(host.querySelector('[data-testid="tiles"]')?.getAttribute("data-finance")).toBe("true");
  });

  it("funding_readiness on but NOT entitled — still dark (both are required)", async () => {
    f.fundingReadiness = true;
    await mount();
    expect(host.textContent).not.toContain("Quick stats bar");
    expect(host.textContent).not.toContain("Credit-first onboarding");
    expect(f.pushTopics.every((t) => t === false)).toBe(true);
    expect(f.creditFactors.every((c) => c.enabled === false)).toBe(true);
  });

  it("CONTROL: entitled AND funding_readiness — the credit chrome is what it was", async () => {
    f.financePortal = true; f.fundingReadiness = true;
    await mount();
    expect(host.textContent).toContain("Quick stats bar");
    expect(host.textContent).toContain("Credit-first onboarding");
    expect(f.pushTopics).toContain(true);
  });
});
