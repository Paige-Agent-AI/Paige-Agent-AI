import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { User, Session } from "@supabase/supabase-js";
import { Outlet, useLocation } from "react-router-dom";
import { PaigeChat } from "@/components/app/PaigeChat";
import { AppNav } from "@/components/app/AppNav";
import { QuickStatsBar } from "@/components/app/QuickStatsBar";
import { useCreditFactors } from "@/hooks/useCreditFactors";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import { useFinancePortal } from "@/hooks/useFinanceEntitlement";
import { AdminViewBanner } from "@/components/admin/AdminViewBanner";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { SessionTimeoutWarning } from "@/components/auth/SessionTimeoutWarning";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { OnboardingFlow } from "@/components/dashboard/OnboardingFlow";
import { PushNotificationPrompt, pushTopicsSentence } from "@/components/notifications/PushNotificationPrompt";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { trackEvent } from "@/hooks/useAnalytics";
import { resolveLandingRoute } from "@/lib/auth/resolveLandingRoute";
import { shouldOfferOnboarding } from "@/lib/onboardingOffer";
import { RequiredConsentsGate } from "@/components/legal/RequiredConsentsGate";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { setScopedUserId } from "@/lib/scopedUser";
import { useQueryClient } from "@tanstack/react-query";
import { ClientHomeTiles } from "@/components/client/ClientHomeTiles";
import { ClientActivityFeed } from "@/components/app/ClientActivityFeed";
import { UpcomingWidget } from "@/components/planning/UpcomingWidget";
import { useClientPortalConfig, type ClientPortalConfig } from "@/hooks/useClientPortalConfig";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useClientViewportHeight } from "@/hooks/useClientViewportHeight";
import { useSharedClientPortalFrame } from "@/hooks/useClientPortalFrame";
import { CustomerAccessGate } from "@/components/app/CustomerAccessGate";
import { CustomerIdentityProvider, useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { usePortalStaffStanding } from "@/lib/portal/portalStaffStanding";
import { usePlaybook } from "@/lib/playbook";
import { EmptyState } from "@/components/ui/page";
import { Inbox } from "lucide-react";

// Map /app sub-routes to canonical feature names emitted as `feature_visit`.
function routeToFeatureName(pathname: string): string | null {
  if (!pathname.startsWith("/app")) return null;
  const seg = pathname.replace(/^\/app\/?/, "").split("/")[0] || "dashboard";
  const map: Record<string, string> = {
    "": "dashboard",
    dashboard: "dashboard",
    credit: "credit",
    "credit-intelligence": "credit",
    funding: "funding",
    "funding-matches": "funding",
    "funding-journey": "funding_journey",
    business: "business",
    "business-profile": "business",
    learn: "learn",
    courses: "learn",
    disputes: "disputes",
    broker: "broker",
    "broker-workspace": "broker",
    voice: "voice",
    settings: "settings",
  };
  return map[seg] ?? seg;
}

const DEV_MODE = false; // Require authentication

const AppShell = () => {
  const viewportHeight = useClientViewportHeight();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(!DEV_MODE);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // The required-consents wall reports whether it is up (or still checking). While it is, no other dialog
  // opens over it — not the funding onboarding, not the notifications prompt (D-QA2, live QA 2026-10-19).
  const [consentsBlocking, setConsentsBlocking] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { target: impersonationTarget, isImpersonating } = useImpersonation();
  const effectiveUserId = impersonationTarget?.targetUserId ?? user?.id;
  // Credit/funding client chrome (the QuickStatsBar → /app/credit and the
  // credit-first OnboardingFlow) is opt-in per tenant (§2/§9). Fail-closed:
  // hidden for every coaching-generic tenant until they turn on the funding
  // preset. Coaching clients keep the neutral /onboard + portal experience.
  // E09 F2: these also need the business's finance entitlement (AppShellBody).
  const { enabled: fundingEnabled } = useTenantFeature("funding_readiness");
  const { showWarning, staySignedIn } = useSessionTimeout();
  // Publish live presence while signed in (#148). The heartbeat always stamps
  // the real authenticated user (auth.uid()), regardless of view-as-client.
  usePresenceHeartbeat(!!user?.id);


  // Check if user is new and needs onboarding (respects snooze + permanent dismissal).
  // Users can browse freely — the OnboardingChecklist on the dashboard is the persistent reminder.
  useEffect(() => {
    if (!user) return;
    try {
      const snoozedUntil = Number(localStorage.getItem("onboarding_snoozed_until") || 0);
      if (snoozedUntil && Date.now() < snoozedUntil) return;
      if (localStorage.getItem("onboarding_dismissed") === "true") return;
    } catch {
      // Continue when browser storage is unavailable.
    }
    // Show onboarding if the profile is mostly empty (new user): no address and no primary phone
    // contact method. An unreadable contact list is not "no phone" — nothing is offered then.
    void shouldOfferOnboarding(user.id).then((offer) => {
      if (offer) setShowOnboarding(true);
    });
  }, [user?.id]);

  // Fire feature_visit on every /app/* route change.
  useEffect(() => {
    const feature = routeToFeatureName(location.pathname);
    if (feature) {
      void trackEvent("feature_visit", "engagement", { feature, path: location.pathname });
    }
  }, [location.pathname]);

  useEffect(() => {
    if (DEV_MODE) return;

    let settled = false;
    let disposed = false;
    let receivedAuthEvent = false;
    let hydrationTimeoutId: number | undefined;
    const markSettled = () => {
      settled = true;
      setIsLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (disposed) return;
        // A fresh SDK event supersedes the initial cached-session read.
        receivedAuthEvent = true;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        markSettled();

        if (!nextSession) {
          navigate("/auth", { replace: true });
        }
      }
    );

    Promise.race<Awaited<ReturnType<typeof supabase.auth.getSession>> | null>([
      supabase.auth.getSession(),
      new Promise<null>((resolve) => { hydrationTimeoutId = window.setTimeout(() => resolve(null), 5000); }),
    ])
      .then((result) => {
        if (disposed || receivedAuthEvent || !result) return;
        const currentSession = result.data.session;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        markSettled();

        if (!currentSession) {
          navigate("/auth", { replace: true });
        }
      })
      .catch((err) => {
        if (disposed || receivedAuthEvent) return;
        console.error("[AppShell] getSession failed:", err);
        markSettled();
      });

    // Safety net: if neither getSession nor onAuthStateChange has resolved
    // in 5s (network stall, paused tab, stale lock), clear the loading gate
    // so the user can act instead of staring at "Loading..." forever.
    const timeoutId = window.setTimeout(() => {
      if (!disposed && !settled) {
        console.warn("[AppShell] auth hydration timed out after 5s — releasing loading gate");
        setIsLoading(false);
        navigate("/auth", { replace: true });
      }
    }, 5000);

    return () => {
      disposed = true;
      subscription.unsubscribe();
      window.clearTimeout(hydrationTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [navigate]);


  // Module-level scope so non-React data hooks (useTasks, useBuildScore,
  // useNotifications, etc.) honor "View as Client" without per-call plumbing.
  // Only invalidate scoped queries (those that include scopedUserId in their
  // keys) when the impersonation target actually changes — invalidating ALL
  // queries on every shell mount caused a refetch storm and slow rendering.
  const queryClient = useQueryClient();
  const prevScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const next = isImpersonating ? (effectiveUserId ?? null) : null;
    setScopedUserId(next);
    if (prevScopeRef.current !== next) {
      prevScopeRef.current = next;
      queryClient.invalidateQueries({ predicate: (q) =>
        Array.isArray(q.queryKey) && q.queryKey.includes("scoped")
      });
    }
    return () => { setScopedUserId(null); };
  }, [isImpersonating, effectiveUserId, queryClient]);

  // Customer refresh must use canonical client projections/events. Never
  // subscribe this shell to full CRM rows for query-cache invalidation.

  // Role-based landing redirect: admins/coaches → /admin, brokers → /broker/app,
  // BTF workspace clients → /app. Honors ?stay=1 (or the (Sprint 211.b: BTF surface retired; routing preserved)
  // paige_stay_in_client_view sessionStorage flag set by AdminLayout's
  // "preview as client" toggle) so internal users can opt into the client view.
  const [redirectingStaff, setRedirectingStaff] = useState(false);
  useEffect(() => {
    if (!user) return;
    if (location.pathname !== "/app") return;
    if (isImpersonating) return; // staff actively viewing as a client
    const params = new URLSearchParams(location.search);
    if (params.get("stay") === "1") return;
    try {
      const stay = sessionStorage.getItem("paige_stay_in_client_view");
      if (stay === "1") return;
    } catch {
      // Continue when browser storage is unavailable.
    }

    let cancelled = false;
    setRedirectingStaff(true);
    (async () => {
      try {
        const target = await Promise.race<string>([
          resolveLandingRoute(user.id, { customerPortal: true }),
          new Promise<string>((resolve) => setTimeout(() => resolve("/app"), 4000)),
        ]);
        if (cancelled) return;
        if (target !== "/app") {
          navigate(target, { replace: true });
        } else {
          setRedirectingStaff(false);
        }
      } catch (err) {
        console.error("[AppShell] resolveLandingRoute failed:", err);
        if (!cancelled) setRedirectingStaff(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, location.pathname, location.search, navigate, isImpersonating]);




  if (isLoading || redirectingStaff) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // In dev mode, create a mock user object
  const activeUser = user || (DEV_MODE ? { id: 'dev-user', email: 'dev@paigeagent.ai' } as User : null);
  if (!activeUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Redirecting to sign in…</div>
      </div>
    );
  }

  // When staff are viewing-as-client, route client-scoped data through the
  // impersonated user's id while keeping `activeUser` as the authenticated
  // session for auth-only concerns (consents, chat actor identity).
  const scopedUser = isImpersonating && effectiveUserId
    ? ({ ...activeUser, id: effectiveUserId } as User)
    : activeUser;

  // E09 Slice 7: a customer whose business paused or ended their access sees that business's own
  // page in place of the whole shell (no menu, no Support desk, no platform persona). Staff viewing
  // as a client are not customers, so the gate stands aside for them.
  return (
    <CustomerAccessGate userId={activeUser.id} enabled={!isImpersonating && !DEV_MODE}>
    <CustomerIdentityRoot userId={activeUser.id} enabled={!isImpersonating} viewingAsClient={isImpersonating}>
      <AppShellBody activeUser={activeUser} scopedUser={scopedUser} session={session} effectiveUserId={effectiveUserId ?? null}
        isImpersonating={isImpersonating} impersonationContactId={impersonationTarget?.contactId}
        fundingReadiness={fundingEnabled} showOnboarding={showOnboarding} onOnboardingDone={() => setShowOnboarding(false)}
        consentsBlocking={consentsBlocking} onConsentsBlockingChange={setConsentsBlocking}
        showTimeoutWarning={showWarning} staySignedIn={staySignedIn} viewportHeight={viewportHeight} pathname={location.pathname} />
    </CustomerIdentityRoot>
    </CustomerAccessGate>
  );
};

/**
 * The shell inside the customer identity, so every funding/credit decision reads ONE answer (E09 F2): `financePortal`
 * is useFinancePortal — the customer's business is finance-entitled (or the viewer is staff, who keep what they had,
 * Q5). Surfaces that were already behind `funding_readiness` (OnboardingFlow, QuickStatsBar, the credit-first
 * checklist) now need BOTH, so nothing dark becomes visible; surfaces with no gate before (the credit factor grid, the
 * Credit and Funding tiles, the bell, the routes) need the entitlement alone.
 */
function AppShellBody({ activeUser, scopedUser, session, effectiveUserId, isImpersonating, impersonationContactId,
  fundingReadiness, showOnboarding, onOnboardingDone, consentsBlocking, onConsentsBlockingChange, showTimeoutWarning,
  staySignedIn, viewportHeight, pathname }: {
  activeUser: User; scopedUser: User; session: Session | null; effectiveUserId: string | null; isImpersonating: boolean;
  impersonationContactId?: string; fundingReadiness: boolean; showOnboarding: boolean; onOnboardingDone: () => void;
  consentsBlocking: boolean; onConsentsBlockingChange: (blocking: boolean) => void; showTimeoutWarning: boolean;
  staySignedIn: () => void; viewportHeight: number | null | undefined; pathname: string;
}) {
  const { open: financePortal } = useFinancePortal();
  const fundingSurfaces = fundingReadiness && financePortal;
  const { factors } = useCreditFactors(effectiveUserId, { enabled: financePortal && !!effectiveUserId });
  return (
    <>
      {!isImpersonating && <RequiredConsentsGate userId={activeUser.id} onBlockingChange={onConsentsBlockingChange} />}
      {!isImpersonating && fundingSurfaces && <OnboardingFlow open={showOnboarding && !consentsBlocking} onComplete={onOnboardingDone} />}
      <AdminViewBanner />
      <SessionTimeoutWarning open={showTimeoutWarning} onStaySignedIn={staySignedIn} />
      {/* Names only what this person is actually notified about, and never opens over the consents wall or
          onboarding (D-QA1/D-QA2, live QA 2026-10-19). */}
      <PushNotificationPrompt description={pushTopicsSentence({ creditAlerts: fundingSurfaces })}
        suppressed={(!isImpersonating && consentsBlocking) || (!isImpersonating && fundingSurfaces && showOnboarding)} />
      <div style={viewportHeight ? {height: viewportHeight} : undefined} className="h-dvh min-h-0 flex flex-col bg-background overflow-x-hidden">
        <AppNav user={activeUser} />
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel
            defaultSize={40}
            minSize={30}
            maxSize={60}
            className={`min-h-0 ${pathname === "/app" ? "max-md:!flex-[1_1_100%]" : "max-md:hidden"}`}
          >
            <PaigeChat user={activeUser} session={session}
              clientId={isImpersonating ? impersonationContactId : undefined} />
          </ResizablePanel>
          <ResizableHandle withHandle className="max-md:hidden" />
          <ResizablePanel
            defaultSize={60}
            className={`min-h-0 ${pathname === "/app" ? "max-md:hidden" : "max-md:!flex-[1_1_100%]"}`}
          >
            <div className="h-full overflow-y-auto scroll-touch p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-6">
              {pathname === "/app" ? (
                <AppDashboardHome factors={financePortal ? factors : null} userId={scopedUser.id}
                  financePortal={financePortal} />
              ) : (
                <Outlet context={{ user: scopedUser, session }} />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {fundingSurfaces && <QuickStatsBar factors={factors} />}
      </div>
    </>
  );
}

/**
 * Reads the customer frame once for the whole portal, so every customer surface names the same
 * agent (Cura, or the business's own name for it) and the same business. Never PAIGE: PAIGE is the
 * owner's COO (owner ruling, 2026-10-19). The browser tab names the business's portal too; the
 * platform's own title is the marketing site's.
 */
function CustomerIdentityRoot({ userId, enabled, viewingAsClient, children }: { userId: string; enabled: boolean; viewingAsClient: boolean; children: ReactNode }) {
  // The access gate above already read the frame; this reads that same answer (one reader per page).
  const customer = useSharedClientPortalFrame(userId, enabled);
  // Staff standing is asked only when there is no customer frame (or staff are viewing as a client): a staff
  // viewer keeps the owner's assistant beside the owner's chat; anyone else's access is simply not active.
  // A frame that ended this session ("unavailable": access revoked, or refused) is resolved the same way, so a
  // revoked customer gets the no-access home rather than a home still "checking" their access (round 4). These are
  // the same two phases customerIdentityFrom resolves by staff standing.
  const standing = usePortalStaffStanding(userId, !viewingAsClient && (customer.phase === "not-client" || customer.phase === "unavailable"));
  const staff = viewingAsClient ? true : standing.staff;
  const ownerPlaybook = usePlaybook(staff === true);
  const business = customer.frame?.brand.tenant_name?.trim();
  useEffect(() => {
    // A staff viewer is not in a client's portal; only a customer (or someone whose access ended) is.
    if (staff === true && !customer.frame) return;
    const previous = document.title;
    document.title = business ? `${business} — Client Portal` : "Client Portal";
    // Leaving /app (View-as-Client ends, sign-out, a staff surface) restores the title it found.
    return () => { document.title = previous; };
  }, [business, staff, customer.frame]);
  const state = { frame: customer.frame, phase: viewingAsClient ? "not-client" as const : customer.phase, staff,
    staffAssistantName: staff === true ? ownerPlaybook.persona.name : null, staffChecking: !viewingAsClient && standing.loading };
  return <CustomerIdentityProvider state={state}>{children}</CustomerIdentityProvider>;
}

// Default home content when on /app
type CreditFactorScores = Database["public"]["Tables"]["credit_factor_scores"]["Row"];

export function AppDashboardHome({ factors, userId, financePortal = false }: {
  factors: CreditFactorScores | null | undefined; userId?: string;
  /** E09 F2 (AppShellBody): the business is finance-entitled, or the viewer is staff (Q5). */
  financePortal?: boolean;
}) {
  const customer = useCustomerIdentity();
  // Tenant-authored portal greeting (Portal Studio → portal_config.welcome).
  // Fail-open: an unset/empty overlay falls back to the current defaults, so
  // every existing portal is byte-for-byte unchanged until a tenant sets one.
  const savedConfig = useClientPortalConfig();
  const portalConfig: ClientPortalConfig = customer.frame?.config ?? (customer.phase === "not-client" ? savedConfig : {});
  // The customer's agent, never the owner's PAIGE persona (owner ruling, 2026-10-19). A staff viewer with no
  // customer frame sits beside the owner's own chat, so the home names the owner's assistant and greets as
  // the owner's Playbook does (§58: staff keep what they had); a viewer whose access is not active is told so.
  const agentName = customer.agentName;
  const staffPlaybook = usePlaybook(customer.viewer === "staff");
  // A customer's chat sits beside this home and greets them itself, so the home does not repeat that greeting
  // word for word (round 3, verifier 7); the welcome line already points to the agent. Staff, and a viewer whose
  // access is still being checked, keep the card they had (§58).
  const intro = customer.frame ? null
    : customer.viewer === "staff" ? { title: `${agentName} is here to help`, body: staffPlaybook.persona.greeting }
      : { title: `${agentName} is here to help`, body: "Your conversation is available once your customer access is checked." };
  const welcomeHeadline = portalConfig.welcome?.headline?.trim() || "Welcome Back";
  const welcomeSubhead = portalConfig.welcome?.subhead?.trim() || `Ask ${agentName} about your next steps.`;
  // `factors` is a real credit_factor_scores row — it only exists for a
  // credit-enabled tenant/client. It doubles as the "hasCreditData" signal, so
  // the credit-only factor grid below stays gated behind it. Coaching clients
  // (the neutral default) never have this row and see the neutral welcome area.
  const hasCreditData = financePortal && !!factors;

  // A person whose access is not active has nothing here: no chat to finish a checklist step in, no tiles, no
  // business to welcome them back to. The chat column beside this says their access isn't active, once, with
  // Contact support; the home says what will appear here instead of a bare "Welcome" over an empty pane (round 3).
  if (customer.viewer === "inactive") return <NoAccessHome />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {userId && <OnboardingChecklist userId={userId} financePortal={financePortal} />}
      <div>
        <h1 className="text-3xl font-bold text-foreground">{welcomeHeadline}</h1>
        {welcomeSubhead && <p className="text-muted-foreground mt-1">{welcomeSubhead}</p>}
      </div>

      <UpcomingWidget />

      {hasCreditData ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Payment History", score: factors.payment_history_score, weight: "35%" },
            { label: "Utilization", score: factors.utilization_score, weight: "30%" },
            { label: "Credit Age", score: factors.credit_age_score, weight: "15%" },
            { label: "Credit Mix", score: factors.credit_mix_score, weight: "10%" },
            { label: "Inquiries", score: factors.inquiry_score, weight: "10%" },
          ].map((f) => (
            <div
              key={f.label}
              className="bg-card border border-border rounded-lg p-4 text-center hover:border-accent/50 transition-colors"
            >
              <div className={`text-2xl font-bold ${getScoreColor(f.score)}`}>
                {f.score ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{f.label}</div>
              <div className="text-xs text-muted-foreground">{f.weight}</div>
            </div>
          ))}
        </div>
      ) : intro ? (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {intro.title}
          </h2>
          <p className="text-muted-foreground mt-2">{intro.body}</p>
        </div>
      ) : null}

      {userId && <ClientHomeTiles userId={userId} financePortal={financePortal} />}

      <ClientActivityFeed />

    </div>
  );
}

/** Home for a person whose portal access is not active: what will appear here, not an empty "Welcome". It fills the
 * pane and centres, so on desktop it sits level with the chat column's status beside it. */
function NoAccessHome() {
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center" data-testid="no-access-home">
      <h1 className="sr-only">Home</h1>
      <EmptyState
        icon={Inbox}
        title="Nothing is shared with you right now"
        description="When a business gives you portal access, the documents, sessions and messages it shares with you appear here."
      />
    </div>
  );
}

function QuickActionCard({ title, description, icon, href }: {
  title: string;
  description: string;
  icon: string;
  href: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="bg-card border border-border rounded-lg p-5 text-left hover:border-accent/50 hover:shadow-glow-teal transition-all group"
    >
      <span className="text-2xl">{icon}</span>
      <h3 className="font-semibold mt-2 group-hover:text-gold-dark transition-colors">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
    </button>
  );
}

function getScoreColor(score: number | null): string {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 80) return "text-fundability-excellent";
  if (score >= 60) return "text-fundability-good";
  if (score >= 40) return "text-fundability-fair";
  return "text-fundability-poor";
}

export default AppShell;
