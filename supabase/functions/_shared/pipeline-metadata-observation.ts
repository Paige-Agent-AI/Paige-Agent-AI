import { classifyPipelineObservation } from './pipeline-metadata-reconciliation.ts';

/** The caller-held identity of the original effect whose non-application is being read.
 *  Same shape as the readback binding: every field here is JWT/thread-derived context the
 *  caller already proved, never request-body data. */
export interface PipelineObservationReadBinding {
  threadId: string;
  intentId: string;
  effectId: string;
  tenantId: string;
  actorId: string;
}

export interface PipelineObservationDependencies {
  /** Re-resolves authenticated caller, active tenant and owned-thread scope. */
  scopeHolds(binding: PipelineObservationReadBinding): Promise<boolean>;
  /** Calls the lineage-validating SQL reader (`read_pipeline_metadata_observation`).
   *  The RPC re-derives the effect through discovery + the original resolver and returns
   *  classifier-shaped evidence only for an exactly-matching record; null otherwise. */
  resolveObservation(binding: PipelineObservationReadBinding): Promise<unknown>;
}

/** Read-only non-application observation. Mirrors the readback adapter's discipline:
 *  scope revalidated before and after the awaited read; any failure, missing record or
 *  shape drift stays outcome_unknown. This adapter never mutates, settles, retries or
 *  releases anything, and an observation it returns is an OBSERVATION — never permission
 *  to re-run the act (the successor-write brake stays controlling).
 *
 *  The classifier binding needs a scopeEpoch. Its only truthful source is the consumed
 *  card's issued_in_request, which the SQL reader derived on BOTH sides (the record's
 *  scope_epoch and the returned binding) — so this adapter takes it from the returned
 *  evidence, making that one comparison tautological BY DESIGN while the five
 *  caller-known fields carry the real cross-check. Stated here so nobody mistakes it for
 *  an accident; the RPC's own lineage validation is the authority behind it. */
export async function readPipelineNonApplicationOutcome(
  binding: PipelineObservationReadBinding,
  deps: PipelineObservationDependencies,
): Promise<{ outcome: string; verified_readback: boolean }> {
  const unknown = () => ({ outcome: 'outcome_unknown' as const, verified_readback: false as const });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const scope = Object.freeze({ ...binding });
    if (![scope.threadId, scope.intentId, scope.effectId, scope.tenantId, scope.actorId]
      .every((v) => typeof v === 'string' && UUID.test(v))) return unknown();
    if (await deps.scopeHolds(scope) !== true) return unknown();
    const evidence = await deps.resolveObservation(scope);
    if (await deps.scopeHolds(scope) !== true) return unknown();
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return unknown();
    const observedBinding = (evidence as Record<string, unknown>).binding;
    if (!observedBinding || typeof observedBinding !== 'object' || Array.isArray(observedBinding)
      || typeof (observedBinding as Record<string, unknown>).scopeEpoch !== 'string') return unknown();
    const callerBinding = {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      threadId: scope.threadId,
      intentId: scope.intentId,
      operationId: scope.effectId,
      scopeEpoch: (observedBinding as Record<string, string>).scopeEpoch,
    };
    return classifyPipelineObservation(callerBinding, evidence);
  } catch {
    return unknown();
  }
}
