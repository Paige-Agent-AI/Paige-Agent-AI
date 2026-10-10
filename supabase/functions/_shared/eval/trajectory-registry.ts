/** INT-280 AI-2A. Immutable definitions in the existing Eval subsystem.
 * Observation only: these rules neither establish source truth nor grant authority.
 * A protected server reader must prove applicability, scope and source completeness.
 * Never accept a client-supplied 'canonical' flag, manifest, verdict or task identity.
 */
export type EvaluatorVerdict = 'pass' | 'fail' | 'indeterminate' | 'not_applicable';
export type EvaluatorApplicability = 'applicable' | 'not_applicable' | 'unknown';
export type EvaluatorEvidenceState = 'complete' | 'missing' | 'stale' | 'partial' | 'conflicting' | 'unrelated' | 'unavailable';
export type EvaluatorCondition = 'met' | 'not_met' | 'unknown';

function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child);
  }
  return Object.freeze(value);
}

/** Do not edit released definition bytes. Add a distinct version instead.
 * Hash: SHA-256 of UTF-8 JSON.stringify of this manifest, in declared property order.
 * A set version identifies every criterion, required evidence and applicability rule.
 */
export const TASK_EVALUATOR_SET = freeze({
  id: 'durable-task-evidence',
  version: '1.0.0',
  trajectory_contract_version: 1,
  authority: 'observe_only',
  evaluators: [
    {
      id: 'terminal_evidence', version: '1.0.0', kind: 'deterministic',
      applicability: ['document_generate:document_authoring', 'deep_research:research'],
      required_evidence: ['scoped_work', 'current_work_version', 'current_attempt_receipt', 'canonical_destination_readback'],
      criterion: 'The recorded terminal condition is independently verified for the current attempt. Artifact creation and read-only research do not establish downstream business impact.',
      failure: 'Canonical supported work is failed or cancelled, or its complete current-attempt evidence proves the terminal condition was not met.',
      indeterminate: 'Nonterminal, missing, stale, partial, disputed or unsupported evidence never establishes successful completion.',
      not_applicable: 'The server proves the capability and category are outside this definition. Missing identity is indeterminate.',
    },
    {
      id: 'trajectory_capture', version: '1.0.0', kind: 'deterministic',
      applicability: ['scoped_durable_work:trajectory_contract_v1'],
      required_evidence: ['scoped_work', 'current_work_version', 'canonical_history', 'source_limits'],
      criterion: 'The canonical history records initiation through the observed current work version, is complete and untruncated, and source reference limits were not reached.',
      failure: 'Complete canonical evidence proves an internally inconsistent history or source scope.',
      indeterminate: 'Missing or truncated history, partial source pages, unrecognized versions and unresolved source relationships remain indeterminate.',
      not_applicable: 'No exclusion for a scoped version-1 durable task. Unknown task identity is indeterminate.',
    },
    {
      id: 'approval_decision', version: '1.0.0', kind: 'deterministic',
      applicability: ['server_proven_approval_requirement'],
      required_evidence: ['scoped_work', 'current_work_version', 'approval_requirement', 'canonical_approval_decision', 'execution_approval_link'],
      criterion: 'The actual linked approval decision and subsequent execution comply with the existing canonical requirement. Requested approval or provider acceptance is insufficient.',
      failure: 'Complete canonical evidence proves execution despite a denied, expired or missing required approval.',
      indeterminate: 'Absent universal requirement/attempt linkage, pending decisions or incomplete approval evidence remain indeterminate; absence does not imply no approval was required.',
      not_applicable: 'Only an explicit server-proven existing policy result that approval was not required permits exclusion.',
    },
  ],
} as const);

export const TASK_EVALUATOR_SET_HASH = '544cbea0003813658b179144833d1863c1150ad01694cccbefb6cee3ac61b05c';

/** No dynamic registration, mutable aliases or caller-defined criteria. */
export function resolveTaskEvaluatorSet(id: string, version: string) {
  if (id !== TASK_EVALUATOR_SET.id || version !== TASK_EVALUATOR_SET.version) {
    throw new Error('unsupported_evaluator_set');
  }
  return TASK_EVALUATOR_SET;
}

/** Pure verdict semantics, not a database validator or execution-success assertion.
 * Not-applicable needs complete evidence for the applicability decision itself.
 * A failure may be known from a canonical failure record even when optional sources
 * are missing; that record must be complete for the criterion being evaluated.
 */
export function evaluatorVerdict(
  applicability: EvaluatorApplicability, evidence: EvaluatorEvidenceState, condition: EvaluatorCondition,
): EvaluatorVerdict {
  if (!['applicable', 'not_applicable', 'unknown'].includes(applicability)) throw new Error('invalid_evaluator_applicability');
  if (!['complete', 'missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable'].includes(evidence)) throw new Error('invalid_evaluator_evidence');
  if (!['met', 'not_met', 'unknown'].includes(condition)) throw new Error('invalid_evaluator_condition');
  if (evidence !== 'complete' || applicability === 'unknown') return 'indeterminate';
  if (applicability === 'not_applicable') return 'not_applicable';
  return condition === 'met' ? 'pass' : condition === 'not_met' ? 'fail' : 'indeterminate';
}

/** Criterion rates are not agent health or task/business completion rates.
 * Indeterminate stays in the coverage denominator. Proven exclusions are visible.
 */
export function summarizeEvaluatorVerdicts(verdicts: readonly EvaluatorVerdict[]) {
  const counts = { total: verdicts.length, pass: 0, fail: 0, indeterminate: 0, not_applicable: 0 };
  for (const verdict of verdicts) {
    if (!['pass', 'fail', 'indeterminate', 'not_applicable'].includes(verdict)) throw new Error('invalid_evaluator_verdict');
    counts[verdict]++;
  }
  const resolved = counts.pass + counts.fail;
  const denominator = counts.total - counts.not_applicable;
  return {
    ...counts, resolved, coverage_denominator: denominator,
    coverage: denominator ? resolved / denominator : null,
    criterion_pass_rate: resolved ? counts.pass / resolved : null,
  };
}
