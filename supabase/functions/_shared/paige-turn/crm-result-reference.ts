import { readRecordLinks, type ReadRecordLink } from "./record-links.ts";

/** Presentation only: a native receipt reference grants no read or execution authority. */
export type CrmResultMetadata = {
  action: string;
  outcome: string;
  receipt_recorded: boolean;
  external_effect?: boolean;
  record_reference?: ReadRecordLink;
};

// Existing single-contact native actions whose readback names the surviving contact.
// Hard delete and bulk actions cannot name one existing record. Other CRM families
// have no exact destination in readRecordLinks; do not manufacture one here.
const CONTACT_ACTIONS = new Set([
  "contact.create", "contact.update", "contact.archive", "contact.restore",
  "contact.link_company", "contact.unlink_company", "contact.assign_coach",
  "contact.assign_owner", "contact.merge",
]);
// Native identity generation uses CLT + twelve uppercase hex characters; older
// immutable CLT references may be shorter. Never persist a name/profile as subject.
const CLIENT_REFERENCE = /^CLT-[0-9A-F]{1,12}$/;
const METADATA_KEYS = new Set(["action", "outcome", "receipt_recorded", "external_effect", "record_reference"]);
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function crmResultRecordReference(value: unknown): ReadRecordLink | null {
  const result = object(value);
  if (!result || typeof result.action !== "string" || !CONTACT_ACTIONS.has(result.action)
    || result.outcome !== "succeeded" || result.receipt_recorded !== true) return null;
  const readback = object(result.readback), locator = object(result.record_locator);
  if (readback?.absent === true) return null;
  const stored = object(result.record_reference);
  if (result.record_reference !== undefined && (!stored || stored.destination !== "contacts"
    || Object.keys(stored).some(key => !["destination", "record_id", "subject"].includes(key))
    || (stored.subject !== undefined && (typeof stored.subject !== "string" || !CLIENT_REFERENCE.test(stored.subject))))) return null;
  if (stored && !readRecordLinks([stored])[0]?.record_id) return null;
  // A fresh native result needs its readback ID; a stored projection has only the reference.
  if (!stored && typeof readback?.id !== "string") return null;
  const ids = [stored?.record_id, readback?.id, locator?.record_id]
    .filter(id => id !== undefined && id !== null);
  const canonicalIds = ids.map(id => readRecordLinks([{ destination: "contacts", record_id: id }])[0]?.record_id);
  if (!canonicalIds.length || canonicalIds.some(id => !id || id !== canonicalIds[0])) return null;
  const subject = stored?.subject ?? readback?.client_ref;
  const [reference] = readRecordLinks([{ destination: "contacts", record_id: canonicalIds[0],
    ...(typeof subject === "string" && CLIENT_REFERENCE.test(subject) ? { subject } : {}) }]);
  return reference?.record_id ? reference : null;
}

/** The one additive field allowed beside the existing reduced history projection. */
export function crmResultReferenceMetadata(value: unknown): Pick<CrmResultMetadata, "record_reference"> {
  const reference = crmResultRecordReference(value);
  return reference ? { record_reference: reference } : {};
}

/** Legacy reduced rows remain generic; persisted raw URLs/readback/extra payload never hydrate. */
export function readCrmResultMetadata(value: unknown): CrmResultMetadata[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    const row = object(raw);
    if (!row || typeof row.action !== "string" || typeof row.outcome !== "string") return [];
    return [{ action: row.action, outcome: row.outcome, receipt_recorded: row.receipt_recorded === true,
      ...(typeof row.external_effect === "boolean" ? { external_effect: row.external_effect } : {}),
      // Historical raw payloads are never evidence for a new reference. Only the
      // separately projected field may hydrate; injected old payload fields fail closed.
      ...(Object.keys(row).some(key => !METADATA_KEYS.has(key)) ? {} : crmResultReferenceMetadata(row)) }];
  });
}
