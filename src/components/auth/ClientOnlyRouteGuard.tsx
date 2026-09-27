import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchOperatorStanding, isOperator } from "@/lib/auth/operatorStanding";

/**
 * Tenant-side staff roles: the people who work inside a business, as opposed to its clients.
 *
 * Operator tiers are deliberately NOT listed. Whether someone is a platform operator is the one
 * server answer (`operator_standing()`, read through src/lib/auth/operatorStanding.ts); a list
 * here was how an account holding only `platform_admin` came to be classed as a client and
 * locked out of the console it is authorised for.
 */
const TENANT_STAFF_ROLES = new Set([
  "admin",
  "owner",
  "sales_rep",
  "broker",
  "broker_team_member",
  "cs_rep",
  "finance",
  "moderator",
  "viewer",
  "developer",
]);

/** Routes a pure-client account is forbidden from. They get bounced to /app. */
// `/operator` joins the list with the operator console mount (§65 R4). A client is already
// blocked by RequireOperator, but this list is the defense-in-depth layer and leaving a newly
// privileged prefix out of it is exactly the §37 producer-inventory gap that lets the two
// drift apart. Caught by the §39 peer-gate.
const CLIENT_FORBIDDEN_PREFIXES = ["/broker/app", "/operator"];

/**
 * Is this signed-in account a client? `true` only on a successful read that shows no tenant
 * staff role and no operator tier. A failed read of either is `null` — unknown — and never
 * sends anyone away: "could not verify" is not "you are a client".
 */
async function readIsClientOnly(userId: string): Promise<boolean | null> {
  const [rolesRes, standing] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    fetchOperatorStanding(),
  ]);
  if (rolesRes.error || !rolesRes.data || standing === null) return null;
  const hasTenantStaff = rolesRes.data.some((r) => TENANT_STAFF_ROLES.has(String(r.role)));
  return !hasTenantStaff && !isOperator(standing);
}

/**
 * Hard guard: a signed-in account whose only role is `client` (or no role at all
 * while linked to a clients row) is locked to /app, /onboard, /auth, and public
 * pages. They cannot reach broker or platform-operator surfaces — even
 * if they paste a URL directly. (BTF surface retired — Sprint 211.b cleanup)
 */
export function ClientOnlyRouteGuard() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isClientOnly, setIsClientOnly] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) { setIsClientOnly(false); return; }
      const verdict = await readIsClientOnly(user.id);
      if (!cancelled) setIsClientOnly(verdict);
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-check on auth changes (sign-in / sign-out / role grant).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setIsClientOnly(false); return; }
      // Keep Supabase queries out of the auth callback itself. Running them
      // synchronously here can deadlock session hydration on reload/sign-in.
      window.setTimeout(() => {
        void readIsClientOnly(session.user.id).then(setIsClientOnly);
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isClientOnly !== true) return;
    if (CLIENT_FORBIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p))) {
      navigate("/app", { replace: true });
    }
  }, [isClientOnly, location.pathname, navigate]);

  return null;
}
