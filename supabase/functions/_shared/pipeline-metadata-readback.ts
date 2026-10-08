import { classifyPipelineMetadataReadback, type PipelineMetadataRequest } from './pipeline-metadata-reconciliation.ts';
export interface PipelineReadbackBinding { threadId: string; intentId: string; effectId: string; tenantId: string; actorId: string }
export interface PipelineReadbackDependencies {
  /** Server authority resolver; must verify protected original-intent/effect lineage. */
  resolveOriginal(binding: PipelineReadbackBinding): Promise<PipelineMetadataRequest | null>;
  /** Re-resolve authenticated caller, active tenant and original scope each time. */
  scopeHolds(binding: PipelineReadbackBinding): Promise<boolean>;
  readOperation(request: PipelineMetadataRequest): Promise<unknown>;
  getPipelineCatalogue(tenantId: string): Promise<unknown>;
}
/** This adapter never issues a mutation, correction receipt, or executor release.
 * The authority resolver is a server dependency, never a request-body callback.
 * Sequential reads are conservative: an unexplained version race stays unknown. */
export async function readPipelineMetadataOutcome(binding: PipelineReadbackBinding, deps: PipelineReadbackDependencies) {
  const unknown = () => ({ outcome: 'outcome_unknown' as const, verified_readback: false as const });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const scope = Object.freeze({ ...binding });
    if (![scope.threadId, scope.intentId, scope.effectId, scope.tenantId, scope.actorId].every(v => typeof v === 'string' && UUID.test(v))) return unknown();
    if (await deps.scopeHolds(scope) !== true) return unknown();
    const original = await deps.resolveOriginal(scope);
    if (!original || original.tenantId !== scope.tenantId || original.actorId !== scope.actorId) return unknown();
    // Keep operation identity stable across awaited reads even if another consumer
    // mutates the resolver's object. PostgreSQL-derived hash remains server-owned.
    const request = Object.freeze({ ...original, command: Object.freeze(structuredClone(original.command)) });
    if (await deps.scopeHolds(scope) !== true) return unknown();
    const receipt = structuredClone(await deps.readOperation(request));
    const catalogue = structuredClone(await deps.getPipelineCatalogue(scope.tenantId));
    if (await deps.scopeHolds(scope) !== true) return unknown();
    const currentOriginal = await deps.resolveOriginal(scope);
    if (!currentOriginal || currentOriginal.tenantId !== request.tenantId ||
        currentOriginal.actorId !== request.actorId || currentOriginal.actorKind !== request.actorKind ||
        currentOriginal.idempotencyKey !== request.idempotencyKey || currentOriginal.commandHash !== request.commandHash ||
        JSON.stringify(currentOriginal.command) !== JSON.stringify(request.command)) return unknown();
    return classifyPipelineMetadataReadback(request, { tenantId: scope.tenantId, receipt, catalogue });
  } catch { return unknown(); }
}
