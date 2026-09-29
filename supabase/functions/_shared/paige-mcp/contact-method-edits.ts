// Contact-method edits for Paige's own tools (paige-mcp, paige-ai-chat, paige-bridge).
//
// A contact holds several emails and phones, exactly one primary per kind
// (public.client_contact_methods, 20270515000000). Paige's tools used to express an address change
// as a single `email` / `phone` value written onto the contact row. These helpers turn each of the
// edits those tools make into the contact's COMPLETE address list, which the caller then writes in
// one call — so the database validates the whole list before any of it is written. A write to a
// contact that already exists goes through the concurrency-safe primitives below
// (writeAddressIntent), never an unchecked replace.
//
//   withPrimaryAddress  "their email is X" — X becomes the primary of its kind. If the contact
//                       already holds X it is promoted; otherwise X takes the current primary's
//                       place (keeping its label). Null removes the primary and promotes the next.
//                       This is exactly what writing X onto the old single column did.
//   withAddedMethods    "add X" — every address the contact holds is kept; a new one is appended,
//                       and becomes primary only when marked so or when the contact had none of
//                       its kind. The same rule as public._add_client_contact_methods.
//
// No Deno imports; the one database-touching pair (writeAddressIntent / undoAddressWrite) takes its
// client injected, so vitest exercises everything here directly
// (src/__tests__/paige-tools-contact-methods.test.ts).

import { contactMethodMatchKey, orderedContactMethods, type ContactMethodKind } from "../contact-methods.ts";

/**
 * Every column of a `clients` record, for the tools that hand a whole contact record to a reader
 * (paige-mcp `me_get_profile`, paige-ai-chat `crm_get_contact_summary`). Named explicitly rather
 * than `*` so a reader gets the contact's addresses only from its contact methods
 * (`client_contact_methods(...)`), never from the single-address columns that held one of each.
 */
export const CLIENT_RECORD_COLUMNS = [
  "id", "created_by", "first_name", "last_name", "entity_name", "entity_type", "funding_goal", "monthly_revenue",
  "current_notes", "status", "linked_user_id", "created_at", "updated_at", "street_address", "city", "state",
  "zip_code", "assigned_coach_user_id", "lifecycle_stage", "source", "title", "website", "linkedin_url", "tags",
  "lead_score", "last_contacted_at", "do_not_contact", "journey_stage_id", "journey_stage_entered_at",
  "lead_owner_user_id", "cs_primary_user_id", "tier", "ghl_contact_id", "last_mirrored_at", "mirror_source",
  "onboarding_stage", "onboarding_started_at", "onboarding_completed_at", "agreement_signed_at", "primary_offer",
  "tenant_id", "primary_business_id", "account_number", "paige_shared_context_consent",
  "paige_shared_context_consent_updated_at", "temperature", "temperature_overridden_at", "disqualified",
  "disqualified_reason", "timezone", "timezone_verified", "dnd_active", "dnd_reason", "dnd_until", "dnd_set_at",
  "dnd_set_by", "created_by_channel_type", "journey_stage_slug", "merged_into_contact_id", "merged_at",
].join(", ");

/** One address as the database's writers accept it (public.contact_methods_canonical). */
export interface ContactMethodInput {
  kind: ContactMethodKind;
  value: string;
  label?: string | null;
  is_primary?: boolean;
}

type Held = { kind: ContactMethodKind; value: string; label: string | null; is_primary: boolean };

const KINDS: ContactMethodKind[] = ["email", "phone"];

function held(methods: ReadonlyArray<ContactMethodInput>): Held[] {
  return methods
    .filter((m) => m && (m.kind === "email" || m.kind === "phone") && typeof m.value === "string" && m.value.trim())
    .map((m) => ({ kind: m.kind, value: m.value.trim(), label: m.label ?? null, is_primary: m.is_primary === true }));
}

/** Emails then phones, each kind in the given order, with exactly one primary per kind held. */
function settle(list: Held[]): ContactMethodInput[] {
  const out: ContactMethodInput[] = [];
  for (const kind of KINDS) {
    const ofKind = list.filter((m) => m.kind === kind);
    const primaryAt = ofKind.findIndex((m) => m.is_primary);
    ofKind.forEach((m, i) => out.push({ kind, value: m.value, label: m.label, is_primary: primaryAt === -1 ? i === 0 : i === primaryAt }));
  }
  return out;
}

