import { useTenantContext } from "@/hooks/useTenantContext";
import { BoundStudioSourceHandoff } from "./TeamHubStudioHandoff";
import { readChatStudioReference, startChatStudio } from "./studio-data";
import { STUDIO_SESSION_ID, type ChatStudioReference } from "./studio-reference";

/** Conversation metadata is only a pointer. The protected supplemental reader
 * derives the actual original source and current caller's permitted project. */
export function ChatStudioHandoff({ reference }: { reference: ChatStudioReference }) {
  const account = useTenantContext();
  if (account.accountContextLoading || account.accountContextStatus !== "ready" || !account.activeUserId
    || account.activeTenantId !== reference.tenantId || account.activeTenant?.id !== reference.tenantId
    || !STUDIO_SESSION_ID.test(reference.sourceTurnId)) return null;
  return <BoundStudioSourceHandoff key={`${account.activeUserId}:${reference.tenantId}:${reference.sourceTurnId}`}
    messageId={reference.sourceTurnId} expectedTenant={reference.tenantId} actorId={account.activeUserId} agentKey="paige"
    tenantSlug={account.activeTenant.slug} readReference={readChatStudioReference} startReference={startChatStudio} />;
}
