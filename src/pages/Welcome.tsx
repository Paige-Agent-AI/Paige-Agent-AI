import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext, type TenantSummary } from "@/hooks/useTenantContext";
import { workspaceRootForTenant } from "@/lib/auth/workspaceEntry";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

type EnrollmentState = "needs_identity" | "needs_intake" | "needs_checkout" | "pending" | "verified" | "choose_account" | "payment_recovery" | "canceled_trial" | "canceled_paid" | "failed";
type ViewState = EnrollmentState | "cancelled" | "expired" | "invalid" | "delayed";
type EnrollmentStatus = { state: EnrollmentState; reference_id: string; message: string; retryable: boolean; destination?: string; can_manage_billing?: boolean };
type WorkspaceHandoff = { generation: number; userId: string; tenantId: string; destination: string; priorTenants: ReturnType<typeof useTenantContext>["tenants"] };

export default function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
  const context = useTenantContext();
  // refresh has no snapshot return and changes identity on provider renders. Read
  // the current provider without restarting polling whenever that identity changes.
  const contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; }, [context]);
  const checkout = params.get("checkout");
  const initial: ViewState = checkout === "cancelled" ? "cancelled" : checkout === "expired" ? "expired" : checkout === "failed" ? "failed" : checkout === "success" || checkout === "recovery" ? "pending" : "invalid";
  const [view, setView] = useState<ViewState>(initial);
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<WorkspaceHandoff | null>(null);
  const generationRef = useRef(0);
  const settled = useRef(false);

  useEffect(() => {
    if (!handoff || handoff.generation !== generationRef.current) return;
    if (context.accountContextLoading || context.accountContextStatus === "resolving") return;
    if (context.accountContextStatus !== "ready" || context.tenants === handoff.priorTenants || context.activeUserId !== handoff.userId
      || context.activeTenantId !== handoff.tenantId || context.activeTenant?.id !== handoff.tenantId
      || workspaceRootForTenant(context.activeTenant) !== handoff.destination) {
      settled.current = true;
      setHandoff(null);
      setWorkspaceError("Your enrollment is verified, but PAIGE could not confirm the selected workspace. Retry verification or contact support with this reference.");
      setStatus((current) => current ? { ...current, retryable: true } : current);
      setView("failed");
      return;
    }
    // Provider state must have React-committed, not merely resolved its Promise.
    settled.current = true;
    setView("verified");
    navigate(handoff.destination, { replace: true });
  }, [context, handoff, navigate]);

  useEffect(() => {
    if (checkout !== "success" && checkout !== "recovery") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let callerId: string | null = null;
    const generation = ++generationRef.current;
    const current = () => !cancelled && !settled.current && generationRef.current === generation;
    const startedAt = Date.now();
    settled.current = false;
    setHandoff(null);
    setWorkspaceError(null);
    setView("pending");
    const failWorkspace = () => {
      if (!current()) return;
      settled.current = true;
      setHandoff(null);
      setWorkspaceError("Your enrollment is verified, but PAIGE could not confirm the selected workspace. Retry verification or contact support with this reference.");
      setStatus((value) => value ? { ...value, retryable: true } : value);
      setView("failed");
    };
    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!callerId || session?.user.id === callerId) return;
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
      if (timer) clearTimeout(timer);
      setHandoff(null);
      setStatus(null);
      setWorkspaceError(null);
      setView("needs_identity");
    });

    const poll = async () => {
      if (cancelled || settled.current) return;
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError || !sessionData.session) {
        setStatus(null);
        setView("needs_identity");
        return;
      }
      callerId = sessionData.session.user.id;
      const { data, error } = await supabase.functions.invoke("solo-beta-enrollment-status");
      if (!current()) return;
      if (!error && data && typeof data === "object") {
        const next = data as EnrollmentStatus;
        setStatus(next);
        setView(next.state === "verified" ? "pending" : next.state);
        if (next.state === "choose_account") {
          if (next.destination !== "/choose-account") {
            setView("failed");
            return;
          }
          settled.current = true;
          navigate("/choose-account", { replace: true });
          return;
        }
        if (next.state === "verified") {
          if (!next.destination || !/^\/solo\/[0-9]+\/command-center$/.test(next.destination)) {
            failWorkspace();
            return;
          }
          // The status endpoint owns enrollment authority. The destination is
          // only an address; never use it to select/write a tenant or membership.
          timer = setTimeout(failWorkspace, Math.max(0, POLL_TIMEOUT_MS - (Date.now() - startedAt)));
          try {
            // Accepted provider reads publish a new tenant list; a failed refresh
            // preserves its old list even when an old accepted scope is still ready.
            const priorTenants = contextRef.current.tenants;
            await contextRef.current.refresh();
            if (!current()) return;
            const profile = await supabase.from("profiles").select("user_id,active_tenant_id").eq("user_id", callerId).maybeSingle();
            if (!current()) return;
            if (profile.error || profile.data?.user_id !== callerId || !profile.data.active_tenant_id) { failWorkspace(); return; }
            const tenant = await supabase.from("tenants").select("id,account_type,parent_tenant_id,account_number").eq("id", profile.data.active_tenant_id).maybeSingle();
            if (!current()) return;
            // account_number is live but missing from generated database types,
            // matching the shared provider's explicit selected-column projection.
            const selectedTenant = tenant.data as unknown as Pick<TenantSummary, "id" | "account_type" | "parent_tenant_id" | "account_number"> | null;
            const [actor, scope] = await Promise.all([supabase.auth.getUser(), supabase.rpc("current_user_tenant_id")]);
            if (!current()) return;
            if (!actor.error && actor.data.user?.id !== callerId) {
              settled.current = true;
              setStatus(null);
              setView("needs_identity");
              return;
            }
            if (actor.error || scope.error || scope.data !== profile.data.active_tenant_id
              || tenant.error || selectedTenant?.id !== scope.data
              || workspaceRootForTenant(selectedTenant) !== next.destination) { failWorkspace(); return; }
            setHandoff({ generation, userId: callerId, tenantId: scope.data, destination: next.destination, priorTenants });
          } catch {
            failWorkspace();
          }
          return;
        }
        if (next.state !== "pending") return;
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setView("delayed");
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
      if (timer) clearTimeout(timer);
      authSubscription.subscription.unsubscribe();
    };
  }, [attempt, checkout, navigate]);

  const openBillingRecovery = async () => {
    setBillingBusy(true);
    setBillingError(null);
    const { data, error } = await supabase.functions.invoke("solo-beta-billing-portal");
    const url = !error && data && typeof data === "object" ? (data as { url?: unknown }).url : null;
    if (typeof url === "string" && /^https:\/\//.test(url)) {
      window.location.assign(url);
      return;
    }
    setBillingError("Billing could not be opened. Try again or contact support with the reference shown above.");
    setBillingBusy(false);
  };

  const defaults: Record<ViewState, { title: string; body: string }> = {
    pending: { title: "Verifying your Paige Solo access…", body: "We are confirming your 30-day trial subscription, membership, and workspace on the server. Access is not granted until every check passes." },
    delayed: { title: "Verification is taking longer than expected", body: "We could not verify your Solo enrollment yet. Retrying is safe and will not create another workspace or subscription." },
    cancelled: { title: "Checkout was cancelled", body: "We did not start your subscription or take payment, and no workspace access was granted. Your setup details remain available when you return." },
    expired: { title: "This checkout session expired", body: "No access was granted from the expired session. Start a fresh checkout from the Solo offer." },
    invalid: { title: "Choose how to continue", body: "This page does not contain a valid checkout result. Return to Paige Solo or sign in to an existing workspace." },
    failed: { title: "We could not verify enrollment", body: "Solo access was not activated. Retry if offered, or contact support with the reference below." },
    needs_identity: { title: "Sign in to finish verification", body: "Your session ended before server verification completed. Sign in again to safely resume." },
    needs_intake: { title: "Finish your Solo setup", body: "Your identity is ready, but your Solo business setup still needs to be completed." },
    needs_checkout: { title: "Checkout is still needed", body: "Your setup is saved, but no verified trial subscription is attached. Continue from the approved Solo offer." },
    verified: { title: "Solo access verified", body: "Opening your authorized workspace…" },
    choose_account: { title: "Opening your Paige accounts…", body: "Your existing access is verified. Choose the workspace where you want to work." },
    payment_recovery: { title: "Payment recovery is required", body: "Paige verified that this subscription needs billing attention. Review billing to update payment details; no access is being inferred from the browser." },
    canceled_trial: { title: "Your Solo Beta trial is canceled", body: "No first paid renewal is scheduled, and trial access has ended. Billing history and support remain available." },
    canceled_paid: { title: "Your paid Solo subscription has ended", body: "The verified paid service period is over. Billing history and support remain available." },
  };
  const copy = workspaceError && view === "failed" ? { title: "We could not open your workspace", body: workspaceError } : defaults[view];
  const message = (view === "failed" ? workspaceError : null) || (view === "pending" && status?.state === "verified"
    ? "Your enrollment is verified. Confirming the selected workspace before opening it."
    : status?.message || copy.body);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-center" style={{ background: "radial-gradient(120% 90% at 70% 15%, hsl(var(--primary)/0.14) 0%, hsl(var(--background)) 55%)" }}>
      <section className="w-full max-w-md space-y-7" aria-labelledby="welcome-title">
        <motion.div className="mx-auto flex h-20 w-20 items-center justify-center" animate={!reduce && view === "pending" ? { scale: [1, 1.06, 1] } : undefined} transition={!reduce ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" } : undefined}>
          <PaigeCommandMark className="h-16 w-16" animated={!reduce && view === "pending"} />
        </motion.div>
        <div className="space-y-3" role="status" aria-live="polite">
          <h1 id="welcome-title" className="text-2xl font-bold text-foreground">{copy.title}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
          {billingError ? <p className="text-sm text-destructive" role="alert">{billingError}</p> : null}
          {status?.reference_id ? <p className="text-xs text-muted-foreground">Reference: <span className="font-mono">{status.reference_id}</span></p> : null}
        </div>
        <div className="space-y-3">
          {(view === "delayed" || (view === "failed" && status?.retryable)) && <Button variant="gold" className="w-full" onClick={() => setAttempt((value) => value + 1)}>Retry verification</Button>}
          {view === "needs_identity" && <Button variant="gold" className="w-full" onClick={() => navigate("/auth?mode=login&next=%2Fwelcome%3Fcheckout%3Dsuccess")}>Sign in and resume</Button>}
          {view === "needs_intake" && <Button variant="gold" className="w-full" onClick={() => navigate("/onboarding?plan=solo&billing=monthly")}>Finish Solo setup</Button>}
          {(view === "payment_recovery" || view === "canceled_trial" || view === "canceled_paid") && status?.can_manage_billing && <Button variant="gold" className="w-full" disabled={billingBusy} onClick={() => void openBillingRecovery()}>{billingBusy ? "Opening billing…" : "Review billing"}</Button>}
          {(view === "needs_checkout" || view === "cancelled" || view === "expired" || view === "invalid" || (view === "failed" && !status?.retryable)) && <Button variant="gold" className="w-full" onClick={() => navigate("/pricing")}>Return to Paige Solo</Button>}
          <Button asChild variant="outline" className="w-full"><a href="mailto:support@paigeagent.ai?subject=Solo%20enrollment%20verification">Contact support</a></Button>
        </div>
      </section>
    </main>
  );
}
