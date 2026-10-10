import { useCallback, useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { createSettingsRequestGate } from "@/solo/settings-contract";
import { normalizeTeamWorkspace, type TeamMemberRecord } from "@/solo/team-workspace-contract";

type PeopleState = {
  scope: string | null;
  members: TeamMemberRecord[];
  loading: boolean;
  error: string | null;
  partial: boolean;
};
const EMPTY: TeamMemberRecord[] = [];
const PAGE_SIZE = 200;

/** The existing Team read owns names and photos. No profile query or parallel roster. */
export function useOperationsPeople() {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const scope = !tenantLoading && activeTenantId && activeUserId
    ? `${activeUserId}:${activeTenantId}` : null;
  const gate = useRef(createSettingsRequestGate());
  const [state, setState] = useState<PeopleState>({
    scope: null, members: EMPTY, loading: true, error: null, partial: false,
  });
  const refresh = useCallback(async () => {
    const token = gate.current.begin();
    setState({ scope, members: EMPTY, loading: Boolean(scope), error: null, partial: false });
    if (!scope) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- existing Team RPC awaits generated types
      const { data, error } = await (supabase as any).rpc("get_solo_team_workspace", {
        _search: null, _permission: "all", _limit: PAGE_SIZE, _offset: 0,
      });
      if (!gate.current.isCurrent(token)) return;
      const workspace = normalizeTeamWorkspace(data);
      if (error || !workspace || workspace.tenant_id !== activeTenantId) {
        setState({ scope, members: EMPTY, loading: false,
          error: "Team profiles couldn’t be loaded. Try again.", partial: false });
        return;
      }
      setState({ scope, members: workspace.members.filter((member) => member.status === "active"),
        loading: false, error: null, partial: workspace.total_members > workspace.members.length });
    } catch {
      if (gate.current.isCurrent(token)) setState({ scope, members: EMPTY, loading: false,
        error: "Team profiles couldn’t be loaded. Try again.", partial: false });
    }
  }, [scope, activeTenantId]);
  useEffect(() => {
    void refresh();
    const currentGate = gate.current;
    return () => currentGate.clear();
  }, [refresh]);

  // Render-time masking matters: useEffect cleanup happens AFTER a new scope's first render.
  const visible = scope !== null && state.scope === scope;
  return {
    members: visible ? state.members : EMPTY,
    loading: tenantLoading || (scope !== null && (!visible || state.loading)),
    error: visible ? state.error : null,
    partial: visible && state.partial,
    refresh,
  };
}
