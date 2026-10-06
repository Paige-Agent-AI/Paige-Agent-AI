import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Auto-recover from stale chunk errors after a new deploy.
// When index.html is cached but references hashed JS chunks that no longer
// exist, dynamic imports throw "Failed to fetch dynamically imported module".
// We reload once (guarded by sessionStorage) to pick up the fresh index.html.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic accepts any lazy component
const lazyWithReload = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) =>
  React.lazy(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem("__chunk_reload__"); } catch { /* best-effort cleanup */ }
      return mod;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-import error is untyped
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        /Failed to fetch dynamically imported module|Importing a module script failed|Unexpected end of input|ChunkLoadError|Loading chunk/i.test(msg) &&
        !sessionStorage.getItem("__chunk_reload__")
      ) {
        sessionStorage.setItem("__chunk_reload__", "1");
        window.location.reload();
        // Return a never-resolving promise while the page reloads.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
// Vercel Speed Insights — Core Web Vitals from real visitors. This is a Vite +
// React SPA, so we use the framework-agnostic /react entry (NOT /next).
import { SpeedInsights } from "@vercel/speed-insights/react";
import { MetaPixel } from "./components/seo/MetaPixel";
import { TenantProvider } from "./hooks/useTenantContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { DashboardModeProvider } from "./contexts/DashboardModeContext";
import { BusinessProvider } from "./contexts/BusinessContext";
import { ImpersonationProvider } from "./contexts/ImpersonationContext";
import { ClientOnlyRouteGuard } from "./components/auth/ClientOnlyRouteGuard";
import { useHostRouting } from "./lib/hostRouting";
import { useReferralTracking } from "./hooks/useReferralTracking";
import { GlobalAuthSessionManager } from "./lib/auth/GlobalAuthSessionManager";
import { usePageView } from "./hooks/useAnalytics";
import { PlatformUpdateBanner } from "./components/PlatformUpdateBanner";

// Eagerly load only the public landing + auth pages (likely first-paint)
import Auth from "./pages/Auth";
import InvoiceDocument from "./pages/InvoiceDocument";
import PaymentReturn from "./pages/PaymentReturn";
const OperatorEntry = lazyWithReload(() => import("@/operator/OperatorEntry"));
const JoinPlatform = lazyWithReload(() => import("./pages/JoinPlatform"));
const McpOAuthCallback = lazyWithReload(() => import("./pages/McpOAuthCallback"));
const ZapierOAuthCallback = lazyWithReload(() => import("./pages/ZapierOAuthCallback"));
const BookingPage = lazyWithReload(() => import("./pages/BookingPage"));
const ManageBooking = lazyWithReload(() => import("./pages/ManageBooking"));
const PaigeHome = lazyWithReload(() => import("./pages/PaigeHome"));
const Onboarding = lazyWithReload(() => import("./pages/Onboarding"));
const McpAuthorize = lazyWithReload(() => import("./pages/McpAuthorize"));
const JoinWorkspace = lazyWithReload(() => import("./pages/JoinWorkspace"));
const AgreementSigning = lazyWithReload(() => import("./pages/sign/AgreementSigning"));
const PortalGateway = lazyWithReload(() => import("./pages/PortalGateway"));
const TenantStorefront = lazyWithReload(() => import("./pages/public/TenantStorefront"));
const GrowthPageRenderer = lazyWithReload(() => import("./pages/public/GrowthPageRenderer"));
const GrowthFormRenderer = lazyWithReload(() => import("./pages/public/GrowthFormRenderer"));
const GrowthFunnelRenderer = lazyWithReload(() => import("./pages/public/GrowthFunnelRenderer"));
import NotFound from "./pages/NotFound";

// Everything else is lazy-loaded for a smaller initial bundle
const AppShell = lazyWithReload(() => import("./pages/AppShell"));
const CreditIntelligence = lazyWithReload(() => import("./pages/CreditIntelligence"));
const FundingMatches = lazyWithReload(() => import("./pages/FundingMatches"));
const FundingJourney = lazyWithReload(() => import("./pages/FundingJourney"));
const FinancialProfile = lazyWithReload(() => import("./pages/FinancialProfile"));
// Agency Operator side (§9) — its own top-level shell, peer to the God console.
// AgencyEntry (§65 R0-slice-2) dispatches `/agency/*`: a numeric first segment
// (/agency/{account}/…) → the new URL-driven AgencyApp shell; anything else → the
// legacy AgencyLayout board (gated on server-proven agency-manager eligibility).
const AgencyEntry = lazyWithReload(() => import("./agency/AgencyEntry"));
// Sub-account operator side (§65 R3c-i) — the same AgencyApp shell (mode=
// "subaccount"), its own top-level address (/business/{account}), peer to
// /agency and the canonical tenant shells.
const BusinessEntry = lazyWithReload(() => import("./business/BusinessEntry"));
// Tenant-account redesign prototype — local representative data only; no backend seams.
const TenantRedesign = lazyWithReload(() => import("./prototype/TenantRedesign"));
// Solo operator side (§65 R3d-i) — the SoloApp shell, its own top-level
// address (/solo/{account}), peer to /business and /agency.
const SoloEntry = lazyWithReload(() => import("./solo/SoloEntry"));
const ChooseAccount = lazyWithReload(() => import("./pages/ChooseAccount"));
const ResetPassword = lazyWithReload(() => import("./pages/ResetPassword"));
const AffiliateApply = lazyWithReload(() => import("./pages/AffiliateApply"));
const BrokerApply = lazyWithReload(() => import("./pages/BrokerApply"));
const BrokerWorkspace = lazyWithReload(() => import("./pages/broker/BrokerWorkspace"));
const BrokerOverview = lazyWithReload(() => import("./pages/broker/BrokerOverview"));
const BrokerClients = lazyWithReload(() => import("./pages/broker/BrokerClients"));
const BrokerSettings = lazyWithReload(() => import("./pages/broker/BrokerSettings"));
const BrokerComingSoon = lazyWithReload(() => import("./pages/broker/BrokerComingSoon"));
const BrokerCommissions = lazyWithReload(() => import("./pages/broker/BrokerCommissions"));
const BrokerMCC = lazyWithReload(() => import("./pages/broker/BrokerMCC"));
const BrokerSessions = lazyWithReload(() => import("./pages/broker/BrokerSessions"));
const BrokerPaigeSession = lazyWithReload(() => import("./pages/broker/BrokerPaigeSession"));
const BrokerTeam = lazyWithReload(() => import("./pages/broker/BrokerTeam"));
const AcceptBrokerInvite = lazyWithReload(() => import("./pages/broker/AcceptBrokerInvite"));
const Unsubscribe = lazyWithReload(() => import("./pages/Unsubscribe"));
const Terms = lazyWithReload(() => import("./pages/Terms"));
const Privacy = lazyWithReload(() => import("./pages/Privacy"));
const SmsTerms = lazyWithReload(() => import("./pages/SmsTerms"));
const LegalDoc = lazyWithReload(() => import("./pages/LegalDoc"));
const About = lazyWithReload(() => import("./pages/About"));
const Pricing = lazyWithReload(() => import("./pages/Pricing"));
const Welcome = lazyWithReload(() => import("./pages/Welcome"));
const Blog = lazyWithReload(() => import("./pages/Blog"));

// BTF workspace surface removed — consumer /app dashboard is the single client home. (Sprint 211.b cleanup)
const OnboardLayout = lazyWithReload(() => import("./pages/onboard/OnboardLayout"));
const OnboardStep1 = lazyWithReload(() => import("./pages/onboard/Step1Welcome"));
const OnboardStep2 = lazyWithReload(() => import("./pages/onboard/Step2Agreement"));
// Onboarding is now two gates (welcome + agreement); everything past agreement
// happens inside /workspace under Paige. The old Step3-6 (payment/intake/docs/
// complete) were dead — OnboardLayout aliases those paths to /app so they never
// rendered — and carried hardcoded §2 funding content. Removed in the final
// wiring audit. If a paid-onboarding step returns, build it Playbook-driven.
const AcceptInvite = lazyWithReload(() => import("./pages/AcceptInvite"));

// Lazy-load existing dashboard sections for /app/* routes
const RepositioningNotice = lazyWithReload(() => import("./components/dashboard/RepositioningNotice").then(m => ({ default: m.RepositioningNotice })));
const LearningVault = lazyWithReload(() => import("./components/dashboard/LearningVault").then(m => ({ default: m.LearningVault })));
const CourseViewer = lazyWithReload(() => import("./pages/CourseViewer"));
const BusinessInfrastructureAssessment = lazyWithReload(() => import("./components/dashboard/business-profile/BusinessInfrastructureAssessment").then(m => ({ default: m.BusinessInfrastructureAssessment })));
const ProfileSettings = lazyWithReload(() => import("./components/dashboard/ProfileSettings").then(m => ({ default: m.ProfileSettings })));
const AffiliateTracking = lazyWithReload(() => import("./components/dashboard/AffiliateTracking").then(m => ({ default: m.AffiliateTracking })));
const Support = lazyWithReload(() => import("./pages/Support"));
const MyAgreements = lazyWithReload(() => import("./pages/MyAgreements"));
const ClientApprovals = lazyWithReload(() => import("./pages/ClientApprovals"));
const ActionItems = lazyWithReload(() => import("./pages/app/ActionItems"));
const Planning = lazyWithReload(() => import("./pages/app/Planning"));
// #244 — the canonical "About Your Paige Team" directory. ONE component, scope prop
// per route (tenant here; operator in Admin.tsx; agency in AgencyLayout.tsx).
const PaigeTeamDirectory = lazyWithReload(() => import("./pages/PaigeTeamDirectory"));
const GoogleCalendarCallback = lazyWithReload(() => import("./pages/GoogleCalendarCallback"));
const GmailCallback = lazyWithReload(() => import("./pages/GmailCallback"));

// Bounces a signed-in-but-incomplete signup (no lane/agreement/workspace yet) to
// the /onboarding gate. Not lazy — it's a thin wrapper around the app shells.
import { RequireCompleteSignup } from "@/components/auth/RequireCompleteSignup";
import { RequireSoloBetaEntitlement } from "@/components/auth/RequireSoloBetaEntitlement";
import { RequireSetupComplete } from "@/components/auth/RequireSetupComplete";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

// Neutral, surface-agnostic route-chunk fallback: this wraps EVERY route — public/marketing
// (/, /signup, /portal/:slug…), auth, and product routes — so it stays shell-neutral (a
// product shell would flash on the landing page). Canonical surfaces render their
// own loading state once their chunk loads; here we only bridge the chunk fetch.
const SuspenseFallback = () => (
  <div className="grid min-h-[60vh] place-items-center bg-background" role="status" aria-label="Loading">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-[hsl(var(--primary))]" />
  </div>
);

const PageSuspense = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense fallback={<SuspenseFallback />}>{children}</React.Suspense>
);

