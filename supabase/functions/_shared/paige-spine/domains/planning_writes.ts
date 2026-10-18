import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

/** Existing caller-JWT planning writers only. Member is the existing Chat admission
 * gate, not an RPC grant: SQL retains tenant, staff, ownership and reassignment checks.
 * All writes remain governed by the canonical Chat autonomy/approval path. Declaration
 * does not activate a runner, make delivery promises or add retry authority.
 * SQL: 20260711340000_paige_planning.sql and 20260712010000_planning_audit_fixes.sql.
 */
export const PLANNING_WRITE_CAPABILITIES = [
  {
    key: "planning.set_reminder", tool: "plan_set_reminder", selfDescribe: true,
    idempotency: "Not idempotent as a general tool: the canonical nine-argument writer inserts on every call. Exact server-issued approvals in an ordinary owned thread with a bound runtime use one sealed durable intent and one atomic invocation; existing or uncertain claims are not blindly dispatched again. AUTO and explicitly excluded compatibility contexts retain the original writer and can duplicate on blind retry. Native staff checks for team/other reminders stay controlling.",
  },
  {
    key: "planning.create", tool: "plan_create", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new plan. Its native audit/receipt identity is not a request key; a blind retry can create another plan. Existing SQL restricts team/other-owner plans to staff.",
  },
  {
    key: "planning.add_milestone", tool: "plan_add_milestone", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new milestone. Its native audit/receipt identity is not a request key; a blind retry can create another milestone. Existing SQL retains its current native staff checks.",
  },
  {
    key: "planning.assign_task", tool: "plan_assign_task", selfDescribe: true,
    idempotency: "Not idempotent: each call inserts a new task and may file a linked record-only action. Its native audit/receipt identity is not a request key; a blind retry can duplicate work. Existing SQL restricts assignment to others to staff.",
  },
  {
    key: "planning.update_item", tool: "plan_update_item", selfDescribe: false,
    idempotency: "Not idempotent as a full operation: the item id is stable but updates write native audit/receipt rows and completion timestamps, and moving a reminder can re-arm dispatch. A receipt is not an expected-version or replay guard. Existing SQL retains creator/assignee/staff and staff-only reassignment rules.",
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

/**
 * E09 Slice 3 — share one client-linked work item with that client's portal, or stop sharing it.
 *
 * WHY IT IS NOT IN THE ARRAY ABOVE. Every entry there is `ordinary` and a `member` admission. This one
 * is neither: it changes what a CLIENT can see (`high` in action-risk.ts), and its SQL body
 * (`public.plan_item_set_client_share`, migration 20271110030000) admits only the active workspace's
 * owner or admin (`is_tenant_admin`), so the Chat gate is declared `workspace-admin` and a member is
 * told no before any approval card. The tenant and actor are always the caller's own, derived on the
 * server; nothing the model passes can name another workspace.
 *
 * What the client then sees is the item's title, state and due date only (owner ruling D3); sharing
 * sends the client no notification (D8). New work is never shared by default (D2).
 */
export const PLANNING_SHARE_WITH_CLIENT = {
  key: "planning.share_with_client", domain: "planning", owner: "paige-planning", humanSurface: "/solo/:account",
  readiness: "none", selfDescribe: true,
  action: {
    classification: "mutate", executor: "public.plan_item_set_client_share", chatTool: "plan_item_set_client_share",
    seatAuthority: "workspace-admin", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
    idempotency: "State-idempotent: re-sharing a shared item or unsharing an unshared one returns replayed:true with no write; a stale expected_updated_at returns ITEM_CHANGED. There is no request key: the Chat confirmation fingerprint is the execute-once guard, and the item's own shared state is what makes a retry converge instead of writing twice.",
  },
  outcome: { kinds: ["capability_run"], projector: "public.record_capability_run", railVisibility: "owner_internal" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

/** Registered beside PLANNING_WRITE_CAPABILITIES in registry.ts; that frozen set stays exactly the
 * five incumbent writers (c0b-planning-write-declarations). */
export const PLANNING_CLIENT_SHARE_CAPABILITIES = [PLANNING_SHARE_WITH_CLIENT] as const;

/**
 * The governed declaration for `plan_item_set_client_share` (action-risk.ts: "classify it here, declare
 * it through defineCapability(), and ship its tool schema — in the same change"). paige-ai-chat imports
 * this module for the tool schema, so the declaration is evaluated on every cold start, and it throws
 * there if its class ever drifts from the canonical policy.
 */
export const PLANNING_CLIENT_SHARE_CAPABILITY = defineCapability({
  identity: {
    id: "planning.share_with_client", version: 1, domain: "planning", owner: "paige-planning",
    humanSurface: "/solo/:account",
    description: "Share one client-linked milestone or task with that client's portal, or stop sharing it. The client sees its title, state and due date only.",
  },
  input: objectInputSchema({
    description: "Which work item, whether the client should see it, and the version the owner reviewed.",
    properties: {
      item_id: { type: "string", format: "uuid", description: "The plan item id (from plan_list), a milestone or task linked to one client." },
      shared: { type: "boolean", description: "true to show it in that client's portal, false to stop showing it." },
      expected_updated_at: { type: "string", maxLength: 80, description: "The item's exact updated_at as last read (plan_list). Preserve it unchanged through approval; if the item changed since, nothing is shared and you must re-read it." },
    },
    required: ["item_id", "shared", "expected_updated_at"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "plan_item_set_client_share",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("planning.share_with_client.write"),
  },
  tenantScope: {
    source: "server",
    tenantResolver: "current_user_tenant_id",
    actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"],
  },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.plan_item_set_client_share", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "tenant + actor + item_id + shared. The RPC converges on the item's shared state: a call whose state already holds returns replayed:true and writes nothing, and a stale expected_updated_at is refused as ITEM_CHANGED.",
    readback: "plan_items (caller-JWT RLS read of client_shared_at)",
    replay: "return_recorded_result",
  },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

// Model-facing tool JSON, authored COMPACT (`name:"…"` never alone on its own line) so
// chat-tool-registry-lint does not count it as a hand-wired Chat tool: it enters Chat through the
// adapter spread, exactly as AGREEMENT_TOOLS does. The description carries the honest boundary.
//
// A write tool's parameters are a fresh copy: the chat adds its `confirm` property to every gated tool,
// and a declaration's own input is frozen (the same rule as email-campaign-chat.ts).
const writable = (schema: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(schema));
export const PLANNING_CLIENT_SHARE_TOOLS = [
  {type:"function",function:{name:"plan_item_set_client_share",description:"Show one work item (a milestone or task linked to a client) in that client's portal, or stop showing it. The client sees only its title, its state (not started, in progress or done) and its due date — never its notes, who it is assigned to, or its priority. Sharing sends the client no message; they see it on their next visit. Reminders, items not linked to a client and cancelled items cannot be shared. Owner or admin only, and the owner approves it on the card first. Resolve the item with plan_list and pass its exact updated_at as expected_updated_at; if the item changed since, nothing is shared and you must re-read it before proposing again. Never say a client can see something until this reports success.",parameters:writable(PLANNING_CLIENT_SHARE_CAPABILITY.input)}},
] as const;
export const PLANNING_CLIENT_SHARE_TOOL_NAMES: ReadonlySet<string> = new Set(PLANNING_CLIENT_SHARE_TOOLS.map((t) => t.function.name));
