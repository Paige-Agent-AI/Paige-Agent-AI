// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMarketingIntakeSnapshotAdapter, MARKETING_INTAKE_METRICS } from '../../supabase/functions/_shared/paige-context/adapters/marketing-intake.ts';
import { resolveSnapshotPeriod, validateDomainSnapshot } from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import type { ContextIdentity } from '../../supabase/functions/_shared/paige-context/mod.ts';
import { composeBusinessReview } from '../../supabase/functions/_shared/paige-context/business-review.ts';

const TENANT = 'a3400000-0000-4000-8000-0000000000f4';
const NOW = new Date('2026-10-12T12:00:00.000Z');
const identity: ContextIdentity = { actorId: 'test-actor', tenantId: TENANT, workspaceId: TENANT,
  role: 'owner', actAsClientId: null, accountShape: 'solo', scopeEpoch: TENANT };
const resolved = resolveSnapshotPeriod({ key: 'last_7_days', now: NOW, timezone: 'America/New_York' });
if ('reason' in resolved) throw Error(resolved.reason);
const period = resolved.period;
const ctx = (signal?: AbortSignal) => ({ identity, period, now: NOW, ...(signal ? { signal } : {}) });
type Values = { kind: 'count'; count: number } | { kind: 'distribution'; items: { key: string; label: string; count: number }[] };
type Fixture = Record<string, unknown> & { metric_key: string; evidence_ref: string; values: Values | null };
const distribution = (...items: [string, number][]): Values => ({ kind: 'distribution', items: items.map(([key, count]) => ({ key, label: 'UNTRUSTED_TAG_LABEL', count })) });
function fixture(key: string): Values {
  switch (key) {
    case MARKETING_INTAKE_METRICS.sourceTags: return distribution(['src:private-campaign-name', 4], ['_untagged', 2]);
    case MARKETING_INTAKE_METRICS.campaignTags: return distribution(['tag:untrusted-campaign', 4], ['_untagged', 2]);
    case MARKETING_INTAKE_METRICS.processing: return distribution(['failed', 2], ['stalled', 1]);
    default: return { kind: 'count', count: key === MARKETING_INTAKE_METRICS.received ? 6 : 1 };
  }
}
function harness(opts: { edit?: (row: Fixture, key: string) => void; denied?: boolean; switchAt?: number;
  afterResolve?: (key: string) => void; scope?: { tenantId: string | null } } = {}) {
  const calls: { name: string; input?: Record<string, unknown> }[] = [];
  const store = new Map<string, Fixture>(); let issued = 0, scopes = 0, active = 0, maxActive = 0;
  const caller = { async rpc(name: string, input?: Record<string, unknown>) {
    calls.push({ name, input });
    if (name === 'current_user_tenant_id') return { data: ++scopes >= (opts.switchAt ?? Infinity) ? 'foreign' : TENANT, error: null };
    if (opts.denied) return { data: null, error: { code: '42501', message: 'PRIVATE_DENIAL' } };
    if (name === 'issue_analytics_evidence_bundle') {
      active++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--;
      const key = input!.p_metric_key as string;
      const values = fixture(key), count = values.kind === 'count' ? values.count : values.items.reduce((n, row) => n + row.count, 0);
      const row: Fixture = { metric_key: key, metric_version: '1.0.0', owner_department: 'marketing',
        label: 'Recorded intake', definition: 'Original Marketing measurement.', formula: 'Original producer',
        range: { key: input!.p_range_key, start: input!.p_range_start, end: input!.p_range_end,
          bounds: '[start,end)', timezone: 'UTC', semantics: key.endsWith('_current') ? 'current_snapshot' : 'event_timestamp_cohort' },
        dimensions: {}, values, unit: 'count', source_refs: ['public.growth_form_submissions'],
        as_of: NOW.toISOString(), freshness: { queried_at: NOW.toISOString(), source_updated_through: null },
        coverage: { state: 'complete', candidate_count: count, contributing_count: count, excluded_count: 0 },
        exclusions: [], truth_state: 'LIVE', caveats: [], source_revision_ref: 'sr_v1_' + 'a'.repeat(64),
        account_epoch: TENANT, account_epoch_ref: 'ae_v1_' + 'b'.repeat(64),
        evidence_ref: 'aneb_v1_' + String(++issued).padStart(64, '0'),
        reference_expires_at: new Date(NOW.getTime() + 900000).toISOString(), private_payload: 'PRIVATE_CUSTOMER' };
      opts.edit?.(row, key); store.set(row.evidence_ref, row); return { data: structuredClone(row), error: null };
    }
    if (name === 'resolve_analytics_evidence_reference') {
      const row = structuredClone(store.get(input!.p_evidence_ref as string));
      opts.afterResolve?.(row?.metric_key); return { data: row, error: null };
    }
    throw Error('Unexpected RPC ' + name);
  } };
  const scope = opts.scope ?? { tenantId: TENANT };
  const adapter = createMarketingIntakeSnapshotAdapter(caller, scope, () => NOW.getTime());
  return { caller, calls, adapter, read: (signal?: AbortSignal) => adapter.read(ctx(signal)), maxActive: () => maxActive };
}
const headlines = (result: Awaited<ReturnType<ReturnType<typeof harness>['read']>>) => Object.fromEntries(result.data?.headline.map(row => [row.key, row.value]) ?? []);

