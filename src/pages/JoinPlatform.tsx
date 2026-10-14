/**
 * Join Platform — the God-staff door.
 * Two jobs, one isolated page (separate from /auth and /operator):
 *  - With ?token=… : redeem a platform invite. Sign up (or sign in) with the
 *    invited email, then accept_platform_invite() grants the scoped Platform
 *    Admin role and then requires deliberate account choice.
 *  - Without a token: the returning-staff sign-in — authenticate, verify
 *    the caller's operator standing, then route to the shared chooser (non-staff bounced).
 * Route: /join-platform.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { PLATFORM } from "@/lib/platform/identity";
import { LANDING_ROUTE_RETRY, resolveLandingRoute } from "@/lib/auth/resolveLandingRoute";
import { operatorChooserTarget } from "@/lib/auth/operatorTarget";
import { useTenantContext } from "@/hooks/useTenantContext";
import { fetchOperatorStanding, isOperator as holdsOperatorTier } from "@/lib/auth/operatorStanding";

export default function JoinPlatform() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const accountContext = useTenantContext();
  const [params] = useSearchParams();
  const token = params.get("token");

  const [mode, setMode] = useState<"signup" | "login">(token ? "signup" : "login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const handledRef = useRef(false);

  const routeAfterAuth = async () => {
    if (handledRef.current) return;
    handledRef.current = true;
    setRouting(true);
    setRoutingError(null);
    try {
      if (token) {
        const { error } = await supabase.rpc("accept_platform_invite", { _token: token });
        if (error) {
          // Invalid / expired / wrong email — let them retry with the right account.
          handledRef.current = false;
          setRouting(false);
          setIsLoading(false);
          toast({ title: "Couldn't accept invite", description: error.message, variant: "destructive" });
          return;
        }
        // The role grant emits no auth event. Refresh the one shared account
        // context before mounting the chooser so a cached non-staff verdict
        // cannot hide Platform from the person who just accepted the invite.
        await accountContext.refresh();
        navigate(operatorChooserTarget(window.location.search), { replace: true });
        return;
      }
      // No token — returning staff. Unknown authority is not a denial and cannot
      // bypass deliberate account choice.
      const isStaff = await Promise.race<boolean | null>([
        fetchOperatorStanding().then((s) => (s ? holdsOperatorTier(s) : null)),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      if (isStaff === null) {
        handledRef.current = false;
        setRouting(false);
        setIsLoading(false);
        setRoutingError("Paige couldn't confirm Platform access. Your sign-in is still active; try again.");
        return;
      }
      if (isStaff) {
        navigate(operatorChooserTarget(window.location.search), { replace: true });
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const target = auth.user ? await resolveLandingRoute(auth.user.id) : "/auth";
      if (target === LANDING_ROUTE_RETRY) {
        handledRef.current = false;
        setRouting(false);
        setIsLoading(false);
        setRoutingError("Paige couldn't finish checking where you can work. Your sign-in is still active; try again.");
        return;
      }
      navigate(target, { replace: true });
    } catch (e) {
      handledRef.current = false;
      setRouting(false);
      setIsLoading(false);
      setRoutingError("Paige couldn't finish checking your access. Your sign-in is still active; try again.");
      toast({ title: "Something went wrong", description: (e as Error).message, variant: "destructive" });
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) window.setTimeout(() => void routeAfterAuth(), 0);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void routeAfterAuth();
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || (mode === "signup" && !fullName.trim())) {
      toast({ title: "Fill in every field", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw new Error(error.message);
        if (!data.session) {
          // Email confirmation is on — no session yet. They confirm, then reopen the link.
          setIsLoading(false);
          toast({
            title: "Confirm your email",
            description: "We sent a confirmation link. Confirm it, then reopen this invite to finish.",
          });
          return;
        }
        // session present → onAuthStateChange routes + accepts.
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          toast({
            title: "Sign-in failed",
            description: error.message.includes("Invalid login credentials") ? "Invalid email or password." : error.message,
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
      }
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
      setIsLoading(false);
    }
  };

  const theme: CSSProperties = {
    background:
      "radial-gradient(900px 520px at 80% -10%, #1B1230, transparent 60%)," +
      "radial-gradient(700px 420px at 0% 8%, rgba(122,103,232,0.12), transparent 55%)," +
      "#0B0912",
    color: "#EDE8F6",
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-16" style={theme}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <PaigeCommandMark className="h-11 w-11 mb-4" />
          <div className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-[#EBB94C]">
            <ShieldCheck className="w-3.5 h-3.5" /> {PLATFORM.name} · Team
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-2">
            {token ? "Join the team" : "Staff sign-in"}
          </h1>
          <p className="text-sm text-[#A79EC2] mt-1.5">
            {token
              ? "You've been invited as a Platform Admin. Create your account with your invited email."
              : "Sign in, then choose where you want to work."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {routingError && (
            <div role="alert" className="rounded-xl border border-[#EBB94C]/35 bg-[#EBB94C]/10 p-4 text-sm text-[#EDE8F6]">
              <p>{routingError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 border-white/20 bg-white/5" onClick={() => void routeAfterAuth()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry account check
              </Button>
            </div>
          )}
          {mode === "signup" && token && (
            <div className="grid gap-1.5">
              <Label htmlFor="jp-name" className="text-xs text-[#A79EC2]">Full name</Label>
              <Input id="jp-name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="bg-white/5 border-white/10 text-[#EDE8F6] placeholder:text-[#766E90] focus-visible:ring-2 focus-visible:ring-[#EBB94C]"
                placeholder="Your name" disabled={isLoading || routing} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="jp-email" className="text-xs text-[#A79EC2]">Email</Label>
            <Input id="jp-email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/5 border-white/10 text-[#EDE8F6] placeholder:text-[#766E90] focus-visible:ring-2 focus-visible:ring-[#EBB94C]"
              placeholder="you@yourcompany.com" disabled={isLoading || routing} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jp-password" className="text-xs text-[#A79EC2]">Password</Label>
            <Input id="jp-password" type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/5 border-white/10 text-[#EDE8F6] placeholder:text-[#766E90] focus-visible:ring-2 focus-visible:ring-[#EBB94C]"
              placeholder="••••••••" disabled={isLoading || routing} />
          </div>
          <Button type="submit" disabled={isLoading || routing}
            className="w-full bg-gradient-to-r from-[#EBB94C] to-[#F2CE77] text-[#1B1230] font-semibold hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#F2CE77] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0912]">
            {(isLoading || routing) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {routing ? "Checking access…" : mode === "signup" ? "Create account & join" : "Sign in"}
          </Button>
        </form>

        {token && (
          <div className="mt-5 text-center">
            <button type="button" onClick={() => setMode((m) => (m === "signup" ? "login" : "signup"))}
              className="text-xs text-[#A79EC2] hover:text-[#EDE8F6] transition-colors">
              {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
