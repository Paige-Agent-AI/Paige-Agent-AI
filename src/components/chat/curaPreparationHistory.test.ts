import { describe, expect, it } from 'vitest';
import { readOriginalCuraPreparationHistory, preparationWorkLabel } from './curaPreparationHistory';

const id = (n: number) => `a2375000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { threadId: id(1), turnId: id(2), intentId: id(3), tenantId: id(4) };
const item = () => ({ tool: 'save_to_knowledge_base', preparation_recorded: true, work_id: id(5),
  work_status: 'claimed', knowledge_doc_id: id(6), current_document_revision: 1, work_updated_at: '2026-10-21T19:00:00.123456Z' });
const history = () => ({ v: 1, status: 'recorded_preparation', thread_id: scope.threadId, turn_id: scope.turnId,
  origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, retry_authorized: false,
  confirmations_restored: false, new_effect_possible: false, settles_interrupted_turn: false, preparations: [item()] });
describe('original CURA preparation metadata', () => {
  it('detaches exact original status facts without private content, URLs or authority', () => {
    const raw = history(), parsed = readOriginalCuraPreparationHistory(raw, scope);
    expect(parsed).toEqual(raw); raw.preparations.length = 0; expect(parsed?.preparations).toHaveLength(1);
    expect(parsed).not.toHaveProperty('fingerprint'); expect(parsed).not.toHaveProperty('command');
  });
  it.each(['thread_id', 'turn_id', 'origin_intent_id', 'tenant_id'])('refuses a foreign %s', key => {
    expect(readOriginalCuraPreparationHistory({ ...history(), [key]: id(99) }, scope)).toBeNull();
  });
  it.each(['threadId', 'turnId', 'intentId', 'tenantId'])('refuses malformed request scope %s', key => {
    expect(readOriginalCuraPreparationHistory(history(), { ...scope, [key]: 'not-a-uuid' })).toBeNull();
  });
  it.each(['retry_authorized', 'confirmations_restored', 'new_effect_possible', 'settles_interrupted_turn'])('never accepts %s authority', key => {
    expect(readOriginalCuraPreparationHistory({ ...history(), [key]: true }, scope)).toBeNull();
  });
  it.each([null, [], {}, { bundle_ref: history() }, { cura_preparation_history: history() },
    { ...history(), v: 2 }, { ...history(), historical: false }, { ...history(), status: 'succeeded' },
    { ...history(), source_text: 'private' }, { ...history(), preparations: [] },
    { ...history(), preparations: Array.from({ length: 11 }, item) }])('rejects another envelope or unchecked container %j', raw => {
    expect(readOriginalCuraPreparationHistory(raw, scope)).toBeNull();
  });
  it.each([{ work_id: 'invalid' }, { work_status: 'delivered' }, { tool: 'publish_knowledge' },
    { preparation_recorded: false }, { work_updated_at: 'invalid' }, { current_document_revision: 0 },
    { current_document_revision: 1.5 }, { knowledge_doc_id: 'https://foreign.test/private' },
    { title: 'private source' }, { fingerprint: 'must-never-restore' }])('rejects invalid/private preparation fields %j', change => {
    expect(readOriginalCuraPreparationHistory({ ...history(), preparations: [{ ...item(), ...change }] }, scope)).toBeNull();
  });
  it('accepts an unavailable source without inventing access or a version', () => {
    const raw = { ...history(), preparations: [{ ...item(), knowledge_doc_id: null, current_document_revision: null }] };
    expect(readOriginalCuraPreparationHistory(raw, scope)?.preparations[0].knowledge_doc_id).toBeNull();
    expect(readOriginalCuraPreparationHistory({ ...raw, preparations: [{ ...raw.preparations[0], current_document_revision: 1 }] }, scope)).toBeNull();
  });
  it('rejects duplicated work identities', () => {
    expect(readOriginalCuraPreparationHistory({ ...history(), preparations: [item(), item()] }, scope)).toBeNull();
  });
  it('does not describe a claimed row as executing or customer-ready', () => {
    expect(preparationWorkLabel.claimed).toBe('Preparation recorded');
    expect(Object.values(preparationWorkLabel).join(' ')).not.toMatch(/published|shared|CURA knows|queued|executing/i);
  });
});
