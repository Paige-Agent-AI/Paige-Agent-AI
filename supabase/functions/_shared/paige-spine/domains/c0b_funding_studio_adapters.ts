import type { SpineCapability } from "../contracts.ts";

/** Incumbent business-effect classifications are preserved. A read descriptor is
 * not a claim of zero provider calls, model accounting, shared cache writes or
 * conversation persistence. Saving/publishing a Studio business artifact remains a
 * separate act. Readiness none preserves the incumbent metadata; it does not assert
 * provider setup. The funding marketplace scaffold remains hidden and unavailable.
 */
export const C0B_FUNDING_STUDIO_CAPABILITIES = ([
  { key: "funding_optin.current_rates", tool: "get_current_rates", domain: "funding_optin", owner: "paige-funding",
    classification: "read", seatAuthority: "member", selfDescribe: true, scaffold: false,
    idempotency: "Reads the shared economic_rates_cache; a stale cache invokes fetch-economic-rates, calls the existing rate provider and upserts series_id cache rows. Repeat reads can refresh timestamps and incur provider I/O. No request-key receipt or zero-effect promise; missing rates remain unavailable." },
  { key: "funding_optin.marketplace_scaffold", tool: "search_funding_marketplace", domain: "funding_optin", owner: "paige-funding",
    classification: "read", seatAuthority: "member", selfDescribe: false, scaffold: true,
    idempotency: "Existing scaffold returns coming_soon with either LENDFLOW_ENABLED value. No Lendflow adapter or lender search is wired; hidden and unavailable. Repeating the placeholder supplies no provider, eligibility or prequalification evidence." },
  { key: "funding_optin.regional_lenders", tool: "search_regional_lenders", domain: "funding_optin", owner: "paige-funding",
    classification: "read", seatAuthority: "member", selfDescribe: true, scaffold: false,
    idempotency: "Existing Chat funding opt-in gate precedes trusted internal search-local-lenders public FDIC/NCUA lookup. Repeating may repeat provider I/O and return changed listings; no private client write or lending decision is represented. Provider availability is not proved by this declaration." },
  { key: "funding_optin.sba_lenders", tool: "search_sba_lenders", domain: "funding_optin", owner: "paige-funding",
    classification: "read", seatAuthority: "member", selfDescribe: true, scaffold: false,
    idempotency: "Existing funding opt-in gate forwards the caller JWT to search-sba-lenders, which authenticates the token. Repeating may perform another lender lookup; a listed lender is not an approval, quoted rate or program availability guarantee. No request-key or private business mutation is declared." },
  { key: "integrations_mcp.marketplace_browse", tool: "marketplace_browse", domain: "integrations_mcp", owner: "paige-marketplace",
    classification: "read", seatAuthority: "member", selfDescribe: true, scaffold: false,
    idempotency: "Existing marketplace_catalog_for_tenant read uses the verified Chat actor and revalidated active tenant before and after readback. It projects only safe workspace-listed facts. Listing does not install anything or prove entitlement, connection or runtime readiness; repeated browse can reflect changed catalogue state." },
  { key: "marketing.draft_content", tool: "draft_marketing_content", domain: "marketing", owner: "vibe-studio",
    classification: "read", seatAuthority: "workspace-admin", selfDescribe: true, scaffold: false,
    idempotency: "Existing caller-JWT content-draft resolves Studio caller/tenant and generates copy through the model router. Repeating can incur provider/model accounting and produce different copy; conversation results may persist. This path does not save, send or publish a content-library artifact; content_save is separate." },
  { key: "vibe_studio.ask_choices", tool: "ask_choices", domain: "vibe_studio", owner: "paige-conversation",
    classification: "read", seatAuthority: "member", selfDescribe: false, scaffold: false,
    idempotency: "Existing turn-ending choice adapter builds a bounded server-id question and emits it under canonical turn handling; question/transcript persistence and answer binding are real effects. It grants no action approval or business mutation authority. Repeat asks can receive different identifiers; no general request replay guarantee." },
  { key: "vibe_studio.generate_image", tool: "generate_image", domain: "vibe_studio", owner: "vibe-studio",
    classification: "mutate", seatAuthority: "workspace-admin", selfDescribe: true, scaffold: false,
    idempotency: "Studio uses paige-media submit with a request id derived from the thread/tool call, preserving that seam's job replay, credits and budget rules. Legacy Chat uses generate-image and anchored refinement; no universal request receipt is supplied there. Provider generation, stored image versions and anchor writes can occur; an in-progress job is not a finished image." },
  { key: "vibe_studio.funnel_generate", tool: "growth_funnel_generate", domain: "vibe_studio", owner: "vibe-studio",
    classification: "read", seatAuthority: "workspace-admin", selfDescribe: false, scaffold: false,
    idempotency: "Existing caller-JWT growth-funnel-draft composes model planning and draft adapters. Repeat calls can incur provider/model accounting, change draft output and persist conversation/preview data. The dispatcher returns an unsaved funnel preview; growth_funnel_build is the separate business artifact writer, and publication is separately governed." },
  { key: "vibe_studio.growth_list", tool: "growth_list", domain: "vibe_studio", owner: "vibe-studio",
    classification: "read", seatAuthority: "workspace-admin", selfDescribe: true, scaffold: false,
    idempotency: "Existing caller-JWT growth_pages read is explicitly pinned to the server persona tenant; a tenant-scoped slug read builds public URLs only for published pages. Repeat reads reflect current pages and publish state. Listing performs no page save or publish and grants no future execution authority." },
  { key: "vibe_studio.page_generate", tool: "growth_page_generate", domain: "vibe_studio", owner: "vibe-studio",
    classification: "read", seatAuthority: "workspace-admin", selfDescribe: false, scaffold: false,
    idempotency: "Existing caller-JWT growth-page-draft resolves Studio caller/tenant and generates through the model router. Repeat calls can incur provider/model accounting, change output and persist conversation/preview data. The dispatcher emits an unsaved page preview; growth_page_save is separate and nothing is published by this preview." },
] as const).map(({ key, tool, domain, owner, classification, seatAuthority, selfDescribe, scaffold, idempotency }) => ({
  key, domain, owner, humanSurface: "PAIGE workspace", readiness: "none", selfDescribe,
  action: { executor: "edge.paige-ai-chat", classification, chatTool: tool, seatAuthority,
    riskPolicyKey: classification === "mutate" ? "ordinary" : "read_only",
    approvalAuthority: classification === "mutate" ? "chat-canonical" : "none", idempotency },
  chatBinding: scaffold ? "UNAVAILABLE" : "LIVE", mindBinding: "UNAVAILABLE",
  sharedPrimitiveChange: "NONE", maturity: scaffold ? "UNAVAILABLE" : "PARTIAL",
} as const satisfies SpineCapability));
