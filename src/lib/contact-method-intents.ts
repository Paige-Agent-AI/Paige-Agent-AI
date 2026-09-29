// An address change as an INTENT — "make X the primary", "add these", "replace the whole list" —
// planned against the list a contact holds at the moment it is written.
//
// This is the browser's copy of the planning half of
// supabase/functions/_shared/paige-mcp/contact-method-edits.ts, the module Paige's MCP
// `propose_client_update` records a proposal with and `confirm_proposal` applies it with. Field
// Ingestion approves the SAME proposals from the browser (src/components/admin/
// applyClientUpdateProposal.ts), so the two must plan identically: the same list for the same
// intent, the same stale rule, the same row-patch refusals. That module is Deno-side and belongs
// to another lane, so it is mirrored here function for function, under the same names, and
// src/lib/contact-method-intents.contract.test.ts pins both to the same fixtures
// (src/lib/contact-method-intents.fixtures.json, produced by running the server's planner). Change
// one, change the other and the fixtures in the same commit.
//
// Pure: no database, no Supabase client.

type ContactMethodKind = "email" | "phone";

/** The key an address is matched on — public.contact_method_match_key. */
function contactMethodMatchKey(kind: ContactMethodKind, value: string): string {
  if (kind === "email") return value.trim().toLowerCase();
  return value.replace(/\D/g, "").slice(-10);
}

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
 * A contact's stored rows in the order the edge planner reads them (orderedContactMethods in
 * supabase/functions/_shared/contact-methods.ts): emails then phones, each by position. Not
 * primary-first — the order here becomes the order written.
 */
export function heldInWriteOrder(
  rows: ReadonlyArray<{ kind: string; value: string; label: string | null; is_primary: boolean; position?: number | null }> | null | undefined,
): ContactMethodInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && (row.kind === "email" || row.kind === "phone") && typeof row.value === "string")
    .slice()
    .sort((a, b) => (a.kind === b.kind ? (a.position ?? 0) - (b.position ?? 0) : a.kind === "email" ? -1 : 1))
    .map(({ kind, value, label, is_primary }) => ({ kind: kind as ContactMethodKind, value, label: label ?? null, is_primary: is_primary === true }));
}

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
 * duplicated; it is only promoted when marked primary. The same rule as
 * public._add_client_contact_methods.
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
  for (const kind of KINDS) {
    const promoted = incoming.find((m) => m.kind === kind && m.is_primary);
    if (!promoted) continue;
    for (const m of merged) if (m.kind === kind) m.is_primary = sameAddress(kind, m.value, promoted.value);
  }
  return settle(merged);
}

/** A list of addresses in the writers' shape, or null. Values are checked by the database. */
function methodList(value: unknown): ContactMethodInput[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const ok = value.every((m) => m && typeof m === "object" && !Array.isArray(m)
    && (m.kind === "email" || m.kind === "phone")
    && typeof m.value === "string"
    && (m.label === undefined || m.label === null || typeof m.label === "string")
    && (m.is_primary === undefined || typeof m.is_primary === "boolean")
    && Object.keys(m).every((k) => k === "kind" || k === "value" || k === "label" || k === "is_primary"));
  return ok ? (value as ContactMethodInput[]) : null;
}

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

/** The list an intent would leave, applied to `current`. */
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
 * right now, from `heldNow`) and the list held now.
 *
 *   add      merge, keeping every address held — including one added a moment ago.
 *   replace  the whole list, checked against the list the change was built on.
 *   primary  the new primary takes the current primary's place, built against the list held now
 *            and checked against the list the change was built on.
 *
 * A proposed replacement or new primary is written only onto the very list its preview was built
 * on. Any difference — an address added or removed since, relabelled, reordered or promoted — could
 * write a result the approver was never shown, so it is refused here as stale, and the database
 * refuses it again under its lock (the write names `builtOn` as the list expected).
 */
export function planAddressWrite(
  intent: AddressIntent,
  builtOn: ReadonlyArray<ContactMethodInput> | null,
  heldNow: ReadonlyArray<ContactMethodInput>,
): AddressWritePlan {
  if (intent.op === "add") return { rpc: "_add_client_contact_methods", methods: intent.methods.map((m) => ({ ...m })) };
  if (builtOn && contactMethodsFingerprint(builtOn) !== contactMethodsFingerprint(heldNow)) {
    return { stale: CONTACT_METHODS_STALE };
  }
  const expected = [...(builtOn ?? heldNow)];
  if (intent.op === "replace") {
    return { rpc: "_replace_client_contact_methods_checked", methods: intent.methods.map((m) => ({ ...m })), expected };
  }
  return { rpc: "_replace_client_contact_methods_checked", methods: intentResult(intent, heldNow), expected };
}

// ─── The contact-row half of a proposed update ───────────────────────────────────────────────

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
 * constraint rejects, the wrong type) — or null. Checked before anything is written, so the row
 * update is not the step that fails after the addresses have already been written.
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