const sameAddress = (kind: ContactMethodKind, a: string, b: string) =>
  contactMethodMatchKey(kind, a) === contactMethodMatchKey(kind, b);

/**
 * The contact's list after `value` is made the primary address of `kind` (or, for null / blank,
 * after the primary of `kind` is removed). Every other address is kept as it is.
 */
export function withPrimaryAddress(
  methods: ReadonlyArray<ContactMethodInput>,
  kind: ContactMethodKind,
  value: string | null | undefined,
): ContactMethodInput[] {
  const list = held(methods);
  const v = typeof value === "string" ? value.trim() : "";
  const primary = list.find((m) => m.kind === kind && m.is_primary)
    ?? list.find((m) => m.kind === kind);

  if (!v) {
    return settle(primary ? list.filter((m) => m !== primary).map((m) => ({ ...m, is_primary: m.kind === kind ? false : m.is_primary })) : list);
  }
  const same = list.find((m) => m.kind === kind && sameAddress(kind, m.value, v));
  if (same) {
    return settle(list.map((m) => m.kind !== kind ? m : { ...m, value: m === same ? v : m.value, is_primary: m === same }));
  }
  if (primary) {
    return settle(list.map((m) => m.kind !== kind ? m : { ...m, value: m === primary ? v : m.value, is_primary: m === primary }));
  }
  return settle([...list, { kind, value: v, label: null, is_primary: true }]);
}

/**
 * The contact's list after `added` is appended. An address the contact already holds is not
 * duplicated; it is only promoted when marked primary.
 */
export function withAddedMethods(
  methods: ReadonlyArray<ContactMethodInput>,
  added: ReadonlyArray<ContactMethodInput>,
): ContactMethodInput[] {
  const merged: Held[] = held(methods);
  const incoming = held(added);
  for (const m of incoming) {
    const holds = merged.some((x) => x.kind === m.kind && sameAddress(m.kind, x.value, m.value));
    if (!holds) merged.push({ ...m, is_primary: false });
  }
  // A kind with an address marked primary in `added` takes that one; otherwise its old primary
  // stays, and a kind the contact held none of takes its first new address (settle).
  for (const kind of KINDS) {
    const promoted = incoming.find((m) => m.kind === kind && m.is_primary);
    if (!promoted) continue;
    for (const m of merged) if (m.kind === kind) m.is_primary = sameAddress(kind, m.value, promoted.value);
  }
  return settle(merged);
}

/** A list of addresses in the writers' shape, or null. Values are checked by the database. */
function methodList(value: unknown): ContactMethodInput[] | null {
  // Up to 20 of each kind, the database's own limit (CONTACT_METHODS_TOO_MANY).
  if (!Array.isArray(value) || value.length > 40) return null;
  const ok = value.every((m) => m && typeof m === "object" && !Array.isArray(m)
    && (m.kind === "email" || m.kind === "phone")
    && typeof m.value === "string"
    && (m.label === undefined || m.label === null || typeof m.label === "string")
    && (m.is_primary === undefined || typeof m.is_primary === "boolean")
    && Object.keys(m).every((k) => k === "kind" || k === "value" || k === "label" || k === "is_primary"));
  return ok ? (value as ContactMethodInput[]) : null;
}

// ─── An address change as an INTENT, applied to the list held when it is written ─────────────
//
// A tool that changes a contact's addresses records WHAT was asked — make X primary, add these,
// or replace the whole list — never a list frozen when it was asked. The write then happens
// against the list held at that moment, through the database's concurrency-safe primitives:
//
//   add      public._add_client_contact_methods — merges under the database's own rules and
//            keeps every address held, including one added a moment ago.
//   replace  public._replace_client_contact_methods_checked, naming the list the change was
//            built on; if that list changed since, the database refuses (CONTACT_METHODS_STALE)
//            and nothing is written.
//   primary  the new primary takes the current primary's place (or is promoted, when already
//            held). Built against the list held now and written checked against that same list.
//            When the change was proposed earlier, the list held now must be the one the proposal
//            was built on — the database's own comparison (contactMethodsFingerprint) — or it is
//            refused as stale. So the addresses, their labels and which one is primary are exactly
//            the preview the approver was shown. Only the order within a kind may differ: that
//            comparison ignores where a primary sits, and the list is rebuilt on the one held now.

export type AddressIntent =
  | { op: "primary"; values: Partial<Record<ContactMethodKind, string | null>> }
  | { op: "add"; methods: ContactMethodInput[] }
  | { op: "replace"; methods: ContactMethodInput[] };

