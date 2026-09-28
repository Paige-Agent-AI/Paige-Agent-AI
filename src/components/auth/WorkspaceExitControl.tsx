import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTenantContext } from "@/hooks/useTenantContext";
import {
  ACCOUNT_SWITCH_NOTICE_KEY,
  WORKSPACE_CHOOSER_PATH,
  clearWorkspaceScopedState,
  forgetWorkspaceEntered,
  operatorActAsRecorded,
  reachableWorkspaceCount,
} from "@/lib/auth/workspaceEntry";
import { GOD_CONSOLE } from "@/lib/auth/operatorTarget";
import { landAt } from "@/operator/actAs";
import { shouldOfferAccountPicker } from "@/lib/auth/accountSelection";
import { allowAccountSwitch } from "@/lib/auth/accountSwitchGuard";
import { toast } from "sonner";

/**
 * WorkspaceExitControl — the ONLY account affordance a locked workspace shell may
 * carry (owner ruling 2026-09-02).
 *
 * It is deliberately NOT a picker. It selects nothing, switches nothing, and
 * changes no scope: it navigates OUT to the authorized entry chooser, which is
 * the single place a workspace is chosen. That is the ruling's own recovery
 * path — "returning to another authorized top-level workspace means explicitly
 * leaving the current workspace and re-entering through the chooser."
 *
 * WHAT IT REPLACES, AND WHY THAT IS NOT A REGRESSION (§58). The Solo shell
 * previously mounted `MemberAccountSwitcher`, which rendered EVERY tenant the
 * caller could read — sub-accounts and agencies included, with no status filter —
 * and on selection PERSISTED `profiles.active_tenant_id` before hard-navigating
 * to `/choose-account`, landing the person in whichever shell the new tier implied. That
 * is the in-shell account picker the ruling forbids, and it is how an owner left
 * Solo without meaning to. The capability to reach another authorized workspace
 * is preserved here in full; only the place the choice happens has moved, from
 * inside the shell to the entry chooser.
 *
 * WHERE IT IS MOUNTED, AND WHERE IT IS NOT (§13 — an earlier draft of this
 * comment claimed more than the code did). It is mounted in the Solo shell
 * (`SoloApp`) and in the legacy `/choose-account` shell (`AdminLayout`), which together
 * cover every Solo owner whether or not their tenant carries
 * `solo_shell_enabled`. It is NOT mounted in the sub-account shell: `/business/*`
 * renders `AgencyApp`, whose account slot resolves to `null` for a member who
 * owns no agency, and that shell is locked to the Claude Design pack verbatim
 * (`src/agency/CLAUDE.md`) — a PACK-FIRST search across every file in
 * `agency-mode-shell/` returned zero hits for such a control, so under §00 the
 * decision is Claude Design's, not this session's. Tracked as #808.
 *
 * So this control is the recovery path for the shells it is IN. What keeps an
 * owner out of the shell it is missing from is the entry rule, not this button:
 * `/choose-account` now asks a multi-context person which workspace they want instead of
 * resuming whichever one `active_tenant_id` was parked on.
 *
 * Its visibility does not depend on the current workspace's tier — the old
 * switcher rendered only when the active tenant was `standalone`, so it was
 * absent in exactly the situation an owner needed it. It is shown only to a
 * genuinely multi-context person: a single-workspace owner has nothing to
 * choose. Platform staff always have Platform as a distinct context, so they
 * may leave a tenant shell for the same deliberate chooser used at sign-in.
 *
 * A PLATFORM OPERATOR ACTING AS A TENANT GETS THE EXIT ITSELF, NOT A DETOUR. For them this
 * shell is an audited act-as, and the way out is the audited `operator_exit_tenant` (reached
 * through `switchTenant(null)`), which records the exit and returns them to the console. The
 * chooser detour reached the same exit two screens later under a label ("Switch workspace")
 * that never said the act-as was still open — and the sub-account shell had no way out at all,
 * only a "Back to agency" link into a route that bounces operators while leaving the act-as open.
 * An operator inside a tenant always has a visible exit that actually ends the session.
 */
export function WorkspaceExitControl() {
  const { isPlatformStaff, activeTenantId } = useTenantContext();
  // Both, for an operator acting as a tenant: Exit ends the act-as; Switch workspace stays
  // because it is staff's only in-app route to workspaces they genuinely belong to — the console
  // links nowhere near the chooser, so removing it would strand them there (§58).
  if (isPlatformStaff && activeTenantId) {
    return (
      <>
        <OperatorExitControl />
        <MemberExitControl />
      </>
    );
  }
  return <MemberExitControl />;
}

/**
 * The operator's exit from an act-as. One press is one exit; a refused exit leaves them where
 * they are and says so, because the scope has not changed.
 */
function OperatorExitControl() {
  const navigate = useNavigate();
  const { activeTenant, activeTenantId, switchTenant } = useTenantContext();
  const [leaving, setLeaving] = useState(false);
  // Taken synchronously, BEFORE the guard is asked: state set after an await lets a second press
  // through, and the server records an exit even from no tenant, so one gesture would leave two
  // receipts. Held after a successful exit, released on either refusal.
  const exiting = useRef(false);
  const name = activeTenant?.name ?? "this tenant";

  const exit = async () => {
    if (exiting.current) return;
    exiting.current = true;
    // Unsaved work lives in this shell, so the guard runs here, for the same reason as below.
    const allowed = await allowAccountSwitch({
      fromTenantId: activeTenantId ?? null,
      toTenantId: null,
      toTenantName: "Platform",
    });
    if (!allowed) {
      exiting.current = false;
      return;
    }
    setLeaving(true);
    const exited = await switchTenant(null);
    if (!exited) {
      exiting.current = false;
      setLeaving(false);
      toast.error(`Couldn't leave ${name}. You are still acting as this tenant.`);
      return;
    }
    clearWorkspaceScopedState();
    forgetWorkspaceEntered();
    navigate(GOD_CONSOLE, { replace: true });
  };

  return (
    <Button
      data-operator-exit
      variant="outline"
      size="sm"
      disabled={leaving}
      onClick={() => void exit()}
      aria-label={`Stop acting as ${name} and return to the platform`}
    >
      {/* Its own mark: it RETURNS to the platform and ends the act-as, where "Switch workspace"
          beside it leaves for the chooser. The same icon on both read as two doors to one place. */}
      <CornerUpLeft className="mr-1.5 h-4 w-4" />
      {leaving ? "Leaving…" : "Exit tenant"}
    </Button>
  );
}

