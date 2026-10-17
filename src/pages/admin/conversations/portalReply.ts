// Portal channel (E09) — the business side of the customer <-> business thread that lives in the
// client portal. Portal rows sit in the SAME per-contact thread as email/SMS (public.messages,
// channel_type 'portal'), so the inbox already reads them; this file is the ONE home for how the
// inbox recognises them and how a business admin replies.
//
// A reply goes through comms_portal_reply ONLY — never send-message, never a provider, never the
// governed email path. The server writes a 'delivered' portal row plus an in-app notice for the
// customer. Being in the portal is not proof the customer read it, so nothing here claims "read".
import { supabase } from "@/integrations/supabase/client";
import type { MessageRow } from "./inbox-shared";

/** The composer identity id for the portal — not a channel_connectors row (portal has no connector). */
export const PORTAL_IDENTITY_ID = "portal";
/** comms_portal_reply accepts 1..4000 characters after trimming (Postgres length() — code points). */
export const PORTAL_BODY_MAX = 4000;
/** Subject the server stamps on a customer help request (client_portal_send_message kind 'help'). */
export const PORTAL_HELP_SUBJECT = "Help request";

export const isPortalMessage = (m: Pick<MessageRow, "channel_type">): boolean => m.channel_type === "portal";

/** A customer's "Contact your team" request — inbound portal row the server titled "Help request". */
export const isPortalHelpRequest = (m: Pick<MessageRow, "channel_type" | "direction" | "subject">): boolean =>
  m.channel_type === "portal" && m.direction === "inbound" && m.subject === PORTAL_HELP_SUBJECT;

/** Who wrote an inbound portal message. Portal senders carry a name, never an address. */
export const portalSenderName = (m: Pick<MessageRow, "sender">): string => m.sender?.name?.trim() || "Client";

/**
 * Characters as the server counts them. Postgres length() counts Unicode code points, while a JS
 * string's .length counts UTF-16 units — an emoji is 1 to the server and 2 to .length — so the
 * client counts code points too, or it would refuse messages the server accepts.
 */
export const portalBodyLength = (body: string): number => Array.from(body.trim()).length;

/** Client-side mirror of the server's body rule; null when the body is sendable. */
export function portalBodyError(body: string): string | null {
  if (!body.trim()) return "Write a message first.";
  const length = portalBodyLength(body);
  if (length > PORTAL_BODY_MAX) {
    return `Portal messages can be up to 4,000 characters — this one is ${length.toLocaleString()}.`;
  }
  return null;
}

export type PortalReplyErrorCode =
  | "REQUEST_ID_REQUIRED"
  | "INVALID_BODY"
  | "CONTACT_NOT_FOUND"
  | "PORTAL_NOT_CONNECTED"
  | "REQUEST_ID_CONFLICT"
  /** The business workspace isn't active, so its portal can't take messages. */
  | "WORKSPACE_INACTIVE"
  /** 42501 — not a business admin of the current workspace. */
  | "NOT_AUTHORIZED"
  /** The call failed or the answer was unreadable; nothing is known about whether it was written. */
  | "UNCONFIRMED";

const SERVER_CODES: ReadonlySet<string> = new Set([
  "REQUEST_ID_REQUIRED", "INVALID_BODY", "CONTACT_NOT_FOUND", "PORTAL_NOT_CONNECTED", "REQUEST_ID_CONFLICT",
  "WORKSPACE_INACTIVE",
]);

export type PortalReplyResult =
  | { ok: true; replayed: boolean; messageId: string; createdAt: string | null }
  | { ok: false; code: PortalReplyErrorCode };

/** Plain, honest copy for every outcome the RPC can return. */
export function portalReplyErrorCopy(code: PortalReplyErrorCode, name: string): string {
  const who = name.trim() && name !== "Unknown contact" ? name.trim() : "This client";
  switch (code) {
    case "PORTAL_NOT_CONNECTED":
      return `${who} hasn't joined your client portal yet, so there's nowhere to post this. Invite them from their contact card, or reply by email or SMS.`;
    case "CONTACT_NOT_FOUND":
      return `${who} isn't an active client in this workspace, so the portal message wasn't sent.`;
    case "INVALID_BODY":
      return "Portal messages need between 1 and 4,000 characters.";
    case "WORKSPACE_INACTIVE":
      return "This business workspace isn't active, so its client portal can't receive messages. Nothing was posted — reactivate the workspace, or reply by email or SMS.";
    case "REQUEST_ID_CONFLICT":
      return "That send clashed with an earlier one and wasn't posted. Send it again.";
    case "NOT_AUTHORIZED":
      return "Only admins of this business can reply in the client portal.";
    case "REQUEST_ID_REQUIRED":
      return "Couldn't send that — refresh the page and try again.";
    case "UNCONFIRMED":
    default:
      return "Couldn't confirm the portal message was posted. Your text is still here — send again and it won't post twice.";
  }
}

/**
 * One request id per message, reused on retry. The scope is tenant + contact + the trimmed body —
 * exactly what the server compares on replay — so retrying the same text reuses the id (an
 * idempotent replay, never a duplicate) and editing the text starts a new message.
 */
export function createPortalRequestIds(newId: () => string = () => crypto.randomUUID()) {
  let pending: { scope: string; id: string } | null = null;
  return {
    idFor(scope: string): string {
      if (!pending || pending.scope !== scope) pending = { scope, id: newId() };
      return pending.id;
    },
    /** The message was posted (or the id is spent) — the next send gets a fresh id. */
    settle(scope: string) {
      if (pending?.scope === scope) pending = null;
    },
    clear() {
      pending = null;
    },
  };
}

export const portalRequestScope = (tenantId: string, contactId: string, body: string) =>
  `${tenantId}|${contactId}|${body.trim()}`;

/** Business-admin reply over the portal channel. No provider is contacted. */
export async function sendPortalReply(args: {
  tenantId: string;
  contactId: string;
  body: string;
  requestId: string;
}): Promise<PortalReplyResult> {
  // RPC is defined in migration 20271110010000 and is not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("comms_portal_reply", {
    p_tenant_id: args.tenantId,
    p_contact_id: args.contactId,
    p_body: args.body,
    p_request_id: args.requestId,
  });
  if (error) {
    return { ok: false, code: (error as { code?: string }).code === "42501" ? "NOT_AUTHORIZED" : "UNCONFIRMED" };
  }
  const res = (data ?? null) as { ok?: boolean; replayed?: boolean; message_id?: string; created_at?: string; error?: string } | null;
  if (res?.ok === true && typeof res.message_id === "string") {
    return { ok: true, replayed: res.replayed === true, messageId: res.message_id, createdAt: res.created_at ?? null };
  }
  if (res?.ok === false && typeof res.error === "string" && SERVER_CODES.has(res.error)) {
    return { ok: false, code: res.error as PortalReplyErrorCode };
  }
  return { ok: false, code: "UNCONFIRMED" };
}
