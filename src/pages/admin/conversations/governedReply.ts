// The Conversations email reply, sent through the governed email door (comms-email-command) instead of
// send-message's undo window — EXP03 O12 piece 3, owner-approved option B (ii), 2026-10-27.
//
// Send asks the door to CHECK: it resolves the real To and From on the server and binds the owner's
// approval to these exact words (a single-use fingerprint that lasts ten minutes). The composer shows
// that check inline, in place of its action row; "Send now" spends the fingerprint. Nothing is sent
// on the check. This file is the pure half: the request, the scope that keys the operation id, the
// plain-text signature, and the owner copy for every door answer. No React, no network, no clock
// (the caller passes `nowMs`).
import { parseConfirmPreview, formatFileSize, type ConfirmEmailPreview } from "@/components/chat/confirmPreview";
import {
  COMMS_EMAIL_ACTION, COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES, COMMS_EMAIL_SEND_AT_MIN_LEAD_MS, FINGERPRINT,
  parseCommsEmailCommand, parseCommsEmailSendAt,
} from "../../../../supabase/functions/_shared/comms-email/contract";
import type { Attachment } from "./inbox-shared";
import { readableMessageBody } from "./messageReading";
import { governedAttachmentRequest, governedNotSentLine, scheduledForLabel } from "./governedSend";

/* ───────────────────────── the request ───────────────────────── */

/** A signature is stored as HTML; the governed email carries plain text (the server derives the HTML). */
export function signaturePlainText(html: string): string {
  return readableMessageBody({ body_text: null, body_html: html });
}

/** The words the email carries: the reply, then the signature under a "--" line when one is on. */
export function governedReplyText(body: string, signatureHtml: string | null): string {
  const reply = body.trim();
  const sig = signatureHtml ? signaturePlainText(signatureHtml) : "";
  return sig ? `${reply}\n\n--\n${sig}` : reply;
}

/** Floors a picked time to the whole minute (the door stores minutes). `null` for an unreadable time. */
export function floorSendAtToMinute(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(Math.floor(ms / 60_000) * 60_000).toISOString() : null;
}

export type SendAtCheck = { ok: true; sendAt: string } | { ok: false; why: "too_soon" | "too_far" | "invalid" };

/** The scheduled time as the door will accept it (2 minutes to 30 days ahead), checked BEFORE any call. */
export function checkGovernedSendAt(scheduledFor: string, nowMs: number): SendAtCheck {
  const floored = floorSendAtToMinute(scheduledFor);
  if (!floored) return { ok: false, why: "invalid" };
  try { return { ok: true, sendAt: parseCommsEmailSendAt(floored, nowMs) }; }
  catch {
    const at = Date.parse(floored);
    return { ok: false, why: at < nowMs + COMMS_EMAIL_SEND_AT_MIN_LEAD_MS ? "too_soon" : "too_far" };
  }
}

export interface GovernedReplyDraft {
  tenantId: string;
  contactId: string;
  connectorId: string;
  subject: string;
  /** governedReplyText(): the reply plus the plain-text signature. */
  text: string;
  /** Whole-minute ISO time, already checked; absent = send now. */
  sendAt?: string;
  /** Composer upload paths, in the order staged. */
  paths: string[];
}

/**
 * The scope an operation id belongs to. Exactly what the door binds an approval to, so the same words
 * reuse the same operation (a replay, never a second email) and any change starts a new one.
 */
export function governedReplyScope(d: GovernedReplyDraft): string {
  return JSON.stringify([d.tenantId, d.contactId, d.connectorId, d.subject, d.text, d.sendAt ?? null, d.paths]);
}

export type GovernedReplyRequest = {
  expected_tenant_id: string;
  operation_id: string;
  /** connector_id null = no sender picked yet: the door picks the only one, or asks which. */
  command: { action: typeof COMMS_EMAIL_ACTION; contact_id: string; connector_id: string | null; subject: string; body: string };
  send_at?: string;
  attachments?: { path: string }[];
  approved_fingerprint?: string;
};

/**
 * The door request, checked with the door's OWN command parser first (§18): a subject over 200
 * characters or a body over 10,000 is caught here and never sent as a call that can only be refused.
 */
