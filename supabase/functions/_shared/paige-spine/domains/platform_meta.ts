import type { SpineCapability } from "../contracts.ts";

// Existing proposal READ, not decision/approval or platform-authority expansion.
export const PLATFORM_META_READ_CAPABILITIES = [{
  key: "platform_meta.improvement_list", domain: "platform_meta", owner: "paige-platform-meta",
  humanSurface: "PAIGE workspace", readiness: "none", selfDescribe: false,
  action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "improvement_list", seatAuthority: "workspace-admin",
    idempotency: "existing caller-JWT proposal read; no rows written", riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
}] as const satisfies readonly SpineCapability[];
