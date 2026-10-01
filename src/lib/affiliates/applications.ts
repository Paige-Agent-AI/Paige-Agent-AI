// src/lib/affiliates/applications.ts
// Queries + mutations for the affiliate_applications table.

import { supabase } from "@/integrations/supabase/client";

export type AffiliateApplicationStatus = "pending" | "approved" | "rejected";
export type RequestedTierKey = "external" | "coach" | "admin";

export interface AffiliateApplication {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  website_url: string | null;
  social_links: string | null;
  audience_description: string | null;
  why_join: string | null;
  requested_tier_key: RequestedTierKey;
  status: AffiliateApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  resulting_affiliate_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewAffiliateApplication {
  full_name: string;
  email: string;
  phone?: string | null;
  website_url?: string | null;
  social_links?: string | null;
  audience_description?: string | null;
  why_join?: string | null;
  requested_tier_key?: RequestedTierKey;
  user_id?: string | null;
}

export async function submitAffiliateApplication(
  input: NewAffiliateApplication,
): Promise<AffiliateApplication> {
  const { data, error } = await supabase
    .from("affiliate_applications")
    .insert({
      full_name: input.full_name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      website_url: input.website_url?.trim() || null,
      social_links: input.social_links?.trim() || null,
      audience_description: input.audience_description?.trim() || null,
      why_join: input.why_join?.trim() || null,
      requested_tier_key: input.requested_tier_key ?? "external",
      user_id: input.user_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const app = data as AffiliateApplication;

  // Confirmation email (non-blocking). The server sends it to the address on this application —
  // the browser only names which application was just submitted.
  void supabase.functions.invoke("affiliate-application-confirm", {
    body: { applicationId: app.id },
  }).catch((e) => console.warn("application received email failed", e));

  return app;
}

export async function fetchAffiliateApplications(
  status?: AffiliateApplicationStatus,
): Promise<AffiliateApplication[]> {
  let q = supabase
    .from("affiliate_applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AffiliateApplication[];
}

export async function approveAffiliateApplication(
  applicationId: string,
  tierKey?: RequestedTierKey,
  notes?: string,
): Promise<{ affiliate_id: string; matched_user_id: string | null }> {
  const { data, error } = await supabase.rpc("approve_affiliate_application", {
    _application_id: applicationId,
    _tier_key: tierKey ?? null,
    _notes: notes ?? null,
  });
  if (error) throw error;
  const result = data as { affiliate_id: string; matched_user_id: string | null };

  // Send approved-welcome email (non-blocking)
  try {
    const { data: app } = await supabase
      .from("affiliate_applications")
      .select("email, full_name, requested_tier_key")
      .eq("id", applicationId)
      .single();
    const { data: aff } = await supabase
      .from("affiliate_profiles")
      .select("referral_code")
      .eq("id", result.affiliate_id)
      .single();

    if (app && aff?.referral_code) {
      const code = aff.referral_code;
      void supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "affiliate-approved-welcome",
          recipientEmail: app.email,
          idempotencyKey: `aff-approved-${result.affiliate_id}`,
          recipientUserId: result.matched_user_id ?? undefined,
          templateData: {
            firstName: app.full_name?.split(" ")[0] ?? null,
            referralCode: code,
            referralLink: `https://paigeagent.ai?ref=${code}`,
            tierKey: tierKey ?? app.requested_tier_key,
          },
        },
      }).catch((e) => console.warn("approved welcome email failed", e));
    }
  } catch (e) {
    console.warn("approved-welcome email lookup failed", e);
  }

  return result;
}

export async function rejectAffiliateApplication(
  applicationId: string,
  notes?: string,
): Promise<void> {
  const { error } = await supabase.rpc("reject_affiliate_application", {
    _application_id: applicationId,
    _notes: notes ?? null,
  });
  if (error) throw error;
}

export async function fetchMyAffiliateApplication(
  userId: string,
): Promise<AffiliateApplication | null> {
  const { data, error } = await supabase
    .from("affiliate_applications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AffiliateApplication) ?? null;
}
