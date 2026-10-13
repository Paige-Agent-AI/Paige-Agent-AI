// paige-action-worker — drafting ONE claimed action: invoke its drafting specialist, shape what came
// back, and advance it (or fail it honestly). index.ts owns auth, the claim, receipts and the digest;
// this module owns the per-action decision so it can be driven without a network or a database.
//
// EVERY KIND BUT ONE is drafted exactly as the worker always drafted it: the filing's draft_input is
// spread into the specialist's input, and the specialist's result is stored as returned.
//
// owner.lead_followup — a reply to someone who filled in a business's website form (Exp03 S3) — is
// the one exception, and it is shaped here because the form's answers are UNTRUSTED:
//   • The specialist is told the submission is untrusted (`untrusted_submission: true`), so the
//     email composer passes the visitor's answers and details as delimited, quoted DATA with an
//     explicit rule that they are not instructions (subagent-email-composer/prompt.ts). Forced here,
//     whatever the filing said. The filing names no recipient (`recipient_email` is dropped): the
//     composer reads the contact on the server.
//   • The stored draft is
//         { channel: 'email', subject, body: <plain text>, body_html, raw }
//     — `body` is plain text so every preview shows words, not markup; `body_html` is the HTML twin.
//   • The recipient is NEVER taken from the drafting output. `raw` keeps only an allow-list of the
//     composer's record (draft wording, compliance verdict) — no `to`/`cc`/`recipient`/`summary` or
//     anything else the model echoed — so no later reader can be tempted to address from it (§9).
//     The owner's send goes through comms-email-command, which resolves the recipient itself.
//   • A filing with no intent, or a result with no usable subject AND body, never reaches the
//     approvals queue: the action is failed ('blocked') with the reason, instead of offering the
//     owner an empty email (§13).
// Nothing here sends. advance_action routes a send kind to paige_pending_approvals; a send only ever
// happens when the owner sends it through the governed email door.
//
// Pure TypeScript with erasable syntax only, so node --test, vitest and deno test can all load it.

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

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
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

// What of the composer's answer is kept as the record. An allow-list, not a deny-list: anything the
// model or the composer put elsewhere — a `to`, a `recipient`, a summary naming an address — is not
// carried forward.
const RAW_KEYS = ["subagent", "compliance_verdict", "compliance_findings", "compliance_flags", "requires_approval", "confidence"];
const RAW_DRAFT_KEYS = ["subject", "body_html", "body_text", "tone_used", "length", "word_count"];

function pick(o: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

export type EmailDraft = { channel: "email"; subject: string; body: string; body_html: string; raw: Obj };

/**
 * Shape a drafting specialist's result into the lead-reply email contract, or null when it carries
 * no usable subject + body. Reads the composer's nested `draft.{subject, body_html, body_text}`
 * first, then a flat `{subject, body_html | body, body_text}`. A body given only as text is escaped
 * into HTML; a body given only as HTML gets a plain-text twin.
 */
export function shapeEmailDraft(result: unknown): EmailDraft | null {
  const r = obj(result);
  if (r.ok === false) return null;
  const d = obj(r.draft);
  const subject = str(d.subject) || str(r.subject);
  const flatBody = str(d.body) || str(r.body);
  let html = str(d.body_html) || str(r.body_html) || (looksLikeHtml(flatBody) ? flatBody : "");
  let text = str(d.body_text) || str(r.body_text) || (flatBody && !looksLikeHtml(flatBody) ? flatBody : "");
  if (!html && text) html = textToHtml(text);
  if (!text && html) text = htmlToText(html);
  if (!subject || !html || !text) return null;
  const raw = pick(r, RAW_KEYS);
  if (r.draft && typeof r.draft === "object" && !Array.isArray(r.draft)) raw.draft = pick(d, RAW_DRAFT_KEYS);
  return { channel: "email", subject, body: text, body_html: html, raw };
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

  // The composer refuses an email with no intent; say so plainly before spending an invocation.
  if (leadReply && a.draft_subagent_slug === EMAIL_COMPOSER_SLUG && !str(draftInputOf(a.payload).intent)) {
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
  if (leadReply) {
    const email = shapeEmailDraft(raw);
    if (!email) {
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
