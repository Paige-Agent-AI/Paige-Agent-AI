/**
 * Lightweight hook that returns the subset of the current user's profile +
 * primary business needed by the conversational extractor to skip fields that
 * are already populated. Intentionally minimal — re-fetches on demand via
 * `refresh()` so the chat can refresh after a write-back without a full
 * react-query cache invalidation tour.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileSnapshot } from "@/lib/conversationalExtractor";
import { readUserPrimaryAddresses } from "@/lib/userPrimaryContact";

export function useProfileSnapshot(userId: string | null | undefined) {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({
    full_name: null,
    phone: null,
    address: null,
    primary_goal: null,
    goal_amount: null,
    business: null,
  });

  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: profile }, { data: biz }, contact] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, address, primary_goal, goal_amount")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select(
          "legal_name, dba, ein, formation_date, state_of_formation, business_street_address, website, business_email, estimated_annual_revenue, employee_count, naics, entity_type"
        )
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      // Phone is the person's primary phone contact method.
      readUserPrimaryAddresses(userId),
    ]);

    setSnapshot({
      full_name: profile?.full_name ?? null,
      phone: contact.phone,
      address: profile?.address ?? null,
      primary_goal: profile?.primary_goal ?? null,
      goal_amount: profile?.goal_amount ?? null,
      business: biz
        ? {
            legal_name: biz.legal_name ?? null,
            dba: biz.dba ?? null,
            ein: biz.ein ?? null,
            formation_date: biz.formation_date ?? null,
            state_of_formation: biz.state_of_formation ?? null,
            business_street_address: biz.business_street_address ?? null,
            website: biz.website ?? null,
            business_email: biz.business_email ?? null,
            estimated_annual_revenue: biz.estimated_annual_revenue ?? null,
            employee_count: biz.employee_count ?? null,
            naics: biz.naics ?? null,
            entity_type: biz.entity_type ?? null,
          }
        : null,
    });
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { snapshot, refresh: load };
}
