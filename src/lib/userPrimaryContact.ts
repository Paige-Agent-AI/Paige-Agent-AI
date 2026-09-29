// A platform user's primary email and phone, read from and written to their contact methods
// (`user_contact_methods`). The screens that once read or wrote a single `profiles.work_email` /
// `profiles.phone` go through here, so none of them touches those columns and none of them can
// drop an address the person keeps elsewhere in their list.
//
// Authority is the database's: reads go through RLS (`can_read_user_contact_methods`), writes
// through `set_user_contact_methods`, which re-checks the caller in its body. Nothing here decides
// who may read or change whose details.

import { supabase } from "@/integrations/supabase/client";
import {
  USER_CONTACT_METHODS_SELECT,
  contactMethodMatchKey,
  makePrimary,
  orderContactMethods,
  primaryValue,
  removeContactMethod,
  toContactMethodsPayload,
  toLoadedContactMethodsPayload,
  validateContactMethods,
  type ContactMethod,
  type ContactMethodKind,
  type ContactMethodRow,
} from "@/lib/contact-methods";

export interface UserContactMethodsRead {
  methods: ContactMethod[];
  /** The read failed. Not the same as "none recorded". */
  error: string | null;
}

/** One person's emails and phones, primary first. */
export async function readUserContactMethods(userId: string): Promise<UserContactMethodsRead> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table awaits generated types
  const { data, error } = await (supabase as any)
    .from("user_contact_methods")
    .select(USER_CONTACT_METHODS_SELECT)
    .eq("user_id", userId);
  if (error) return { methods: [], error: error.message || "Couldn't load contact details." };
  return { methods: orderContactMethods(data as ContactMethodRow[] | null), error: null };
}

export interface UserPrimaryAddresses {
  email: string | null;
  phone: string | null;
  error: string | null;
}

/** The person's primary email and primary phone — what `profiles.work_email` / `.phone` used to show. */
export async function readUserPrimaryAddresses(userId: string): Promise<UserPrimaryAddresses> {
  const { methods, error } = await readUserContactMethods(userId);
  return { email: primaryValue(methods, "email"), phone: primaryValue(methods, "phone"), error };
}

let localSeq = 0;

/**
 * Sets the primary address of one kind and leaves every other address where it is. The same rules
 * the database applied when the single profile column was written:
 * - blank → the primary is removed and the next address of that kind becomes primary;
 * - the address the primary already holds → nothing changes;
 * - an address the person already keeps as a secondary → that one becomes primary, the old primary
 *   stays as a secondary;
 * - otherwise the primary's value is replaced, or, with no address of that kind yet, it is added.
 */
export function withPrimaryAddress(methods: readonly ContactMethod[], kind: ContactMethodKind, raw: string | null | undefined): ContactMethod[] {
  const value = (raw ?? "").trim();
  const primary = methods.find((m) => m.kind === kind && m.isPrimary);
  if (!value) return primary ? removeContactMethod(methods, primary.id) : [...methods];
  if (primary?.value === value) return [...methods];
  const key = contactMethodMatchKey(kind, value);
  const same = methods.find((m) => m.kind === kind && contactMethodMatchKey(kind, m.value) === key);
  if (same) return makePrimary(methods, same.id).map((m) => (m.id === same.id ? { ...m, value } : m));
  if (primary) return methods.map((m) => (m.id === primary.id ? { ...m, value } : m));
  const id = `new-${kind}-${Date.now().toString(36)}-${(localSeq += 1)}`;
  return [...methods, { id, kind, value, label: null, isPrimary: true }];
}

const samePayload = (a: readonly ContactMethod[], b: readonly ContactMethod[]) =>
  JSON.stringify(toContactMethodsPayload(a)) === JSON.stringify(toContactMethodsPayload(b));

export type SavePrimaryResult = { ok: true; methods: ContactMethod[]; changed: boolean } | { ok: false; error: string };

/** Why an address can't be saved, in words a person can act on; null when it can (blank = remove). */
function invalidAddress(kind: ContactMethodKind, raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  return validateContactMethods([{ id: "candidate", kind, value, label: null, isPrimary: true }]).candidate ?? null;
}

/**
 * Changes a person's primary email and/or phone and sends the FULL list back through
 * `set_user_contact_methods`, so only the intended entry changes. A kind left out of `changes` is
 * not touched; `null`/blank removes that primary.
 *
 * The list the change is built on is also the list the save names as the one it replaces
 * (`p_expected`); the server refuses the save (CONTACT_METHODS_STALE) if what it stores is no longer
 * that list. Pass `loaded` — the list the screen read and showed — so an edit made anywhere else
 * since then is refused rather than overwritten. Without it, the list is read here, just before.
 */
export async function saveUserPrimaryAddresses(
  userId: string,
  changes: Partial<Record<ContactMethodKind, string | null>>,
  loaded?: readonly ContactMethod[],
): Promise<SavePrimaryResult> {
  for (const kind of ["email", "phone"] as const) {
    const invalid = kind in changes ? invalidAddress(kind, changes[kind]) : null;
    if (invalid) return { ok: false, error: invalid };
  }
  let base: ContactMethod[];
  if (loaded) {
    base = [...loaded];
  } else {
    const current = await readUserContactMethods(userId);
    // Never write a list built on a read that failed: it would replace what the person has with nothing.
    if (current.error) return { ok: false, error: current.error };
    base = current.methods;
  }
  let next: ContactMethod[] = base;
  for (const kind of ["email", "phone"] as const) {
    if (kind in changes) next = withPrimaryAddress(next, kind, changes[kind]);
  }
  if (samePayload(next, base)) return { ok: true, methods: base, changed: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC awaits generated types
  const { data, error } = await (supabase as any).rpc("set_user_contact_methods", {
    p_user_id: userId,
    p_methods: toContactMethodsPayload(next),
    p_expected: toLoadedContactMethodsPayload(base),
  });
  if (error) return { ok: false, error: error.message || "Couldn't save contact details." };
  // What the server stored, never what was typed: callers show this.
  return { ok: true, methods: orderContactMethods(Array.isArray(data) ? (data as ContactMethodRow[]) : []), changed: true };
}
