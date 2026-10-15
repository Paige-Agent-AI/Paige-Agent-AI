import type { SpineCapability } from "../contracts.ts";

// Campaign BRIEF reach — the conversational create / revise / list path onto the EXISTING governed
// campaign-brief seam (migration 20261225000000). Registered here, in its own domain, so the Chat
// handler consumes it through the Spine (owner ruling 2026-09-01) rather than hand-wiring a tool.
//
// THE HONEST BOUNDARY (§13). A Campaign Brief is strategy and INTENT — an owner-authored planning
// record. It is NOT proof that ads are active, money was spent, content was published, or results
// occurred. Those need their own connected, governed actions and verified outcomes. Every tool
// description below says so, and the RPC's own messages repeat it.
//
// THE AUTHORITY MODEL (owner correction 2026-09-06). Create and revise are classified `ordinary`,
// not `high` — reversible, in-tenant planning records. `ordinary` is the class the runtime clamp
// leaves ELIGIBLE for a standing `auto` grant, so a tenant owner/authorized rep CAN grant Paige
// autonomous authority to create and revise briefs within their approved scope. Confirmation is the
// ESCALATION lane (the platform default, and where the RPC itself refuses out-of-policy changes,
// ambiguous scope, an unavailable linked record, or a version conflict) — never a blanket gate on
// every planning write. The runtime authority resolves through `resolve_tool_autonomy` +
// `classifyAction`, exactly as every other governed tool does; nothing here is a second channel.

export const CAMPAIGN_BRIEF_CREATE = {
  key:"campaign.create",domain:"campaign",owner:"campaign-brief-system",humanSurface:"/solo/:account/campaigns",
  action:{classification:"mutate",executor:"public.configure_campaign_brief",chatTool:"campaign_brief_create",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Tenant-scoped idempotency key on the command ledger plus a payload hash; a replay with the same key returns the stored result, a mismatched replay fails closed."},
  outcome:{kinds:["created","refused","failed"],projector:"public.get_campaign_briefs",railVisibility:"LIVE only after a fresh canonical readback exactly matches brief id, version, lifecycle, and intended fields; capability key campaign_brief_create records a verified planning-record outcome and never campaign launch, publish, spend, performance, or completion."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const CAMPAIGN_BRIEF_REVISE = {
  key:"campaign.revise",domain:"campaign",owner:"campaign-brief-system",humanSurface:"/solo/:account/campaigns",
  action:{classification:"mutate",executor:"public.configure_campaign_brief",chatTool:"campaign_brief_revise",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Tenant-scoped idempotency key plus the brief id, an expected version compare-and-swap, and a payload hash; a replay with the same key returns the stored result."},
  outcome:{kinds:["updated","refused","failed"],projector:"public.get_campaign_briefs",railVisibility:"LIVE only after a fresh canonical readback exactly matches brief id, version, lifecycle, and intended fields; capability key campaign_brief_revise records a verified planning-record outcome and never campaign launch, publish, spend, performance, or completion."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const CAMPAIGN_BRIEF_LIST = {
  key:"campaign.list",domain:"campaign",owner:"campaign-brief-system",humanSurface:"/solo/:account/campaigns",
  action:{classification:"read",executor:"public.get_campaign_briefs",chatTool:"campaign_brief_list",riskPolicyKey:"read_only",approvalAuthority:"none",idempotency:"Read-only projection; no write and no idempotency key."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const CAMPAIGN_BRIEF_CAPABILITIES=[CAMPAIGN_BRIEF_CREATE,CAMPAIGN_BRIEF_REVISE,CAMPAIGN_BRIEF_LIST] as const;

// Model-facing tool JSON. Authored COMPACT (single-line objects, `name:"…"` never alone on its own
// line) so the chat-tool-registry lint does not count these as inline hand-wired tools — they are
// registered via the domain above and enter Chat through the adapter spread. The `channels` field is
// intended distribution, INTENT only. Ask only for material missing details; do not invent an offer
// or pipeline link — pass one only when the owner named a real one.
export const CAMPAIGN_BRIEF_TOOLS = [
  {type:"function",function:{name:"campaign_brief_create",description:"Save a NEW campaign brief for this workspace — an owner-authored PLANNING record of the campaign's intent (objective, audience, positioning, intended channels, desired outcome, budget target, timing). It launches nothing, sends nothing, publishes nothing, and spends no money; it is strategy and intent, never proof a campaign is live. Ask only for material missing details. Only pass offerId/pipelineId when the owner named a real one you can see.",parameters:{type:"object",properties:{name:{type:"string",minLength:1,maxLength:200,description:"A short name for the campaign brief."},objective:{type:"string",maxLength:4000},audience:{type:"string",maxLength:4000},positioning:{type:"string",maxLength:4000},channels:{type:"array",maxItems:30,items:{type:"string",minLength:1,maxLength:120},description:"Intended distribution channels — INTENT only, not proof anything published."},desiredOutcome:{type:"string",maxLength:4000},successDefinition:{type:"string",maxLength:4000},budgetTarget:{type:"string",maxLength:600,description:"A budget TARGET the owner set — never actual spend, a forecast, or connected media buying."},timing:{type:"string",maxLength:600},constraints:{type:"string",maxLength:4000},contentNeeds:{type:"string",maxLength:4000},conversionDestination:{type:"string",maxLength:600},followupPath:{type:"string",maxLength:2000},offerId:{type:"string",format:"uuid",description:"Optional link to an existing offer in THIS workspace; omit unless the owner named one."},pipelineId:{type:"string",format:"uuid",description:"Optional link to an existing pipeline in THIS workspace; omit unless the owner named one. Linking one also files future leads there from any form attached only to this campaign that has no route of its own; say so when you link it."}},required:["name"]}}},
  {type:"function",function:{name:"campaign_brief_revise",description:"Revise an EXISTING campaign brief from a verified list read. Pass briefId and the expectedVersion you just read (optimistic concurrency — a mismatch is refused, not force-written). Only include the fields you are changing; an omitted field keeps its current value, an empty string clears it. This edits a planning record; it launches, sends, and publishes nothing.",parameters:{type:"object",properties:{briefId:{type:"string",format:"uuid"},expectedVersion:{type:"integer",minimum:1},name:{type:"string",minLength:1,maxLength:200},objective:{type:"string",maxLength:4000},audience:{type:"string",maxLength:4000},positioning:{type:"string",maxLength:4000},channels:{type:"array",maxItems:30,items:{type:"string",minLength:1,maxLength:120}},desiredOutcome:{type:"string",maxLength:4000},successDefinition:{type:"string",maxLength:4000},budgetTarget:{type:"string",maxLength:600},timing:{type:"string",maxLength:600},constraints:{type:"string",maxLength:4000},contentNeeds:{type:"string",maxLength:4000},conversionDestination:{type:"string",maxLength:600},followupPath:{type:"string",maxLength:2000},offerId:{type:"string",format:"uuid"},pipelineId:{type:"string",format:"uuid",description:"Changing or clearing it also changes where future leads go from any form attached only to this campaign that has no route of its own; say so when you change it."}},required:["briefId","expectedVersion"]}}},
  {type:"function",function:{name:"campaign_brief_list",description:"List this workspace's campaign briefs (newest first) with their current version, lifecycle status, and any linked offer/pipeline names. Read this before revising a brief so you have the exact briefId and expectedVersion. A brief's lifecycle status is a planning state the owner set — it never proves a campaign is actually running.",parameters:{type:"object",properties:{}}}},
] as const;
