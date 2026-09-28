import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import AgencyApp from "@/agency/AgencyApp";
import { useTenantContext } from "@/hooks/useTenantContext";
import { EmptyState, PageSkeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StrandedOperatorExit } from "@/components/auth/WorkspaceExitControl";
import { WORKSPACE_CHOOSER_PATH, decideWorkspaceEntry } from "@/lib/auth/workspaceEntry";

/**
 * BusinessEntry — the `/business/*` dispatcher (§65 R3c-i).
 *
 * Mounted at `/business/*`, always rendering the sub-account shell under a
 * nested `:account/*` route so it receives `account` + the branch splat from
 * `useParams()` and drives every tab as a real deep-linkable URL, mirroring
 * `AgencyEntry`'s numeric-segment leg (§18 reuse — same shell, same routing
 * machinery, tier-parameterized rather than forked).
 *
 * Unlike `/agency/*`, there is no legacy standalone board to fork against here
 * — a sub-account has only ever rendered inline at `the retired privileged route` (Admin.tsx Gate B),
 * never at its own top-level route — so this dispatcher has a single leg.
 *
 * IT NOW GUARDS LIKE ITS SIBLING (§18). This entry used to check only
 * `accountContextLoading` and then mount, while its docblock asserted that
 * "`AgencyApp`'s own top-level ownership guard keeps the `:account` segment
 * honest against the caller's real tenant." That protection was never
 * implemented for a caller of the WRONG TIER — `AgencyApp` resolves the
 * CALLER'S OWN account number, so it rewrote the URL and left them in the
 * sub-account shell — and the entry also mounted the shell while the active
 * tenant was still unresolved. `SoloEntry` already had the correct shape for
 * both, so this adopts it rather than inventing a second one: resolve the
 * account context first, refuse to mount on an unresolved or errored context,
 * and only then ask whether this caller's tier owns this shell.
 *
 * NOT DECIDING IS A REAL ANSWER. A null `activeTenant` is not "tier solo" — it
 * is "we do not know yet", and `switchTenant` can produce exactly that window
 * because it commits the new id before the tenant list refetches. Classifying
 * an unresolved caller would eject them out of a shell they legitimately own,
 * so the gate is never asked until there is a tenant to ask about.
 *
 * The tier gate itself fails CLOSED: a caller whose SERVER-DERIVED tier does not
 * own this shell goes to their own authorized root, or to the entry chooser when
 * there is no single home to name. It never falls back into another tenant as a
 * convenience. The classification comes from `useTenantContext`, never from the
 * `:account` URL segment — the address is an address, never a grant (§9/§65).
 */
export default function BusinessEntry() {
  const location = useLocation();
  const { accountContextLoading, accountContextStatus, activeTenant, isPlatformStaff, refresh } = useTenantContext();

  if (accountContextLoading || accountContextStatus === "resolving") return <PageSkeleton />;

  if (accountContextStatus === "signed_out") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  // The URL account is an address only. The shell must not mount until the shared
  // provider holds a tenant returned by the authenticated server reads.
  if (accountContextStatus === "error" || !activeTenant) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6" role="alert">
        <EmptyState
          title="Couldn't verify your workspace"
          description="PAIGE couldn't confirm the active account just now. Try again before opening this workspace."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="gold" onClick={() => void refresh()}>
                Try again
              </Button>
              {/* An operator whose act-as began but whose arrival could not load would otherwise
                  be stuck inside it here: no shell, so no exit, has mounted. */}
              <StrandedOperatorExit />
            </div>
          }
        />
      </div>
    );
  }

  const decision = decideWorkspaceEntry({
    root: "business",
    classification: {
      account_type: activeTenant.account_type ?? null,
      parent_tenant_id: activeTenant.parent_tenant_id ?? null,
      isPlatformStaff,
    },
    accountNumber: activeTenant.account_number ?? null,
  });
  if (decision.kind === "redirect") return <Navigate to={decision.to} replace />;
  if (decision.kind === "chooser") return <Navigate to={WORKSPACE_CHOOSER_PATH} replace />;

  return (
    <Routes>
      <Route path=":account/*" element={<AgencyApp mode="subaccount" />} />
    </Routes>
  );
}
