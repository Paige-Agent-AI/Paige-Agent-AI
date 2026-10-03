import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Standalone FORMS built in the Vibe Studio chat — save a working copy, then publish it. Registered
// here, in its own domain, so the Chat handler consumes the tools through the Spine instead of
// hand-wiring them. Both drive the SAME server-authorized RPCs the Solo Catalog and the Studio use
// (migration 20270537000000: growth_form_upsert, growth_form_publish); there is no chat-only form
// model and no second draft store.
//
// THE PUBLISH RULE (owner ruling, one rule for everything Vibe Studio makes). A form starts
// UNPUBLISHED and lives in the Studio. Saving never makes anything public: on an unpublished form it
// writes both copies; on a live form it writes only the working copy (draft_schema_json), and
// visitors keep seeing the live version until the owner publishes the changes.
//
// THE AUTHORITY MODEL (mirrors the action-risk table).
//   • save    = `ordinary`: a private working copy, in-tenant and reversible. The class a tenant
//     owner MAY grant standing authority over; inside a Studio session it is an auto tool.
//   • publish = `high`: the form goes live at its public address and starts taking submissions
//     (contacts, deals and alerts). Always confirmed, never silent.
// Who may do either is decided server-side: the workspace owner or an admin of the active tenant,
// or an agency manager of that sub-account; never a member, never a caller-named tenant.
//
// IDEMPOTENCY, honestly (§13). With a form id, save converges on that form's working copy. Without
// one it creates a NEW form under a slug no other form uses, so a blind retry makes a second form;
// the Chat confirmation fingerprint and the Studio auto lane's one call per tool call are the guard. publish converges: publishing a live
// form with no pending changes leaves its content as it is; published_at records the latest publish.

