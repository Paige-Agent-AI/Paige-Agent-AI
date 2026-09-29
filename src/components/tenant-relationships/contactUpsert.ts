import { supabase } from "@/integrations/supabase/client";

export type ContactUpsertPatch = Partial<{
  first_name: string | null;
  last_name: string | null;
  /** The contact's complete, ordered list of emails and phones (replaces what is stored). */
  contact_methods: Array<{ kind: "email" | "phone"; value: string; label: string | null; is_primary: boolean }>;
  entity_name: string | null;
  entity_type: string | null;
  title: string | null;
  website: string | null;
  linkedin_url: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  lifecycle_stage: string | null;
  source: string | null;
  tags: string[];
  primary_offer: string | null;
  current_notes: string | null;
  status: string;
  assigned_coach_user_id: string | null;
  do_not_contact: boolean;
}>;

export async function upsertRelationshipContact({
  tenantId,
  contactId = null,
  patch,
  channel = "manual",
}: {
  tenantId: string;
  contactId?: string | null;
  patch: ContactUpsertPatch;
  channel?: "manual" | "api";
}) {
  const { data, error } = await supabase.rpc("upsert_contact", {
    p_patch: patch,
    p_contact_id: contactId,
    p_tenant_id: tenantId,
    p_channel: channel,
  });
  if (error) throw new Error(error.message || "Contact save failed");
  if (!data) throw new Error("Contact save returned no record id");
  return data;
}
