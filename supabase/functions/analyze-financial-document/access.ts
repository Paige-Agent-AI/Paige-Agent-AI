// Who may analyze a `documents` row (EXP08 stage 0, owner ruling 2026-10-26).
//
// This function downloads with the SERVICE ROLE, so this decision is the whole access control.
// It used to admit "the row's owner, or anyone holding the GLOBAL `admin` role" — and that row is
// written for an owner/admin seat in ANY workspace, so every workspace owner could analyze every
// person's financial document on the platform. Admin power now stops at the admin's own workspace:
//
//   1. the document's owner (doc.user_id === caller) — the only path today's UI uses
//      (FinancialDocsSection / BusinessDocumentsManager analyze the file the person just uploaded);
//   2. an owner/admin of the document's OWN client workspace, or the agency managing it — the
//      workspace is the tenant of `documents.client_id`, and only when that client record is linked
//      to the document's owner (`clients.linked_user_id = doc.user_id`). `client_id` is writable by
//      the row owner, so the link is what stops it from being pointed at someone else's client;
//   3. the Platform Operator (§53, is_platform_operator — super_admin OR platform_admin).
//
// Pure decision over injected reads so every branch is testable without a database. A read that
// fails THROWS (the handler turns it into a 500): an infrastructure error is never a grant.

export interface DocumentRef {
  user_id: string;
  client_id?: string | null;
}

export interface DocumentAccessDeps {
  /** is_platform_operator() for the verified caller. */
  isOperator: () => Promise<boolean>;
  /** The tenant of client `clientId` ONLY when that client is linked to `ownerUserId`; else null. */
  linkedClientTenant: (clientId: string, ownerUserId: string) => Promise<string | null>;
  /** Owner/admin seat of the caller in `tenantId`, or the agency managing it. */
  isWorkspaceAdmin: (tenantId: string) => Promise<boolean>;
}

export type DocumentAccess =
  | { allowed: true; via: "owner" | "workspace_admin" | "operator" }
  | { allowed: false };

export async function decideDocumentAnalysisAccess(
  callerId: string,
  doc: DocumentRef,
  deps: DocumentAccessDeps,
): Promise<DocumentAccess> {
  if (!callerId) return { allowed: false };
  if (doc.user_id && doc.user_id === callerId) return { allowed: true, via: "owner" };
  if (doc.client_id && doc.user_id) {
    const tenantId = await deps.linkedClientTenant(doc.client_id, doc.user_id);
    if (tenantId && await deps.isWorkspaceAdmin(tenantId)) return { allowed: true, via: "workspace_admin" };
  }
  if (await deps.isOperator()) return { allowed: true, via: "operator" };
  return { allowed: false };
}