export function buildGovernedReplyRequest(d: GovernedReplyDraft, operationId: string, fingerprint?: string):
  { ok: true; request: GovernedReplyRequest } | { ok: false; problem: "subject" | "body" | "command" } {
  const command = { action: COMMS_EMAIL_ACTION, contact_id: d.contactId, connector_id: d.connectorId || null, subject: d.subject, body: d.text };
  try { parseCommsEmailCommand(command); }
  catch (e) {
    const code = e instanceof Error ? e.message : "";
    return { ok: false, problem: code === "COMMS_EMAIL_SUBJECT_INVALID" ? "subject" : code === "COMMS_EMAIL_BODY_INVALID" ? "body" : "command" };
  }
  return {
    ok: true,
    request: {
      expected_tenant_id: d.tenantId, operation_id: operationId, command,
      ...(d.sendAt ? { send_at: d.sendAt } : {}),
      ...(d.paths.length ? { attachments: d.paths.map((path) => ({ path })) } : {}),
      ...(fingerprint ? { approved_fingerprint: fingerprint } : {}),
    },
  };
}

/**
 * The staged files as the door will take them. Any file the door would turn away means NO call: the
 * owner is told which ones, by name. The total is checked against the door's own limit too.
 */
export function governedReplyFiles(tenantId: string, staged: readonly Attachment[]):
  { ok: true; paths: string[] } | { ok: false; refused: string[] } | { ok: false; tooLarge: true } {
  if (!staged.length) return { ok: true, paths: [] };
  const { attachments, refused } = governedAttachmentRequest(tenantId, staged);
  if (refused.length) return { ok: false, refused };
  const total = staged.reduce((n, a) => n + (typeof a.size === "number" && a.size > 0 ? a.size : 0), 0);
  if (total > COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES) return { ok: false, tooLarge: true };
  return { ok: true, paths: attachments.map((a) => a.path) };
}

/* ───────────────────────── reading the door's answer ───────────────────────── */

export type DoorAnswer =
  /** The door answered: its HTTP status when known, and its JSON body. */
  | { transport: false; status: number | null; body: Record<string, unknown> }
  /** No readable answer: the call failed, or the body was not JSON. Nothing is known. */
  | { transport: true };

const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/**
 * `supabase.functions.invoke` resolves a non-2xx answer as an HTTP error whose `context` is the
 * Response: the door's own JSON body is read from there. The one reader for this door's answers —
 * the reply check and confirm, and the scheduled-send Cancel.
 */
export async function readDoorAnswer(result: { data?: unknown; error?: unknown; response?: unknown }): Promise<DoorAnswer> {
  const statusOf = (r: unknown) => (typeof (r as { status?: unknown } | null)?.status === "number" ? (r as { status: number }).status : null);
  if (!result.error) {
    const body = objectOf(result.data);
    return body ? { transport: false, status: statusOf(result.response), body } : { transport: true };
  }
  const context = (result.error as { context?: { status?: unknown; json?: () => Promise<unknown> } }).context;
  if (!context || typeof context.json !== "function") return { transport: true };
  const body = objectOf(await context.json().catch(() => null));
  return body ? { transport: false, status: statusOf(context), body } : { transport: true };
}

/* ───────────────────────── what the owner is told ───────────────────────── */

/** Who the email goes to and from, as names the owner recognises. */
export interface DoorCopyContext {
  /** The contact's name on screen. */
  name: string;
  /** The chosen sending address (the browser's connector record) — used only in a refusal's words. */
  from: string;
}

export type StripAction = "retry" | "recheck" | "settings" | "check_status";

/** The inline check, ready to confirm. To and From are what the SERVER resolved. */
export interface ReadyCheck {
  fingerprint: string;
  expiresAt: number;
  preview: ConfirmEmailPreview;
  /** "Sends Wed, Oct 28, 9:00 AM" — present only for a scheduled email. */
  when: string | null;
  files: { name: string; size: string }[];
}

export type DoorView =
  | { kind: "ready"; check: ReadyCheck }
  | { kind: "choose"; senders: { connectorId: string; fromAddress: string }[] }
  /** Nothing went out. The words stay. `settle` spends the operation id (its result is final). */
  | { kind: "cant"; head: string; body?: string; action?: StripAction; settle: boolean; say: string }
  /** A send that is done, or may be: the composer clears so one more click cannot mail a copy. */
  | { kind: "recorded"; outcome: "provider_accepted" | "scheduled" | "outcome_unknown" | "failed"; say: string; already: boolean; sendAt?: string };

