import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Landing PAGES built in the Vibe Studio chat — save a working copy, then publish it. Registered here,
// in its own domain, the way forms are (growth_form.ts), so the Spine knows who owns these two acts,
// what they execute, how a retry behaves and what the Rail may say about them. Both drive the SAME
// server-authorized RPCs the Studio uses (migration 20270537000000: growth_page_upsert,
// growth_page_publish); there is no chat-only page model and no second draft store.
//
// THIS SLICE DECLARES; IT DOES NOT REWIRE. The model-facing tool JSON for growth_page_save and
// growth_page_publish stays where it is, inline in paige-ai-chat, and so does their dispatch. No
// `*_TOOLS` array is exported from here: nothing would mount it, and a second copy of the schema the
// model sees would only be a second thing to drift. Moving the tool JSON behind an adapter spread is
// later, separate work.
//
// THE PUBLISH RULE (owner ruling, one rule for everything Vibe Studio makes). A page starts
// UNPUBLISHED and lives in the Studio. Saving never makes anything public: it writes the working copy
// (draft_blocks_json / draft_theme_json / draft_seo_json), and visitors keep seeing the live version
// until the owner publishes. Saving also authors an unpublished backing form for every signup section
// that has none (ON CONFLICT DO NOTHING, so it never overwrites a form the owner edited).
//
// THE AUTHORITY MODEL (mirrors the action-risk table).
//   • save    = `ordinary`: a private working copy, in-tenant and reversible. The class a tenant
//     owner MAY grant standing authority over; inside a Studio session it is an auto tool.
//   • publish = `high`: the page goes live at its public address, and so does every form on it
//     (owner ruling 2026-09-30). Always confirmed, never silent. The RPC refuses a page with an
//     unfilled [PLACEHOLDER] prompt or a signup section with no form behind it.
// Who may do either is decided server-side (_growth_admin_tenant): the workspace owner or an admin of
// the active tenant, or the agency that manages that sub-account; never a member, never a global
// role, never a caller-named tenant.
//
// IDEMPOTENCY, honestly (§13). With a page id, save converges on that page's working copy and keeps
// its address. Without one, the chat handler picks a slug no other page uses, so a blind retry makes
// a second page; the Chat confirmation fingerprint and the Studio auto lane's one call per tool call
// are the guard. publish converges: publishing a live page copies the working copy to live again and
// published_at records the latest publish.

