import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// HOSTED COPIES of published pages (EXP06 WEB-05, owner direction 2026-10-28 `88b2f756`):
// deploy the portable export of an ALREADY-published page to Cloudflare Workers Static
// Assets under a PAIGE-held account, verify the real HTTPS address against the export's
// bytes, and take it down again. The page itself and its reserved address are untouched —
// a hosted copy is a copy, never a move (the Studio guidance has promised exactly this
// since #2988). This domain declares the two governed acts; the edge function
// `growth-hosting-command` is the one executor. Nothing here rewires paige-ai-chat —
// chat admission is a later slice behind EXP08's A2 seam.
//
// DORMANT BY DESIGN (the honest state the whole lane ships in): no platform Cloudflare
// token exists yet — provider activation is HELD by the owner (`88b2f756`; the corrected
// service-enable decision names the account identity + token as the owner's ONE concrete
// decision at activation). Until then every path through the door refuses with
// `hosting_not_enabled` and the copy the product already shows ("hosting isn't switched
// on yet"). The risk policy (action-risk.ts, both keys `high`) is live NOW, so nothing
// about the hold weakens the governance.
//
// THE AUTHORITY MODEL (mirrors the publish kit): the workspace owner or an admin of the
// active workspace (resolveStudioCaller), never a member, never a caller-named tenant.
// Both acts are `high` + `confirm` through the same paige_pending_confirmations
// fingerprint lane the publish door uses; the per-customer approval is the customer's own
// card — platform-owner enablement and a customer's page-publication approval are two
// different doors (owner review 80189cce).

// REGISTRY NOTE (enforced by scripts/ci/paige-spine-registry-lint.mjs): a MUTATING capability
// joins PAIGE_SPINE_CAPABILITIES only when its Chat binding is LIVE. The hosting acts are
// door-governed in THIS slice (the Studio host path reaches the door; the kit map below is what
// the door executes against) — the registry entries land WITH the chat-admission slice, which is
// also when chatTool goes from UNAVAILABLE to real. Nothing here weakens the governance: both
// action-risk keys are live and the Kit gate refuses an unregistered act the door never declares.

// Governed declarations (capability kit) — the entries the growth-hosting-command door hands to
// decideDeclaredCapability. They throw if a declared risk contradicts action-risk.ts, which is the
// point: the door cannot run an act the risk policy has not already classified.
const HOSTING_SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const HOSTING_AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const HOSTING_RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;

export const GROWTH_HOSTING_DEPLOY_CAPABILITY = defineCapability({
  identity: {
    id: "growth_hosting.deploy",
    version: 1,
    domain: "growth_hosting",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description:
      "Put the portable export of an already-published page on external static hosting, and verify the real HTTPS address against the exported bytes before it is called live. The page's own address is untouched — a hosted copy is a copy, never a move.",
  },
  input: objectInputSchema({
    description: "Deploy a published page's portable export to external static hosting.",
    properties: {
      page_id: { type: "string", format: "uuid" },
    },
    required: ["page_id"],
  }),
  effect: "external_effect",
  governance: {
    actionRiskKey: "growth_hosting_deploy",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_hosting.deploy.execute"),
  },
  tenantScope: HOSTING_SCOPE,
  availability: HOSTING_AVAILABILITY,
  providerBinding: {
    kind: "internal",
    operation: "edge.growth-hosting-command/deploy",
    connectionResolver: null,
  },
  idempotency: {
    mode: "required",
    key:
      "tenant + page. One deployment per page: deploying an already-live export re-deploys the same bytes to the same deployment name and re-verifies (the URL is stable); the confirmation fingerprint is the execute-once guard, and a provider call with an uncertain outcome is never auto-retried — the row stays unverified until a human re-runs.",
    readback: "the deployment row: provider url + export sha256 + verified_at set only after the real HTTPS fetch matched the exported bytes",
    replay: "return_recorded_result",
  },
  receipt: HOSTING_RECEIPT,
  outcome: { projector: "capability-record" },
});

export const GROWTH_HOSTING_RECOVER_CAPABILITY = defineCapability({
  identity: {
    id: "growth_hosting.recover",
    version: 1,
    domain: "growth_hosting",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description:
      "Take a page's hosted copy down (one step: remove the deployment). The page's own published version keeps running at its reserved address the whole time.",
  },
  input: objectInputSchema({
    description: "Remove a page's hosted copy from external static hosting.",
    properties: {
      page_id: { type: "string", format: "uuid" },
    },
    required: ["page_id"],
  }),
  effect: "external_effect",
  governance: {
    actionRiskKey: "growth_hosting_recover",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_hosting.recover.execute"),
  },
  tenantScope: HOSTING_SCOPE,
  availability: HOSTING_AVAILABILITY,
  providerBinding: {
    kind: "internal",
    operation: "edge.growth-hosting-command/recover",
    connectionResolver: null,
  },
  idempotency: {
    mode: "required",
    key:
      "tenant + page. Removing a removed deployment converges on 'no hosted copy'; the confirmation fingerprint is the execute-once guard; an uncertain provider outcome marks the row removed_unconfirmed rather than silently re-firing the delete.",
    readback: "the deployment row's status (removed / removed_unconfirmed) and the absence of a live provider URL",
    replay: "return_recorded_result",
  },
  receipt: HOSTING_RECEIPT,
  outcome: { projector: "capability-record" },
});

/**
 * The growth-hosting-command door's declared acts, exactly as STUDIO_PUBLISH_KIT_BY_ACTION is for the
 * publish door. One lookup for every act the door may run; decideDeclaredCapability refuses a key
 * with no entry, and scripts/ci/action-risk-lint.mjs requires the door to bind this map.
 */
export const GROWTH_HOSTING_KIT_BY_ACTION = {
  growth_hosting_deploy: GROWTH_HOSTING_DEPLOY_CAPABILITY,
  growth_hosting_recover: GROWTH_HOSTING_RECOVER_CAPABILITY,
} as const;
