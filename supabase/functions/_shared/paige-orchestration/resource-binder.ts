// INT-310 C1 — the canonical resource binder for specialist invocation.
//
// A trusted actor (INT-308) answers WHO is acting. This answers the second question: does the
// RESOURCE the caller selected belong to the workspace they are acting in? Every specialist that
// reads a client/contact by id does so with the SERVICE ROLE (RLS bypassed), so the id must be bound
// to the server-resolved tenant BEFORE any specialist sees it.
//
//   server-resolved active tenant + requested contact_id/client_id
//     → verifySubjectTenant (the ONE canonical subject→tenant check, ./subject-tenant.ts)
//     → one normalized bound contact id, rewritten into both input and context
//
// Refusals are deliberately UNIFORM: a malformed id, a missing row, a row with no tenant, a row in
// another tenant, disagreeing selectors and "no workspace to bind to" all return the same
// `resource_not_found`, so a caller can never learn whether a foreign UUID exists (no existence
// oracle). Only an infrastructure lookup error is reported differently, and it reveals nothing about
// the row. The attempted id is never echoed back.

import { type SubjectDb, verifySubjectTenant } from "./subject-tenant.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller-selectable keys that name a client/contact row. Each is read from input AND context. */
const INPUT_SELECTOR_KEYS = ["contact_id", "client_id"] as const;

export type ResourceBinding =
  | { ok: true; contactId: string | null }
  | { ok: false; status: 404 | 503; error: "resource_not_found" | "resource_verification_unavailable" };

const NOT_FOUND = { ok: false, status: 404, error: "resource_not_found" } as const;

/** Every non-empty selector value the caller supplied, from input.contact_id, input.client_id and
 *  context.contact_id. A present-but-non-string value counts (and is refused as malformed). */
export function collectContactSelectors(
  input: Record<string, unknown> | null | undefined,
  context: Record<string, unknown> | null | undefined,
): unknown[] {
  const values: unknown[] = [];
  for (const k of INPUT_SELECTOR_KEYS) {
    const v = input?.[k];
    if (v !== undefined && v !== null && v !== "") values.push(v);
  }
  const c = context?.contact_id;
  if (c !== undefined && c !== null && c !== "") values.push(c);
  return values;
}

/**
 * Bind the caller's contact selector(s) to `tenantId`. No selector → ok with contactId null (nothing to
 * bind; the specialist decides whether it needs one). `db` MUST be the service-role client.
 */
export async function bindContactToTenant(
  db: SubjectDb,
  tenantId: string | null,
  input: Record<string, unknown> | null | undefined,
  context: Record<string, unknown> | null | undefined,
): Promise<ResourceBinding> {
  const selectors = collectContactSelectors(input, context);
  if (selectors.length === 0) return { ok: true, contactId: null };
  const first = selectors[0];
  if (selectors.some((v) => v !== first)) return NOT_FOUND;          // disagreeing selectors
  if (typeof first !== "string" || !UUID_RE.test(first)) return NOT_FOUND; // malformed
  if (!tenantId) return NOT_FOUND;                                     // no workspace to bind to
  const verdict = await verifySubjectTenant(db, "clients", first, tenantId);
  if (verdict.ok) return { ok: true, contactId: first };
  if (verdict.code === "lookup_error") {
    return { ok: false, status: 503, error: "resource_verification_unavailable" };
  }
  return NOT_FOUND; // not found · no tenant · another tenant — indistinguishable by design
}

/** Rewrite every selector the caller used to the ONE bound id (and drop nothing else). */
export function applyBoundContact(
  input: Record<string, unknown>,
  context: Record<string, unknown>,
  contactId: string | null,
): { input: Record<string, unknown>; context: Record<string, unknown> } {
  if (!contactId) return { input, context };
  const nextInput: Record<string, unknown> = { ...input, contact_id: contactId };
  if ("client_id" in input) nextInput.client_id = contactId;
  return { input: nextInput, context: { ...context, contact_id: contactId } };
}
