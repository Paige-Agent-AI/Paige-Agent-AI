// paige-bridge `upsert_contact_mirror`: an external CRM tells us about a contact, and we either
// update the contact we already hold or create it.
//
// Matching, in order: the external CRM's own id (ghl_contact_id) in this workspace, then ANY email
// address a contact in this workspace holds (findClientIdByAddress — every stored method, not only
// the primary). A contact carries no address on its `clients` row:
//   - a NEW contact is created with its email and phone in ONE transaction
//     (insertClientWithAddresses): if the database refuses the create, nothing is created — no
//     contact, no contact.created event. A unique clash (23505) is re-matched once: a contact
//     another writer created meanwhile is updated instead;
//   - for a contact we already hold, the mirrored phone becomes its PRIMARY phone (it takes the
//     current primary's place; every other address is kept), written checked against the list
//     held at that moment (writeAddressIntent), so an address another writer adds concurrently is
//     never overwritten. If the contact-row update then fails, the phone is put back.
// What the caller is told: 409 when sending the same contact again cannot succeed — an address the
// canonical rules refuse (CONTACT_METHOD_*), or an external CRM id another workspace's contact
// already holds (clients_ghl_contact_id_uniq is global); anything else — a lost race, a failed
// read, a timeout — is thrown (500), so a syncing caller retries.
// A phone the address rules would refuse is never sent: the contact is still mirrored, and the
// result says `phone_not_saved` rather than failing the sync or storing junk.
//
// Pure: the client is injected, so vitest drives the real logic
// (src/__tests__/contact-methods-edge.test.ts).

import { findClientIdByAddress, insertClientWithAddresses } from "../_shared/contact-methods.ts";
import { undoAddressWrite, writeAddressIntent } from "../_shared/paige-mcp/contact-method-edits.ts";

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

export type ContactMirrorResult = {
  client_id: string;
  action: "updated" | "created";
  /** Present when a phone was sent that the address rules refuse; the phone was not written. */
  phone_not_saved?: string;
};

/**
 * The mirror's outcome. A refusal the caller should answer with 409 is returned; anything
 * unexpected (a lookup or row write the database fails) is thrown.
 */
export type ContactMirrorOutcome =
  | { ok: true; data: ContactMirrorResult }
  | { ok: false; error: string; details?: { client_id: string } };

const CALLER = "paige-bridge";

/** Refused by the canonical address rules (22023 / 23505 `CONTACT_METHOD_*`): permanent. */
const isAddressRefusal = (message: string | null | undefined) => /^CONTACT_METHOD_/.test(message ?? "");

/** The external CRM id is held by a contact in another workspace (named, never which one). */
const GHL_HELD_ELSEWHERE = "ghl_contact_id_held_elsewhere";

/**
 * Whether a phone passes the same bounds the database's address rules apply
 * (public.contact_methods_canonical): at most 40 characters, 7 to 15 digits.
 */
export function isUsableMirroredPhone(phone: string | null): phone is string {
  if (phone === null) return false;
  const digits = phone.replace(/\D/g, "").length;
  return phone.length <= 40 && digits >= 7 && digits <= 15;
}

