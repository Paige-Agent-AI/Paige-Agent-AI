import type { SpineCapability } from "../contracts.ts";
import { classifyAction } from "../../action-risk.ts";
/** Existing business-record writers only. These declarations grant no permission,
 * issue no receipts, and do not enable execution while INT-346 is held. */
const entries = [
 { key:"crm_clients.author_event_kind", tool:"author_event_kind", executor:"public.upsert_tenant_event_kind", seat:"member", domain:"crm_clients",
   replay:"Caller-JWT RPC independently requires current workspace admin and refuses reserved or conflicting slugs; member metadata preserves the incumbent Chat gate, never grants that narrower SQL permission." },
 { key:"crm_clients.add_note", tool:"crm_add_note", executor:"edge.paige-ai-chat", seat:"workspace-admin", domain:"crm_clients",
   replay:"Caller-JWT client lookup checks the server-resolved tenant; client_notes insert retains author identity and internal visibility under RLS. Repeated calls can add another note; there is no request-key receipt." },
 { key:"crm_clients.file_document", tool:"crm_file_document", executor:"edge.paige-ai-chat", seat:"workspace-admin", domain:"crm_clients",
   replay:"Caller-JWT source file and destination client reads enforce server tenant, and refuse client-upload provenance changes before client_files update. Identical routing may preserve final fields but shared visibility exposes content and is not reversible delivery." },
 { key:"crm_clients.update_client_data", tool:"update_client_data", executor:"edge.paige-write-back", seat:"member", domain:"crm_clients",
   replay:"Caller JWT is sent to paige-write-back with the already authorized focused client or authenticated user; model input supplies fields, never target actor. Repeated writes may change timestamps or ancillary data; no operation-key proof is supplied by Chat." },
 { key:"sales.pipeline_configure", tool:"pipeline_configure", executor:"public.configure_tenant_pipeline_as_paige", seat:"workspace-admin", domain:"sales",
   replay:"Server-resolved workspace and authenticated requested_by are passed to the protected service RPC; interactive human resume uses configure_tenant_pipeline with caller JWT. Existing command idempotency key and archive confirmation tokens remain canonical; missing responses require original-operation readback, never guessed failure." },
] as const;
export const C0B_CLIENT_WRITE_CAPABILITIES = entries.map(({key,tool,executor,seat,domain,replay}) => {
 const risk = classifyAction(tool);
 if(risk!=="ordinary"&&risk!=="high") throw Error(`Unsupported incumbent write risk: ${tool}`);
 return {key,domain,owner:"paige-business-records",humanSurface:"PAIGE workspace",selfDescribe:true,readiness:"none",
  action:{classification:"mutate",executor,chatTool:tool,seatAuthority:seat,riskPolicyKey:risk,approvalAuthority:"chat-canonical",idempotency:replay+" No blind retry after an uncertain business-record write."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",maturity:"PARTIAL",sharedPrimitiveChange:"NONE"} as const satisfies SpineCapability;
});