// send-push-notification/finance-categories.ts — the credit/funding push categories reach only staff
// of a finance-entitled business (E09 F1b).
//
// Owner direction B (2026-10-19): funding and credit are not standard features of any business, and
// they are never a customer feature. The three categories below are pushed only when
//   1. the sending business (`tenant_id`) is finance-entitled — the canonical per-business predicate,
//      read through `_shared/finance-entitlement.ts`; and
//   2. the recipient holds an active seat in that business (staff), so a portal customer — who holds
//      none — never receives one.
// Anything else answers `{ skipped: "not_entitled", reason }` with nothing sent and nothing logged. A
// read error refuses too (fail closed). Every other category (task_reminders, comms_inbox, general…)
// is untouched.

import { financeEntitled, type FinanceReadDb } from "../_shared/finance-entitlement.ts";

export const FINANCE_PUSH_CATEGORIES = ["dispute_updates", "funding_matches", "credit_score_changes"] as const;

export type FinancePushSkip = {
  skipped: "not_entitled";
  reason: "business_not_entitled" | "recipient_not_business_staff" | "entitlement_unavailable";
};

export function isFinancePushCategory(category: unknown): boolean {
  return typeof category === "string" && (FINANCE_PUSH_CATEGORIES as readonly string[]).includes(category);
}

/** null = may send; otherwise the skip answer. Only finance categories are ever refused here. */
export async function financePushGate(
  db: FinanceReadDb,
  req: { tenant_id: string; user_id: string; category: string },
): Promise<FinancePushSkip | null> {
  if (!isFinancePushCategory(req.category)) return null;
  const e = await financeEntitled(db, req.tenant_id);
  if (e === "read_error") return { skipped: "not_entitled", reason: "entitlement_unavailable" };
  if (e !== "entitled") return { skipped: "not_entitled", reason: "business_not_entitled" };
  try {
    const { data, error } = await db
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", req.tenant_id)
      .eq("user_id", req.user_id)
      .eq("status", "active");
    if (error) return { skipped: "not_entitled", reason: "entitlement_unavailable" };
    if (!Array.isArray(data) || data.length === 0) return { skipped: "not_entitled", reason: "recipient_not_business_staff" };
    return null;
  } catch (e) {
    console.error("send-push-notification: recipient seat read threw", String(e));
    return { skipped: "not_entitled", reason: "entitlement_unavailable" };
  }
}
