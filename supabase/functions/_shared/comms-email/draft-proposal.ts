// Server-only source projection for the ORIGINAL governed email door. Call only
// after that door authenticates its actor, current workspace and original seat.
import { commsEmailBodyHtml, parseCommsEmailAttachmentRequest, UUID, type CommsEmailCommand } from "./contract.ts";
import { parseCommsEmailDraftSource, type CommsEmailDraftSource } from "./draft-source.ts";
import { readableMessageBody } from "./message-reading.ts";
import { decideContentRead } from "../inbox-intelligence/policy.ts";
import type { CommsEmailAdmin } from "./readiness.ts";

type Row = Record<string, unknown>;
const row = (v: unknown): Row | null => v && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
type Refusal = "COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE" | "COMMS_EMAIL_DRAFT_SOURCE_CHANGED" | "COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED" | "COMMS_EMAIL_ATTACHMENTS_INVALID";
export type DraftProposal = { ok: true; source: CommsEmailDraftSource; connectorId: string; bodyHtml: string; attachmentPaths: string[] | null }
  | { ok: false; code: Refusal };

export async function readCommsEmailDraftProposal(admin: CommsEmailAdmin, input: {
  tenantId: string; actorUserId: string; source: CommsEmailDraftSource; command: CommsEmailCommand;
  /** The original authenticated caller client: existing message RLS gates content. */
  contentReader: CommsEmailAdmin;
  /** Absent retains the original files. Explicit [] removes them in this approval. */
  attachments?: unknown;
  /** Server-only result of the original approval reader, never deserialized wire data. */
  originalApproval?: { tenantId: string; approvalId: string; contactId: string; actionId: string };
}): Promise<DraftProposal> {
  const unavailable = (): DraftProposal => ({ ok: false, code: "COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE" });
  let source: CommsEmailDraftSource;
  try { source = parseCommsEmailDraftSource(input.source); } catch { return unavailable(); }
  try {
    const { data, error } = await admin.from("messages")
      .select("id,tenant_id,contact_id,connector_id,channel_type,direction,status,updated_at,meta,action_id,provider_message_id")
      .eq("tenant_id", input.tenantId).eq("id", source.message_id).maybeSingle();
    const message = row(data);
    if (error || !message || message.id !== source.message_id || message.tenant_id !== input.tenantId
      || message.contact_id !== input.command.contact_id || message.channel_type !== "email"
      || message.direction !== "outbound" || message.status !== "draft" || message.provider_message_id
      || typeof message.connector_id !== "string") return unavailable();
    const meta = message.meta == null ? {} : row(message.meta);
    if (!meta || ["comms_email_binding", "sales_invoice_binding", "growth_sequence_binding", "email_campaign_binding"]
      .some(key => Object.prototype.hasOwnProperty.call(meta, key))) return { ok: false, code: "COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED" };
    const original = input.originalApproval;
    if (message.action_id != null || original !== undefined) {
      if (!original || original.tenantId !== input.tenantId || original.contactId !== input.command.contact_id
        || !UUID.test(original.approvalId) || !UUID.test(original.actionId) || message.action_id !== original.actionId) {
        return { ok: false, code: "COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED" };
      }
    }
    // Privacy is checked before content/version is returned or fingerprinted. Neither
    // tenant membership nor picking another From grants access to a personal source.
    const connectorRead = await admin.from("channel_connectors")
      .select("id,tenant_id,channel_type,mailbox_class,mailbox_owner_user_id,active,status,mailbox_scopes")
      .eq("tenant_id", input.tenantId).eq("id", message.connector_id).maybeSingle();
    const connector = row(connectorRead.data);
    if (connectorRead.error || !connector || connector.id !== message.connector_id || connector.channel_type !== "email") return unavailable();
    const access = decideContentRead({ callerUserId: input.actorUserId, callerTenantId: input.tenantId,
      mailboxTenantId: String(connector.tenant_id ?? ""), mailbox: { mailbox_class: connector.mailbox_class,
        mailbox_owner_user_id: connector.mailbox_owner_user_id, active: connector.active, status: connector.status, mailbox_scopes: connector.mailbox_scopes } });
    if (!access.allowed) return unavailable();
    const connectorId = input.command.connector_id ?? message.connector_id;
    if (access.mailboxClass === "personal" && connectorId !== message.connector_id) return { ok: false, code: "COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED" };
    if (message.updated_at !== source.updated_at) return { ok: false, code: "COMMS_EMAIL_DRAFT_SOURCE_CHANGED" };
    // No private body is fetched with the service client. Existing authenticated
    // message RLS and these same-snapshot filters control the content read too.
    const contentRead = await input.contentReader.from("messages")
      .select("id,tenant_id,contact_id,connector_id,updated_at,body_text,body_html,attachments")
      .eq("tenant_id", input.tenantId).eq("id", source.message_id).eq("connector_id", message.connector_id)
      .eq("contact_id", input.command.contact_id).eq("updated_at", source.updated_at)
      .eq("channel_type", "email").eq("direction", "outbound").eq("status", "draft").maybeSingle();
    const content = row(contentRead.data);
    if (contentRead.error || !content || content.id !== source.message_id || content.tenant_id !== input.tenantId
      || content.contact_id !== input.command.contact_id || content.connector_id !== message.connector_id || content.updated_at !== source.updated_at) return unavailable();
    const text = typeof content.body_text === "string" && content.body_text.trim() ? content.body_text : readableMessageBody({ body_html: typeof content.body_html === "string" ? content.body_html : null });
    // Only the server-read unchanged draft contributes rich HTML. Edited plain text
    // uses the incumbent encoder; the wire never supplies HTML or governance.
    const html = input.command.body === text && typeof content.body_html === "string" && content.body_html
      ? content.body_html : commsEmailBodyHtml(input.command.body);
    if (!html || html.length > 100000 || html.includes("\0")) return unavailable();
    let requested = input.attachments;
    if (requested === undefined) {
      if (content.attachments !== null && content.attachments !== undefined && !Array.isArray(content.attachments)) return { ok: false, code: "COMMS_EMAIL_ATTACHMENTS_INVALID" };
      requested = (content.attachments as unknown[] | null | undefined ?? []).map(file => ({ path: row(file)?.url }));
    }
    let attachmentPaths: string[] | null;
    try { attachmentPaths = Array.isArray(requested) && requested.length === 0 ? null : parseCommsEmailAttachmentRequest(requested, input.tenantId); }
    catch { return { ok: false, code: "COMMS_EMAIL_ATTACHMENTS_INVALID" }; }
    return { ok: true, source, connectorId, bodyHtml: html, attachmentPaths };
  } catch { return unavailable(); }
}