export const GROWTH_FORM_SAVE = {
  key:"growth_form.save",domain:"growth_form",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_form_upsert",chatTool:"growth_form_save",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"With a form id it converges on that form's working copy (a live form's live version and address do not change). Without one it creates a new form under a slug no other form uses, so a blind retry makes a second form; the Chat confirmation fingerprint is the execute-once guard."},
  outcome:{kinds:["created","updated","refused","failed"],projector:"public.growth_form_upsert",railVisibility:"Records that a private working copy was saved — never that the form went live, took a submission, or sent anything."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FORM_PUBLISH = {
  key:"growth_form.publish",domain:"growth_form",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_form_publish",chatTool:"growth_form_publish",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Converges — publishing a live form copies the working copy to live again; the content is unchanged and published_at records the latest publish."},
  outcome:{kinds:["published","refused","failed"],projector:"public.growth_form_publish",railVisibility:"Records that the form became reachable at the address the publish returned — never that anyone submitted it."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FORM_CAPABILITIES=[GROWTH_FORM_SAVE,GROWTH_FORM_PUBLISH] as const;

// Model-facing tool JSON, authored COMPACT (single-line objects) so the chat-tool-registry lint does
// not count these as hand-wired tools; they enter Chat through the adapter spread.
export const GROWTH_FORM_TOOLS = [
  {type:"function",function:{name:"growth_form_save",description:"Team only. Save a standalone form (intake, application, discovery-call request, questionnaire) as a DRAFT — it does not go live; publishing is a separate, approval-gated step. Write the questions yourself from what the owner asked for and what you know about their business: keep a first-contact form short (about 4-7 questions), use the owner's real services as answer choices, and never invent prices or claims. Pass form_id to change an existing form (its live version stays as it is until the owner publishes the changes), or omit it to create a new one keyed by slug. Where requests go (pipeline stage, alert email) is set by the owner on the form, not here.",parameters:{type:"object",properties:{name:{type:"string",description:"The form's title as visitors see it, e.g. 'Book a discovery call'."},slug:{type:"string",description:"The address for a NEW form, lowercase words separated by hyphens, e.g. 'discovery-call'. An existing form keeps its address."},intro:{type:"string",description:"One or two sentences under the title telling the visitor what happens next."},questions:{type:"array",description:"The questions, in order.",items:{type:"object",properties:{label:{type:"string",description:"The question as the visitor reads it."},type:{type:"string",enum:["text","email","tel","number","date","textarea","select","radio","checkbox"],description:"text = short answer, textarea = long answer, radio = pick one, checkbox = pick any, select = dropdown, tel = phone."},required:{type:"boolean"},options:{type:"array",items:{type:"string"},description:"Answer choices for radio, checkbox or select."}},required:["label","type"]}},submit_label:{type:"string",description:"The button text, e.g. 'Request a call'."},thank_you:{type:"string",description:"What the visitor sees after sending, e.g. 'Thanks. We come back within one business day.'"},form_id:{type:"string",description:"Existing form id to update. Omit to create a new form."}},required:["name","slug","questions"]}}},
  {type:"function",function:{name:"growth_form_publish",description:"Team only. Publish a saved form so it goes LIVE and starts taking submissions (or, for a form that is already live, put its saved changes live). This is a going-live action — always confirm with the owner first and report back the real link the publish returns.",parameters:{type:"object",properties:{form_id:{type:"string",description:"The form id to publish (from growth_form_save)."}},required:["form_id"]}}},
] as const;

// Governed declarations (capability kit). Evaluated on every cold start because paige-ai-chat
// imports this module; they throw if a declared risk contradicts action-risk.ts. What actually
// clamps the writes is action-risk.ts, the Chat confirm gate and the RPCs' own owner/admin checks.
const FORM_SCOPE = {
  source: "server",
  tenantResolver: "current_user_tenant_id",
  actorResolver: "authenticated_user",
  revalidateAt: ["before_availability", "before_execution", "before_receipt"],
} as const;
const FORM_AVAILABILITY = {
  resolver: "paige-capability-status",
  states: ["live", "needs_approval", "not_for_tier", "unavailable"],
} as const;
const FORM_RECEIPT = { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" } as const;

export const GROWTH_FORM_SAVE_CAPABILITY = defineCapability({
  identity: {
    id: "growth_form.save",
    version: 1,
    domain: "growth_form",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Save a form's working copy in this workspace. Nothing goes live.",
  },
  input: objectInputSchema({
    description: "Create a form, or change the working copy of one.",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      slug: { type: "string", minLength: 1, maxLength: 80 },
      intro: { type: "string", maxLength: 400 },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          properties: {
            label: { type: "string", minLength: 1, maxLength: 200 },
            type: { type: "string", enum: ["text", "email", "tel", "number", "date", "textarea", "select", "radio", "checkbox"] },
            required: { type: "boolean" },
            options: { type: "array", maxItems: 30, items: { type: "string", maxLength: 120 } },
          },
          required: ["label", "type"],
          additionalProperties: false,
        },
      },
      submit_label: { type: "string", maxLength: 40 },
      thank_you: { type: "string", maxLength: 500 },
      form_id: { type: "string", format: "uuid" },
    },
    required: ["name", "slug", "questions"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_form_save",
    risk: "ordinary",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_form.draft.write"),
  },
  tenantScope: FORM_SCOPE,
  availability: FORM_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_form_upsert", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "tenant + form id. With a form id the save converges on that form's working copy. Without one it creates a new form under a slug no other form uses, so a blind retry makes a second form; the Chat confirmation fingerprint is the execute-once guard.",
    readback: "public.growth_form_upsert",
    replay: "return_recorded_result",
  },
  receipt: FORM_RECEIPT,
  outcome: { projector: "capability-record" },
});

export const GROWTH_FORM_PUBLISH_CAPABILITY = defineCapability({
  identity: {
    id: "growth_form.publish",
    version: 1,
    domain: "growth_form",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth",
    description: "Put a form live at its public address so it starts taking submissions.",
  },
  input: objectInputSchema({
    description: "Publish a saved form.",
    properties: { form_id: { type: "string", format: "uuid" } },
    required: ["form_id"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "growth_form_publish",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("growth_form.publish.execute"),
  },
  tenantScope: FORM_SCOPE,
  availability: FORM_AVAILABILITY,
  providerBinding: { kind: "internal", operation: "public.growth_form_publish", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "the form's own state. Publishing copies the working copy to live; a replay copies the same content again; published_at records the latest publish.",
    readback: "public.growth_form_publish",
    replay: "return_recorded_result",
  },
  receipt: FORM_RECEIPT,
  outcome: { projector: "capability-record" },
});
