// _shared/finance-entitlement.ts — THE one edge reader of the per-business finance entitlement, and
// the credit-path caller checks that sit beside it (E09 F1b).
//
// WHAT "ENTITLED" MEANS. Exactly what the database says: `public._tenant_finance_entitled(tenant)`
// (migration 20271111030000) — an ACTIVE install of an `is_finance` Marketplace item OR
// `tenants.features.finance_in_scope`, the expression get_paige_persona_context has used since
// 20260805130000. This module never re-derives it. Before F1b four edge readers each held their own
// copy (funding-coaching-gate's two-leg read, and three flag-only reads in client-context,
// paige-public-chat and growth-page-draft); they now all call this, so the edge and the database
// cannot disagree. The drift test `finance-entitlement.drift.test.ts` pins this file to the SQL.
//
// Per business, never global (owner direction B, 2026-10-19). New businesses are not entitled: the
// predicate is false until a deliberate Marketplace install (both legs are guarded against
// self-grant in the same migration).
//
// FAIL CLOSED. A read error is `read_error`, never `entitled`; a missing tenant id is `read_error`.
//
// THE CALLER CHECKS. Credit paths refuse a CUSTOMER-tier caller (a login that is some business's
// linked client and holds no active seat anywhere — `_user_is_portal_customer_only`), and refuse
// cross-business action unless the caller is staff of the subject's business or the platform owner.
// Staff of a business that is NOT entitled keep their own credit work: the owner has not ruled on
// that (Q5), so nothing here gates staff on the entitlement unless a caller asks for it explicitly
// with `requireFinanceEntitlement`.

