import { describe, expect, it } from 'vitest';
import { projectResearchContinuation } from '../../supabase/functions/_shared/durable-job/research-continuation';
const fixture = () => ({
  work: { id: 'work', tenant_id: 'test-tenant-a', initiating_user_id: 'actor', thread_id: 'thread', intent_id: 'intent', scope_epoch: 'epoch', capability_key: 'research.run', work_kind: 'research', status: 'succeeded', settled_at: '2026-10-08T12:00:00Z', terminal_outcome: { verified_readback: true, run_id: 'run' } },
  binding: { workId: 'work', tenantId: 'test-tenant-a', actorId: 'actor', threadId: 'thread', intentId: 'intent', scopeEpoch: 'epoch', capabilityKey: 'research.run', workKind: 'research', originalObjective: 'Research the original question' },
  context: { authorized: true, budgetAllowed: true, capabilityAvailable: true, approvalPending: false, interrupted: false, superseded: false, alreadyContinued: false }, now: '2026-10-08T13:00:00Z',
  run: { id: 'run', work_id: 'work', tenant_id: 'test-tenant-a', user_id: 'actor', question: 'Research the original question', configured: true, stop_reason: 'answered', findings: [{ text: 'A cited fact', citations: [1] }], coverage: { configured: true, stop_reason: 'answered' } },
  sources: [{ run_id: 'run', tenant_id: 'test-tenant-a', user_id: 'actor', source_index: 1, excluded: false, url: 'https://example.com/source' }],
});
describe('read-only research continuation foundation', () => {
  it('allows bounded context from a cited canonical result on the same work', () => {
    const input=fixture(); const before=JSON.stringify(input);
    expect(projectResearchContinuation(input)).toEqual({ eligibleForContext: true, state: 'succeeded', reason: 'canonical_terminal', workId: 'work', runId: 'run', findingCount: 1 });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(['work_id','tenant_id','user_id','question','id'])('refuses changed run %s', key => {
    const input=fixture(); (input.run as Record<string,unknown>)[key]='changed'; expect(projectResearchContinuation(input).eligibleForContext).toBe(false);
  });
  it('keeps legacy runs without envelope adoption unavailable', () => {
    expect(projectResearchContinuation({ ...fixture(), run: { ...fixture().run, work_id: null } }).eligibleForContext).toBe(false);
  });
  it.each(['error','unconfigured','no_results','budget','wall_clock','max_hops'])('does not promote %s to answered', stop_reason => {
    expect(projectResearchContinuation({ ...fixture(), run: { ...fixture().run, stop_reason } }).eligibleForContext).toBe(false);
  });
  it('requires scoped, nonexcluded canonical citations', () => {
    for(const source of [{ ...fixture().sources[0], excluded: true }, { ...fixture().sources[0], tenant_id: 'test-tenant-b' }, { ...fixture().sources[0], run_id: 'other' }, { ...fixture().sources[0], user_id: 'other' }]) expect(projectResearchContinuation({ ...fixture(), sources: [source] }).eligibleForContext).toBe(false);
    expect(projectResearchContinuation({ ...fixture(), sources: [] }).eligibleForContext).toBe(false);
  });
  it.each(['excluded-first', 'included-first'])('rejects ambiguous duplicate indices in %s order', order => {
    const input = fixture();
    const included = input.sources[0];
    const excluded = { ...included, excluded: true };
    const sources = order === 'excluded-first' ? [excluded, included] : [included, excluded];
    expect(projectResearchContinuation({ ...input, sources }).eligibleForContext).toBe(false);
  });
  it('rejects missing findings, fabricated citations and unavailable configuration', () => {
    for (const run of [{ ...fixture().run, findings: [] }, { ...fixture().run, findings: [{text:'fake',citations:[99]}] }, { ...fixture().run, configured: false }]) expect(projectResearchContinuation({ ...fixture(), run }).eligibleForContext).toBe(false);
  });
  it('reuses budget, approval, interruption and replay guards', () => {
    for(const context of [{ ...fixture().context, budgetAllowed:false }, { ...fixture().context, approvalPending:true }, { ...fixture().context, alreadyContinued:true }, { ...fixture().context, interrupted:true }, { ...fixture().context, authorized:false }, { ...fixture().context, superseded:true }]) expect(projectResearchContinuation({ ...fixture(), context }).eligibleForContext).toBe(false);
  });
});
