// Closed transport projections only. A preparation/reference is never permission
// to save, read a mailbox, send or claim delivery. Native domain doors decide.
import { COMMS_EMAIL_BODY_MAX, COMMS_EMAIL_SUBJECT_MAX, EMAIL_ADDRESS, UUID } from "../comms-email/contract.ts";
import { parseCommsEmailDraftSource, type CommsEmailDraftSource } from "../comms-email/draft-source.ts";

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown): string | null => typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null;
const hasOwn = (v: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(v, key);
const closed = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every(k => keys.includes(k));

export type NexusEmailPreparation = Readonly<{ subject: string; body: string }>;
export function parseNexusEmailPreparation(value: unknown): NexusEmailPreparation | null {
  const v = object(value);
  if (!v || !closed(v, ["subject", "body"]) || typeof v.subject !== "string" || !v.subject.trim()
    || v.subject.length > COMMS_EMAIL_SUBJECT_MAX || /[\r\n\0]/.test(v.subject)
    || typeof v.body !== "string" || !v.body.trim() || v.body.length > COMMS_EMAIL_BODY_MAX || v.body.includes("\0")) return null;
  return Object.freeze({ subject: v.subject, body: v.body });
}

export type NexusEmailSavedReference = Readonly<CommsEmailDraftSource & { receipt_id: string; operation_id: string }>;
export function parseNexusEmailSavedReference(value: unknown): NexusEmailSavedReference | null {
  try {
    const v = object(value);
    if (!v || !closed(v, ["message_id", "updated_at", "receipt_id", "operation_id"])) return null;
    const source = parseCommsEmailDraftSource({ message_id: v.message_id, updated_at: v.updated_at });
    const receipt = uuid(v.receipt_id), operation = uuid(v.operation_id);
    return receipt && operation ? Object.freeze({ ...source, receipt_id: receipt, operation_id: operation }) : null;
  } catch { return null; }
}

export type NexusEmailDraft = Readonly<{
  tenantId: string; actorId: string; turnId: string; conversationId: string; sourceMessageId: string; messageId: string;
  preparation: NexusEmailPreparation; contactId: string | null; connectorId: string | null; saved: NexusEmailSavedReference | null;
}>;
export type NexusEmailDraftExpected = Readonly<{ tenantId: string; actorId: string; messageIds: readonly string[]; conversationId?: string }>;
export function parseNexusEmailDraft(value: unknown, expected: NexusEmailDraftExpected): NexusEmailDraft | null {
  const v = object(value), d = object(v?.draft);
  if (!v || v.ok !== true || !d || !closed(v, ["ok", "tenant_id", "actor_id", "turn_id", "conversation_id", "source_message_id", "message_id", "draft"])
    || !closed(d, ["subject", "body", "contact_id", "connector_id", "result"])) return null;
  const tenantId = uuid(v.tenant_id), actorId = uuid(v.actor_id), turnId = uuid(v.turn_id);
  const conversationId = uuid(v.conversation_id), sourceMessageId = uuid(v.source_message_id), messageId = uuid(v.message_id);
  const preparation = parseNexusEmailPreparation({ subject: d.subject, body: d.body });
  const contactId = hasOwn(d, "contact_id") ? uuid(d.contact_id) : null;
  const connectorId = hasOwn(d, "connector_id") ? uuid(d.connector_id) : null;
  const saved = hasOwn(d, "result") ? parseNexusEmailSavedReference(d.result) : null;
  if (!tenantId || tenantId !== expected.tenantId || !actorId || actorId !== expected.actorId || !turnId || !conversationId
    || expected.conversationId !== undefined && conversationId !== expected.conversationId
    || !sourceMessageId || !messageId || !expected.messageIds.includes(messageId) || !preparation
    || hasOwn(d, "contact_id") && (!contactId || !connectorId)
    || hasOwn(d, "connector_id") && (!connectorId || !contactId)
    || hasOwn(d, "result") && (!saved || !contactId || !connectorId)) return null;
  return Object.freeze({ tenantId, actorId, turnId, conversationId, sourceMessageId, messageId, preparation, contactId, connectorId, saved });
}

export function parseNexusEmailDraftBatch(value: unknown, expected: NexusEmailDraftExpected): readonly NexusEmailDraft[] | null {
  const v = object(value);
  if (!v || v.ok !== true || !closed(v, ["ok", "drafts"]) || !Array.isArray(v.drafts) || v.drafts.length > 50) return null;
  const out: NexusEmailDraft[] = [], seen = new Set<string>();
  for (const raw of v.drafts) {
    const draft = parseNexusEmailDraft(raw, expected);
    if (!draft || seen.has(draft.messageId)) return null;
    seen.add(draft.messageId); out.push(draft);
  }
  return Object.freeze(out);
}

export const NEXUS_EMAIL_DRAFT_REQUEST = "teamHubEmailDraft";
export type NexusEmailDraftRequest = Readonly<{ messageId: string; intent: "save" | "check" | "inspect"; contactId?: string; connectorId?: string }>;
export function isNexusEmailDraftRequest(value: unknown): boolean {
  const v = object(value); return !!v && hasOwn(v, NEXUS_EMAIL_DRAFT_REQUEST);
}
export function parseNexusEmailDraftRequest(value: unknown): NexusEmailDraftRequest | null {
  const v = object(value), r = object(v?.[NEXUS_EMAIL_DRAFT_REQUEST]);
  if (!v || !closed(v, [NEXUS_EMAIL_DRAFT_REQUEST]) || !r || !closed(r, ["messageId", "intent", "contactId", "connectorId"])) return null;
  const messageId = uuid(r.messageId), contactId = uuid(r.contactId), connectorId = uuid(r.connectorId);
  if (!messageId || !["save", "check", "inspect"].includes(String(r.intent)) || r.intent === "save" && (!contactId || !connectorId)
    || r.intent !== "save" && (hasOwn(r, "contactId") || hasOwn(r, "connectorId"))) return null;
  return Object.freeze({ messageId, intent: r.intent as "save" | "check" | "inspect", ...(contactId ? { contactId, connectorId: connectorId! } : {}) });
}

export type NexusEmailDraftAnswer = Readonly<{
  ok: boolean;
  outcome: "available" | "saved" | "unknown" | "refused" | "unavailable";
  message_id?: string;
  result?: NexusEmailSavedReference;
  senders?: ReadonlyArray<{ connector_id: string; from_address: string }>;
}>;
export function parseNexusEmailDraftAnswer(value: unknown, messageId: string): NexusEmailDraftAnswer | null {
  const v = object(value);
  if (!v || !closed(v, ["ok", "outcome", "message_id", "result", "senders"]) || typeof v.ok !== "boolean"
    || !["available", "saved", "unknown", "refused", "unavailable"].includes(String(v.outcome))) return null;
  if (hasOwn(v, "message_id") && uuid(v.message_id) !== messageId) return null;
  if (v.outcome === "saved") {
    const ref = parseNexusEmailSavedReference(v.result);
    return v.ok === true && uuid(v.message_id) === messageId && ref && !hasOwn(v, "senders")
      ? Object.freeze({ ok: true, outcome: "saved", message_id: messageId, result: ref }) : null;
  }
  if (v.outcome === "available") {
    if (v.ok !== true || uuid(v.message_id) !== messageId || !Array.isArray(v.senders) || v.senders.length > 1000
      || hasOwn(v, "result")) return null;
    const senders: Array<{ connector_id: string; from_address: string }> = [], seen = new Set<string>();
    for (const item of v.senders) {
      const sender = object(item), id = uuid(sender?.connector_id);
      if (!sender || !closed(sender, ["connector_id", "from_address"]) || !id || seen.has(id)
        || typeof sender.from_address !== "string" || sender.from_address.length > 320 || !EMAIL_ADDRESS.test(sender.from_address)) return null;
      seen.add(id); senders.push({ connector_id: id, from_address: sender.from_address });
    }
    return Object.freeze({ ok: true, outcome: "available", message_id: messageId, senders: Object.freeze(senders) });
  }
  if (v.ok !== false || hasOwn(v, "result") || hasOwn(v, "senders")) return null;
  return Object.freeze({ ok: false, outcome: v.outcome as "unknown" | "refused" | "unavailable",
    ...(v.message_id ? { message_id: messageId } : {}) });
}
