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
};

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
  return {
    kind: "email",
    ...(nonEmpty(r.to_name) ? { to_name: r.to_name } : {}),
    to_address: r.to_address,
    from_address: r.from_address,
    subject: r.subject,
    body_text: r.body_text,
  };
}

/** A confirm item as the chat keeps it. */
export type ConfirmItem = {
  tool: string;
  summary: string;
  fingerprint?: string;
  command?: Record<string, unknown>;
  idempotency_key?: string;
  preview?: ConfirmEmailPreview;
};

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
