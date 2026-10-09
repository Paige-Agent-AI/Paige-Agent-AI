// ---------------------------------------------------------------------------
// Tenant lifecycle — the Agency/God-view control-plane operations.
// ---------------------------------------------------------------------------
// Pure helpers (status metadata, trial math, at-risk scoring) + the operator
// mutations the Fleet Console drives. Lifecycle transitions and provisioning go
// through the §10 canonical RPC seam (`operator_set_tenant_status` /
// `operator_provision_tenant`) — SECURITY DEFINER, server-gated to
// is_platform_owner() and audited — so the UI and any Paige agent call ONE home
// instead of forking write logic. Plan/limit/trial edits remain RLS-gated writes
// (already permitted by "Platform owner manages tenants"; not the §10 gap).
// Blueprint: God View → Agency View → Sub-Account, Phase 1 (no Stripe).

import { supabase } from "@/integrations/supabase/client";

export type TenantStatus = "trial" | "active" | "past_due" | "suspended" | "canceled";

export const TENANT_STATUSES: TenantStatus[] = ["trial", "active", "past_due", "suspended", "canceled"];

/** Display metadata per status — label + a badge tone the console maps to color. */
export const STATUS_META: Record<TenantStatus, { label: string; tone: "positive" | "notice" | "warn" | "critical" | "neutral" }> = {
  trial: { label: "Trial", tone: "notice" },
  active: { label: "Active", tone: "positive" },
  past_due: { label: "Past due", tone: "warn" },
  suspended: { label: "Suspended", tone: "critical" },
  canceled: { label: "Canceled", tone: "neutral" },
};

/** Lifecycle transitions offered from a given status (drives the action buttons). */
export function allowedTransitions(status: TenantStatus): TenantStatus[] {
  switch (status) {
    case "trial": return ["active", "suspended", "canceled"];
    case "active": return ["suspended", "canceled"];
    case "past_due": return ["active", "suspended", "canceled"];
    case "suspended": return ["active", "canceled"];
    case "canceled": return ["active"];
    default: return [];
  }
}

/** A destructive transition warrants a confirm step in the UI. */
export function isDestructiveStatus(status: TenantStatus): boolean {
  return status === "suspended" || status === "canceled";
}

// --- Trial math -------------------------------------------------------------

/** Whole days until the trial ends (negative = already lapsed). null if no trial date. */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return null;
  const raw = (end - now) / 86_400_000;
  // Round up while the trial is in the future ("7 days left" reads as 7 right
  // after a +7 extension), but round down once lapsed so any past date is a
  // strictly negative day count — never a deceptive 0.
  return raw >= 0 ? Math.ceil(raw) : Math.floor(raw);
}

/** ISO timestamp N days from the later of (current trial end, now) — an extension never shortens. */
export function extendedTrialEnd(trialEndsAt: string | null | undefined, days: number, now: number = Date.now()): string {
  const base = trialEndsAt ? Math.max(new Date(trialEndsAt).getTime() || now, now) : now;
  return new Date(base + days * 86_400_000).toISOString();
}

// --- At-risk / health scoring ----------------------------------------------

export interface TenantHealthInput {
  status: TenantStatus;
  trial_ends_at: string | null;
  seat_limit: number;
  customer_limit: number;
  member_count: number;
  customer_count: number;
}

export type HealthLevel = "healthy" | "watch" | "critical";

export interface TenantHealth {
  level: HealthLevel;
  reasons: string[];
}

/**
 * Deterministic, evidence-based health. No ML — just the signals a platform
 * owner acts on: billing trouble, a trial about to lapse, and hitting limits.
 * (Client-side today; the blueprint moves this to a server-side rollup at scale.)
 */
export function tenantHealth(t: TenantHealthInput, now: number = Date.now()): TenantHealth {
  const reasons: string[] = [];
  let level: HealthLevel = "healthy";

  if (t.status === "suspended") { reasons.push("Suspended"); level = "critical"; }
  else if (t.status === "past_due") { reasons.push("Payment past due"); level = "critical"; }
  // `canceled` is a resolved terminal state — the status badge conveys it; it is
  // deliberately NOT flagged "needs attention" so the at-risk count stays actionable.

  const days = trialDaysLeft(t.trial_ends_at, now);
  if (t.status === "trial" && days !== null) {
    if (days < 0) { reasons.push("Trial lapsed"); level = worst(level, "critical"); }
    else if (days <= 3) { reasons.push(`Trial ends in ${days}d`); level = worst(level, "watch"); }
  }

  if (t.seat_limit > 0 && t.member_count >= t.seat_limit) {
    reasons.push("Seats at limit"); level = worst(level, "watch");
  }
  if (t.customer_limit > 0 && t.customer_count >= t.customer_limit) {
    reasons.push("Customers at limit"); level = worst(level, "watch");
  }

  return { level, reasons };
}

function worst(a: HealthLevel, b: HealthLevel): HealthLevel {
  const rank: Record<HealthLevel, number> = { healthy: 0, watch: 1, critical: 2 };
  return rank[b] > rank[a] ? b : a;
}

// --- RLS-gated mutations (platform owner) -----------------------------------

