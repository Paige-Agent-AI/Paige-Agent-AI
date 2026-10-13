// Front-door signup — /signup
//
// This is where a NEW business owner (coach · consultant · agency · advisor)
// creates their account. Its ONLY job is authentication; the moment a session
// exists it hands off to the /onboarding gate, which decides whether to
// provision a workspace (tenant-less user) or forward an existing owner into
// /admin. Keeping provisioning in exactly one place (Onboarding) means a
// signed-in owner who revisits /signup can never be dropped back into the
// "name your workspace" form or re-run provisioning.
//
// Phases: 'auth' (create account / sign in) → 'sent' (confirm your email, when
// email confirmation is required). A confirmed session routes to /onboarding.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signInWithOAuth } from "@/integrations/auth/oauth";
import { signUpTenant } from "@/lib/auth/signUpTenant";
import {
  type PlanIntent, stashPlanIntent, readPlanIntent, clearPlanIntent,
  normalizeBilling, onboardingPathWithPlan,
} from "@/lib/auth/signupPlanIntent";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHead } from "@/components/seo/PageHead";
import {
  CommunicationsConsent, EMPTY_COMMS_CONSENT, type CommsConsentState,
} from "@/components/legal/CommunicationsConsent";
import { MailCheck } from "lucide-react";

export default function PublicSignup() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Plan intent (task #66): /signup may be reached with ?plan=<slug>&billing=<period>
  // (e.g. a pricing CTA that points here). Preserve it through to /onboarding so the
  // paid business-context + terms + checkout step runs, exactly like /auth.
  const urlPlanIntent = (): PlanIntent | null => {
    const plan = searchParams.get("plan");
    if (!plan) return null;
    return {
      plan,
      billing: normalizeBilling(searchParams.get("billing")),
      invite: searchParams.get("invite") || undefined,
    };
  };

  const [phase, setPhase] = useState<"auth" | "sent">("auth");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [commsConsent, setCommsConsent] = useState<CommsConsentState>(EMPTY_COMMS_CONSENT);

  // Once authenticated, hand off to the onboarding gate (provision or forward),
  // CARRYING any chosen plan (from the URL now, or the stash after an OAuth hop).
  const goOnboarding = () => {
    const intent = urlPlanIntent() ?? readPlanIntent();
    clearPlanIntent();
    navigate(onboardingPathWithPlan(intent), { replace: true });
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: s }) => {
      if (!mounted) return;
      if (s.session?.user) goOnboarding();
      else if (s.session?.user?.email && !email) setEmail(s.session.user.email);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      // The confirmation-link click (or OAuth return) arrives here with a session.
      if (session?.user) goOnboarding();
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSso = async (provider: "google" | "apple") => {
    setAuthBusy(true);
    try {
      // Stash any chosen plan so it survives the OAuth round-trip; the return lands
      // back on /signup, whose auth listener re-hydrates it into /onboarding.
      const intent = urlPlanIntent();
      if (intent) stashPlanIntent(intent);
      const result = await signInWithOAuth(provider, window.location.origin + "/signup");
      if (result.error) {
        toast({ title: "Sign-in failed", description: String(result.error.message || result.error), variant: "destructive" });
        setAuthBusy(false);
      }
      // On redirect the browser leaves; the auth listener returns us to /onboarding.
    } catch (e) {
      toast({ title: "Sign-in failed", description: (e as Error).message, variant: "destructive" });
      setAuthBusy(false);
    }
  };

  const handleEmailAuth = async () => {
    setAuthBusy(true);
    try {
      if (authMode === "signup") {
        // Creates a pre-confirmed account and signs in (email verification isn't
        // wired yet — see the tenant-signup edge function), then straight to
        // onboarding. The "sent" phase stays for when real confirmation returns.
        await signUpTenant({ email, password, fullName });
        goOnboarding();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        goOnboarding();
      }
    } catch (e) {
      toast({ title: "Couldn't continue", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAuthBusy(false);
    }
  };

  const resendConfirmation = async () => {
    setResendBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: window.location.origin + "/signup" },
      });
      if (error) throw error;
      toast({ title: "Sent again", description: `We re-sent the confirmation to ${email}.` });
    } catch (e) {
      toast({ title: "Couldn't resend", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResendBusy(false);
    }
  };

  const header = phase === "auth"
    ? {
        title: "Give your practice its own Paige.",
        sub: "One workspace to run your clients — onboarding, follow-ups, and the daily brief. Set it up in under two minutes.",
      }
    : {
        title: "Check your email.",
        sub: "One click to confirm and you're in.",
      };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHead
        title="Start your practice on Paige"
        description="Spin up your own client workspace — Paige runs the follow-ups, onboarding, and daily brief so you get your time back."
        path="/signup"
      />
      <div className="max-w-xl mx-auto px-6 py-12">
        <header className="mb-8">
          <h1 className="font-[Playfair_Display] text-4xl md:text-5xl tracking-tight">{header.title}</h1>
          <p className="mt-3 text-muted-foreground">{header.sub}</p>
        </header>

        {phase === "auth" && (
          <div className="rounded-xl border border-border bg-card p-6 md:p-8 space-y-5">
            <div className="space-y-3">
              <Button onClick={() => handleSso("google")} disabled={authBusy} className="w-full h-11" variant="outline">
                Continue with Google
              </Button>
              <Button onClick={() => handleSso("apple")} disabled={authBusy} className="w-full h-11" variant="outline">
                Continue with Apple
              </Button>
            </div>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 text-muted-foreground">or use email</span>
              </div>
            </div>

            <div className="space-y-3">
              {authMode === "signup" && (
                <div className="space-y-1.5">
                  <Label>Your name</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@domain.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>

              {authMode === "signup" && (
                <CommunicationsConsent value={commsConsent} onChange={setCommsConsent} showSms={false} />
              )}

              <Button onClick={handleEmailAuth} disabled={authBusy || !email || !password} className="w-full h-11">
                {authBusy ? "Working…" : authMode === "signup" ? "Create account" : "Sign in"}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                {authMode === "signup" ? (
                  <>Already have a workspace?{" "}
                    <button className="underline" onClick={() => setAuthMode("signin")}>Sign in</button>
                  </>
                ) : (
                  <>New here?{" "}
                    <button className="underline" onClick={() => setAuthMode("signup")}>Create your workspace</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "sent" && (
          <div className="rounded-xl border border-border bg-card p-6 md:p-8 space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-base">
                We sent a confirmation link to <span className="font-medium text-foreground">{email || "your email"}</span>.
              </p>
              <p className="text-sm text-muted-foreground">
                Click it to verify your account. This page picks up the moment you're confirmed — then you'll set up your workspace.
              </p>
            </div>
            <div className="space-y-2 pt-1">
              <Button variant="outline" className="w-full h-11" onClick={resendConfirmation} disabled={resendBusy || !email}>
                {resendBusy ? "Sending…" : "Resend confirmation email"}
              </Button>
              <button className="text-sm text-muted-foreground underline" onClick={() => setPhase("auth")}>
                Use a different email
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-8 text-center">
          By continuing you agree to our <a href="/terms" className="underline">Terms</a> and{" "}
          <a href="/privacy" className="underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
