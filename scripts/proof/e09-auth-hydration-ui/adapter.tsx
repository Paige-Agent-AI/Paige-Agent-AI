import { coachingDefault } from "@/lib/playbook/presets";
type TestSession = { user: { id: string; email: string } };
type Listener = (event: string, session: TestSession | null) => void;
const listeners = new Set<Listener>();
let actor: TestSession | null = null, staff = false;
let initialReply!: (value: { data: { session: TestSession | null }; error: null }) => void;
const initial = new Promise<{ data: { session: TestSession | null }; error: null }>(resolve => { initialReply = resolve; });
const sessionFor = (id: string): TestSession => ({ user: { id, email: "client@example.test" } });
export const supabase = {
  auth: {
    getSession: () => initial,
    getUser: async () => ({ data: { user: actor?.user ?? null }, error: null }),
    onAuthStateChange: (listener: Listener) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
  },
  rpc: async (key: string) => {
    if (key === "get_client_portal_brand") return { data: actor ? [{ tenant_id: "test-tenant-service", tenant_name: "Test Service Studio", tenant_slug: "test-service", primary_color: "#26483e", logo_url: null }] : [], error: null };
    if (key === "get_client_portal_config") return { data: {}, error: null };
    throw new Error("Only native presentation reads allowed in local proof");
  },
  from: (table: string) => {
    if (table !== "profiles") throw new Error("Raw customer/domain reads forbidden in local proof");
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { avatar_url: null }, error: null }) }) }) };
  },
};
Object.assign(window, { authHydrationProof: {
  newer: () => { actor = sessionFor("test-actor-b"); for (const listener of listeners) listener("SIGNED_IN", actor); },
  stale: () => initialReply({ data: { session: sessionFor("test-actor-a") }, error: null }),
  staleEmpty: () => initialReply({ data: { session: null }, error: null }),
  staff: () => { staff = true; },
  signOut: () => { actor = null; for (const listener of listeners) listener("SIGNED_OUT", null); },
} });
const queryClient = { invalidateQueries: () => {} };
export const useQueryClient = () => queryClient;
export const PaigeChat = ({ user }: { user: { id: string } }) => <div data-testid="paige-fixture" data-actor={user.id} className="p-6"><p className="text-sm text-muted-foreground">PAIGE content — test double</p><p className="mt-3">Synthetic SDK actor: {user.id}</p></div>;
export const useCreditFactors = () => ({ factors: null });
export const useTenantFeature = () => ({ enabled: false });
export const useSessionTimeout = () => ({ showWarning: false, staySignedIn: () => {} });
export const usePresenceHeartbeat = () => {};
export const useImpersonation = () => ({ target: null, isImpersonating: false });
export const setScopedUserId = () => {};
export const trackEvent = async () => {};
export const resolveLandingRoute = async () => staff ? "/choose-account" : "/app";
export const shouldOfferOnboarding = async () => false;
export const usePlaybook = () => coachingDefault;
export const useDashboardMode = () => ({ isAdmin: false, mode: "client", setMode: () => {} });
export const useUnreadSupportCount = () => ({ count: 0 });
export const NotificationBell = () => <button aria-label="Notifications" type="button">Notifications</button>;
export const isAvatarBucketUrl = () => false;
export const cachePortalSlug = () => {};
export const customerSignOutTarget = () => "/auth";
export const performSignOut = () => { throw new Error("No real Auth/provider effect allowed"); };
export const OnboardingChecklist = () => <p className="text-sm text-muted-foreground">Onboarding content — test double</p>;
export const ClientHomeTiles = () => <p className="text-sm text-muted-foreground">Customer work — test double</p>;
export const ClientActivityFeed = () => <p className="text-sm text-muted-foreground">Shared activity — test double</p>;
export const QuickStatsBar = () => null;
export const AdminViewBanner = () => null;
export const SessionTimeoutWarning = () => null;
export const OnboardingFlow = () => null;
export const PushNotificationPrompt = () => null;
export const RequiredConsentsGate = () => null;
export const UpcomingWidget = () => null;
