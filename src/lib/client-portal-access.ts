import { supabase } from "@/integrations/supabase/client";
import { PORTAL_ACCESS_REASON_LABEL } from "../../supabase/functions/_shared/client-portal-access";

/**
 * E09 Slice 7 — a joined client's portal access to ONE business: open, paused or ended.
 *
 * The state lives on the contact (`clients.portal_access_state`, migration 20271111010000), next
 * to the link it qualifies. Three server doors, and nothing else, read or change it:
 *   - `read_client_portal_access(_expected_tenant_id, _contact_id)` — the owner's read (card, Paige).
 *   - `set_client_portal_access(...)` — the one writer: pause, restore, end. Version-guarded on
 *     `portal_access_changed_at`, which the owner read returns as `since`.
 *   - `client_portal_access_state()` — the customer's own honest read, keyed on auth.uid() only. It
 *     works when no relationship resolves, so a paused or ended customer is told so instead of
 *     being shown the platform shell.
 *
 * These RPCs are not in the generated types yet. Every response is parsed here and nowhere else
 * (§18), and a response that does not match its contract is treated as unreadable, never guessed.
 */

export type PortalAccessStateName = "open" | "paused" | "ended";
export type PortalAccessReason =
  | "engagement_paused"
  | "engagement_ended"
  | "payment"
  | "client_request"
  | "security"
  | "other";
export type PortalAccessAction = "pause" | "restore" | "end";
export type PortalInvitationStatus = "none" | "pending" | "expired" | "canceled" | "accepted";
export type RestoreBlockedBy = "contact_inactive" | "contact_merged" | "business_inactive";

const STATES: ReadonlySet<string> = new Set(["open", "paused", "ended"]);
const REASONS: ReadonlySet<string> = new Set(["engagement_paused", "engagement_ended", "payment", "client_request", "security", "other"]);
const INVITATIONS: ReadonlySet<string> = new Set(["none", "pending", "expired", "canceled", "accepted"]);
const BLOCKERS: ReadonlySet<string> = new Set(["contact_inactive", "contact_merged", "business_inactive"]);

/**
 * Owner words for each reason. The reason is internal: the client never sees it (D3). One home with
 * the chat approval card (supabase/functions/_shared/client-portal-access.ts), so the app and Paige
 * name a reason the same way.
 */
export { PORTAL_ACCESS_REASON_LABEL };

/** Which reasons fit which act. Restore takes no reason. */
export const PORTAL_ACCESS_REASONS_FOR: Record<Exclude<PortalAccessAction, "restore">, PortalAccessReason[]> = {
  pause: ["engagement_paused", "payment", "client_request", "security", "other"],
  end: ["engagement_ended", "payment", "client_request", "security", "other"],
};

export const PORTAL_ACCESS_NOTE_MAX = 280;

/**
 * True when a read failed only because the access columns are not there yet (the web deployed before
 * migration 20271111010000 applied). The caller then re-reads without them, so People and the inbox keep
 * working and every client reads as open — exactly the state before this slice (verifier finding 3).
 */
export function missingPortalAccessColumns(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === "42703" && /portal_access/.test(error.message ?? "");
}
/** A select list without this slice's columns, for the pre-migration fallback above. */
export function withoutPortalAccessColumns(select: string): string {
  return select.replace(/,\s*portal_access_state|,\s*portal_access_changed_at/g, "");
}

/** Normalises a roster/raw column value. A missing column (pre-migration) reads as open. */
export function portalAccessStateOf(value: unknown): PortalAccessStateName {
  return typeof value === "string" && STATES.has(value) ? (value as PortalAccessStateName) : "open";
}

export interface OwnerPortalAccess {
  state: PortalAccessStateName;
  joined: boolean;
  /** `portal_access_changed_at` — when the state last changed, and the writer's version token. */
  since: string | null;
  changedByName: string | null;
  reason: PortalAccessReason | null;
  /** Owner-internal. Shown to the team only, never to the client. */
  note: string | null;
  invitation: PortalInvitationStatus;
  can: { pause: boolean; restore: boolean; end: boolean; invite: boolean };
  restoreBlockedBy: RestoreBlockedBy | null;
}

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const optionalText = (v: unknown): v is string | null => v === null || v === undefined || typeof v === "string";
const timestamp = (v: unknown): v is string | null => v === null || v === undefined || (typeof v === "string" && Number.isFinite(Date.parse(v)));

