/** Minimum metadata boundary for the protected AI-2 projection. Never an evaluator. */
import { z } from 'zod';
import { resolveTaskEvaluatorSet, summarizeEvaluatorVerdicts, TASK_EVALUATOR_SET_HASH, TASK_EVALUATOR_SET_V2_HASH } from '../../../supabase/functions/_shared/eval/trajectory-registry';

export type TaskSetVersion = '1.0.0' | '1.1.0';
const version = z.enum(['1.0.0', '1.1.0']);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().safe();
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const code = z.string().max(100).regex(/^[a-z][a-z0-9_]*$/);
// Existing durable-work grammar, not a new capability catalogue.
const capability = z.string().min(3).max(129).regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/);
const criterion = z.object({ id: code, version: z.literal('1.0.0'), kind: z.literal('deterministic'),
  applicability: z.array(z.string()), required_evidence: z.array(z.string()), criterion: z.string(),
  failure: z.string(), indeterminate: z.string(), not_applicable: z.string() });
const result = z.object({ result_ref: uuid, scorer: code, version: z.literal('1.0.0'),
  verdict: z.enum(['pass', 'fail', 'indeterminate', 'not_applicable']),
  evidence: z.enum(['complete', 'missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable']), reason: code });
const item = z.object({ run_ref: uuid, work_ref: uuid, source_available: z.boolean(), mode: z.enum(['observation', 'replay']),
  created_at: timestamp, source_observed_at: timestamp, input_hash: hash, previous_run_ref: uuid.nullable(),
  work_version: count.nullable(), attempt: count.nullable(), category: code.nullable(), capability: capability.nullable(),
  recorded_state: code.nullable(), terminal_condition: z.enum(['artifact', 'read_only', 'unavailable']).nullable(),
  terminal_verified_at_observation: z.boolean().nullable(),
  participants: z.array(z.object({ trace_ref: uuid, agent_ref: z.string().max(200),
    roster_version_at_observation: count, execution_agent_version: z.literal('unavailable') })).max(100),
  unassigned_model_calls: count.nullable(), results: z.array(result).max(4) });
const rate = z.number().min(0).max(1).nullable();
const summary = z.object({ scorer: code, version: z.literal('1.0.0'), total: count, pass: count, fail: count,
  indeterminate: count, not_applicable: count, resolved: count, coverage_denominator: count, coverage: rate, criterion_pass_rate: rate });
const page = z.object({ contract_version: z.literal(1), observed_at: timestamp,
  set: z.object({ id: z.literal('durable-task-evidence'), version, hash, evaluators: z.array(criterion).max(4) }),
  versions: z.array(z.object({ id: z.literal('durable-task-evidence'), version, hash })).max(2),
  items: z.array(item).max(25), next_cursor: z.object({ at: timestamp, id: uuid }).nullable(),
  sample: z.object({ evaluations: count, task_subjects: count, observations: count, replays: count }),
  criteria: z.array(summary).max(4), coverage_basis: z.literal('returned_evaluations_including_explicit_historical_replays'),
  attribution_basis: z.literal('recorded_model_participants_not_task_ownership'), source_consistency: z.literal('bounded_double_read_not_atomic') });
export type TaskScorecardPage = z.infer<typeof page>;
export type TaskEvaluation = TaskScorecardPage['items'][number];
export type TaskScorecardCursor = TaskScorecardPage['next_cursor'];
export type EvaluateTaskRequest = { version: TaskSetVersion } & ({ workId: string; replayRunId?: never } | { replayRunId: string; workId?: never });
export const criterionNames: Record<string, string> = { terminal_evidence: 'Terminal evidence', trajectory_capture: 'Trajectory capture',
  approval_decision: 'Approval decision', model_call_status: 'Recorded model-call status' };
const expectedHash = (value: TaskSetVersion) => value === '1.0.0' ? TASK_EVALUATOR_SET_HASH : TASK_EVALUATOR_SET_V2_HASH;

