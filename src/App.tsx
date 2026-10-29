import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A failed route stays recoverable; only an explicit user action reloads.
const lazyPage = React.lazy;
import { PageLoadBoundary } from "@/components/app/PageLoadBoundary";
import { ThemeProvider } from "next-themes";
import { embeddedFormTheme, isFormOnBusinessSite } from "@/hooks/useEmbedHeight";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
// Vercel Speed Insights — Core Web Vitals from real visitors. This is a Vite +
// React SPA, so we use the framework-agnostic /react entry (NOT /next).
import { SpeedInsights } from "@vercel/speed-insights/react";
import { MetaPixel } from "./components/seo/MetaPixel";
import { TenantProvider } from "./hooks/useTenantContext";
import { SubscriptionProvider } from "./contexts/SubscriptionContext";
import { DashboardModeProvider } from "./contexts/DashboardModeContext";
import { BusinessProvider } from "./contexts/BusinessContext";
import { ImpersonationProvider } from "./contexts/ImpersonationContext";
import { ComposerDraftSessionBinding } from "./components/paige/ComposerDraftSessionBinding";
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
const OperatorEntry = lazyPage(() => import("@/operator/OperatorEntry"));
const JoinPlatform = lazyPage(() => import("./pages/JoinPlatform"));
const McpOAuthCallback = lazyPage(() => import("./pages/McpOAuthCallback"));
const ZapierOAuthCallback = lazyPage(() => import("./pages/ZapierOAuthCallback"));
const BookingPage = lazyPage(() => import("./pages/BookingPage"));
// EXP07 broadcast slice: the live room (host + seated members; the SDK is code-split to
// exactly this route so the Social tab never carries it).
const LiveRoom = lazyPage(() => import("./pages/LiveRoom"));
const ManageBooking = lazyPage(() => import("./pages/ManageBooking"));
const PaigeHome = lazyPage(() => import("./pages/PaigeHome"));
const Onboarding = lazyPage(() => import("./pages/Onboarding"));
const McpAuthorize = lazyPage(() => import("./pages/McpAuthorize"));
const JoinWorkspace = lazyPage(() => import("./pages/JoinWorkspace"));
const AgreementSigning = lazyPage(() => import("./pages/sign/AgreementSigning"));
const PortalGateway = lazyPage(() => import("./pages/PortalGateway"));
const TenantStorefront = lazyPage(() => import("./pages/public/TenantStorefront"));
const GrowthPageRenderer = lazyPage(() => import("./pages/public/GrowthPageRenderer"));
const GrowthFormRenderer = lazyPage(() => import("./pages/public/GrowthFormRenderer"));
const GrowthFunnelRenderer = lazyPage(() => import("./pages/public/GrowthFunnelRenderer"));
import NotFound from "./pages/NotFound";

