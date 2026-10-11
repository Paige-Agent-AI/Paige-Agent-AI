import { describe, expect, it } from 'vitest';
import canonical from '@/test/fixtures/canonical-task-scorecard.json';
import { parseTaskScorecard, scorecardCoverage } from './taskScorecardContract';
import { summarizeEvaluatorVerdicts } from '../../../supabase/functions/_shared/eval/trajectory-registry';

function consistentSummary(value: typeof canonical.v2) {
  for (const row of value.criteria) {
    const verdicts = value.items.flatMap(i => i.results.filter(r => r.scorer === row.scorer).map(r => r.verdict));
    Object.assign(row, summarizeEvaluatorVerdicts(verdicts as Parameters<typeof summarizeEvaluatorVerdicts>[0]));
  }
}

describe('protected canonical task scorecard metadata boundary', () => {
  it('reads actual local canonical RPC evidence without turning historical verification into current task success', () => {
    const old = parseTaskScorecard(canonical.v1, '1.0.0');
    const next = parseTaskScorecard(canonical.v2, '1.1.0');
    expect(old.items[0].terminal_verified_at_observation).toBe(true);
    expect(canonical.trajectory.items[0].terminal_verified).toBe(false);
    expect(next.sample).toEqual({ evaluations: 2, task_subjects: 1, observations: 1, replays: 1 });
    expect(scorecardCoverage(next)).toEqual({ resolved: 3, denominator: 8, coverage: 3 / 8, unresolved: 5, excluded: 0 });
    expect(next.criteria.find(c => c.scorer === 'approval_decision')?.criterion_pass_rate).toBeNull();
    const replay = next.items.find(i => i.mode === 'replay')!;
    expect(replay.previous_run_ref).toBe(old.items[0].run_ref);
    expect(replay.input_hash).toBe(old.items[0].input_hash);
    expect(replay.run_ref).not.toBe(old.items[0].run_ref);
  });
  it.each(['version', 'definition', 'denominator', 'duplicate', 'missing', 'verdict'])('refuses unsupported or conflicting %s metadata', fault => {
    const value = structuredClone(canonical.v2);
    if (fault === 'version') value.set.version = '1.0.0';
    if (fault === 'definition') value.set.evaluators[0].criterion = 'Assistant prose establishes success';
    if (fault === 'denominator') value.criteria[0].coverage = 1;
    if (fault === 'duplicate') value.items.push(value.items[0]);
    if (fault === 'missing') value.items[0].results.pop();
    if (fault === 'verdict') value.items[0].results[0].verdict = 'success';
    expect(() => parseTaskScorecard(value, '1.1.0')).toThrow();
  });
  it('strips unintended raw fields before returning client metadata', () => {
    const value = { ...canonical.v2, evidence_snapshot: 'PRIVATE' };
    const clean = parseTaskScorecard(value, '1.1.0');
    expect(JSON.stringify(clean)).not.toContain('PRIVATE');
  });
  it('keeps empty rates unavailable', () => {
    const value = { ...canonical.v2, items: [], criteria: [], next_cursor: null,
      sample: { evaluations: 0, task_subjects: 0, observations: 0, replays: 0 } };
    expect(scorecardCoverage(parseTaskScorecard(value, '1.1.0')).coverage).toBeNull();
  });
  it.each(['pass', 'fail', 'not_applicable'] as const)('does not count incomplete evidence as %s despite consistent summaries', verdict => {
    for (const evidence of ['missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable']) {
      const value = structuredClone(canonical.v2);
      Object.assign(value.items[0].results[0], { verdict, evidence });
      consistentSummary(value);
      expect(() => parseTaskScorecard(value, '1.1.0'), evidence).toThrow();
    }
  });
  it.each(['duplicate_within', 'duplicate_across', 'replay_null', 'replay_self', 'observation_parent', 'cursor_id', 'cursor_time'])(
    'rejects inconsistent provenance: %s', fault => {
      const value = { ...structuredClone(canonical.v2), next_cursor: null as { at: string; id: string } | null };
      const replay = value.items.find(i => i.mode === 'replay')!;
      const observation = value.items.find(i => i.mode === 'observation')!;
      if (fault === 'duplicate_within') value.items[0].results[1].result_ref = value.items[0].results[0].result_ref;
      if (fault === 'duplicate_across') value.items[1].results[0].result_ref = value.items[0].results[0].result_ref;
      if (fault === 'replay_null') replay.previous_run_ref = null;
      if (fault === 'replay_self') replay.previous_run_ref = replay.run_ref;
      if (fault === 'observation_parent') observation.previous_run_ref = replay.run_ref;
      const last = value.items.at(-1)!;
      if (fault === 'cursor_id') value.next_cursor = { at: last.created_at, id: canonical.v1.items[0].run_ref };
      if (fault === 'cursor_time') value.next_cursor = { at: '2020-01-01T00:00:00Z', id: last.run_ref };
      expect(() => parseTaskScorecard(value, '1.1.0')).toThrow();
    });
  it.each(['work', 'hash', 'observed_at'])('rejects a conflicting parent inside the returned page: %s', fault => {
    const value = structuredClone(canonical.v2);
    const replay = value.items.find(i => i.mode === 'replay')!;
    const observation = value.items.find(i => i.mode === 'observation')!;
    replay.previous_run_ref = observation.run_ref;
    replay.work_ref = observation.work_ref;
    replay.input_hash = observation.input_hash;
    replay.source_observed_at = observation.source_observed_at;
    if (fault === 'work') { replay.work_ref = '930a2fa9-6acc-46d4-953c-2a7b66265514'; value.sample.task_subjects = 2; }
    if (fault === 'hash') replay.input_hash = '0'.repeat(64);
    if (fault === 'observed_at') replay.source_observed_at = '2020-01-01T00:00:00Z';
    expect(() => parseTaskScorecard(value, '1.1.0')).toThrow();
  });
  it('accepts an anchored cursor and a legitimate replay whose parent is outside the page', () => {
    const value = { ...structuredClone(canonical.v2), next_cursor: null as { at: string; id: string } | null };
    const last = value.items.at(-1)!;
    value.next_cursor = { at: last.created_at, id: last.run_ref };
    const parsed = parseTaskScorecard(value, '1.1.0');
    expect(parsed.next_cursor).toEqual(value.next_cursor);
    expect(parsed.items.some(i => i.run_ref === parsed.items.find(i => i.mode === 'replay')!.previous_run_ref)).toBe(false);
  });
  it.each(['knowledge.extract', 'a'.repeat(129)])('accepts canonical durable-work capability %s', capability => {
    const value = structuredClone(canonical.v2);
    value.items[0].capability = capability;
    expect(parseTaskScorecard(value, '1.1.0').items[0].capability).toBe(capability);
  });
  it.each(['ab', 'a'.repeat(130), 'knowledge.extract.more', 'knowledge-unsafe', 'Knowledge.extract'])(
    'rejects capability outside the canonical grammar: %s', capability => {
      const value = structuredClone(canonical.v2);
      value.items[0].capability = capability;
      expect(() => parseTaskScorecard(value, '1.1.0')).toThrow();
    });
});