/** Parses the owner read projection. Anything off-contract is unreadable (null), never guessed. */
export function readOwnerPortalAccess(value: unknown): OwnerPortalAccess | null {
  if (!isObject(value)) return null;
  const { state, joined, since, changed_by_name, reason, note, invitation, can, restore_blocked_by } = value;
  if (typeof state !== "string" || !STATES.has(state) || typeof joined !== "boolean") return null;
  if (!timestamp(since) || !optionalText(changed_by_name) || !optionalText(note)) return null;
  if (reason !== null && reason !== undefined && (typeof reason !== "string" || !REASONS.has(reason))) return null;
  const inviteStatus = isObject(invitation) ? invitation.status : undefined;
  if (typeof inviteStatus !== "string" || !INVITATIONS.has(inviteStatus)) return null;
  if (!isObject(can) || !["pause", "restore", "end", "invite"].every((k) => typeof can[k] === "boolean")) return null;
  if (restore_blocked_by !== null && restore_blocked_by !== undefined
    && (typeof restore_blocked_by !== "string" || !BLOCKERS.has(restore_blocked_by))) return null;
  // The link and the state agree by CHECK on the server; a projection that says otherwise is not trusted.
  if (state === "paused" && !joined) return null;
  if (state === "ended" && joined) return null;
  return {
    state: state as PortalAccessStateName,
    joined,
    since: (since as string | null | undefined) ?? null,
    changedByName: (changed_by_name as string | null | undefined)?.trim() || null,
    reason: (reason as PortalAccessReason | null | undefined) ?? null,
    note: (note as string | null | undefined)?.trim() || null,
    invitation: inviteStatus as PortalInvitationStatus,
    can: { pause: can.pause as boolean, restore: can.restore as boolean, end: can.end as boolean, invite: can.invite as boolean },
    restoreBlockedBy: (restore_blocked_by as RestoreBlockedBy | null | undefined) ?? null,
  };
}

/** Flat rather than a union: the project's compiler settings do not narrow on `ok`. */
export type OwnerAccessReadResult = {
  ok: boolean;
  access: OwnerPortalAccess | null;
  code: "REFUSED" | "UNAVAILABLE" | "NOT_FOUND" | "UNREADABLE" | null;
};

/** The owner's read, for the workspace this record was opened in. The server re-checks the tenant. */
export async function fetchOwnerPortalAccess(tenantId: string, contactId: string): Promise<OwnerAccessReadResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC from 20271111010000 is not in the generated types yet
  const { data, error } = await (supabase as any).rpc("read_client_portal_access", {
    _expected_tenant_id: tenantId,
    _contact_id: contactId,
  });
  const refuse = (code: NonNullable<OwnerAccessReadResult["code"]>): OwnerAccessReadResult => ({ ok: false, access: null, code });
  if (error) return refuse((error as { code?: string }).code === "42501" ? "REFUSED" : "UNREADABLE");
  if (isObject(data) && data.ok === false) {
    if (data.error === "PORTAL_ACCESS_UNAVAILABLE") return refuse("UNAVAILABLE");
    if (data.error === "CONTACT_NOT_FOUND") return refuse("NOT_FOUND");
    return refuse("UNREADABLE");
  }
  const access = readOwnerPortalAccess(data);
  return access ? { ok: true, access, code: null } : refuse("UNREADABLE");
}

export type PortalAccessWriteCode =
  | "ACCESS_CHANGED"
  | "NOT_JOINED"
  | "ACCESS_RESTORE_UNAVAILABLE"
  | "CONTACT_NOT_FOUND"
  | "INVALID_REQUEST"
  | "PORTAL_ACCESS_UNAVAILABLE"
  | "SCOPE_CHANGED"
  | "UNCONFIRMED";
const WRITE_CODES: ReadonlySet<string> = new Set([
  "ACCESS_CHANGED", "NOT_JOINED", "ACCESS_RESTORE_UNAVAILABLE", "CONTACT_NOT_FOUND", "INVALID_REQUEST", "PORTAL_ACCESS_UNAVAILABLE",
]);

/** Flat rather than a union: the project's compiler settings do not narrow on `ok`. */
export type PortalAccessWriteResult = {
  ok: boolean;
  replayed: boolean;
  code: PortalAccessWriteCode | null;
  restoreBlockedBy: RestoreBlockedBy | null;
};
const refused = (code: PortalAccessWriteCode, restoreBlockedBy: RestoreBlockedBy | null = null): PortalAccessWriteResult =>
  ({ ok: false, replayed: false, code, restoreBlockedBy });

/**
 * The one writer. The actor and workspace are the caller's own expectation; the server pins both,
 * and the version is the `since` the owner last read. A success here is only an acknowledgement:
 * the caller reports the state a fresh read returns (§70.1).
 */
