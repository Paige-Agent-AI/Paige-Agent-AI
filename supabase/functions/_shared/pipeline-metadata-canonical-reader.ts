import type { PipelineReadbackBinding, PipelineReadbackDependencies } from './pipeline-metadata-readback.ts';

type ReadResult = { data: unknown; error: unknown };
interface Query {
  eq(column: string, value: string): Query;
  maybeSingle(): PromiseLike<ReadResult>;
}
export interface PipelineCanonicalCaller {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<ReadResult>;
}
// Keep the SDK's deeply generic select result opaque at the client boundary;
// only the known post-select read methods below are needed, never writes.
export interface PipelineCanonicalService { from(table: string): { select(columns: string): unknown } }

/** Read-only server readers. Original command authority and PostgreSQL hash are
 * derived by the caller-bound SQL resolver, never copied from an operation
 * receipt or supplied by client JSON. This factory performs no settlement. */
export function createPipelineCanonicalReaders(input: {
  caller: PipelineCanonicalCaller;
  service: PipelineCanonicalService;
  /** Revalidates owned thread and protected original effect/intent. This read
   * contract does not provide an execution-scope epoch or continuation authority. */
  revalidateScope(binding: PipelineReadbackBinding): Promise<boolean>;
}): PipelineReadbackDependencies {
  return {
    async scopeHolds(binding) {
      try {
        const auth = await input.caller.auth.getUser();
        if (auth.error || auth.data.user?.id !== binding.actorId) return false;
        const tenant = await input.caller.rpc('current_user_tenant_id');
        return !tenant.error && tenant.data === binding.tenantId && (await input.revalidateScope(binding)) === true;
      } catch { return false; }
    },
    async resolveOriginal(binding) {
      try {
        const { data, error } = await input.caller.rpc('read_pipeline_metadata_original', {
          _thread: binding.threadId, _intent: binding.intentId, _effect: binding.effectId,
        });
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) return null;
        const r = data as Record<string, unknown>;
        const command = r.command;
        if (r.tenantId !== binding.tenantId || r.actorId !== binding.actorId || r.actorKind !== 'human' ||
            typeof r.idempotencyKey !== 'string' || !r.idempotencyKey.trim() ||
            typeof r.commandHash !== 'string' || !/^[a-f0-9]{32}$/.test(r.commandHash) ||
            !command || typeof command !== 'object' || Array.isArray(command)) return null;
        const c = command as Record<string, unknown>;
        if (c.type !== 'update-pipeline' || typeof c.pipelineId !== 'string' ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.pipelineId) ||
            typeof c.name !== 'string' || !c.name.replace(/^ +| +$/g, '') ||
            !Number.isSafeInteger(c.expectedVersion) || (c.expectedVersion as number) < 0 ||
            (c.expectedVersion as number) >= Number.MAX_SAFE_INTEGER ||
            (c.description !== undefined && c.description !== null && typeof c.description !== 'string')) return null;
        return { tenantId: binding.tenantId, actorId: binding.actorId, actorKind: 'human',
          idempotencyKey: r.idempotencyKey, commandHash: r.commandHash, command: structuredClone(c) };
      } catch { return null; }
    },
    async readOperation(request) {
      const selected = input.service.from('pipeline_command_results')
        .select('tenant_id,idempotency_key,command_hash,actor_user_id,actor_kind,result');
      const result = await (selected as Query)
        .eq('tenant_id', request.tenantId).eq('idempotency_key', request.idempotencyKey)
        .eq('actor_user_id', request.actorId).eq('actor_kind', request.actorKind).maybeSingle();
      if (result.error) throw new Error('PIPELINE_OPERATION_READ_UNAVAILABLE');
      return result.data;
    },
    async getPipelineCatalogue(tenantId) {
      const result = await input.caller.rpc('get_pipeline_catalogue', { _tenant_id: tenantId, _search: null });
      if (result.error) throw new Error('PIPELINE_CATALOGUE_READ_UNAVAILABLE');
      return result.data;
    },
  };
}
