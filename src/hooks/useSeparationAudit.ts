import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runSeparationAudit, type SeparationResult } from "@/lib/separationAudit";
import { readUserPrimaryAddresses } from "@/lib/userPrimaryContact";

/**
 * Loads the data needed to run the personal/business separation audit
 * for a given owner. If `businessId` is omitted, the owner's first business
 * is audited.
 *
 * Returns null when there is no business on file (nothing to audit).
 */
export function useSeparationAudit(userId?: string | null, businessId?: string | null) {
  return useQuery<SeparationResult | null>({
    queryKey: ["separation-audit", userId, businessId],
    enabled: !!userId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!userId) return null;

      // Personal identity from profile + the person's primary phone + auth email
      const [{ data: profile }, contact, { data: { user } }] = await Promise.all([
        supabase
          .from("profiles")
          .select("address, city, state, postal_code")
          .eq("user_id", userId)
          .maybeSingle(),
        readUserPrimaryAddresses(userId),
        supabase.auth.getUser(),
      ]);

      // Business identity — pick provided id or first
      let bizQuery = supabase
        .from("businesses")
        .select("id, legal_name, business_street_address, business_city, business_state, business_zip, business_phone, business_email, business_address_type, phone_411_listed")
        .eq("owner_user_id", userId);
      if (businessId) bizQuery = bizQuery.eq("id", businessId);
      const { data: businesses } = await bizQuery.limit(1);
      const biz = businesses?.[0];
      if (!biz) return null;

      // Public presence (website)
      const { data: presence } = await supabase
        .from("business_public_presence")
        .select("website_url, website_live")
        .eq("business_id", biz.id)
        .maybeSingle();

      const personalEmail = user?.id === userId ? user?.email || null : null;

      return runSeparationAudit({
        personalAddress: profile?.address ?? null,
        personalCity: profile?.city ?? null,
        personalState: profile?.state ?? null,
        personalZip: profile?.postal_code ?? null,
        personalPhone: contact.phone,
        personalEmail,
        businessName: biz.legal_name,
        businessStreetAddress: biz.business_street_address ?? null,
        businessCity: biz.business_city ?? null,
        businessState: biz.business_state ?? null,
        businessZip: biz.business_zip ?? null,
        businessPhone: biz.business_phone ?? null,
        businessEmail: biz.business_email ?? null,
        businessAddressType: biz.business_address_type ?? null,
        phone411Listed: biz.phone_411_listed ?? null,
        websiteUrl: presence?.website_url ?? null,
        websiteLive: presence?.website_live ?? null,
      });
    },
  });
}