export async function setPortalAccess(args: {
  actorId: string;
  tenantId: string;
  contactId: string;
  action: PortalAccessAction;
  reason: PortalAccessReason | null;
  note: string | null;
  expectedChangedAt: string | null;
}): Promise<PortalAccessWriteResult> {
  const note = args.note?.trim() ? args.note.trim().slice(0, PORTAL_ACCESS_NOTE_MAX) : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC from 20271111010000 is not in the generated types yet
  const { data, error } = await (supabase as any).rpc("set_client_portal_access", {
    p_expected_actor_id: args.actorId,
    p_expected_tenant_id: args.tenantId,
    p_contact_id: args.contactId,
    p_action: args.action,
    p_reason: args.action === "restore" ? null : args.reason,
    p_note: args.action === "restore" ? null : note,
    p_expected_changed_at: args.expectedChangedAt,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return refused("SCOPE_CHANGED");
    // A concurrent invitation acceptance on the same contact (40P01 deadlock, 55P03 lock wait): the
    // row moved under us. Nothing of ours committed; re-read and show what is true now.
    if (code === "40P01" || code === "55P03") return refused("ACCESS_CHANGED");
    return refused("UNCONFIRMED");
  }
  if (isObject(data) && data.ok === true) return { ok: true, replayed: data.replayed === true, code: null, restoreBlockedBy: null };
  if (isObject(data) && data.ok === false && typeof data.error === "string" && WRITE_CODES.has(data.error)) {
    // The writer names the blocker `reason` on ACCESS_RESTORE_UNAVAILABLE (20271111010000); the read projection calls it restore_blocked_by.
    const named = data.restore_blocked_by ?? data.reason;
    const blocked = typeof named === "string" && BLOCKERS.has(named) ? (named as RestoreBlockedBy) : null;
    return refused(data.error as PortalAccessWriteCode, blocked);
  }
  return refused("UNCONFIRMED");
}

/**
 * What the owner reads before confirming. One home for the consequence copy: the record's card and
 * the contact panel both use it, and it says only what is true (review MEDIUM-6/7):
 *   - history stays on the contact, but END also hides what the person connected under their own
 *     login (it is keyed on that login), and open invitations stop working;
 *   - emails and texts are NOT stopped (the consent ledger still governs sends), and nobody is emailed;
 *   - invoices, agreements and booked sessions already sent stay as they are (D5) — except a signing
 *     link the client opened from the portal, which pause and end revoke (S7-D1, round 3 security 1):
 *     it replaced the emailed link, so the owner is told to resend it.
 */
export function portalAccessConfirmCopy(action: PortalAccessAction, name: string, business: string): { title: string; lines: string[]; confirm: string } {
  const notTold = "Emails and texts you send them aren’t affected, and we won’t email them about this.";
  const outside = "Invoices, agreements and booked sessions you already sent stay as they are.";
  const signing = "A signing link they opened from your portal stops working; resend it if they still need to sign.";
  switch (action) {
    case "pause":
      return {
        title: `Pause ${name}’s portal access?`,
        lines: [
          `They’ll see that their access to ${business} is paused the next time they open it. You can restore it later.`,
          "Their history stays on this contact, and any open invitation stops working.",
          notTold,
          outside,
          signing,
        ],
        confirm: "Pause access",
      };
    case "end":
      return {
        title: `End ${name}’s portal access?`,
        lines: [
          `They’ll see that their access to ${business} has ended. To bring them back you’ll send a new invitation.`,
          "Their history stays on this contact. Anything they connected under their own login stops showing here until they rejoin.",
          notTold,
          outside,
          signing,
        ],
        confirm: "End access",
      };
    case "restore":
    default:
      return {
        title: `Restore ${name}’s portal access?`,
        // Not "exactly as before": shared items, invitations and expiring threads can differ (review 13).
        lines: [`They’ll see your portal again. We won’t email them about this.`],
        confirm: "Restore access",
      };
  }
}

/** The owner's words for a refusal. The internal code never reaches the screen. */
export function portalAccessRefusalCopy(code: PortalAccessWriteCode, name: string, blockedBy: RestoreBlockedBy | null = null): string {
  switch (code) {
    case "ACCESS_CHANGED":
      return "This changed since you opened it. Here’s where it stands now.";
    case "NOT_JOINED":
      return `${name} isn’t joined to your portal, so there’s no access to change.`;
    case "ACCESS_RESTORE_UNAVAILABLE":
      return restoreBlockedCopy(blockedBy, name);
    case "CONTACT_NOT_FOUND":
      return `${name} isn’t a client in the workspace you have open.`;
    case "INVALID_REQUEST":
      return "Choose a reason before you confirm.";
    case "PORTAL_ACCESS_UNAVAILABLE":
      return "Client portal access isn’t managed from this account.";
    case "SCOPE_CHANGED":
      return "Your workspace or role changed. Reopen this client to manage their access.";
    case "UNCONFIRMED":
    default:
      return "We couldn’t confirm whether that changed. Check again before trying another change.";
  }
}

export function restoreBlockedCopy(blockedBy: RestoreBlockedBy | null, name: string): string {
  switch (blockedBy) {
    case "contact_inactive":
      return `${name}’s record isn’t active. Make it active in People before restoring access.`;
    case "contact_merged":
      return "This record was merged into another one. Manage access from that record.";
    case "business_inactive":
      return "Your business workspace isn’t active, so access can’t be restored right now.";
    default:
      return "Access can’t be restored right now.";
  }
}

/** The customer's own honest read. Only the business's public presentation is ever returned. */
export type CustomerPortalAccess =
  | { state: "open" | "multiple" | "none" }
  | { state: "paused" | "ended"; businessName: string; logoUrl: string | null; logoDarkUrl: string | null; since: string | null };

export function readCustomerPortalAccess(value: unknown): CustomerPortalAccess | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isObject(row) || typeof row.state !== "string") return null;
  if (row.state === "open" || row.state === "multiple" || row.state === "none") return { state: row.state };
  if (row.state !== "paused" && row.state !== "ended") return null;
  const business = row.business;
  if (!isObject(business) || typeof business.name !== "string" || !business.name.trim()) return null;
  if (!optionalText(business.logo_url) || !optionalText(business.logo_dark_url) || !timestamp(row.since)) return null;
  const url = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    state: row.state,
    businessName: business.name.trim(),
    logoUrl: url(business.logo_url),
    logoDarkUrl: url(business.logo_dark_url),
    since: (row.since as string | null | undefined) ?? null,
  };
}