/** The minimal service-role client surface: one RPC. */
export type FinanceRpcDb = {
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export type FinanceEntitlement = "entitled" | "not_entitled" | "read_error";

/** Read the canonical per-business entitlement through the service client. */
export async function financeEntitled(db: FinanceRpcDb, tenantId: string | null | undefined): Promise<FinanceEntitlement> {
  if (!tenantId) return "read_error";
  try {
    const { data, error } = await db.rpc("_tenant_finance_entitled", { _tenant: tenantId });
    if (error) {
      console.error("finance-entitlement: _tenant_finance_entitled failed", error.message ?? String(error));
      return "read_error";
    }
    return data === true ? "entitled" : "not_entitled";
  } catch (e) {
    console.error("finance-entitlement: _tenant_finance_entitled threw", String(e));
    return "read_error";
  }
}

export type Refusal = { ok: false; status: 401 | 403 | 503; error: string };
export type Allowed = { ok: true };

/** Entitled → ok; not entitled → 403 not_entitled; read error → 503 (fail closed, honest). */
export async function requireFinanceEntitlement(db: FinanceRpcDb, tenantId: string | null | undefined): Promise<Allowed | Refusal> {
  const e = await financeEntitled(db, tenantId);
  if (e === "entitled") return { ok: true };
  if (e === "not_entitled") return { ok: false, status: 403, error: "not_entitled" };
  return { ok: false, status: 503, error: "entitlement_unavailable" };
}

export type CustomerTier = "customer" | "not_customer" | "read_error";

/** Is this login a portal customer and nothing else (linked client somewhere, no active seat anywhere)? */
export async function portalCustomerTier(db: FinanceRpcDb, userId: string | null | undefined): Promise<CustomerTier> {
  if (!userId) return "read_error";
  try {
    const { data, error } = await db.rpc("_user_is_portal_customer_only", { _user: userId });
    if (error) {
      console.error("finance-entitlement: _user_is_portal_customer_only failed", error.message ?? String(error));
      return "read_error";
    }
    return data === true ? "customer" : "not_customer";
  } catch (e) {
    console.error("finance-entitlement: _user_is_portal_customer_only threw", String(e));
    return "read_error";
  }
}

/**
 * Credit paths are not a customer feature (owner direction, plan Q4): a customer-tier caller is
 * refused before any read, storage access or provider call. A read error refuses too (503).
 */
export async function refuseCustomerTier(db: FinanceRpcDb, userId: string | null | undefined): Promise<Allowed | Refusal> {
  const t = await portalCustomerTier(db, userId);
  if (t === "not_customer") return { ok: true };
  if (t === "customer") return { ok: false, status: 403, error: "customer_credit_not_available" };
  return { ok: false, status: 503, error: "caller_tier_unavailable" };
}

/**
 * May `actorId` act on credit records that belong to `tenantId`? The platform owner may (the one
 * cross-business path, §59); otherwise the actor must be an owner/admin of that business
 * (`is_tenant_admin_as`). The global `admin` app role is NOT a cross-business pass any more. A missing
 * business is refused; a read error is 503.
 */
export async function staffOfBusiness(db: FinanceRpcDb, actorId: string, tenantId: string | null | undefined): Promise<Allowed | Refusal> {
  try {
    const { data: owner, error: ownerErr } = await db.rpc("is_platform_owner", { _user_id: actorId });
    if (ownerErr) return { ok: false, status: 503, error: "authority_unavailable" };
    if (owner === true) return { ok: true };
    if (!tenantId) return { ok: false, status: 403, error: "forbidden" };
    const { data: admin, error: adminErr } = await db.rpc("is_tenant_admin_as", { _actor: actorId, _tenant: tenantId });
    if (adminErr) return { ok: false, status: 503, error: "authority_unavailable" };
    return admin === true ? { ok: true } : { ok: false, status: 403, error: "forbidden" };
  } catch (e) {
    console.error("finance-entitlement: staffOfBusiness threw", String(e));
    return { ok: false, status: 503, error: "authority_unavailable" };
  }
}

/** A service client that can also read a table (for the subject's own businesses). */
export type FinanceReadDb = FinanceRpcDb & {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

/**
 * May `actorId` write credit records ABOUT another login, `subjectId`? The platform owner may;
 * otherwise the actor must be an owner/admin of a business where the subject holds an active seat.
 * A subject who is a portal customer (no seat anywhere) is never a valid target here: customer-subject
 * credit writes are not authorized (plan Q4). The global `admin` app role is not consulted.
 */
export async function staffOfSubject(db: FinanceReadDb, actorId: string, subjectId: string): Promise<Allowed | Refusal> {
  const subjectTier = await portalCustomerTier(db, subjectId);
  if (subjectTier === "read_error") return { ok: false, status: 503, error: "caller_tier_unavailable" };
  if (subjectTier === "customer") return { ok: false, status: 403, error: "customer_credit_not_available" };
  try {
    const { data: owner, error: ownerErr } = await db.rpc("is_platform_owner", { _user_id: actorId });
    if (ownerErr) return { ok: false, status: 503, error: "authority_unavailable" };
    if (owner === true) return { ok: true };
    const { data: seats, error: seatErr } = await db
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", subjectId)
      .eq("status", "active");
    if (seatErr) return { ok: false, status: 503, error: "authority_unavailable" };
    const tenants = [...new Set((Array.isArray(seats) ? seats : [])
      .map((r: { tenant_id?: unknown }) => r.tenant_id)
      .filter((t: unknown): t is string => typeof t === "string" && t.length > 0))];
    for (const t of tenants) {
      const { data: admin, error: adminErr } = await db.rpc("is_tenant_admin_as", { _actor: actorId, _tenant: t });
      if (adminErr) return { ok: false, status: 503, error: "authority_unavailable" };
      if (admin === true) return { ok: true };
    }
    return { ok: false, status: 403, error: "forbidden" };
  } catch (e) {
    console.error("finance-entitlement: staffOfSubject threw", String(e));
    return { ok: false, status: 503, error: "authority_unavailable" };
  }
}

/**
 * May `actorId` act on the CRM contact `contactId` named in a request body? Same-business staff (or
 * an assigned teammate, or the platform owner) only — `can_access_contact`, the platform's one
 * contact-access predicate. Callers refuse a portal customer first, so the predicate's linked-customer
 * branch never admits one here.
 */
export async function contactAccessible(db: FinanceRpcDb, actorId: string, contactId: string): Promise<Allowed | Refusal> {
  try {
    const { data, error } = await db.rpc("can_access_contact", { _user_id: actorId, _contact_id: contactId });
    if (error) return { ok: false, status: 503, error: "authority_unavailable" };
    return data === true ? { ok: true } : { ok: false, status: 403, error: "forbidden" };
  } catch (e) {
    console.error("finance-entitlement: contactAccessible threw", String(e));
    return { ok: false, status: 503, error: "authority_unavailable" };
  }
}
