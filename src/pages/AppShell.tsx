import { useState, useEffect, useRef } from "react";
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
import { AdminViewBanner } from "@/components/admin/AdminViewBanner";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { SessionTimeoutWarning } from "@/components/auth/SessionTimeoutWarning";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { OnboardingFlow } from "@/components/dashboard/OnboardingFlow";
import { PushNotificationPrompt } from "@/components/notifications/PushNotificationPrompt";
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
import { usePlaybook } from "@/lib/playbook";
import { useClientPortalConfig } from "@/hooks/useClientPortalConfig";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";

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
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(!DEV_MODE);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { target: impersonationTarget, isImpersonating } = useImpersonation();
  const effectiveUserId = impersonationTarget?.targetUserId ?? user?.id;
  const { factors } = useCreditFactors(effectiveUserId ?? null, { enabled: !!effectiveUserId });
  // Credit/funding client chrome (the QuickStatsBar → /app/credit and the
  // credit-first OnboardingFlow) is opt-in per tenant (§2/§9). Fail-closed:
  // hidden for every coaching-generic tenant until they turn on the funding
  // preset. Coaching clients keep the neutral /onboard + portal experience.
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
    const markSettled = () => {
      settled = true;
      setIsLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
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
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000)),
    ])
      .then((result) => {
        if (!result) return;
        const currentSession = result.data.session;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        markSettled();

        if (!currentSession) {
          navigate("/auth", { replace: true });
        }
      })
      .catch((err) => {
        console.error("[AppShell] getSession failed:", err);
        markSettled();
      });

    // Safety net: if neither getSession nor onAuthStateChange has resolved
    // in 5s (network stall, paused tab, stale lock), clear the loading gate
    // so the user can act instead of staring at "Loading..." forever.
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        console.warn("[AppShell] auth hydration timed out after 5s — releasing loading gate");
        setIsLoading(false);
        navigate("/auth", { replace: true });
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
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

  // Realtime: a client should see staff-driven onboarding stage advances
  // (or rollbacks) without refreshing. Listens only on the signed-in user's
  // own row and only invalidates client-scoped queries to avoid nuking the
  // entire cache on every row update.
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`clients-self-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clients", filter: `linked_user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["clients"] });
          queryClient.invalidateQueries({ queryKey: ["onboarding"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

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
          resolveLandingRoute(user.id),
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

  return (
    <>
      {!isImpersonating && <RequiredConsentsGate userId={activeUser.id} />}
      {!isImpersonating && fundingEnabled && <OnboardingFlow open={showOnboarding} onComplete={() => setShowOnboarding(false)} />}
      <AdminViewBanner />
      <SessionTimeoutWarning open={showWarning} onStaySignedIn={staySignedIn} />
      <PushNotificationPrompt />
      <div className="h-dvh flex flex-col bg-background overflow-x-hidden">
        <AppNav user={activeUser} />
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel
            defaultSize={40}
            minSize={30}
            maxSize={60}
            className={location.pathname === "/app" ? "max-md:!flex-[1_1_100%]" : "max-md:hidden"}
          >
            <PaigeChat user={scopedUser} session={session} />
          </ResizablePanel>
          <ResizableHandle withHandle className="max-md:hidden" />
          <ResizablePanel
            defaultSize={60}
            className={location.pathname === "/app" ? "max-md:hidden" : "max-md:!flex-[1_1_100%]"}
          >
            <div className="h-full overflow-y-auto scroll-touch p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-6">
              {location.pathname === "/app" ? (
                <AppDashboardHome factors={factors} userId={scopedUser.id} />
              ) : (
                <Outlet context={{ user: scopedUser, session }} />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        {fundingEnabled && <QuickStatsBar factors={factors} />}
      </div>
    </>
  );
};

// Default home content when on /app
type CreditFactorScores = Database["public"]["Tables"]["credit_factor_scores"]["Row"];

function AppDashboardHome({ factors, userId }: { factors: CreditFactorScores | null | undefined; userId?: string }) {
  const pb = usePlaybook();
  // Tenant-authored portal greeting (Portal Studio → portal_config.welcome).
  // Fail-open: an unset/empty overlay falls back to the current defaults, so
  // every existing portal is byte-for-byte unchanged until a tenant sets one.
  const portalConfig = useClientPortalConfig();
  const welcomeHeadline = portalConfig.welcome?.headline?.trim() || "Welcome Back";
  const welcomeSubhead =
    portalConfig.welcome?.subhead?.trim() ||
    `Ask ${pb.persona.name} anything — she's here to keep you moving toward your goals.`;
  // `factors` is a real credit_factor_scores row — it only exists for a
  // credit-enabled tenant/client. It doubles as the "hasCreditData" signal, so
  // the credit-only factor grid below stays gated behind it. Coaching clients
  // (the neutral default) never have this row and see the neutral welcome area.
  const hasCreditData = !!factors;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {userId && <OnboardingChecklist userId={userId} />}
      <div>
        <h1 className="text-3xl font-bold text-foreground">{welcomeHeadline}</h1>
        <p className="text-muted-foreground mt-1">{welcomeSubhead}</p>
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
              <div className="text-[10px] text-muted-foreground/60">{f.weight}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-foreground">
            {pb.persona.name} is here to help
          </h2>
          <p className="text-muted-foreground mt-2">{pb.persona.greeting}</p>
        </div>
      )}

      {userId && <ClientHomeTiles userId={userId} />}

      <ClientActivityFeed />

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
