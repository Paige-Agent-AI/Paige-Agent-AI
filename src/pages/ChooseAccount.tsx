import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronRight, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { Button } from "@/components/ui/button";
import { useTenantContext, type TenantSummary } from "@/hooks/useTenantContext";
import { signInWithOAuth } from "@/integrations/auth/oauth";
import { supabase } from "@/integrations/supabase/client";
import { tenantAccountLabel } from "@/lib/auth/accountSelection";
import { allowAccountSwitch } from "@/lib/auth/accountSwitchGuard";
import {
  clearWorkspaceScopedState,
  enterableWorkspaces,
  forgetWorkspaceEntered,
  rememberWorkspaceEntered,
  workspaceRootForTenant,
} from "@/lib/auth/workspaceEntry";
import { operatorTarget } from "@/lib/auth/operatorTarget";

type Membership = { tenant_id: string; role: string };
type Choice = { tenant: TenantSummary; role: string };

function roleLabel(role: string): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : role;
}

export default function ChooseAccount() {
  const navigate = useNavigate();
  const location = useLocation();
  const context = useTenantContext();
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      navigate("/auth", { replace: true });
      return;
    }
    setEmail(auth.user.email ?? "Your Google account");
    const { data, error: membershipError } = await supabase
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", auth.user.id)
      .eq("status", "active");
    if (membershipError) {
      setError("We couldn't load your Paige accounts. Your access has not changed.");
      setLoading(false);
      return;
    }
    setMemberships((data ?? []) as Membership[]);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  const choices = useMemo<Choice[]>(() => {
    const roles = new Map(memberships.map((membership) => [membership.tenant_id, membership.role]));
    return enterableWorkspaces(context.tenants)
      .filter((tenant) => roles.has(tenant.id))
      .map((tenant) => ({ tenant, role: roles.get(tenant.id) ?? "member" }));
  }, [context.tenants, memberships]);

  // The act-as an operator still has open if they came here from inside a tenant (Switch workspace).
  const openActAs = useMemo(() => {
    if (!context.isPlatformStaff || !context.activeTenantId) return null;
    const name = context.tenants?.find((t) => t.id === context.activeTenantId)?.name ?? "this tenant";
    return { id: context.activeTenantId, name };
  }, [context.isPlatformStaff, context.activeTenantId, context.tenants]);

  // ONE TRUTHFUL TRANSITION, shared by the explicit pick and the nothing-to-ask
  // auto-leave (owner ruling 2026-09-03). A workspace is recorded as ENTERED only
  // when the transition into it actually succeeded.
  //
  // THE DEFECT THIS REPLACES. The auto-leave used to record `only.id` without ever
  // calling `switchTenant(only.id)`, so whenever that differed from the active
  // tenant the record named a workspace nobody had entered. The `/admin` door
  // compares the record against `activeTenantId`, so it never matched, the door
  // sent the person back here, and the two bounced forever — a driven, reproducible
  // infinite redirect. Recording an entry that did not happen is what made the two
  // surfaces disagree; making the record follow the transition is what settles them.
  const enterWorkspace = useCallback(async (tenant: TenantSummary): Promise<boolean> => {
    const changing = tenant.id !== context.activeTenantId;
    if (changing) {
      // The unsaved-Setup / save-in-progress guard, honoured at the moment scope
      // actually changes. Registered module-level, so any surface still mounted
      // with unsaved work gets its say.
      const allowed = await allowAccountSwitch({
        fromTenantId: context.activeTenantId ?? null,
        toTenantId: tenant.id,
        toTenantName: tenant.name,
      });
      if (!allowed) return false;
      // An operator who came here from inside a tenant still has that act-as open, and the server
      // refuses to enter over it. Choosing another workspace is the explicit intent to leave, so
      // the act-as ends through the audited exit first — and if it will not end, nothing is entered.
      const endedActAs = Boolean(openActAs);
      if (openActAs && !(await context.switchTenant(null))) {
        setError(`Paige couldn't end your act-as in ${openActAs.name}. Nothing else was entered.`);
        return false;
      }
      // An operator's enter answers entered / refused / unknown / occupied; each is reported for
      // what it is, and "platform scope" is claimed only when the refusal is confirmed.
      const outcome = context.isPlatformStaff
        ? await context.enterOperatorActAs(tenant.id)
        : (await context.switchTenant(tenant.id)) ? "entered" : "refused";
      if (outcome !== "entered") {
        const ended = endedActAs ? `Paige ended your act-as in ${openActAs?.name}` : null;
        if (outcome === "unknown") {
          setError(`${ended ? `${ended}, but` : "Paige"} couldn't confirm whether ${tenant.name} opened. Reload before trying again.`);
        } else if (outcome === "occupied") {
          setError("Another act-as is open, so nothing else was entered. End it before choosing a workspace.");
        } else {
          setError(ended
            ? `${ended} but couldn't open ${tenant.name}. You're at platform scope.`
            : "Paige couldn't open that account. Your current workspace is unchanged.");
        }
        return false;
      }
      // Nothing from the previous account may render under the new one's heading.
      clearWorkspaceScopedState();
    }
    // Only now: the person is genuinely in this workspace, either because the
    // switch succeeded or because they were already in it.
    rememberWorkspaceEntered(tenant.id);
    return true;
  }, [context, openActAs]);

  // A platform operator always pauses here after sign-in. Platform is a real
  // operating context, not an automatic default, and tenant entry still runs
  // through the audited switchTenant seam below.
  //
  // A FAILED READ IS NOT ZERO CHOICES. When the membership query errors this page
  // has learned nothing, so it renders its error card and its Retry rather than
  // leaving. Navigating away on an error is what made that card unreachable and
  // turned any transient failure on one query into a redirect storm.
  //
  // With no choice to offer there is no transition to make and nothing honest to
  // record. The chooser stays put with recovery guidance; there is no retired
  // route fallback and no guessed tenant.
  useEffect(() => {
    if (loading || error) return;
    if (context.accountContextLoading || context.accountContextStatus !== "ready") return;
    // Every established user pauses here on fresh login, including someone with
    // one workspace. The choice card is an intentional confirmation of scope, not
    // a shortcut that silently selects on the person's behalf.
    if (context.isPlatformStaff || choices.length >= 1) return;
    setError(
      "Paige couldn't confirm a workspace for this account. Sign in with a different account or contact support.",
    );
  }, [
    choices,
    context,
    enterWorkspace,
    error,
    loading,
    navigate,
  ]);

  const choose = async (choice: Choice) => {
    setError(null);
    setSwitchingTo(choice.tenant.id);
    const root = workspaceRootForTenant(choice.tenant);
    if (!root) {
      setSwitchingTo(null);
      setError("Paige couldn't confirm this account's canonical workspace address. Your access has not changed.");
      return;
    }
    if (!(await enterWorkspace(choice.tenant))) {
      setSwitchingTo(null);
      return;
    }
    window.location.assign(root);
  };

  const choosePlatform = async () => {
    setError(null);
    setSwitchingTo("platform");
    if (context.activeTenantId !== null) {
      const allowed = await allowAccountSwitch({
        fromTenantId: context.activeTenantId,
        toTenantId: null,
        toTenantName: "Platform",
      });
      if (!allowed) {
        setSwitchingTo(null);
        return;
      }
      const switched = await context.switchTenant(null);
      if (!switched) {
        setSwitchingTo(null);
        setError("Paige couldn't open the Platform. Your current workspace is unchanged.");
        return;
      }
    }
    clearWorkspaceScopedState();
    forgetWorkspaceEntered();
    navigate(operatorTarget(location.search), { replace: true });
  };

  const handleDifferentGoogleAccount = async () => {
    setError(null);
    setSwitchingTo("google");
    // Signing out clears this browser, not the server: an open act-as would stay open with no exit
    // receipt. The provider ends it through the audited exit first — asking the server when this
    // page's account context could not be read — and the person stays signed in if it will not end
    // or cannot be confirmed.
    const settled = await context.endActAsBeforeSignOut();
    if (settled !== "clear") {
      setSwitchingTo(null);
      setError(settled === "refused"
        ? `Paige couldn't end your act-as in ${openActAs?.name ?? "this tenant"}, so you're still signed in. Try again.`
        : "Paige couldn't confirm whether your act-as is still open, so you're still signed in. Try again.");
      return;
    }
    await supabase.auth.signOut();
    const result = await signInWithOAuth("google", `${window.location.origin}/auth`, { chooseAccount: true });
    if (result.error) {
      setSwitchingTo(null);
      setError("Google sign-in couldn't start. Try again.");
    }
  };

  const resolving = loading || context.accountContextLoading;
  const contextFailed = context.accountContextStatus === "error";
  const visibleError = error ?? (contextFailed
    ? "Paige couldn't confirm your account access. Your access has not changed."
    : null);

  const retryResolution = async () => {
    setError(null);
    if (contextFailed) {
      await Promise.all([load(), context.refresh()]);
      return;
    }
    await load();
  };

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,#f4f0ff_0,#f8f8fb_38%,#eef0f5_100%)] px-4 py-8 text-slate-950 dark:bg-[radial-gradient(circle_at_top,#28203f_0,#15131b_42%,#0d0c10_100%)] dark:text-white sm:py-14">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_80px_rgba(30,22,55,.14)] backdrop-blur dark:border-white/10 dark:bg-[#17151d]/95 sm:p-9" aria-labelledby="account-picker-title">
        <div className="mb-8 flex items-center gap-3">
          <PaigeCommandMark plated={false} className="h-10 w-10" />
          <div>
            <div className="text-sm font-semibold">Paige Agent AI</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Secure workspace access</div>
          </div>
        </div>

        <h1 id="account-picker-title" className="text-3xl font-semibold tracking-tight">Where do you want to work?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Signed in as <strong className="font-semibold text-slate-900 dark:text-white">{email || "your Google account"}</strong>. {context.isPlatformStaff ? "Choose the Platform or a Paige account to continue." : "Choose a Paige account to continue."}
        </p>

        {visibleError && (
          <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/35 dark:text-red-200">
            <p>{visibleError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void retryResolution()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        )}

        <div className="mt-7 space-y-3" aria-live="polite">
          {resolving ? (
            <div role="status" className="flex min-h-36 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your Paige accounts…
            </div>
          ) : context.accountContextStatus === "ready" ? <>
            {context.isPlatformStaff && (
              <button
                type="button"
                disabled={!!switchingTo}
                onClick={() => void choosePlatform()}
                className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-400 hover:bg-violet-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 dark:border-white/10 dark:bg-white/[.03] dark:hover:border-violet-500 dark:hover:bg-violet-500/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><ShieldCheck className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-base">Platform</strong>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Platform operations</span>
                </span>
                {switchingTo === "platform" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5" />}
              </button>
            )}
            {choices.map((choice) => (
              <button
                type="button"
                key={choice.tenant.id}
                disabled={!!switchingTo}
                onClick={() => void choose(choice)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-400 hover:bg-violet-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 dark:border-white/10 dark:bg-white/[.03] dark:hover:border-violet-500 dark:hover:bg-violet-500/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"><Building2 className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-base">{choice.tenant.name}</strong>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    {tenantAccountLabel(choice.tenant.account_type, choice.tenant.parent_tenant_id)} · {roleLabel(choice.role)}
                  </span>
                </span>
                {switchingTo === choice.tenant.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5" />}
              </button>
            ))}
          </> : null}
        </div>

        <Button type="button" variant="ghost" className="mt-6 w-full" disabled={!!switchingTo} onClick={() => void handleDifferentGoogleAccount()}>
          <LogOut className="mr-2 h-4 w-4" /> Use a different Google account
        </Button>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4" /> You only see accounts where this email has active access.
        </p>
      </section>
    </main>
  );
}
