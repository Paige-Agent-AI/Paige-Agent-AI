// Navigation consumer of the ORIGINAL mailbox reader and Messages row. No
// composer, write, approval, provider client or authority is created here.
import { parseCommsEmailDraftSource } from "../../../../supabase/functions/_shared/comms-email/draft-source";
import { parseNexusEmailDraft } from "../../../../supabase/functions/_shared/team-hub/nexus-email-contract";
import type { SavedEmailLocator } from "@/solo/team-hub/team-hub-email-links";
import type { MessageRow } from "./inbox-shared";

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
    return savedEmailRow(fresh.data, row.data, locator, tenantId);
  } catch { return null; }
}