// RETIRED 2026-09-06 (owner architecture decision): there is NO floating Paige chat anywhere.
// The floating support-style widget (FloatingChatbot) used to render globally, gated by a
// route deny-list, which leaked it onto authenticated surfaces (broker, portal, onboarding,
// welcome, choose-account) AND onto public marketing pages where a signed-in visitor's session
// would have carried tenant/consumer context into it. The ONLY tenant-aware Paige experience is
// the dedicated authenticated Paige chat/workspace. A public "Product Guide" is a separate,
// tenant-isolated product and is UNAVAILABLE today — never a stripped-down tenant chat
// (docs/product/public-product-guide-contract.md). The regression guard in
// src/__tests__/no-floating-platform-chat.test.ts fails if any floating Paige chat is re-mounted.

const AppInner = () => {
  useHostRouting();
  useReferralTracking();
  usePageView();
  return <GlobalAuthSessionManager />;
};

function SignupRedirect() {
  return <Navigate to="/auth?mode=signup&plan=solo&billing=monthly" replace />;
}

// /render-frame — the DB-free page paige-browser screenshots for the §33 critique loop. Like /invoice it
// short-circuits BEFORE every provider: no auth, tenant context, router, analytics or Supabase reads.
const RenderFrame = lazyWithReload(() => import("./pages/public/RenderFrame"));
const isRenderFramePath = (pathname: string) => /^\/render-frame\/?$/i.test(pathname);

