// A platform user's addresses, read from the one place they live.
//
// `user_contact_methods` (migration 20270515000000) is the record of a person's email addresses
// and phone numbers: several of each, exactly one primary per kind. Every user with a sign-in
// address has a primary email — the backfill gave every existing account one and
// `seed_user_contact_methods_from_sign_in` gives every new account one — so "where do I send this
// person mail?" has exactly one answer, and it is here. `profiles` has no email column; code that
// reads `profiles.email` fails with 42703 (undefined_column).
//
// Service-role reads only: callers are edge functions that have already decided whose addresses
// they may read. A failed read THROWS rather than returning an empty answer, because the callers
// act on the result — send mail, or scrub identifiers before publishing text — and an empty
// answer from a broken read is indistinguishable from "this person has no address".

import { orderedContactMethods } from "./contact-methods.ts";

type Db = { from: (table: string) => any };

type MethodRow = { user_id: string; value: string };

export class ContactMethodsReadError extends Error {
  constructor(cause: unknown) {
    super(`user_contact_methods read failed: ${(cause as { message?: string })?.message ?? String(cause)}`);
    this.name = "ContactMethodsReadError";
  }
}

/** Each user's primary email, keyed by user id. A user with no email method is absent. */
export async function primaryEmailsForUsers(db: Db, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await db.from("user_contact_methods")
    .select("user_id, value")
    .eq("kind", "email")
    .eq("is_primary", true)
    .in("user_id", ids);
  if (error) throw new ContactMethodsReadError(error);
  for (const row of (data ?? []) as MethodRow[]) {
    if (row?.user_id && row.value) out.set(row.user_id, row.value);
  }
  return out;
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
