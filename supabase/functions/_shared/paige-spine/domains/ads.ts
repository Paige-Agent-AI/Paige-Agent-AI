import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Ads from chat: PAIGE reads how the business's campaigns and ads are doing in Sales, and features a picture
// in the Ads showroom. Both run the SAME server functions the Ads department calls
// (20271021042001_ads_intake_default_pipeline_and_lead_funnel.sql), on the signed-in person's own session, so
// the database decides who may: the business's owner or an admin, the agency working in it, or the platform
// owner (§59, in-body). There is no chat-only funnel and no chat-only showroom.
//
// WHAT THE READ IS. Counts only, from this business's own forms and Sales pipeline: current deals per stage,
// and form leads per campaign tag (utm_campaign) and per ad tag (utm_content), each deal attributed to its
// last tagged touch. There is NO ad-provider data behind it — no impressions, clicks, spend or cost — and it
// must never be described as if there were (§13).
//
// WHAT THE WRITE IS. One library picture or video marked (or unmarked) as featured in the showroom
// (marketing_content.meta.ads_featured), at most six at once. In-business and reversible; it publishes,
// sends and spends nothing. `ordinary` in action-risk.ts, so the chat's one approval gate asks first unless
// the owner has given PAIGE autonomy for it. No ad account, campaign, publishing or spend is reachable here.
//
// The model-facing tool JSON and the dispatcher live in _shared/ads-funnel-chat.ts.

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const;
const receipt = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;
const surface = "/solo/:account/ads";
const uuid = { type: "string", format: "uuid" } as const;

export const ADS_LEAD_FUNNEL_READ_CAPABILITY = defineCapability({
  identity: { id: "ads.lead_funnel", version: 1, domain: "ads", owner: "ads", humanSurface: surface,
    description: "Count this business's leads by Sales pipeline stage per campaign tag and per ad tag, with won and lost deals; counts only, no names, and no ad-provider figures." },
  input: objectInputSchema({
    description: "Which Sales pipeline and how far back.",
    properties: {
      pipeline_id: { ...uuid, description: "A Sales pipeline id. Leave it out to use the business's default pipeline." },
      days: { type: "integer", minimum: 7, maximum: 365, description: "Exactly 7, 30, 90 or 365: count leads from that many days back. Leave it out for all time. Deals per stage are always current." },
    },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("ads.lead_funnel.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.get_pipeline_lead_funnel", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt,
  outcome: { projector: "capability-record" },
});

export const ADS_CREATIVE_FEATURE_CAPABILITY = defineCapability({
  identity: { id: "set_ad_creative_featured", version: 1, domain: "ads", owner: "ads", humanSurface: surface,
    description: "Feature one picture or video from this business's library in the Ads showroom, or take it out; at most six at once. Nothing is published, sent or spent." },
  input: objectInputSchema({
    description: "Feature or unfeature one library picture or video.",
    properties: {
      content_id: { ...uuid, description: "The library id of the picture or video." },
      featured: { type: "boolean", description: "true to feature it in the Ads showroom, false to take it out." },
    },
    required: ["content_id", "featured"],
  }),
  effect: "mutation",
  governance: { actionRiskKey: "set_ad_creative_featured", risk: "ordinary", approval: "confirm", requiredPermission: ownerGrantablePermission("set_ad_creative_featured.execute") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.set_ad_creative_featured", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "The picture and the wanted state: setting the same state again converges on it (only the featured-at time moves), so a retry never features a second item.",
    readback: "public.marketing_content (meta.ads_featured read back on the caller's own session)",
    replay: "reconcile_then_return",
  },
  receipt,
  outcome: { projector: "capability-record" },
});

export const ADS_LEAD_FUNNEL = {
  key: "ads.lead_funnel", domain: "ads", owner: "ads", humanSurface: surface, readiness: "none",
  action: { classification: "read", executor: "public.get_pipeline_lead_funnel", chatTool: "get_pipeline_lead_funnel", seatAuthority: "workspace-admin",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Read-only counts on the caller's own session; the active business is checked before and after, and a pipeline outside it is refused before the read." },
  outcome: { kinds: ["available", "no_pipeline", "needs_input", "refused", "unavailable"], projector: "public.get_pipeline_lead_funnel", railVisibility: "Read only; no Rail write. Counts, never names." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const ADS_CREATIVE_FEATURE = {
  key: "ads.creative_feature", domain: "ads", owner: "ads", humanSurface: surface, readiness: "none",
  action: { classification: "mutate", executor: "public.set_ad_creative_featured", chatTool: "set_ad_creative_featured", seatAuthority: "workspace-admin",
    riskPolicyKey: "ordinary", approvalAuthority: "chat-canonical",
    idempotency: "Convergent: the same picture and state set again lands on the same featured state; the Chat confirmation fingerprint is the execute-once guard." },
  outcome: { kinds: ["updated", "refused", "outcome_unknown"], projector: "public.set_ad_creative_featured",
    railVisibility: "Recorded after a fresh read shows the picture featured or taken out as asked; nothing was published, sent or spent." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const ADS_CAPABILITIES = [ADS_LEAD_FUNNEL, ADS_CREATIVE_FEATURE] as const;