const NOTHING_SENT = "Nothing was sent.";
const couldntCheck = (settle = false): DoorView => ({ kind: "cant", head: "Couldn't check just now.", body: NOTHING_SENT, action: "retry", settle, say: "Couldn't check just now. Nothing was sent." });
const cant = (head: string, body: string | undefined, opts: { action?: StripAction; settle?: boolean } = {}): DoorView => ({
  kind: "cant", head, ...(body ? { body } : {}), ...(opts.action ? { action: opts.action } : {}), settle: !!opts.settle,
  say: `${head}${body ? ` ${body}` : ""} Your words are kept.`,
});
const sentence = (line: string) => {
  const s = line.replace(/^Not sent — /, "");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
};
const codeOf = (b: Record<string, unknown>) => String(b.reason ?? b.code ?? "").toUpperCase();

/** The answer to a readiness or files refusal, in owner words. `null` when the code is not one of these. */
function refusalCopy(code: string, ctx: DoorCopyContext, settle: boolean): DoorView | null {
  const who = ctx.name.trim() || "this person";
  const from = ctx.from.trim() || "This sending address";
  switch (code) {
    case "RECIPIENT_EMAIL_MISSING": return cant(`There's no email address on ${who}'s contact card.`, "Add one, then send.", { settle });
    case "SENDER_VERIFICATION_MISSING": return cant(`${from} isn't verified for sending.`, "Finish it in Settings → Email, then send.", { action: "settings", settle });
    case "TENANT_EMAIL_SENDER_MISSING": return cant("This sending address can't send email.", "Choose another.", { settle });
    case "EMAIL_RECONNECT_REQUIRED": return cant(`Reconnect ${from}, then send.`, undefined, { action: "settings", settle });
    case "EMAIL_PROVIDER_NOT_CONFIGURED": return cant("Email sending isn't switched on for this business yet.", undefined, { settle });
    case "SENDER_CHOICE_REQUIRED": return cant("Pick who this comes from.", "Choose a sending address above, then send.", { settle });
    case "BLOCKED_SUPPRESSED": return cant(`Can't send to ${who}.`, "They unsubscribed or this address bounced.", { settle });
    case "BLOCKED_NO_CONSENT":
    case "BLOCKED_CLIENT_DND": return cant(`Can't send to ${who}.`, sentence(governedNotSentLine(code.toLowerCase())), { settle });
    case "CONTACT_NOT_IN_WORKSPACE": return cant("This person isn't a contact in this business.", undefined, { settle });
    case "QUEUED_QUIET_HOURS": return cant("It can't go out right now — it's quiet hours.", "Schedule it for later.", { settle });
    case "QUEUED_TENANT_DND": return cant("It can't go out right now — Do not disturb is on.", "Schedule it for later.", { settle });
    case "RECIPIENT_PREFERENCES_UNVERIFIED":
    case "EMAIL_READINESS_UNVERIFIED": return couldntCheck(settle);
    case "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED": return cant("Files only go from a PAIGE Email address.", "Remove the files, or choose a PAIGE Email address.", { settle });
    case "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED": return cant("One of these files is a type email can't carry.", "Remove it, then send.", { settle });
    case "COMMS_EMAIL_ATTACHMENT_TOO_LARGE": return cant("A file is over 10 MB.", "Remove it, then send.", { settle });
    case "COMMS_EMAIL_ATTACHMENTS_TOO_LARGE": return cant("These files add up to more than 10 MB.", "Remove some, then send.", { settle });
    case "COMMS_EMAIL_ATTACHMENT_EMPTY": return cant("One of these files is empty.", "Remove it and attach it again.", { settle });
    case "COMMS_EMAIL_ATTACHMENTS_INVALID": return cant("These files can't go with this email.", "Remove them and attach them again.", { settle });
    case "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE": return { kind: "cant", head: "Couldn't read the files just now.", body: NOTHING_SENT, action: "retry", settle, say: "Couldn't read the files just now. Nothing was sent." };
    case "COMMS_EMAIL_ATTACHMENT_CHANGED":
    case "COMMS_EMAIL_ATTACHMENTS_CHANGED": return cant("A file changed after the check.", "Check again.", { action: "recheck", settle });
    case "COMMS_EMAIL_SEND_AT_INVALID": return cant("That time can't be used.", "Pick a time between 2 minutes and 30 days from now.", { settle });
    case "COMMS_EMAIL_SEND_AT_PASSED": return cant("That time is too close now.", "Pick a new time.", { settle });
    case "RECIPIENT_CHANGED": return cant(`${ctx.name.trim() || "Their"}'s email address changed since the check.`, "Check again.", { action: "recheck", settle });
    case "SENDER_CHANGED": return cant("The sending address changed since the check.", "Check again.", { action: "recheck", settle });
    case "CONTENT_CHANGED": return cant("The email changed since the check.", "Check again.", { action: "recheck", settle });
    case "SEND_NOT_ADMITTED": return cant("It didn't go out.", "Check again to send it.", { action: "recheck", settle });
    case "COMMS_EMAIL_FORBIDDEN": return cant("Only an owner or admin sends email for the business.", "Ask an owner or admin to send it; your words stay here for them.", { settle });
    case "COMMS_PROVIDER_EXECUTION_DISABLED": return cant("Sending is paused for this business.", undefined, { settle });
    case "WORKSPACE_CHANGED": return cant("You switched business in another tab.", "Reopen this one, then send.", { settle });
    case "UNAUTHENTICATED": return cant("You've been signed out.", "Sign in again, then send.", { settle });
    default: return null;
  }
}

