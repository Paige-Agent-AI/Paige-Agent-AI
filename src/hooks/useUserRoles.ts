import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "admin"
  | "client"
  | "broker"
  | "broker_team_member"
  | "owner"
  | string;

interface UserRolesState {
  loading: boolean;
  userId: string | null;
  roles: AppRole[];
  isAdmin: boolean;
  isClient: boolean;
  isBroker: boolean;
  /** Convenience: the standard "staff" check. A job title never counts; only the admin role does. */
  isStaff: boolean;
}

const DEFAULT: UserRolesState = {
  loading: true,
  userId: null,
  roles: [],
  isAdmin: false,
  isClient: false,
  isBroker: false,
  isStaff: false,
};

/**
 * Lightweight role hook used by RoleGate and any UI that needs to
 * conditionally render based on the current user's roles in
 * public.user_roles. Keeps a single fetch + auth listener.
 */
export function useUserRoles(): UserRolesState {
  const [state, setState] = useState<UserRolesState>(DEFAULT);

  useEffect(() => {
    let active = true;

    const load = async (userId: string | null) => {
      if (!userId) {
        if (active) setState({ ...DEFAULT, loading: false });
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (!active) return;
      const roles = (data || []).map((r) => r.role as AppRole);
      setState({
        loading: false,
        userId,
        roles,
        isAdmin: roles.includes("admin"),
        isClient: roles.includes("client"),
        isBroker: roles.includes("broker") || roles.includes("broker_team_member"),
        isStaff: roles.includes("admin"),
      });
    };

    supabase.auth.getUser().then(({ data }) => load(data.user?.id ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      // Do not run Supabase queries directly inside the auth callback; doing so
      // can deadlock session hydration and leave routes stuck on "Loading…".
      window.setTimeout(() => {
        void load(session?.user?.id ?? null);
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
