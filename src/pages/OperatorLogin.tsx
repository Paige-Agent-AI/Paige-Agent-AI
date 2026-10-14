/**
 * Operator Login — the God-tier entrance.
 * A dedicated, isolated sign-in for the platform operator (super-admin), kept
 * separate from the shared /auth door that every agency and coach uses. On
 * success it verifies platform authority and hands the person to the shared
 * account chooser, preserving a safe operator deep link. Platform is entered
 * only after the person deliberately selects it. Anyone who isn't an operator is routed to their normal home (the
 * God surfaces are RLS-gated regardless — this page is isolation, not the
 * security boundary). Route: /operator.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
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
import { fetchOperatorStanding, isOperator as holdsOperatorTier } from "@/lib/auth/operatorStanding";

export default function OperatorLogin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const handledRef = useRef(false);
  const routedUserRef = useRef<string | null>(null);

  const routeAfterAuth = async (userId: string) => {
    if (handledRef.current) return; // getSession + INITIAL_SESSION can both fire
    handledRef.current = true;
    routedUserRef.current = userId;
    setRouting(true);
    setRoutingError(null);
    try {
      // WHICH ANSWER. This door must admit exactly who `RequireOperator` admits, or the
      // `?next=` round-trip it sets up is a trap — so both read the one server answer,
      // `operator_standing()`, through the one client home. An earlier version gated here on
      // the OWNER predicate, and a platform_admin who opened a bookmarked /operator/fleet was
      // bounced here, signed in, lost their `next`, and fell through to a tenant surface.
      //
      // A timeout or error is UNKNOWN, not a denial. Unknown authority may enter
      // the chooser's recovery state but must never bypass deliberate selection.
      const isOperator = await Promise.race<boolean | null>([
        fetchOperatorStanding().then((s) => (s ? holdsOperatorTier(s) : null)),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      if (isOperator === null) {
        handledRef.current = false;
        setRouting(false);
        setIsLoading(false);
        setRoutingError("Paige couldn't confirm Platform access. Your sign-in is still active; try again.");
        return;
      }
      if (isOperator) {
        navigate(operatorChooserTarget(window.location.search), { replace: true });
        return;
      }
      // Authenticated, but not an operator — send them where they belong.
      const target = await Promise.race<string>([
        resolveLandingRoute(userId),
        new Promise<string>((r) => setTimeout(() => r(LANDING_ROUTE_RETRY), 4000)),
      ]);
      if (target === LANDING_ROUTE_RETRY) {
        handledRef.current = false;
        setRouting(false);
        setIsLoading(false);
        setRoutingError("Paige couldn't finish checking where you can work. Your sign-in is still active; try again.");
        return;
      }
      navigate(target, { replace: true });
    } catch {
      handledRef.current = false;
      setRouting(false);
      setIsLoading(false);
      setRoutingError("Paige couldn't finish checking your access. Your sign-in is still active; try again.");
      toast({ title: "Couldn't route you in", description: "Please try again.", variant: "destructive" });
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // Defer per Supabase guidance (no awaiting Supabase inside the callback).
        window.setTimeout(() => void routeAfterAuth(session.user.id), 0);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) void routeAfterAuth(session.user.id);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast({ title: "Enter your credentials", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        toast({
          title: "Sign-in failed",
          description: error.message.includes("Invalid login credentials")
            ? "Invalid email or password."
            : error.message,
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }
      // onAuthStateChange handles the operator routing.
    } catch (err) {
      toast({ title: "Sign-in failed", description: (err as Error).message, variant: "destructive" });
      setIsLoading(false);
    }
  };

  // Self-contained gold+indigo command aesthetic, isolated from the marketing
  // theme so the operator door reads as its own surface.
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
            <ShieldCheck className="w-3.5 h-3.5" /> God View · Operator Access
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-2">{PLATFORM.name}</h1>
          <p className="text-sm text-[#A79EC2] mt-1.5">Sign in to the operator console.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {routingError && routedUserRef.current && (
            <div role="alert" className="rounded-xl border border-[#EBB94C]/35 bg-[#EBB94C]/10 p-4 text-sm text-[#EDE8F6]">
              <p>{routingError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 border-white/20 bg-white/5" onClick={() => void routeAfterAuth(routedUserRef.current!)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry account check
              </Button>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="op-email" className="text-xs text-[#A79EC2]">Email</Label>
            <Input
              id="op-email" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/5 border-white/10 text-[#EDE8F6] placeholder:text-[#766E90] focus-visible:ring-2 focus-visible:ring-[#EBB94C] focus-visible:ring-offset-0"
              placeholder="you@paigeagent.ai" disabled={isLoading || routing}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="op-password" className="text-xs text-[#A79EC2]">Password</Label>
            <Input
              id="op-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-white/5 border-white/10 text-[#EDE8F6] placeholder:text-[#766E90] focus-visible:ring-2 focus-visible:ring-[#EBB94C] focus-visible:ring-offset-0"
              placeholder="••••••••" disabled={isLoading || routing}
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading || routing}
            className="w-full bg-gradient-to-r from-[#EBB94C] to-[#F2CE77] text-[#1B1230] font-semibold hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#F2CE77] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0912]"
          >
            {(isLoading || routing) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {routing ? "Entering console…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <a href="/auth" className="text-xs text-[#A79EC2] hover:text-[#EDE8F6] transition-colors underline underline-offset-2 decoration-transparent hover:decoration-current">
            Coaches &amp; clients sign in at the standard entrance →
          </a>
        </div>
      </div>
    </div>
  );
}