/**
 * Why an added list would be refused by public._add_client_contact_methods before it merges —
 * the same address twice, or two addresses of one kind both marked primary — or null.
 */
export function addedMethodsProblem(added: ReadonlyArray<ContactMethodInput>): string | null {
  const seen = new Set<string>();
  const primaries: Record<ContactMethodKind, number> = { email: 0, phone: 0 };
  for (const m of added) {
    const key = `${m.kind}:${contactMethodMatchKey(m.kind, m.value)}`;
    if (seen.has(key)) return `CONTACT_METHOD_DUPLICATE: ${m.value.trim()}`;
    seen.add(key);
    if (m.is_primary === true) primaries[m.kind] += 1;
  }
  for (const kind of KINDS) {
    if (primaries[kind] > 1) return `CONTACT_METHOD_PRIMARY_CONFLICT: more than one primary ${kind}`;
  }
  return null;
}

/**
 * The address change a free-form contact update asks for (paige-mcp `propose_client_update`), or
 * none, or why it was refused. Three spellings, never mixed:
 *   `email` / `phone`      make that address the primary of its kind (null removes the primary);
 *   `add_contact_methods`  add, keeping every address held;
 *   `contact_methods`      the complete list.
 */
export function proposedAddressIntent(updates: Record<string, unknown>): { intent: AddressIntent | null } | { error: string } {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(updates, key);
  const primaries = KINDS.filter(has);
  const forms = [primaries.length > 0, has("add_contact_methods"), has("contact_methods")].filter(Boolean).length;
  if (forms > 1) {
    return { error: "CONTACT_METHODS_AMBIGUOUS: send email/phone, add_contact_methods or contact_methods — only one of them" };
  }
  if (primaries.length) {
    const values: Partial<Record<ContactMethodKind, string | null>> = {};
    for (const kind of primaries) {
      const value = updates[kind];
      if (value === null) values[kind] = null;
      else if (typeof value === "string") values[kind] = value;
      else return { error: `CONTACT_METHOD_VALUE_REQUIRED: ${kind} must be a string or null` };
    }
    return { intent: { op: "primary", values } };
  }
  for (const key of ["add_contact_methods", "contact_methods"] as const) {
    if (!has(key)) continue;
    const given = methodList(updates[key]);
    if (!given) return { error: `CONTACT_METHODS_INVALID: ${key} must be a list of { kind: "email" | "phone", value, label?, is_primary? }` };
    if (key === "add_contact_methods") {
      if (!given.length) return { error: "CONTACT_METHODS_INVALID: add_contact_methods must name at least one address" };
      const problem = addedMethodsProblem(given);
      if (problem) return { error: problem };
      return { intent: { op: "add", methods: given.map((m) => ({ ...m })) } };
    }
    return { intent: { op: "replace", methods: given.map((m) => ({ ...m })) } };
  }
  return { intent: null };
}

/** An intent as a proposal stored it, checked again before it is applied; null when malformed. */
export function storedAddressIntent(value: unknown): AddressIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.op === "add" || v.op === "replace") {
    const methods = methodList(v.methods);
    if (!methods || (v.op === "add" && (!methods.length || addedMethodsProblem(methods)))) return null;
    return { op: v.op, methods };
  }
  if (v.op === "primary" && v.values && typeof v.values === "object" && !Array.isArray(v.values)) {
    const entries = Object.entries(v.values as Record<string, unknown>);
    if (!entries.length) return null;
    const values: Partial<Record<ContactMethodKind, string | null>> = {};
    for (const [kind, val] of entries) {
      if (kind !== "email" && kind !== "phone") return null;
      if (val === null) values[kind] = null;
      else if (typeof val === "string") values[kind] = val;
      else return null;
    }
    return { op: "primary", values };
  }
  return null;
}

/** A stored "list the change was built on", or null when absent or malformed. */
export function storedMethodList(value: unknown): ContactMethodInput[] | null {
  return value === undefined || value === null ? null : methodList(value);
}

/** The list an intent would leave, applied to `current` — the preview a proposal's diff shows. */
export function intentResult(intent: AddressIntent, current: ReadonlyArray<ContactMethodInput>): ContactMethodInput[] {
  if (intent.op === "replace") return intent.methods.map((m) => ({ ...m }));
  if (intent.op === "add") return withAddedMethods(current, intent.methods);
  return (Object.keys(intent.values) as ContactMethodKind[])
    .reduce((list, kind) => withPrimaryAddress(list, kind, intent.values[kind]), current.map((m) => ({ ...m })));
}

