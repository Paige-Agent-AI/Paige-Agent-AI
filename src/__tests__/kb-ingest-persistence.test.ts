// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Keep Deno-only runtime types out of the frontend tsconfig. Vitest still executes the real module.
const coreModule = '../../supabase/functions/_shared/kb-ingest-core.ts';
const { ingestDoc, chunkText } = await import(coreModule);
const { embeddingsCompat } = vi.hoisted(() => ({ embeddingsCompat: vi.fn() }));
vi.mock('../../supabase/functions/_shared/voyage', () => ({ VOYAGE_DIMS: 1024, embeddingsCompat }));
const vector = () => Array(1024).fill(0.1);
const params = { tenantId: 'test-tenant-a', title: 'Process', content: 'x'.repeat(1800), source: 'paste' };
type Row = Record<string, unknown>;
type Reply = { data?: Row | Row[] | null; error: { message: string } | null; count?: number };
function database(fault = '') {
  const state = { docs: [] as Row[], chunks: [] as Row[], calls: [] as { table: string; op: string; filters: Array<[string, unknown]>; value: Row | Row[] }[] };
  const client = { from(table: string) {
    let op = 'read', value: Row | Row[] = {}, single = false, count = false, low = 0, high = Infinity;
    const filters: Array<[string, unknown]> = []; let nonNull = false;
    const q = {
      insert(v: Row | Row[]) { op = 'insert'; value = v; return q; },
      update(v: Row) { op = 'update'; value = v; return q; },
      delete() { op = 'delete'; return q; },
      select(_fields: string, options?: { count?: string }) { count = !!options?.count; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      not(k: string, _is: string, v: unknown) { expect([k, v]).toEqual(['embedding', null]); nonNull = true; return q; },
      order() { return q; }, range(a: number, b: number) { low = a; high = b; return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      then(resolve: (reply: Reply) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve().then((): Reply => {
        state.calls.push({ table, op, filters: [...filters], value });
        if (fault === 'insert-doc' && table.endsWith('docs') && op === 'insert') return { data: null, error: { message: 'denied' } };
        if (table.endsWith('chunks') && op === 'insert' && fault === 'insert-chunks') return { error: { message: 'failed' } };
        if (table.endsWith('chunks') && op === 'insert' && fault === 'insert-throw') throw Error('lost response');
        if (table.endsWith('chunks') && op === 'read' && fault === 'readback') return { error: { message: 'read unavailable' } };
        if (op === 'update' && fault === 'reconcile') return { error: { message: 'update failed' } };
        if (op === 'delete' && fault === 'cleanup') return { error: { message: 'delete failed' } };
        if (op === 'read' && table.endsWith('docs') && fault === 'absence') return { error: { message: 'cannot verify absence' } };
        const key = table.endsWith('docs') ? 'docs' : 'chunks';
        const matches = (r: Row) => filters.every(([k, v]) => r[k] === v) && (!nonNull || r.embedding != null);
        if (op === 'insert') {
          const rows: Row[] = (Array.isArray(value) ? value : [value]).map((r: Row) => ({ ...r, id: 'test-doc' }));
          if (key === 'chunks' && fault === 'null-vector') rows[0].embedding = null;
          if (key === 'chunks' && fault === 'wrong-index') rows[0].chunk_index = 99;
          if (key === 'chunks' && fault === 'duplicate-index') rows[1].chunk_index = rows[0].chunk_index;
          state[key].push(...rows);
          if (key === 'chunks' && fault === 'persisted-throw') throw Error('lost acknowledgement');
        }
        if (op === 'update' && fault !== 'zero-update') state[key].filter(matches).forEach(r => Object.assign(r, value));
        const rows = state[key].filter(matches);
        if (op === 'delete') { state[key] = state[key].filter(r => !matches(r)); if (key === 'docs') state.chunks = state.chunks.filter(r => !rows.some(d => d.id === r.doc_id)); }
        return { data: op === 'delete' ? null : single ? rows[0] ?? null : rows.slice(low, high + 1), error: null, count: count ? rows.length : undefined };
      }).then(resolve, reject); },
    }; return q;
  } }; return { client, state };
}
beforeEach(() => { vi.mocked(embeddingsCompat).mockReset().mockImplementation(async () => new Response(JSON.stringify({ data: [{ embedding: vector() }] }))); });
describe('ingestion persistence truth', () => {
  it('verifies all persisted searchable chunks and reconciles the document', async () => {
    const { client, state } = database(); const result = await ingestDoc(client, params);
    expect(result).toMatchObject({ ok: true, embedded: true, chunk_count: chunkText(params.content).length });
    expect(state.calls.find(c => c.op === 'insert')?.value).toMatchObject({ chunk_count: 0 });
    expect(state.calls.some(c => c.table.endsWith('chunks') && c.op === 'read')).toBe(true);
    expect(state.docs[0].chunk_count).toBe(state.chunks.length);
  });
  it.each(['insert-chunks', 'insert-throw', 'persisted-throw', 'readback', 'null-vector', 'wrong-index', 'duplicate-index', 'reconcile', 'zero-update'])('never reports success after %s', async fault => {
    const { client, state } = database(fault); const result = await ingestDoc(client, params);
    expect(result.ok).toBe(false); expect(result.embedded).toBe(false); expect(state.docs).toHaveLength(0);
  });
  it('retains verified partial embedding semantics and original chunk positions', async () => {
    vi.mocked(embeddingsCompat).mockRejectedValueOnce(Error('provider unavailable'));
    const { client, state } = database(); const result = await ingestDoc(client, params);
    expect(result).toMatchObject({ ok: true, embedded: false, chunk_count: 1 }); expect(state.chunks[0].chunk_index).toBe(1);
  });
  it.each(['cleanup', 'absence'])('reports uncertain persistence when cleanup cannot be proven: %s', async fault => {
    vi.mocked(embeddingsCompat).mockRejectedValue(Error('unavailable'));
    const { client } = database(fault); const result = await ingestDoc(client, params);
    expect(result).toMatchObject({ ok: false, error: 'persistence_unverified', doc_id: 'test-doc' });
    expect(result.detail).not.toContain('nothing was saved');
  });
  it.each([null, [], [0.1], Array(1024).fill('bad'), Array(1024).fill(0), Array(1024).fill(1e-100), Array(1024).fill(1e100)])('rejects malformed embedding payloads', async embedding => {
    vi.mocked(embeddingsCompat).mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding }] })));
    const { client, state } = database(); const result = await ingestDoc(client, params);
    expect(result).toMatchObject({ ok: false, error: 'embedding_failed' }); expect(state.chunks).toHaveLength(0);
  });
  it('verifies documents larger than one readback page', async () => {
    const { client } = database(); const content = 'x'.repeat(180000);
    const result = await ingestDoc(client, { ...params, content });
    expect(result).toMatchObject({ ok: true, embedded: true, chunk_count: chunkText(content).length });
  });
  it('does not write or embed empty input', async () => { const { client, state } = database(); expect((await ingestDoc(client, { ...params, content: ' ' })).error).toBe('empty_content'); expect(state.calls).toHaveLength(0); expect(embeddingsCompat).not.toHaveBeenCalled(); });
  it('retains caller-scoped document insertion', async () => { const admin = database(); const user = database('insert-doc'); expect((await ingestDoc(admin.client, params, { docClient: user.client })).ok).toBe(false); expect(admin.state.calls).toHaveLength(0); });
  it('scopes administrative reads updates and deletes by tenant and document', async () => {
    for (const fault of ['', 'insert-chunks']) { const { client, state } = database(fault); await ingestDoc(client, params);
      for (const call of state.calls.filter(c => c.op !== 'insert')) { expect(call.filters).toContainEqual(['tenant_id', params.tenantId]); expect(call.filters).toContainEqual([call.table.endsWith('chunks') ? 'doc_id' : 'id', 'test-doc']); }
    }
  });
});
