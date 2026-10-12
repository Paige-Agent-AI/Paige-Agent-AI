// #1140 two-mailbox pilot — the Gmail mailbox sync planner.
//
// Bounded, idempotent, never destructive: a fixed initial window, incremental
// history deltas, an explicit expired-history fallback to bounded re-reconcile,
// and message normalization into the ONE canonical messages insert shape
// (provider_message_id idempotency + thread_key derived locally, never taken
// from the provider). Pure: no Deno imports, no database, no clock, no network.

export const INITIAL_SYNC_WINDOW_DAYS = 14;
export const INITIAL_SYNC_MAX_MESSAGES = 200;
export const HISTORY_PAGE_MAX = 500;

export interface GmailMessageEnvelope {
  id: string;
  threadId: string;
  internalDate?: string; // epoch millis as string
  labelIds?: string[];
  snippet?: string;
  headers?: { name: string; value: string }[];
}

export interface GmailHistoryEvent {
  id?: number;
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
}

export interface NormalizedInboundInsert {
  tenant_id: string;
  connector_id: string;
  channel_type: "email";
  direction: "inbound" | "outbound";
  status: "received" | "sent";
  thread_key: string;
  provider_message_id: string;
  sender: { address: string; display_name: string | null };
  recipients: { address: string; display_name: string | null }[];
  subject: string | null;
  body_text: string | null;
  meta: Record<string, unknown>;
  sent_at: string | null;
}

/** The bounded initial-sync window (after = now - 14 days). */
export function planInitialSync(now: Date): { after: Date; maxMessages: number } {
  return { after: new Date(now.getTime() - INITIAL_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000), maxMessages: INITIAL_SYNC_MAX_MESSAGES };
}

const parseParty = (header: string | undefined): { address: string; display_name: string | null } | null => {
  if (!header) return null;
  const angle = header.match(/^(.*?)<([^>]+)>\s*$/);
  const address = (angle ? angle[2] : header).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  const display = (angle ? angle[1] : "").trim().replace(/^"|"$/g, "");
  return { address, display_name: display || null };
};

const headerOf = (message: GmailMessageEnvelope, name: string): string | undefined =>
  message.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;

/** Parse a List-Unsubscribe header into its https one-click + mailto targets. */
export function parseListUnsubscribe(header: string | undefined): { https: string | null; mailto: string | null } {
  if (!header) return { https: null, mailto: null };
  const parts = header.match(/<([^>]+)>/g)?.map((part) => part.slice(1, -1).trim()) ?? [];
  const https = parts.find((part) => /^https:\/\//i.test(part) && part.length <= 2048) ?? null;
  const mailto = parts.find((part) => /^mailto:/i.test(part) && part.length <= 320) ?? null;
  return { https, mailto: mailto ? mailto.replace(/^mailto:/i, "") : null };
}

/** thread_key is locally derived (connector + normalized counterparty), never
 *  the provider's thread id — the same aggregation key shape C-1 established. */
export function deriveThreadKey(connectorId: string, counterpartyAddress: string): string {
  return `email:${connectorId}:${counterpartyAddress.trim().toLowerCase()}`;
}

export function dedupeKey(providerMessageId: string): string {
  return providerMessageId;
}

/** Map one Gmail message to the canonical insert shape. Outbound (owner-sent)
 *  mail is recognized via the owner's own From header. */
export function normalizeGmailMessage(
  message: GmailMessageEnvelope,
  mailbox: { tenantId: string; connectorId: string; ownerAddress: string },
): NormalizedInboundInsert {
  const from = parseParty(headerOf(message, "From"));
  const to = parseParty(headerOf(message, "To")) ?? parseParty(headerOf(message, "Delivered-To"));
  const owner = mailbox.ownerAddress.toLowerCase();
  const outbound = from?.address === owner;
  const counterparty = outbound ? (to?.address ?? "unknown") : (from?.address ?? "unknown");
  const subject = headerOf(message, "Subject") ?? null;
  const unsubscribe = parseListUnsubscribe(headerOf(message, "List-Unsubscribe"));
  return {
    tenant_id: mailbox.tenantId,
    connector_id: mailbox.connectorId,
    channel_type: "email",
    direction: outbound ? "outbound" : "inbound",
    status: outbound ? "sent" : "received",
    thread_key: deriveThreadKey(mailbox.connectorId, counterparty),
    provider_message_id: dedupeKey(message.id),
    sender: from ?? { address: "unknown", display_name: null },
    recipients: to ? [to] : [],
    subject: subject ? subject.slice(0, 998) : null,
    body_text: message.snippet ?? null,
    meta: {
      gmail_thread_id: message.threadId,
      gmail_label_ids: message.labelIds ?? [],
      ...(unsubscribe.https || unsubscribe.mailto ? { list_unsubscribe: unsubscribe } : {}),
    },
    sent_at: message.internalDate && /^\d+$/.test(message.internalDate)
      ? new Date(Number(message.internalDate)).toISOString()
      : null,
  };
}

/** Fold history events into the two safe actions: fetch added ids, SOFT-mark
 *  removed ids. A removal never deletes the canonical row — it marks
 *  meta.gmail_removed_at so the inbox keeps its truthful history. */
export function classifyHistoryEvents(events: GmailHistoryEvent[]): { toFetch: string[]; toMarkRemoved: string[] } {
  const toFetch: string[] = [];
  const toMarkRemoved: string[] = [];
  for (const event of events) {
    for (const added of event.messagesAdded ?? []) {
      if (typeof added?.message?.id === "string" && added.message.id) toFetch.push(added.message.id);
    }
    for (const removed of event.messagesDeleted ?? []) {
      if (typeof removed?.message?.id === "string" && removed.message.id) toMarkRemoved.push(removed.message.id);
    }
  }
  return { toFetch: [...new Set(toFetch)].slice(0, HISTORY_PAGE_MAX), toMarkRemoved: [...new Set(toMarkRemoved)] };
}

/** Gmail expires history windows (~1 week): 404/410 means the engine must fall
 *  back to a bounded re-reconcile, not fail or full-sync unbounded. */
export function gmailHistoryIsExpired(status: number, body: unknown): boolean {
  if (status === 404 || status === 410) return true;
  if (status === 400) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? "";
    return /history/i.test(message) && /expired|invalid|not found/i.test(message);
  }
  return false;
}