// The outer whitespace public.contact_methods_fingerprint ignores: [[:space:]] plus the no-break
// and zero-width spaces a browser's trim() removes and btrim() keeps (20270519000000).
const OUTER_SPACE = /^[\t\n\v\f\r \u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;

/**
 * A list's identity by the database's own comparison (public.contact_methods_fingerprint): the
 * same addresses, labels and primary, in the same order within each kind; kinds may interleave,
 * outer whitespace and a blank label are no difference, and a kind with no primary marked takes its
 * first address as primary. Two lists with equal fingerprints are, to
 * _replace_client_contact_methods_checked, the same list.
 */
export function contactMethodsFingerprint(list: ReadonlyArray<ContactMethodInput>): string {
  const items = list.map((m, ord) => ({
    kind: String(m.kind).toLowerCase(),
    value: String(m.value ?? "").replace(OUTER_SPACE, ""),
    label: String(m.label ?? "").replace(OUTER_SPACE, "") || null,
    is_primary: m.is_primary === true,
    ord,
  }));
  const ranked = items.map((m) => {
    const ofKind = items.filter((x) => x.kind === m.kind);
    return { ...m, is_primary: m.is_primary || (!ofKind.some((x) => x.is_primary) && ofKind[0] === m) };
  });
  ranked.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)
    || Number(b.is_primary) - Number(a.is_primary) || a.ord - b.ord);
  return JSON.stringify(ranked.map(({ kind, value, label, is_primary }) => [kind, value, label, is_primary]));
}

export const CONTACT_METHODS_STALE =
  "CONTACT_METHODS_STALE: this contact's emails or phones changed after the change was prepared, so nothing was written — prepare it again against the current list";

export type AddressWritePlan =
  | { rpc: "_add_client_contact_methods"; methods: ContactMethodInput[] }
  | { rpc: "_replace_client_contact_methods_checked"; methods: ContactMethodInput[]; expected: ContactMethodInput[] }
  | { stale: string };

/**
 * How to write `intent`, given the list it was built on (`builtOn`; null when it is being built
 * right now, from `heldNow`) and the list held now. Pure.
 */
