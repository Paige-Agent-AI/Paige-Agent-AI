import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { PortalInvitation } from "./portalDashboardModel";
import { readPortalInvitationHistory } from "./portalInvitationEvidence";

export function usePortalInvitations(tenantId: string) {
  const client = useQueryClient();
  const {
    activeTenantId,
    activeUserId,
    accountContextStatus,
    accountContextLoading,
  } = useTenantContext();
  const contextReady =
    !accountContextLoading &&
    accountContextStatus === "ready" &&
    !!activeUserId &&
    activeTenantId === tenantId;
  const scope = JSON.stringify([activeUserId, tenantId, contextReady]);
  const boundary = useRef({ scope, generation: 0, retired: false });
  if (boundary.current.scope !== scope) boundary.current = { scope, generation: boundary.current.generation + 1, retired: false };
  const [authRevision, setAuthRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const retired = event === "SIGNED_OUT" || session?.user.id !== activeUserId;
      if (retired === boundary.current.retired) return;
      boundary.current.retired = retired;
      boundary.current.generation += 1;
      // No Auth API call under the SDK callback lock. Retire data immediately;
      // a later same-actor session must perform the canonical read again.
      setAuthRevision(value => value + 1);
    });
    return () => { disposed = true; subscription.unsubscribe(); };
  }, [activeUserId, scope]);
  const ready = contextReady && !boundary.current.retired;
  const query = useQuery({
    queryKey: ["portal-invitations", activeUserId, tenantId, authRevision],
    enabled: ready,
    staleTime: 15_000,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<PortalInvitation[]> => {
      const generation = boundary.current.generation;
      const current = () => !signal.aborted && boundary.current.scope === scope && !boundary.current.retired && boundary.current.generation === generation;
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || user?.id !== activeUserId)
        throw new Error("Sign in again to check invitations.");
      if (!current()) throw new Error("Invitation check retired.");
      // Narrow dynamic call for the native contract added after generated SDK types.
      const { data, error } = await supabase.rpc("client_portal_owner_invitations" as never, {
        p_expected_actor_id: activeUserId,
        p_expected_tenant_id: tenantId,
      } as never)
        .abortSignal(signal);
      if (!current()) throw new Error("Invitation check retired.");
      if (error) throw new Error("Invitation history could not be checked.");
      const checked = readPortalInvitationHistory(data, activeUserId!, tenantId);
      if (!checked) throw new Error("Invitation history could not be verified. Reopen it before taking action.");
      const after = await supabase.auth.getUser();
      if (!current() || after.error || after.data.user?.id !== activeUserId) throw new Error("Invitation check retired.");
      return checked;
    },
  });
  return {
    ...query,
    data: ready && !query.isError ? query.data : undefined,
    isLoading: !contextReady || (ready && query.isLoading),
    isError: boundary.current.retired || (ready && query.isError),
    invalidate: () =>
      client.invalidateQueries({
        queryKey: ["portal-invitations", activeUserId, tenantId],
      }),
  };
}
