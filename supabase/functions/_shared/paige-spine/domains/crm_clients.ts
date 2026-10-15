import type { SpineCapability } from "../contracts.ts";

// Existing file METADATA and safe activity reads. No file body/path/signed URL,
// new contact access, department write or new activity producer is introduced.
export const CRM_CLIENT_READ_CAPABILITIES = [
  { key: "crm_clients.list_documents", tool: "crm_list_documents", executor: "edge.paige-ai-chat", seat: "workspace-admin" },
  { key: "crm_clients.client_rail", tool: "get_client_rail", executor: "public.get_client_rail_for_chat", seat: "member" },
  { key: "crm_clients.event_kinds", tool: "list_event_kinds", executor: "public.list_event_kinds", seat: "member" },
].map(({ key, tool, executor, seat }) => ({
  key, domain: "crm_clients", owner: "paige-client-reads", humanSurface: "PAIGE workspace", readiness: "none", selfDescribe: true,
  action: { classification: "read", executor, chatTool: tool, seatAuthority: seat as "member" | "workspace-admin",
    idempotency: "existing caller-JWT tenant-safe read; no rows written", riskPolicyKey: "read_only", approvalAuthority: "none" },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability));
