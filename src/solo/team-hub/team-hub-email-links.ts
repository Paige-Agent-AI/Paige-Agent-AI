import { workspaceLinkTarget, type WorkspaceLinkTenant } from "@/lib/links/workspaceLinks";
import { UUID } from "../../../supabase/functions/_shared/comms-email/contract";
import type { NexusEmailDraft, NexusEmailSavedReference } from "../../../supabase/functions/_shared/team-hub/nexus-email-contract";

export function nexusEmailDraftHref(draft: NexusEmailDraft, saved: NexusEmailSavedReference, account: WorkspaceLinkTenant | null | undefined): string | null {
  const target = workspaceLinkTarget({ destination: "conversations", record_id: null }, account);
  if (!target || !draft.contactId || !UUID.test(draft.contactId) || !UUID.test(saved.message_id) || !UUID.test(draft.messageId)) return null;
  const [path, search = ""] = target.to.split("?");
  const params = new URLSearchParams(search);
  params.set("contact", draft.contactId); params.set("email_draft", saved.message_id); params.set("hub_message", draft.messageId);
  return `${path}?${params}`;
}

export type SavedEmailLocator = { kind: "none" } | { kind: "invalid" }
  | { kind: "bound"; contactId: string; messageId: string; hubMessageId: string | null };
/** Navigation only; the destination must independently read the ORIGINAL draft,
 * current actor/workspace/mailbox and optional original Hub receipt reference. */
export function parseSavedEmailLocator(search: URLSearchParams): SavedEmailLocator {
  if (!search.has("email_draft") && !search.has("hub_message")) return { kind: "none" };
  const contacts = search.getAll("contact"), drafts = search.getAll("email_draft"), hubs = search.getAll("hub_message");
  if (contacts.length !== 1 || drafts.length !== 1 || hubs.length > 1 || !UUID.test(contacts[0]) || !UUID.test(drafts[0])
    || hubs.length === 1 && !UUID.test(hubs[0]) || search.has("approval") || search.has("compose")) return { kind: "invalid" };
  return { kind: "bound", contactId: contacts[0].toLowerCase(), messageId: drafts[0].toLowerCase(), hubMessageId: hubs[0]?.toLowerCase() ?? null };
}
