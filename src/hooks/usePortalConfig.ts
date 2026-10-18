import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizePortalConfig,
  type ClientPortalConfig,
  type PortalCatalogInput,
} from "@/hooks/useClientPortalConfig";
import { catalogInputFromFeatures } from "@/lib/playbook/resolve";

/**
 * Editor-side seam for the existing tenant portal configuration writer.
 *
 * Reads tenants.features.portal_config for the admin's active tenant (a direct
 * select on the tenants row they can access, mirroring useBrandKit's read), and
 * writes through the ONE shared RPC set_tenant_portal_config — the same entry
 * point reserved for governed callers, with the same authority as brand editing
 * (can_manage_tenant_brand). The overlay is subtractive/reordering over the
 * Playbook catalog and never introduces module keys.
 *
 * Optimistic: a save patches the cache immediately, rolls back on error, and
 * re-fetches on settle so the editor always reflects the server's merged truth.
 */

// Untyped shim — the generated types don't yet carry the portal_config RPC.
const db = supabase as unknown as {
  from: (t: "tenants") => {
    select: (columns: "features") => {
      eq: (column: "id", value: string) => {
        maybeSingle: () => Promise<{ data: { features?: unknown } | null; error: unknown }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export function usePortalConfig(tenantId: string | null) {
  const qc = useQueryClient();
  const key = ["portal-config", tenantId];

  const query = useQuery({
    queryKey: key,
    enabled: !!tenantId,
    queryFn: async (): Promise<ClientPortalConfig> => {
      const { data, error } = await db
        .from("tenants")
        .select("features")
        .eq("id", tenantId)
        .maybeSingle();
      if (error) throw error;
      const feats = (data?.features ?? {}) as Record<string, unknown>;
      return normalizePortalConfig(feats.portal_config);
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<ClientPortalConfig>) => {
      if (!tenantId) throw new Error("No active tenant");
      const { data, error } = await db.rpc("set_tenant_portal_config", {
        _tenant_id: tenantId,
        _patch: patch,
      });
      if (error) throw error;
      return normalizePortalConfig(data);
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ClientPortalConfig>(key);
      qc.setQueryData<ClientPortalConfig>(key, (old) => normalizePortalConfig({
        ...(old ?? {}), ...patch,
        ...(patch.assistant ? { assistant: { ...old?.assistant, ...patch.assistant } } : {}),
      }));
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    ...query,
    config: query.data ?? ({} as ClientPortalConfig),
    save: (patch: Partial<ClientPortalConfig>) => save.mutateAsync(patch),
    saving: save.isPending,
  };
}

/**
 * E09 Slice M — the owner side of the customer menu catalog. The customer receives these inputs as the
 * server's `_catalog`; the owner derives the SAME inputs from its own `tenants.features` for the workspace
 * being edited (not the profile's active tenant), so the editor offers exactly the rows its customers'
 * menu is built from (§57).
 */
export function usePortalCatalogInput(tenantId: string | null) {
  return useQuery({
    queryKey: ["portal-catalog", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<PortalCatalogInput> => {
      const { data, error } = await db
        .from("tenants")
        .select("features")
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return catalogInputFromFeatures((data?.features ?? {}) as Record<string, unknown>);
    },
  });
}
