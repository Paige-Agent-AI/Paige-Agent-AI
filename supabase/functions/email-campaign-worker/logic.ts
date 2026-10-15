// Pure decisions for the marketing email worker (E1, owner rulings 2026-10-04). No I/O lives here:
// what one recipient's email says, what a send-message answer means for that recipient, and how a
// dispatch's durable-work envelope has to move to tell the truth about its campaign.

/** Escape text for an HTML context (the business name and postal address in the footer). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The email one recipient receives: an optional hidden preheader, the approved body, and the footer
 * every marketing send must carry — who sent it, their postal address, and a visible unsubscribe link.
 * `{{unsubscribe_url}}` is left for send-message, which mints the recipient's link and refuses to send
 * a marketing email without one.
 */
// Elements whose content is not shown as text (or that would take over the page) go with everything
// inside them, including one left open to the end, which would otherwise swallow the footer.
const HIDDEN_ELEMENTS = /<(script|style|textarea|title|xmp|plaintext|template|noscript|iframe|noembed|noframes|object)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const STRAY_CLOSERS = /<\/(?:script|style|textarea|title|xmp|plaintext|template|noscript|iframe|noembed|noframes|object)\s*>/gi;
const DOCUMENT_TAGS = /<\/?(?:link|meta|base|frame|frameset)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "param", "source", "track", "wbr"]);

/** The body as it is sent: no comments, no hidden or document-level elements, a stray "<" written out as
 *  text, and every element it opens closed, so the footer (postal address, unsubscribe) always shows. */
export function sanitizeBody(html: string): string {
  const s = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(HIDDEN_ELEMENTS, "").replace(STRAY_CLOSERS, "").replace(DOCUMENT_TAGS, "");
  const open: string[] = [];
  let out = "";
  let last = 0;
  for (const m of s.matchAll(TAG)) {
    out += s.slice(last, m.index).replace(/</g, "&lt;");
    last = (m.index ?? 0) + m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue; // closes nothing that is open
      for (const inner of open.splice(at).reverse()) out += `</${inner}>`;
    } else {
      out += m[0];
      if (!VOID_ELEMENTS.has(name) && !m[3].trim().endsWith("/")) open.push(name);
    }
  }
  out += s.slice(last).replace(/</g, "&lt;");
  for (const name of open.reverse()) out += `</${name}>`;
  return out;
}

export function renderCampaignEmail(input: {
  bodyHtml: string;
  preheader?: string | null;
  businessName?: string | null;
  postalAddress: string;
}): string {
  const preheader = (input.preheader ?? "").trim();
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>`
    : "";
  const body = sanitizeBody(input.bodyHtml);
  const who = [input.businessName?.trim(), input.postalAddress.trim()].filter(Boolean).map((v) => escapeHtml(String(v)));
  const footer =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;line-height:1.5;color:#6b6b6b">` +
    `${who.join("<br>")}<br>` +
    `<a href="{{unsubscribe_url}}" style="color:#6b6b6b">Unsubscribe</a> from these emails.` +
    `</div>`;
  return `${hidden}${body}${footer}`;
}

export type RecipientOutcome = {
  outcome: "sent" | "failed" | "outcome_unknown" | "skipped" | "deferred";
  /** For a deferred recipient: when the pre-send hold ends. */
  notBefore?: string | null;
  providerMessageId?: string | null;
  messageId?: string | null;
  skipReason?: string | null;
  error?: string | null;
};

