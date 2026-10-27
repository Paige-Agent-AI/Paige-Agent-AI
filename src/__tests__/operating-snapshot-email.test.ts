// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeBusinessReview } from '../../supabase/functions/_shared/paige-context/business-review.ts';
import { validateDomainSnapshot } from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import { businessReviewRecordLinks } from '../../supabase/functions/_shared/paige-context/business-review-chat.ts';

const TENANT = 'e2020000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const KEYS = ['marketing.email.sent', 'marketing.email.opened', 'marketing.email.clicked'];
type Row = Record<string, unknown> & { metric_key: string; evidence_ref: string };
function harness(opts: { denied?: boolean; denyAt?: string; switchAt?: number; edit?: (row: Row) => void;
  resolve?: (row: Row) => void; wait?: boolean } = {}) {
  const calls: { name: string; input?: Record<string, unknown> }[] = [];
  const records = new Map<string, Row>(); let scopes = 0, issued = 0;
  const caller = { async rpc(name: string, input?: Record<string, unknown>) {
    calls.push({ name, input });
    if (name === 'current_user_tenant_id') return { data: ++scopes >= (opts.switchAt ?? Infinity) ? 'foreign' : TENANT, error: null };
    if (opts.denied) return { data: null, error: { code: '42501', message: 'PRIVATE_DENIAL' } };
    if (name === 'issue_analytics_evidence_bundle') {
      if (input!.p_metric_key === opts.denyAt) return { data: null, error: { code: '42501' } };
      if (opts.wait) return new Promise<never>(() => {});
      const key = input!.p_metric_key as string;
      if (!KEYS.includes(key)) throw Error('Unexpected metric');
      const count = [120, 38, 12][KEYS.indexOf(key)];
      const row: Row = { metric_key: key, metric_version: '1.0.0', owner_department: 'marketing',
        label: 'Original email count', definition: 'Original sent-cohort count.', formula: 'Original producer',
        range: { key: input!.p_range_key, start: input!.p_range_start, end: input!.p_range_end,
          bounds: '[start,end)', timezone: 'UTC', semantics: 'event_timestamp_cohort' },
        dimensions: {}, values: { kind: 'count', count }, unit: 'count', source_refs: ['public.email_campaign_recipients'],
        as_of: NOW.toISOString(), freshness: { queried_at: NOW.toISOString(), source_updated_through: null },
        coverage: { state: 'complete', candidate_count: 120, contributing_count: 120, excluded_count: 0 },
        exclusions: [], truth_state: 'LIVE', caveats: [], source_revision_ref: 'sr_v1_' + 'a'.repeat(64),
        account_epoch: TENANT, account_epoch_ref: 'ae_v1_' + 'b'.repeat(64),
        evidence_ref: 'aneb_v1_' + String(++issued).padStart(64, '0'),
        reference_expires_at: new Date(NOW.getTime() + 900000).toISOString(), private_payload: 'PRIVATE_RECIPIENT' };
      opts.edit?.(row); records.set(row.evidence_ref, row); return { data: structuredClone(row), error: null };
    }
    if (name === 'resolve_analytics_evidence_reference') {
      const row = structuredClone(records.get(input!.p_evidence_ref as string)!);
      opts.resolve?.(row); return { data: row, error: null };
    }
    throw Error('Unexpected RPC ' + name);
  } };
  return { calls, review: (timeoutMs?: number) => composeBusinessReview(caller,
    { actorId: 'synthetic-owner', tenantId: TENANT, role: 'owner', accountShape: 'solo' },
    { period: 'last_7_days', timezone: 'America/New_York', focus: ['email'] }, { now: NOW, timeoutMs }) };
}

