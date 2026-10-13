// paige-action-worker — drafting ONE claimed action: invoke its drafting specialist, shape what came
// back, and advance it (or fail it honestly). index.ts owns auth, the claim, receipts and the digest;
// this module owns the per-action decision so it can be driven without a network or a database.
//
// THE EMAIL SEND CONTRACT (send_via_approval kinds that are emails — e.g. owner.lead_followup):
// the draft stored on the action, and copied by advance_action onto the approval row, is
//     { channel: 'email', subject, body (html), body_text, raw }
// which execute-approval reads after the owner approves. Two rules hold it safe:
//   • The recipient is NEVER taken from the drafting output. execute-approval resolves it on the
//     server from the action's contact; any to/cc/bcc/recipient the composer echoes is dropped, even
//     from `raw`, so no later reader can be tempted to use it (§9).
//   • An email with no usable subject AND body never reaches the approvals queue. The action is
//     failed ('blocked') with the reason, so it surfaces instead of offering the owner an empty
//     email to approve (§13).
// Nothing here sends. advance_action routes a send kind to paige_pending_approvals; only the owner's
// approval, through execute-approval, ever sends.
//
// Every other kind is drafted exactly as before: the specialist's result is stored as returned.
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

/** The specialist whose input contract requires an `intent` (what the email should accomplish). */
export const EMAIL_COMPOSER_SLUG = "email-composer";

/**
 * Is this an EMAIL send kind? Its executor is send_via_approval and it is not an SMS kind. The SMS
 * test mirrors execute-approval's own rule (an approval category — the kind slug — containing "sms"
 * takes the SMS path), so an SMS nudge drafted by the email composer is never relabelled an email.
 */
export function isEmailSendKind(sendViaApprovalKinds: ReadonlySet<string>, actionKind: string): boolean {
  return sendViaApprovalKinds.has(actionKind) && !actionKind.toLowerCase().includes("sms");
}

/** The filing's drafting brief (payload.draft_input), when the filer provided one as an object. */
export function draftInputOf(payload: unknown): Obj {
  const di = obj(payload).draft_input;
  return di && typeof di === "object" && !Array.isArray(di) ? di as Obj : {};
}

/** The body index.ts posts to the orchestrator — unchanged from the original worker. */
export function orchestratorRequest(a: ClaimedAction): Obj {
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
      ...draftInputOf(a.payload),
    },
    context: { contact_id: a.contact_id, conversation_id: a.conversation_id },
  };
}

const RECIPIENT_KEYS = ["to", "cc", "bcc", "recipient", "recipients", "recipient_email", "recipient_name", "email"];

function withoutRecipients(o: Obj): Obj {
  const out: Obj = { ...o };
  for (const k of RECIPIENT_KEYS) delete out[k];
  return out;
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

export type EmailDraft = { channel: "email"; subject: string; body: string; body_text: string; raw: Obj };

/**
 * Shape a drafting specialist's result into the email contract, or null when it carries no usable
 * subject + body. Reads the composer's nested `draft.{subject, body_html, body_text}` first, then a
 * flat `{subject, body_html | body, body_text}`. A body given only as text is escaped into HTML.
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
  const raw = withoutRecipients(r);
  if (r.draft && typeof r.draft === "object" && !Array.isArray(r.draft)) raw.draft = withoutRecipients(d);
  return { channel: "email", subject, body: html, body_text: text, raw };
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

/**
 * Draft one claimed action. Throws are left to the caller (index.ts fails the action in its catch,
 * exactly as before). Every failure that is decided here marks the action 'blocked' via fail_action
 * with the reason, and advance_action is never called for it.
 */
export async function draftClaimedAction(
  deps: DraftDeps,
  a: ClaimedAction,
  sendViaApprovalKinds: ReadonlySet<string>,
): Promise<DraftOutcome> {
  const emailSend = isEmailSendKind(sendViaApprovalKinds, a.action_kind);

  // The composer refuses an email with no intent; say so plainly before spending an invocation.
  if (emailSend && a.draft_subagent_slug === EMAIL_COMPOSER_SLUG && !str(draftInputOf(a.payload).intent)) {
    await deps.rpc("fail_action", { p_action_id: a.id, p_error: MISSING_INTENT_ERROR });
    return { kind: "failed", stage: "preflight", error: MISSING_INTENT_ERROR };
  }

  const orch = await deps.invoke(orchestratorRequest(a));
  const orchBody = obj(orch.body);
  if (!orch.httpOk || orchBody.ok !== true) {
    const msg = `invoke ${a.draft_subagent_slug} failed (${orch.status}): ${
      typeof orchBody.error === "string" ? orchBody.error : JSON.stringify(orch.body ?? {}).slice(0, 300)
    }`;
    await deps.rpc("fail_action", { p_action_id: a.id, p_error: msg });
    return { kind: "failed", stage: "invoke", error: msg };
  }

  // The draft the sub-agent produced (§13 — store what it actually returned, not a hoped-for shape).
  const raw = orchBody.result;
  let draftContent: unknown;
  if (emailSend) {
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
