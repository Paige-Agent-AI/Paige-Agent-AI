import type { SpineCapability } from "../contracts.ts";

/** Metadata for existing server-client reads, not new CRM authority. Chat's
 * workspace-admin admission, per-tool caller-JWT workspace revalidation and
 * server-derived tenant filters remain required. These are NOT caller-JWT DB clients.
 * Optional email filters use the incumbent administrative identity lookup.
 */
export const CRM_OPERATOR_READ_CAPABILITIES = [
  { key: "crm_clients.search_contacts", domain: "crm_clients", tool: "crm_search_contacts" },
  { key: "crm_clients.contact_summary", domain: "crm_clients", tool: "crm_get_contact_summary" },
  { key: "crm_clients.list_tasks", domain: "crm_clients", tool: "crm_list_tasks" },
  { key: "sales.crm_list_deals", domain: "sales", tool: "crm_list_deals" },
  { key: "sales.crm_pipeline_summary", domain: "sales", tool: "crm_pipeline_summary" },
].map(({ key, domain, tool }) => ({
  key, domain, owner: "paige-crm-operator-reads", humanSurface: "PAIGE workspace",
  readiness: "none", selfDescribe: true,
  action: { classification: "read", executor: "edge.paige-ai-chat", chatTool: tool,
    seatAuthority: "workspace-admin", idempotency: "Existing server-bound service-client read; per-tool caller workspace revalidation and server tenant filters. No write/retry receipt or atomic snapshot is claimed.",
    riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
