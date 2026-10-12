// Experience 04 · when an AUTOMATED collections contact may reach a client (contract C-3).
//
// Owner rulings, 2026-10-12 (ANT-51 / ANT-147):
//   * Two time-zone contexts are kept apart. The BUSINESS OWNER's zone governs payment schedules and
//     overdue reporting (client-engagement/status.ts). The RECIPIENT's VERIFIED local zone governs when
//     an automated email, text or call may go out — this module.
//   * A recipient's zone is never assumed from the business owner's location, a phone-number prefix,
//     a browser, a calendar default or the business's own quiet-hours zone. Unverified means no
//     automated contact, and the owner is asked to verify.
//   * When the recipient's location, time zone or a legally required permission cannot be
//     established, automated contact is prevented.
//
// This is a pure decision with no reads, writes, schedules or sends. It does not replace the shared
// Communications pre-send gate (_shared/pre-send-pipeline.ts), which every send still passes through;
// it is the stricter Collections pre-check an automated reminder must clear BEFORE it may be proposed.
// (That shared gate still falls back to the business zone or New York for SMS quiet hours: #2083.)
// The local-time arithmetic is the pre-send gate's own (inWindow / nextLocalBoundaryUtc, DST-correct),
// and the zone check is the shared IANA validator — neither is re-implemented here.
//
// Real sends and AI calls stay behind their separate compliance and activation controls; a `clear`
// result here authorizes nothing by itself.
import { inWindow, nextLocalBoundaryUtc, QUIET_HOURS_END, QUIET_HOURS_START } from '../pre-send-pipeline.ts';
import { localDateInZone } from '../paige-context/snapshot.ts';

export type CollectionChannel = 'email' | 'sms' | 'call';

export type RecipientContactFacts = {
  /** clients.timezone — an IANA zone name, or null. */
  timezone: string | null;
  /** clients.timezone_verified — true only when the zone was confirmed, not inferred. */
  timezone_verified: boolean;
  /** Where the recipient is, as a VERIFIED jurisdiction (ISO 3166-1 alpha-2 country), or null. */
  jurisdiction: { country: string; verified: boolean } | null;
  /** Channel permission as recorded by Communications. */
  consent: 'granted' | 'missing' | 'revoked';
  /** On the suppression list (STOP, unsubscribe, bounce, complaint) for this channel. */
  suppressed: boolean;
  /** Client-level do-not-disturb. */
  dnd_active: boolean;
};

export type ContactRefusal =
  | 'calling_not_authorized'
  | 'opted_out'
  | 'do_not_disturb'
  | 'consent_missing'
  | 'consent_revoked'
  | 'recipient_time_zone_unverified'
  | 'recipient_location_unverified'
  | 'jurisdiction_rules_unavailable';

export type ContactWindowDecision =
  | { state: 'clear'; recipient_zone: string; window: { start: string; end: string } }
  | { state: 'wait'; recipient_zone: string; next_allowed_at: string; reason: 'outside_recipient_hours' }
  | { state: 'blocked'; reason: ContactRefusal; request_verification: boolean };

/**
 * Jurisdictions whose automated-contact hours this module knows. Only the United States is encoded,
 * using the pre-send gate's quiet window (no texts 20:00–08:00 recipient-local, stricter than the
 * federal 21:00 limit). Every other jurisdiction is refused until its rules are added deliberately —
 * an unknown legal regime is never treated as permission.
 */
const CONTACT_HOURS: Record<string, { start: string; end: string }> = {
  US: { start: QUIET_HOURS_END, end: QUIET_HOURS_START },
};

export function collectionContactWindow(
  channel: CollectionChannel,
  recipient: RecipientContactFacts,
  now: Date,
): ContactWindowDecision {
  // AI collection calls wait on legal review and owner authorization, whatever the facts say.
  if (channel === 'call') return { state: 'blocked', reason: 'calling_not_authorized', request_verification: false };
  if (recipient.suppressed) return { state: 'blocked', reason: 'opted_out', request_verification: false };
  if (recipient.dnd_active) return { state: 'blocked', reason: 'do_not_disturb', request_verification: false };
  if (recipient.consent === 'revoked') return { state: 'blocked', reason: 'consent_revoked', request_verification: false };
  // Text messages need prior express permission; an automated email needs at least no withdrawal.
  if (channel === 'sms' && recipient.consent !== 'granted') {
    return { state: 'blocked', reason: 'consent_missing', request_verification: true };
  }
  const zone = recipient.timezone?.trim() ?? '';
  if (!recipient.timezone_verified || !zone || localDateInZone(now.getTime(), zone) === null) {
    return { state: 'blocked', reason: 'recipient_time_zone_unverified', request_verification: true };
  }
  if (!recipient.jurisdiction?.verified || !/^[A-Z]{2}$/.test(recipient.jurisdiction.country)) {
    return { state: 'blocked', reason: 'recipient_location_unverified', request_verification: true };
  }
  const hours = CONTACT_HOURS[recipient.jurisdiction.country];
  if (!hours) return { state: 'blocked', reason: 'jurisdiction_rules_unavailable', request_verification: false };
  if (inWindow(now, zone, hours.start, hours.end)) return { state: 'clear', recipient_zone: zone, window: hours };
  return { state: 'wait', recipient_zone: zone, next_allowed_at: nextLocalBoundaryUtc(now, zone, hours.start),
    reason: 'outside_recipient_hours' };
}