// Everything else is lazy-loaded for a smaller initial bundle
const AppShell = lazyPage(() => import("./pages/AppShell"));
const CreditIntelligence = lazyPage(() => import("./pages/CreditIntelligence"));
const FundingMatches = lazyPage(() => import("./pages/FundingMatches"));
const FundingJourney = lazyPage(() => import("./pages/FundingJourney"));
const FinancialProfile = lazyPage(() => import("./pages/FinancialProfile"));
// Agency Operator side (§9) — its own top-level shell, peer to the God console.
// AgencyEntry (§65 R0-slice-2) dispatches `/agency/*`: a numeric first segment
// (/agency/{account}/…) → the new URL-driven AgencyApp shell; anything else → the
// legacy AgencyLayout board (gated on server-proven agency-manager eligibility).
const AgencyEntry = lazyPage(() => import("./agency/AgencyEntry"));
// Sub-account operator side (§65 R3c-i) — the same AgencyApp shell (mode=
// "subaccount"), its own top-level address (/business/{account}), peer to
// /agency and the canonical tenant shells.
const BusinessEntry = lazyPage(() => import("./business/BusinessEntry"));
// Tenant-account redesign prototype — local representative data only; no backend seams.
const TenantRedesign = lazyPage(() => import("./prototype/TenantRedesign"));
// Solo operator side (§65 R3d-i) — the SoloApp shell, its own top-level
// address (/solo/{account}), peer to /business and /agency.
const SoloEntry = lazyPage(() => import("./solo/SoloEntry"));
const ChooseAccount = lazyPage(() => import("./pages/ChooseAccount"));
const ResetPassword = lazyPage(() => import("./pages/ResetPassword"));
const AffiliateApply = lazyPage(() => import("./pages/AffiliateApply"));
const BrokerApply = lazyPage(() => import("./pages/BrokerApply"));
const BrokerWorkspace = lazyPage(() => import("./pages/broker/BrokerWorkspace"));
const BrokerOverview = lazyPage(() => import("./pages/broker/BrokerOverview"));
const BrokerClients = lazyPage(() => import("./pages/broker/BrokerClients"));
const BrokerSettings = lazyPage(() => import("./pages/broker/BrokerSettings"));
const BrokerComingSoon = lazyPage(() => import("./pages/broker/BrokerComingSoon"));
const BrokerCommissions = lazyPage(() => import("./pages/broker/BrokerCommissions"));
const BrokerMCC = lazyPage(() => import("./pages/broker/BrokerMCC"));
const BrokerSessions = lazyPage(() => import("./pages/broker/BrokerSessions"));
const BrokerPaigeSession = lazyPage(() => import("./pages/broker/BrokerPaigeSession"));
const BrokerTeam = lazyPage(() => import("./pages/broker/BrokerTeam"));
const AcceptBrokerInvite = lazyPage(() => import("./pages/broker/AcceptBrokerInvite"));
const Unsubscribe = lazyPage(() => import("./pages/Unsubscribe"));
const Terms = lazyPage(() => import("./pages/Terms"));
const Privacy = lazyPage(() => import("./pages/Privacy"));
const SmsTerms = lazyPage(() => import("./pages/SmsTerms"));
const LegalDoc = lazyPage(() => import("./pages/LegalDoc"));
const About = lazyPage(() => import("./pages/About"));
const Pricing = lazyPage(() => import("./pages/Pricing"));
const Welcome = lazyPage(() => import("./pages/Welcome"));
const Blog = lazyPage(() => import("./pages/Blog"));

// BTF workspace surface removed — consumer /app dashboard is the single client home. (Sprint 211.b cleanup)
const OnboardLayout = lazyPage(() => import("./pages/onboard/OnboardLayout"));
const OnboardStep1 = lazyPage(() => import("./pages/onboard/Step1Welcome"));
const OnboardStep2 = lazyPage(() => import("./pages/onboard/Step2Agreement"));
// Onboarding is now two gates (welcome + agreement); everything past agreement
// happens inside /workspace under Paige. The old Step3-6 (payment/intake/docs/
// complete) were dead — OnboardLayout aliases those paths to /app so they never
// rendered — and carried hardcoded §2 funding content. Removed in the final
// wiring audit. If a paid-onboarding step returns, build it Playbook-driven.
const AcceptInvite = lazyPage(() => import("./pages/AcceptInvite"));

// Lazy-load existing dashboard sections for /app/* routes
const RepositioningNotice = lazyPage(() => import("./components/dashboard/RepositioningNotice").then(m => ({ default: m.RepositioningNotice })));
const LearningVault = lazyPage(() => import("./pages/app/Resources"));
const CourseViewer = lazyPage(() => import("./pages/CourseViewer"));
const BusinessInfrastructureAssessment = lazyPage(() => import("./components/dashboard/business-profile/BusinessInfrastructureAssessment").then(m => ({ default: m.BusinessInfrastructureAssessment })));
const ProfileSettings = lazyPage(() => import("./components/dashboard/ProfileSettings").then(m => ({ default: m.ProfileSettings })));
const AffiliateTracking = lazyPage(() => import("./components/dashboard/AffiliateTracking").then(m => ({ default: m.AffiliateTracking })));
const Support = lazyPage(() => import("./pages/Support"));
const MyAgreements = lazyPage(() => import("./pages/MyAgreements"));
// E09 Slice A — a customer's Sales Agreements; everyone else still gets MyAgreements there, unchanged (§58).
const ClientAgreements = lazyPage(() => import("./pages/app/Agreements"));
const ClientApprovals = lazyPage(() => import("./pages/ClientApprovals"));
const ActionItems = lazyPage(() => import("./pages/app/ActionItems"));
const ClientDocuments = lazyPage(() => import("./pages/app/ClientDocuments"));
const ClientMessages = lazyPage(() => import("./pages/app/Messages"));
const ClientSessions = lazyPage(() => import("./pages/app/Sessions"));
const ClientProgress = lazyPage(() => import("./pages/app/Progress"));
const ClientPayments = lazyPage(() => import("./pages/app/Billing"));
const ClientPaymentsInvoice = lazyPage(() => import("./pages/app/BillingInvoice"));
const Planning = lazyPage(() => import("./pages/app/Planning"));
// #244 — the canonical "About Your Paige Team" directory. ONE component, scope prop
// per route (tenant here; operator in Admin.tsx; agency in AgencyLayout.tsx).
const PaigeTeamDirectory = lazyPage(() => import("./pages/PaigeTeamDirectory"));
const GoogleCalendarCallback = lazyPage(() => import("./pages/GoogleCalendarCallback"));
const GmailCallback = lazyPage(() => import("./pages/GmailCallback"));

