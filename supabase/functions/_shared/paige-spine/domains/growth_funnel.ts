import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Marketing FUNNELS built in the Vibe Studio chat — build the draft rows, then publish the whole
// sequence. Registered here, in its own domain, the way forms (growth_form.ts) and pages
// (growth_page.ts) are, so the Spine knows who owns these two acts, what they execute, how a retry
// behaves and what the Rail may say about them. Both drive the SAME server-authorized RPCs the Studio
// uses (migration 20270537000000: growth_page_upsert, growth_form_upsert, growth_funnel_upsert,
// growth_funnel_publish); there is no chat-only funnel model and no second draft store.
//
// THIS SLICE DECLARES; IT DOES NOT REWIRE. The model-facing tool JSON for growth_funnel_build and
// growth_funnel_publish stays where it is, inline in paige-ai-chat, and so does their dispatch. No
// `*_TOOLS` array is exported from here: nothing would mount it, and a second copy of the schema the
// model sees would only be a second thing to drift.
//
// WHAT A BUILD IS, honestly (§13). It is THREE writes, not one transaction: the entry page
// (growth_page_upsert), then the intake form when one was asked for (growth_form_upsert), then the
// funnel and its steps (growth_funnel_upsert). The funnel write is the one that makes it a funnel, so
// it is the declared executor. If a later write fails after an earlier one landed, the handler reports
// a PARTIAL build that names the drafts it saved; that is recorded as `failed` here, because the funnel
// itself was not built — there is no "partial" success. A transport failure after a write may have
// landed is reported as unknown rather than "not built", so a retry is not invited to duplicate it.
// An atomic build RPC is later work.
//
// THE PUBLISH RULE (owner ruling, one rule for everything Vibe Studio makes). A build only ever writes
// working copies; nothing it touches goes live. Publishing the funnel puts the funnel AND every page
// and form it uses live together, in one transaction, so a refusal leaves nothing half-live. A live
// funnel's step list cannot change while visitors are walking it; a content-only rebuild (same page,
// same form) lands in the working copies.
//
// THE AUTHORITY MODEL (mirrors the action-risk table).
//   • build   = `ordinary`: private draft rows, in-tenant and reversible.
//   • publish = `high`: a whole sequence goes live at its public address and its forms start taking
//     submissions. Always confirmed, never silent.
// Who may do either is decided server-side (_growth_admin_tenant): the workspace owner or an admin of
// the active tenant, or the agency that manages that sub-account; never a member, never a global
// role, never a caller-named tenant.
//
// IDEMPOTENCY, honestly (§13). With funnel/page/form ids, a build converges on those rows' working
// copies and keeps their addresses. Without them the chat handler mints slugs nothing else uses, so a
// blind retry builds a second page, form and funnel; the Chat confirmation fingerprint and the Studio
// auto lane's one call per tool call are the guard. publish converges: published_at records the
// latest publish.

export const GROWTH_FUNNEL_BUILD = {
  key:"growth_funnel.build",domain:"growth_funnel",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_funnel_upsert",chatTool:"growth_funnel_build",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"With funnel/page/form ids it converges on those rows' working copies and keeps their addresses. Without them the chat handler mints unused slugs, so a blind retry builds a second page, form and funnel; the Chat confirmation fingerprint is the execute-once guard. Three writes, not one transaction: a later failure after an earlier write is a partial build, reported with the drafts it saved."},
  outcome:{kinds:["created","updated","refused","failed"],projector:"public.growth_funnel_upsert",railVisibility:"Records that draft rows for a funnel were saved — never that anything went live. A partial build is recorded as failed and names the drafts that were saved."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FUNNEL_PUBLISH = {
  key:"growth_funnel.publish",domain:"growth_funnel",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_funnel_publish",chatTool:"growth_funnel_publish",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Converges — publishing a live funnel puts the same pages and forms live again in one transaction; published_at records the latest publish."},
  outcome:{kinds:["published","refused","failed"],projector:"public.growth_funnel_publish",railVisibility:"Records that the funnel and every page and form it uses became reachable at the address the publish returned — never that anyone visited or submitted."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FUNNEL_CAPABILITIES=[GROWTH_FUNNEL_BUILD,GROWTH_FUNNEL_PUBLISH] as const;

// Governed declarations (capability kit). Evaluated on every cold start because paige-ai-chat imports
// the Spine registry, which composes this module; they throw if a declared risk contradicts
// action-risk.ts. What actually clamps the writes is action-risk.ts, the Chat confirm gate and the
// RPCs' own owner/admin checks. The receipt below names the canonical recorder; whether the chat
// dispatch calls it for these tools is recorded in scripts/ci/receipt-coverage-ledger.json, not here.
//
// THE INPUT SCHEMA. The kit's provider-safe subset requires every nested object to close its
// properties; the build's `page` ({ title, blocks, theme?, seo? }) and `form` ({ name, schema }) are
// open JSON objects validated server-side. They are therefore DECLARED in their JSON-serialized form,
// page_json and form_json, the same rule ghl_management.ts and growth_page.ts apply. The chat tool's
// schema carries the native objects; this declaration is metadata and validates nothing at runtime.
const FUNNEL_SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const FUNNEL_AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const FUNNEL_RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;

export const GROWTH_FUNNEL_BUILD_CAPABILITY = defineCapability({
  identity: {
    id: "growth_funnel.build",
    version: 1,
    domain: "growth_funnel",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Build a funnel's entry page, intake form and step list as drafts in this workspace. Nothing goes live.",
  },
  input: objectInputSchema({
    description: "Create a funnel, or rebuild one in place.",
    properties: {
      name: { type: "string", minLength: 1 },
      goal: { type: "string" },
      page_json: { type: "string", minLength: 2, description: "The entry page { title, blocks, theme?, seo? }, JSON-serialized." },
      form_json: { type: "string", minLength: 2, description: "Optional intake form { name, schema }, JSON-serialized. Omit for a page-only funnel." },
      funnel_id: { type: "string", format: "uuid" },
      page_id: { type: "string", format: "uuid" },
      form_id: { type: "string", format: "uuid" },
    },
    required: ["name", "page_json"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_funnel_build",
    risk: "ordinary",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_funnel.draft.write"),
  },
  tenantScope: FUNNEL_SCOPE,
  availability: FUNNEL_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_funnel_upsert", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "tenant + funnel/page/form ids. With ids the build converges on those rows' working copies. Without them the chat handler mints unused slugs, so a blind retry builds a second page, form and funnel; the Chat confirmation fingerprint is the execute-once guard.",
    readback: "public.growth_funnel_upsert",
    replay: "return_recorded_result",
  },
  receipt: FUNNEL_RECEIPT,
  outcome: { projector: "capability-record" },
});

export const GROWTH_FUNNEL_PUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "growth_funnel.publish",
    version: 1,
    domain: "growth_funnel",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Put a funnel and every page and form it uses live together at its public address.",
  },
  input: objectInputSchema({
    description: "Publish a built funnel.",
    properties: { funnel_id: { type: "string", format: "uuid" } },
    required: ["funnel_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_funnel_publish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_funnel.publish.execute"),
  },
  tenantScope: FUNNEL_SCOPE,
  availability: FUNNEL_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_funnel_publish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the funnel's own state. Publishing puts the funnel and its pages and forms live in one transaction; a replay does the same again; published_at records the latest publish.",
    readback: "public.growth_funnel_publish",
    replay: "return_recorded_result",
  },
  receipt: FUNNEL_RECEIPT,
  outcome: { projector: "capability-record" },
});