/**
 * The operator's exit on a destination that could not load its account context — the Solo and
 * business "Couldn't verify your workspace" screens, which render before any shell (and so before
 * `OperatorExitControl`) can mount. Offered only when this browser session opened an act-as; the
 * exit itself is the audited RPC, and the server decides whether the caller may use it.
 *
 * No unsaved-work guard: nothing in a shell that never mounted can hold unsaved work. The return
 * is a full load, because the provider that failed to read here is the one the console needs.
 */
export function StrandedOperatorExit() {
  const { activeUserId, exitOperatorActAs, probeOperatorActAs } = useTenantContext();
  const [leaving, setLeaving] = useState(false);
  const exiting = useRef(false);
  // This user's own record or arrival flag answers at once; without either, ask the server afresh,
  // because client-side signals can be lost (blocked storage, navigation that drops the flag).
  const recordedHere = operatorActAsRecorded(activeUserId);
  const [serverSaysActing, setServerSaysActing] = useState(false);
  useEffect(() => {
    if (recordedHere || !probeOperatorActAs) return;
    let live = true;
    probeOperatorActAs()
      .then((acting) => { if (live) setServerSaysActing(acting); })
      .catch(() => {});
    return () => { live = false; };
  }, [recordedHere, probeOperatorActAs]);
  if (!recordedHere && !serverSaysActing) return null;

  const exit = async () => {
    if (exiting.current) return;
    exiting.current = true;
    setLeaving(true);
    const exited = await exitOperatorActAs();
    if (!exited) {
      exiting.current = false;
      setLeaving(false);
      toast.error("Couldn't leave this tenant. Try again.");
      return;
    }
    clearWorkspaceScopedState();
    forgetWorkspaceEntered();
    landAt.go(GOD_CONSOLE);
  };

  return (
    <Button
      data-operator-exit
      variant="outline"
      disabled={leaving}
      onClick={() => void exit()}
      aria-label="Stop acting as this tenant and return to the platform"
    >
      <CornerUpLeft className="mr-1.5 h-4 w-4" />
      {leaving ? "Leaving…" : "Exit tenant"}
    </Button>
  );
}

function MemberExitControl() {
  const navigate = useNavigate();
  const { tenants = [], isPlatformStaff, activeTenantId } = useTenantContext();

  // The switcher this replaces stashed a post-switch toast for the destination
  // to show. Keep draining that key so a notice written before this shipped is
  // still delivered once, rather than lingering in session storage forever.
  useEffect(() => {
    try {
      const notice = sessionStorage.getItem(ACCOUNT_SWITCH_NOTICE_KEY);
      if (!notice) return;
      sessionStorage.removeItem(ACCOUNT_SWITCH_NOTICE_KEY);
      toast.success(notice);
    } catch {
      // Feedback is best-effort when session storage is unavailable.
    }
  }, []);

  // §18 — the "does this person have somewhere else to go?" rule already had a
  // home: `shouldOfferAccountPicker`, which `Auth.tsx` runs at sign-in to decide
  // whether the chooser appears at all. This control asks the SAME question, so
  // it calls the SAME predicate rather than a second copy that can drift.
  //
  // It must also count the SAME POPULATION the chooser will actually offer, which
  // is active tenants only. Counting the raw list would show this button to
  // someone whose second tenant is not active — they would click it, the chooser
  // would find fewer than two choices, and it would send them straight back into
  // the shell they were trying to leave. A recovery control that silently does
  // nothing is worse than one that is absent, because it spends the owner's trust.
  const reachable = reachableWorkspaceCount(tenants, activeTenantId);
  if (!shouldOfferAccountPicker({ activeMembershipCount: reachable, isPlatformStaff })) return null;

  // LEAVING IS WHERE THE UNSAVED WORK IS LOST, so the account-switch guard runs
  // HERE and not only at the chooser. `settings-setup.tsx` registers that guard
  // while Setup is dirty or mid-save, and registration is tied to Setup being
  // MOUNTED — navigating to the chooser unmounts it, taking the guard with it. So
  // a guard consulted only at the switch would already be gone by the time it was
  // asked, and the edits would already be gone with it.
  //
  // It was the deleted `MemberAccountSwitcher` that used to call this, from inside
  // the shell where Setup was still mounted. Replacing that control means carrying
  // its protection across, not just its capability — otherwise this change silently
  // removes a safeguard that shipped separately (§58).
  //
  // The destination is deliberately unnamed: at this point the person has not chosen
  // one, which is the entire purpose of the chooser.
  const leave = async () => {
    const allowed = await allowAccountSwitch({
      fromTenantId: activeTenantId ?? null,
      toTenantId: "",
      toTenantName: "another workspace",
    });
    if (!allowed) return;
    navigate(WORKSPACE_CHOOSER_PATH);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void leave()}
      aria-label="Leave this workspace and choose another"
    >
      <LogOut className="mr-1.5 h-4 w-4" />
      Switch workspace
    </Button>
  );
}
