import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorId = "e0913000-0000-0000-0000-000000000001";
const nextActorId = "e0913000-0000-0000-0000-000000000002";
type TestSession = { user: { id: string; email: string } };
let session: TestSession | null;
let authListener: ((_event: string, next: TestSession | null) => void) | null;
const getSession = vi.fn(), unsubscribe = vi.fn(), invalidateQueries = vi.fn(), landing = vi.fn();
const channel = vi.fn(() => { throw new Error("Customer shell must not receive raw CRM rows"); });
const queryClient = { invalidateQueries };
const preview = vi.hoisted(() => ({target:null as null | {contactId:string;targetUserId:string;targetName:string},isImpersonating:false}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: () => getSession(), onAuthStateChange: (callback: typeof authListener) => { authListener = callback; return { data: { subscription: { unsubscribe } } }; } },
  channel,
} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@/components/app/PaigeChat", () => ({ PaigeChat: ({ user, clientId }: { user: { id: string };clientId?:string }) => <div data-testid="paige-chat" data-contact={clientId}>{user.id}</div> }));
vi.mock("@/components/app/AppNav", () => ({ AppNav: () => <nav>Existing navigation</nav> }));
vi.mock("@/components/app/QuickStatsBar", () => ({ QuickStatsBar: () => null }));
vi.mock("@/hooks/useCreditFactors", () => ({ useCreditFactors: () => ({ factors: null }) }));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: false }) }));
vi.mock("@/components/admin/AdminViewBanner", () => ({ AdminViewBanner: () => null }));
vi.mock("@/hooks/useSessionTimeout", () => ({ useSessionTimeout: () => ({ showWarning: false, staySignedIn: () => {} }) }));
vi.mock("@/components/auth/SessionTimeoutWarning", () => ({ SessionTimeoutWarning: () => null }));
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: () => <div>Existing checklist</div> }));
vi.mock("@/components/dashboard/OnboardingFlow", () => ({ OnboardingFlow: () => null }));
vi.mock("@/components/notifications/PushNotificationPrompt", () => ({ PushNotificationPrompt: () => null }));
vi.mock("@/components/ui/resizable", () => ({ ResizablePanelGroup: ({ children }: PropsWithChildren) => <div>{children}</div>, ResizablePanel: ({ children }: PropsWithChildren) => <div>{children}</div>, ResizableHandle: () => null }));
vi.mock("@/hooks/useAnalytics", () => ({ trackEvent: () => Promise.resolve() }));
vi.mock("@/lib/auth/resolveLandingRoute", () => ({ resolveLandingRoute: () => landing() }));
vi.mock("@/lib/onboardingOffer", () => ({ shouldOfferOnboarding: () => Promise.resolve(false) }));
vi.mock("@/components/legal/RequiredConsentsGate", () => ({ RequiredConsentsGate: () => null }));
vi.mock("@/contexts/ImpersonationContext", () => ({ useImpersonation: () => preview }));
vi.mock("@/lib/scopedUser", () => ({ setScopedUserId: () => {} }));
vi.mock("@/components/client/ClientHomeTiles", () => ({ ClientHomeTiles: () => <div>Existing client tiles</div> }));
vi.mock("@/components/app/ClientActivityFeed", () => ({ ClientActivityFeed: () => <div>Existing canonical activity</div> }));
vi.mock("@/components/planning/UpcomingWidget", () => ({ UpcomingWidget: () => null }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Assistant", greeting: "Existing greeting" } }) }));
vi.mock("@/hooks/useClientPortalConfig", () => ({ useClientPortalConfig: () => ({}) }));
vi.mock("@/hooks/usePresenceHeartbeat", () => ({ usePresenceHeartbeat: () => {} }));
const { default: AppShell } = await import("./AppShell");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, mounted: boolean;
async function flush() { await act(async () => { for (let i = 0; i < 14; i++) await Promise.resolve(); }); }
async function mount(initialPath = "/app") {
  mounted = true;
  await act(async () => root.render(<MemoryRouter initialEntries={[initialPath]}><Routes><Route path="/app/*" element={<AppShell />} /><Route path="/auth" element={<p>Sign in</p>} /><Route path="/choose-account" element={<p>Workspace chooser</p>} /></Routes></MemoryRouter>));
  await flush();
}
beforeEach(() => {
  preview.target=null;preview.isImpersonating=false;
  session = { user: { id: actorId, email: "client@example.test" } }; authListener = null; mounted = false;
  getSession.mockReset(); getSession.mockImplementation(async () => ({ data: { session }, error: null }));
  unsubscribe.mockClear(); channel.mockClear(); invalidateQueries.mockClear(); landing.mockReset(); landing.mockResolvedValue("/app");
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { if (mounted) act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

function deferInitialSession() {
  let resolve!: (value: { data: { session: TestSession | null }; error: null }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ data: { session: TestSession | null }; error: null }>((yes, no) => { resolve = yes; reject = no; });
  getSession.mockReturnValue(promise);
  return { resolve: (value: TestSession | null) => resolve({ data: { session: value }, error: null }), reject };
}

describe("customer shell without raw CRM Realtime", () => {
  it("keeps the actual staff Chat actor and canonical contact scope in View as Client",async()=>{
    preview.target={contactId:"e0913000-0000-4000-8000-000000000003",targetUserId:nextActorId,targetName:"Test customer"};
    preview.isImpersonating=true;
    await mount();
    const chat=host.querySelector('[data-testid="paige-chat"]')!;
    expect(chat.textContent).toBe(actorId);
    expect(chat.getAttribute("data-contact")).toBe(preview.target.contactId);
    expect(chat.textContent).not.toContain(nextActorId);
  });
  it("mounts existing navigation, single PAIGE and actual home without opening a CRM channel", async () => {
    await mount();
    expect(host.textContent).toContain("Existing navigation"); expect(host.textContent).toContain("Welcome Back");
    expect(host.querySelectorAll('[data-testid="paige-chat"]')).toHaveLength(1);
    expect(host.textContent).toContain(actorId); expect(host.textContent).toContain("Existing canonical activity");
    expect(channel).not.toHaveBeenCalled(); expect(invalidateQueries).not.toHaveBeenCalled();
  });
  it("keeps unauthenticated visitors outside the customer shell", async () => {
    session = null; await mount(); expect(host.textContent).toBe("Sign in");
    expect(host.querySelector('[data-testid="paige-chat"]')).toBeNull(); expect(channel).not.toHaveBeenCalled();
  });
  it("retains the staff landing policy instead of borrowing a customer session", async () => {
    landing.mockResolvedValue("/choose-account"); await mount(); expect(host.textContent).toBe("Workspace chooser");
    expect(channel).not.toHaveBeenCalled();
  });
  it("removes customer content on confirmed sign-out without a channel or cache-wake loop", async () => {
    await mount(); act(() => authListener?.("SIGNED_OUT", null)); await flush();
    expect(host.textContent).toBe("Sign in"); expect(channel).not.toHaveBeenCalled(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("cleans up the existing SDK subscription when the shell unmounts", async () => {
    await mount(); act(() => root.unmount()); mounted = false;
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(channel).not.toHaveBeenCalled();
  });
});

describe("customer shell initial Auth lifetime", () => {
  it("keeps a newer SDK actor when the initial cached session resolves late", async () => {
    const initial = deferInitialSession(); await mount();
    act(() => authListener?.("SIGNED_IN", { user: { id: nextActorId, email: "next-client@example.test" } })); await flush();
    expect(host.textContent).toContain(nextActorId);
    initial.resolve(session); await flush();
    expect(host.textContent).toContain(nextActorId); expect(host.textContent).not.toContain(actorId);
  });
  it("does not navigate away from the staff landing when an old initial read returns null", async () => {
    const initial = deferInitialSession(); landing.mockResolvedValue("/choose-account"); await mount();
    act(() => authListener?.("SIGNED_IN", session)); await flush();
    expect(host.textContent).toBe("Workspace chooser"); expect(unsubscribe).toHaveBeenCalledOnce();
    initial.resolve(null); await flush();
    expect(host.textContent).toBe("Workspace chooser");
  });
  it("ignores a rejected initial read after a newer SDK session has settled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const initial = deferInitialSession(); await mount();
    act(() => authListener?.("SIGNED_IN", session)); await flush();
    initial.reject(new Error("Obsolete initial read")); await flush();
    expect(host.textContent).toContain(actorId); expect(error).not.toHaveBeenCalled();
  });
  it("ignores queued callbacks and initial replies after unmount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const initial = deferInitialSession(); await mount(); const queued = authListener;
    act(() => root.unmount()); mounted = false;
    act(() => queued?.("SIGNED_IN", session)); initial.reject(new Error("Retired read")); await flush();
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
  });
  it("keeps confirmed sign-out retired when the cached initial session resolves late", async () => {
    const initial = deferInitialSession(); await mount();
    act(() => authListener?.("SIGNED_OUT", null)); await flush();
    expect(host.textContent).toBe("Sign in"); initial.resolve(session); await flush();
    expect(host.textContent).toBe("Sign in"); expect(host.querySelector('[data-testid="paige-chat"]')).toBeNull();
  });
  it("clears both mount-owned hydration timers when the shell unmounts", async () => {
    vi.useFakeTimers(); deferInitialSession(); await mount("/app/settings");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root.unmount()); mounted = false; expect(vi.getTimerCount()).toBe(0);
  });
  it("retains the bounded sign-in recovery on a stalled initial session", async () => {
    vi.useFakeTimers(); const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initial = deferInitialSession(); await mount();
    expect(host.textContent).toBe("Loading...");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); await flush();
    expect(host.textContent).toBe("Sign in"); expect(warning).toHaveBeenCalledOnce();
    initial.resolve(session); await flush(); expect(host.textContent).toBe("Sign in");
  });
});
