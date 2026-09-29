// Turning the contact references in a CRM command into the contacts they name.
//
// Paige is shown a contact's client_ref, never its id, so a governed command may name its contact
// (client_ref), a merge's losing contact (loser_client_ref) or a bulk update's contacts
// (target_client_refs) that way. crm-command resolves them here, inside the caller's own workspace,
// before anything is decided, cached, approved or executed. Pure: the database client is injected,
// so vitest exercises it directly (src/__tests__/crm-contact-refs.test.ts).

import { normalizeClientRef, resolveClientRef } from "../client-ref.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (...args: any[]) => any };

export interface ContactRefCommand {
  contact_id?: string | null;
  loser_contact_id?: string | null;
  client_ref?: string;
  loser_client_ref?: string;
  target_ids?: string[];
  target_client_refs?: string[];
}

export type ContactRefResolution =
  | { ok: true }
  | { ok: false; status: 404 | 400; code: "CRM_CONTACT_NOT_FOUND" | "CRM_CONTACT_REFERENCE_MISMATCH"; detail: string[] };

/**
 * Resolves every contact reference in `command`, IN PLACE: each reference is normalized and its
 * contact's id is filled in beside it. The references stay in the command, because the approval
 * subject is keyed on them on both the proposing and the approving side, and the database ignores
 * them. A reference that names nothing in this workspace is not found — another workspace's
 * contact is indistinguishable from none. A reference sent with an id must name that same contact.
 */
export async function resolveCommandContactRefs(
  admin: Client,
  tenantId: string,
  command: ContactRefCommand,
  caller: string,
): Promise<ContactRefResolution> {
  for (const [refField, idField] of [["client_ref", "contact_id"], ["loser_client_ref", "loser_contact_id"]] as const) {
    const ref = command[refField];
    if (ref === undefined) continue;
    command[refField] = normalizeClientRef(ref) ?? ref;
    const resolvedId = await resolveClientRef(admin, tenantId, ref, caller);
    if (!resolvedId) return { ok: false, status: 404, code: "CRM_CONTACT_NOT_FOUND", detail: [refField] };
    const suppliedId = command[idField];
    if (typeof suppliedId === "string" && suppliedId.toLowerCase() !== resolvedId.toLowerCase()) {
      return { ok: false, status: 400, code: "CRM_CONTACT_REFERENCE_MISMATCH", detail: [refField, idField] };
    }
    command[idField] = resolvedId;
  }
  if (command.target_client_refs !== undefined) {
    const refs = command.target_client_refs.map((ref) => normalizeClientRef(ref) ?? ref);
    command.target_client_refs = refs;
    const resolved = await Promise.all(refs.map((ref) => resolveClientRef(admin, tenantId, ref, caller)));
    const missing = refs.filter((_, index) => !resolved[index]);
    if (missing.length) return { ok: false, status: 404, code: "CRM_CONTACT_NOT_FOUND", detail: missing };
    command.target_ids = [...new Set(resolved as string[])];
  }
  return { ok: true };
}
