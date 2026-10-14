import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Shield, TrendingUp, Zap, ChevronRight, Eye, EyeOff, RefreshCw } from "lucide-react";
import { z } from "zod";
import type { User, Session } from "@supabase/supabase-js";
import { signInWithOAuth } from "@/integrations/auth/oauth";
import { PasswordStrengthIndicator } from "@/components/auth/PasswordStrengthIndicator";
import { ForgotPasswordDialog } from "@/components/auth/ForgotPasswordDialog";
import { trackEvent } from "@/hooks/useAnalytics";
import { LANDING_ROUTE_RETRY, resolveLandingRoute, clearClientViewOverride } from "@/lib/auth/resolveLandingRoute";
import { isSafeRedirectPath } from "@/lib/auth/safeRedirect";
import {
  type PlanIntent, stashPlanIntent, readPlanIntent, clearPlanIntent,
  normalizeBilling, onboardingPathWithPlan, authRedirectWithPlan,
} from "@/lib/auth/signupPlanIntent";
import { readableTextOn, isColorDark } from "@/lib/brand/contrast";
import { shouldPauseForWorkspaceChoiceAtLogin } from "@/lib/auth/accountSelection";
import { operatorChooserTarget } from "@/lib/auth/operatorTarget";
import { isSoloBetaPlan, soloAuthRecoveryState, soloBetaDisplayIntent, soloBetaSignupPath } from "@/lib/auth/soloBetaAcquisition";
import { signUpWithReferral } from "@/lib/signUpWithReferral";
import {
  DEFAULT_SIGNUP_PHONE_COUNTRY,
  normalizeSignupMobile,
  signupPhoneCountryOptions,
  type SignupPhoneCountry,
} from "@/lib/auth/signupMobile";
import { fetchOperatorStanding, isOperator as holdsOperatorTier } from "@/lib/auth/operatorStanding";

