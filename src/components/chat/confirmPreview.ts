/**
 * INT-328 — the email preview a confirm card can show, and the ONE gate every path that hands the
 * card a preview goes through: the live `paige_confirm` frame and a turn reloaded from history.
 */

/**
 * The exact email an approval will send, as the server stored it. The summary is one
 * sentence ABOUT the email; this is the email itself, so the owner reads the body he is putting his
 * name to before he presses Approve. Server-authored from the stored call, never model prose.
 */
export type ConfirmEmailPreview = {
  kind: "email";
  to_name?: string;
  to_address: string;
  from_address: string;
  subject: string;
  /** Plain text. Rendered as text — markup in a draft is shown, never interpreted. */
  body_text: string;
  /** Server-read, fingerprinted rich source. Only the inert review projection may render it. */
  body_html?: string;
  /** "Approve now, send later": the instant (ISO, UTC) the approved email will go out. Absent = now. */
  send_at?: string;
  /** The files the approved email carries, as the server read and fingerprinted them. Absent = none. */
  attachments?: ConfirmEmailAttachment[];
};

/** One file on a confirm card: what the person needs to recognise it — never its path or contents. */
export type ConfirmEmailAttachment = { name: string; size: number; mime: string };

/**
 * A file's size the way a person says it: "820 bytes", "48 KB", "2.4 MB". Binary units (1 KB = 1024
 * bytes), the convention every operating system's file view uses. Never "0 KB" for a real file.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} ${Math.round(bytes) === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Number(mb.toFixed(1))} MB`;
}

/**
 * A scheduled email's send time in the viewer's own clock and words ("Wed, Oct 28, 9:00 AM"). One home for
 * the approval card and the Conversations inbox (governedSend re-exports it), so both say the same time.
 */
export function scheduledForLabel(sendAt: string, locale?: string): string {
  const at = new Date(sendAt);
  return Number.isFinite(at.getTime())
    // The zone is named so a daylight-saving change (CDT → CST) is visible, never silent.
    ? at.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "a set time";
}

/** The card's file list, or undefined when it is not a well-formed list of 1..10 named files. */
function parseConfirmAttachments(raw: unknown): ConfirmEmailAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) return undefined;
  const out: ConfirmEmailAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return undefined;
    const { name, size, mime } = a as Record<string, unknown>;
    if (!nonEmpty(name) || name.length > 120 || !nonEmpty(mime) || mime.length > 255
      || typeof size !== "number" || !Number.isInteger(size) || size < 1) return undefined;
    out.push({ name, size, mime });
  }
  return out;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The browser's gate on what the chat stream hands it. Only a complete email preview is shown;
 * anything partial, of another kind, or malformed renders no preview at all, and the card falls
 * back to the server's summary sentence. The chat server emits the shape without `kind`.
 */
export function parseConfirmPreview(raw: unknown): ConfirmEmailPreview | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== undefined && r.kind !== "email") return undefined;
  if (!nonEmpty(r.to_address) || !nonEmpty(r.from_address) || !nonEmpty(r.subject) || !nonEmpty(r.body_text)) return undefined;
  // A declared malformed rich body must not quietly become a plain-text approval.
  if (r.body_html !== undefined && (!nonEmpty(r.body_html) || r.body_html.length > 1_000_000)) return undefined;
  // A time that is present but unreadable fails closed: an email shown as "sends now" that is really
  // scheduled is worse than no preview (the card falls back to the server's sentence, which names the time).
  const sendAtOk = typeof r.send_at === "string" && r.send_at.length <= 40 && Number.isFinite(Date.parse(r.send_at));
  if (r.send_at !== undefined && !sendAtOk) return undefined;
  return {
    kind: "email",
    ...(nonEmpty(r.to_name) ? { to_name: r.to_name } : {}),
    to_address: r.to_address,
    from_address: r.from_address,
    subject: r.subject,
    body_text: r.body_text,
    ...(typeof r.body_html === "string" ? { body_html: r.body_html } : {}),
    ...(sendAtOk ? { send_at: r.send_at as string } : {}),
    // Only a well-formed file list passes; anything else is dropped (the summary still names the files).
    ...(parseConfirmAttachments(r.attachments) ? { attachments: parseConfirmAttachments(r.attachments) } : {}),
  };
}

/** A confirm item as the chat keeps it. */
export type ConfirmItem = {
  tool: string;
  summary: string;
  fingerprint?: string;
  expires_at?: string | null;
  command?: Record<string, unknown>;
  idempotency_key?: string;
  preview?: ConfirmEmailPreview;
};

/** Display retirement only. The original server claim always owns authority.
 * Absence preserves legacy frames; declared but unverifiable metadata cannot
 * become a fresh decision. A batch keeps its earliest original deadline. */
export function confirmationDeadline(items: readonly { expires_at?: unknown }[] | undefined): number | undefined {
  const declared = items?.filter(item => Object.prototype.hasOwnProperty.call(item, "expires_at")) ?? [];
  if (!declared.length) return undefined;
  const times = declared.map(item => typeof item.expires_at === "string" ? Date.parse(item.expires_at) : NaN);
  return times.every(Number.isFinite) ? Math.min(...times) : 0;
}

/** The preview a frame or stored item carries — under `preview` or the server's `confirm_preview`. */
export function previewOf(frame: Record<string, unknown>): { preview?: ConfirmEmailPreview } {
  const preview = parseConfirmPreview(frame.preview ?? frame.confirm_preview);
  return preview ? { preview } : {};
}

/**
 * `bundle_ref.paige_confirm` from a saved turn. Stored data is never trusted to be well-formed: a
 * non-object item is dropped and the preview passes the same gate as the live frame, so a malformed
 * one becomes "no preview" instead of reaching the card raw.
 */
export function rehydrateConfirmItems(raw: unknown): ConfirmItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && !Array.isArray(c))
    .map((c) => {
      const { preview: _stored, confirm_preview: _storedAlias, ...rest } = c;
      return { ...rest, ...previewOf(c) } as ConfirmItem;
    });
}
