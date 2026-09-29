// Contact methods: the several emails and phones a client contact or a platform user holds,
// labelled and ordered, exactly one primary of each kind. The database enforces the rules
// (supabase/migrations/20270515000000_contact_methods.sql); this module mirrors them so a person
// sees the problem on the row before they save, and shapes what the screens send and read.

export type ContactMethodKind = "email" | "phone";

export interface ContactMethod {
  /** Stable key for the screen. A saved row's database id, or a local id for a new row. */
  id: string;
  kind: ContactMethodKind;
  value: string;
  label: string | null;
  isPrimary: boolean;
}

/** A row as `client_contact_methods` / `user_contact_methods` return it. */
export interface ContactMethodRow {
  id: string;
  kind: string;
  value: string;
  label: string | null;
  is_primary: boolean;
  position: number;
}

/** The embed a `clients` / `profiles` select adds to read a record's methods. */
export const CLIENT_CONTACT_METHODS_EMBED = "client_contact_methods(id,kind,value,label,is_primary,position)";
export const USER_CONTACT_METHODS_SELECT = "id,user_id,kind,value,label,is_primary,position";

export const CONTACT_METHOD_LABELS: Record<ContactMethodKind, readonly string[]> = {
  email: ["Work", "Personal", "Billing", "Other"],
  phone: ["Mobile", "Work", "Home", "Other"],
};

/** The database's own limit per kind (contact_methods_canonical). */
export const CONTACT_METHODS_PER_KIND = 20;

/** Primary first, then the order the person set. Every screen reads methods through this. */
export function orderContactMethods(rows: readonly ContactMethodRow[] | null | undefined): ContactMethod[] {
  return [...(rows ?? [])]
    .filter((row): row is ContactMethodRow & { kind: ContactMethodKind } => row.kind === "email" || row.kind === "phone")
    .sort((a, b) => a.kind.localeCompare(b.kind) || Number(b.is_primary) - Number(a.is_primary) || a.position - b.position)
    .map((row) => ({ id: row.id, kind: row.kind, value: row.value, label: row.label, isPrimary: row.is_primary }));
}

export const methodsOfKind = (methods: readonly ContactMethod[], kind: ContactMethodKind) =>
  methods.filter((method) => method.kind === kind);

export const primaryValue = (methods: readonly ContactMethod[], kind: ContactMethodKind): string | null =>
  methods.find((method) => method.kind === kind && method.isPrimary)?.value ?? null;

