import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// Saving a piece of COPY to the workspace's content library from the chat. Registered here, in its own
// domain, the way the Studio's forms (growth_form.ts) and pages (growth_page.ts) are, so the Spine
// knows who owns the act, what it executes, how a retry behaves and what the Rail may say about it. It
// drives the SAME server-authorized RPC the Studio library uses (save_marketing_content); there is no
// chat-only content store.
//
// THIS SLICE DECLARES; IT DOES NOT REWIRE. The model-facing tool JSON for content_save stays where it
// is, inline in paige-ai-chat, and so does its dispatch. No `*_TOOLS` array is exported from here:
// nothing would mount it, and a second copy of the schema the model sees would only be a second thing
// to drift. Drafting copy (draft_marketing_content) writes nothing and is not declared here.
//
// WHAT A SAVE IS. A private library row (kind `text`), in-tenant. It sends nothing, publishes nothing
// and posts nothing; generated images save themselves through their own path. The library is read on
// the Content tab (/solo/:account/growth/content).
//
// THE AUTHORITY MODEL (mirrors the action-risk table). save = `ordinary`: in-tenant and reversible
// (a row can be archived). Who may do it is decided server-side (save_marketing_content, Migration D):
// the owner or an admin of the session's own workspace, or the agency that manages it; never a member,
// never a global role, and a caller-named tenant other than the session's is refused, never swapped.
//
// IDEMPOTENCY, honestly (§13). The chat tool passes no content id, so every save INSERTS a new row: a
// blind retry saves a second copy. The Chat confirmation fingerprint and the auto lane's one call per
// tool call are the guard. (The RPC can update a row by id, but the chat path does not use that.)

export const MARKETING_CONTENT_SAVE = {
  key:"marketing_content.save",domain:"marketing_content",owner:"vibe-studio",humanSurface:"/solo/:account/growth/content",
  action:{classification:"mutate",executor:"public.save_marketing_content",chatTool:"content_save",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Not convergent from Chat — the chat tool passes no content id, so every save inserts a new library row and a blind retry saves a second copy; the Chat confirmation fingerprint is the execute-once guard."},
  outcome:{kinds:["created","refused","failed"],projector:"public.save_marketing_content",railVisibility:"Records that a piece of copy was saved to the workspace's private library — never that it was sent, posted or published."},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const MARKETING_CONTENT_CAPABILITIES=[MARKETING_CONTENT_SAVE] as const;

// Governed declaration (capability kit). Evaluated on every cold start because paige-ai-chat imports
// the Spine registry, which composes this module; it throws if the declared risk contradicts
// action-risk.ts. What actually clamps the write is action-risk.ts, the Chat confirm gate and the
// RPC's own role and membership checks. The receipt below names the canonical recorder; whether the
// chat dispatch calls it for this tool is recorded in scripts/ci/receipt-coverage-ledger.json.
export const MARKETING_CONTENT_SAVE_CAPABILITY = defineCapability({
  identity: {
    id: "marketing_content.save",
    version: 1,
    domain: "marketing_content",
    owner: "vibe-studio",
    humanSurface: "/solo/:account/growth/content",
    description: "Save a piece of copy to this workspace's private content library. Nothing is sent or published.",
  },
  input: objectInputSchema({
    description: "Save copy to the content library.",
    properties: {
      title: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1 },
      channel: { type: "string", enum: ["social_post", "ad_copy", "email_campaign", "caption", "blog_outline", "sms_broadcast"] },
      brief: { type: "string" },
    },
    required: ["title", "body"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "content_save",
    risk: "ordinary",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("marketing_content.draft.write"),
  },
  tenantScope: {
    source: "server",
    tenantResolver: "current_user_tenant_id",
    actorResolver: "authenticated_user",
    revalidateAt: ["before_availability", "before_execution", "before_receipt"],
  },
  availability: {
    resolver: "paige-capability-status",
    states: ["live", "needs_approval", "not_for_tier", "unavailable"],
  },
  providerBinding: { kind: "internal", operation: "public.save_marketing_content", connectionResolver: null },
  idempotency: {
    mode: "required",
    key: "none from Chat — no content id is passed, so each save inserts a new row and a blind retry saves a second copy; the Chat confirmation fingerprint is the execute-once guard.",
    readback: "public.save_marketing_content",
    replay: "return_recorded_result",
  },
  receipt: { rail: true, recorder: "record_capability_run", redaction: "tenant_safe", visibility: "owner_internal" },
  outcome: { projector: "capability-record" },
});