// Bounces a signed-in-but-incomplete signup (no lane/agreement/workspace yet) to
// the /onboarding gate. Not lazy — it's a thin wrapper around the app shells.
import { RequireCompleteSignup } from "@/components/auth/RequireCompleteSignup";
import { RequirePortalStaff } from "@/components/auth/RequirePortalStaff";
import { CustomerFinanceRoute } from "@/components/admin/FundingRoute";
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

const PageSuspense = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  return <PageLoadBoundary resetKey={location.pathname}>
    <React.Suspense fallback={<SuspenseFallback />}>{children}</React.Suspense>
  </PageLoadBoundary>;
};

// RETIRED 2026-09-06 (owner architecture decision): there is NO floating Paige chat anywhere.
// The floating support-style widget (FloatingChatbot) used to render globally, gated by a
// route deny-list, which leaked it onto authenticated surfaces (broker, portal, onboarding,
// welcome, choose-account) AND onto public marketing pages where a signed-in visitor's session
// would have carried tenant/consumer context into it. The ONLY tenant-aware Paige experience is
// the dedicated authenticated Paige chat/workspace. A public "Product Guide" is a separate,
// tenant-isolated product and is UNAVAILABLE today — never a stripped-down tenant chat
// (docs/product/public-product-guide-contract.md). The regression guard in
// src/__tests__/no-floating-platform-chat.test.ts fails if any floating Paige chat is re-mounted.

function LegacyIntelligenceRedirect() {
  const route = useLocation();
  return <Navigate to={{ pathname: "/operator/settings/paige-intelligence", search: route.search, hash: route.hash }} replace />;
}

const AppInner = () => {
  useHostRouting();
  useReferralTracking();
  // Not on a form shown on a business's own website: those visitors are the business's (Experience 03).
  usePageView(!isFormOnBusinessSite());
  return <GlobalAuthSessionManager />;
};

function SignupRedirect() {
  return <Navigate to="/auth?mode=signup&plan=solo&billing=monthly" replace />;
}

// /render-frame — the DB-free page paige-browser screenshots for the §33 critique loop. Like /invoice it
// short-circuits BEFORE every provider: no auth, tenant context, router, analytics or Supabase reads.
const RenderFrame = lazyPage(() => import("./pages/public/RenderFrame"));
const isRenderFramePath = (pathname: string) => /^\/render-frame\/?$/i.test(pathname);