export const GROWTH_PAGE_SAVE = {
  key:"growth_page.save",domain:"growth_page",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_page_upsert",chatTool:"growth_page_save",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"With a page id it converges on that page's working copy (a live page's live version and address do not change). Without one the chat handler picks a slug no other page uses, so a blind retry makes a second page; the Chat confirmation fingerprint is the execute-once guard."},
  outcome:{kinds:["created","updated","refused","failed"],projector:"public.growth_page_upsert",railVisibility:"Records that a private working copy of a page was saved — never that the page went live, that anyone visited it, or that any form on it took a submission."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_PAGE_PUBLISH = {
  key:"growth_page.publish",domain:"growth_page",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_page_publish",chatTool:"growth_page_publish",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Converges — publishing a live page copies the working copy to live again; the content is unchanged and published_at records the latest publish."},
  outcome:{kinds:["published","refused","failed"],projector:"public.growth_page_publish",railVisibility:"Records that the page, and the forms on it, became reachable at the address the publish returned — never that anyone visited or submitted."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_PAGE_CAPABILITIES=[GROWTH_PAGE_SAVE,GROWTH_PAGE_PUBLISH] as const;

// Governed declarations (capability kit). Evaluated on every cold start because paige-ai-chat imports
// the Spine registry, which composes this module; they throw if a declared risk contradicts
// action-risk.ts. What actually clamps the writes is action-risk.ts, the Chat confirm gate and the
// RPCs' own owner/admin checks. The receipt below names the canonical recorder; whether the chat
// dispatch calls it for these tools is recorded in scripts/ci/receipt-coverage-ledger.json, not here.
//
// THE INPUT SCHEMA. The kit's provider-safe subset requires every nested object to close its
// properties, and a page's blocks, theme and SEO are open JSON objects validated server-side
// (growth_validate_blocks). Those three are therefore DECLARED in their JSON-serialized form —
// blocks_json, theme_json, seo_json, the RPC's own parameter names — the same rule
// ghl_management.ts applies to its free-form arguments. The chat tool's schema carries the native
// objects; this declaration is metadata and validates nothing at runtime.
const PAGE_SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const PAGE_AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const PAGE_RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;

export const GROWTH_PAGE_SAVE_CAPABILITY = defineCapability({
  identity: {
    id: "growth_page.save",
    version: 1,
    domain: "growth_page",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Save a landing page's working copy in this workspace. Nothing goes live.",
  },
  input: objectInputSchema({
    description: "Create a landing page, or change the working copy of one.",
    properties: {
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      blocks_json: { type: "string", minLength: 2, description: "The page blocks, JSON-serialized (an array of block objects)." },
      theme_json: { type: "string", minLength: 2, description: "Optional theme override, JSON-serialized." },
      seo_json: { type: "string", minLength: 2, description: "Optional SEO object, JSON-serialized." },
      page_id: { type: "string", format: "uuid" },
    },
    required: ["slug", "title", "blocks_json"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_page_save",
    risk: "ordinary",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_page.draft.write"),
  },
  tenantScope: PAGE_SCOPE,
  availability: PAGE_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_page_upsert", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "tenant + page id. With a page id the save converges on that page's working copy and keeps its address. Without one the chat handler picks a slug no other page uses, so a blind retry makes a second page; the Chat confirmation fingerprint is the execute-once guard.",
    readback: "public.growth_page_upsert",
    replay: "return_recorded_result",
  },
  receipt: PAGE_RECEIPT,
  outcome: { projector: "capability-record" },
});

export const GROWTH_PAGE_PUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "growth_page.publish",
    version: 1,
    domain: "growth_page",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Put a landing page, and the forms on it, live at its public address.",
  },
  input: objectInputSchema({
    description: "Publish a saved landing page.",
    properties: { page_id: { type: "string", format: "uuid" } },
    required: ["page_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_page_publish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_page.publish.execute"),
  },
  tenantScope: PAGE_SCOPE,
  availability: PAGE_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_page_publish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the page's own state. Publishing copies the working copy to live; a replay copies the same content again; published_at records the latest publish.",
    readback: "public.growth_page_publish",
    replay: "return_recorded_result",
  },
  receipt: PAGE_RECEIPT,
  outcome: { projector: "capability-record" },
});

// UNPUBLISH (Migration E, 2026-10-04). A door-only act: the growth-publish-command door runs it for
// the Studio panel and the chat alike, and no chat tool carries this name. So, like the human-only
// invoice link (sales_invoice.ts), it is declared through the capability kit and NOT as a
// SpineCapability: the Spine validator requires every mutating entry to name a LIVE chat tool, and
// claiming one here would be false. The door binds this declaration through
// STUDIO_PUBLISH_KIT_BY_ACTION (studio_publish.ts) and decideDeclaredCapability.
//
// `high`, like publish: it changes what the public sees. The page leaves its public address; its
// forms stay live (owner ruling 2026-09-30). The RPC refuses a page a live funnel still uses.
export const GROWTH_PAGE_UNPUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "growth_page.unpublish",
    version: 1,
    domain: "growth_page",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Take a landing page offline. The forms on it stay live.",
  },
  input: objectInputSchema({
    description: "Unpublish a live landing page.",
    properties: { page_id: { type: "string", format: "uuid" } },
    required: ["page_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_page_unpublish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_page.unpublish.execute"),
  },
  tenantScope: PAGE_SCOPE,
  availability: PAGE_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_page_unpublish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the page's own state. Unpublishing a page that is not live returns its current status and changes nothing, so a replay converges.",
    readback: "public.growth_page_unpublish",
    replay: "return_recorded_result",
  },
  receipt: PAGE_RECEIPT,
  outcome: { projector: "capability-record" },
});
