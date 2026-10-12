import { continuationObject, projectDurableContinuation, type ContinuationInput, type ContinuationProjection } from './continuation.ts';

export interface ResearchContinuationInput extends Omit<ContinuationInput, 'canonicalObjective'> {
  /** Actual canonical research_runs row, including its nullable envelope link. */
  run: Record<string, unknown> | null;
  /** Canonical research_sources rows, not sources proposed in a model response. */
  sources: readonly Record<string, unknown>[];
}
export interface ResearchContinuationProjection extends Omit<ContinuationProjection, 'reason'> {
  reason: ContinuationProjection['reason'] | 'research_binding_mismatch' | 'research_result_unavailable' | 'research_sources_unverified';
  runId?: string;
  findingCount?: number;
}

/** C4e foundation only: research_runs already has work_id, but the current research
 * producer does not populate it. Such runs remain unavailable here. No historical
 * ownership inference, new work, research execution, store or consumer is introduced.
 * This is citation lineage validation, not independent verification of a claim. */
export function projectResearchContinuation(input: ResearchContinuationInput): ResearchContinuationProjection {
  const deny = (reason: ResearchContinuationProjection['reason']): ResearchContinuationProjection => ({ eligibleForContext: false, state: 'unavailable', reason });
  if (!continuationObject(input?.run) || !continuationObject(input?.binding)) return deny('canonical_unavailable');
  const run = input.run;
  const binding = input.binding;
  if (typeof run.id !== 'string' || !run.id.trim() || run.work_id !== binding.workId || run.tenant_id !== binding.tenantId || run.user_id !== binding.actorId || run.question !== binding.originalObjective) return deny('research_binding_mismatch');
  const base = projectDurableContinuation({ ...input, canonicalObjective: typeof run.question === 'string' ? run.question : '' });
  if (!base.eligibleForContext) return base;
  // A canonical failed job may be explained as failure but never supplies research findings.
  if (base.state !== 'succeeded') return { ...base, runId: run.id };
  const outcome = input.work?.terminal_outcome;
  if (!continuationObject(outcome) || outcome.run_id !== run.id) return deny('research_binding_mismatch');
  if (run.configured !== true || run.stop_reason !== 'answered' || !continuationObject(run.coverage) || run.coverage.configured !== true || run.coverage.stop_reason !== 'answered' || !Array.isArray(run.findings) || !run.findings.length) return deny('research_result_unavailable');
  if (!Array.isArray(input.sources) || !input.sources.length) return deny('research_sources_unverified');
  const indices = new Set<number>();
  const seenIndices = new Set<number>();
  for (const source of input.sources) {
    if (!continuationObject(source) || source.run_id !== run.id || source.tenant_id !== binding.tenantId || source.user_id !== binding.actorId || typeof source.source_index !== 'number' || !Number.isInteger(source.source_index) || source.source_index < 1 || seenIndices.has(source.source_index)) return deny('research_sources_unverified');
    seenIndices.add(source.source_index);
    if (source.excluded === false && typeof source.url === 'string' && /^https?:\/\//.test(source.url)) indices.add(source.source_index);
  }
  for (const finding of run.findings) {
    if (!continuationObject(finding) || typeof finding.text !== 'string' || !finding.text.trim() || !Array.isArray(finding.citations) || !finding.citations.length || finding.citations.some(citation => typeof citation !== 'number' || !indices.has(citation))) return deny('research_sources_unverified');
  }
  return { ...base, runId: run.id, findingCount: run.findings.length };
}
