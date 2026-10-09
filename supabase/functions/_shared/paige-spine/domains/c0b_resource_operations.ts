import type { SpineCapability } from "../contracts.ts";
/** Existing callable adapters only. LIVE names the incumbent code binding, not
 * provider availability, authenticated acceptance or C4e durable adoption. Read
 * classification preserves the existing policy even when a provider is consulted
 * or a research run is persisted. No executor or authority is introduced here. */
export const C0B_RESOURCE_OPERATION_CAPABILITIES = ([
  { tool:"deep_research", domain:"research_knowledge", executor:"edge.paige-ai-chat", classification:"read", risk:"read_only", admin:false, visible:true, readiness:"research_provider",
    replay:"Existing direct service-auth paige-deep-research call with verified user.id, persist:true and incumbent max_hops/wall-clock bounds. Provider calls, analytics and persisted research runs/sources are real effects; repeated requests can create new runs and spend. No exactly-once receipt, durable preparation handoff or C4e completion is claimed." },
  { tool:"web_search", domain:"research_knowledge", executor:"edge.paige-ai-chat", classification:"read", risk:"read_only", admin:false, visible:true, readiness:"research_provider",
    replay:"Existing service-auth paige-web-search query consults the configured external search provider and emits analytics. Repeated reads may spend and change results; no provider availability, snapshot or no-I/O claim." },
  { tool:"web_fetch", domain:"research_knowledge", executor:"edge.paige-ai-chat", classification:"read", risk:"read_only", admin:false, visible:true, readiness:"none",
    replay:"Existing caller-JWT fetch-url-content performs a bounded SSRF-guarded outbound public HTTPS fetch. Untrusted content and provenance are fenced before model readback; repeated reads may differ and no immutable snapshot is claimed." },
  { tool:"save_to_knowledge_base", domain:"research_knowledge", executor:"edge.paige-ai-chat", classification:"mutate", risk:"ordinary", admin:false, visible:true, readiness:"none",
    replay:"Existing caller-JWT kb-ingest-doc stores workspace-private reference material and invokes the incumbent embedding provider. No request-key receipt or full-operation exactly-once guarantee; failed or zero-chunk ingestion remains failure, not searchable success." },
  { tool:"automation_draft", domain:"automations", executor:"edge.paige-ai-chat", classification:"mutate", risk:"ordinary", admin:false, visible:true, readiness:"none",
    replay:"Existing caller-JWT automation and ordered acts inserts are pinned to state draft and granted_lane confirm. It dispatches nothing and grants no auto lane. No operation receipt; failed step insertion uses checked best-effort shell cleanup and may report uncertain rollback." },
  { tool:"comms_connection_summary", domain:"communications", executor:"public.tenant_comms_readiness", classification:"read", risk:"read_only", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT tenant_comms_readiness and list_tool_autonomy reads project named readiness fields after server workspace resolution. No connector secrets, immutable snapshot or provider availability guarantee." },
  { tool:"comms_registration_status", domain:"communications", executor:"public.tenant_comms_readiness", classification:"read", risk:"read_only", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT workspace readiness read projects registration status and blockers. Filing with the carrier is explicitly unavailable; a saved draft is not an approved registration or sending permission." },
  { tool:"comms_list_numbers", domain:"communications", executor:"edge.paige-ai-chat", classification:"read", risk:"read_only", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT tenant_phone_numbers read selects named safe fields with an explicit server-resolved tenant filter, including platform operators. No provider lookup or write occurs in this branch; row-order ambiguity is reported honestly." },
  { tool:"comms_search_numbers", domain:"communications", executor:"edge.paige-ai-chat", classification:"read", risk:"read_only", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT comms-search-numbers invokes the external inventory provider and returns named number and retail-price fields. Inventory and price may change; lookup is not purchase and no no-I/O or reservation guarantee is claimed." },
  { tool:"comms_buy_number", domain:"communications", executor:"edge.paige-ai-chat", classification:"external_effect", risk:"high", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT comms-purchase-number binds the approved monthly price and may buy a provider number, create a recurring charge and persist workspace state. Purchased/already_owned differ from failure; money_already_spent and unknown partial outcomes prohibit blind retry. No atomic provider/database or exactly-once operation guarantee." },
  { tool:"comms_draft_registration", domain:"communications", executor:"edge.paige-ai-chat", classification:"mutate", risk:"ordinary", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT comms-a2p-draft invokes the configured model and saves draft carrier copy. No operation receipt or blind-retry guarantee. submitted:false and filing_with_carrier_is_not_built remain explicit; drafting submits no carrier registration and sends no message." },
  { tool:"comms_name_number", domain:"communications", executor:"public.tenant_phone_number_rename", classification:"mutate", risk:"ordinary", admin:true, visible:false, readiness:"none",
    replay:"Existing caller-JWT scoped rename RPC changes the workspace number label. Repeated final fields may agree but there is no request-key receipt, expected-version guard or full-operation replay guarantee." },
  { tool:"comms_set_primary_number", domain:"communications", executor:"public.tenant_phone_number_set_primary", classification:"mutate", risk:"high", admin:true, visible:true, readiness:"none",
    replay:"Existing caller-JWT scoped primary-number RPC changes the sending identity future calls and texts use. No request-key receipt or expected-version guard; concurrent selection is not safe blind retry and this metadata grants no sending authority." },
] as const).map(({tool,domain,executor,classification,risk,admin,visible,readiness,replay})=>({
  key:`${domain}.${tool}`,domain,owner: domain === "communications" ? "tenant-comms" : domain === "automations" ? "paige-automations" : "paige-research-knowledge",
  humanSurface:"PAIGE workspace",selfDescribe:visible,readiness,
  action:{executor,chatTool:tool,classification,riskPolicyKey:risk,seatAuthority:admin?"workspace-admin":"member",
    approvalAuthority:classification==="read"?"none":"chat-canonical",idempotency:replay},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability));
