import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";
import { SNAPSHOT_DOMAINS, SNAPSHOT_PERIOD_KEYS } from "../../paige-context/snapshot.ts";

// The business operating snapshot from chat (Experience 02 / Operating Fabric F2a+F2b hand-offs).
// PAIGE answers "how is my business doing" from the SAME governed reads the fabric already owns:
// composeBusinessReview (_shared/paige-context/business-review.ts) reading every domain through the
// INT-340 metric issuer (public.issue_analytics_evidence_bundle) on the signed-in person's OWN
// session, so the database decides who may — the issuer's in-body check admits only this business's
// active owner or admin. There is no chat-only snapshot and no second data path.
//
// WHAT THE READ IS. A projection over the live domains (payments, sales_pipeline, operations,
// clients): per-currency amounts, counts, changes and risks, plus every other domain reported
// honestly as not available with its reason. A refused, unverified, partial or dropped read is
// never a zero, currencies are never summed, and nothing is invented. The model-facing tool JSON
// and the dispatcher live in _shared/paige-context/business-review-chat.ts.
//
// SHIP-DARK (E2-1). The tool is registered and dispatched, but under INT-346's staged rollout an
// ordinary typed Solo turn runs with ZERO tool exposure, so this capability is not reachable from
// a conversational turn until it is admitted under the owner-approved read-only admission class.
// chatBinding is PARTIAL for exactly that reason; it becomes LIVE when admission reaches it.

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const;
const surface = "/solo/:account";

export const BUSINESS_OPERATING_SNAPSHOT_READ_CAPABILITY = defineCapability({
  identity: { id: "business.operating_snapshot", version: 1, domain: "business", owner: "business", humanSurface: surface,
    description: "One read-only business review for this workspace: the live domains' figures, changes and risks, and every other domain reported honestly as not available with its reason. Owner/admin seat; no action authority." },
  input: objectInputSchema({
    description: "Which period and which areas of the business to review.",
    properties: {
      period: { type: "string", enum: [...SNAPSHOT_PERIOD_KEYS], description: "Default last_7_days. Calendar periods are computed in the caller's timezone; sales figures always end at the last completed UTC day." },
      custom_start: { type: "string", description: "With period 'custom': inclusive start, an ISO instant with a zone or a bare date read as local midnight in the caller's timezone." },
      custom_end: { type: "string", description: "With period 'custom': exclusive end, same formats as custom_start. Required together; the range may not be inverted, in the future, or too long." },
      focus: { type: "array", items: { type: "string", enum: [...SNAPSHOT_DOMAINS] }, maxItems: 6, description: "Areas to review by domain name (payments, sales_pipeline, operations, clients are live today). Leave it out for the default review set. A domain with no connected source is reported as not available, never skipped silently." },
    },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("business.operating_snapshot.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.issue_analytics_evidence_bundle", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  // Shared Kit metadata is a read trace contract, not permission to create an action receipt
  // (the analytics.metric_read precedent). E2-1 wires no recorder: the chat dispatch writes no
  // Rail row for this read.
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const BUSINESS_OPERATING_SNAPSHOT = {
  key: "business.operating_snapshot", domain: "business", owner: "business", humanSurface: surface, readiness: "none",
  action: { classification: "read", executor: "public.issue_analytics_evidence_bundle", chatTool: "get_business_snapshot", seatAuthority: "workspace-admin",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Read-only composition on the caller's own session. The active workspace is observed before and after composing; a switch voids every domain. Within an adapter reads run one at a time; adapters run concurrently on disjoint metric keys, and the chat corridor is serial across tools (the issuer revokes a caller's previous evidence reference per metric and range)." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.issue_analytics_evidence_bundle",
    railVisibility: "Measurement provenance only. The E2-1 chat dispatch writes no Rail row; a read is not a business action or settlement receipt." },
  // PARTIAL until the owner-approved read-only admission class admits this tool to typed Solo turns
  // (INT-346 keeps ordinary typed turns at zero tool exposure until then).
  chatBinding: "PARTIAL", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;