export interface TenantLifecyclePatch {
  status?: TenantStatus;
  plan_offer?: string | null;
  seat_limit?: number;
  customer_limit?: number;
  trial_ends_at?: string | null;
}

/** Raw RLS-gated write to a tenant. Throws on error so callers can toast. */
async function writeTenant(tenantId: string, patch: TenantLifecyclePatch): Promise<void> {
  const { error } = await supabase.from("tenants").update(patch).eq("id", tenantId);
  if (error) throw new Error(error.message);
}

/**
 * Best-effort audit of a privileged tenant action to the shared `audit_logs`
 * sink (RLS requires user_id = auth.uid()). Deliberately swallows its own
 * failure: an audit hiccup must not make a completed lifecycle action report as
 * failed to the operator. Every owner-level tenant mutation records a trail.
 */
async function logTenantAction(action: string, tenantId: string, data: Record<string, unknown>): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    await supabase.from("audit_logs").insert({
      user_id: uid, action, entity: "tenant", entity_id: tenantId, data,
    });
  } catch {
    /* audit is best-effort — never block or fail the action it records */
  }
}

/** Apply a lifecycle patch to a tenant + record it. Throws on write error. */
export async function updateTenant(tenantId: string, patch: TenantLifecyclePatch): Promise<void> {
  await writeTenant(tenantId, patch);
  await logTenantAction("tenant.update", tenantId, { ...patch });
}

/**
 * Transition a tenant's lifecycle status through the §10 canonical, server-gated
 * RPC (is_platform_owner() enforced + audited inside the RPC). Throws on error.
 */
export async function setTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
  // `as any`: RPC newly added in this migration, not yet in generated types —
  // matches the repo convention for fresh RPCs (e.g. agency_switch_context).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.rpc("operator_set_tenant_status" as any, {
    _tenant_id: tenantId,
    _status: status,
  });
  if (error) throw new Error(error.message);
}

/** Fields an operator supplies when provisioning a new workspace. */
export interface ProvisionTenantInput {
  name: string;
  slug?: string;
  plan_offer?: string | null;
  seat_limit?: number;
  customer_limit?: number;
  status?: TenantStatus;
}

/**
 * Provision a brand-new tenant workspace through the §10 canonical RPC
 * (operator-only; is_platform_owner() enforced + audited server-side). Returns
 * the new tenant id + slug. Throws on error so the caller can toast.
 */
export async function provisionTenant(input: ProvisionTenantInput): Promise<{ id: string; slug: string; name: string }> {
  // `as any`: RPC newly added in this migration, not yet in generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("operator_provision_tenant" as any, {
    _name: input.name,
    _slug: input.slug?.trim() || undefined,
    _plan_offer: input.plan_offer?.trim() || undefined,
    _seat_limit: input.seat_limit,
    _customer_limit: input.customer_limit,
    _status: input.status ?? "trial",
  });
  if (error) throw new Error(error.message);
  // The RPC returns the full tenants row.
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; slug: string; name: string } | null;
  if (!row) throw new Error("Provisioning returned no tenant");
  return { id: row.id, slug: row.slug, name: row.name };
}

export async function extendTrial(tenantId: string, currentEnd: string | null, days: number): Promise<string> {
  const next = extendedTrialEnd(currentEnd, days);
  await writeTenant(tenantId, { trial_ends_at: next, status: "trial" });
  await logTenantAction("tenant.trial_extend", tenantId, { days, trial_ends_at: next });
  return next;
}

export async function expireTrial(tenantId: string): Promise<void> {
  // Strictly in the past so it reads as lapsed immediately (not a same-day "0d").
  const past = new Date(Date.now() - 1000).toISOString();
  await writeTenant(tenantId, { trial_ends_at: past });
  await logTenantAction("tenant.trial_expire", tenantId, { trial_ends_at: past });
}

/**
 * A tenant's status in words, only when it is not the default — "Active" on every row would be
 * noise, and a non-active status is exactly what explains an At risk grade. Labels and trial maths
 * live here, in the lifecycle module (§18): the Fleet directory, the act-as arrival notice and the
 * operator's in-shell state label all read this one function, so they can never disagree.
 */
export function tenantStatusNote(status: string | null | undefined, trialEndsAt?: string | null): string | null {
  if (!status || status === "active") return null;
  const label = STATUS_META[status as TenantStatus]?.label ?? status;
  if (status !== "trial") return label;
  const left = trialDaysLeft(trialEndsAt);
  if (left === null) return label;
  if (left < 0) {
    // `trialDaysLeft` rounds a lapsed trial DOWN (so it is never a deceptive 0), which overstates
    // the elapsed time by up to a day. Elapsed whole days are counted here instead: 9.2 days ago
    // reads "9 days ago", and under a day reads "today" — never a figure the record does not hold.
    const ago = Math.floor((Date.now() - new Date(trialEndsAt as string).getTime()) / 86_400_000);
    if (ago < 1) return `${label} · ended today`;
    return `${label} · ended ${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  if (left === 0) return `${label} · ends today`;
  return `${label} · ${left} ${left === 1 ? "day" : "days"} left`;
}