describe('Marketing intake over the canonical Metric/Evidence cycle', () => {
  const review = (h: ReturnType<typeof harness>) => composeBusinessReview(h.caller,
    { actorId: identity.actorId, tenantId: TENANT, role: 'owner', accountShape: 'solo' },
    { period: 'last_7_days', timezone: period.timezone, focus: ['campaigns'] }, { now: NOW });
  it('mounts the original Marketing reader in the same Business Review used by Chat and Executive', async () => {
    const h = harness(), result = await review(h);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.snapshot.requested).toEqual(['campaigns']);
    expect(result.snapshot.domains.campaigns?.data?.headline).toHaveLength(7);
    expect(result.projection).toContain('Recorded intake only');
    expect(result.projection).not.toMatch(/PRIVATE_CUSTOMER|aneb_v1_|ae_v1_|UNTRUSTED_TAG_LABEL/);
    expect(h.calls.filter(row => row.name === 'issue_analytics_evidence_bundle').map(row => row.input?.p_metric_key))
      .toEqual(Object.values(MARKETING_INTAKE_METRICS));
  });
  it('withholds the mounted domain on authorization denial and final workspace change', async () => {
    for (const h of [harness({ denied: true }), harness({ switchAt: 14 })]) {
      const result = await review(h); expect(result.ok).toBe(true); if (!result.ok) continue;
      expect(result.snapshot.domains.campaigns?.data).toBeNull();
      expect(result.projection).not.toContain('Leads received (form submissions): 6');
    }
  });
  it('projects only original counts, source provenance and real processing risks in a valid domain snapshot', async () => {
    const h = harness(), result = await h.read();
    expect(result.status).toBe('available'); expect(result.data?.coverage).toBe('partial');
    expect(validateDomainSnapshot(result.data, { domain: 'campaigns', period, notAfter: NOW }).ok).toBe(true);
    expect(headlines(result)).toEqual({ 'campaigns.received': 6, 'campaigns.linked': 1,
      'campaigns.leads_without_source_tag': 2, 'campaigns.leads_without_campaign_tag': 2,
      'campaigns.unrouted': 1, 'campaigns.failed': 2, 'campaigns.stalled': 1 });
    expect(result.data?.risks.map(row => row.severity)).toEqual(['watch', 'act', 'watch']);
    expect(result.data?.sources).toHaveLength(6);
    expect(result.data?.sources.every(row => row.system === 'marketing' && row.reference?.startsWith('marketing.'))).toBe(true);
    expect(result.data?.changes).toEqual([]); expect(result.data?.outcomes).toEqual([]);
  });
  it('issues exactly the six original keys sequentially, using the exact rolling window rather than a Sales daily cutoff', async () => {
    const h = harness(); await h.read();
    const issues = h.calls.filter(row => row.name === 'issue_analytics_evidence_bundle');
    expect(issues.map(row => row.input?.p_metric_key)).toEqual(Object.values(MARKETING_INTAKE_METRICS));
    expect(issues.every(row => row.input?.p_range_start === period.start && row.input?.p_range_end === '2026-10-12T11:59:58.000Z')).toBe(true);
    expect(h.maxActive()).toBe(1);
    expect(new Set(h.calls.map(row => row.name))).toEqual(new Set(['current_user_tenant_id', 'issue_analytics_evidence_bundle', 'resolve_analytics_evidence_reference']));
  });
  it('keeps trusted source and model projections free of private scope, tokens, tag labels and producer extras', async () => {
    const result = await harness().read();
    const text = JSON.stringify(result);
    for (const privateValue of [TENANT, 'aneb_v1_', 'ae_v1_', 'PRIVATE_CUSTOMER', 'UNTRUSTED_TAG_LABEL', 'private-campaign-name', 'untrusted-campaign']) expect(text).not.toContain(privateValue);
    expect(text).toContain('no visits, ad spend, revenue, full funnel or causal attribution');
  });
  it('keeps genuine empty intake and explicit processing zeros distinct from unavailable data', async () => {
    const result = await harness({ edit(row, key) { row.values = key === MARKETING_INTAKE_METRICS.processing ? distribution(['failed', 0], ['stalled', 0])
      : row.values.kind === 'distribution' ? distribution() : { kind: 'count', count: 0 };
      row.coverage = { state: 'complete', candidate_count: 0, contributing_count: 0, excluded_count: 0 }; } }).read();
    expect(Object.values(headlines(result))).toEqual([0, 0, 0, 0, 0, 0, 0]); expect(result.data?.risks).toEqual([]);
    const unavailable = await harness({ edit(row) { row.values = null; row.truth_state = 'UNAVAILABLE'; row.coverage = { state: 'unavailable', candidate_count: 1, contributing_count: 0, excluded_count: 1 }; row.exclusions = [{ reason: 'Unavailable', count: 1 }]; } }).read();
    expect(unavailable.status).toBe('degraded'); expect(unavailable.data).toBeNull();
  });
  it('does not turn a missing processing bucket into zero while retaining other proven intake', async () => {
    const result = await harness({ edit(row, key) { if (key === MARKETING_INTAKE_METRICS.processing) row.values = distribution(['failed', 2]); } }).read();
    expect(result.status).toBe('available'); expect(headlines(result)).not.toHaveProperty('campaigns.failed');
    expect(headlines(result)).not.toHaveProperty('campaigns.stalled'); expect(result.data?.coverage_note).toContain('Submission processing could not be read');
  });
  it('does not infer missing untagged zeros from an incomplete distribution', async () => {
    const result = await harness({ edit(row, key) { if (key === MARKETING_INTAKE_METRICS.sourceTags) {
      row.values = distribution(['src:recorded', 4]); row.truth_state = 'PARTIAL'; row.coverage = { state: 'partial', candidate_count: 6, contributing_count: 4, excluded_count: 2 }; row.exclusions = [{ reason: 'Not measured', count: 2 }];
    } } }).read();
    expect(headlines(result)).not.toHaveProperty('campaigns.leads_without_source_tag');
  });
  it('refuses an unknown distribution vocabulary rather than asserting an untagged zero', async () => {
    const result = await harness({ edit(row, key) { if (key === MARKETING_INTAKE_METRICS.sourceTags) row.values = distribution(['unknown_source', 4]); } }).read();
    expect(headlines(result)).not.toHaveProperty('campaigns.leads_without_source_tag');
  });
  it('refuses wrong scope before any read and membership denial without fabricating a snapshot', async () => {
    const h = harness({ scope: { tenantId: 'foreign' } }); expect((await h.read()).status).toBe('degraded'); expect(h.calls).toEqual([]);
    const denied = await harness({ denied: true }).read(); expect(denied.status).toBe('unavailable'); expect(denied.data).toBeNull();
  });
  it('retires every value after a scope change and does not follow a mutable scope argument into another workspace', async () => {
    const switched = await harness({ switchAt: 2 }).read(); expect(switched.data).toBeNull();
    expect((await harness({ switchAt: 12 }).read()).data).toBeNull();
    const scope = { tenantId: TENANT }; const h = harness({ scope, afterResolve: () => { scope.tenantId = 'foreign'; } });
    expect((await h.read()).data?.headline).toHaveLength(7);
  });
  it('honors cancellation before reads and while the last issuer result settles', async () => {
    const pre = new AbortController(); pre.abort(); const h = harness(); expect((await h.read(pre.signal)).data).toBeNull(); expect(h.calls).toEqual([]);
    const late = new AbortController(); const pending = harness({ afterResolve: key => { if (key === MARKETING_INTAKE_METRICS.processing) late.abort(); } });
    expect((await pending.read(late.signal)).data).toBeNull();
  });
});
