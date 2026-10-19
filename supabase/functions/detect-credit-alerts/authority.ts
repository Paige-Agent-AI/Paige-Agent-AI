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
//   3. The subject is STAFF of that business — an active `tenant_members` row there whose role is one
//      of `CREDIT_STAFF_ROLES` (owner/admin) — never one of its portal customers. A customer-only
//      login, or a member of some other business who is a customer here, is refused: customer-tier
//      credit alerts are not authorized (plan Q4). An active seat with the limited `member` permission
//      (minted by the team invitation, `accept_solo_team_invite`) is a team seat but not credit staff:
//      the plan's staff definition (§3.1(i), `_credit_subject_staff_entitled`) excludes it, and H0 must
//      not authorize more than F1a will. Production holds 0 active `member` rows (2026-10-19). The plan
//      also lists the third value it names, but that title value is retired from every role and seat
//      column (20270508000000, validated by 20270511000000), so no row can hold it: owner/admin is the
//      whole set the plan's definition can match.
//
// Every refusal is a reason code. Nothing here inserts, pushes or emails.

import { resolveFinanceEntitlement, type FundingGateDb } from "../_shared/funding-coaching-gate.ts";

export type CreditAlertSkipReason =
  | "no_single_business"
  | "business_not_finance_entitled"
  | "subject_is_portal_customer"
  | "subject_not_credit_staff";

export type CreditAlertAuthority =
  | { ok: true; tenantId: string }
  | { ok: false; kind: "skip"; reason: CreditAlertSkipReason; businesses?: number }
  | { ok: false; kind: "error"; status: 500 | 503; reason: string };

// deno-lint-ignore no-explicit-any
type Db = FundingGateDb & { from: (table: string) => any };

/** The `tenant_role` values that count as a business's credit staff (plan §3.1(i), less the retired title value). */
export const CREDIT_STAFF_ROLES = ["owner", "admin"] as const;

export type StaffStanding = "staff" | "limited_seat" | "not_member" | "read_error";

/**
 * Where `userId` stands in `tenantId`'s team: an active seat with a credit-staff role, an active seat
 * without one, no active seat at all, or the read failed (callers fail closed on `read_error`).
 */
export async function staffStanding(db: Db, tenantId: string, userId: string): Promise<StaffStanding> {
  const { data, error } = await db
    .from("tenant_members")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) return "read_error";
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return "not_member";
  const staff = rows.some((r: { role?: unknown }) =>
    (CREDIT_STAFF_ROLES as readonly string[]).includes(String(r.role))
  );
  return staff ? "staff" : "limited_seat";
}

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

  // (3) Credit staff of THIS business, not one of its customers.
  const standing = await staffStanding(db, tenantId, subjectUserId);
  if (standing === "read_error") return { ok: false, kind: "error", status: 500, reason: "membership_lookup_failed" };
  if (standing === "not_member") return { ok: false, kind: "skip", reason: "subject_is_portal_customer" };
  if (standing === "limited_seat") return { ok: false, kind: "skip", reason: "subject_not_credit_staff" };

  return { ok: true, tenantId };
}
