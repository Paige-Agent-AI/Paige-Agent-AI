// #1140 two-mailbox pilot — the mailbox policy gates, pure and deterministic.
//
// ONE canonical engine, TWO server-enforced policies. This module is the shared
// source of truth the SQL (read_message_content, the RLS predicates) and the
// comms-mailbox-command door both mirror: personal = the granting owner only,
// shared_support = tenant staff, inactive connector = revoked consent = refuse.
// Pure: no Deno imports, no database, no clock — vitest exercises it directly.

export type MailboxClass = "personal" | "shared_support";

/** The channel_connectors fields the policy reads. Unknown values fail CLOSED. */
export interface MailboxPolicyRow {
  mailbox_class: unknown;
  mailbox_owner_user_id: unknown;
  status: unknown;
  active: unknown;
  mailbox_scopes: unknown;
}

export interface ContentReadQuery {
  callerUserId: string;
  /** current_user_tenant_id() — server-derived, never from the wire. Null = no tenant. */
  callerTenantId: string | null;
  mailboxTenantId: string;
  mailbox: MailboxPolicyRow;
}

export type ContentReadDecision =
  | { allowed: true; mailboxClass: MailboxClass }
  | { allowed: false; code: "MAILBOX_INACTIVE" | "PERSONAL_MAILBOX_NOT_OWNER" | "FOREIGN_TENANT" | "NO_TENANT" };

export const GMAIL_SCOPE_READ_ONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE_MODIFY = "https://www.googleapis.com/auth/gmail.modify";

export function mailboxClassOf(row: MailboxPolicyRow): MailboxClass | null {
  return row.mailbox_class === "personal" || row.mailbox_class === "shared_support" ? row.mailbox_class : null;
}

function grantedScopes(row: MailboxPolicyRow): string[] {
  return Array.isArray(row.mailbox_scopes) ? row.mailbox_scopes.filter((s): s is string => typeof s === "string") : [];
}

/** Reading needs gmail.readonly OR gmail.modify (modify subsumes read). */
export function hasReadScope(row: MailboxPolicyRow): boolean {
  const scopes = grantedScopes(row);
  return scopes.includes(GMAIL_SCOPE_READ_ONLY) || scopes.includes(GMAIL_SCOPE_MODIFY);
}

/** Organization (labels/archive/trash/undo) needs gmail.modify — the scope that
 *  excludes permanent deletion by definition. */
export function hasOrganizeScope(row: MailboxPolicyRow): boolean {
  return grantedScopes(row).includes(GMAIL_SCOPE_MODIFY);
}

/**
 * The one content-read authorization decision. Order matters: a revoked
 * connector refuses before any identity question (dead consent protects
 * everyone), then the tenant boundary, then the personal-owner boundary.
 */
export function decideContentRead(query: ContentReadQuery): ContentReadDecision {
  const mailboxClass = mailboxClassOf(query.mailbox);
  if (query.mailbox.status !== "active" || query.mailbox.active !== true || !mailboxClass) {
    return { allowed: false, code: "MAILBOX_INACTIVE" };
  }
  if (!query.callerTenantId) return { allowed: false, code: "NO_TENANT" };
  if (query.callerTenantId !== query.mailboxTenantId) return { allowed: false, code: "FOREIGN_TENANT" };
  if (mailboxClass === "personal") {
    if (typeof query.mailbox.mailbox_owner_user_id !== "string" || query.mailbox.mailbox_owner_user_id !== query.callerUserId) {
      return { allowed: false, code: "PERSONAL_MAILBOX_NOT_OWNER" };
    }
  }
  return { allowed: true, mailboxClass };
}
