import type { SpineCapability } from "../contracts.ts";

// C0b metadata for existing caller-JWT table reads and resolved autonomy readback.
// No process is drafted, granted, started or stopped. Callable binding is implemented;
// authenticated acceptance and Mind integration are not claimed by registration.
export const AUTOMATION_READ_CAPABILITIES = [
  { key: "automations.list", tool: "automation_list", selfDescribe: true },
  { key: "automations.triggers_list", tool: "automation_triggers_list", selfDescribe: false },
].map(({ key, tool, selfDescribe }) => ({
  key, domain: "automations", owner: "paige-automations", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: tool, seatAuthority: "member",
    idempotency: "existing caller-JWT stored-state read; no rows written", riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
