// #1140 two-mailbox pilot — the mailbox organize command contract.
//
// Reversible message organization over the canonical mirror + the provider:
// label/unlabel, archive/unarchive, trash/untrash, and unsubscribe proposals.
// There is NO delete kind — the union cannot express a permanent deletion, and
// the Gmail scope the door requires (gmail.modify) excludes exactly that.
// Pure: no Deno imports, no database, no clock, no network.

export const COMMS_MAILBOX_ORGANIZE_TOOL = "gmail_organize" as const;
export const COMMS_MAILBOX_ORGANIZE_ACTION = "comms.gmail_organize" as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LABEL_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

const KINDS = ["label", "unlabel", "archive", "unarchive", "trash", "untrash", "unsubscribe_propose", "unsubscribe_send"] as const;
export type OrganizeKind = (typeof KINDS)[number];

export type OrganizeCommand =
  | { kind: "label"; message_id: string; label: string }
  | { kind: "unlabel"; message_id: string; label: string }
  | { kind: "archive"; message_id: string }
  | { kind: "unarchive"; message_id: string }
  | { kind: "trash"; message_id: string }
  | { kind: "untrash"; message_id: string }
  | { kind: "unsubscribe_propose"; message_id: string }
  | { kind: "unsubscribe_send"; message_id: string };

/** Strict parse of the closed union. Unknown kinds, extra keys, malformed ids
 *  and bad label slugs refuse — no request-authored governance can ride in. */
export function parseOrganizeCommand(value: unknown): OrganizeCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("MAILBOX_COMMAND_INVALID");
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== "string" || !(KINDS as readonly string[]).includes(raw.kind)) throw new TypeError("MAILBOX_COMMAND_INVALID");
  const kind = raw.kind as OrganizeKind;
  if (typeof raw.message_id !== "string" || !UUID.test(raw.message_id)) throw new TypeError("MAILBOX_COMMAND_INVALID");
  const messageId = raw.message_id.toLowerCase();
  if (kind === "label" || kind === "unlabel") {
    if (typeof raw.label !== "string" || !LABEL_SLUG.test(raw.label)) throw new TypeError("MAILBOX_COMMAND_INVALID");
    if (Object.keys(raw).length !== 3) throw new TypeError("MAILBOX_COMMAND_INVALID");
    return { kind, message_id: messageId, label: raw.label };
  }
  if (Object.keys(raw).length !== 2) throw new TypeError("MAILBOX_COMMAND_INVALID");
  return { kind, message_id: messageId };
}

/**
 * Owner addendum 6088460092 — TRUTHFUL reversibility. The mailbox-state kinds
 * each have an exact inverse. The unsubscribe kinds do NOT: a delivered one-click
 * request has no valid inverse (re-subscribing is the person's own act, not an
 * undo), and "undoing" a proposal must never send anything.
 */
export function organizeIsReversible(kind: OrganizeKind): boolean {
  return kind !== "unsubscribe_propose" && kind !== "unsubscribe_send";
}

export function undoKindFor(kind: OrganizeKind): "unlabel" | "label" | "unarchive" | "archive" | "untrash" | "trash" | null {
  switch (kind) {
    case "archive": return "unarchive";
    case "unarchive": return "archive";
    case "trash": return "untrash";
    case "untrash": return "trash";
    case "label": return "unlabel";
    case "unlabel": return "label";
    case "unsubscribe_propose": return null;
    case "unsubscribe_send": return null;
  }
}

/** Every provider-side organization write goes through the canonical approval —
 *  including undo: the door re-proves the mailbox policy on every command. */
export function organizeRequiresApproval(_kind: OrganizeKind): boolean {
  return true;
}

/**
 * The unsubscribe one-click target: https only (RFC 8058), no userinfo, host
 * required, bounded length. The mailto target is recorded but never executed
 * by the door (surfaced honestly as needing the owner's own mail client).
 */
export const UNSUBSCRIBE_HTTPS_RE = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[^\s@]*)?$/i;

export function unsubscribeHttpsTarget(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.length > 2048 || !UNSUBSCRIBE_HTTPS_RE.test(url) || url.includes("@")) return null;
  // No loopback, literal private, or link-local hosts: the door runs on shared edge
  // infrastructure and the one-click POST is a server-side request.
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  // Numeric-only hosts (decimal/hex IPv4 shorthands like 2130706433) are rejected:
  // a host that is all digits and dots is an address literal, not a name.
  if (/^[0-9.]+$/.test(host)) return null;
  if (/^(?:127.|10.|192.168.|169.254.|0.)/.test(host)) return null;
  if (/^172.(?:1[6-9]|2[0-9]|3[01])./.test(host)) return null;
  return url;
}