/** The key a method is matched and de-duplicated on, exactly as the database computes it. */
export function contactMethodMatchKey(kind: ContactMethodKind, value: string): string {
  return kind === "email" ? value.trim().toLowerCase() : value.replace(/\D/g, "").slice(-10);
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Row-level problems, keyed by method id. Mirrors contact_methods_canonical so the refusal a
 * person would get from the server shows on the row first; the server still decides.
 */
export function validateContactMethods(methods: readonly ContactMethod[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const kind of ["email", "phone"] as const) {
    const seen = new Set<string>();
    for (const method of methodsOfKind(methods, kind)) {
      const value = method.value.trim();
      const digits = value.replace(/\D/g, "").length;
      if (!value) errors[method.id] = kind === "email" ? "Enter an email address, or remove this row." : "Enter a phone number, or remove this row.";
      else if (kind === "email" && (value.length > 254 || !EMAIL_SHAPE.test(value))) errors[method.id] = "That isn't a complete email address.";
      else if (kind === "phone" && (value.length > 40 || digits < 7 || digits > 15)) errors[method.id] = "A phone number needs 7 to 15 digits.";
      else if (seen.has(contactMethodMatchKey(kind, value))) errors[method.id] = "Already listed above.";
      if (value) seen.add(contactMethodMatchKey(kind, value));
    }
  }
  return errors;
}

/** What `upsert_contact` (contact_methods) and `set_user_contact_methods` take: the full list, in order. */
export function toContactMethodsPayload(methods: readonly ContactMethod[]) {
  return (["email", "phone"] as const).flatMap((kind) =>
    methodsOfKind(methods, kind).map((method) => ({
      kind,
      value: method.value.trim(),
      label: method.label?.trim() || null,
      is_primary: method.isPrimary,
    })),
  );
}

/** Makes `id` the primary of its kind and moves it to the top; the previous primary steps down. */
export function makePrimary(methods: readonly ContactMethod[], id: string): ContactMethod[] {
  const target = methods.find((method) => method.id === id);
  if (!target) return [...methods];
  const others = methods.filter((method) => method.kind === target.kind && method.id !== id);
  return [
    ...methods.filter((method) => method.kind !== target.kind),
    { ...target, isPrimary: true },
    ...others.map((method) => ({ ...method, isPrimary: false })),
  ];
}

/** Removes a row; if it was the primary, the next address of that kind becomes primary. */
export function removeContactMethod(methods: readonly ContactMethod[], id: string): ContactMethod[] {
  const gone = methods.find((method) => method.id === id);
  if (!gone) return [...methods];
  const rest = methods.filter((method) => method.id !== id);
  if (!gone.isPrimary) return rest;
  const next = rest.find((method) => method.kind === gone.kind);
  return next ? makePrimary(rest, next.id) : rest;
}

/** Moves a secondary up or down among the secondaries of its kind. The primary stays first. */
export function moveContactMethod(methods: readonly ContactMethod[], id: string, delta: -1 | 1): ContactMethod[] {
  const target = methods.find((method) => method.id === id);
  if (!target || target.isPrimary) return [...methods];
  const ofKind = methodsOfKind(methods, target.kind);
  const from = ofKind.findIndex((method) => method.id === id);
  const to = from + delta;
  if (to < 1 || to >= ofKind.length || ofKind[to].isPrimary) return [...methods];
  const reordered = [...ofKind];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  return [...methods.filter((method) => method.kind !== target.kind), ...reordered];
}

let localSeq = 0;
/** Appends an empty row. The first address of a kind is its primary. */
export function addContactMethod(methods: readonly ContactMethod[], kind: ContactMethodKind): { methods: ContactMethod[]; id: string } {
  const ofKind = methodsOfKind(methods, kind);
  const labels = CONTACT_METHOD_LABELS[kind];
  const id = `new-${kind}-${Date.now().toString(36)}-${(localSeq += 1)}`;
  const row: ContactMethod = { id, kind, value: "", label: labels[Math.min(ofKind.length, labels.length - 1)], isPrimary: ofKind.length === 0 };
  return { methods: [...methods.filter((method) => method.kind !== kind), ...ofKind, row], id };
}

/**
 * Maps a server refusal to the row it concerns, so it lands where the person is looking.
 * The database names the offending value (CONTACT_METHOD_TAKEN / _INVALID_* / _DUPLICATE).
 */
export function contactMethodErrorFor(methods: readonly ContactMethod[], message: string): { id: string; text: string } | null {
  const match = /CONTACT_METHOD_(TAKEN|INVALID_EMAIL|INVALID_PHONE|DUPLICATE):\s*(.+?)(?:\s+already belongs.*)?$/.exec(message);
  if (!match) return null;
  const [, code, value] = match;
  // The server names the LATER of two equal addresses, so the last match is the row it means.
  const target = [...methods].reverse().find((method) => method.value.trim().toLowerCase() === value.trim().toLowerCase());
  if (!target) return null;
  const text = code === "TAKEN"
    ? "Another contact in this workspace already uses this address. Remove it here, or remove it from that contact first."
    : code === "DUPLICATE" ? "Already listed above." : code === "INVALID_EMAIL" ? "That isn't a complete email address." : "A phone number needs 7 to 15 digits.";
  return { id: target.id, text };
}

/** The number carriers need: E.164. Only formatting is removed — never a guessed country code. */
export function e164Of(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
