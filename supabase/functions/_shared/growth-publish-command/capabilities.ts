// The governed declarations the publish door decides with (capability kit).
//
// The three chat publishes already have domain declarations (paige-spine/domains/growth_page.ts,
// growth_form.ts, growth_funnel.ts) and are reused, never redeclared. The five acts that until V2b
// only the Studio panel could perform — the three unpublishes and the image publish/unpublish — are
// declared here, next to the one door that executes them, until they earn their own Spine domain
// entries.
//
// WHY THESE FIVE ARE BUILT LAZILY. `defineCapability()` throws unless its action-risk key is
// classified in `_shared/action-risk.ts`, and it is evaluated at import. A module-level declaration
// whose key is not yet classified would therefore crash the WHOLE door on cold start — page, form and
// funnel publish included — instead of failing only the unclassified act. Building each declaration
// the first time it is asked for keeps the failure where it belongs: that one act refuses, loudly,
// and every other act still works. This is fail-closed per act, not a way round the classification.
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../capability-kit/mod.ts";
import type { DefinedCapability } from "../capability-kit/types.ts";
import { GROWTH_PAGE_PUBLISH_CAPABILITY } from "../paige-spine/domains/growth_page.ts";
import { GROWTH_FORM_PUBLISH_CAPABILITY } from "../paige-spine/domains/growth_form.ts";
import { GROWTH_FUNNEL_PUBLISH_CAPABILITY } from "../paige-spine/domains/growth_funnel.ts";

const SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;
const SURFACE = "/solo/:account/growth";