const App = () => /^\/payment-return\/?$/i.test(window.location.pathname) ? <PaymentReturn /> : /^\/invoice\/?$/i.test(window.location.pathname) ? <InvoiceDocument /> : isRenderFramePath(window.location.pathname) ? (
  <React.Suspense fallback={null}><RenderFrame /></React.Suspense>
) : (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {/* One shared tenant-scope context for the whole app (operator/tenant mode +
          active tenant). Mounted here — inside QueryClientProvider — so a mode
          switch propagates to every consumer at once (fixes the silent per-
          component-state mode-switch bug). */}
      <TenantProvider>
      <SubscriptionProvider>
        <BusinessProvider>
        <DashboardModeProvider>
        <ImpersonationProvider>
        <Toaster />
        <Sonner />
        {/* Global platform auto-update banner (#177) — outside <Routes> so it
            persists across navigation and is visible on every surface (operator,
            public, tenant custom domains). Client-side → domain-agnostic. */}
        <PlatformUpdateBanner />
        <BrowserRouter>
          <AppInner />
          <MetaPixel />
          <SpeedInsights />
          <ClientOnlyRouteGuard />
          <Routes>
            {/* Live homepage — the new gold+indigo Paige design */}
            <Route path="/" element={<PageSuspense><PaigeHome /></PageSuspense>} />
            {/* Retired public design routes resolve to the one canonical homepage. */}
            <Route path="/premium" element={<Navigate to="/" replace />} />
            <Route path="/legacy" element={<Navigate to="/" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/choose-account" element={<PageSuspense><ChooseAccount /></PageSuspense>} />
            <Route path="/login" element={<Navigate to="/auth" replace />} />
            {/* §65 R4 — the operator subtree. The `index` leg inside OperatorEntry keeps bare
                /operator as the login door (nothing in the product links to it, so a blank
                root would ship undetected); `:section/*` is the console behind ONE guard. */}
            <Route path="/tenant-redesign" element={<PageSuspense><TenantRedesign /></PageSuspense>} />
            <Route path="/operator/*" element={<PageSuspense><OperatorEntry /></PageSuspense>} />
            <Route path="/join-platform" element={<PageSuspense><JoinPlatform /></PageSuspense>} />
            {/* Where a provider's consent lands. The path is registered with the provider
                and compared by it on every exchange, so it is fixed rather than derived
                from anything a caller can influence. */}
            <Route path="/oauth/mcp/callback" element={<PageSuspense><McpOAuthCallback /></PageSuspense>} />
            <Route path="/oauth/zapier/callback" element={<PageSuspense><ZapierOAuthCallback /></PageSuspense>} />
            <Route path="/book/:slug" element={<PageSuspense><BookingPage /></PageSuspense>} />
            <Route path="/booking/manage" element={<PageSuspense><ManageBooking /></PageSuspense>} />
            <Route path="/signup" element={<SignupRedirect />} />
            <Route path="/get-started" element={<SignupRedirect />} />
            <Route path="/onboarding" element={<PageSuspense><Onboarding /></PageSuspense>} />
            <Route path="/signup/coach-qualify" element={<SignupRedirect />} />
            <Route path="/reset-password" element={<PageSuspense><ResetPassword /></PageSuspense>} />
            <Route path="/accept-invite" element={<PageSuspense><AcceptInvite /></PageSuspense>} />
            <Route path="/join/:token" element={<PageSuspense><JoinWorkspace /></PageSuspense>} />
            {/* Public and unauthenticated by design: the counterparty signing an agreement has no
              * account and will never make one. The token in the path IS the authorisation, and the
              * server derives every id from it (§9). */}
            <Route path="/sign/:token" element={<PageSuspense><AgreementSigning /></PageSuspense>} />
            <Route path="/portal/:tenantSlug" element={<PageSuspense><PortalGateway /></PageSuspense>} />
            <Route path="/mcp/authorize" element={<PageSuspense><McpAuthorize /></PageSuspense>} />
            <Route path="/auth/google-calendar/callback" element={<PageSuspense><GoogleCalendarCallback /></PageSuspense>} />
            <Route path="/auth/gmail/callback" element={<PageSuspense><GmailCallback /></PageSuspense>} />

            {/* New agent-first dashboard */}
            <Route path="/app" element={<RequireCompleteSignup><PageSuspense><AppShell /></PageSuspense></RequireCompleteSignup>}>
              <Route index element={null} />
              <Route path="credit" element={<PageSuspense><CreditIntelligence /></PageSuspense>} />
              <Route path="funding" element={<PageSuspense><FundingMatches /></PageSuspense>} />
              <Route path="funding-journey" element={<PageSuspense><FundingJourney /></PageSuspense>} />
              {/* Legacy dispute routes — repositioned to a notice + CFPB redirect + CSV export */}
              <Route path="disputes" element={<PageSuspense><RepositioningNotice /></PageSuspense>} />
              <Route path="learn" element={<PageSuspense><LearningVault /></PageSuspense>} />
              <Route path="learn/:courseId" element={<PageSuspense><CourseViewer /></PageSuspense>} />
              <Route path="business" element={<PageSuspense><BusinessInfrastructureAssessment /></PageSuspense>} />
              <Route path="business-profile" element={<PageSuspense><BusinessInfrastructureAssessment /></PageSuspense>} />
              <Route path="financial-profile" element={<PageSuspense><FinancialProfile /></PageSuspense>} />
              <Route path="support" element={<PageSuspense><Support /></PageSuspense>} />
              <Route path="settings" element={<PageSuspense><ProfileSettings /></PageSuspense>} />
              <Route path="agreements" element={<PageSuspense><MyAgreements /></PageSuspense>} />
              <Route path="affiliate" element={<PageSuspense><AffiliateTracking /></PageSuspense>} />
              <Route path="approvals" element={<PageSuspense><ClientApprovals /></PageSuspense>} />
              <Route path="actions" element={<PageSuspense><ActionItems /></PageSuspense>} />
              <Route path="planning" element={<PageSuspense><Planning /></PageSuspense>} />
              {/* #244 — learn about your Paige team (tenant scope). Read-only; inherits
                  /app's RequireCompleteSignup, no extra gate. NOT /team — that would break
                  the /app/* tenant convention (§18); this is the non-colliding home. */}
              <Route path="paige-team" element={<PageSuspense><PaigeTeamDirectory scope="tenant" /></PageSuspense>} />
            </Route>

            {/* Backward compat redirect */}
            <Route path="/dashboard" element={<Navigate to="/app" replace />} />

            {/* Setup gate (owner 2026-08-16): a tenant with no chosen playbook is held on
                the marketplace/Setup chooser — nested INSIDE RequireCompleteSignup so signup
                (provision + agreement) still comes first. NO-OP for operators/God, clients,
                and any tenant that already chose a playbook. Canonical Setup is
                reachable while gated — no loop. */}
            {/* /agency is the agency-MANAGER console — an agency never picks a business
                playbook (§61), so it is NOT wrapped in RequireSetupComplete (that gate is
                for Solo/Sub-account business tenants only). The gate also no-ops for the
                agency tier defensively. */}
            <Route path="/agency/*" element={<RequireCompleteSignup><PageSuspense><AgencyEntry /></PageSuspense></RequireCompleteSignup>} />
            {/* /business is a SUB-ACCOUNT's own address (§65 R3c-i) — a real business
                tenant (picks a playbook like Solo), so it carries the SAME Setup gate
                as /solo, unlike /agency (a manager tier that never picks one, §61). */}
            <Route path="/business/*" element={<RequireCompleteSignup><RequireSetupComplete><PageSuspense><BusinessEntry /></PageSuspense></RequireSetupComplete></RequireCompleteSignup>} />
            {/* /solo is a SOLO tenant's own address (§65 R3d-i) — same wrapping as
                /business (a real business tenant that picks a playbook). */}
            <Route path="/solo/*" element={<RequireCompleteSignup><RequireSoloBetaEntitlement><RequireSetupComplete><PageSuspense><SoloEntry /></PageSuspense></RequireSetupComplete></RequireSoloBetaEntitlement></RequireCompleteSignup>} />
            <Route path="/unsubscribe" element={<PageSuspense><Unsubscribe /></PageSuspense>} />
            {/* Comms C-2s-C — tenant one-click/footer unsubscribe. SAME Unsubscribe surface (§18),
                branded /u/:token path form; the component routes the token to comms-email-unsubscribe. */}
            <Route path="/u/:token" element={<PageSuspense><Unsubscribe /></PageSuspense>} />
           <Route path="/terms" element={<PageSuspense><Terms /></PageSuspense>} />
           <Route path="/privacy" element={<PageSuspense><Privacy /></PageSuspense>} />
           <Route path="/sms-terms" element={<PageSuspense><SmsTerms /></PageSuspense>} />
           <Route path="/legal/:slug" element={<PageSuspense><LegalDoc /></PageSuspense>} />
            <Route path="/about" element={<PageSuspense><About /></PageSuspense>} />
            <Route path="/pricing" element={<PageSuspense><Pricing /></PageSuspense>} />
            {/* Post-checkout wait page — absorbs the webhook↔session race, polls for
                the provisioned tenant, then forwards through canonical account selection. */}
            <Route path="/welcome" element={<PageSuspense><Welcome /></PageSuspense>} />
            <Route path="/blog" element={<PageSuspense><Blog /></PageSuspense>} />
            <Route path="/affiliates" element={<PageSuspense><AffiliateApply /></PageSuspense>} />
            <Route path="/become-an-affiliate" element={<Navigate to="/affiliates" replace />} />
            <Route path="/broker" element={<PageSuspense><BrokerApply /></PageSuspense>} />
            <Route path="/brokers" element={<Navigate to="/broker" replace />} />
            <Route path="/broker/accept-invite" element={<PageSuspense><AcceptBrokerInvite /></PageSuspense>} />

            {/* Public tenant storefront */}
            <Route path="/store/:slug" element={<PageSuspense><TenantStorefront /></PageSuspense>} />

            {/* Growth OS public surfaces — landing pages, hosted forms, funnels */}
            <Route path="/p/:tenantSlug/:pageSlug" element={<PageSuspense><GrowthPageRenderer /></PageSuspense>} />
            <Route path="/f/:tenantSlug/:funnelSlug" element={<PageSuspense><GrowthFunnelRenderer /></PageSuspense>} />
            <Route path="/form/:id" element={<PageSuspense><GrowthFormRenderer /></PageSuspense>} />

            {/* Legacy BTF workspace surface removed — everything lives in the consumer /app dashboard now. (Sprint 211.b cleanup)
                Preserve invite deep-links by redirecting to the unified /accept-invite handler; all other
                /workspace/* URLs land in the consumer dashboard. */}
            <Route path="/workspace/accept-invite" element={<Navigate to={`/accept-invite${window.location.search}`} replace />} />
            {/* Customer action-bus notifications link here (admin_propose_paige_actions). */}
            <Route path="/workspace/paige/actions" element={<Navigate to="/app/actions" replace />} />
            <Route path="/workspace/*" element={<Navigate to="/app" replace />} />

            {/* Client program onboarding wizard — admin-triggered, magic-link entry */}
            <Route path="/onboard" element={<PageSuspense><OnboardLayout /></PageSuspense>}>
              <Route index element={<PageSuspense><OnboardStep1 /></PageSuspense>} />
              <Route path="welcome" element={<PageSuspense><OnboardStep1 /></PageSuspense>} />
              <Route path="agreement" element={<PageSuspense><OnboardStep2 /></PageSuspense>} />
              {/* Deep-link self-heal: any unknown /onboard/* path (incl. the
                  retired payment/intake/documents/complete) renders the layout so
                  it can normalize the URL to the current stage → /app. */}
              <Route path="*" element={<PageSuspense><OnboardStep1 /></PageSuspense>} />
            </Route>

            {/* Broker workspace (signed-in brokers) */}
            <Route path="/broker/app" element={<PageSuspense><BrokerWorkspace /></PageSuspense>}>
              <Route index element={<PageSuspense><BrokerOverview /></PageSuspense>} />
              <Route path="clients" element={<PageSuspense><BrokerClients /></PageSuspense>} />
              <Route path="sessions" element={<PageSuspense><BrokerSessions /></PageSuspense>} />
              <Route path="sessions/:relationshipId" element={<PageSuspense><BrokerPaigeSession /></PageSuspense>} />
              <Route path="team" element={<PageSuspense><BrokerTeam /></PageSuspense>} />
              <Route path="commissions" element={<PageSuspense><BrokerCommissions /></PageSuspense>} />
              <Route path="mcc" element={<PageSuspense><BrokerMCC /></PageSuspense>} />
              <Route path="settings" element={<PageSuspense><BrokerSettings /></PageSuspense>} />
            </Route>
            {/* /pricing renders the real Pricing page (declared above); the legacy
                Navigate to /#pricing was removed so the pay-before-workspace flow
                lands on the real storefront. */}

            {/* Backward-compat: bare /clients links route into the admin workspace */}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </ImpersonationProvider>
        </DashboardModeProvider>
        </BusinessProvider>
      </SubscriptionProvider>
      </TenantProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
