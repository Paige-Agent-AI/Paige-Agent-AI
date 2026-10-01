import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Roles allowed to access authenticated staff surfaces of the platform.
 *
 * Both §53 operator tiers belong here. `platform_admin` was once missing, so an account holding
 * only that role was classed as a client and bounced from every `/operator` address to `/app` —
 * locked out of the console the server already admits it to (`is_platform_admin()`).
 */
const STAFF_ROLES = new Set([
  "admin",
  "super_admin",
  "platform_admin",
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
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (cancelled) return;
      const list = (roles ?? []).map((r) => String(r.role));
      const hasStaff = list.some((r) => STAFF_ROLES.has(r));
      setIsClientOnly(!hasStaff);
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-check on auth changes (sign-in / sign-out / role grant).
  useEffect(() => {
    const loadRoles = async (userId: string) => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const list = (roles ?? []).map((r) => String(r.role));
      setIsClientOnly(!list.some((r) => STAFF_ROLES.has(r)));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setIsClientOnly(false); return; }
      // Keep Supabase queries out of the auth callback itself. Running them
      // synchronously here can deadlock session hydration on reload/sign-in.
      window.setTimeout(() => {
        void loadRoles(session.user.id);
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
