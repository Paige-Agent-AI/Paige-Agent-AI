/**
 * EXP08 departure review: handing one held item to someone else, THROUGH THE WRITER THAT ALREADY
 * OWNS IT. Nothing here is a new writer, scheduler or approval store (§18 one home):
 *   work       -> plan_update_item_versioned, via submitOperationsWorkUpdate (Operations' own seam)
 *   crm_tasks  -> crm-command task.assign
 *   clients    -> crm-command contact.assign_coach (assigned) / contact.assign_owner (lead owner)
 *   deals      -> crm-command deal.assign_owner
 * Approvals and connected mailboxes have NO writer that can move them, so they are not handled here
 * at all — the review lists them with the truth about what happens to them.
 *
 * The hand-over is several separate writes, not one transaction. Each returns its own outcome.
 */
import { supabase } from "@/integrations/supabase/client";
import { submitOperationsWorkUpdate } from "./operations/operations-work-update";
import type { HoldingItem, TeamMemberRecord } from "./team-workspace-contract";

export type MovableItem = Extract<HoldingItem, { kind: "work" | "crm_tasks" | "clients" | "deals" }>;

export function isMovable(item: HoldingItem): item is MovableItem {
  return item.kind === "work" || item.kind === "crm_tasks" || item.kind === "clients" || item.kind === "deals";
}

/** "plan" saves directly; "crm" always returns its confirmation card first. */
export function writerOf(item: MovableItem): "plan" | "crm" {
  return item.kind === "work" ? "plan" : "crm";
}

/**
 * Who may receive an item, by that item's writer's own rule: an active seat in this workspace, never
 * the person leaving. contact.assign_coach (a client "assigned to them") accepts an owner or admin
 * only. The writer still decides for real; this only keeps the picker from offering a refusal.
 */
export function receiversFor(item: MovableItem, departingUserId: string, members: TeamMemberRecord[]): TeamMemberRecord[] {
  return members.filter((m) => {
    if (m.user_id === departingUserId || m.status !== "active") return false;
    if (item.kind === "clients" && item.relation === "assigned") return m.is_owner || m.permission === "owner" || m.permission === "admin";
    return m.is_owner || m.permission === "owner" || m.permission === "admin" || m.permission === "member";
  });
}

export type HandoverOutcome =
  | { kind: "saved" }
  | { kind: "confirm"; fingerprint: string }
  | { kind: "changed" }
  | { kind: "expired" }
  | { kind: "failed"; message: string; uncertain: boolean };

export type HandoverScope = { actorId: string; tenantId: string };

function crmCommandFor(item: Exclude<MovableItem, { kind: "work" }>, toUserId: string): Record<string, unknown> {
  switch (item.kind) {
    case "crm_tasks":
      return { action: "task.assign", task_id: item.id, expected_updated_at: item.updated_at, patch: { assignee_user_id: toUserId } };
    case "clients":
      return { action: item.relation === "assigned" ? "contact.assign_coach" : "contact.assign_owner", contact_id: item.id, expected_updated_at: item.updated_at, owner_user_id: toUserId };
    case "deals":
      return { action: "deal.assign_owner", deal_id: item.id, expected_version: item.version, owner_user_id: toUserId };
  }
}

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * One hand-over write. `key` is the idempotency key for a CRM change and must be reused for a retry
 * of the SAME change (so a lost reply reads back rather than writing twice) and replaced only when the
 * change itself is prepared again.
 */
export async function handOver(scope: HandoverScope, item: MovableItem, toUserId: string, key: string, approvedFingerprint?: string): Promise<HandoverOutcome> {
  if (item.kind === "work") {
    const result = await submitOperationsWorkUpdate(
      { actorId: scope.actorId, tenantId: scope.tenantId, itemId: item.id, expectedUpdatedAt: item.updated_at },
      { assigneeId: toUserId },
    );
    if (result.kind === "acknowledged") return { kind: "saved" };
    if (result.kind === "refused" && result.conflict) return { kind: "changed" };
    return { kind: "failed", message: result.message, uncertain: result.kind === "uncertain" };
  }
  try {
    let { data, error } = await supabase.functions.invoke("crm-command", {
      body: { expected_tenant_id: scope.tenantId, command: crmCommandFor(item, toUserId), idempotency_key: key, ...(approvedFingerprint ? { approved_fingerprint: approvedFingerprint } : {}) },
    });
    // A refusal arrives as a non-2xx whose body sits on error.context.
    if (error && "context" in error && error.context instanceof Response) {
      try { data = await error.context.json(); error = null; } catch { /* body unreadable: treated as unknown below */ }
    }
    if (error || !object(data)) return { kind: "failed", message: "We couldn't confirm this change. Retry checks first, so it never saves twice.", uncertain: true };
    if (data.outcome === "approval_required" && typeof data.fingerprint === "string" && data.fingerprint) return { kind: "confirm", fingerprint: data.fingerprint };
    if (data.ok === true) {
      const read = object(data.readback) ? data.readback : null;
      if (read && typeof read.id === "string" && read.id === item.id) return { kind: "saved" };
      return { kind: "failed", message: "This change came back without a record we could check. Retry reads it again.", uncertain: true };
    }
    if (data.outcome_unknown === true) return { kind: "failed", message: "We couldn't confirm this change. Retry checks first, so it never saves twice.", uncertain: true };
    const code = typeof data.code === "string" ? data.code : "";
    const message = typeof data.message === "string" ? data.message : "";
    if (/STALE|VERSION|CONFLICT/.test(code) || /changed since|stale|version/i.test(message)) return { kind: "changed" };
    if (/APPROVAL_CLAIM_INVALID|EXPIRED/.test(code) || /expired/i.test(message)) return { kind: "expired" };
    return { kind: "failed", message: message || "This change was refused. Nothing was saved.", uncertain: false };
  } catch {
    return { kind: "failed", message: "We couldn't reach the server, so this change may not have saved. Retry checks first.", uncertain: true };
  }
}
