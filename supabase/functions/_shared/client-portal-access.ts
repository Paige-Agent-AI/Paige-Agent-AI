// E09 Slice 7 — pause, restore or end one joined client's portal access, from chat.
//
// ONE WRITER. The only writer of clients.portal_access_* is public.set_client_portal_access
// (migration 20271110240000): business owner/admin of the CURRENT workspace (the invitation
// authority), never a top-level agency, version-guarded, state-idempotent, audited with fixed
// references. The write carries exactly the version the owner's approval card was built from: the
// model reads the access first (read_client_portal_access returns `access_version`) and must pass
// that value back as `access_version`, which is part of the approval card's fingerprint. So a card
// approved on one state cannot apply to another — anything that lands between the read the card
// was built from and the write, including after the owner approved, is refused (ACCESS_CHANGED)
// and nothing is written. This module re-reads the contact before the write only to refuse early in
// the owner's words (not found, wrong tier, not allowed); the version it sends is never that re-read.
// The result is proven from a fresh read on the caller's own session.
//
// THE TENANT NEVER COMES FROM THE MODEL. Only `contact_id`, `action` and `reason` are read from the
// arguments. The tenant is the server-resolved caller tenant the dispatcher passes in (re-checked
// against current_user_tenant_id() before the call); the actor is the verified session user. A
// `tenant_id` argument is ignored and never reaches the database.
//
// THE NOTE NEVER COMES FROM THE MODEL, AND NEVER GOES BACK TO IT. The owner's internal note is typed
// by the owner on the card in the app. Paige cannot set it (a `note` argument is dropped, never sent),
// and the read handed to the model omits it: model context is not "only your team".
//
// SUCCESS IS A READBACK. A database refusal that carries a SQLSTATE proves nothing was written; a
// structured {ok:false} answer from the writer is a refusal by construction. Anything else after the
// call was sent is `outcome_unknown`, never retried here.

export const PORTAL_ACCESS_ACTIONS = ["pause", "restore", "end"] as const;

// ── What a share answer says the client can see (E09 Slice 7 round 2) ──────────────────────────────
// The two share writers (client_file_set_client_share, plan_item_set_client_share) answer
// portal_connected = "can open the portal now" (linked AND access open) and portal_access, which names
// why not. A paused client keeps their login link, so the link alone never means "they can see it".
export type PortalShareAccess = "open" | "paused" | "ended" | "not_joined";
const SHARE_ACCESS: readonly PortalShareAccess[] = ["open", "paused", "ended", "not_joined"];
/** The writer's portal_access, or null when absent or unknown (an answer from before the field existed). */
export function readPortalShareAccess(v: unknown): PortalShareAccess | null {
  return typeof v === "string" && (SHARE_ACCESS as readonly string[]).includes(v) ? v as PortalShareAccess : null;
}
/**
 * One sentence on why the client cannot see what was just shared — "" when they can (connected is not false).
 * Paige appends it to her confirmation, so she never says "they can open it now" to a paused client.
 */
export function portalUnseenNote(r: { portalConnected: boolean | null; portalAccess?: PortalShareAccess | null }): string {
  if (r.portalConnected !== false) return "";
  switch (r.portalAccess) {
    case "paused": return " Their portal access is paused, so they can't see it until the business restores it.";
    case "ended": return " Their portal access has ended, so they will see it only if they are invited back and accept.";
    default: return " This client hasn't joined their portal yet, so they'll see it once they do.";
  }
}
export type PortalAccessAction = typeof PORTAL_ACCESS_ACTIONS[number];
/** The writer's CHECK set (clients_portal_access_reason_check). Owner-internal; never shown to the client. */
export const PORTAL_ACCESS_REASONS = [
  "engagement_paused", "engagement_ended", "payment", "client_request", "security", "other",
] as const;
export type PortalAccessReason = typeof PORTAL_ACCESS_REASONS[number];
export type PortalAccessState = "open" | "paused" | "ended";
const TARGET: Readonly<Record<PortalAccessAction, PortalAccessState>> = Object.freeze({ pause: "paused", restore: "open", end: "ended" });

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sqlstate = (e: unknown): string => String(isObject(e) ? e.code ?? "" : "");
const errorText = (e: unknown): string => String(isObject(e) ? e.message ?? "" : "");

