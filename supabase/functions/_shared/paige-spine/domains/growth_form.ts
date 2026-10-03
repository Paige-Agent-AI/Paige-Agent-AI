import type { SpineCapability } from "../contracts.ts";

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
// IDEMPOTENCY, honestly (§13). save is slug-keyed: the same slug updates the same form, and a lost
// insert race falls back to an update, so a replay converges. publish converges: publishing a live
// form with no pending changes leaves it as it is and keeps its original published_at.

export const GROWTH_FORM_SAVE = {
  key:"growth_form.save",domain:"growth_form",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_form_upsert",chatTool:"growth_form_save",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Slug-keyed per tenant — the same slug updates the same form and a lost insert race falls back to an update, so a replay converges. A live form's working copy changes; its live version and address do not."},
  outcome:{kinds:["created","updated","refused","failed"],projector:"public.growth_form_upsert",railVisibility:"Records that a private working copy was saved — never that the form went live, took a submission, or sent anything."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FORM_PUBLISH = {
  key:"growth_form.publish",domain:"growth_form",owner:"vibe-studio",humanSurface:"/solo/:account/growth",
  action:{classification:"mutate",executor:"public.growth_form_publish",chatTool:"growth_form_publish",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Converges — publishing a live form copies the working copy to live again and keeps the original published_at."},
  outcome:{kinds:["published","refused","failed"],projector:"public.growth_form_publish",railVisibility:"Records that the form became reachable at the address the publish returned — never that anyone submitted it."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const GROWTH_FORM_CAPABILITIES=[GROWTH_FORM_SAVE,GROWTH_FORM_PUBLISH] as const;

// Model-facing tool JSON, authored COMPACT (single-line objects) so the chat-tool-registry lint does
// not count these as hand-wired tools; they enter Chat through the adapter spread.
export const GROWTH_FORM_TOOLS = [
  {type:"function",function:{name:"growth_form_save",description:"Team only. Save a standalone form (intake, application, discovery-call request, questionnaire) as a DRAFT — it does not go live; publishing is a separate, approval-gated step. Write the questions yourself from what the owner asked for and what you know about their business: keep a first-contact form short (about 4-7 questions), use the owner's real services as answer choices, and never invent prices or claims. Pass form_id to change an existing form (its live version stays as it is until the owner publishes the changes), or omit it to create a new one keyed by slug. Where requests go (pipeline stage, alert email) is set by the owner on the form, not here.",parameters:{type:"object",properties:{name:{type:"string",description:"The form's title as visitors see it, e.g. 'Book a discovery call'."},slug:{type:"string",description:"Lowercase words separated by hyphens, e.g. 'discovery-call'."},intro:{type:"string",description:"One or two sentences under the title telling the visitor what happens next."},questions:{type:"array",description:"The questions, in order.",items:{type:"object",properties:{label:{type:"string",description:"The question as the visitor reads it."},type:{type:"string",enum:["text","email","tel","number","date","textarea","select","radio","checkbox"],description:"text = short answer, textarea = long answer, radio = pick one, checkbox = pick any, select = dropdown, tel = phone."},required:{type:"boolean"},options:{type:"array",items:{type:"string"},description:"Answer choices for radio, checkbox or select."}},required:["label","type"]}},submit_label:{type:"string",description:"The button text, e.g. 'Request a call'."},thank_you:{type:"string",description:"What the visitor sees after sending, e.g. 'Thanks. We come back within one business day.'"},form_id:{type:"string",description:"Existing form id to update. Omit to create a new form."}},required:["name","slug","questions"]}}},
  {type:"function",function:{name:"growth_form_publish",description:"Team only. Publish a saved form so it goes LIVE and starts taking submissions (or, for a form that is already live, put its saved changes live). This is a going-live action — always confirm with the owner first and report back the real link the publish returns.",parameters:{type:"object",properties:{form_id:{type:"string",description:"The form id to publish (from growth_form_save)."}},required:["form_id"]}}},
] as const;
