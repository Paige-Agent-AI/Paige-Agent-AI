import type { SpineCapability } from "../contracts.ts";
export const N8N_GET_SDK_REFERENCE = {
 key: "integrations.n8n_get_sdk_reference", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_get_sdk_reference", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_LIST_WORKFLOWS = {
 key: "integrations.n8n_list_workflows", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_list_workflows", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_GET_WORKFLOW = {
 key: "integrations.n8n_get_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_get_workflow", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_GET_EXECUTIONS = {
 key: "integrations.n8n_get_executions", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_get_executions", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_EXECUTION_GET = {
 key: "integrations.n8n_execution_get", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_execution_get", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_VALIDATE_WORKFLOW = {
 key: "integrations.n8n_validate_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: "n8n_validate_workflow", riskPolicyKey: "read_only", approvalAuthority: "none",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_CREATE_WORKFLOW = {
 key: "integrations.n8n_create_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_create_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_UPDATE_WORKFLOW = {
 key: "integrations.n8n_update_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_update_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_ACTIVATE_WORKFLOW = {
 key: "integrations.n8n_activate_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_activate_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_DEACTIVATE_WORKFLOW = {
 key: "integrations.n8n_deactivate_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_deactivate_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_ARCHIVE_WORKFLOW = {
 key: "integrations.n8n_archive_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_archive_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_RUN_WORKFLOW = {
 key: "integrations.n8n_run_workflow", domain: "integrations", owner: "solo-integrations", readiness: "n8n_connection",
 humanSurface: "/solo/:account/settings/integrations",
 action: { classification: "external_effect", executor: "edge.paige-ai-chat", chatTool: "n8n_run_workflow", riskPolicyKey: "high", approvalAuthority: "chat-canonical",
 idempotency: "Caller-scoped one-time confirmation for writes; provider writes are never automatically retried after uncertain results." },
 outcome: { kinds: ["verified", "refused", "unknown"], projector: "n8n-management.project", railVisibility: "Existing governed Chat action audit; connection events remain workspace Rail records." },
 chatBinding: "LIVE", mindBinding: "PARTIAL", sharedPrimitiveChange: "SCR-N8N-MANAGEMENT", maturity: "PARTIAL",
} as const satisfies SpineCapability;
export const N8N_MANAGEMENT_CAPABILITIES = [N8N_GET_SDK_REFERENCE, N8N_LIST_WORKFLOWS, N8N_GET_WORKFLOW, N8N_GET_EXECUTIONS, N8N_EXECUTION_GET, N8N_VALIDATE_WORKFLOW, N8N_CREATE_WORKFLOW, N8N_UPDATE_WORKFLOW, N8N_ACTIVATE_WORKFLOW, N8N_DEACTIVATE_WORKFLOW, N8N_ARCHIVE_WORKFLOW, N8N_RUN_WORKFLOW] as const;