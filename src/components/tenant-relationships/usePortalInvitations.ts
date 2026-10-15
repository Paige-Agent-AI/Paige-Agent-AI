import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { PortalInvitation } from "./portalDashboardModel";

export function usePortalInvitations(tenantId: string) {
  const client = useQueryClient();
  const {
    activeTenantId,
    activeUserId,
    accountContextStatus,
    accountContextLoading,
  } = useTenantContext();
  const ready =
    !accountContextLoading &&
    accountContextStatus === "ready" &&
    !!activeUserId &&
    activeTenantId === tenantId;
  const query = useQuery({
    queryKey: ["portal-invitations", activeUserId, tenantId],
    enabled: ready,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<PortalInvitation[]> => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || user?.id !== activeUserId)
        throw new Error("Sign in again to check invitations.");
      if (signal.aborted) throw new Error("Invitation check retired.");
      const { data, error } = await supabase
        .from("tenant_invite_tokens")
        .select(
          "id,contact_id,email,created_at,expires_at,last_used_at,revoked_at",
        )
        .eq("tenant_id", tenantId)
        .eq("kind", "consumer")
        .order("created_at", { ascending: false })
        .limit(1001)
        .abortSignal(signal);
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 1000)
        throw new Error(
          "Open a client record to check its invitation history.",
        );
      return data as PortalInvitation[];
    },
  });
  return {
    ...query,
    data: ready ? query.data : undefined,
    isLoading: !ready || query.isLoading,
    isError: ready && query.isError,
    invalidate: () =>
      client.invalidateQueries({
        queryKey: ["portal-invitations", activeUserId, tenantId],
      }),
  };
}
