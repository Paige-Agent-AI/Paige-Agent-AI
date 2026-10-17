import { supabase } from "@/integrations/supabase/client";
import { useClientPortalRead } from "./useClientPortalRead";

/**
 * The tenant brand for the signed-in customer's client portal (§6). Resolves the
 * caller's own tenant via get_client_portal_brand() (SECURITY DEFINER, keyed on
 * the canonical active relationship). Returns null until loaded / for non-clients.
 */
export interface ClientPortalBrand {
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_slug?: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

export interface ClientPortalBrandState {
  /** The resolved tenant brand, or null while loading OR for a non-client caller. */
  brand: ClientPortalBrand | null;
  /**
   * True until the resolver round-trips. Lets chrome render a neutral placeholder
   * instead of flashing the platform (Paige) brand and swapping it for the
   * tenant's (§6/§11 — no jarring hand-off).
   */
  loading: boolean;
  /** The resolver failed: whether the caller is a customer is UNKNOWN (not "not a customer"). */
  error: boolean;
}

/**
 * Loading-aware resolver for the tenant brand. Prefer this in chrome that must
 * avoid a brand flash (nav, headers): render a skeleton while `loading`, then the
 * tenant brand, then fall back to the platform brand only once resolved-empty.
 */
export function useClientPortalBrandState(): ClientPortalBrandState {
  const { data: brand, loading, error } = useClientPortalRead(readBrand, null);
  return { brand, loading, error };
}

async function readBrand(): Promise<ClientPortalBrand | null> {
  const { data, error } = await supabase.rpc("get_client_portal_brand");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof row.tenant_id !== "string" || !row.tenant_id) return null;
  return row as ClientPortalBrand;
}

/**
 * Brand-only accessor (backward-compatible). Returns null until loaded / for
 * non-clients. Use useClientPortalBrandState() when you also need the loading
 * flag to avoid a brand flash.
 */
export function useClientPortalBrand(): ClientPortalBrand | null {
  return useClientPortalBrandState().brand;
}
