// Contact methods — the one home for how an edge function finds a contact by an address.
//
// A contact holds several email addresses and phone numbers (public.client_contact_methods,
// 20270515000000), exactly one primary of each kind. A sender writing from ANY of them is that
// contact. Every edge function that recognises a person from an address goes through here, so
// "which contact is this?" has one answer platform-wide.
//
// Pure: no Deno imports, the database client is injected, so vitest exercises it directly
// (src/__tests__/contact-methods-edge.test.ts).

export type ContactMethodKind = "email" | "phone";

export interface ContactMethod {
  kind: ContactMethodKind;
  value: string;
  label: string | null;
  is_primary: boolean;
  position: number;
}

// The minimum of a Supabase client these helpers use (rpc + from), injected so they stay
// testable. Loosely typed on purpose: every caller's client is a differently-parameterised
// SupabaseClient, and a precise signature would reject all of them.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { rpc: (...args: any[]) => any; from: (...args: any[]) => any };

/**
 * The key an address is matched on — the same rule as public.contact_method_match_key:
 * an email by its trimmed lower-case form, a phone by its last ten digits.
 */
export function contactMethodMatchKey(kind: ContactMethodKind, value: string): string {
  if (kind === "email") return value.trim().toLowerCase();
  return value.replace(/\D/g, "").slice(-10);
}

