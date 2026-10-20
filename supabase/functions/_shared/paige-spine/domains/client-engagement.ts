import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Experience 04 E4-S2 (ANT-51 / ANT-147): PAIGE answers "where does this client stand?" and tells the
// owner what business time zone is configured, from the SAME governed reads the product already owns.
//
//   client.engagement_status — public.find_clients_for_status resolves the client the owner named,
//     then public.read_client_engagement_status reads terms, signing, invoices by evidence class,
//     payment requests and delivery work. The shared composer (_shared/client-engagement/status.ts)
//     classifies them; the chat tool only projects the result. Both functions run on the signed-in
//     person's OWN session and re-prove the active workspace and the owner/admin seat in their bodies.
//   business.time_zone — public.read_business_time_zone returns the persisted zone and whether this
//     caller may change it. It can also check a zone PAIGE resolved from the owner's words, so she
//     can ask the owner to confirm the exact IANA name before they save it.
//
// READ-ONLY. Neither capability writes business state, and neither SQL read writes a receipt (E4-S3 PR
// beta): PAIGE's chat answer is recorded once by the paige-ai-chat executor. The zone is saved only by the owner through Setup, which
// calls public.set_business_time_zone (owner-only, E4-S1b). PAIGE never claims to have saved it.
// Under INT-346's staged rollout both tools are admitted to conversational turns by the E4-S2
// determination (docs/delivery/e2-1-readonly-admission-determination.md), recorded with its review.

const scope = { source: "server", tenantResolver: "current_user_tenant_id", actorResolver: "authenticated_user", revalidateAt: ["before_availability", "before_execution", "before_receipt"] } as const;
const availability = { resolver: "paige-capability-status", states: ["live", "needs_approval", "not_for_tier", "unavailable"] } as const;
const surface = "/solo/:account";

export const CLIENT_ENGAGEMENT_STATUS_READ_CAPABILITY = defineCapability({
  identity: { id: "client.engagement_status", version: 1, domain: "client", owner: "sales", humanSurface: surface,
    description: "Where one client stands: agreement and installment terms, payments kept apart by evidence (provider-verified, recorded by the owner, test), what is outstanding and genuinely overdue, payment requests in flight and delivery work. Owner/admin seat; no action authority." },
  input: objectInputSchema({
    description: "Which client of this business to read.",
    properties: {
      client: { type: "string", maxLength: 120, description: "The client's name, business name, or full email address, as the owner said it." },
      client_id: { type: "string", maxLength: 36, description: "The client id from an earlier answer, when the owner picked one of several matches. Use it instead of client." },
    },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("client.engagement_status.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.read_client_engagement_status", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const BUSINESS_TIME_ZONE_READ_CAPABILITY = defineCapability({
  identity: { id: "business.time_zone", version: 1, domain: "business", owner: "business", humanSurface: surface,
    description: "The business time zone used to judge payment due dates: configured, missing or invalid, and whether this person may change it. Optionally checks a proposed IANA zone before the owner saves it in Setup. Owner/admin seat; no action authority." },
  input: objectInputSchema({
    description: "Optionally, a zone to check before the owner saves it.",
    properties: {
      proposed_zone: { type: "string", maxLength: 64, description: "An IANA zone name you resolved from the owner's words, for example America/Chicago for Chicago or Dallas. Leave it out to read the current setting only." },
    },
    required: [],
  }),
  effect: "read",
  governance: { actionRiskKey: null, risk: "read_only", approval: "none", requiredPermission: ownerGrantablePermission("business.time_zone.read") },
  tenantScope: scope,
  availability,
  providerBinding: { kind: "internal", operation: "public.read_business_time_zone", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});

export const CLIENT_ENGAGEMENT_STATUS = {
  key: "client.engagement_status", domain: "client", owner: "sales", humanSurface: surface, readiness: "none",
  action: { classification: "read", executor: "public.read_client_engagement_status", chatTool: "read_client_engagement_status", seatAuthority: "workspace-admin",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Read-only on the caller's own session. The lookup and the read each re-check the active workspace and the owner/admin seat and write nothing. PAIGE's answered chat question records one capability receipt, at the executor (service role, once per tool call); the client record and other display reads record none. Only the bounded projection reaches the model." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.read_client_engagement_status",
    railVisibility: "One capability receipt per answered chat question (\"Checked where a client stands\", credited to PAIGE). A read is not a business action or settlement receipt." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const BUSINESS_TIME_ZONE = {
  key: "business.time_zone", domain: "business", owner: "business", humanSurface: surface, readiness: "none",
  action: { classification: "read", executor: "public.read_business_time_zone", chatTool: "read_business_time_zone", seatAuthority: "workspace-admin",
    riskPolicyKey: "read_only", approvalAuthority: "none",
    idempotency: "Read-only on the caller's own session; the read itself writes nothing. PAIGE's answered chat question records one capability receipt, at the executor (service role, once per tool call); Setup and Collections record none. A proposed zone is only checked, never saved: the owner saves in Setup through public.set_business_time_zone." },
  outcome: { kinds: ["available", "needs_input", "refused", "unavailable"], projector: "public.read_business_time_zone",
    railVisibility: "One capability receipt per answered chat question (\"Checked your business time zone\", credited to PAIGE). A read is not a business action." },
  chatBinding: "LIVE", mindBinding: "UNAVAILABLE", sharedPrimitiveChange: "NONE", maturity: "PARTIAL",
} as const satisfies SpineCapability;

export const CLIENT_ENGAGEMENT_CAPABILITIES = [CLIENT_ENGAGEMENT_STATUS, BUSINESS_TIME_ZONE] as const;
