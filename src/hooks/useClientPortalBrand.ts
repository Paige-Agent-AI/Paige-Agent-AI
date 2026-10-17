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
  /**
   * The caller IS a customer, of more than one business. The resolver can't pick one for them
   * (choosing a business isn't built yet), so there is no single brand — but this is a known
   * answer, not a failure, and chrome must treat the caller as a customer.
   */
  multipleBusinesses: boolean;
}

interface BrandRead {
  brand: ClientPortalBrand | null;
  multipleBusinesses: boolean;
}

const NO_BRAND: BrandRead = { brand: null, multipleBusinesses: false };
const MULTIPLE: BrandRead = { brand: null, multipleBusinesses: true };

/**
 * Loading-aware resolver for the tenant brand. Prefer this in chrome that must
 * avoid a brand flash (nav, headers): render a skeleton while `loading`, then the
 * tenant brand, then fall back to the platform brand only once resolved-empty.
 */
export function useClientPortalBrandState(): ClientPortalBrandState {
  const { data, loading, error } = useClientPortalRead(readBrand, NO_BRAND);
  return { brand: data.brand, loading, error, multipleBusinesses: data.multipleBusinesses };
}

async function readBrand(): Promise<BrandRead> {
  const { data, error } = await supabase.rpc("get_client_portal_brand");
  if (error) {
    // client_portal_relationship_id() refuses, rather than guesses, when the caller holds more than
    // one customer relationship. That refusal is an answer about who they are.
    const { code, message } = error as { code?: string; message?: string };
    if (code === "42501" && /select an authorized customer relationship/i.test(message ?? "")) return MULTIPLE;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object" || typeof row.tenant_id !== "string" || !row.tenant_id) return NO_BRAND;
  return { brand: row as ClientPortalBrand, multipleBusinesses: false };
}

/**
 * Brand-only accessor (backward-compatible). Returns null until loaded / for
 * non-clients. Use useClientPortalBrandState() when you also need the loading
 * flag to avoid a brand flash.
 */
export function useClientPortalBrand(): ClientPortalBrand | null {
  return useClientPortalBrandState().brand;
}
