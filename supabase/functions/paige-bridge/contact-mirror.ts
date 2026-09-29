// paige-bridge `upsert_contact_mirror`: an external CRM tells us about a contact, and we either
// update the contact we already hold or create it.
//
// Matching, in order: the external CRM's own id (ghl_contact_id) in this workspace, then ANY email
// address a contact in this workspace holds (findClientIdByAddress — every stored method, not only
// the primary). A contact carries no address on its `clients` row: a new contact is created with
// its email and phone in ONE transaction (insertClientWithAddresses), and a phone sent for a contact
// we already hold is added to its contact methods as the primary, keeping any number it held.
//
// Pure: the client is injected, so vitest drives the real logic
// (src/__tests__/contact-methods-edge.test.ts).

import { addClientAddresses, findClientIdByAddress, insertClientWithAddresses } from "../_shared/contact-methods.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { rpc: (...args: any[]) => any; from: (...args: any[]) => any };

export type ContactMirrorInput = {
  tenantId: string;
  ownerId: string;
  emailLower: string;
  first: string;
  last: string;
  phone?: string | null;
  tier?: string | null;
  ghlContactId?: string | null;
  source?: string | null;
  assignedUserId?: string | null;
  nowIso: string;
};

export type ContactMirrorResult = { client_id: string; action: "updated" | "created" };

const CALLER = "paige-bridge";

export async function upsertContactMirror(db: Db, input: ContactMirrorInput): Promise<ContactMirrorResult> {
  const { tenantId } = input;

  // Try by ghl_contact_id first, then by any email the workspace's contacts hold.
  let existingId: string | null = null;
  if (input.ghlContactId) {
    const { data: byGhl } = await db
      .from("clients")
      .select("id")
      .eq("ghl_contact_id", input.ghlContactId)
      .eq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle();
    existingId = byGhl?.id ?? null;
  }
  if (!existingId) {
    existingId = await findClientIdByAddress(db, tenantId, "email", input.emailLower, CALLER);
  }

  const sharedPatch: Record<string, unknown> = {
    first_name: input.first || "Unknown",
    last_name: input.last,
    mirror_source: "mma_os",
    last_mirrored_at: input.nowIso,
  };
  if (input.tier) sharedPatch.tier = input.tier;
  if (input.ghlContactId) sharedPatch.ghl_contact_id = input.ghlContactId;
  if (input.source) sharedPatch.source = input.source;

  if (existingId) {
    // The phone first, so a number the database refuses leaves the contact as it was.
    if (input.phone) {
      const { error: phoneError } = await addClientAddresses(
        db, tenantId, existingId, [{ kind: "phone", value: input.phone, is_primary: true }], CALLER,
      );
      if (phoneError) throw new Error(`contact_phone_not_saved: ${phoneError.message}`);
    }
    const { error } = await db.from("clients").update(sharedPatch).eq("id", existingId).eq("tenant_id", tenantId);
    if (error) throw error;
    if (input.assignedUserId) {
      await db
        .from("paige_coach_assignments")
        .upsert(
          {
            contact_id: existingId,
            assigned_role: "lead_owner",
            rep_user_id: input.assignedUserId,
            active: true,
            metadata: { source: "mma_os_assigned_to" },
          },
          { onConflict: "contact_id,assigned_role" },
        );
    }
    return { client_id: existingId, action: "updated" };
  }

  const { data, error } = await insertClientWithAddresses(
    db,
    {
      ...sharedPatch,
      created_by: input.ownerId,
      tenant_id: tenantId,
      status: "active",
      source: input.source ?? "mma_bridge",
      lifecycle_stage: "new_lead", // #172: 'lead' violates clients_lifecycle_stage_chk (23514)
      created_by_channel_type: "import", // #10 channel-of-origin (external CRM mirror/sync)
    },
    { email: input.emailLower, phone: input.phone ?? null },
    CALLER,
  );
  if (error || !data) throw new Error(`contact_create_failed: ${error?.message ?? "no id returned"}`);

  if (input.assignedUserId) {
    await db.from("paige_coach_assignments").insert({
      contact_id: data.id,
      assigned_role: "lead_owner",
      rep_user_id: input.assignedUserId,
      active: true,
      metadata: { source: "mma_os_assigned_to" },
    });
  }
  return { client_id: data.id, action: "created" };
}