/** Reject unsupported/mismatched identities or denominator drift; strip unrequested fields. */
export function parseTaskScorecard(value: unknown, requestedVersion: TaskSetVersion): TaskScorecardPage {
  const parsed = page.parse(value);
  if (parsed.set.version !== requestedVersion || parsed.set.hash !== expectedHash(requestedVersion)) throw new Error('Unsupported scorecard identity');
  const definition = resolveTaskEvaluatorSet(parsed.set.id, requestedVersion);
  if (parsed.set.evaluators.length !== definition.evaluators.length || parsed.set.evaluators.some((found, index) => {
    const expected = definition.evaluators[index];
    return Object.keys(expected).some(key => JSON.stringify(found[key as keyof typeof found]) !== JSON.stringify(expected[key as keyof typeof expected]));
  })) throw new Error('Unsupported criterion definition');
  if (parsed.versions.length !== 2 || new Set(parsed.versions.map(v => v.version)).size !== 2 ||
    parsed.versions.some(v => v.hash !== expectedHash(v.version))) throw new Error('Unsupported registry versions');
  if (new Set(parsed.items.map(i => i.run_ref)).size !== parsed.items.length || parsed.items.some(i =>
    i.results.length !== definition.evaluators.length || new Set(i.results.map(r => r.scorer)).size !== i.results.length ||
    i.results.some(r => !definition.evaluators.some(c => c.id === r.scorer && c.version === r.version)))) throw new Error('Incomplete scorecard criteria');
  const results = parsed.items.flatMap(i => i.results);
  if (new Set(results.map(r => r.result_ref)).size !== results.length ||
    results.some(r => r.verdict !== 'indeterminate' && r.evidence !== 'complete'))
    throw new Error('Invalid scorecard result evidence');
  for (const evaluation of parsed.items) {
    if (evaluation.mode === 'observation' ? evaluation.previous_run_ref !== null :
      evaluation.previous_run_ref === null || evaluation.previous_run_ref === evaluation.run_ref)
      throw new Error('Invalid evaluation lineage');
    // A valid historical parent can be outside this versioned, bounded page.
    const parent = parsed.items.find(i => i.run_ref === evaluation.previous_run_ref);
    if (parent && (parent.work_ref !== evaluation.work_ref || parent.input_hash !== evaluation.input_hash ||
      parent.source_observed_at !== evaluation.source_observed_at)) throw new Error('Conflicting evaluation lineage');
  }
  const last = parsed.items.at(-1);
  if (parsed.next_cursor && (!last || parsed.next_cursor.id !== last.run_ref || parsed.next_cursor.at !== last.created_at))
    throw new Error('Unanchored scorecard cursor');
  const observed = parsed.items.filter(i => i.mode === 'observation').length;
  if (parsed.sample.evaluations !== parsed.items.length || parsed.sample.task_subjects !== new Set(parsed.items.map(i => i.work_ref)).size ||
    parsed.sample.observations !== observed || parsed.sample.replays !== parsed.items.length - observed) throw new Error('Invalid scorecard sample');
  if (parsed.criteria.length !== (parsed.items.length ? definition.evaluators.length : 0) || new Set(parsed.criteria.map(c => c.scorer)).size !== parsed.criteria.length)
    throw new Error('Incomplete scorecard summary');
  for (const row of parsed.criteria) {
    const verdicts = parsed.items.flatMap(i => i.results.filter(r => r.scorer === row.scorer).map(r => r.verdict));
    const totals = summarizeEvaluatorVerdicts(verdicts);
    if (!definition.evaluators.some(c => c.id === row.scorer) || row.total !== verdicts.length || row.pass !== totals.pass || row.fail !== totals.fail ||
      row.indeterminate !== totals.indeterminate || row.not_applicable !== totals.not_applicable || row.resolved !== row.pass + row.fail ||
      row.coverage_denominator !== row.total - row.not_applicable || row.coverage !== totals.coverage || row.criterion_pass_rate !== totals.criterion_pass_rate)
      throw new Error('Invalid scorecard denominator');
  }
  return parsed;
}

export function scorecardCoverage(data: TaskScorecardPage) {
  const resolved = data.criteria.reduce((sum, row) => sum + row.resolved, 0);
  const denominator = data.criteria.reduce((sum, row) => sum + row.coverage_denominator, 0);
  return { resolved, denominator, coverage: denominator ? resolved / denominator : null,
    unresolved: data.criteria.reduce((sum, row) => sum + row.indeterminate, 0), excluded: data.criteria.reduce((sum, row) => sum + row.not_applicable, 0) };
}