const BUILDERS: Readonly<Record<string, () => DefinedCapability>> = {
  growth_page_unpublish: () => defineCapability({
    identity: { id: "growth_page.unpublish", version: 1, domain: "growth_page", owner: "vibe-studio", humanSurface: SURFACE,
      description: "Take a live landing page offline; it goes back to a draft in the Studio and its forms stay live." },
    input: objectInputSchema({ description: "Unpublish a live landing page.", properties: { page_id: { type: "string", format: "uuid" } }, required: ["page_id"] }),
    effect: "mutation",
    governance: { actionRiskKey: "growth_page_unpublish", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("growth_page.publish.execute") },
    tenantScope: SCOPE, availability: AVAILABILITY,
    providerBinding: { kind: "internal", operation: "public.growth_page_unpublish", connectionResolver: null },
    idempotency: { mode: "required", key: "the page's own state. Unpublishing a page that is not live returns its current status and changes nothing.", readback: "public.growth_page_unpublish", replay: "return_recorded_result" },
    receipt: RECEIPT, outcome: { projector: "capability-record" },
  }),
  growth_form_unpublish: () => defineCapability({
    identity: { id: "growth_form.unpublish", version: 1, domain: "growth_form", owner: "vibe-studio", humanSurface: SURFACE,
      description: "Take a live form offline so it stops taking submissions; refused while a live page or funnel collects through it." },
    input: objectInputSchema({ description: "Unpublish a live form.", properties: { form_id: { type: "string", format: "uuid" } }, required: ["form_id"] }),
    effect: "mutation",
    governance: { actionRiskKey: "growth_form_unpublish", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("growth_form.publish.execute") },
    tenantScope: SCOPE, availability: AVAILABILITY,
    providerBinding: { kind: "internal", operation: "public.growth_form_unpublish", connectionResolver: null },
    idempotency: { mode: "required", key: "the form's own state. Unpublishing a form that is not live returns its current status and changes nothing.", readback: "public.growth_form_unpublish", replay: "return_recorded_result" },
    receipt: RECEIPT, outcome: { projector: "capability-record" },
  }),
  growth_funnel_unpublish: () => defineCapability({
    identity: { id: "growth_funnel.unpublish", version: 1, domain: "growth_funnel", owner: "vibe-studio", humanSurface: SURFACE,
      description: "Take a live funnel offline; its pages and forms stay live and are unpublished separately." },
    input: objectInputSchema({ description: "Unpublish a live funnel.", properties: { funnel_id: { type: "string", format: "uuid" } }, required: ["funnel_id"] }),
    effect: "mutation",
    governance: { actionRiskKey: "growth_funnel_unpublish", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("growth_funnel.publish.execute") },
    tenantScope: SCOPE, availability: AVAILABILITY,
    providerBinding: { kind: "internal", operation: "public.growth_funnel_unpublish", connectionResolver: null },
    idempotency: { mode: "required", key: "the funnel's own state. Unpublishing a funnel that is not live returns its current status and changes nothing.", readback: "public.growth_funnel_unpublish", replay: "return_recorded_result" },
    receipt: RECEIPT, outcome: { projector: "capability-record" },
  }),
  studio_image_publish: () => defineCapability({
    identity: { id: "studio_image.publish", version: 1, domain: "studio_image", owner: "vibe-studio", humanSurface: SURFACE,
      description: "Publish a finished Studio image so it can be used at its public file address." },
    input: objectInputSchema({ description: "Publish a finished image.", properties: { content_id: { type: "string", format: "uuid" } }, required: ["content_id"] }),
    effect: "mutation",
    governance: { actionRiskKey: "studio_image_publish", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("studio_image.publish.execute") },
    tenantScope: SCOPE, availability: AVAILABILITY,
    providerBinding: { kind: "internal", operation: "public.studio_image_publish", connectionResolver: null },
    idempotency: { mode: "required", key: "the image's own state. Publishing a published image publishes it again; published_at records the latest publish.", readback: "public.studio_image_publish", replay: "return_recorded_result" },
    receipt: RECEIPT, outcome: { projector: "capability-record" },
  }),
  studio_image_unpublish: () => defineCapability({
    identity: { id: "studio_image.unpublish", version: 1, domain: "studio_image", owner: "vibe-studio", humanSurface: SURFACE,
      description: "Take a published Studio image back to a draft." },
    input: objectInputSchema({ description: "Unpublish a published image.", properties: { content_id: { type: "string", format: "uuid" } }, required: ["content_id"] }),
    effect: "mutation",
    governance: { actionRiskKey: "studio_image_unpublish", risk: "high", approval: "confirm", requiredPermission: ownerGrantablePermission("studio_image.publish.execute") },
    tenantScope: SCOPE, availability: AVAILABILITY,
    providerBinding: { kind: "internal", operation: "public.studio_image_unpublish", connectionResolver: null },
    idempotency: { mode: "required", key: "the image's own state. Unpublishing an image that is not published returns its current status and changes nothing.", readback: "public.studio_image_unpublish", replay: "return_recorded_result" },
    receipt: RECEIPT, outcome: { projector: "capability-record" },
  }),
};

const BUILT = new Map<string, DefinedCapability | null>([
  ["growth_page_publish", GROWTH_PAGE_PUBLISH_CAPABILITY],
  ["growth_form_publish", GROWTH_FORM_PUBLISH_CAPABILITY],
  ["growth_funnel_publish", GROWTH_FUNNEL_PUBLISH_CAPABILITY],
]);

/**
 * The governed declaration for a publish-door key, or null when it cannot be built — today that means
 * its action-risk classification is missing or disagrees. Null is a refusal for that act, never a
 * permission to run it ungoverned.
 */
export function publishCapability(key: string): DefinedCapability | null {
  if (BUILT.has(key)) return BUILT.get(key) ?? null;
  const build = BUILDERS[key];
  if (!build) return null;
  try {
    const declared = build();
    BUILT.set(key, declared);
    return declared;
  } catch (e) {
    // Loud, so a missing classification is never a silent dark act (§32).
    console.error("[growth-publish-command] capability declaration unavailable", JSON.stringify({ key, reason: e instanceof Error ? e.message : String(e) }));
    BUILT.set(key, null);
    return null;
  }
}
