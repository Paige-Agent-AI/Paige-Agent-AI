// Experience 04 E4-S3 — "See it, then verify it": the one home of the `paige_record_links` frame.
//
// A read PAIGE answered from may name the records it drew on, so the owner can open them and check.
// What travels is a REFERENCE — a destination, and for a client its id and display name — never an
// address. The address is built on the client, from the CURRENT account, through the one route map
// (`_shared/canonical-app-url.ts` `resolveCanonicalRecordLink`), and the destination re-authorises the
// read under its own session and RLS. A reference grants nothing.
//
// The links are presentation only. They never enter model context (the read branch strips them before
// the tool result is pushed), they are emitted once per turn as `data: {"paige_record_links": [...]}`,
// and they persist as `bundle_ref.paige_record_links` (references only — never a path, URL, readback
// or record_locator). This module is pure: the server sanitises with it and the browser reads live
// frames and persisted turns with the SAME rules. Kept out of the C0b-pinned `contract.ts`.

export const READ_LINK_DESTINATIONS = [
  "contacts",
  "sales_agreements",
  "sales_invoices",
  "sales_collections",
  "operations_work",
  "business_time_zone",
] as const;

export type ReadLinkDestination = (typeof READ_LINK_DESTINATIONS)[number];

/** `record_id` (a UUID) and `subject` (at most 80 characters) are kept only on a `contacts` link. */
export type ReadRecordLink = { destination: ReadLinkDestination; record_id: string | null; subject?: string };

export const MAX_RECORD_LINKS = 6;
const MAX_SUBJECT = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESTINATIONS: ReadonlySet<string> = new Set(READ_LINK_DESTINATIONS);

/** Record text on one line: control characters and line breaks become spaces, direction marks drop. */
function subjectOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
  // Cut by code point, never through the middle of a character.
  const cut = Array.from(flat).slice(0, MAX_SUBJECT).join("").trim();
  return cut || undefined;
}

function one(value: unknown): ReadRecordLink | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.destination !== "string" || !DESTINATIONS.has(v.destination)) return null;
  const destination = v.destination as ReadLinkDestination;
  if (destination !== "contacts") return { destination, record_id: null };
  const record_id = typeof v.record_id === "string" && UUID.test(v.record_id) ? v.record_id.toLowerCase() : null;
  const subject = subjectOf(v.subject);
  return subject ? { destination, record_id, subject } : { destination, record_id };
}

/** The defensive reader for a live frame, a persisted bundle_ref, or a dispatcher result. */
export function readRecordLinks(value: unknown): ReadRecordLink[] {
  if (!Array.isArray(value)) return [];
  const out: ReadRecordLink[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (out.length >= MAX_RECORD_LINKS) break;
    const link = one(raw);
    if (!link) continue;
    const key = `${link.destination}:${link.record_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

/** Two rounds of the same turn, under the same rules (the first occurrence wins). */
export function mergeRecordLinks(a: unknown, b: unknown): ReadRecordLink[] {
  return readRecordLinks([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
}
