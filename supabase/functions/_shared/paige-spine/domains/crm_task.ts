import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Exact native Operations/CRM read. The original caller's RLS remains authoritative.
export const CRM_TASK_READ_CAPABILITY = defineCapability({
  identity: { id: "crm_clients.task_read", version: 1, domain: "crm_clients", owner: "crm", humanSurface: "/solo/:account/operations/work",
    description: "Read one saved Task by its exact UUID under current workspace and native own/assigned-client visibility. Not visible does not establish global absence. No Task action runs." },
  input: objectInputSchema({ properties: {
    task_id: { type: "string", format: "uuid", maxLength: 36, description: "Exact saved Task UUID. No actor, tenant, role, status or list-filter arguments." },
  }, required: ["task_id"] }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("crm.task.read") },
  tenantScope: { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] },
  availability: { resolver: "paige-capability-status", states: ["live", "not_for_tier", "unavailable"] },
  providerBinding: { kind: "internal", operation: "public.operations_crm_work_read", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const CRM_TASK_READ = {
  key: "crm_clients.task_read", domain: "crm_clients", owner: "crm", humanSurface: "/solo/:account/operations/work", readiness: "none",
  action: { classification: "read", executor: "public.operations_crm_work_read", chatTool: "crm_get_task", seatAuthority: "member",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Original caller JWT; exact UUID before source cap; current native actor/tenant/standalone/member and own/assigned-client/admin row rule intersected with tasks RLS. No writer, list fallback or action replay." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.operations_crm_work_read",
    railVisibility: "One available Chat read records a capability read receipt, not Task execution. The bounded Task reference opens the current Operations Task inspector, which reauthorizes its own read." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const CRM_TASK_READ_TOOLS = [{ type: "function" as const, function: {
  name: "crm_get_task", description: CRM_TASK_READ_CAPABILITY.identity.description,
  parameters: CRM_TASK_READ_CAPABILITY.input,
} }];