const authSchema = z.object({
  email: z.string().trim().email({ message: "Invalid email address" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
  fullName: z.string().trim().min(2, { message: "Full name must be at least 2 characters" }).optional(),
});

const Auth = () => {
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get("next");
  const inviteToken = useMemo(() => {
    const match = nextParam ? /^\/join\/([^/?#]+)/.exec(nextParam) : null;
    return match ? match[1] : null;
  }, [nextParam]);
  const isClientInvite = !!inviteToken;
  const [isLogin, setIsLogin] = useState(isClientInvite || searchParams.get("mode") !== "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  // Captured as parts (better data segregation) and composed into fullName, which
  // the existing signup path stores; a DB trigger re-splits it into profile columns.
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [lastName, setLastName] = useState("");
  useEffect(() => {
    const mi = middleInitial.trim() ? `${middleInitial.trim().charAt(0).toUpperCase()}.` : "";
    setFullName([firstName.trim(), mi, lastName.trim()].filter(Boolean).join(" "));
  }, [firstName, middleInitial, lastName]);
  const [isLoading, setIsLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [consentAgreements, setConsentAgreements] = useState(false);
  const [consentDataUsage, setConsentDataUsage] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [mobileNumber, setMobileNumber] = useState("");
  const [mobileCountry, setMobileCountry] = useState<SignupPhoneCountry>(DEFAULT_SIGNUP_PHONE_COUNTRY);
  const mobileCountryOptions = useMemo(() => signupPhoneCountryOptions(), []);
  const [consentSms, setConsentSms] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const authRecovery = soloAuthRecoveryState({
    error: searchParams.get("error"),
    errorCode: searchParams.get("error_code"),
    description: searchParams.get("error_description"),
  });

  // Plan intent (task #66 reorder). When a prospect picks a plan on /pricing while
  // signed out, they arrive here as /auth?mode=signup&plan=<slug>&billing=<period>.
  // On a SUCCESSFUL SIGNUP (never login) we route them to /onboarding CARRYING the
  // plan — NOT straight to Stripe. Checkout is now the LAST step, launched from the
  // /onboarding business-context + terms step (WorkspaceProvisioner), so a paid
  // customer's tier + terms + workspace name are captured in OUR db before the Stripe
  // hop (the compliance fix). The ref is set only on the email signup path and cleared
  // on failure; the OAuth path re-hydrates the intent from the stash/URL on return.
  const signupPlanIntentRef = useRef<PlanIntent | null>(null);

  // Client-invite mode: when a tenant's CUSTOMER arrives here from /join/<token>
  // to sign in/up, the page must wear the TENANT's brand (§6/§9) — never Paige's
  // SaaS pitch. Peek the invite (anon RPC, no consumption) for the tenant brand.
  const [inviteBrand, setInviteBrand] = useState<
    { tenant_name: string; logo_url: string | null; primary_color: string | null } | null
  >(null);
  // 'loading' until the peek resolves; 'ready' once we have a valid tenant brand;
  // 'invalid' if the token is bad/expired/failed. We NEVER render the Paige-branded
  // signup to a tenant's customer — a leak of the platform brand (§9) — so the page
  // gates on this until the tenant brand is known.
  const [inviteState, setInviteState] = useState<"loading" | "ready" | "invalid">(
    isClientInvite ? "loading" : "ready",
  );

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void Promise.resolve(supabase.rpc("peek_tenant_invite", { _token: inviteToken }))
      .then(({ data, error }) => {
        if (cancelled) return;
        const row = (Array.isArray(data) ? data[0] : data) as
          | { is_valid?: boolean; tenant_name?: string; brand?: { logo_url?: string; primary_color?: string } }
          | null
          | undefined;
        if (error || !row || row.is_valid === false) {
          setInviteState("invalid");
          return;
        }
        setInviteBrand({
          tenant_name: row.tenant_name,
          logo_url: row.brand?.logo_url ?? null,
          primary_color: row.brand?.primary_color ?? null,
        });
        setInviteState("ready");
      })
      .catch(() => { if (!cancelled) setInviteState("invalid"); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  // OAuth is never offered for an invite during the Solo-only Beta: an OAuth
  // provider can create a new identity as well as sign one in. Existing invitees
  // use password sign-in; ordinary Solo OAuth returns to the pending Solo flow.
  const oauthRedirectTo = (nextParam && isSafeRedirectPath(nextParam))
    ? `${window.location.origin}${nextParam}`
    : isLogin
      ? `${window.location.origin}/auth?mode=login`
      : authRedirectWithPlan(window.location.origin, soloBetaDisplayIntent());

  const brandColor = inviteBrand?.primary_color || null;
  // Neutral fallback — NEVER the platform ("Paige Agent") name in client-invite mode.
  const brandName = inviteBrand?.tenant_name || (isClientInvite ? "your workspace" : "Paige Agent");
  const ctaTextColor = brandColor ? readableTextOn(brandColor) : undefined;
  // The hero accent is text on a DARK indigo panel, so a dark tenant color would
  // vanish — fall back to gold when the brand color is too dark to read there.
  const heroAccent = brandColor && !isColorDark(brandColor) ? brandColor : "#F0C86A";
  const headingTitle = isLogin
    ? "Welcome back"
    : isClientInvite ? `Join ${brandName}` : "Start Paige Solo Beta";
  const hasPlanIntent = !isLogin && isSoloBetaPlan(searchParams.get("plan"));
  const hasInvite = !isLogin && !!searchParams.get("invite");
  const headingSub = isLogin
    ? (isClientInvite ? `Sign in to open your ${brandName} portal` : "Sign in to your workspace")
    : (hasInvite
          ? "Your invite includes access selected by the workspace owner — create your login to continue"
          : hasPlanIntent
            ? "Start your 30-day trial. Then $74.50/month unless you cancel before your first paid renewal. Create your account, verify your email, then finish your Solo setup."
            : "Paige Solo Beta includes a 30-day trial, then renews at $74.50/month unless you cancel before your first paid renewal.");

  useEffect(() => {
    setIsLogin(isClientInvite || searchParams.get("mode") !== "signup");
  }, [isClientInvite, searchParams]);

  useEffect(() => {
    if (searchParams.get("mode") === "signup" && !isClientInvite && !isSoloBetaPlan(searchParams.get("plan"))) {
      navigate(soloBetaSignupPath(), { replace: true });
    }
  }, [isClientInvite, navigate, searchParams]);

  const redirectByRole = useCallback(async (userId: string) => {
    setRoutingError(null);
    setIsLoading(true);
    // Always clear any "preview as client" override on a fresh login so role
    // redirects aren't suppressed by a stale flag from a previous session.
    clearClientViewOverride();

    // Resolve the account-choice contract before any post-login continuation.
    // Platform staff always pause, including on bookmarked operator deep links;
    // the safe operator target is carried through the chooser and applied only
    // after Platform is deliberately selected.
    const accountChoiceContext = Promise.all([
      supabase.from("tenant_members").select("tenant_id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
      fetchOperatorStanding(),
    ]);
    const [initialMemberships, initialStanding] = await accountChoiceContext;
    // A null standing is a failed read, never "not an operator".
    if (initialMemberships.error || initialStanding === null) {
      // Keep the authenticated person on this exact continuation. Moving to the
      // chooser would discard an in-memory signup plan and cannot retry invite,
      // role, or client resolution.
      setRoutingError("Paige couldn't confirm your account access. Your sign-in is still active; try again.");
      setIsLoading(false);
      return;
    }
    if (holdsOperatorTier(initialStanding)) {
      signupPlanIntentRef.current = null;
      clearPlanIntent();
      navigate(operatorChooserTarget(window.location.search), { replace: true });
      return;
    }
    // An established account always pauses for a deliberate workspace choice on
    // a fresh login. This check precedes stale signup intent and safe `next`
    // continuations so an old checkout-return URL cannot restart enrollment or
    // replace account choice. Invite acceptance remains a deliberate exception:
    // its signed token must reach the join flow before the new membership exists.
    if (!isClientInvite && shouldPauseForWorkspaceChoiceAtLogin({
      activeMembershipCount: initialMemberships.count ?? 0,
      isPlatformStaff: false,
    })) {
      signupPlanIntentRef.current = null;
      clearPlanIntent();
      navigate("/choose-account", { replace: true });
      return;
    }

    // Plan-intent (task #66 reorder): a fresh signup that carried a plan goes to
    // /onboarding CARRYING the plan — the business-context + terms step, from which
    // checkout is launched LAST. Resolve the intent from the email-path ref first,
    // then (OAuth return) the sessionStorage stash, then the URL. A client-invite
    // signup never carries a platform plan (§9). The /onboarding gate forwards a user
    // who already owns a workspace straight to /admin, so this is safe even if a stale
    // param survives a re-login.
    let planIntent = signupPlanIntentRef.current;
    if (!planIntent && !isClientInvite) {
      planIntent = readPlanIntent();
      if (!planIntent) {
        const urlPlan = searchParams.get("plan");
        if (isSoloBetaPlan(urlPlan)) {
          planIntent = {
            plan: urlPlan,
            billing: "monthly",
          };
        }
      }
    }
    // The invite token is carried in the URL, NOT the sessionStorage stash (CodeQL
    // clear-text-storage — see stashPlanIntent). Backfill it from the URL onto whatever
    // source resolved plan+billing (ref/stash/URL) so the OAuth-return path still reaches
    // invite acceptance. Only when absent, so the in-memory ref's invite is preserved.
    if (planIntent && !planIntent.invite) {
      const urlInvite = searchParams.get("invite") || undefined;
      if (urlInvite) planIntent = { ...planIntent, invite: urlInvite };
    }
    if (planIntent) {
      signupPlanIntentRef.current = null;
      clearPlanIntent();
      navigate(onboardingPathWithPlan(planIntent), { replace: true });
      return;
    }

    // Honor ?next= for invite acceptance flows (e.g. /join/:token).
    // Strict allowlist guard mitigates open-redirect / XSS-via-redirect.
    const nextParam = searchParams.get("next");
    if (nextParam && isSafeRedirectPath(nextParam)) {
      navigate(nextParam, { replace: true });
      return;
    }

    // broker_team_member needs the active_broker_id side-effect before routing.
    try {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const roleList = ((roles || []) as Array<{ role: string }>).map((r) => r.role);
      if (roleList.includes("broker_team_member")) {
        try {
          const { data: tm } = await supabase.rpc("get_broker_team_member", {
            _auth_user_id: userId,
          });
          const parentId = (tm as Array<{ broker_id?: string }> | null)?.[0]?.broker_id;
          if (parentId) localStorage.setItem("active_broker_id", parentId);
        } catch {
          /* non-blocking */
        }
      }
    } catch {
      /* non-blocking */
    }


    const target = await Promise.race<string>([
      resolveLandingRoute(userId),
      new Promise<string>((resolve) => setTimeout(() => resolve(LANDING_ROUTE_RETRY), 4000)),
    ]);
    if (target === LANDING_ROUTE_RETRY) {
      setRoutingError("Paige couldn't finish checking where you can work. Your sign-in is still active; try again.");
      setIsLoading(false);
      return;
    }
    navigate(target, { replace: true });
  }, [isClientInvite, navigate, searchParams]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Supabase warns against awaiting/querying Supabase from inside the
          // auth callback; defer role resolution so login cannot deadlock.
          window.setTimeout(() => {
            void redirectByRole(session.user.id);
          }, 0);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        void redirectByRole(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [redirectByRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const validationData = isLogin
        ? { email, password }
        : { email, password, fullName };

      authSchema.parse(validationData);

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          let description = error.message;
          if (error.message.includes("Invalid login credentials")) {
            description = "Invalid email or password. Please try again.";
          } else if (error.message.includes("password") && error.message.includes("breach")) {
            description = "This password has been found in a data breach. Please use a different password.";
          }
          toast({ title: "Login failed", description, variant: "destructive" });
          return;
        }
        toast({ title: "Welcome back!", description: "You've successfully logged in." });
      } else {
        if (!consentAgreements || !consentDataUsage) {
          toast({
            title: "Consent required",
            description: "Please confirm both required consent checkboxes to create your account.",
            variant: "destructive",
          });
          return;
        }

        const normalizedMobile = normalizeSignupMobile(mobileNumber, mobileCountry);
        if (consentSms && !normalizedMobile) {
          toast({
            title: "Mobile number required",
            description: "Enter a valid mobile number for the selected country. You do not need to type the country prefix.",
            variant: "destructive",
          });
          return;
        }

        // Invite authentication is sign-in-only during the Solo Beta. Keep this
        // server-call boundary defensive even if a stale render submits signup.
        if (isClientInvite) {
          toast({
            title: "Enrollment unavailable",
            description: "New Client Portal accounts are not open during the Solo Beta. Sign in with an existing authorized account.",
            variant: "destructive",
          });
          return;
        }

        {
          const intent = soloBetaDisplayIntent();
          signupPlanIntentRef.current = intent;
          stashPlanIntent(intent);
          const consentTimestamp = new Date().toISOString();
          const { data: signupData, error: signupError } = await signUpWithReferral({
            email,
            password,
            fullName,
            redirectTo: authRedirectWithPlan(window.location.origin, intent),
            extraData: {
              signup_offer_code: "paige-solo-beta-monthly-v1",
              consent_agreements: true,
              consent_data_usage: true,
              consent_marketing: consentMarketing,
              consent_timestamp: consentTimestamp,
              phone: consentSms ? normalizedMobile : null,
              sms_consent: consentSms,
              sms_consent_source_url: `${window.location.origin}/auth`,
            },
          });
          if (signupError) {
            signupPlanIntentRef.current = null;
            clearPlanIntent();
            const exists = /already registered|already exists/i.test(signupError.message);
            toast({
              title: exists ? "Account exists" : "Couldn't create your account",
              description: exists ? "Sign in with this email to continue safely." : "We could not create the account. Check your details and try again, or contact support.",
              variant: "destructive",
            });
            return;
          }
          if (signupData.session?.user) {
            await redirectByRole(signupData.session.user.id);
            return;
          }
          setVerificationEmail(email);
          void trackEvent("signup_verification_sent", "activation", { method: "email" });
          return;
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Validation error", description: error.issues[0].message, variant: "destructive" });
      } else {
        toast({ title: "Error", description: "An unexpected error occurred. Please try again.", variant: "destructive" });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Plan-intent OAuth (task #66): before the provider hop, stash the chosen plan AND
  // re-point the return URL at /auth carrying the plan params, so the intent survives
  // the round-trip and redirectByRole routes back into /onboarding?plan=… (never
  // straight to checkout). A client-invite OAuth never carries a platform plan (§9),
  // and its invite-target return (oauthRedirectTo → /join/:token) is left untouched.
  const oauthRedirectWithPlan = (): string => {
    if (isClientInvite) return oauthRedirectTo;
    const planSlug = searchParams.get("plan");
    if (!isSoloBetaPlan(planSlug)) return authRedirectWithPlan(window.location.origin, soloBetaDisplayIntent());
    const intent: PlanIntent = {
      plan: planSlug,
      billing: "monthly",
      invite: searchParams.get("invite") || undefined,
    };
    stashPlanIntent(intent);
    return authRedirectWithPlan(window.location.origin, intent);
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      // A non-invite OAuth signup must not inherit a stale pending-invite stash
      // from an earlier visitor on this browser (§9).
      if (!isClientInvite) { try { localStorage.removeItem("paige_pending_invite"); } catch { /* ignore */ } }
      void trackEvent("signup_cta_click", "acquisition", { method: "google" });
      const result = await signInWithOAuth("google", oauthRedirectWithPlan(), { chooseAccount: isLogin });
      if (result.error) {
        toast({ title: "Google sign-in failed", description: String(result.error), variant: "destructive" });
      }
      if (result.redirected) return;
    } catch (error) {
      toast({ title: "Error", description: "Failed to sign in with Google.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsLoading(true);
    try {
      if (!isClientInvite) { try { localStorage.removeItem("paige_pending_invite"); } catch { /* ignore */ } }
      const result = await signInWithOAuth("apple", oauthRedirectWithPlan());
      if (result.error) {
        toast({ title: "Apple sign-in failed", description: String(result.error), variant: "destructive" });
      }
      if (result.redirected) return;
    } catch (error) {
      toast({ title: "Error", description: "Failed to sign in with Apple.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    const newMode = isLogin ? "signup" : "login";
    navigate(newMode === "signup" ? soloBetaSignupPath() : "/auth?mode=login", { replace: true });
  };

  const platformFeatures = [
    { icon: TrendingUp, title: "Client follow-through", desc: "Keep client context and follow-up drafts ready for review" },
    { icon: Zap, title: "Guided Solo setup", desc: "Start with focused setup and one clear next step" },
    { icon: Shield, title: "Your business, private", desc: "Access controls help protect your client data" },
  ];
  // For a CLIENT accepting a tenant invite, the left panel speaks to THEM (the
  // customer), not the coach — and never pitches the Paige platform (§9).
  const clientFeatures = [
    { icon: TrendingUp, title: "Everything in one place", desc: "Messages, progress, documents, and your next steps — together" },
    { icon: Zap, title: "Help around the clock", desc: "Your assistant is here whenever you need a hand" },
    { icon: Shield, title: "Private & secure", desc: "Your information is encrypted and shared only with your team" },
  ];
  const features = isClientInvite ? clientFeatures : platformFeatures;
  const HEAD = "'Bricolage Grotesque', 'Space Grotesk', sans-serif";

  // Scoped gold+indigo brand palette — overrides the app's (legacy purple) theme
  // tokens for THIS page only, so /auth matches the landing without recoloring
  // the logged-in dashboard. Every child's bg-accent/text-accent/bg-gradient-gold
  // etc. now resolves to gold, and background/foreground to indigo/offwhite.
  const goldTheme = {
    background: "radial-gradient(120% 90% at 70% 15%, #241645 0%, #140c27 55%, #0c0718 100%)",
    ["--background" as string]: "257 45% 9%",
    ["--foreground" as string]: "45 33% 95%",
    ["--card" as string]: "258 42% 12%",
    ["--card-foreground" as string]: "45 33% 95%",
    ["--popover" as string]: "258 42% 12%",
    ["--popover-foreground" as string]: "45 33% 95%",
    ["--primary" as string]: "258 50% 15%",
    ["--primary-foreground" as string]: "45 33% 95%",
    ["--primary-light" as string]: "42 82% 68%",
    ["--secondary" as string]: "258 30% 18%",
    ["--secondary-foreground" as string]: "45 33% 95%",
    ["--muted" as string]: "258 28% 16%",
    ["--muted-foreground" as string]: "45 18% 72%",
    ["--accent" as string]: "42 82% 68%",
    ["--accent-foreground" as string]: "257 50% 12%",
    ["--gold" as string]: "39 60% 58%",
    ["--border" as string]: "258 22% 24%",
    ["--input" as string]: "258 26% 20%",
    ["--ring" as string]: "42 82% 68%",
    ["--gradient-gold" as string]: "linear-gradient(135deg, #F0C86A, #D4A752)",
    ["--shadow-glow" as string]: "0 0 40px rgba(240,200,106,0.35)",
  } as CSSProperties;

  if (authRecovery && !isClientInvite) {
    const recoveryCopy = authRecovery === "expired"
      ? "That verification link has expired or is no longer valid."
      : authRecovery === "denied"
        ? "Sign-in permission was not granted. Nothing was provisioned."
        : "The identity provider could not complete sign-in. Nothing was provisioned.";
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 text-center" style={goldTheme}>
        <div className="w-full max-w-md space-y-5 rounded-2xl border border-white/15 bg-white/5 p-8 text-[#F8F5EE]">
          <h1 className="text-2xl font-semibold">We could not verify your identity</h1>
          <p className="text-sm text-[#F8F5EE]/75">{recoveryCopy} Start the Solo signup again, or sign in if you already have an account.</p>
          <Button className="w-full" onClick={() => navigate(soloBetaSignupPath(), { replace: true })}>Restart Solo signup</Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/auth?mode=login", { replace: true })}>Sign in instead</Button>
        </div>
      </div>
    );
  }

  if (verificationEmail && !isClientInvite) {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 text-center" style={goldTheme}>
        <div className="w-full max-w-md space-y-5 rounded-2xl border border-white/15 bg-white/5 p-8 text-[#F8F5EE]">
          <PaigeCommandMark plated={false} className="mx-auto h-12 w-12" />
          <h1 className="text-2xl font-semibold">Verify your email</h1>
          <p className="text-sm text-[#F8F5EE]/75">We sent a verification link to <strong>{verificationEmail}</strong>. Open it in this browser to resume your Paige Solo setup. No workspace or subscription has been created yet.</p>
          <Button className="w-full" onClick={() => { setVerificationEmail(null); setIsLogin(true); navigate("/auth?mode=login", { replace: true }); }}>Sign in instead</Button>
          <Button asChild variant="outline" className="w-full"><a href="mailto:support@paigeagent.ai?subject=Solo%20email%20verification">Contact support</a></Button>
        </div>
      </div>
    );
  }

  // Client-invite gate: never show a tenant's customer the Paige-branded signup.
  // Hold on a neutral screen until the tenant brand resolves; show a neutral error
  // (no platform branding) if the invite is invalid/expired.
  if (isClientInvite && inviteState !== "ready") {
    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 text-center" style={goldTheme}>
        {inviteState === "loading" ? (
          <div className="flex flex-col items-center gap-3 text-[#F8F5EE]/80">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading your invite…</span>
          </div>
        ) : (
          <div className="max-w-sm space-y-3 text-[#F8F5EE]">
            <h1 className="text-xl font-semibold">This invite link isn't valid</h1>
            <p className="text-sm text-[#F8F5EE]/70">
              It may have expired or been revoked. Ask whoever invited you for a fresh link.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex text-[#F8F5EE]" style={goldTheme}>
      <ForgotPasswordDialog open={showForgotPassword} onOpenChange={setShowForgotPassword} />

      {/* Left Panel — Brand / Value Prop */}
      <div className="hidden xl:flex xl:w-[48%] relative overflow-hidden bg-primary flex-col justify-between p-10 animate-in fade-in slide-in-from-left-8 duration-700 motion-reduce:animate-none">
        {/* Decorative Elements */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: `linear-gradient(hsl(var(--accent)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--accent)) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }} />
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-accent/10 blur-3xl animate-float motion-reduce:animate-none" />
          <div className="absolute bottom-20 -left-20 w-80 h-80 rounded-full bg-gold/8 blur-3xl animate-float-slow motion-reduce:animate-none" />
          <div className="absolute top-1/2 right-1/4 w-48 h-48 rounded-full bg-accent/5 blur-2xl animate-float-delayed motion-reduce:animate-none" />
          <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-accent/20 to-transparent" style={{ transform: 'translateX(-120px)' }} />
        </div>

        {/* Top — Logo (tenant's for a client invite, Paige's otherwise) */}
        <div className="relative z-10">
          {isClientInvite ? (
            <div className="inline-flex items-center gap-2.5">
              {inviteBrand?.logo_url ? (
                <img src={inviteBrand.logo_url} alt={brandName} className="h-9 w-auto max-w-[180px] object-contain" />
              ) : (
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base font-semibold"
                  style={{ backgroundColor: brandColor || "#241645", color: readableTextOn(brandColor || "#241645") }}
                >
                  {brandName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-xl font-semibold tracking-tight text-[#F8F5EE]" style={{ fontFamily: HEAD }}>
                {brandName}
              </span>
            </div>
          ) : (
            <Link to="/" className="inline-flex items-center gap-2.5 group">
              <PaigeCommandMark plated={false} className="h-9 w-9" />
              <span className="text-xl font-semibold tracking-tight text-[#F8F5EE]" style={{ fontFamily: HEAD }}>
                Paige <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#F0C86A]/90">Agent</span>
              </span>
            </Link>
          )}
        </div>

        {/* Center — Hero Message */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
              <span className="text-xs font-medium text-accent tracking-wide uppercase">
                {isClientInvite ? "Your private client portal" : "Operations · Follow-ups · Follow-through"}
              </span>
            </div>
            {isClientInvite ? (
              <>
                <h2 className="text-4xl xl:text-5xl font-bold text-primary-foreground leading-[1.05] tracking-tight" style={{ fontFamily: HEAD }}>
                  Welcome to
                  <br />
                  <span style={{ color: heroAccent }}>{brandName}.</span>
                </h2>
                <p className="text-primary-foreground/60 text-base max-w-md leading-relaxed">
                  You've been invited to your private client portal — one place to work with the team, track your progress, and get help whenever you need it.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-4xl xl:text-5xl font-bold text-primary-foreground leading-[1.05] tracking-tight" style={{ fontFamily: HEAD }}>
                  She runs your
                  <br />
                  <span style={{ color: "#F0C86A" }}>business.</span>
                </h2>
                <p className="text-primary-foreground/60 text-base max-w-md leading-relaxed">
                  You run the transformation. Paige handles the operations, follow-ups, and follow-through — so you deliver the outcomes only you can.
                </p>
              </>
            )}
          </div>

          {/* Feature pills */}
          <div className="space-y-3">
            {features.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-4 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.06] backdrop-blur-sm transition-all duration-300 hover:bg-primary-foreground/[0.07] group"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <f.icon className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-primary-foreground/90">{f.title}</p>
                  <p className="text-xs text-primary-foreground/60 mt-0.5">{f.desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-primary-foreground/20 group-hover:text-accent/60 transition-colors" />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — trust badge (defensible; no fabricated testimonials) */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/12 ring-1 ring-accent/25">
              <Shield className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-xs font-medium text-primary-foreground/85">
                {isClientInvite ? `Your private workspace with ${brandName}` : "Built deliberately for founder-led Solo businesses"}
              </p>
              <p className="text-[11px] text-primary-foreground/55">Access controls · encrypted transport</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both motion-reduce:animate-none">
        {/* Top nav */}
        <div className={`flex items-center justify-between px-6 sm:px-10 ${isLogin ? "py-5" : "py-2 sm:py-3"}`}>
          {isClientInvite ? (
            <span aria-hidden className="w-4" />
          ) : (
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to home</span>
            </Link>
          )}
          {isClientInvite ? (
            <div className="lg:hidden inline-flex items-center gap-2">
              {inviteBrand?.logo_url ? (
                <img src={inviteBrand.logo_url} alt={brandName} className="h-8 w-auto max-w-[150px] object-contain" />
              ) : (
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold"
                  style={{ backgroundColor: brandColor || "#241645", color: readableTextOn(brandColor || "#241645") }}
                >
                  {brandName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="text-lg font-semibold text-[#F8F5EE]" style={{ fontFamily: HEAD }}>{brandName}</span>
            </div>
          ) : (
            <Link to="/" className="xl:hidden inline-flex items-center gap-2">
              <PaigeCommandMark plated={false} className="h-8 w-8" />
              <span className="text-lg font-semibold text-[#F8F5EE]" style={{ fontFamily: HEAD }}>
                Paige <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#F0C86A]/90">Agent</span>
              </span>
            </Link>
          )}
          {!isClientInvite ? (
            <button
              type="button"
              onClick={toggleMode}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              disabled={isLoading}
            >
              {isLogin ? "Start Solo Beta" : "Sign in"}
              <ChevronRight className="w-3.5 h-3.5 inline ml-0.5" />
            </button>
          ) : <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Return to Paige</Link>}
        </div>

        {/* Form Area */}
        <div className="flex-1 flex items-center justify-center px-6 pb-8 sm:px-10">
          <div className={`w-full ${isLogin ? "max-w-[400px] space-y-8" : "max-w-[640px] space-y-4"}`}>
            {/* Heading */}
            <div className="space-y-2">
              {isClientInvite && (
                <div className="flex items-center gap-2.5 mb-1">
                  {inviteBrand?.logo_url ? (
                    <img src={inviteBrand.logo_url} alt={brandName} className="h-7 w-auto max-w-[140px] object-contain" />
                  ) : (
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold"
                      style={{ backgroundColor: brandColor || "#241645", color: readableTextOn(brandColor || "#241645") }}
                    >
                      {brandName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Client portal invite
                  </span>
                </div>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight" style={{ fontFamily: HEAD }}>
                {headingTitle}
              </h1>
              <p className="text-muted-foreground text-sm">{headingSub}</p>
            </div>

            {/* Form */}
            {routingError && user && (
              <div role="alert" className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-foreground">
                <p>{routingError}</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void redirectByRole(user.id)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Retry account check
                </Button>
              </div>
            )}
            <form onSubmit={handleSubmit} className={isLogin ? "space-y-5" : "space-y-3"}>
              {!isLogin && (
                <div className="grid grid-cols-[1fr_4.5rem_1fr] gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      First Name
                    </Label>
                    <Input
                      id="firstName" type="text" placeholder="John"
                      value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      required disabled={isLoading}
                      className="h-10 bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="middleInitial" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      M.I.
                    </Label>
                    <Input
                      id="middleInitial" type="text" maxLength={1} placeholder="Q"
                      value={middleInitial} onChange={(e) => setMiddleInitial(e.target.value)}
                      disabled={isLoading}
                      className="h-10 bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all text-center placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Last Name
                    </Label>
                    <Input
                      id="lastName" type="text" placeholder="Doe"
                      value={lastName} onChange={(e) => setLastName(e.target.value)}
                      required disabled={isLoading}
                      className="h-10 bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className={`${isLogin ? "h-12" : "h-10"} bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all placeholder:text-muted-foreground/40`}
                />
              </div>

              {!isLogin && !isClientInvite && (
                <div className="space-y-2">
                  <Label htmlFor="mobile" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Mobile Number <span className="normal-case tracking-normal">(optional; required for texts)</span>
                  </Label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(11rem,0.7fr)_minmax(0,1fr)]">
                    <div className="space-y-1">
                      <Label htmlFor="mobile-country" className="text-[11px] font-medium text-muted-foreground">Country</Label>
                      <select
                        id="mobile-country"
                        value={mobileCountry}
                        onChange={(event) => setMobileCountry(event.target.value as SignupPhoneCountry)}
                        disabled={isLoading}
                        className="h-10 w-full rounded-md border border-border/60 bg-muted/50 px-3 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {mobileCountryOptions.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.label} ({country.callingCode})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="mobile" className="text-[11px] font-medium text-muted-foreground">Number</Label>
                      <Input
                        id="mobile"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="(212) 555-1212"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        aria-describedby="mobile-help"
                        disabled={isLoading}
                        className="h-10 bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all placeholder:text-muted-foreground/40"
                      />
                    </div>
                  </div>
                  <p id="mobile-help" className="text-xs text-muted-foreground">
                    Choose your country and enter the number normally—no country prefix required. An explicit + country code also works.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Password
                  </Label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    minLength={6}
                    className={`${isLogin ? "h-12" : "h-10"} bg-muted/50 border-border/60 focus:border-accent focus:ring-accent/20 transition-all placeholder:text-muted-foreground/40 pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {!isLogin && <PasswordStrengthIndicator password={password} />}
              </div>

              {!isLogin && (
                <div className="grid gap-2.5 rounded-lg border border-primary-foreground/25 bg-primary-foreground/[0.07] p-3 ring-1 ring-inset ring-primary-foreground/10 sm:grid-cols-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <Checkbox
                      checked={consentAgreements}
                      onCheckedChange={(v) => setConsentAgreements(!!v)}
                      className="mt-0.5 h-5 w-5 border-2 border-primary-foreground/60 bg-primary-foreground/10 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-[#241645]"
                      aria-required
                    />
                    <span className="text-xs text-foreground/85 leading-snug">
                      I have read and agree to the{isClientInvite ? "" : " Paige Agent"}{" "}
                      <Link to="/legal/terms" target="_blank" className="underline text-accent hover:opacity-80">
                        Terms of Service
                      </Link>
                      ,{" "}
                      <Link to="/legal/privacy" target="_blank" className="underline text-accent hover:opacity-80">
                        Privacy Policy
                      </Link>
                      ,{" "}
                      <Link to="/legal/esign" target="_blank" className="underline text-accent hover:opacity-80">
                        E-Sign Consent
                      </Link>
                      , and{" "}
                      <Link to="/legal/ai-disclaimer" target="_blank" className="underline text-accent hover:opacity-80">
                        AI Disclaimer
                      </Link>
                      .{" "}<span className="text-destructive">*</span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <Checkbox
                      checked={consentDataUsage}
                      onCheckedChange={(v) => setConsentDataUsage(!!v)}
                      className="mt-0.5 h-5 w-5 border-2 border-primary-foreground/60 bg-primary-foreground/10 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-[#241645]"
                      aria-required
                    />
                    <span className="text-xs text-foreground/85 leading-snug">
                      I understand that my data is used exclusively to provide
                      {isClientInvite ? " the services I signed up for" : " my Paige Agent services"} and is{" "}
                      <strong>never sold to third parties or advertisers</strong>.{" "}
                      <span className="text-destructive">*</span>
                    </span>
                  </label>

                  {/* The platform-marketing opt-in is nonsensical for a tenant's
                      customer accepting a portal invite — hide it there (§9). */}
                  {!isClientInvite && (
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={consentSms}
                        onCheckedChange={(v) => setConsentSms(!!v)}
                        className="mt-0.5 h-5 w-5 border-2 border-primary-foreground/60 bg-primary-foreground/10 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-[#241645]"
                      />
                      <span className="text-xs text-foreground/85 leading-snug">
                        I agree to receive account and service text messages from Paige Agent AI at the mobile number I provided. Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. See our{" "}
                        <Link to="/privacy" target="_blank" className="underline text-accent hover:opacity-80">Privacy Policy</Link>
                        {" "}and{" "}
                        <Link to="/sms-terms" target="_blank" className="underline text-accent hover:opacity-80">Messaging Terms</Link>.
                      </span>
                    </label>
                  )}

                  {!isClientInvite && (
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <Checkbox
                        checked={consentMarketing}
                        onCheckedChange={(v) => setConsentMarketing(!!v)}
                        className="mt-0.5 h-5 w-5 border-2 border-primary-foreground/60 bg-primary-foreground/10 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-[#241645]"
                      />
                      <span className="text-xs text-foreground/70 leading-snug">
                        I agree to receive marketing communications about Paige Agent products and
                        updates. <em>(Optional — uncheck to receive only service notifications)</em>
                      </span>
                    </label>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 rounded-full bg-gradient-to-br from-[#F0C86A] to-[#D4A752] text-[#241645] text-sm font-bold shadow-[0_12px_34px_rgba(240,200,106,0.28)] transition-transform duration-300 hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
                style={brandColor ? { background: brandColor, color: ctaTextColor, boxShadow: "none" } : undefined}
                disabled={isLoading || (!isLogin && (!consentAgreements || !consentDataUsage))}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isLogin ? "Signing in..." : "Creating account..."}
                  </>
                ) : (
                  <>{isLogin ? "Sign In" : "Create Solo Beta account"}</>
                )}
              </Button>
            </form>

            {!isClientInvite && isLogin && <>
            {/* OAuth Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-4 text-xs text-muted-foreground">
                  or continue with
                </span>
              </div>
            </div>

            {/* OAuth Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="h-11 text-sm border-border/60 hover:border-accent/40 transition-all gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleAppleSignIn}
                disabled={isLoading}
                className="h-11 text-sm border-border/60 hover:border-accent/40 transition-all gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Apple
              </Button>
            </div>
            </>}

            {!isClientInvite && <>
            {/* Mode Toggle Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/40" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-4 text-xs text-muted-foreground">
                  {isLogin ? "New to Paige Agent?" : "Already have an account?"}
                </span>
              </div>
            </div>

            {/* Toggle */}
            <Button
              type="button"
              variant="outline"
              onClick={toggleMode}
              disabled={isLoading}
              className="w-full h-11 text-sm border-border/60 text-muted-foreground hover:text-foreground hover:border-accent/40 transition-all"
            >
              {isLogin ? "Start your 30-day Solo trial" : "Sign in instead"}
            </Button>
            </>}

            {/* Team Login hint — staff routing copy is off-context for a customer */}
            {!isClientInvite && (
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
                <Shield className="w-3 h-3" />
                <span>Team member? Use your admin credentials above — you'll be routed automatically.</span>
              </div>
            )}

            {/* Legal — the consent block above already carries terms for the
                client-invite path; this platform-legal footer is hidden there (§9). */}
            {!isClientInvite && (
              <p className="text-center text-[11px] text-muted-foreground/70 leading-relaxed">
                By continuing you agree to our{" "}
                <Link to="/terms" className="underline hover:text-muted-foreground transition-colors">Terms</Link>
                {" "}and{" "}
                <Link to="/privacy" className="underline hover:text-muted-foreground transition-colors">Privacy Policy</Link>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
