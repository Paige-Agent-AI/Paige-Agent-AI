// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createPipelineOutcomeHandler } from '../../supabase/functions/_shared/pipeline-outcome-handler';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { threadId: id(1), intentId: id(2), effectId: id(3) };
function setup(user: { id: string } | null = { id: id(4) }) {
 const caller = { auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) }, rpc: vi.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => ({ data: name === 'current_user_tenant_id' ? id(5) : null, error: null })) };
 const clients = { caller: vi.fn(() => caller), service: vi.fn(() => ({ from: vi.fn(() => { throw Error('no unbound operation reads'); }) })) };
 return { caller, clients, handle: createPipelineOutcomeHandler(clients) };
}
const request = (body: unknown = input, authorization = 'Bearer user-token') => new Request('https://example.test', { method: 'POST', headers: { authorization }, body: JSON.stringify(body) });
it('rejects unauthenticated requests before creating service readers', async () => { const s = setup(null); expect((await s.handle(request())).status).toBe(401); expect(s.clients.service).not.toHaveBeenCalled(); });
it('returns unknown for missing genuine effect without mutation', async () => { const s = setup(); const r = await s.handle(request()); expect(await r.json()).toEqual({ outcome: 'outcome_unknown', verified_readback: false }); expect(r.headers.get('cache-control')).toBe('no-store'); });
it.each(['actorId', 'tenantId', 'command', 'commandHash'])('rejects client authority field %s', async field => { const s = setup(); expect((await s.handle(request({ ...input, [field]: 'forged' }))).status).toBe(400); expect(s.clients.service).not.toHaveBeenCalled(); });
it('rejects invalid identifiers', async () => { const s = setup(); expect((await s.handle(request({ ...input, intentId: 'bad' }))).status).toBe(400); });
it('bounds request body bytes', async () => { const s = setup(); expect((await s.handle(request({ huge: 'x'.repeat(9000) }))).status).toBe(413); expect(s.clients.service).not.toHaveBeenCalled(); });
it('rejects malformed JSON', async () => { const s = setup(); expect((await s.handle(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{' }))).status).toBe(400); });
it('handles preflight without authority reads', async () => { const s = setup(); expect((await s.handle(new Request('https://example.test', { method: 'OPTIONS' }))).status).toBe(200); expect(s.clients.caller).not.toHaveBeenCalled(); });
it('requires bearer authorization', async () => { const s = setup(); expect((await s.handle(request(input, ''))).status).toBe(401); expect(s.clients.caller).not.toHaveBeenCalled(); });
it('rejects a service token with no authenticated user', async () => { const s = setup(null); expect((await s.handle(request(input, 'Bearer service-token'))).status).toBe(401); expect(s.clients.service).not.toHaveBeenCalled(); });
it('returns exact confirmed read-only outcome through actual reader dependencies', async () => {
 const original = { tenantId: id(5), actorId: id(4), actorKind: 'human', idempotencyKey: 'op', commandHash: 'a'.repeat(32), command: { type: 'update-pipeline', pipelineId: id(6), expectedVersion: 2, name: 'New' } };
 const s = setup(); s.caller.rpc.mockImplementation(async name => ({ data: name === 'current_user_tenant_id' ? id(5) : name === 'read_pipeline_metadata_original' ? original : { items: [{ id: id(6), version: 3, name: 'New', description: null }] }, error: null }));
 const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { tenant_id: id(5), actor_user_id: id(4), actor_kind: 'human', idempotency_key: 'op', command_hash: original.commandHash, result: { ok: true, outcome: 'updated', pipeline_id: id(6) } }, error: null })), then: Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null })) };
 query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
 const handle = createPipelineOutcomeHandler({ caller: () => s.caller, service: () => ({ from: () => query }) });
 expect(await (await handle(request())).json()).toEqual({ outcome: 'confirmed_success', verified_readback: true, pipeline_id: id(6), version: 3 });
});
