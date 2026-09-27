import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { SOLO_BETA_OFFER_CODE } from "@/lib/auth/soloBetaAcquisition";

type GateState = "checking" | "allowed" | "recovery";

/**
 * Route-level gate for workspaces created by the paid Solo Beta fulfillment
 * transaction. Existing tenants are deliberately out of scope and keep their
 * current access. For marked Beta tenants, access is granted only after the
 * server re-verifies the subscription, membership, and fulfillment receipt.
 */
export function RequireSoloBetaEntitlement({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { loading, activeTenant, isPlatformStaff } = useTenantContext();
  const marked = activeTenant?.features?.solo_beta_offer_code === SOLO_BETA_OFFER_CODE;
  const billingRecovery = marked
    && /^\/solo\/\d+\/settings\/billing\/?$/.test(location.pathname);
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    let current = true;
    if (loading) {
      setState("checking");
      return () => { current = false; };
    }
    // A platform operator here is an audited act-as supporting this customer, not the customer.
    // The entitlement check reads the CALLER's own enrollment and memberships, which an operator
    // never has, so it would send them to checkout recovery and strand the act-as it just
    // recorded. What they may read is governed server-side, exactly as for RequireSetupComplete,
    // which exempts staff for the same reason.
    if (!marked || billingRecovery || isPlatformStaff) {
      setState("allowed");
      return () => { current = false; };
    }
    setState("checking");
    void (async () => {
      const { data, error } = await supabase.functions.invoke("solo-beta-enrollment-status");
      if (!current) return;
      const row = data && typeof data === "object"
        ? data as { state?: unknown; destination?: unknown }
        : null;
      const expected = activeTenant?.account_number
        ? `/solo/${activeTenant.account_number}/command-center`
        : null;
      setState(!error && row?.state === "verified" && row.destination === expected
        ? "allowed"
        : "recovery");
    })();
    return () => { current = false; };
  }, [activeTenant?.account_number, billingRecovery, isPlatformStaff, loading, marked]);

  if (state === "recovery") {
    return <Navigate to="/welcome?checkout=recovery" replace />;
  }
  if (state !== "allowed") return null;
  return <>{children}</>;
}
