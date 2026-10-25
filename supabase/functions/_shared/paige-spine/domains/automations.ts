import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";
import { WEEKLY_CONTROL_REVIEW_INPUTS } from "../../paige-orchestration/weekly-commitment-control-input.ts";

/** Owner UI draft only. Registration is not Chat/Live admission or recurring authority. */
export const WEEKLY_COMMITMENT_DRAFT_CAPABILITY = defineCapability({
  identity: { id: "automations.weekly_commitment_draft", version: 1, domain: "automations", owner: "experience-05",
    humanSurface: "PAIGE / Clients Calendar weekly responsibility", description: "Save a reviewed owner-private weekly definition as an unapproved draft. No future run is authorized." },
  input: WEEKLY_CONTROL_REVIEW_INPUTS.draft,
  effect: "mutation",
  governance: { actionRiskKey: "weekly_commitment_draft", risk: "ordinary", approval: "confirm",
    requiredPermission: ownerGrantablePermission("automations.weekly_commitment_draft.write") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "needs_approval", "unavailable", "not_for_tier"] },
  providerBinding: { kind: "internal", operation: "public.commit_weekly_commitment_draft", connectionResolver: null },
  idempotency: { mode: "required", key: "Canonical confirmation ID + stored draft request UUID; one native request index and one stable Rail run ID.",
    readback: "public.read_weekly_commitment_draft", replay: "reconcile_then_return" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
// Chat binding is the exact native draft consumer, not recurring execution.
// Source admission, production proof and complete Experience acceptance are separate.
export const WEEKLY_COMMITMENT_DRAFT = {
  key: "automations.weekly_commitment_draft", domain: "automations", owner: "experience-05",
  humanSurface: "PAIGE / Clients Calendar weekly responsibility", readiness: "none", selfDescribe: true,
  action: { classification: "mutate", executor: "public.commit_weekly_commitment_chat_draft", chatTool: "weekly_commitment_draft", seatAuthority: "door-seat", riskPolicyKey: "ordinary",
    approvalAuthority: "chat-canonical", idempotency: "Exact canonical stored proposal, native unique request and stable Rail receipt; unknown reads never replay." },
  outcome: { kinds: ["capability_run"], projector: "public.record_capability_run", railVisibility: "owner_internal" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

// Original owner-only read contract. Chat consumes this below through its current
// server offer/admission; registration does not grant Live or recurring authority.
export const WEEKLY_COMMITMENT_STATUS_READ_CAPABILITY = defineCapability({
  identity: { id: "automations.weekly_commitment_status", version: 1, domain: "automations", owner: "experience-05",
    humanSurface: "PAIGE workspace / existing Calendar", description: "Inspect canonical owner-private weekly process status and receipt-verified history; no scheduling or booking authority." },
  input: objectInputSchema({ properties: {}, required: [], description: "Current owner/workspace is server-derived; no model-provided scope or action input." }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("automations.weekly_commitment_status.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.get_weekly_commitment_checks", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  // Shared Kit read-trace metadata only; this read wires no receipt recorder.
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

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

// Existing owner-private read, consumed by Chat through the same native reader.
// Keep self-description and wider Experience acceptance separate from binding.
export const WEEKLY_COMMITMENT_STATUS = {
  key: "automations.weekly_commitment_status", domain: "automations", owner: "experience-05",
  humanSurface: "PAIGE workspace", readiness: "none", selfDescribe: false,
  action: { classification: "read", executor: "public.get_weekly_commitment_checks", chatTool: "read_weekly_commitment_status", seatAuthority: "door-seat",
    idempotency: "canonical process and act receipt read; conversation-independent; no writes",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.get_weekly_commitment_checks",
    railVisibility: "The Chat read receipt is not a weekly execution receipt; original process/act observations remain authoritative." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const WEEKLY_COMMITMENT_STATUS_TOOLS = [{ type: "function" as const, function: {
  name: "read_weekly_commitment_status",
  description: `${WEEKLY_COMMITMENT_STATUS_READ_CAPABILITY.identity.description} Use for the owner's saved weekly responsibility and its original check history, not an ordinary task-prioritization review. Empty, held and unknown states are not successful execution.`,
  parameters: WEEKLY_COMMITMENT_STATUS_READ_CAPABILITY.input,
} }];
export const WEEKLY_COMMITMENT_STATUS_TOOL_NAME = WEEKLY_COMMITMENT_STATUS_TOOLS[0].function.name;
/** Offer filtering uses canonical server facts; native owner/scope checks remain mandatory. */
export function weeklyCommitmentStatusToolsForContext(context: { callerTier: string; accountShape: string | null;
  role: string | null; scopedClientId: string | null; customerPortal: boolean }) {
  return context.callerTier === "tenant" && context.accountShape === "solo" && context.role === "owner"
    && context.scopedClientId === null && context.customerPortal === false ? WEEKLY_COMMITMENT_STATUS_TOOLS : [];
}

/** Original draft intent only. The Chat consumer must still bind the server
 * request identity, exact surface approval and native claim/Kit/commit. Exporting
 * this schema grants no admission, recurring authority or completed result.
 */
export const WEEKLY_COMMITMENT_DRAFT_TOOL_NAME = "weekly_commitment_draft";
export const WEEKLY_COMMITMENT_DRAFT_TOOLS = [{ type: "function" as const, function: {
  name: "weekly_commitment_draft",
  description: "Prepare a private weekly commitment-check draft for the workspace owner. Ask for its name, ISO weekday, local time and explicit time zone. Saving requires exact approval and does not authorize, enable or execute recurring work. Use read_weekly_commitment_status to inspect original saved work; do not reconstruct or repeat an uncertain save.",
  parameters: WEEKLY_COMMITMENT_DRAFT_CAPABILITY.input,
} }];
export function weeklyCommitmentDraftToolsForContext(context: Parameters<typeof weeklyCommitmentStatusToolsForContext>[0]) {
  return weeklyCommitmentStatusToolsForContext(context).length ? WEEKLY_COMMITMENT_DRAFT_TOOLS : [];
}

// Original-outcome reader; a conversational lookup grants no action authority. The
// server transport reauthorizes the exact companion under its original caller
// JWT before using this unchanged service-only native result reader. Current
// Task inspection stays with crm_clients.task_read; registration grants no SQL.
export const OWNER_TASK_HISTORY_READ_CAPABILITY = defineCapability({
  identity: { id: "automations.owner_task_history", version: 2, domain: "automations", owner: "experience-05",
    humanSurface: "Operations / internal task process inspection",
    description: "Inspect one original internal-task occurrence, its approval and verified native Task/Rail result without dispatch, replay or a current Task-state claim." },
  input: objectInputSchema({ properties: {
    approval_id: { type: "string", format: "uuid", maxLength: 36, description: "Exact saved original task approval UUID. Actor and workspace are server-derived; this is not a new approval." },
  }, required: ["approval_id"] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("automations.owner_task_history.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.read_owner_task_act", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
export const OWNER_TASK_HISTORY_READ = {
  key: "automations.owner_task_history", domain: "automations", owner: "experience-05",
  humanSurface: "Operations / internal task process inspection", readiness: "none", selfDescribe: false,
  action: { classification: "read", executor: "public.read_owner_task_act", chatTool: "read_owner_task_act", seatAuthority: "door-seat",
    idempotency: "Read-only original-JWT companion authorization and original native result/receipt correlation. No execution, settlement, action receipt creation, retries or current Task substitution.",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  outcome: { kinds: ["ready", "available", "needs_input", "refused", "unavailable"], projector: "public.read_owner_task_act",
    railVisibility: "Returns the existing native creation receipt identity only when verified. Does not issue a new action receipt or imply optional orchestration/contact Rail publication." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

// Chat takes only an original address. Native transport's tenantId is a separate,
// server-derived refusal guard, never a model-selected workspace or authority.
export const OWNER_TASK_HISTORY_TOOL_NAME = "read_owner_task_act";
export const OWNER_TASK_HISTORY_TOOLS = [{ type: "function" as const, function: {
  name: "read_owner_task_act",
  description: "Read one original internal-task automation outcome by its saved approval_id, from an earlier original result or native history. Never guess the ID. This inspection cannot approve, execute, retry or read the current Task state. Recorded execution without verified original Task and Rail evidence remains unconfirmed.",
  parameters: OWNER_TASK_HISTORY_READ_CAPABILITY.input,
} }];
export function ownerTaskHistoryToolsForContext(facts: Parameters<typeof weeklyCommitmentStatusToolsForContext>[0]) {
  return facts.callerTier === "tenant" && facts.accountShape === "solo"
    && (facts.role === "owner" || facts.role === "admin")
    && facts.scopedClientId === null && facts.customerPortal === false ? OWNER_TASK_HISTORY_TOOLS : [];
}
