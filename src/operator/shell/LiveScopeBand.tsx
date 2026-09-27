import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useTenantContext } from "@/hooks/useTenantContext";
import ScopeBand from "@/operator/shell/ScopeBand";
import { PLATFORM_SCOPE, actingScope } from "@/operator/shell/scopeStates";

/**
 * The scope band, bound to the session's real scope.
 *
 * WHY IT CANNOT DISAGREE WITH THE STATE. It reads the same `activeTenantId` that scopes every
 * query in the app — loaded from `profiles.active_tenant_id`, the column `current_user_tenant_id()`
 * resolves an operator by — so the band and what the session can read are one value, not two.
 * It used to be a hard-coded "No tenant" string that stayed put while an act-as was open.
 *
 * WHY EXIT GOES THROUGH `switchTenant(null)`. For platform staff that is `operator_exit_tenant`,
 * the audited exit, and it only commits the client scope once the server has accepted it — so a
 * refused exit leaves the band saying "Acting as", which is still true.
 *
 * Exit is a scope change, not a navigation (scopeIsNotNavigation.test.ts): the operator stays on
 * the view they were on, now read at platform scope.
 */
export default function LiveScopeBand({ compact = false }: { compact?: boolean }) {
  const { activeTenantId, tenants, switchTenant } = useTenantContext();
  const [leaving, setLeaving] = useState(false);
  // State re-renders too late to stop a second press in the same tick; the ref does not.
  const inFlight = useRef(false);

  const leave = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLeaving(true);
    try {
      const left = await switchTenant(null);
      if (left) toast.success("Back at platform scope. The exit is recorded.");
      else toast.error("Couldn't leave the tenant. You are still acting as it.");
    } finally {
      inFlight.current = false;
      setLeaving(false);
    }
  }, [switchTenant]);

  if (!activeTenantId) return <ScopeBand {...PLATFORM_SCOPE} compact={compact} />;

  const name = tenants.find((t) => t.id === activeTenantId)?.name ?? null;
  return (
    <ScopeBand
      {...actingScope(name)}
      compact={compact}
      exit={{ label: "Exit tenant", onExit: () => void leave(), busy: leaving }}
    />
  );
}
