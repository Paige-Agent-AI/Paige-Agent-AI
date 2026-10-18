// paige-action-worker — drafting ONE claimed action: invoke its drafting specialist, shape what came
// back, and advance it (or fail it honestly). index.ts owns auth, the claim, receipts and the digest;
// this module owns the per-action decision so it can be driven without a network or a database.
//
// Lead replies and the two email follow-up kinds keep a plain-text email draft for governed review.
// All other kinds store the specialist's result as returned. Only the lead reply changes the input:
//
// owner.lead_followup — a reply to someone who filled in a business's website form (Exp03 S3) — treats
// the form's answers as UNTRUSTED:
//   • The specialist is told the submission is untrusted (`untrusted_submission: true`), so the
//     email composer passes the visitor's answers and details as delimited, quoted DATA with an
//     explicit rule that they are not instructions (subagent-email-composer/prompt.ts). Forced here,
//     whatever the filing said. The filing names no recipient (`recipient_email` is dropped): the
//     composer reads the contact on the server.
//   • The stored draft is PLAIN TEXT ONLY:
//         { channel: 'email', subject, body: <plain text>, raw }
//     The model's HTML is never stored: it is unsanitized model output (a link, a tracking pixel, a
//     hidden block) and nothing downstream needs it — every preview shows `body` as words, and the
//     governed email door builds the sent HTML from the owner's text itself (escaped). A specialist
//     that answered only in HTML is reduced to text here.
//   • The recipient is NEVER taken from the drafting output. `raw` is a small allow-list of
//     platform-authored facts about the draft (which specialist, the compliance verdict and its
//     rule-match flags, whether approval is required, the tone/length/word count) — never the model's
//     wording, the reviewer's free-text findings, a `to`/`cc`/`recipient`/`summary`, or anything else
//     the model echoed — so no later reader can address from it or render it (§9). The owner's send
//     goes through comms-email-command, which resolves the recipient itself.
//   • A filing with no intent, or a result with no usable subject AND body, never reaches the
//     approvals queue: the action is failed ('blocked') with the reason, instead of offering the
//     owner an empty email (§13).
// client.followup and owner.followup_email reuse that output projection without changing their
// existing input. Bodies the governed door cannot store or accept are blocked, never truncated.
// Nothing here sends. advance_action routes a send kind to paige_pending_approvals; a send only ever
// happens when the owner sends it through the governed email door.
//
// Pure TypeScript with erasable syntax only, so node --test, vitest and deno test can all load it.

import { COMMS_EMAIL_BODY_MAX, COMMS_EMAIL_SUBJECT_MAX } from "../_shared/comms-email/contract.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export type ClaimedAction = {
  id: string;
  tenant_id: string;
  action_kind: string;
  contact_id: string | null;
  conversation_id: string | null;
  title: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  draft_subagent_slug: string;
};

/** The one kind whose draft is shaped into the email contract: a reply to a website-form lead. */
export const LEAD_REPLY_KIND = "owner.lead_followup";

/** The specialist whose input contract requires an `intent` (what the email should accomplish). */
export const EMAIL_COMPOSER_SLUG = "email-composer";

export const isLeadReply = (a: Pick<ClaimedAction, "action_kind">): boolean => a.action_kind === LEAD_REPLY_KIND;

/** The filing's drafting brief (payload.draft_input), when the filer provided one as an object. */
export function draftInputOf(payload: unknown): Obj {
  return obj(obj(payload).draft_input);
}

/** The body index.ts posts to the orchestrator. */
export function orchestratorRequest(a: ClaimedAction): Obj {
  const p = a.payload as Record<string, unknown> | null;
  // Every kind but the lead reply: byte-for-byte the expression the worker always used.
  const brief: Obj = isLeadReply(a)
    ? leadReplyInput(a.payload)
    : ((p && typeof p === "object" && p.draft_input && typeof p.draft_input === "object")
      ? p.draft_input as Obj
      : {});
  return {
    action: "tool_invoke",
    slug: a.draft_subagent_slug,
    tenant_id: a.tenant_id,
    input: {
      action_kind: a.action_kind,
      title: a.title,
      summary: a.summary,
      contact_id: a.contact_id,
      // The filing's drafting brief, when the filer provided one: composer-ready
      // fields (intent/key_points/tone/cta/…) spread to top level so the drafting
      // specialist receives its actual input contract, not filing metadata.
      ...brief,
    },
    context: { contact_id: a.contact_id, conversation_id: a.conversation_id },
  };
}

