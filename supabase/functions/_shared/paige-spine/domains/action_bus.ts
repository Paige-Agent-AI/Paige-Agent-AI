import type { SpineCapability } from "../contracts.ts";

/** Existing action-bus reads share public.list_actions. Chat retains its owner/admin
 * branch gate and the caller-JWT RPC retains its own tenant/seat checks. No new executor,
 * queue, approval or authenticated-acceptance claim is introduced by registration. */
export const ACTION_BUS_READ_CAPABILITIES = [
  { key: "action_bus.list", tool: "action_list", selfDescribe: true },
  { key: "action_bus.get", tool: "action_get", selfDescribe: false },
].map(({ key, tool, selfDescribe }) => ({
  key, domain: "action_bus", owner: "paige-action-bus",
  humanSurface: "PAIGE workspace", readiness: "none",
  selfDescribe,
  action: { classification: "read", executor: "public.list_actions", chatTool: tool,
    seatAuthority: "workspace-admin", idempotency: "read-only; no rows written",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