const SKIP_REASON: Record<string, string> = {
  blocked_suppressed: "suppressed",
  blocked_client_dnd: "opted_out",
  blocked_no_consent: "no_consent",
  blocked_unsubscribe_unavailable: "unsubscribe_unavailable",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * What a send-message answer means for one recipient. Only an answer that proves nothing left
 * (a refusal before the provider, a connector error, a provider rejection) is `failed` or `skipped`;
 * anything that might have reached the provider — a timeout, a crash, a queued hand-off, an answer
 * we cannot read — is `outcome_unknown`, which is never resent automatically (owner ruling 6).
 */
export function mapSendResult(httpStatus: number | null, body: unknown, transportError?: string | null): RecipientOutcome {
  if (transportError || httpStatus === null) {
    return { outcome: "outcome_unknown", error: (transportError ?? "no_response").slice(0, 300) };
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const outcome = str(b.outcome) ?? str(b.status) ?? "";
  if (httpStatus >= 200 && httpStatus < 300 && outcome === "sent") {
    return {
      outcome: "sent",
      providerMessageId: str(b.vendor_message_id) ?? str(b.provider_message_id),
      messageId: str(b.message_id),
    };
  }
  // Held by the pre-send checks (quiet hours, a hold) before reaching a provider: send-message wrote
  // nothing and handed it back, so the recipient waits in the queue until the hold ends.
  if (httpStatus >= 200 && httpStatus < 300 && b.deferred === true) {
    return { outcome: "deferred", notBefore: str(b.scheduled_for), error: str(b.reason) ?? outcome };
  }
  if (httpStatus >= 200 && httpStatus < 300 && outcome.startsWith("blocked_")) {
    return { outcome: "skipped", skipReason: SKIP_REASON[outcome] ?? "sender_refused", error: str(b.reason) };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { outcome: "failed", error: (str(b.error) ?? `http_${httpStatus}`).slice(0, 300) };
  }
  if (httpStatus >= 200 && httpStatus < 300 && outcome === "failed") {
    return { outcome: "failed", error: (str(b.error) ?? str(b.reason) ?? "send_failed").slice(0, 300) };
  }
  // 5xx, queued_* (handed to a later drain), or an answer we cannot read.
  return { outcome: "outcome_unknown", error: (str(b.error) ?? (outcome || `http_${httpStatus}`)).slice(0, 300) };
}

export type Totals = {
  total: number; planned: number; sending: number; sent: number; failed: number;
  outcome_unknown: number; skipped: number; cancelled: number;
};

export type Envelope = {
  version_id: string;
  tenant_id: string;
  campaign_id: string;
  campaign_status: string;
  blocked_reason: string | null;
  work_id: string;
  work_key: string;
  work_status: "claimed" | "blocked" | "expired" | "outcome_unknown" | string;
  is_current: boolean;
  version_state: string;
  approved_by: string | null;
  totals: Totals;
};

export type EnvelopeStep = {
  status: "claimed" | "blocked" | "succeeded" | "failed" | "cancelled";
  reconciled: boolean;
  blockedReason?: string;
  terminalOutcome?: Record<string, unknown>;
  safeSummary?: string;
  errorCode?: string;
};

export type EnvelopePlan = {
  steps: EnvelopeStep[];
  heartbeat: boolean;
  /** The aggregated lifecycle event for the Rail (owner ruling 19), when this plan reaches one. */
  rail?: { outcome: "capability_succeeded" | "capability_failed" | "capability_refused"; detail: Record<string, unknown> };
};

export function summarize(t: Totals): string {
  const notDelivered = t.failed + t.outcome_unknown;
  const parts = [`Sent ${t.sent} of ${t.total}`];
  if (notDelivered) parts.push(`${notDelivered} not confirmed`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  if (t.cancelled) parts.push(`${t.cancelled} cancelled`);
  return parts.join(", ") + ".";
}

/**
 * How a dispatch's envelope must move so its status matches the campaign. The envelope is the
 * lifecycle record (claimed while sending, blocked while blocked, then one terminal state); the
 * recipients are the per-email truth, and the terminal outcome carries their totals as readback.
 *
 * Transition rules mirror transition_paige_durable_work: claimed → anything; blocked → claimed |
 * failed | cancelled; expired / outcome_unknown → claimed | succeeded | failed | cancelled, and only
 * as a reconciliation.
 */
export function planEnvelope(e: Envelope): EnvelopePlan {
  const work = e.work_status;
  const stale = work === "expired" || work === "outcome_unknown";
  const active = e.is_current && (e.campaign_status === "scheduled" || e.campaign_status === "sending");
  const blocked = e.is_current && e.campaign_status === "blocked";

  if (active) {
    if (work === "claimed") return { steps: [], heartbeat: true };
    return { steps: [{ status: "claimed", reconciled: stale }], heartbeat: false };
  }

  if (blocked) {
    const reason = (e.blocked_reason ?? "blocked").slice(0, 500);
    const block: EnvelopeStep = { status: "blocked", reconciled: false, blockedReason: reason, errorCode: safeCode(reason) };
    const rail = { outcome: "capability_refused" as const, detail: { reason, campaign_id: e.campaign_id } };
    if (work === "claimed") return { steps: [block], heartbeat: false, rail };
    if (work === "blocked") return { steps: [], heartbeat: false };
    return { steps: [{ status: "claimed", reconciled: stale }, block], heartbeat: false, rail };
  }

  const readback = { verified_readback: true, campaign_id: e.campaign_id, campaign_status: e.campaign_status, totals: e.totals };
  let final: EnvelopeStep;
  let rail: EnvelopePlan["rail"];
  if (e.version_state === "sent" && e.totals.sent > 0) {
    final = { status: "succeeded", reconciled: stale, terminalOutcome: readback, safeSummary: summarize(e.totals) };
    rail = { outcome: "capability_succeeded", detail: { campaign_id: e.campaign_id, ...e.totals } };
  } else if (e.version_state === "sent") {
    final = { status: "failed", reconciled: stale, terminalOutcome: readback, safeSummary: summarize(e.totals), errorCode: "nothing_sent" };
    rail = { outcome: "capability_failed", detail: { campaign_id: e.campaign_id, ...e.totals } };
  } else {
    final = { status: "cancelled", reconciled: stale, terminalOutcome: readback, safeSummary: summarize(e.totals) };
  }
  // blocked → succeeded is not a legal move; reopen the envelope first.
  if (work === "blocked" && final.status === "succeeded") {
    return { steps: [{ status: "claimed", reconciled: false }, { ...final, reconciled: false }], heartbeat: false, rail };
  }
  return { steps: [final], heartbeat: false, rail };
}

function safeCode(reason: string): string {
  const code = reason.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
  return code || "blocked";
}
