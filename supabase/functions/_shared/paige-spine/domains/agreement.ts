import type { SpineCapability } from "../contracts.ts";
import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";

// INT-178 — AGREEMENTS, the READ half. PAIGE can see a workspace's e-signature agreements and the
// status of any one of them. Both capabilities execute the SAME governed seam,
// `public.paige_agreement_overview` (migration 20270402000000), whose own header names it "the read
// Paige answers from"; the adapter is `_shared/agreements/chat-read.ts`.
//
// WHAT THIS CORRECTS. INT-163 shipped the engine and left `registry.ts` carrying a comment that
// DRAFT, VOID and STATUS "register here". None of them did — the array held zero agreement
// capabilities, so PAIGE could not see an agreement at all. The comment described intent that was
// never delivered, and this file is the first half of delivering it.
//
// WHY THE READS CAME FIRST — the same seam boundary `calendar_link.ts` documents, for the same
// reason. The Spine validator requires an action's executor to be an exact `public.<symbol>`
// present in migration history. SEND and RESEND execute the `agreement-send` EDGE FUNCTION, which
// that validator rejects, so registering them would mean widening the shared executor allowlist —
// a change to the Spine contract itself — for zero added enforcement, since what actually clamps a
// send is `_shared/action-risk.ts` plus the inline Chat confirm gate. DRAFT and VOID do have clean
// `public.*` executors (`save_paige_agreement`, `void_paige_agreement`) and are deliberately NOT
// registered here either: they are mutations, and this slice is read-first on purpose, because the
// send path has a real client on the other end of it.
//
// SCOPE, STATED HONESTLY (§13). Registering a capability does not grant one. The two READ entries
// are `read` / `read_only` / no approval authority, and the RPC they name re-proves the caller's
// tenant and membership in its own body under the caller's JWT (§59). Nothing there can read
// another workspace.
//
// THE FIRST WRITE THROUGH THIS BOUNDARY (2026-09-24) — `agreement.draft`, later joined by `agreement.send`. The
// read-first reasoning above is unchanged and still governs: the send path has a real client on the
// other end of it, so each outward-facing key earns its own slice. A draft is the opposite — it is
// visible to nobody outside the workspace, mints no signing link, and sends nothing.
//
// WHAT THE `defineCapability()` DECLARATION BELOW IS, AND IS NOT. It is the FIRST production
// declaration in this repository; every other mutating chat tool predates the kit and is
// grandfathered in `capability-kit-bypass-baseline.json`. Stated plainly because the word
// "governed" would otherwise be read as more than it is: NOTHING consumes a `DefinedCapability` at
// runtime — no registry, no resolver, no dispatch reads it. Its only runtime behaviour is to THROW
// on import if its declared risk contradicts the canonical policy, which is exactly the false-green
// `action-risk.ts` warns about (a mismatch passes `capability-kit-lint`, which never reads
// `governance.risk`, and fails at the first cold start). What actually clamps this write is
// `action-risk.ts` + the inline Chat confirm gate + the RPC's own tenant and membership checks.

