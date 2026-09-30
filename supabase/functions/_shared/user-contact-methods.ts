// A platform user's addresses, read from the one place they live.
//
// `user_contact_methods` (migration 20270515000000) is the record of a person's email addresses
// and phone numbers: several of each, exactly one primary per kind. Every user with a sign-in
// address has a primary email — the backfill gave every existing account one and
// `seed_user_contact_methods_from_sign_in` gives every new account one — so "where do I send this
// person mail?" has exactly one answer, and it is here. `profiles` has no email column; code that
// reads `profiles.email` fails with 42703 (undefined_column).
//
// Callers are edge functions that have already decided whose addresses they may read or write;
// the writes below need the service role (authenticated sessions hold SELECT only, and
// set_user_contact_methods is the path a signed-in person uses for their own list). A failed read
// or write THROWS rather than returning an empty answer, because the callers act on the result —
// send mail, or scrub identifiers before publishing text — and an empty answer from a broken read
// is indistinguishable from "this person has no address".

import { type ContactMethodKind, orderedContactMethods } from "./contact-methods.ts";

type Db = { from: (table: string) => any };

type MethodRow = { user_id: string; value: string };

export class ContactMethodsReadError extends Error {
  constructor(cause: unknown) {
    super(`user_contact_methods read failed: ${(cause as { message?: string })?.message ?? String(cause)}`);
    this.name = "ContactMethodsReadError";
  }
}

export class ContactMethodsWriteError extends Error {
  code?: string;
  constructor(cause: unknown) {
    super(`user_contact_methods write failed: ${(cause as { message?: string })?.message ?? String(cause)}`);
    this.name = "ContactMethodsWriteError";
    this.code = (cause as { code?: string })?.code;
  }
}

/**
 * What an EXTERNAL caller (a provider webhook) is told when a person's phone was not saved. The
 * errors above name the table and carry the database's own text, which stays in the function's
 * log; the caller learns only whether the number was refused or could not be written.
 */
export function phoneNotSavedMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  return code === "22023" || code === "23514"
    ? "The phone number was refused: it is not a valid phone number."
    : "The phone number could not be saved.";
}

// A list of user ids is sent in the query string, so a long list is read in slices.
const USER_ID_BATCH = 200;

/** Each user's primary address of one kind, keyed by user id. A user with none of that kind is absent. */
export async function primaryAddressesForUsers(
  db: Db,
  userIds: string[],
  kind: ContactMethodKind,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  for (let start = 0; start < ids.length; start += USER_ID_BATCH) {
    const { data, error } = await db.from("user_contact_methods")
      .select("user_id, value")
      .eq("kind", kind)
      .eq("is_primary", true)
      .in("user_id", ids.slice(start, start + USER_ID_BATCH));
    if (error) throw new ContactMethodsReadError(error);
    for (const row of (data ?? []) as MethodRow[]) {
      if (row?.user_id && row.value) out.set(row.user_id, row.value);
    }
  }
  return out;
}

/** Each user's primary email, keyed by user id. A user with no email method is absent. */
export async function primaryEmailsForUsers(db: Db, userIds: string[]): Promise<Map<string, string>> {
  return await primaryAddressesForUsers(db, userIds, "email");
}

/** Each user's primary phone, keyed by user id. A user with no phone method is absent. */
export async function primaryPhonesForUsers(db: Db, userIds: string[]): Promise<Map<string, string>> {
  return await primaryAddressesForUsers(db, userIds, "phone");
}

/** One user's primary email, or null if they have none. */
export async function primaryEmailForUser(db: Db, userId: string): Promise<string | null> {
  return (await primaryEmailsForUsers(db, [userId])).get(userId) ?? null;
}

/**
 * Every email and phone a user holds, each kind in the owner's display order. Ordering is
 * `orderedContactMethods` from contact-methods.ts — the one reader-order rule for contact methods.
 */
export async function contactMethodsForUser(db: Db, userId: string): Promise<{ emails: string[]; phones: string[] }> {
  const { data, error } = await db.from("user_contact_methods")
    .select("kind, value, label, is_primary, position")
    .eq("user_id", userId);
  if (error) throw new ContactMethodsReadError(error);
  const methods = orderedContactMethods(data);
  return {
    emails: methods.filter((m) => m.kind === "email").map((m) => m.value),
    phones: methods.filter((m) => m.kind === "phone").map((m) => m.value),
  };
}

/**
 * An address as text. A number is a phone number written without formatting (callers' schemas
 * accept one, and the old text column stored it as its digits), so it reads as those digits;
 * anything else that is not a non-blank string reads as no address.
 */
export function phoneOrAddressText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return typeof value === "string" ? value.trim() : "";
}

// Loosely typed like contact-methods.ts's client: each caller's client is a differently
// parameterised SupabaseClient, and a precise rpc signature would reject all of them.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcDb = { rpc: (...args: any[]) => any };

/**
 * Makes `value` the person's primary address of its kind, keeping every address they already
 * hold: one they hold becomes primary, a new one is added as primary, and the previous primary
 * stays on their list. A blank value changes nothing — this never removes an address.
 *
 * ONE database call, public._set_user_primary_address (service role; 20270519005000). It reads the
 * list and moves the primary under the per-person lock set_user_contact_methods takes, so a
 * relabel, reorder or checked save that another session made is never overwritten by a stale copy
 * of the old primary, and two first writes for one person cannot collide.
 */
export async function setUserPrimaryAddress(
  db: RpcDb,
  userId: string,
  kind: ContactMethodKind,
  value: string | number | null | undefined,
): Promise<void> {
  const v = phoneOrAddressText(value);
  if (!userId || !v) return;
  const { error } = await db.rpc("_set_user_primary_address", { _user_id: userId, _kind: kind, _value: v });
  if (error) throw new ContactMethodsWriteError(error);
}

/** Removes every email and phone a person holds — the erasure step of a data-deletion request. */
export async function deleteUserContactMethods(db: Db, userId: string): Promise<void> {
  if (!userId) return;
  const { error } = await db.from("user_contact_methods").delete().eq("user_id", userId);
  if (error) throw new ContactMethodsWriteError(error);
}
