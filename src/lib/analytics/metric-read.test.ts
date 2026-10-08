import { describe, expect, it } from 'vitest';
import { metricReadContext, readBusinessMetric } from '../../../supabase/functions/_shared/analytics-metrics/read.ts';

const tenant = 'a3400000-0000-4000-8000-000000000011';
const now = Date.parse('2026-10-08T12:00:00Z');
const args = { metric_key: 'team.active_members_current', period: 'last_7_days' };
type Fixture = Record<string, unknown> & { coverage: Record<string, unknown> };
function harness(change: (result: Fixture) => void = () => {}, denied = false, switched = false, resolve: (result: Fixture) => void = () => {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  let result: Fixture | undefined;
  let scopes = 0;
  const caller = { rpc: async (name: string, input?: Record<string, unknown>) => {
    calls.push({ name, args: input });
    if (name === 'current_user_tenant_id') return { data: switched && ++scopes > 1 ? 'foreign' : tenant, error: null };
    if (denied) return { data: null, error: { code: '42501', message: 'private denial detail' } };
    if (name === 'issue_analytics_evidence_bundle') {
      if (!input) throw new Error('Fixture issuer requires request arguments');
      result = { metric_key: input.p_metric_key, metric_version: '1.0.0', owner_department: 'people_talent', label: 'Active members', definition: 'Active workspace memberships now.', formula: 'COUNT(active memberships)',
        range: { key: input.p_range_key, start: input.p_range_start, end: input.p_range_end, bounds: '[start,end)', timezone: 'UTC', semantics: 'current_snapshot' }, dimensions: {}, values: { kind: 'count', count: 4 }, unit: 'count', source_refs: ['public.tenant_members'], as_of: new Date(now).toISOString(), freshness: { queried_at: new Date(now).toISOString(), source_updated_through: null }, coverage: { state: 'complete', candidate_count: 4, contributing_count: 4, excluded_count: 0 }, exclusions: [], truth_state: 'LIVE', caveats: [], source_revision_ref: 'sr_v1_' + 'a'.repeat(64), account_epoch: tenant, account_epoch_ref: 'ae_v1_' + 'b'.repeat(64), evidence_ref: 'aneb_v1_' + 'c'.repeat(64), reference_expires_at: new Date(now + 900000).toISOString(), private_payload: 'must not reach model' };
      change(result);
    }
    const returned = structuredClone(result);
    if (name === 'resolve_analytics_evidence_reference' && returned) resolve(returned);
    return { data: returned, error: null };
  } };
  return { calls, run: (input: unknown = args) => readBusinessMetric(caller, { tenantId: tenant }, input, () => now) };
}
describe('governed conversational metric read', () => {
  it('issues and resolves through caller authority and projects closed current-turn evidence', async () => {
    const h = harness(); const result = await h.run();
    expect(result.status).toBe('available');
    expect(h.calls.map(c => c.name)).toEqual(['current_user_tenant_id', 'issue_analytics_evidence_bundle', 'resolve_analytics_evidence_reference', 'current_user_tenant_id']);
    expect(JSON.stringify(result)).not.toContain('private_payload');
    expect(JSON.stringify(result)).not.toContain(tenant);
    expect(result.metric?.truth_state).toBe('LIVE');
  });
  it.each(['tenant_id', 'workspace_id', 'user_id', 'dimensions'])('rejects caller-supplied %s without reading', async key => {
    const h = harness(); expect((await h.run({ ...args, [key]: 'foreign' })).status).toBe('needs_input'); expect(h.calls).toHaveLength(0);
  });
  it('fails closed on membership refusal without exposing internal errors', async () => {
    const h = harness(undefined, true); const result = await h.run(); expect(result.status).toBe('refused'); expect(h.calls).toHaveLength(2); expect(JSON.stringify(result)).not.toContain('private denial');
  });
  it('discards values when active workspace changes during the read', async () => {
    expect((await harness(undefined, false, true).run()).status).toBe('refused');
  });
  it.each(['account_epoch', 'metric_key', 'source_revision_ref'])('rejects mismatched or malformed %s', async field => {
    expect((await harness(r => { r[field] = 'foreign'; }).run()).status).toBe('unavailable');
  });
  it('rejects expired measurements', async () => {
    expect((await harness(r => { r.reference_expires_at = new Date(now).toISOString(); }).run()).status).toBe('unavailable');
  });
  it('preserves unavailable as null, not zero', async () => {
    const result = await harness(r => { r.truth_state = 'UNAVAILABLE'; r.values = null; r.coverage = { state: 'unavailable', candidate_count: 0, contributing_count: 0, excluded_count: 0 }; }).run();
    expect(result.metric?.values).toBeNull(); expect(result.metric?.truth_state).toBe('UNAVAILABLE');
  });
  it('preserves partial coverage and caveats', async () => {
    const result = await harness(r => { r.truth_state = 'PARTIAL'; r.coverage.state = 'partial'; r.caveats = ['Recorded requests only.']; }).run();
    expect(result.metric?.truth_state).toBe('PARTIAL'); expect(result.metric?.caveats).toEqual(['Recorded requests only.']);
  });
  it('does not combine currencies or coerce financial precision', async () => {
    const result = await harness(r => { r.values = { kind: 'currency_totals', by_currency: [{ currency: 'usd', amount_minor: '900719925474099300', record_count: 4 }], breakdown: [] }; }).run();
    expect(JSON.stringify(result.metric?.values)).toContain('900719925474099300');
  });
  it('does not admit changed source identity between issuance and resolution', async () => {
    expect((await harness(undefined, false, false, r => { r.source_revision_ref = 'sr_v1_' + 'd'.repeat(64); }).run()).status).toBe('unavailable');
  });
  it('does not admit a different valid evidence reference', async () => {
    expect((await harness(undefined, false, false, r => { r.evidence_ref = 'aneb_v1_' + 'd'.repeat(64); }).run()).status).toBe('unavailable');
  });
  it('uses exact prior evidence bounds without issuing replacement evidence', async () => {
    const h = harness(); const first = await h.run(); h.calls.length = 0;
    const second = await h.run({ metric_key: args.metric_key, period: 'custom', range_key: first.metric!.range.key, range_start: first.metric!.range.start, range_end: first.metric!.range.end, evidence_ref: first.metric!.evidence_ref });
    expect(second.status).toBe('available'); expect(h.calls.map(c => c.name)).toEqual(['current_user_tenant_id', 'resolve_analytics_evidence_reference', 'current_user_tenant_id']);
  });
  it('refuses naked references and unsupported metrics rather than broadening the request', async () => {
    const h = harness(); expect((await h.run({ ...args, evidence_ref: 'aneb_v1_' + 'c'.repeat(64) })).status).toBe('needs_input');
    expect((await h.run({ metric_key: 'marketing.roas' })).status).toBe('needs_input'); expect(h.calls).toHaveLength(0);
  });
  it('exposes an honest typed source through the existing bounded context contract', async () => {
    expect(metricReadContext(await harness().run()).status).toBe('available');
    expect(metricReadContext({ status: 'refused', message: 'denied' })).toEqual({ status: 'unavailable', reason: 'metric_read_refused', data: null });
    expect(metricReadContext({ status: 'unavailable', message: 'failed' })).toEqual({ status: 'degraded', reason: 'metric_evidence_not_verified', data: null });
  });
  it('projects nested values without producer-added private fields', async () => {
    const result = await harness(r => { r.values = { kind: 'count', count: 4, private_customer: 'NEVER_PROJECT' }; r.coverage.private_customer = 'NEVER_PROJECT'; }).run();
    expect(result.status).toBe('available'); expect(JSON.stringify(result)).not.toContain('NEVER_PROJECT');
  });
  it('bounds current-turn payload size without truncating measurement truth', async () => {
    expect((await harness(r => { r.caveats = Array(20).fill('x'.repeat(1200)); r.definition = 'x'.repeat(1200); r.formula = 'x'.repeat(1200); r.values = { kind: 'distribution', items: Array.from({ length: 100 }, (_, i) => ({ key: String(i), label: 'x'.repeat(120), count: 1 })) }; }).run()).status).toBe('unavailable');
  });
  it('uses the canonical completed UTC day for Sales cohorts and preserves calendar months', async () => {
    const h = harness(r => { r.owner_department = 'sales'; });
    const result = await h.run({ metric_key: 'sales.invoices.issued_count', period: 'this_month' });
    expect(result.metric?.range.start).toBe('2026-10-01T00:00:00.000Z'); expect(result.metric?.range.end).toBe('2026-10-08T00:00:00.000Z');
    const prior = await h.run({ metric_key: 'sales.invoices.issued_count', period: 'last_month' });
    expect(prior.metric?.range.start).toBe('2026-09-01T00:00:00.000Z'); expect(prior.metric?.range.end).toBe('2026-10-01T00:00:00.000Z');
  });
});
