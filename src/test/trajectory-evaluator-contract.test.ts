import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  TASK_EVALUATOR_SET, TASK_EVALUATOR_SET_HASH, evaluatorVerdict,
  resolveTaskEvaluatorSet, summarizeEvaluatorVerdicts,
  TASK_EVALUATOR_SET_V2, TASK_EVALUATOR_SET_V2_HASH,
} from '../../supabase/functions/_shared/eval/trajectory-registry';

describe('INT-280 AI-2A immutable task evaluator contract', () => {
  it('resolves only the declared immutable identity and version', () => {
    expect(resolveTaskEvaluatorSet('durable-task-evidence', '1.0.0')).toBe(TASK_EVALUATOR_SET);
    expect(() => resolveTaskEvaluatorSet('durable-task-evidence', 'latest')).toThrow('unsupported_evaluator_set');
    expect(() => resolveTaskEvaluatorSet('output-scorers', '1.0.0')).toThrow('unsupported_evaluator_set');
  });

  it('pins the definition bytes independently of the registry version label', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(TASK_EVALUATOR_SET));
    const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(TASK_EVALUATOR_SET_HASH);
    // A future change to criteria, evidence or applicability requires a new immutable version.
    expect(TASK_EVALUATOR_SET_HASH).toBe('544cbea0003813658b179144833d1863c1150ad01694cccbefb6cee3ac61b05c');
  });

  it('registers a separate version without changing the released v1 definition', async () => {
    expect(resolveTaskEvaluatorSet('durable-task-evidence', '1.1.0')).toBe(TASK_EVALUATOR_SET_V2);
    expect(TASK_EVALUATOR_SET_V2.evaluators.map(e => e.id)).toEqual([
      'terminal_evidence', 'trajectory_capture', 'approval_decision', 'model_call_status',
    ]);
    const digest = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(TASK_EVALUATOR_SET_V2)))))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(TASK_EVALUATOR_SET_V2_HASH);
    expect(digest).not.toBe(TASK_EVALUATOR_SET_HASH);
    expect(Object.isFrozen(TASK_EVALUATOR_SET_V2.evaluators[3])).toBe(true);
  });

  it('deploys the exact reviewed version/hash/definition bytes to the protected registry', () => {
    const sql = readFileSync('supabase/migrations/20270602000424_int280_task_evaluations.sql', 'utf8');
    const seeds = [...sql.matchAll(/\$manifest\$(.*?)\$manifest\$/g)].map(m => m[1]);
    expect(seeds).toEqual([JSON.stringify(TASK_EVALUATOR_SET), JSON.stringify(TASK_EVALUATOR_SET_V2)]);
    expect(sql).toContain(TASK_EVALUATOR_SET_HASH);
    expect(sql).toContain(TASK_EVALUATOR_SET_V2_HASH);
  });

  it('freezes definitions, applicability and evidence requirements recursively', () => {
    expect(Object.isFrozen(TASK_EVALUATOR_SET)).toBe(true);
    expect(Object.isFrozen(TASK_EVALUATOR_SET.evaluators)).toBe(true);
    for (const definition of TASK_EVALUATOR_SET.evaluators) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.required_evidence)).toBe(true);
      expect(Object.isFrozen(definition.applicability)).toBe(true);
      expect(definition.kind).toBe('deterministic');
    }
    expect(() => { (TASK_EVALUATOR_SET as { version: string }).version = 'changed'; }).toThrow();
    expect(() => (TASK_EVALUATOR_SET.evaluators[0].required_evidence as unknown as string[]).push('narration')).toThrow();
  });

  it.each(['missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable'] as const)('never turns %s evidence into a pass or an exclusion', evidence => {
    for (const condition of ['met', 'not_met', 'unknown'] as const) {
      expect(evaluatorVerdict('applicable', evidence, condition)).toBe('indeterminate');
      expect(evaluatorVerdict('not_applicable', evidence, condition)).toBe('indeterminate');
    }
  });

  it('requires a known applicable criterion and complete evidence for pass or failure', () => {
    expect(evaluatorVerdict('applicable', 'complete', 'met')).toBe('pass');
    expect(evaluatorVerdict('applicable', 'complete', 'not_met')).toBe('fail');
    expect(evaluatorVerdict('applicable', 'complete', 'unknown')).toBe('indeterminate');
    expect(evaluatorVerdict('unknown', 'complete', 'met')).toBe('indeterminate');
    expect(evaluatorVerdict('not_applicable', 'complete', 'unknown')).toBe('not_applicable');
  });

  it('does not grant business execution authority or accept narration as evidence', () => {
    const required = TASK_EVALUATOR_SET.evaluators.flatMap(e => e.required_evidence);
    expect(required).not.toContain('model_response');
    expect(required).not.toContain('assistant_narration');
    expect(TASK_EVALUATOR_SET.authority).toBe('observe_only');
    expect(TASK_EVALUATOR_SET.evaluators.map(e => e.id)).toEqual([
      'terminal_evidence', 'trajectory_capture', 'approval_decision',
    ]);
  });

  it('keeps indeterminate and not-applicable denominators visible', () => {
    expect(summarizeEvaluatorVerdicts(['pass', 'fail', 'indeterminate', 'not_applicable'])).toEqual({
      total: 4, pass: 1, fail: 1, indeterminate: 1, not_applicable: 1,
      resolved: 2, coverage_denominator: 3, coverage: 2 / 3, criterion_pass_rate: 0.5,
    });
  });

  it.each([{ values: [] }, { values: ['not_applicable'] }, { values: ['indeterminate'] }] as const)('does not manufacture a pass rate when no criterion was resolved: $values', ({ values }) => {
    expect(summarizeEvaluatorVerdicts(values).criterion_pass_rate).toBeNull();
  });
  it('rejects invalid runtime enums rather than hiding unrecognized results', () => {
    expect(() => summarizeEvaluatorVerdicts(['success' as never])).toThrow('invalid_evaluator_verdict');
    expect(() => evaluatorVerdict('applicable', 'complete', 'success' as never)).toThrow('invalid_evaluator_condition');
    expect(() => evaluatorVerdict('unrelated' as never, 'complete', 'met')).toThrow('invalid_evaluator_applicability');
    expect(() => evaluatorVerdict('applicable', 'verified' as never, 'met')).toThrow('invalid_evaluator_evidence');
  });
});
