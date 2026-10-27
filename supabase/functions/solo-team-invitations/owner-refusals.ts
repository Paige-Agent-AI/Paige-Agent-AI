/**
 * EXP08 owner invitations (migration 20271117020008): the refusals the database raises on purpose for
 * owner invitations, recognised by their stable HINT code rather than by their sentence.
 *
 * Why by HINT. These sentences name the business, the account holder or the legal owner ("Northstar
 * Studio has no account holder right now, …", "Morgan Hale's access is paused for billing, …"), so the
 * equality allowlist in index.ts cannot hold them, and without this they reached a person as HTTP 500
 * "tell us". A HINT is set only by our own RAISE … USING HINT; Postgres's own errors and PostgREST's
 * (`PGRST202`, an invalid-uuid cast) never carry one of these codes, so caller-controlled text cannot
 * pass this filter.
 *
 * Every code the migration raises is listed (a test derives the set from the migration), including the
 * few this endpoint cannot reach today, so a new caller never silently downgrades one to a 500.
 */
export const OWNER_REFUSAL_HINTS: Readonly<Record<string, 400 | 403 | 409>> = Object.freeze({
  // Who may act: an authority refusal.
  OWNER_HOLDER_ONLY: 403,
  OWNER_INVITATION_HOLDER_ONLY: 403,
  OWNER_NO_ACCOUNT_HOLDER: 403,
  OWNER_HOLDER_PAUSED: 403,
  OWNER_HOLDER_PAUSED_SELF: 403,
  OWNER_INVITE_EXISTS_FOR_ADDRESS: 403,
  OWNER_INVITE_UNAVAILABLE: 403,
  OWNER_INVITE_SETTINGS_ONLY: 403,
  OWNER_INVITE_SENDER_NOT_HOLDER: 403,
  OWNER_INVITE_NOT_HERE: 403,
  // What was asked for is not valid as asked.
  OWNER_TEAM_CONVERSATIONS: 400,
  OWNER_RECORD_AMBIGUOUS: 400,
  OWNER_RECORD_NOT_OWNER: 400,
  OWNER_RECORD_KIND: 400,
  OWNER_RECORD_NAME: 400,
  OWNER_RECORD_NOT_FOUND: 400,
  OWNER_RECORD_INDIVIDUAL: 400,
  // The legal owner's seat or invitation is already taken.
  OWNER_RECORD_SEATED: 409,
  OWNER_RECORD_INVITED: 409,
  OWNER_INVITE_SEAT_CHANGED: 409,
  OWNER_INVITE_RECORD_REMOVED: 409,
});

/** The plain sentence and status for an owner refusal, or null when `error` is not one. */
export function ownerRefusal(error: unknown): { status: 400 | 403 | 409; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const { hint, message } = error as { hint?: unknown; message?: unknown };
  if (typeof hint !== "string" || !Object.prototype.hasOwnProperty.call(OWNER_REFUSAL_HINTS, hint)) return null;
  if (typeof message !== "string" || !message.trim()) return null;
  return { status: OWNER_REFUSAL_HINTS[hint], message };
}