/**
 * Asks the server whether the signed-in person's access was withheld. Resolves `null` when there is
 * nothing to say (open, more than one business, none, or no row) and throws when the answer is
 * unknown (a failed call, or a row that does not match the contract).
 * PostgREST answers a function that does not exist yet with PGRST202 (42883 from Postgres); until
 * 20271111010000 is applied nothing can be paused, so that answer is "nothing withheld", which is
 * exactly today's behaviour.
 */
export async function fetchWithheldCustomerAccess(): Promise<Extract<CustomerPortalAccess, { state: "paused" | "ended" }> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC from 20271111010000 is not in the generated types yet
  const result = await (supabase as any).rpc("client_portal_access_state");
  const error = result?.error as { code?: string } | null | undefined;
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw new Error("Customer access state unavailable");
  }
  // No row at all is "nothing recorded about this person", the same as { state: 'none' }.
  if (result?.data === null || result?.data === undefined) return null;
  const access = readCustomerPortalAccess(result.data);
  if (!access) throw new Error("Customer access state unreadable");
  return access.state === "paused" || access.state === "ended" ? access : null;
}

/** The customer's words. Reason and note are owner-internal and are never part of this. */
export function customerAccessCopy(state: "paused" | "ended", business: string): { title: string; body: string } {
  return state === "paused"
    ? {
      title: `Your access to ${business} is paused.`,
      // The access read carries no public contact for the business yet, so the page cannot offer one;
      // it never tells the person to use a channel it does not show (review 11).
      body: `${business} has paused your portal for now. Your portal messages and files are kept. If you have questions, reach out to ${business} the way you usually do.`,
    }
    : {
      title: `Your access to ${business} has ended.`,
      body: `${business} has closed your portal access. If you’re working with them again, they can send you a new invitation.`,
    };
}

/**
 * Impersonation ("view as client") refusals, in the owner's words. start_client_impersonation raises
 * these two exact messages (20271111010000); the strings are pinned by a test that reads the migration,
 * so a server wording change fails CI instead of silently falling back to the generic error. One home:
 * ImpersonationContext and the onboarding-status hook both use it.
 */
export const IMPERSONATION_ACCESS_ENDED = "client portal access has ended";
export const IMPERSONATION_ACCESS_PAUSED = "client portal access is paused";
export function impersonationAccessRefusal(message: string | null | undefined): string | null {
  const text = (message ?? "").toLowerCase();
  if (text.includes(IMPERSONATION_ACCESS_ENDED)) return "Their portal access has ended. Invite them again to view the portal as them.";
  if (text.includes(IMPERSONATION_ACCESS_PAUSED)) return "Their portal access is paused. Restore it to view the portal as them.";
  return null;
}