/** The lead reply's brief: the filing's, with no recipient in it and the untrusted flag forced on. */
function leadReplyInput(payload: unknown): Obj {
  const brief: Obj = { ...draftInputOf(payload) };
  delete brief.recipient_email;
  delete brief.contact_id;
  delete brief.client_id;
  brief.untrusted_submission = true;
  return brief;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Only real block/inline email tags count as HTML. Plain text that merely contains "<Dana>" or "a < b > c"
// is text, and is escaped — never passed through as markup.
const looksLikeHtml = (s: string): boolean =>
  /<\/?(p|br|div|span|a|strong|em|b|i|u|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|blockquote|hr|img)(\s[^<>]*)?\/?>/i.test(s);

// What of the composer's answer is kept as the record. An allow-list, not a deny-list, and only small
// platform-authored values: anything the model or the composer put elsewhere — a `to`, a
// `recipient`, a summary naming an address, the reviewer's free-text findings, the draft wording
// again, its HTML — is not carried forward. compliance_flags are the composer's own rule-match
// codes (regex sources it authored), not model text.
const RAW_KEYS = ["subagent", "compliance_verdict", "compliance_flags", "requires_approval", "confidence"];
const RAW_DRAFT_KEYS = ["tone_used", "length", "word_count"];
const RAW_MAX_STRING = 200;
const RAW_MAX_FLAGS = 20;

/** A small, flat value: a bounded string, a finite number, a boolean, or a bounded list of strings. */
function smallValue(v: unknown): unknown {
  if (typeof v === "string") return v.slice(0, RAW_MAX_STRING);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").slice(0, RAW_MAX_FLAGS).map((x) => (x as string).slice(0, RAW_MAX_STRING));
  return undefined;
}

function pick(o: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const k of keys) {
    if (!(k in o)) continue;
    const v = smallValue(o[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export type EmailDraft = { channel: "email"; subject: string; body: string; raw: Obj };

/**
 * Shape a drafting specialist's result into the lead-reply email contract (plain text only), or null
 * when it carries no usable subject + body. Reads the composer's nested `draft.{subject, body_text,
 * body_html}` first, then a flat `{subject, body_text | body | body_html}`. Text is preferred; a body
 * given only as HTML is reduced to text (tags removed, entities decoded) and the HTML is dropped.
 */
export function shapeEmailDraft(result: unknown): EmailDraft | null {
  const r = obj(result);
  if (r.ok === false) return null;
  const d = obj(r.draft);
  const subject = oneLineSubject(str(d.subject) || str(r.subject));
  const flatBody = str(d.body) || str(r.body);
  const html = str(d.body_html) || str(r.body_html) || (looksLikeHtml(flatBody) ? flatBody : "");
  let text = str(d.body_text) || str(r.body_text) || (flatBody && !looksLikeHtml(flatBody) ? flatBody : "");
  if (!text && html) text = htmlToText(html);
  if (!subject || !text) return null;
  const raw = pick(r, RAW_KEYS);
  if (r.draft && typeof r.draft === "object" && !Array.isArray(r.draft)) raw.draft = pick(d, RAW_DRAFT_KEYS);
  return { channel: "email", subject, body: text, raw };
}

/**
 * A subject is one line of text: markup removed, line breaks and NULs collapsed, and no longer than
 * the governed email door accepts (COMMS_EMAIL_SUBJECT_MAX, contract.ts) — a longer one would be a
 * draft the owner approves and the door then refuses. Cut at a word when one is near, never inside a
 * surrogate pair (a lone half is not storable text).
 */
function oneLineSubject(s: string): string {
  const line = (looksLikeHtml(s) ? htmlToText(s) : s).split("\u0000").join(" ").replace(/\s+/g, " ").trim();
  if (line.length <= COMMS_EMAIL_SUBJECT_MAX) return line;
  let cut = line.slice(0, COMMS_EMAIL_SUBJECT_MAX);
  const space = cut.lastIndexOf(" ");
  if (space >= COMMS_EMAIL_SUBJECT_MAX - 40) cut = cut.slice(0, space);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

export interface DraftDeps {
  /** POST the orchestrator. Throws only when no answer came back (network error / timeout). */
  invoke(request: Obj): Promise<{ httpOk: boolean; status: number; body: unknown }>;
  rpc(fn: string, args: Obj): Promise<{ error: { message: string } | null }>;
}

export type DraftOutcome =
  | { kind: "drafted"; invocationId: string | null }
  | { kind: "failed"; stage: "preflight" | "invoke" | "draft" | "advance"; error: string };

export const MISSING_INTENT_ERROR =
  "draft_input.intent missing: the email composer needs to know what this email should accomplish";
export const EMPTY_EMAIL_DRAFT_ERROR =
  "draft_incomplete: the drafting specialist returned no usable email subject and body, so nothing was sent to approvals";

type OrchBody = { ok?: unknown; error?: unknown; result?: unknown; invocation_id?: unknown } | null | undefined;

/**
 * Draft one claimed action. Throws are left to the caller (index.ts fails the action in its catch,
 * exactly as before). Every failure decided here marks the action 'blocked' via fail_action with the
 * reason, and advance_action is never called for it.
 */
export async function draftClaimedAction(deps: DraftDeps, a: ClaimedAction): Promise<DraftOutcome> {
  const leadReply = isLeadReply(a);
  const followupEmail = a.action_kind === "client.followup" || a.action_kind === "owner.followup_email";
  const emailDraft = leadReply || followupEmail;

  // The composer refuses an email with no intent; say so plainly before spending an invocation.
  if (emailDraft && a.draft_subagent_slug === EMAIL_COMPOSER_SLUG && !str(draftInputOf(a.payload).intent)) {
    await deps.rpc("fail_action", { p_action_id: a.id, p_error: MISSING_INTENT_ERROR });
    return { kind: "failed", stage: "preflight", error: MISSING_INTENT_ERROR };
  }

  const orch = await deps.invoke(orchestratorRequest(a));
  const orchBody = orch.body as OrchBody;
  if (!orch.httpOk || orchBody?.ok !== true) {
    const msg = `invoke ${a.draft_subagent_slug} failed (${orch.status}): ${
      typeof orchBody?.error === "string" ? orchBody.error : JSON.stringify(orchBody).slice(0, 300)
    }`;
    await deps.rpc("fail_action", { p_action_id: a.id, p_error: msg });
    return { kind: "failed", stage: "invoke", error: msg };
  }

  // The draft the sub-agent produced (§13 — store what it actually returned, not a hoped-for shape).
  const raw = orchBody.result;
  let draftContent: unknown;
  if (emailDraft) {
    const email = shapeEmailDraft(raw);
    if (!email || (followupEmail && (email.body.includes("\u0000") || email.body.length > COMMS_EMAIL_BODY_MAX))) {
      await deps.rpc("fail_action", { p_action_id: a.id, p_error: EMPTY_EMAIL_DRAFT_ERROR });
      return { kind: "failed", stage: "draft", error: EMPTY_EMAIL_DRAFT_ERROR };
    }
    draftContent = email;
  } else {
    draftContent = raw && typeof raw === "object" ? raw : { content: raw ?? null };
  }
  const invocationId: string | null = typeof orchBody.invocation_id === "string" ? orchBody.invocation_id : null;

  // Advance to 'drafted' + attach the draft + the invocation that produced it. advance_action then
  // routes send-kinds into paige_pending_approvals (never sends). tenant pinned from the claimed row.
  const { error: advErr } = await deps.rpc("advance_action", {
    p_action_id: a.id,
    p_to_status: "drafted",
    p_draft_content: draftContent,
    p_assigned_subagent_slug: a.draft_subagent_slug,
    p_invocation_id: invocationId,
    p_tenant_id: a.tenant_id,
  });
  if (advErr) {
    await deps.rpc("fail_action", { p_action_id: a.id, p_error: `advance failed: ${advErr.message}` });
    return { kind: "failed", stage: "advance", error: advErr.message };
  }
  return { kind: "drafted", invocationId };
}
