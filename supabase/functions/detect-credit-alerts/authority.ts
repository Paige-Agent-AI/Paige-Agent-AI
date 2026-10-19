// detect-credit-alerts/authority.ts — may this function alert this subject, for which business?
//
// Before E09 H0 the function trusted `client_id` from the body, under any bearer the gateway accepts
// (the public anon key included), and wrote, pushed and emailed credit alerts signed with a business's
// brand. Direction B (owner, 2026-10-19): no credit alert without the business's entitlement and the
// right subject. The rule, resolved on the server from the subject alone:
//
//   1. EXACTLY ONE business. The subject's business comes from `clients.linked_user_id` (the resolution
//      the function already used for push and branding). Zero or several → refused, nothing written.
//   2. The business is FINANCE-ENTITLED by the canonical per-business expression — an active install of
//      an `is_finance` Marketplace item OR `tenants.features.finance_in_scope` — read through the one
//      TS reader (`resolveFinanceEntitlement`, `_shared/funding-coaching-gate.ts`), which mirrors the SQL
//      in `get_paige_persona_context`. A read error fails closed.
//   3. The subject is STAFF of that business (an active `tenant_members` row there), never one of its
//      portal customers. A customer-only login, or a member of some other business who is a customer
//      here, is refused: customer-tier credit alerts are not authorized (plan Q4).
//
// Every refusal is a reason code. Nothing here inserts, pushes or emails.

import { resolveFinanceEntitlement, type FundingGateDb } from "../_shared/funding-coaching-gate.ts";

export type CreditAlertSkipReason =
  | "no_single_business"
  | "business_not_finance_entitled"
  | "subject_is_portal_customer";

export type CreditAlertAuthority =
  | { ok: true; tenantId: string }
  | { ok: false; kind: "skip"; reason: CreditAlertSkipReason; businesses?: number }
  | { ok: false; kind: "error"; status: 500 | 503; reason: string };

// deno-lint-ignore no-explicit-any
type Db = FundingGateDb & { from: (table: string) => any };

export async function authorizeCreditAlertSubject(db: Db, subjectUserId: string): Promise<CreditAlertAuthority> {
  // (1) The subject's business, from the subject.
  const { data: rows, error: clientErr } = await db
    .from("clients")
    .select("tenant_id")
    .eq("linked_user_id", subjectUserId);
  if (clientErr) return { ok: false, kind: "error", status: 500, reason: "business_lookup_failed" };
  const businesses = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((r: { tenant_id?: unknown }) => r.tenant_id)
      .filter((t: unknown): t is string => typeof t === "string" && t.length > 0),
  );
  if (businesses.size !== 1) {
    return { ok: false, kind: "skip", reason: "no_single_business", businesses: businesses.size };
  }
  const [tenantId] = [...businesses];

  // (2) The business's own entitlement, through the canonical reader.
  const entitlement = await resolveFinanceEntitlement(db, tenantId);
  if (entitlement === "read_error") {
    return { ok: false, kind: "error", status: 503, reason: "entitlement_unavailable" };
  }
  if (entitlement !== "entitled") return { ok: false, kind: "skip", reason: "business_not_finance_entitled" };

  // (3) Staff of THIS business, not one of its customers.
  const { data: staff, error: staffErr } = await db
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", subjectUserId)
    .eq("status", "active")
    .limit(1);
  if (staffErr) return { ok: false, kind: "error", status: 500, reason: "membership_lookup_failed" };
  if (!Array.isArray(staff) || staff.length === 0) {
    return { ok: false, kind: "skip", reason: "subject_is_portal_customer" };
  }

  return { ok: true, tenantId };
}
