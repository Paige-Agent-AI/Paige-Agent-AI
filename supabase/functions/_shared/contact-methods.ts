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
 * contact holding this email, in any workspace" (the MMA OS bridge verbs). Same reach, same rule;
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