export async function upsertContactMirror(db: Db, input: ContactMirrorInput): Promise<ContactMirrorOutcome> {
  const { tenantId } = input;
  const phone = input.phone?.trim() || null;
  const phoneUsable = isUsableMirroredPhone(phone);
  const phoneNotSaved = phone !== null && !phoneUsable ? { phone_not_saved: "not a usable phone number" } : {};

  // Try by ghl_contact_id first, then by any email the workspace's contacts hold.
  const findExisting = async (): Promise<string | null> => {
    if (input.ghlContactId) {
      const { data: byGhl } = await db
        .from("clients")
        .select("id")
        .eq("ghl_contact_id", input.ghlContactId)
        .eq("tenant_id", tenantId)
        .limit(1)
        .maybeSingle();
      if (byGhl?.id) return byGhl.id;
    }
    return await findClientIdByAddress(db, tenantId, "email", input.emailLower, CALLER);
  };
  const matchedId = await findExisting();

  // Whether a contact in ANOTHER workspace holds this external CRM id — asked only after a unique
  // clash, to tell that permanent case from a race. Service role; the answer is a yes/no.
  const ghlHeldElsewhere = async (): Promise<boolean> => {
    if (!input.ghlContactId) return false;
    const { data, error } = await db
      .from("clients")
      .select("id")
      .eq("ghl_contact_id", input.ghlContactId)
      .neq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  };

  const sharedPatch: Record<string, unknown> = {
    first_name: input.first || "Unknown",
    last_name: input.last,
    mirror_source: "mma_os",
    last_mirrored_at: input.nowIso,
  };
  if (input.tier) sharedPatch.tier = input.tier;
  if (input.ghlContactId) sharedPatch.ghl_contact_id = input.ghlContactId;
  if (input.source) sharedPatch.source = input.source;

  const updateExisting = async (existingId: string): Promise<ContactMirrorOutcome> => {
    // The phone first — it is the part the address rules can refuse, and a refusal writes nothing.
    // Applied to the list held at that moment and written checked against it (retried on a race).
    const addressWrite = phoneUsable
      ? await writeAddressIntent(db, tenantId, existingId, { op: "primary", values: { phone } }, null, 2)
      : null;
    if (addressWrite && addressWrite.ok === false) {
      console.error(`[${CALLER}] upsert_contact_mirror phone not written`, { client_id: existingId, message: addressWrite.error });
      // A refused phone is permanent; a lost race (stale) or a failed read is not.
      if (isAddressRefusal(addressWrite.error)) return { ok: false, error: `contact_methods_not_saved: ${addressWrite.error}` };
      throw new Error(`contact_methods_write_failed: ${addressWrite.error}`);
    }
    const { error } = await db.from("clients").update(sharedPatch).eq("id", existingId).eq("tenant_id", tenantId);
    if (error) {
      // All-or-nothing: put the phone back, checked against the list this call left.
      if (addressWrite?.ok) {
        const undoErr = await undoAddressWrite(db, tenantId, existingId, addressWrite);
        if (undoErr) {
          console.error(`[${CALLER}] upsert_contact_mirror phone saved, contact update failed, undo refused`, { client_id: existingId, message: undoErr });
          return { ok: false, error: `contact_update_failed_phone_saved: ${error.message}`, details: { client_id: existingId } };
        }
      }
      if (error.code === "23505" && (await ghlHeldElsewhere())) return { ok: false, error: GHL_HELD_ELSEWHERE };
      throw error;
    }
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
    return { ok: true, data: { client_id: existingId, action: "updated", ...phoneNotSaved } };
  };

  if (matchedId) return await updateExisting(matchedId);

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
    // An unusable phone is left out (reported as phone_not_saved) rather than refusing the create.
    { email: input.emailLower, phone: phoneUsable ? phone : null },
    CALLER,
  );
  // A malformed address (22023, CONTACT_METHOD_*) is permanent: 409, like the update path. A
  // unique clash usually is not: the lookup above found no holder, so another writer created the
  // contact meanwhile (or the lookup failed). Match again once and update what is there. If there
  // is still nothing here and another workspace holds the external id, that is permanent: 409.
  // Otherwise throw, so the caller retries rather than dropping the mirror.
  if (error?.code === "22023" && isAddressRefusal(error.message)) {
    return { ok: false, error: `contact_methods_not_saved: ${error.message}` };
  }
  if (error?.code === "23505") {
    const raced = await findExisting();
    if (raced) return await updateExisting(raced);
    if (await ghlHeldElsewhere()) return { ok: false, error: GHL_HELD_ELSEWHERE };
  }
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
  return { ok: true, data: { client_id: data.id, action: "created", ...phoneNotSaved } };
}