const App = () => /^\/payment-return\/?$/i.test(window.location.pathname) ? <PaymentReturn /> : /^\/invoice\/?$/i.test(window.location.pathname) ? <InvoiceDocument /> : isRenderFramePath(window.location.pathname) ? (
  <React.Suspense fallback={null}><RenderFrame /></React.Suspense>
) : (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange forcedTheme={embeddedFormTheme()}>
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
        <ComposerDraftSessionBinding />
        <Toaster />
        <Sonner />
        {/* Global platform auto-update banner (#177) — outside <Routes> so it
            persists across navigation and is visible on every surface (operator,
            public, tenant custom domains). Client-side → domain-agnostic. */}
        <PlatformUpdateBanner />
        <BrowserRouter>
          <AppInner />
          {!isFormOnBusinessSite() && <MetaPixel />}
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
            {/* INT-280: restore the old Intelligence bookmark to the guarded Settings home. */}
            <Route path="/admin/platform/intelligence" element={<LegacyIntelligenceRedirect />} />
            <Route path="/join-platform" element={<PageSuspense><JoinPlatform /></PageSuspense>} />
            {/* Where a provider's consent lands. The path is registered with the provider
                and compared by it on every exchange, so it is fixed rather than derived
                from anything a caller can influence. */}
            <Route path="/oauth/mcp/callback" element={<PageSuspense><McpOAuthCallback /></PageSuspense>} />
            <Route path="/oauth/zapier/callback" element={<PageSuspense><ZapierOAuthCallback /></PageSuspense>} />
            <Route path="/book/:slug" element={<PageSuspense><BookingPage /></PageSuspense>} />
            <Route path="/live/:id" element={<PageSuspense><LiveRoom /></PageSuspense>} />
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
              {/* E09 F2: funding and credit pages open only for a finance-entitled business (CustomerFinanceRoute,
                  the one home beside FundingRoute); any other direct URL returns to /app. */}
              <Route path="credit" element={<CustomerFinanceRoute><PageSuspense><CreditIntelligence /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="funding" element={<CustomerFinanceRoute><PageSuspense><FundingMatches /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="funding-journey" element={<CustomerFinanceRoute><PageSuspense><FundingJourney /></PageSuspense></CustomerFinanceRoute>} />
              {/* Legacy dispute routes — repositioned to a notice + CFPB redirect + CSV export */}
              <Route path="disputes" element={<CustomerFinanceRoute><PageSuspense><RepositioningNotice /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="learn" element={<PageSuspense><LearningVault /></PageSuspense>} />
              <Route path="learn/:courseId" element={<PageSuspense><CourseViewer /></PageSuspense>} />
              <Route path="business" element={<CustomerFinanceRoute><PageSuspense><BusinessInfrastructureAssessment /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="business-profile" element={<CustomerFinanceRoute><PageSuspense><BusinessInfrastructureAssessment /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="financial-profile" element={<CustomerFinanceRoute><PageSuspense><FinancialProfile /></PageSuspense></CustomerFinanceRoute>} />
              <Route path="support" element={<PageSuspense><Support /></PageSuspense>} />
              <Route path="settings" element={<PageSuspense><ProfileSettings /></PageSuspense>} />
              {/* E09 Slice A — a customer's own agreements (sign through /sign/:token, download the sealed copy);
                  anyone who is not a customer of a business still gets MyAgreements here, unchanged. */}
              <Route path="agreements" element={<PageSuspense><ClientAgreements /></PageSuspense>} />
              {/* The PaigeAgent terms the signed-in user accepted, for customers too (§58). */}
              <Route path="agreements/platform" element={<PageSuspense><MyAgreements /></PageSuspense>} />
              <Route path="affiliate" element={<PageSuspense><AffiliateTracking /></PageSuspense>} />
              <Route path="approvals" element={<PageSuspense><ClientApprovals /></PageSuspense>} />
              <Route path="actions" element={<PageSuspense><ActionItems /></PageSuspense>} />
              <Route path="documents" element={<PageSuspense><ClientDocuments /></PageSuspense>} />
              {/* E09 — the customer's portal conversation with their business; ?topic=help is "Contact your team". */}
              <Route path="messages" element={<PageSuspense><ClientMessages /></PageSuspense>} />
              {/* E09 Slice 2 — the customer's own sessions; in-window reschedule/cancel through booking-manage. */}
              <Route path="sessions" element={<PageSuspense><ClientSessions /></PageSuspense>} />
              {/* E09 Slice 3 — the work the business shared with the customer; read-only. */}
              <Route path="progress" element={<PageSuspense><ClientProgress /></PageSuspense>} />
              {/* E09 Slice 5 — "Payments": invoices the business issued to the customer, and each one's own page with
                  the document and, when the business sent one, its payment link. Read-only; no charge starts here. */}
              <Route path="billing" element={<PageSuspense><ClientPayments /></PageSuspense>} />
              <Route path="billing/:invoiceId" element={<PageSuspense><ClientPaymentsInvoice /></PageSuspense>} />
              <Route path="planning" element={<PageSuspense><Planning /></PageSuspense>} />
              {/* #244 — learn about your Paige team (tenant scope). Read-only. NOT /team — that would break
                  the /app/* tenant convention (§18); this is the non-colliding home. Staff only (E09 round 2):
                  PAIGE is the owner's COO, never in the Customer Portal; a customer gets the portal's
                  not-available state. lint:customer-identity requires this gate (STAFF_ONLY_ROUTES). */}
              <Route path="paige-team" element={<RequirePortalStaff><PageSuspense><PaigeTeamDirectory scope="tenant" /></PageSuspense></RequirePortalStaff>} />
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
