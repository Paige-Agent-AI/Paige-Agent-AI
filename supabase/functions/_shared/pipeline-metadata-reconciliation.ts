/** Pipeline-owned classification of an exact metadata operation. This module
 * performs no mutation and grants no execution or receipt-settlement authority.
 * Inputs must come from the canonical, scoped server read path. */
export interface PipelineMetadataRequest {
  tenantId: string;
  actorId: string;
  actorKind: 'human' | 'paige';
  idempotencyKey: string;
  /** PostgreSQL md5(command::jsonb::text), derived on the server. */
  commandHash: string;
  command: Record<string, unknown>;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Match PostgreSQL btrim(text)'s default space trimming, not JavaScript's broader trim.
const btrim = (value: string) => value.replace(/^ +| +$/g, '');
const unknown = () => ({ outcome: 'outcome_unknown' as const, verified_readback: false as const });

export interface PipelineObservationBinding {
  tenantId: string;
  actorId: string;
  threadId: string;
  intentId: string;
  operationId: string;
  scopeEpoch: string;
}

/** Pure internal projection, never an authentication or receipt-verification API.
 * A future canonical server reader must establish provenance before supplying an
 * observation. Client JSON (including `authoritative: true`) establishes none.
 * The metadata writer currently persists success only: absent receipts, thrown
 * errors and unchanged rows cannot supply failed_not_applied observations.
 * Refusal/non-application must come from a protected pre-dispatch or explicit
 * provider non-application record, with the complete original binding.
 * This result has no settlement, retry, lock-release or dispatch authority. */
export function classifyPipelineObservation(binding: PipelineObservationBinding, evidence: unknown) {
  const read = object(evidence);
  const observedBinding = object(read?.binding);
  if (!binding || !observedBinding || read?.authoritative !== true ||
      read.effect !== 'none' || read.conflicting === true) return unknown();
  const fields = ['tenantId', 'actorId', 'threadId', 'intentId', 'operationId', 'scopeEpoch'] as const;
  if (fields.some(field => typeof binding[field] !== 'string' || !binding[field].trim() ||
      observedBinding[field] !== binding[field])) return unknown();
  if (read.kind === 'refused_before_dispatch') {
    return { outcome: 'refused_before_dispatch' as const, verified_readback: true as const };
  }
  if (read.kind === 'failed_not_applied') {
    return { outcome: 'confirmed_failure' as const, verified_readback: true as const };
  }
  return unknown();
}

/** No receipt, timeout, absence or newer version can prove non-execution.
 * A matching atomic operation receipt plus exact current canonical readback is
 * the conservative success contract. Historical success with intervening changes
 * requires a separate Pipeline-owned lineage contract. */
export function classifyPipelineMetadataReadback(request: PipelineMetadataRequest, evidence: unknown) {
  const command = object(request?.command);
  const read = object(evidence);
  const receipt = object(read?.receipt);
  const result = object(receipt?.result);
  const catalogue = object(read?.catalogue);
  if (!command || !UUID.test(request.tenantId) || !UUID.test(request.actorId) ||
      !['human', 'paige'].includes(request.actorKind) || !request.idempotencyKey ||
      !/^[0-9a-f]{32}$/.test(request.commandHash) ||
      command.type !== 'update-pipeline' || typeof command.pipelineId !== 'string' ||
      !UUID.test(command.pipelineId) || typeof command.name !== 'string' || !btrim(command.name) ||
      !Number.isSafeInteger(command.expectedVersion) || (command.expectedVersion as number) < 0 ||
      (command.expectedVersion as number) >= Number.MAX_SAFE_INTEGER ||
      (command.description !== undefined && command.description !== null && typeof command.description !== 'string') ||
      read?.tenantId !== request.tenantId || receipt?.tenant_id !== request.tenantId ||
      receipt.actor_user_id !== request.actorId || receipt.actor_kind !== request.actorKind ||
      receipt.idempotency_key !== request.idempotencyKey || receipt.command_hash !== request.commandHash ||
      result?.ok !== true || result.outcome !== 'updated' || result.pipeline_id !== command.pipelineId ||
      !Array.isArray(catalogue?.items)) return unknown();
  const matches = catalogue.items.filter((item: unknown) => object(item)?.id === command.pipelineId);
  if (matches.length !== 1) return unknown();
  const target = object(matches[0])!;
  if (command.pipelineRef !== undefined && (typeof command.pipelineRef !== 'string' ||
      target.short_ref !== btrim(command.pipelineRef).toUpperCase())) return unknown();
  const description = typeof command.description === 'string' ? btrim(command.description) || null : null;
  if (target.name !== btrim(command.name) || target.description !== description ||
      target.version !== (command.expectedVersion as number) + 1) return unknown();
  return { outcome: 'confirmed_success' as const, verified_readback: true as const,
    pipeline_id: command.pipelineId, version: target.version as number };
}