export const AGREEMENT_LIST = {
  key:"agreement.list",domain:"agreement",owner:"agreements-engine",humanSurface:"/solo/:account/sales",
  action:{classification:"read",executor:"public.paige_agreement_overview",chatTool:"agreement_list",riskPolicyKey:"read_only",approvalAuthority:"none",idempotency:"Read-only projection of the workspace's agreements. No write, no send, no idempotency key."},
  outcome:{kinds:["capability_run"],projector:"public.record_capability_run",railVisibility:"owner_internal"},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const AGREEMENT_STATUS = {
  key:"agreement.status",domain:"agreement",owner:"agreements-engine",humanSurface:"/solo/:account/sales",
  action:{classification:"read",executor:"public.paige_agreement_overview",chatTool:"agreement_status",riskPolicyKey:"read_only",approvalAuthority:"none",idempotency:"Read-only status projection for one contact's or one state's agreements. No write, no send, no idempotency key."},
  outcome:{kinds:["capability_run"],projector:"public.record_capability_run",railVisibility:"owner_internal"},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const AGREEMENT_DRAFT = {
  key:"agreement.draft",domain:"agreement",owner:"agreements-engine",humanSurface:"/solo/:account/sales",
  action:{classification:"mutate",executor:"public.save_paige_agreement",chatTool:"agreement_draft",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Not idempotent on create — with no agreement id a blind retry mints a SECOND draft and a second counterparty signer, because the seed trigger fires per insert; the Chat confirmation fingerprint (paige_pending_confirmations) is the execute-once guard, and it is the only one. Given an agreement id it converges on the row's fields, but it appends a second edited event and moves updated_at every time. Carrying the _expected_updated_at the caller read makes a replay fail closed with 40001 instead; omitting it disables that check entirely."},
  outcome:{kinds:["capability_run"],projector:"public.record_capability_run",railVisibility:"owner_internal"},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const AGREEMENT_SEND = {
  key:"agreement.send",domain:"agreement",owner:"agreements-engine",humanSurface:"/solo/:account/sales",
  action:{classification:"external_effect",executor:"public.issue_agreement_signing_link",chatTool:"agreement_send",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Outward and consequential: the send emails each signer, freezes the presented document, and leaves draft in one move, so it can never be safely retried blind. The Chat confirmation fingerprint (paige_pending_confirmations) is the execute-once guard; a retry after an ambiguous outcome must re-read the agreement's status before proposing anything, and the frozen-document provenance refusal stops a pre-fix row from being re-sent as the wrong bytes."},
  outcome:{kinds:["capability_run"],projector:"public.record_capability_run",railVisibility:"owner_internal"},
  chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;

export const AGREEMENT_CAPABILITIES = [AGREEMENT_LIST, AGREEMENT_STATUS, AGREEMENT_DRAFT, AGREEMENT_SEND] as const;

// Model-facing tool JSON. Authored COMPACT (single-line objects, `name:"…"` never alone on its own
// line) so `chat-tool-registry-lint` does not count these as inline hand-wired Chat tools — they
// enter Chat through the adapter spread, exactly as CALENDAR_LINK_TOOLS does.
//
// Every description states the honest boundary, because a model that believes it can send from a
// read tool will tell the owner it did. The first two READ — they do not draft, send, resend,
// remind, void, or countersign, and they cannot be made to. `agreement_draft` WRITES, and its
// description has to carry its own boundary just as firmly: it drafts, and it does not send. The
// thing a model most plausibly gets wrong here is omitting `agreementId` when the person asked to
// CHANGE a draft, which silently mints a duplicate rather than editing, so the description says so
// twice and the idempotency sentence on the capability says why.
export const AGREEMENT_TOOLS = [
  {type:"function",function:{name:"agreement_list",description:"List this workspace's e-signature agreements with their current status — who it is with, how many signers have signed, what is still outstanding, and when it was sent, completed or expires. READ-ONLY: it never sends, resends, drafts, voids or reminds. Use it to answer 'where do my agreements stand', 'what is outstanding', or 'what have I got waiting on signatures'. Optionally narrow by status. Report the statuses exactly as returned and never imply a document was delivered or signed beyond what the status says.",parameters:{type:"object",properties:{status:{type:"string",enum:["draft","sent","viewed","partially_signed","completed","declined","voided","expired"],description:"Optional: show only agreements in this state."}}}}},
  {type:"function",function:{name:"agreement_status",description:"Check where a specific client's agreement stands — its status, which signers are still outstanding, and the sent/completed/expiry dates. READ-ONLY: it never sends, resends, drafts, voids or reminds. Give it the contactId from a contact lookup to see that client's agreements. Answer only from what it returns: 'viewed' means opened, not signed, and 'sent' does not mean delivered. Signing evidence is deliberately not available here and must never be described as if it were.",parameters:{type:"object",properties:{contactId:{type:"string",format:"uuid",description:"The contact whose agreements to check."},status:{type:"string",enum:["draft","sent","viewed","partially_signed","completed","declined","voided","expired"],description:"Optional: narrow to one state."}},required:["contactId"]}}},
  {type:"function",function:{name:"agreement_draft",description:"Draft a new agreement for a client, or revise one that is still a draft. It WRITES, and it needs the person's OK first. It does NOT send: nothing reaches the client, no signing link is minted, and the agreement stays invisible outside this workspace until a separate send. Give it the contactId from a contact lookup, a title, and the agreement text as markdown. To revise an existing draft, pass its agreementId as well — leaving agreementId out always creates a NEW agreement, so never omit it when the person asked to change one they already have. Only a draft can be revised; once an agreement has been sent it is fixed.",parameters:{type:"object",properties:{contactId:{type:"string",format:"uuid",description:"The client this agreement is with."},title:{type:"string",description:"What the agreement is called, in the tenant's own words."},bodyMarkdown:{type:"string",description:"The agreement text, as markdown."},agreementId:{type:"string",format:"uuid",description:"Revise THIS existing draft. Omit to create a new agreement — omitting it when the person meant to edit creates a duplicate."}},required:["contactId","title","bodyMarkdown"]}}},
  {type:"function",function:{name:"agreement_send",description:"Send an agreement out for signature. THIS REACHES A REAL PERSON: it emails each signer a link they can sign, freezes the document as the record of what they were shown, and moves the agreement out of draft one way — it cannot be recalled once delivered. Only a DRAFT can be sent, and only once; resending an already-sent agreement is a separate action that does not exist yet, so do not offer it. The person must approve this on the card before it runs — a typed yes is not enough and will be refused. If you are unsure whether they meant to send or only to draft, ask; drafting is reversible and this is not.",parameters:{type:"object",properties:{agreementId:{type:"string",format:"uuid",description:"The draft agreement to send. Get it from agreement_list or from the draft you just created."}},required:["agreementId"]}}},
] as const;

/**
 * THE GOVERNED DECLARATION FOR `agreement_draft` — the first production `defineCapability()` in
 * this repository. `action-risk.ts` states the contract it satisfies: "classify it here, declare
 * it through defineCapability(), and ship its tool schema — in the same change."
 *
 * IT LIVES HERE, BESIDE THE TOOL IT DESCRIBES, AND IT MUST BE IMPORTED TO MEAN ANYTHING. This
 * module is already imported by `paige-ai-chat/index.ts`, so the declaration is EVALUATED on every
 * cold start. That matters more than it looks: the only runtime behaviour a declaration has is to
 * THROW when its declared risk contradicts the canonical policy, and a declaration sitting in a
 * module nothing imports would clear CI and never run the check it exists for.
 *
 * `governance.risk` must equal `classifyAction("agreement_draft")` exactly, and `governance.approval`
 * is forced by the same tuple. `capability-kit-lint` reads `actionRiskKey` and never `risk`, so a
 * contradiction here passes CI and fails at the first cold start — which is precisely the
 * false-green `action-risk.ts` records. Changing the class in one place means changing it in both.
 */
export const AGREEMENT_DRAFT_CAPABILITY = defineCapability({
  identity: {
    id: "agreement.draft",
    version: 1,
    domain: "agreement",
    owner: "agreements-engine",
    humanSurface: "/solo/:account/sales",
    description: "Draft or revise a client agreement in this workspace. Nothing is sent.",
  },
  input: objectInputSchema({
    description: "Draft a new agreement, or revise one that is still a draft.",
    properties: {
      contactId: { type: "string", format: "uuid" },
      title: { type: "string", minLength: 1, maxLength: 200 },
      bodyMarkdown: { type: "string", minLength: 1, maxLength: 100000 },
      // Absent means CREATE. The model omitting it when the person meant "change my draft" is the
      // realistic way a duplicate gets minted, which is why the tool description says so twice.
      agreementId: { type: "string", format: "uuid" },
    },
    required: ["contactId", "title", "bodyMarkdown"],
  }),
  effect: "mutation",
  governance: {
    actionRiskKey: "agreement_draft",
    risk: "ordinary",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("agreement.draft.write"),
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
  providerBinding: {
    kind: "internal",
    operation: "public.save_paige_agreement",
    connectionResolver: null,
  },
  idempotency: {
    mode: "required",
    key: "tenant + actor + agreementId. On the CREATE path there is no server key at all — with no agreement id the RPC inserts, so a blind retry mints a second draft AND a second counterparty signer, because the seed trigger fires per insert. The Chat confirmation fingerprint (paige_pending_confirmations) is the execute-once guard, and it is the only one.",
    readback: "public.paige_agreement_overview",
    replay: "return_recorded_result",
  },
  receipt: {
    rail: true,
    recorder: "record_capability_run",
    redaction: "tenant_safe",
    visibility: "owner_internal",
  },
  outcome: { projector: "capability-record" },
});

/**
 * `agreement_send` — the governed declaration for the one agreement action that reaches outside the
 * workspace. Same contract as the draft above, with two differences that both follow from that:
 *
 *   `effect: "external_effect"` — the kit forces `risk: "high"` for this effect, which is the point.
 *   `providerBinding.operation` names an EDGE FUNCTION rather than an RPC. The kind stays
 *     `"internal"`: the kit's three kinds are internal / mcp / partner, and an edge function of ours
 *     is our own infrastructure, not a third party. (`"edge"` is not a kind — I tried it, and the
 *     constructor refused it at import, which is the behaviour this declaration exists for.)
 *
// Registered as of this PR: AGREEMENT_SEND (external_effect on public.issue_agreement_signing_link).
 * `public.<symbol>` present in migration history, and widening that allowlist for an edge function
 * is a change to the Spine contract itself — for no added enforcement, since what actually clamps a
 * send is `action-risk.ts` plus the Chat confirm gate plus the function's own admin check. That is
 * the same boundary `calendar_link_send` sits on, and it is drawn deliberately rather than skipped.
 */
export const AGREEMENT_SEND_CAPABILITY = defineCapability({
  identity: {
    id: "agreement.send",
    version: 1,
    domain: "agreement",
    owner: "agreements-engine",
    humanSurface: "/solo/:account/sales",
    description: "Email a signable link for an agreement to its signers. Reaches a real person.",
  },
  input: objectInputSchema({
    description: "Send a draft agreement out for signature.",
    properties: { agreementId: { type: "string", format: "uuid" } },
    required: ["agreementId"],
  }),
  effect: "external_effect",
  governance: {
    actionRiskKey: "agreement_send",
    risk: "high",
    approval: "confirm",
    requiredPermission: ownerGrantablePermission("agreement.send.execute"),
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
  providerBinding: {
    kind: "internal",
    operation: "edge.agreement-send",
    connectionResolver: null,
  },
  idempotency: {
    mode: "required",
    key: "the agreement's own status. A second plain send is refused 409 because the agreement is no longer a draft, and a signer already holding a live link is reported as not delivered rather than re-mailed. Below that nothing dedupes: the shared sender records its idempotency key and deliberately does not act on it. ONE SEND PER DRAFT is the guarantee; exactly-once DELIVERY is not, and must never be described as if it were.",
    readback: "public.paige_agreement_overview",
    replay: "return_recorded_result",
  },
  receipt: {
    rail: true,
    recorder: "record_capability_run",
    redaction: "tenant_safe",
    visibility: "owner_internal",
  },
  outcome: { projector: "capability-record" },
});
