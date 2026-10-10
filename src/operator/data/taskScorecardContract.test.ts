import { describe, expect, it } from 'vitest';
import canonical from '@/test/fixtures/canonical-task-scorecard.json';
import { parseTaskScorecard, scorecardCoverage } from './taskScorecardContract';

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
});
