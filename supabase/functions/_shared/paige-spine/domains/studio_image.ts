import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Publishing and unpublishing an IMAGE Vibe Studio made (Migration E, 2026-10-04). Its own domain
// because the act is the Studio publish lifecycle, not saving copy to the content library
// (marketing_content.ts), even though the image is a marketing_content row (kind `image`).
//
// Both run through the growth-publish-command door for the Studio panel and the chat alike; no chat
// tool carries either name. So, like the human-only invoice link (sales_invoice.ts), they are declared
// through the capability kit and NOT as SpineCapability entries: the Spine validator requires every
// mutating entry to name a LIVE chat tool, and claiming one here would be false. The door binds these
// declarations through STUDIO_PUBLISH_KIT_BY_ACTION (studio_publish.ts) and decideDeclaredCapability.
//
// THE RPCs (20270537000000). studio_image_publish marks a finished image published and returns its
// URL; it refuses anything that is not a finished image, and an archived one. studio_image_unpublish
// returns a published image to draft. Only these two functions may change an image's publish state or
// swap a published image's file (the marketing_content publish guard). Who may do either is decided
// server-side (_growth_admin_tenant): the workspace owner or an admin of the active tenant, or the
// agency that manages that sub-account; never a member, never a global role.
//
// `high`, both: publishing puts an image in the Catalog where anyone with its link can see it, and
// unpublishing withdraws one people may already be using. The runtime clamp keeps both ask-first.
//
// IDEMPOTENCY, honestly (§13). Unpublish converges (an image that is not published comes back with its
// status and nothing changes). Publish re-marks the row published and moves published_at to now, so a
// replay changes only that timestamp.
const IMAGE_SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const IMAGE_AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const IMAGE_RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;

export const STUDIO_IMAGE_PUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "studio_image.publish",
    version: 1,
    domain: "studio_image",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Publish a finished image to the Catalog, where anyone with its link can see it.",
  },
  input: objectInputSchema({
    description: "Publish a finished image.",
    properties: { image_id: { type: "string", format: "uuid" } },
    required: ["image_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "studio_image_publish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("studio_image.publish.execute"),
  },
  tenantScope: IMAGE_SCOPE,
  availability: IMAGE_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.studio_image_publish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the image's own state. Publishing marks it published; a replay marks it published again and moves published_at to the latest publish.",
    readback: "public.studio_image_publish",
    replay: "return_recorded_result",
  },
  receipt: IMAGE_RECEIPT,
  outcome: { projector: "capability-record" },
});

export const STUDIO_IMAGE_UNPUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "studio_image.unpublish",
    version: 1,
    domain: "studio_image",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Withdraw a published image from the Catalog.",
  },
  input: objectInputSchema({
    description: "Unpublish a published image.",
    properties: { image_id: { type: "string", format: "uuid" } },
    required: ["image_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "studio_image_unpublish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("studio_image.unpublish.execute"),
  },
  tenantScope: IMAGE_SCOPE,
  availability: IMAGE_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.studio_image_unpublish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the image's own state. Unpublishing an image that is not published returns its current status and changes nothing, so a replay converges.",
    readback: "public.studio_image_unpublish",
    replay: "return_recorded_result",
  },
  receipt: IMAGE_RECEIPT,
  outcome: { projector: "capability-record" },
});