/** An address worth looking up: a plausible email, or a phone with at least seven digits. */
export function isMatchableAddress(kind: ContactMethodKind, value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  if (kind === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
  return value.replace(/\D/g, "").length >= 7;
}

/** The primary value of a kind from a contact's methods, or null when it holds none. */
export function primaryContactMethod(
  methods: ReadonlyArray<Pick<ContactMethod, "kind" | "value" | "is_primary">> | null | undefined,
  kind: ContactMethodKind,
): string | null {
  return methods?.find((method) => method.kind === kind && method.is_primary)?.value ?? null;
}

/**
 * A contact's methods as a reader should see them: emails then phones, each in the owner's display
 * order, carrying which one is primary. Accepts the rows of an embedded `client_contact_methods`
 * select; anything else reads as no methods.
 */
export function orderedContactMethods(rows: unknown): Array<Omit<ContactMethod, "position">> {
  if (!Array.isArray(rows)) return [];
  return (rows as ContactMethod[])
    .filter((row) => row && (row.kind === "email" || row.kind === "phone") && typeof row.value === "string")
    .sort((a, b) => (a.kind === b.kind ? (a.position ?? 0) - (b.position ?? 0) : a.kind === "email" ? -1 : 1))
    .map(({ kind, value, label, is_primary }) => ({ kind, value, label: label ?? null, is_primary: is_primary === true }));
}

/**
 * The contact an address identifies inside ONE workspace, whichever of that contact's addresses
 * it is — or null. A lookup failure is logged loudly and reads as "not found", never as a match.
 */
export async function findClientIdByAddress(
  admin: Client,
  tenantId: string,
  kind: ContactMethodKind,
  value: string | null | undefined,
  caller: string,
): Promise<string | null> {
  if (!tenantId || !isMatchableAddress(kind, value)) return null;
  const { data, error } = await admin.rpc("client_id_for_address", { _tenant_id: tenantId, _kind: kind, _value: value });
  if (error) {
    console.error(`[${caller}] contact_address_lookup_failed`, { kind, code: error.code, message: error.message });
    return null;
  }
  return typeof data === "string" ? data : null;
}

/**
 * The contact an email identifies when the caller does not know the workspace (a provider
 * webhook keyed only on an email). This keeps the reach those callers already had — every
 * workspace — and their rule that an ambiguous address is no match: it answers only when
 * exactly one contact anywhere holds the address. Narrowing that reach is recorded as its own
 * item; it is not changed here.
 */
export async function findSoleClientByEmailAnyWorkspace(
  admin: Client,
  email: string | null | undefined,
  caller: string,
): Promise<{ id: string; tenant_id: string } | null> {
  const rows = await emailHoldersAnyWorkspace(admin, email, 2, caller);
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Like findSoleClientByEmailAnyWorkspace, for the callers whose existing rule is "the first
 * contact holding this email, in any workspace" (the paige-bridge verbs). Same reach, same rule;
 * narrowing it is recorded as its own item.
 */
export async function findFirstClientByEmailAnyWorkspace(
  admin: Client,
  email: string | null | undefined,
  caller: string,
): Promise<{ id: string; tenant_id: string } | null> {
  return (await emailHoldersAnyWorkspace(admin, email, 1, caller))[0] ?? null;
}

async function emailHoldersAnyWorkspace(
  admin: Client,
  email: string | null | undefined,
  limit: number,
  caller: string,
): Promise<Array<{ id: string; tenant_id: string }>> {
  if (!isMatchableAddress("email", email)) return [];
  const { data, error } = await admin
    .from("client_contact_methods")
    .select("client_id, tenant_id")
    .eq("kind", "email")
    .eq("match_key", contactMethodMatchKey("email", email))
    .limit(limit);
  if (error) {
    console.error(`[${caller}] contact_address_lookup_failed`, { kind: "email", code: error.code, message: error.message });
    return [];
  }
  return ((data ?? []) as Array<{ client_id: string; tenant_id: string }>)
    .map((row) => ({ id: row.client_id, tenant_id: row.tenant_id }));
}

// ─── Reading a contact's addresses alongside the contact ────────────────────────────────────────
// `clients` holds no address. A reader selects the contact's methods in the same query through the
// embed below (the composite foreign key client_id,tenant_id gives PostgREST the relationship) and
// reads the primary of each kind from them.

/** The PostgREST embed that brings a contact's addresses back with the contact row. */
export const CLIENT_CONTACT_METHODS_EMBED = "client_contact_methods(kind,value,label,is_primary,position)";

/** A contact's addresses read from its embedded methods: the primary of each kind, and every one. */
export function clientAddresses(
  row: { client_contact_methods?: unknown } | null | undefined,
): { email: string | null; phone: string | null; emails: string[]; phones: string[] } {
  const methods = orderedContactMethods(row?.client_contact_methods);
  return {
    email: primaryContactMethod(methods, "email"),
    phone: primaryContactMethod(methods, "phone"),
    emails: methods.filter((m) => m.kind === "email").map((m) => m.value),
    phones: methods.filter((m) => m.kind === "phone").map((m) => m.value),
  };
}

/**
 * A contact row read with CLIENT_CONTACT_METHODS_EMBED, reshaped for readers that expect a single
 * `email` / `phone`: the embed is dropped and the contact's PRIMARY email and phone take its place.
 */
export function withPrimaryAddresses<T extends { client_contact_methods?: unknown }>(
  row: T | null | undefined,
): (Omit<T, "client_contact_methods"> & { email: string | null; phone: string | null }) | null {
  if (!row) return null;
  const { client_contact_methods: _methods, ...rest } = row;
  const { email, phone } = clientAddresses(row);
  return { ...rest, email, phone };
}

// ─── Writing a contact's addresses ──────────────────────────────────────────────────────────────

export type AddressWriteError = { code?: string; message: string };

/**
 * Adds addresses to a contact through public._add_client_contact_methods (service role): an
 * address the contact already holds is not duplicated, a new one becomes primary when marked so or
 * when the contact held none of its kind, and no address the contact holds is ever removed.
 * Blank values are skipped. A failure is logged loudly and returned, never swallowed.
 */
export async function addClientAddresses(
  admin: Client,
  tenantId: string,
  clientId: string,
  methods: ReadonlyArray<{ kind: ContactMethodKind; value: string | null | undefined; is_primary?: boolean }>,
  caller: string,
): Promise<{ error: AddressWriteError | null }> {
  const list = methods
    .filter((m) => typeof m.value === "string" && m.value.trim() !== "")
    .map((m) => ({ kind: m.kind, value: (m.value as string).trim(), ...(m.is_primary ? { is_primary: true } : {}) }));
  if (list.length === 0) return { error: null };
  if (!tenantId || !clientId) {
    const error = { code: "22023", message: "a contact's addresses need its workspace and its id" };
    console.error(`[${caller}] contact_address_write_failed`, error);
    return { error };
  }
  const { error } = await admin.rpc("_add_client_contact_methods", {
    _tenant_id: tenantId,
    _client_id: clientId,
    _methods: list,
  });
  if (error) {
    console.error(`[${caller}] contact_address_write_failed`, { code: error.code, message: error.message });
    return { error: { code: error.code, message: error.message } };
  }
  return { error: null };
}

/**
 * Creates a contact from its first addresses in ONE database transaction, through
 * public._create_client_with_contact_methods (service role; 20270519005000). Either the contact
 * exists holding its addresses, or nothing was written: no `clients` row, and none of what that
 * row's insert triggers write (the `contact.created` event and its queued dispatch). An address
 * another contact in the workspace already holds fails the create with code 23505, one the
 * database refuses with 22023 — the caller sees one failed create, never a contact that silently
 * lost the address it was created from, and never an event for a contact that does not exist.
 *
 * `row` carries the contact's `clients` columns and its workspace (`tenant_id`, resolved by the
 * trusted caller); it never carries an address.
 */
export async function insertClientWithAddresses(
  admin: Client,
  row: Record<string, unknown> & { tenant_id: string },
  addresses: { email?: string | null; phone?: string | null },
  caller: string,
): Promise<{ data: { id: string } | null; error: AddressWriteError | null }> {
  const methods = ([["email", addresses.email], ["phone", addresses.phone]] as const)
    .filter((entry): entry is readonly [ContactMethodKind, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
    .map(([kind, value]) => ({ kind, value: value.trim() }));
  return await createClientWithContactMethods(admin, row, methods, caller);
}

/**
 * The same one-transaction create as insertClientWithAddresses, for a caller that already holds
 * the contact's whole first list — several addresses of a kind, labels, a marked primary (Paige's
 * MCP create_contact). The list goes to the database as given; the database refuses a bad shape,
 * a duplicate, two primaries of a kind, or an address another contact holds, and then nothing —
 * no contact, no event — is written.
 */
export async function createClientWithContactMethods(
  admin: Client,
  row: Record<string, unknown> & { tenant_id: string },
  methods: ReadonlyArray<{ kind: ContactMethodKind; value: string; label?: string | null; is_primary?: boolean }>,
  caller: string,
): Promise<{ data: { id: string } | null; error: AddressWriteError | null }> {
  if ("email" in row || "phone" in row) {
    const error = { code: "22023", message: "a contact's addresses are contact methods, not clients columns" };
    console.error(`[${caller}] contact_insert_error`, error);
    return { data: null, error };
  }
  const { tenant_id: tenantId, ...fields } = row;
  if (!tenantId) {
    const error = { code: "23502", message: "a contact belongs to a workspace" };
    console.error(`[${caller}] contact_insert_error`, error);
    return { data: null, error };
  }
  const { data, error } = await admin.rpc("_create_client_with_contact_methods", {
    _tenant_id: tenantId,
    _client: fields,
    _methods: methods,
  });
  if (error || typeof data !== "string" || data === "") {
    const failure = { code: error?.code, message: error?.message ?? "the contact create returned no id" };
    console.error(`[${caller}] contact_insert_error`, failure);
    return { data: null, error: failure };
  }
  return { data: { id: data }, error: null };
}
