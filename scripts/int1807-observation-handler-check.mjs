/** INT-1807 CL-2 handler composition — the interactive STATUS path consults the
 * non-application observation when the atomic readback cannot classify. Drives the real
 * paige-ai-chat handler with fakes: an explicit effect whose original resolves, a
 * catalogue/receipt pair that reads back UNKNOWN (nothing succeeded), and a
 * lineage-validated non-application record. The status answer must report
 * confirmed_failure — an OBSERVATION only: the executor state is reread after it and
 * nothing settles, retries or activates. The negative leg (reader unavailable) stays
 * honestly outcome_unknown. */
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', ANTHROPIC_API_KEY: 'test-key',
})[k] ?? '' } };
const fake = await import('./knowledge-scope/fake-supabase.mjs');
await import('../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('./knowledge-scope/stub-serve.mjs');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), thread = id(3), intent = id(4), effect = id(5), nonce = id(6);
const original = {
  tenantId: tenant, actorId: actor, actorKind: 'human', idempotencyKey: 'operation',
  commandHash: 'a'.repeat(32),
  command: { type: 'update-pipeline', pipelineId: id(7), expectedVersion: 7, name: 'Updated', description: null },
};
const evidence = {
  authoritative: true, effect: 'none', conflicting: false, kind: 'failed_not_applied',
  binding: { tenantId: tenant, actorId: actor, threadId: thread, intentId: intent, operationId: effect, scopeEpoch: nonce },
};
const executorState = { latest: intent, executor: null, terminal: true, stopped: false, reads: 0 };
const req = (interactiveExtras = {}) => new Request('https://test.supabase.co/functions/v1/paige-ai-chat', {
  method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'What happened to that pipeline update?' }],
    threadId: thread, requestIntentId: intent, interactive: { kind: 'status', ...interactiveExtras } }),
});
const scenario = (observationRpc) => {
  executorState.reads = 0;
  return fake.setScenario({
    authUser: { id: actor },
    tables: {
      profiles: [{ active_tenant_id: tenant }],
      tenant_members: [{ tenant_id: tenant }],
      paige_chat_threads: [{ id: thread, tenant_id: tenant, caller_user_id: actor }],
      paige_chat_turns: [],
      pipeline_command_results: [],
    },
    rpcs: {
      paige_chat_interactive_protocol: { data: { version: 2, active: false }, error: null },
      check_rate_limit: { data: true, error: null },
      current_user_tenant_id: { data: tenant, error: null },
      read_pipeline_metadata_original: { data: original, error: null },
      find_pipeline_metadata_original_effect: { data: effect, error: null },
      get_pipeline_catalogue: { data: { items: [] }, error: null },
      read_pipeline_metadata_observation: observationRpc,
      paige_chat_interactive_begin_v2: { data: { status: 'accepted', turn_id: id(8) }, error: null },
      paige_chat_interactive_executor_v2: () => { executorState.reads++; return { data: executorState, error: null }; },
      paige_chat_interactive_settle: () => { throw Error('settle must not run on a status read'); },
    },
  });
};

// 1 — Readback unknown + lineage-validated non-application record => confirmed_failure,
//     with executor state reread AFTER the observation (reads > 1) and no settlement.
let rec = scenario({ data: evidence, error: null });
const response = await capturedHandler()(req({ pipelineEffectId: effect }));
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
const status = await response.json();
assert.equal(status.original_operation.outcome, 'confirmed_failure');
assert.equal(status.original_operation.verified_readback, true);
assert.equal(status.executor_active, false);
assert.equal(status.settled, true);
assert.ok(executorState.reads >= 2, 'executor state must be reread after the awaited observation');
assert.equal(rec.rpc.some((c) => c.name === 'paige_chat_interactive_settle'), false, 'an observation never settles');
assert.equal(rec.rpc.filter((c) => c.name === 'read_pipeline_metadata_observation').length, 1);

// 2 — Reader unavailable (store error): the answer stays honestly outcome_unknown.
rec = scenario({ data: null, error: { code: 'PGRST102', message: 'unavailable' } });
const degraded = await capturedHandler()(req({ pipelineEffectId: effect }));
const degradedStatus = await degraded.json();
assert.equal(degradedStatus.original_operation.outcome, 'outcome_unknown');
assert.equal(degradedStatus.original_operation.verified_readback, false);

// 3 — The same upgrade on the AUTOMATIC discovery path (no explicit effect id): the
//     discovery RPC resolves the effect and the observation classifies it.
rec = scenario({ data: evidence, error: null });
const auto = await capturedHandler()(req());
assert.equal((await auto.json()).original_operation.outcome, 'confirmed_failure');

console.log('PASS status observation composition: unknown readback + lineage-validated non-application record reports confirmed_failure with executor reread and no settlement; reader unavailability stays outcome_unknown');
