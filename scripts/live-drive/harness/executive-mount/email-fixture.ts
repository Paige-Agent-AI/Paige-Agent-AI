// DEVELOPMENT ONLY: synthetic input for the ORIGINAL Executive renderer.
// No issuer, provider, model, business record or authorization is exercised.
import type { BusinessOperatingSnapshot, DomainSnapshot } from '../../../../supabase/functions/_shared/paige-context/snapshot';

export function withEmailFixture(snapshot: BusinessOperatingSnapshot, state: string): BusinessOperatingSnapshot {
  const email: DomainSnapshot = {
    domain: 'email', owner: 'marketing', period: snapshot.period, as_of: snapshot.composed_at,
    freshness: 'live_read', coverage: 'partial',
    coverage_note: 'Counts describe sends in this period. Opens and clicks were recorded since those sends; own-mail tracking is excluded. Image loads do not prove reading. No engagement rate, retention or revenue is inferred.',
    headline: [
      { key: 'email.sent', label: 'Campaign emails sent', value: state === 'empty' ? 0 : 120, unit: 'count', basis: 'in_period' },
      { key: 'email.opened', label: 'Sent emails with a tracked open', value: state === 'empty' ? 0 : 38, unit: 'count', basis: 'point_in_time', window_note: 'For these sends, through this read. An image load is not a read receipt.' },
      { key: 'email.clicked', label: 'Sent emails with a tracked click', value: state === 'empty' ? 0 : 12, unit: 'count', basis: 'point_in_time', window_note: 'For these sends, through this read. Not unique people or a conversion.' },
    ],
    risks: [], changes: [], outcomes: [], upcoming: [], goal_links: [],
    sources: [{ system: 'marketing', adapter: 'synthetic-original-email-input', reference: 'marketing.email.sent@synthetic-source-revision' }],
  };
  const entry = state === 'unavailable' ? { status: 'degraded' as const, data: null, reason: 'scope_changed' }
    : { status: 'available' as const, data: email };
  return { ...snapshot, requested: [...snapshot.requested, 'email'], domains: { ...snapshot.domains, email: entry } };
}
