// Navigation consumer of the ORIGINAL mailbox reader and Messages row. No
// composer, write, approval, provider client or authority is created here.
import { parseCommsEmailDraftSource } from "../../../../supabase/functions/_shared/comms-email/draft-source";
import { parseNexusEmailDraft } from "../../../../supabase/functions/_shared/team-hub/nexus-email-contract";
import type { SavedEmailLocator } from "@/solo/team-hub/team-hub-email-links";
import type { MessageRow } from "./inbox-shared";
import { UUID } from "../../../../supabase/functions/_shared/comms-email/contract";
import { governedSendView, governedEmailReceiptLabel, GOVERNED_SEND_COPY, type GovernedSendFields } from "./governedSend";

type Bound = Extract<SavedEmailLocator, { kind: "bound" }>;
type Result = { data: unknown; error?: unknown };
const record = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

export function savedEmailRow(native: unknown, row: unknown, locator: Bound, tenantId: string): MessageRow | null {
  const n = record(native), m = record(row), saved = record(n?.saved_email_draft);
  if (!n || n.ok !== true || !saved || !m || m.tenant_id !== tenantId || n.id !== locator.messageId || m.id !== locator.messageId
    || n.contact_id !== locator.contactId || m.contact_id !== locator.contactId || n.thread_key !== m.thread_key
    || typeof m.thread_key !== "string" || !m.thread_key || n.direction !== "outbound" || m.direction !== "outbound"
    || n.channel !== "email" || m.channel_type !== "email" || n.status !== "draft" || m.status !== "draft"
    || typeof m.connector_id !== "string" || !m.connector_id || m.provider_message_id != null
    || m.subject !== n.subject || m.body_text !== saved.body_text || m.body_html !== saved.body_html) return null;
  try {
    const source = parseCommsEmailDraftSource(saved.source);
    if (source.message_id !== m.id || source.updated_at !== m.updated_at) return null;
  } catch { return null; }
  return m as unknown as MessageRow;
}

/** A saved original can become the SAME governed send. This is a read-only
 * result, never an editable source or authority for another dispatch. Both the
 * original mailbox reader and the caller-RLS envelope must agree. */
export function originalEmailResultRow(native: unknown, row: unknown, locator: Bound, tenantId: string): MessageRow | null {
  const n=record(native),m=record(row);
  if(!n||n.ok!==true||n.saved_email_draft!==null||!m||m.tenant_id!==tenantId||n.id!==locator.messageId||m.id!==locator.messageId
    ||n.contact_id!==locator.contactId||m.contact_id!==locator.contactId||n.thread_key!==m.thread_key
    ||typeof m.thread_key!=="string"||!m.thread_key||n.channel!=="email"||m.channel_type!=="email"
    ||n.direction!=="outbound"||m.direction!=="outbound"||n.status!==m.status||n.subject!==m.subject
    ||typeof m.connector_id!=="string"||!UUID.test(m.connector_id)
    ||typeof m.comms_email_operation!=="string"||!UUID.test(m.comms_email_operation)
    ||!['prepared','dispatching','provider_accepted','failed','refused','blocked','unknown'].includes(String(m.comms_email_state))
    ||!['draft','queued','sent','delivered','failed','read'].includes(String(m.status))
    ||typeof m.body_text!=="string"||n.body_text!==Array.from(m.body_text).slice(0,8000).join("")
    ||n.body_truncated!==(Array.from(m.body_text).length>8000))return null;
  return m as unknown as MessageRow;
}

export function originalEmailResultLabel(message: MessageRow & GovernedSendFields): string {
  const view=governedSendView(message);
  if(view&&view!=="settled")return view==="unconfirmed"?GOVERNED_SEND_COPY.unconfirmed.line:GOVERNED_SEND_COPY[view].pill;
  return governedEmailReceiptLabel(message)??(message.status==="failed"?"Failed":"Sending result recorded");
}

/** Every awaited read is fenced, including A→B→A and actor changes. A failed
 * mailbox/native result cannot fall back to a readable raw Messages row. */
export async function readLocatedSavedEmail(locator: Bound, tenantId: string, actorId: string, deps: {
  current: () => boolean;
  identity: () => Promise<boolean>;
  readContent: (id: string) => Promise<Result>;
  readRow: (id: string) => Promise<Result>;
  readHub: (id: string) => Promise<Result>;
}): Promise<MessageRow | null> {
  try {
    if (!deps.current() || !await deps.identity() || !deps.current()) return null;
    if (locator.hubMessageId) {
      const r = await deps.readHub(locator.hubMessageId);
      if (!deps.current() || r.error) return null;
      const hub = parseNexusEmailDraft(r.data, { tenantId, actorId, messageIds: [locator.hubMessageId] });
      if (!hub || hub.saved?.message_id !== locator.messageId || hub.contactId !== locator.contactId) return null;
    }
    const content = await deps.readContent(locator.messageId);
    if (!deps.current() || content.error || record(content.data)?.ok !== true) return null;
    const row = await deps.readRow(locator.messageId);
    if (!deps.current() || row.error) return null;
    // Recheck the ORIGINAL mailbox permission and complete source AFTER the
    // envelope read, so revocation or edits during navigation cannot be hidden.
    const fresh = await deps.readContent(locator.messageId);
    if (!deps.current() || fresh.error || !await deps.identity() || !deps.current()) return null;
    return savedEmailRow(fresh.data, row.data, locator, tenantId)
      ?? originalEmailResultRow(fresh.data, row.data, locator, tenantId);
  } catch { return null; }
}