/** The 202 a check may be trusted with: this operation, these exact words, this time, these files, not expired. */
function readyCheck(b: Record<string, unknown>, request: GovernedReplyRequest, nowMs: number): ReadyCheck | null {
  if (b.outcome !== "approval_required" || b.operation_id !== request.operation_id) return null;
  if (typeof b.fingerprint !== "string" || !FINGERPRINT.test(b.fingerprint)) return null;
  const expiresAt = typeof b.expires_at === "string" ? Date.parse(b.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
  const preview = parseConfirmPreview(b.preview);
  if (!preview || preview.subject !== request.command.subject || preview.body_text !== request.command.body) return null;
  if ((preview.send_at ?? null) !== (request.send_at ?? null)) return null;
  const rawFiles = objectOf(b.preview)?.attachments;
  const wanted = request.attachments?.length ?? 0;
  // The files the server read must be the files asked for: a list it could not read is no check at all.
  if ((preview.attachments?.length ?? 0) !== wanted || (wanted === 0 && rawFiles !== undefined)) return null;
  return {
    fingerprint: b.fingerprint, expiresAt, preview,
    when: preview.send_at ? `Sends ${scheduledForLabel(preview.send_at)}` : null,
    files: (preview.attachments ?? []).map((f) => ({ name: f.name, size: formatFileSize(f.size) })),
  };
}

/**
 * Every answer the door can give, as what the composer does and says. Owner language only: no code
 * ever reaches the screen. `stage` is "check" (Send) or "confirm" (Send now).
 */
export function classifyDoorAnswer(answer: DoorAnswer, stage: "check" | "confirm", request: GovernedReplyRequest, ctx: DoorCopyContext, nowMs: number): DoorView {
  if (answer.transport) {
    return stage === "confirm"
      ? cant("Couldn't confirm this went out — don't resend.", "Check its status before doing anything else.", { action: "check_status" })
      : couldntCheck();
  }
  const b = answer.body;
  const outcome = typeof b.outcome === "string" ? b.outcome : "";
  const code = codeOf(b);
  // A replay of this operation, or the settled result of an identical earlier send: either way final.
  const replayed = b.replayed === true || typeof b.reconciled_operation_id === "string";

  if (outcome === "approval_required") {
    const check = readyCheck(b, request, nowMs);
    return check ? { kind: "ready", check } : couldntCheck();
  }
  if (outcome === "sender_choice_required") {
    const senders = Array.isArray(b.senders) ? b.senders.map(objectOf).filter((s): s is Record<string, unknown> => !!s)
      .filter((s) => typeof s.connector_id === "string" && typeof s.from_address === "string")
      .map((s) => ({ connectorId: s.connector_id as string, fromAddress: s.from_address as string })) : [];
    return senders.length ? { kind: "choose", senders } : couldntCheck();
  }
  if (b.ok === true && outcome === "provider_accepted") {
    const already = stage === "check" || replayed;
    return { kind: "recorded", outcome, already, say: already ? "Already sent. Accepted by the email service." : "Accepted by the email service." };
  }
  if (b.ok === true && outcome === "scheduled") {
    const sendAt = typeof b.send_at === "string" ? b.send_at : undefined;
    const already = stage === "check" || replayed;
    const when = sendAt ? scheduledForLabel(sendAt) : "the time you picked";
    return { kind: "recorded", outcome, already, ...(sendAt ? { sendAt } : {}), say: already ? `Already scheduled for ${when}.` : `Scheduled for ${when}.` };
  }
  if (outcome === "outcome_unknown") {
    if (stage === "confirm") {
      return { kind: "recorded", outcome, already: false, say: "Couldn't confirm this went out. Don't resend." };
    }
    // A check never dispatches; an unknown here is an EARLIER send of the same email, still unsettled.
    const who = ctx.name.trim() || "them";
    if (code === "COMMS_EMAIL_IDENTICAL_IN_FLIGHT") return cant(`The same email to ${who} is still going out from an earlier send — don't send it again.`, undefined);
    if (code === "COMMS_EMAIL_TEAMMATE_IN_FLIGHT") return cant("A teammate is already sending this exact email.", "Don't send it again.");
    return cant("Couldn't confirm whether this went out — don't resend.", undefined);
  }
  if (outcome === "failed") {
    // The email service turned it down; the conversation shows the Failed row and its reason. On a
    // check this is an earlier send of these exact words (a replay, or the identical email settling).
    return stage === "confirm"
      ? { kind: "recorded", outcome, already: false, say: "The email service didn't accept it. The reason is in the conversation." }
      : cant("This email didn't go out last time.", "The reason is in the conversation. Change the words to try again.", { settle: true });
  }
  // A refusal: nothing was dispatched. On a confirm the operation's answer is final; a replayed
  // refusal is too. A fresh refusal on a check keeps the id, so asking again is the same request.
  const settle = stage === "confirm" || replayed;
  const known = refusalCopy(code, ctx, settle);
  if (known) return known;
  if (answer.status === 503 || /UNAVAILABLE|UNVERIFIED|RECEIPT_FAILED/.test(code)) return couldntCheck(settle);
  return cant("This email can't be sent from here right now.", NOTHING_SENT, { settle });
}

/** What a too-soon or too-far scheduled time says (no call is made). */
export function sendAtProblemCopy(why: "too_soon" | "too_far" | "invalid"): DoorView {
  if (why === "too_soon") return cant("That time is too soon.", "Pick a time at least 2 minutes from now.");
  if (why === "too_far") return cant("That time is too far ahead.", "Pick a time within 30 days.");
  return cant("That time can't be used.", "Pick a time between 2 minutes and 30 days from now.");
}

/** The words for a check that never reached the door. Exported so the copy and its tests share one home. */
export const LOCAL_COPY = {
  offline: (): DoorView => ({ kind: "cant", head: "Can't check right now. You're offline.", body: "Nothing was sent. Press Send again when you're back online.", action: "retry", settle: false, say: "Can't check right now. You're offline. Nothing was sent." }),
  noContact: (name: string): DoorView => cant(`Add ${name.trim() || "this person"} as a contact first.`, "Email goes only to people saved as contacts in this business."),
  reopen: (): DoorView => cant("Reopen this business, then send.", "This page and your session point at different businesses. Nothing was sent."),
  refusedFiles: (names: string[]): DoorView => cant(`${names.join(", ")} can't go with this email.`, "Remove them and attach them again."),
  filesTooLarge: (): DoorView => cant("These files add up to more than 10 MB.", "Remove some, then send."),
  subjectTooLong: (): DoorView => cant("The subject is too long.", "Keep it under 200 characters."),
  bodyTooLong: (): DoorView => cant("This email is too long to send from here.", "Keep it under 10,000 characters, signature included."),
  cantBuild: (): DoorView => cant("This email can't be checked.", "Check the subject and message, then send."),
} as const;