export interface PortalAccessCaller {
  /** The caller's own session: public.read_client_portal_access and public.set_client_portal_access. */
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type PortalAccessFailure =
  | "no_workspace" | "bad_request" | "not_found" | "not_joined" | "restore_unavailable" | "changed"
  | "not_for_tier" | "forbidden" | "unavailable" | "refused" | "outcome_unknown";

export const PORTAL_ACCESS_MESSAGES: Readonly<Record<PortalAccessFailure, string>> = Object.freeze({
  no_workspace: "There is no business workspace to change a client's portal access in.",
  bad_request: "That was not understood. Name the client, say pause, restore or end, and give a reason for a pause or an end.",
  not_found: "That client is not in this business.",
  not_joined: "That client has not joined the portal, so there is nothing to pause, restore or end. An ended client comes back only through a new invitation.",
  restore_unavailable: "Their access cannot be restored right now.",
  changed: "Their portal access changed since it was last read, so nothing was changed. Read it again before deciding.",
  not_for_tier: "An agency workspace has no client portal of its own. Switch into the business that holds this client.",
  forbidden: "Only the business's owner or an admin can pause, restore or end a client's portal access.",
  unavailable: "The client's portal access could not be read just now, so nothing was changed.",
  refused: "The change was not accepted, and nothing was changed.",
  outcome_unknown: "The change was sent but could not be confirmed. Read the client's portal access again before doing anything else.",
});
const RESTORE_BLOCKED_TEXT: Readonly<Record<string, string>> = Object.freeze({
  contact_inactive: "This client's record is not active.",
  contact_merged: "This client's record was merged into another one.",
  business_inactive: "This business is not active.",
});

/** What the model sees of one client's access. Deliberately WITHOUT the owner's internal note. */
export interface PortalAccessView {
  contactId: string;
  state: PortalAccessState;
  joined: boolean;
  since: string | null;
  changedByName: string | null;
  reason: PortalAccessReason | null;
  invitation: string;
  can: { pause: boolean; restore: boolean; end: boolean; invite: boolean };
  restoreBlockedBy: string | null;
}

export type PortalAccessRequest = {
  contactId: string; action: PortalAccessAction; reason: PortalAccessReason | null;
  /** The portal_access_changed_at the approval card was built from; null when it had never changed. */
  expectedChangedAt: string | null;
};

/** The version token the model carries from the read to the write: the read's `since`, or "none". */
export const PORTAL_ACCESS_NO_VERSION = "none";
export const accessVersionToken = (since: string | null): string => since ?? PORTAL_ACCESS_NO_VERSION;
/** A timestamptz as the database renders it in JSON (read_client_portal_access `since`). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Reads exactly contact_id, action, reason and access_version. Anything else (a tenant, a note) is ignored. */
export function parsePortalAccessRequest(args: unknown): { ok: true; request: PortalAccessRequest } | { ok: false } {
  if (!isObject(args)) return { ok: false };
  const contactId = typeof args.contact_id === "string" ? args.contact_id.trim() : "";
  const action = args.action;
  if (!UUID.test(contactId) || typeof action !== "string" || !(PORTAL_ACCESS_ACTIONS as readonly string[]).includes(action)) return { ok: false };
  const raw = args.reason;
  let reason: PortalAccessReason | null = null;
  if (action === "restore") {
    // A restore carries no reason; one sent anyway is ignored rather than stored.
  } else {
    if (typeof raw !== "string" || !(PORTAL_ACCESS_REASONS as readonly string[]).includes(raw)) return { ok: false };
    reason = raw as PortalAccessReason;
  }
  const version = args.access_version;
  if (typeof version !== "string" || (version !== PORTAL_ACCESS_NO_VERSION && !TIMESTAMP.test(version))) return { ok: false };
  const expectedChangedAt = version === PORTAL_ACCESS_NO_VERSION ? null : version;
  return { ok: true, request: { contactId: contactId.toLowerCase(), action: action as PortalAccessAction, reason, expectedChangedAt } };
}

/** The owner read projected for the model. Null when the shape is not exactly the writer's read. */
export function projectAccessView(d: unknown): PortalAccessView | null {
  if (!isObject(d) || d.ok !== true || typeof d.contact_id !== "string" || !UUID.test(d.contact_id)) return null;
  if (d.state !== "open" && d.state !== "paused" && d.state !== "ended") return null;
  if (typeof d.joined !== "boolean" || !isObject(d.can) || !isObject(d.invitation)) return null;
  const can = d.can;
  if (![can.pause, can.restore, can.end, can.invite].every((v) => typeof v === "boolean")) return null;
  const reason = typeof d.reason === "string" && (PORTAL_ACCESS_REASONS as readonly string[]).includes(d.reason) ? d.reason as PortalAccessReason : null;
  return {
    contactId: d.contact_id.toLowerCase(),
    state: d.state,
    joined: d.joined,
    since: typeof d.since === "string" ? d.since : null,
    changedByName: typeof d.changed_by_name === "string" ? d.changed_by_name : null,
    reason,
    invitation: typeof d.invitation.status === "string" ? d.invitation.status : "none",
    can: { pause: can.pause as boolean, restore: can.restore as boolean, end: can.end as boolean, invite: can.invite as boolean },
    restoreBlockedBy: typeof d.restore_blocked_by === "string" ? d.restore_blocked_by : null,
  };
}

type ViewRead = { ok: true; view: PortalAccessView; since: string | null } | { ok: false; reason: PortalAccessFailure };

/** public.read_client_portal_access for exactly this tenant and contact; anything off-shape is "unavailable". */
async function readView(caller: PortalAccessCaller, tenant: string, contactId: string): Promise<ViewRead> {
  let r: { data: unknown; error: unknown };
  try { r = await caller.rpc("read_client_portal_access", { _expected_tenant_id: tenant, _contact_id: contactId }); }
  catch { return { ok: false, reason: "unavailable" }; }
  if (r.error) return { ok: false, reason: sqlstate(r.error) === "42501" ? "forbidden" : "unavailable" };
  const d = r.data;
  if (isObject(d) && d.ok === false) {
    if (d.error === "CONTACT_NOT_FOUND") return { ok: false, reason: "not_found" };
    if (d.error === "PORTAL_ACCESS_UNAVAILABLE") return { ok: false, reason: "not_for_tier" };
    if (d.error === "INVALID_REQUEST") return { ok: false, reason: "bad_request" };
    return { ok: false, reason: "unavailable" };
  }
  const view = projectAccessView(d);
  if (!view || view.contactId !== contactId) return { ok: false, reason: "unavailable" };
  return { ok: true, view, since: view.since };
}

export type PortalAccessReadResult =
  | { success: true; tenantId: string; view: PortalAccessView }
  | { success: false; reason: PortalAccessFailure; message: string };

/** One client's portal access, as the owner sees it, minus the internal note. */
export async function readPortalAccess(input: {
  caller: PortalAccessCaller; expectedTenantId: string | null | undefined; args: unknown;
}): Promise<PortalAccessReadResult> {
  const fail = (reason: PortalAccessFailure): PortalAccessReadResult => ({ success: false, reason, message: PORTAL_ACCESS_MESSAGES[reason] });
  const tenant = input.expectedTenantId;
  if (typeof tenant !== "string" || !UUID.test(tenant)) return fail("no_workspace");
  const contactId = isObject(input.args) && typeof input.args.contact_id === "string" ? input.args.contact_id.trim().toLowerCase() : "";
  if (!UUID.test(contactId)) return fail("bad_request");
  const read = await readView(input.caller, tenant, contactId);
  if (read.ok === false) return fail(read.reason);
  return { success: true, tenantId: tenant, view: read.view };
}

export type PortalAccessResult =
  | { success: true; tenantId: string; contactId: string; action: PortalAccessAction; view: PortalAccessView; replayed: boolean }
  | { success: false; reason: PortalAccessFailure; message: string; writeAttempted: boolean; detail?: string };

/** Pauses, restores or ends one client's access in the caller's own business, then proves it from a fresh read. */
export async function setPortalAccess(input: {
  caller: PortalAccessCaller; expectedTenantId: string | null | undefined; actorId: string | null | undefined; args: unknown;
}): Promise<PortalAccessResult> {
  let attempted = false;
  const fail = (reason: PortalAccessFailure, detail?: string): PortalAccessResult => ({
    success: false, reason, writeAttempted: attempted,
    message: reason === "restore_unavailable" && detail && RESTORE_BLOCKED_TEXT[detail]
      ? `${PORTAL_ACCESS_MESSAGES.restore_unavailable} ${RESTORE_BLOCKED_TEXT[detail]}` : PORTAL_ACCESS_MESSAGES[reason],
    ...(detail ? { detail } : {}),
  });
  const tenant = input.expectedTenantId;
  const actor = input.actorId;
  if (typeof tenant !== "string" || !UUID.test(tenant) || typeof actor !== "string" || !UUID.test(actor)) return fail("no_workspace");
  const parsed = parsePortalAccessRequest(input.args);
  if (parsed.ok === false) return fail("bad_request");
  const { contactId, action, reason, expectedChangedAt } = parsed.request;

  // An early refusal in the owner's words; its version is deliberately not the one sent.
  const before = await readView(input.caller, tenant, contactId);
  if (before.ok === false) return fail(before.reason);

  let reply: { data: unknown; error: unknown };
  try {
    attempted = true;
    reply = await input.caller.rpc("set_client_portal_access", {
      p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_contact_id: contactId, p_action: action,
      p_reason: reason, p_note: null, p_expected_changed_at: expectedChangedAt,
    });
  } catch {
    return fail("outcome_unknown");
  }
  if (reply.error) {
    const code = sqlstate(reply.error);
    // Only an answered SQL refusal proves its transaction rolled back. A gateway or network error can
    // arrive after the database committed, so it is reported as unknown, never as "not applied".
    if (!/^[0-9A-Z]{5}$/.test(code)) return fail("outcome_unknown");
    attempted = false;
    if (code === "42501") return fail(/PORTAL_ACCESS_SCOPE_CHANGED/.test(errorText(reply.error)) ? "no_workspace" : "forbidden");
    return fail("refused");
  }
  const d = reply.data;
  if (isObject(d) && d.ok === false) {
    // A structured refusal is returned before any write by construction (the writer's early RETURNs).
    attempted = false;
    switch (d.error) {
      case "CONTACT_NOT_FOUND": return fail("not_found");
      case "NOT_JOINED": return fail("not_joined");
      case "ACCESS_RESTORE_UNAVAILABLE": return fail("restore_unavailable", typeof d.reason === "string" ? d.reason : undefined);
      case "ACCESS_CHANGED": return fail("changed");
      case "PORTAL_ACCESS_UNAVAILABLE": return fail("not_for_tier");
      case "INVALID_REQUEST": return fail("bad_request");
      default: return fail("refused");
    }
  }
  const written = projectAccessView(d);
  const after = await readView(input.caller, tenant, contactId);
  if (!written || after.ok === false || after.view.state !== TARGET[action] || written.state !== TARGET[action]) return fail("outcome_unknown");
  return { success: true, tenantId: tenant, contactId, action, view: after.view, replayed: isObject(d) && d.replayed === true };
}

/**
 * Owner words for each reason. ONE home: the app's card and the chat approval card both read it
 * (src/lib/client-portal-access.ts re-exports it). The reason is internal: the client never sees it.
 */
export const PORTAL_ACCESS_REASON_LABEL: Readonly<Record<PortalAccessReason, string>> = Object.freeze({
  engagement_paused: "Work is on hold",
  engagement_ended: "Our work together has ended",
  payment: "Payment",
  client_request: "They asked for it",
  security: "Security concern",
  other: "Another reason",
});

/** A name for the approval card, from a contact row. Never an id, never invented. */
export function portalAccessClientLabel(row: unknown): string | null {
  if (!isObject(row)) return null;
  const person = [row.first_name, row.last_name].filter((v) => typeof v === "string" && v.trim()).map((v) => (v as string).trim()).join(" ");
  const entity = typeof row.entity_name === "string" ? row.entity_name.trim() : "";
  const name = (person || entity).replace(/\s+/g, " ").slice(0, 80);
  return name || null;
}

/**
 * The client's name for the approval card, read on the caller's own session (RLS) for exactly this
 * workspace and contact. Any failure gives null and the card says "this client" — a card that cannot
 * name someone is better than one that names them wrongly.
 */
export async function portalAccessClientName(
  client: { from(table: string): any },
  tenantId: string | null | undefined,
  contactId: unknown,
): Promise<string | null> {
  const id = typeof contactId === "string" ? contactId.trim().toLowerCase() : "";
  if (!UUID.test(id) || typeof tenantId !== "string" || !UUID.test(tenantId)) return null;
  try {
    const { data, error } = await client.from("clients").select("first_name, last_name, entity_name")
      .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    return error ? null : portalAccessClientLabel(data);
  } catch {
    return null;
  }
}

/**
 * The approval card's consequence line, in the owner's words. It names the client and, for pause
 * and end, the reason the owner is approving. It never claims a send, a deletion, or a one-step undo.
 */
export function portalAccessConfirmSummary(args: unknown, clientName: string | null = null): string {
  // The card's words do not depend on the version token, so a missing one never hides the reason.
  const parsed = parsePortalAccessRequest(isObject(args) ? { ...args, access_version: PORTAL_ACCESS_NO_VERSION } : args);
  const action = parsed.ok ? parsed.request.action : (isObject(args) && typeof args.action === "string" ? args.action : "");
  const reason = parsed.ok && parsed.request.reason ? PORTAL_ACCESS_REASON_LABEL[parsed.request.reason] : null;
  const name = clientName?.trim() || null;
  const whose = name ? `${name}'s` : "this client's";
  const why = reason ? ` Reason: ${reason} (only your team sees it).` : "";
  const kept = "Their history stays on this contact and any open invitation stops working. They won't be emailed, and invoices, agreements and booked sessions you already sent stay as they are. Emails and texts you send them aren't affected.";
  switch (action) {
    case "pause":
      return `Pause ${whose} portal access.${why} They'll see that their access is paused the next time they open your portal, and you can restore it later. ${kept}`;
    case "restore":
      return `Restore ${whose} portal access. They can open your portal again. They won't be emailed.`;
    case "end":
      return `End ${whose} portal access.${why} They'll see that their access has ended. To bring them back you'll send a new invitation. Anything they connected under their own login stops showing here until they rejoin. ${kept}`;
    default:
      return `Change ${whose} portal access.`;
  }
}
