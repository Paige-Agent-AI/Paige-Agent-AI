import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import SoloApp from "@/solo/SoloApp";
import { useTenantContext } from "@/hooks/useTenantContext";
import { EmptyState, PageSkeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StrandedOperatorExit } from "@/components/auth/WorkspaceExitControl";
import { WORKSPACE_CHOOSER_PATH, decideWorkspaceEntry } from "@/lib/auth/workspaceEntry";

/**
 * SoloEntry — the `/solo/*` dispatcher (§65 R3d-i).
 *
 * Mounted at `/solo/*`, always rendering the Solo shell under a nested
 * `:account/*` route so it receives `account` + the branch splat from
 * `useParams()` and drives every tab as a real deep-linkable URL, mirroring
 * `BusinessEntry`'s single-legged pattern (§18 reuse — same shell-conversion
 * pattern as sub-account's `/business/*`, tier-parameterized rather than
 * forked).
 *
 * Like sub-account, there is no legacy standalone board to fork against here
 * — a Solo tenant has only ever rendered inline at `/choose-account` (Admin.tsx's Solo
 * gate), never at its own top-level route — so this dispatcher has a single
 * leg. The `/choose-account` gate's redirect (§58, mirrors Gate A/B) is what makes
 * this address reachable; `SoloApp`'s own top-level ownership guard (§9,
 * mirrors task #171/R3c-i) then keeps the `:account` segment honest against
 * the caller's real tenant.
 *
 * THAT GUARD IS ABOUT THE ADDRESS, NOT THE TIER — which is why the tier gate
 * below exists (owner ruling 2026-09-02). `SoloApp` rewrites the `:account`
 * segment to the CALLER'S OWN account number, so a sub-account or agency caller
 * who reached `/solo/{n}` was quietly renumbered and left running the Solo shell:
 * the right address, the wrong operating mode, with no signal that anything was
 * off. `/business/*` shipped the mirror image of the same hole. Both now ask the
 * one tested question — does this caller's SERVER-DERIVED tier own this shell? —
 * and fail CLOSED to the caller's own root, or to the entry chooser when there is
 * no single home to name, never into another tenant as a convenience.
 */
export default function SoloEntry() {
  const location = useLocation();
  const { accountContextLoading, accountContextStatus, activeTenant, isPlatformStaff, refresh } = useTenantContext();

  if (accountContextLoading || accountContextStatus === "resolving") return <PageSkeleton />;

  if (accountContextStatus === "signed_out") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  // The URL account is an address only. SoloApp and its shell must not mount until
  // the shared provider holds a tenant returned by the authenticated server reads.
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
    root: "solo",
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
      <Route path=":account/*" element={<SoloApp />} />
    </Routes>
  );
}
