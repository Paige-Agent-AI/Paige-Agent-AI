import type { SpineCapability } from "../contracts.ts";

/** Existing caller-JWT planning writers only. Member is the existing Chat admission
 * gate, not an RPC grant: SQL retains tenant, staff, ownership and reassignment checks.
 * All writes remain governed by the canonical Chat autonomy/approval path. Declaration
 * does not activate a runner, make delivery promises or add retry authority.
 * SQL: 20260711340000_paige_planning.sql and 20260712010000_planning_audit_fixes.sql.
 */
export const PLANNING_WRITE_CAPABILITIES = [
  {
    key: "planning.set_reminder", tool: "plan_set_reminder", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new reminder. No request key or deduplication receipt; a blind retry can create another reminder. Existing SQL restricts team/other reminders to staff.",
  },
  {
    key: "planning.create", tool: "plan_create", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new plan. No request key or deduplication receipt; a blind retry can create another plan. Existing SQL restricts team/other-owner plans to staff.",
  },
  {
    key: "planning.add_milestone", tool: "plan_add_milestone", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new milestone. No request key or deduplication receipt; a blind retry can create another milestone. Existing SQL requires admin, super_admin or coach.",
  },
  {
    key: "planning.assign_task", tool: "plan_assign_task", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new task and may file a linked record-only action. No request key or deduplication receipt; a blind retry can duplicate work. Existing SQL restricts assignment to others to staff.",
  },
  {
    key: "planning.update_item", tool: "plan_update_item", selfDescribe: false,
    idempotency: "Not idempotent as a full operation: the item id is stable but updates write audit rows and completion timestamps, and moving a reminder can re-arm dispatch. No operation receipt or expected-version guard. Existing SQL retains creator/assignee/staff and staff-only reassignment rules.",
  },
].map(({ key, tool, selfDescribe, idempotency }) => ({
  key, domain: "planning", owner: "paige-planning", humanSurface: "PAIGE workspace",
  readiness: "none", selfDescribe,
  action: {
    classification: "mutate", executor: `public.${tool}`, chatTool: tool,
    seatAuthority: "member", idempotency, riskPolicyKey: "ordinary",
    approvalAuthority: "chat-canonical",
  },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
