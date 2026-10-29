import type { SpineCapability } from "../contracts.ts";

/** C0b declaration of the existing caller-JWT planning read. The RPC resolves its
 * workspace and membership and narrows private items; this metadata grants no authority. */
export const PLANNING_READ_CAPABILITIES = [{
  key: "planning.list", domain: "planning", owner: "paige-planning",
  humanSurface: "PAIGE workspace", readiness: "none",
  action: { classification: "read", executor: "public.plan_list", chatTool: "plan_list",
    seatAuthority: "member", idempotency: "read-only; no rows written",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
}] as const satisfies readonly SpineCapability[];

/** The `plan_list` chat tool's schema, from its one live binding (paige-ai-chat, unchanged since the
 *  planning chat launch). Exported so the Team Hub MENTOR DM read offers the EXACT schema the main
 *  chat seam offers — never a second, drifting copy: a change to either must be made at both homes
 *  in the same PR, and this block cites the other by file. Read-only; never offered for a write. */
export const PLANNING_READ_TOOLS = [{
  type: "function",
  function: {
    name: "plan_list",
    description: "Read plans and their items (milestones, tasks, reminders) for this workspace — the person sees their own plus any team plans; native permissions govern access. Use to answer 'what's on my plate', 'show my week', 'what reminders do I have', or to resolve a plan/item id before updating it. Cancelled items are excluded by default; request include_cancelled:true or status:cancelled to inspect their saved history. A missing item alone does not prove cancellation. Read-only.",
    parameters: {
      type: "object",
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
    },
  },
}] as const;
