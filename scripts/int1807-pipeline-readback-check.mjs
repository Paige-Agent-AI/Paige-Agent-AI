import assert from 'node:assert/strict';
import { classifyPipelineMetadataReadback } from '../supabase/functions/_shared/pipeline-metadata-reconciliation.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { tenantId: id(1), actorId: id(2), actorKind: 'human',
  idempotencyKey: 'operation-1', commandHash: 'a'.repeat(32),
  command: { type: 'update-pipeline', pipelineId: id(3), pipelineRef: 'PPL-ABCDE',
    expectedVersion: 7, name: ' Updated ', description: ' Purpose ' } };
const receipt = { tenant_id: id(1), actor_user_id: id(2), actor_kind: 'human',
  idempotency_key: 'operation-1', command_hash: 'a'.repeat(32),
  result: { ok: true, outcome: 'updated', pipeline_id: id(3) } };
const pipeline = { id: id(3), short_ref: 'PPL-ABCDE', version: 8, name: 'Updated', description: 'Purpose' };
const evidence = { tenantId: id(1), receipt, catalogue: { items: [pipeline] } };
const classify = (r = request, e = evidence) => classifyPipelineMetadataReadback(r, e);
assert.equal(classify().outcome, 'confirmed_success');
assert.deepEqual(classify(), classify(), 'repeated readback is stable');
for (const field of ['tenant_id', 'actor_user_id', 'actor_kind', 'idempotency_key', 'command_hash']) {
  assert.equal(classify(request, { ...evidence, receipt: { ...receipt, [field]: 'wrong' } }).outcome, 'outcome_unknown', field);
}
for (const patch of [{ id: id(4) }, { short_ref: 'PPL-FGHIJ' }, { version: 9 },
  { version: 7 }, { name: 'Other' }, { description: 'Other' }]) {
  assert.equal(classify(request, { ...evidence, catalogue: { items: [{ ...pipeline, ...patch }] } }).outcome, 'outcome_unknown', JSON.stringify(patch));
}
for (const e of [null, {}, { ...evidence, receipt: null }, { ...evidence, tenantId: id(9) },
  { ...evidence, catalogue: null }, { ...evidence, catalogue: { items: [] } },
  { ...evidence, catalogue: { items: [pipeline, pipeline] } },
  { ...evidence, receipt: { ...receipt, result: { ok: false } } },
  { ...evidence, receipt: { ...receipt, result: { ok: true, outcome: 'updated', pipeline_id: id(4) } } }]) {
  assert.equal(classify(request, e).outcome, 'outcome_unknown');
}
assert.equal(classify(request, { ...evidence, catalogue: { items: [
  { ...pipeline, id: id(4), short_ref: 'PPL-FGHIJ' }, pipeline] } }).outcome, 'confirmed_success');
assert.equal(classify(request, { ...evidence, catalogue: { items: [{ ...pipeline, id: id(4) }] } }).outcome, 'outcome_unknown', 'same display name is never identity');
for (const command of [{ ...request.command, expectedVersion: '7' }, { ...request.command, expectedVersion: -1 },
  { ...request.command, type: 'create-pipeline' }, { ...request.command, pipelineId: 'bad' },
  { ...request.command, name: '' }]) assert.equal(classify({ ...request, command }).outcome, 'outcome_unknown');
assert.equal(classify({ ...request, command: { ...request.command, description: '' } },
  { ...evidence, catalogue: { items: [{ ...pipeline, description: null }] } }).outcome, 'confirmed_success');
assert.equal(classify({ ...request, command: { ...request.command, description: undefined } },
  { ...evidence, catalogue: { items: [{ ...pipeline, description: null }] } }).outcome, 'confirmed_success');
assert.equal(classify(request, { ...evidence, timeout: true, receipt: null }).outcome, 'outcome_unknown');
console.log('PASS canonical metadata classification: exact operation/actor/tenant/UUID/reference/version, same-name collision, missing evidence, normalization, replay, timeout honesty');