export function planAddressWrite(
  intent: AddressIntent,
  builtOn: ReadonlyArray<ContactMethodInput> | null,
  heldNow: ReadonlyArray<ContactMethodInput>,
): AddressWritePlan {
  if (intent.op === "add") return { rpc: "_add_client_contact_methods", methods: intent.methods.map((m) => ({ ...m })) };
  // A proposed replacement or new primary is written only onto the very list its preview was built
  // on. Any difference — the target removed or added since, an address relabelled, reordered or
  // promoted — could write a result the approver was never shown, so it is refused here, and the
  // database refuses it again under its lock (the write names `builtOn` as the list expected).
  if (builtOn && contactMethodsFingerprint(builtOn) !== contactMethodsFingerprint(heldNow)) {
    return { stale: CONTACT_METHODS_STALE };
  }
  const expected = [...(builtOn ?? heldNow)];
  if (intent.op === "replace") {
    return { rpc: "_replace_client_contact_methods_checked", methods: intent.methods.map((m) => ({ ...m })), expected };
  }
  return { rpc: "_replace_client_contact_methods_checked", methods: intentResult(intent, heldNow), expected };
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriterClient = { rpc: (...args: any[]) => any; from: (...args: any[]) => any };

export type AddressWriteResult =
  | { ok: true; before: ContactMethodInput[]; after: ContactMethodInput[] }
  | { ok: false; error: string; stale: boolean };

const isStale = (message: string) => message.includes("CONTACT_METHODS_STALE");

/**
 * Writes `intent` to one contact of one workspace (service role; the caller has already resolved
 * and authorised both). Reads the list held now, plans the write, and makes it. `before` / `after`
 * are the list either side of the write, so a caller whose next step fails can undo exactly this
 * change (undoAddressWrite). A direct change (`builtOn` null) that loses a race to another writer
 * is rebuilt on the new list and retried up to `retries` times; a proposed change never is — the
 * approver saw the list it was built on, not the new one.
 */
export async function writeAddressIntent(
  admin: WriterClient,
  tenantId: string,
  clientId: string,
  intent: AddressIntent,
  builtOn: ReadonlyArray<ContactMethodInput> | null,
  retries = 0,
): Promise<AddressWriteResult> {
  for (let attempt = 0; ; attempt += 1) {
    const { data: rows, error: readErr } = await admin.from("client_contact_methods")
      .select("kind, value, label, is_primary, position").eq("client_id", clientId).eq("tenant_id", tenantId);
    if (readErr) return { ok: false, error: String(readErr.message ?? "contact_methods_read_failed"), stale: false };
    const before: ContactMethodInput[] = orderedContactMethods(rows);
    const plan = planAddressWrite(intent, builtOn, before);
    if ("stale" in plan) return { ok: false, error: plan.stale, stale: true };
    const args = plan.rpc === "_add_client_contact_methods"
      ? { _tenant_id: tenantId, _client_id: clientId, _methods: plan.methods }
      : { _tenant_id: tenantId, _client_id: clientId, _methods: plan.methods, _expected: plan.expected };
    const { data, error } = await admin.rpc(plan.rpc, args);
    if (!error) return { ok: true, before, after: orderedContactMethods(data) };
    const message = String(error.message ?? "contact_methods_write_failed");
    if (isStale(message) && builtOn === null && attempt < retries) continue;
    return { ok: false, error: isStale(message) ? CONTACT_METHODS_STALE : message, stale: isStale(message) };
  }
}

/**
 * Puts a contact's list back to `before` — only if it is still exactly `after`, the list this
 * caller's own write left. Returns null when undone, or why it could not be.
 */
export async function undoAddressWrite(
  admin: WriterClient,
  tenantId: string,
  clientId: string,
  write: { before: ContactMethodInput[]; after: ContactMethodInput[] },
): Promise<string | null> {
  const { error } = await admin.rpc("_replace_client_contact_methods_checked", {
    _tenant_id: tenantId, _client_id: clientId, _methods: write.before, _expected: write.after,
  });
  return error ? String(error.message ?? "contact_methods_undo_failed") : null;
}

// ─── The contact-row half of a proposed update, checked before anything is written ───────────

/** The contact-row fields propose_client_update may change, named as the columns they are. */
export const PROPOSABLE_CLIENT_FIELDS: readonly string[] = [
  "first_name", "last_name", "entity_name", "entity_type",
  "street_address", "city", "state", "zip_code", "funding_goal", "monthly_revenue",
  "primary_offer", "lifecycle_stage", "tier", "source", "title", "website", "current_notes",
];

// The values the clients check constraints accept (clients_lifecycle_stage_chk, clients_tier_chk).
const LIFECYCLE_STAGES = [
  "new_lead", "qualified", "nurturing", "hot_lead", "negotiating", "won",
  "client_active", "client_paused", "client_churned", "client_funded", "client_alumni",
];
const TIERS = ["lead", "standard", "premium", "vip", "internal", "staff", "free"];
const NUMERIC_FIELDS = new Set(["funding_goal", "monthly_revenue"]);
const REQUIRED_TEXT = new Set(["first_name", "last_name"]);

/**
 * Why the contact row would refuse this patch (a column it does not have, a value a check
 * constraint rejects, the wrong type) — or null. Checked when the change is proposed and again
 * before it is applied, so the row update is not the step that fails after the addresses have
 * already been written.
 */
export function clientRowPatchProblem(patch: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(patch)) {
    if (!PROPOSABLE_CLIENT_FIELDS.includes(key)) return `CONTACT_FIELD_FORBIDDEN: ${key}`;
    if (NUMERIC_FIELDS.has(key)) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return `CONTACT_FIELD_INVALID: ${key} must be a number or null`;
    } else if (REQUIRED_TEXT.has(key)) {
      if (typeof value !== "string" || !value.trim()) return `CONTACT_FIELD_INVALID: ${key} must be a non-empty string`;
    } else if (key === "lifecycle_stage") {
      if (typeof value !== "string" || !LIFECYCLE_STAGES.includes(value)) return `CONTACT_FIELD_INVALID: lifecycle_stage must be one of ${LIFECYCLE_STAGES.join(", ")}`;
    } else if (key === "tier") {
      if (value !== null && (typeof value !== "string" || !TIERS.includes(value))) return `CONTACT_FIELD_INVALID: tier must be one of ${TIERS.join(", ")}, or null`;
    } else if (value !== null && typeof value !== "string") {
      return `CONTACT_FIELD_INVALID: ${key} must be a string or null`;
    }
  }
  return null;
}

