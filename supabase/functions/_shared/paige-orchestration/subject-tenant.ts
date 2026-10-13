// Paige Runtime Harness — Layer C: INDEPENDENT event-integrity check (owner correction #2, 2026-09-13).
//
// The native-event dispatcher already takes the tenant from the CLAIMED event row, never a request body
// (§9). This is a second, independent line: it re-derives the tenant from the canonical SUBJECT record the
// event points at (`subject_table` + `subject_id`) and asserts it equals the tenant the event row claims.
//
// WHY. The event row's `tenant_id` is written by a producer (a trigger, a sweeper). If a producer ever wrote
// a subject whose real owner differs from the tenant it stamped — a bug, a mis-wired future producer, a
// poisoned insert — the dispatcher would otherwise run governed acts under the WRONG tenant. This check makes
// that unrunnable: on any mismatch, missing subject, or unrecognised subject table it FAILS CLOSED, and the
// dispatcher records the truthful failure and makes NO authority, adapter, or provider decision.
//
// The read is intentionally UNSCOPED (the service-role drainer bypasses RLS) — reading the subject's ACTUAL
// tenant is the whole point of an independent check; scoping the read to the claimed tenant would only prove
// the claim against itself.

/** The minimal supabase-js surface this needs — keeps it unit-provable without importing the SDK type. */
export type SubjectDb = { from: (t: string) => any };

export type SubjectTenantVerdict =
  | { ok: true; tenantId: string }
  | {
      ok: false;
      code:
        | "unknown_subject_table"  // no registered tenant column for this subject table — fail closed
        | "subject_not_found"      // the subject row does not exist (deleted? never committed?) — fail closed
        | "subject_tenant_null"    // the subject has no tenant — cannot verify — fail closed
        | "subject_tenant_mismatch"// the subject's real tenant differs from the claimed event tenant
        | "lookup_error";          // the subject read itself errored — fail closed, retryable
      reason: string;
    };

/**
 * subject_table → the column on that table that holds its owning tenant. A subject table that is NOT listed
 * fails closed: a NEW event producer must register its subject's tenant column here before its events can be
 * governed. `contact.created` (the only live producer) has subject_table `clients`, whose tenant column is
 * `tenant_id`. The subject row is addressed by its primary key `id` (the producer sets `subject_id = NEW.id`).
 */
const SUBJECT_TENANT_COLUMN: Readonly<Record<string, string>> = {
  clients: "tenant_id",
  paige_automations: "tenant_id",
};

/** Which subject tables Layer C can currently verify — exported so a test can assert the registry's shape. */
export function registeredSubjectTables(): readonly string[] {
  return Object.keys(SUBJECT_TENANT_COLUMN);
}

/**
 * Re-derive the subject's owning tenant and assert it equals `claimedTenantId`. Fails closed on every
 * anomaly. `db` MUST be a service-role client (the read is deliberately unscoped).
 */
export async function verifySubjectTenant(
  db: SubjectDb,
  subjectTable: string,
  subjectId: string,
  claimedTenantId: string,
): Promise<SubjectTenantVerdict> {
  const column = SUBJECT_TENANT_COLUMN[subjectTable];
  if (!column) {
    return {
      ok: false,
      code: "unknown_subject_table",
      reason: `subject table '${subjectTable}' has no registered tenant column; failing closed`,
    };
  }

  const { data, error } = await db
    .from(subjectTable)
    .select(column)
    .eq("id", subjectId)
    .limit(1);

  if (error) {
    return { ok: false, code: "lookup_error", reason: `subject lookup failed: ${error.message ?? String(error)}` };
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return { ok: false, code: "subject_not_found", reason: `subject ${subjectTable}:${subjectId} not found` };
  }
  const actual = (rows[0] as Record<string, unknown>)[column];
  if (actual == null) {
    return { ok: false, code: "subject_tenant_null", reason: `subject ${subjectTable}:${subjectId} has no tenant` };
  }
  if (actual !== claimedTenantId) {
    // Deliberately do NOT embed the SUBJECT's (foreign) tenant id in the reason: this string flows to
    // paige_native_events.last_error, which the CLAIMED tenant can read (pne_tenant_read). The `code` is
    // enough signal for ops; surfacing another tenant's id to the claimed tenant is avoided (§9, §39 NIT).
    return {
      ok: false,
      code: "subject_tenant_mismatch",
      reason: `the event's subject is owned by a different tenant than the event claims`,
    };
  }
  return { ok: true, tenantId: claimedTenantId };
}