describe('Original campaign email evidence in Business Review', () => {
  it('returns original Executive and aggregate Marketing references for a permitted focused email read', async () => {
    const result = await harness().review(); if (!result.ok) throw Error('Expected review');
    expect(businessReviewRecordLinks(result.snapshot)).toEqual([
      { destination: 'executive', record_id: null }, { destination: 'marketing', record_id: null },
    ]);
  });
  it('returns no email department reference for a denied source', async () => {
    const result = await harness({ denied: true }).review(); if (!result.ok) throw Error('Expected review');
    expect(businessReviewRecordLinks(result.snapshot)).toEqual([]);
  });
  it('uses the same review composer and only the three existing issuer/resolver keys', async () => {
    const h = harness(), result = await h.review(); expect(result.ok).toBe(true); if (!result.ok) return;
    const domain = result.snapshot.domains.email?.data;
    expect(domain).not.toBeNull();
    expect(validateDomainSnapshot(domain, { domain: 'email', period: result.snapshot.period, notAfter: NOW }).ok).toBe(true);
    expect(h.calls.filter(c => c.name === 'issue_analytics_evidence_bundle').map(c => c.input?.p_metric_key)).toEqual(KEYS);
    expect(domain?.headline.map(m => m.value)).toEqual([120, 38, 12]);
    expect(domain?.sources).toHaveLength(3); expect(domain?.owner).toBe('marketing');
    expect(domain?.risks).toEqual([]); expect(domain?.changes).toEqual([]); expect(domain?.outcomes).toEqual([]);
    expect(new Set(h.calls.map(c => c.name))).toEqual(new Set(['current_user_tenant_id', 'issue_analytics_evidence_bundle', 'resolve_analytics_evidence_reference']));
  });
  it('distinguishes sends in the period from later tracking on those sends', async () => {
    const h = harness(), result = await h.review(); if (!result.ok) throw Error('Expected review');
    const rows = result.snapshot.domains.email.data!.headline;
    expect(rows.map(m => m.basis)).toEqual(['in_period', 'point_in_time', 'point_in_time']);
    expect(rows[1].window_note).toMatch(/these sends.*through this read/i);
    expect(rows[1].window_note).toMatch(/not a read receipt/i);
    expect(rows[2].window_note).toMatch(/not unique people.*conversion/i);
    expect(result.projection).toMatch(/own.mail tracking.*excluded/i);
    expect(result.projection).toContain('not delivery confirmations');
    expect(result.projection).not.toMatch(/PRIVATE_RECIPIENT|PRIVATE_DENIAL|aneb_v1_|ae_v1_/);
    expect(rows.every(m => m.unit === 'count')).toBe(true);
    const issues = h.calls.filter(c => c.name === 'issue_analytics_evidence_bundle');
    expect(issues.every(c => c.input?.p_range_start === result.snapshot.period.start && c.input?.p_range_end === '2026-10-12T11:59:58.000Z')).toBe(true);
  });
  it('shows real zero counts while unavailable values stay absent', async () => {
    const zero = await harness({ edit(row) { row.values = { kind: 'count', count: 0 }; row.coverage = { state: 'complete', candidate_count: 0, contributing_count: 0, excluded_count: 0 }; } }).review();
    if (!zero.ok) throw Error('Expected review');
    expect(zero.snapshot.domains.email.data!.headline.map(m => m.value)).toEqual([0, 0, 0]);
    const absent = await harness({ edit(row) { row.values = null; row.truth_state = 'UNAVAILABLE'; row.coverage = { state: 'unavailable', candidate_count: 0, contributing_count: 0, excluded_count: 0 }; } }).review();
    if (!absent.ok) throw Error('Expected review'); expect(absent.snapshot.domains.email.data).toBeNull();
  });
  it('keeps original tracked-source exclusions partial and never calculates an engagement rate', async () => {
    const result = await harness({ edit(row) { if (row.metric_key !== KEYS[0]) {
      row.truth_state = 'PARTIAL'; row.coverage = { state: 'partial', candidate_count: 120, contributing_count: 100, excluded_count: 20 };
      row.exclusions = [{ reason: 'not_tracked_own_mail', count: 20 }];
    } } }).review(); if (!result.ok) throw Error('Expected review');
    const data = result.snapshot.domains.email.data!;
    expect(data.coverage).toBe('partial'); expect(data.coverage_note).toMatch(/image loads do not prove reading/i);
    expect(data.headline.map(m => m.value)).toEqual([120, 38, 12]);
    expect(data.headline).toHaveLength(3); expect(data.coverage_note!.length).toBeLessThanOrEqual(300);
  });
  it.each([
    ['wrong owner', (r: Row) => { r.owner_department = 'sales'; }],
    ['wrong shape', (r: Row) => { r.values = { kind: 'distribution', items: [] }; }],
    ['expired reference', (r: Row) => { r.reference_expires_at = '2026-10-12T11:59:59.000Z'; }],
    ['foreign scope', (r: Row) => { r.account_epoch = 'foreign'; }],
    ['wrong unit', (r: Row) => { r.unit = 'percent'; }],
  ])('withholds %s instead of inventing a figure', async (_label, edit) => {
    const result = await harness({ edit }).review(); if (!result.ok) throw Error('Expected review');
    expect(result.snapshot.domains.email.data).toBeNull();
  });
  it('rejects a changed revision during the original resolver read', async () => {
    const result = await harness({ resolve(row) { row.source_revision_ref = 'sr_v1_' + 'b'.repeat(64); } }).review();
    if (!result.ok) throw Error('Expected review'); expect(result.snapshot.domains.email.data).toBeNull();
  });
  it('withholds prior counts when authority is lost before the next metric', async () => {
    const result = await harness({ denyAt: KEYS[1] }).review(); if (!result.ok) throw Error('Expected review');
    expect(result.snapshot.domains.email.data).toBeNull(); expect(result.projection).not.toContain('120');
  });
  it('preserves verified counts when one unavailable source cannot supply its figure', async () => {
    const result = await harness({ edit(row) { if (row.metric_key === KEYS[2]) {
      row.values = null; row.truth_state = 'UNAVAILABLE'; row.coverage = { state: 'unavailable', candidate_count: 0, contributing_count: 0, excluded_count: 0 };
    } } }).review(); if (!result.ok) throw Error('Expected review');
    const data = result.snapshot.domains.email.data!;
    expect(data.coverage).toBe('partial'); expect(data.headline.map(m => m.value)).toEqual([120, 38]);
    expect(data.coverage_note).toContain('Image loads do not prove reading');
  });
  it('withholds all email facts after current authority or workspace loss', async () => {
    for (const h of [harness({ denied: true }), harness({ switchAt: 3 })]) {
      const result = await h.review(); if (!result.ok) throw Error('Expected review');
      expect(result.snapshot.domains.email.data).toBeNull(); expect(result.projection).not.toContain('120');
    }
  });
  it('settles a stuck source inside the existing bounded review budget', async () => {
    const result = await harness({ wait: true }).review(10); if (!result.ok) throw Error('Expected review');
    expect(result.snapshot.domains.email.data).toBeNull(); expect(result.snapshot.budget.timed_out).toContain('email');
  });
});
