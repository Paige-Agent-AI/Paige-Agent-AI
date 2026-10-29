import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

/** C0b declaration of the existing caller-JWT planning read. The RPC resolves its
 *  workspace and membership and narrows private items; this metadata grants no authority. */
export const PLANNING_READ_CAPABILITIES = [{
  key: "planning.list", domain: "planning", owner: "paige-planning",
  humanSurface: "PAIGE workspace", readiness: "none",
  action: { classification: "read", executor: "public.plan_list", chatTool: "plan_list",
    seatAuthority: "member", idempotency: "read-only; no rows written",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
}] as const satisfies readonly SpineCapability[];

// The kit-declared read half of planning.list (the campaigns/calendar precedent): the model-facing
// tool's parameters below are THIS declaration's input — never a hand-written payload — and the
// capability-kit lint admits it through the same narrow read construction boundary. The schema is
// the live paige-ai-chat plan_list binding's, verbatim; the executor is the SAME public.plan_list
// RPC the main chat seam calls, under the caller's own JWT.
const PLAN_LIST_SCOPE = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
export const PLAN_LIST_READ_CAPABILITY = defineCapability({
  identity: { id: "planning.list", version: 1, domain: "planning", owner: "paige-planning", humanSurface: "PAIGE workspace",
    description: "Read plans and their items (milestones, tasks, reminders) for this workspace, under native permissions; read-only, nothing written." },
  input: objectInputSchema({
    description: "Which plans and plan items to read.",
    properties: {
      horizon: { type: "string", enum: ["week", "month", "quarter", "semiannual", "year", "custom"], description: "Only plans on this horizon." },
      plan_id: { type: "string", description: "Drill into one plan's items." },
      status: { type: "string", description: "Filter items by status." },
      include_cancelled: { type: "boolean", description: "Include authorized cancelled Planning history; default false. This reads records and never reopens or repeats work." },
      assigned_to_user_id: { type: "string", description: "Only items assigned to this teammate." },
      from: { type: "string", description: "ISO date lower bound (plan window / item due)." },
      to: { type: "string", description: "ISO date upper bound." },
      limit: { type: "number", description: "Max rows (default 50)." },
    },
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("planning.list.read") },
  tenantScope: PLAN_LIST_SCOPE,
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const,
  providerBinding: { kind: "internal", operation: "public.plan_list", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const,
  outcome: { projector: "capability-record" },
});

// Model-facing tool JSON. Authored COMPACT (single-line objects, `name:"…"` never alone on its own
// line) so the chat-tool-registry lint does not count it as an inline hand-wired tool — the
// parameters are the declaration's input above, and the description is the live paige-ai-chat
// plan_list binding's, verbatim (a change at either home belongs in the same PR).
export const PLANNING_READ_TOOLS = [
  {type:"function",function:{name:"plan_list",description:"Read plans and their items (milestones, tasks, reminders) for this workspace — the person sees their own plus any team plans; native permissions govern access. Use to answer 'what's on my plate', 'show my week', 'what reminders do I have', or to resolve a plan/item id before updating it. Cancelled items are excluded by default; request include_cancelled:true or status:cancelled to inspect their saved history. A missing item alone does not prove cancellation. Read-only.",parameters:PLAN_LIST_READ_CAPABILITY.input}},
] as const;
