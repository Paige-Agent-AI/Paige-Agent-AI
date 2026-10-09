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
