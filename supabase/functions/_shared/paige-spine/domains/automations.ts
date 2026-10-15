import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Declaration for the prepared owner-only reader, not a conversational tool grant.
// Chat/Live offer/dispatch and source-bound lint adoption remain with their admission owners.
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

// Experience 05 backend readback. Kept out of self-description until the incumbent
// Chat/Live owners bind this owner-only RPC and authenticated acceptance succeeds.
export const WEEKLY_COMMITMENT_STATUS = {
  key: "automations.weekly_commitment_status", domain: "automations", owner: "experience-05",
  humanSurface: "PAIGE workspace", readiness: "none", selfDescribe: false,
  action: { classification: "read", executor: "public.get_weekly_commitment_checks",
    idempotency: "canonical process and act receipt read; conversation-independent; no writes",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "UNAVAILABLE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;
