import { describe, expect, it, vi } from 'vitest';
import { downloadKnowledgeBytes, runKnowledgeExtraction, sourceHash, submitKnowledgeExtraction } from '../../supabase/functions/_shared/knowledge-extraction';
import { readKnowledgeFile, readKnowledgeFileMetadata } from '../../supabase/functions/_shared/knowledge-file-source';
import { KnowledgeFileTextError } from '../../supabase/functions/_shared/knowledge-file-text';
const tenant = '00000000-0000-0000-0000-000000000001'; const actor = '10000000-0000-0000-0000-000000000001';
const work = '70000000-0000-0000-0000-000000000001'; const doc = '20000000-0000-0000-0000-000000000001';
const text = 'Acme Services delivers a report.'; const rawHash = 'a'.repeat(64);
const evidence = async () => ({ schema_version: 1 as const, format: 'pdf' as const, source_sha256: rawHash, text_sha256: await sourceHash(new TextEncoder().encode(text)), extraction_version: 'pdf-text-v1', coverage: 'partial' as const, segments: [{ kind: 'page' as const, ordinal: 1, start: 0, end: text.length }], limits: ['PDF_TEXT_LAYER_ONLY'] });
const source = { object_id: doc, object_name: tenant + '/agreement.pdf', bucket: 'tenant-knowledge', sha256: rawHash, byte_size: 27, mime_type: 'application/pdf' };
function admin(includeReadback = true) {
  return { rpc: vi.fn(async (name: string) => ({ error: null, data: name === 'start_knowledge_extraction'
    ? { status: 'claimed', work_id: work, document_id: doc, server_key: 'server-only', attempt: 1, revision: 1, actor_id: actor, tenant_id: tenant, source, input_hash: rawHash }
    : name === 'resolve_knowledge_extraction_source' ? source
    : name === 'complete_knowledge_extraction' ? { verified_readback: true, phase: 'awaiting_review', document_id: doc, outcome: 'capability_succeeded', ...(includeReadback ? { source_sha256: rawHash, text_sha256: await sourceHash(new TextEncoder().encode(text)) } : {}) } : null })) };
}
describe('original binary source handoff', () => {
  it('captures raw bytes without decoding them as text or relabelling their hash', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 255]);
    const fetcher = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/pdf' } }));
    const result = await downloadKnowledgeBytes('https://storage.invalid/file', {}, fetcher as typeof fetch);
    expect(result.bytes).toEqual(bytes); expect(result.sha256).toBe(await sourceHash(bytes));
    expect(fetcher).toHaveBeenCalledWith('https://storage.invalid/file', expect.objectContaining({ redirect: 'error' }));
  });
  it('submits only authoritative binary object identity, not browser fact values or converted text', async () => {
    const path = source.object_name;
    const caller = { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) }, readActiveTenant: async () => ({ data: { active_tenant_id: tenant }, error: null }), rpc: async () => ({ data: true, error: null }) };
    const port = { rpc: vi.fn(async (name: string) => ({ error: null, data: name === 'resolve_knowledge_extraction_source' ? source : { work_id: work, document_id: doc, status: 'claimed', revision: 1, replayed: false } })) };
    await submitKnowledgeExtraction({ intent_id: work, expected_tenant: tenant, title: 'Agreement', kind: 'file', path }, caller, port, async () => ({ sha256: rawHash, byte_size: 27, mime_type: 'application/pdf' }));
    expect(port.rpc).toHaveBeenCalledWith('submit_knowledge_extraction', expect.objectContaining({ _input: null, _source: expect.objectContaining({ object_id: doc, sha256: rawHash, mime_type: 'application/pdf' }) }));
  });
  it('completes the SAME native work with distinct raw and text identities and exact evidence readback', async () => {
    const port = admin(); const manifest = await evidence();
    expect(await runKnowledgeExtraction(port, work, async () => ({ text, sha256: rawHash, byte_size: 27, mime_type: 'application/pdf', evidence: manifest }))).toMatchObject({ ok: true, status: 'succeeded' });
    expect(port.rpc).toHaveBeenCalledWith('complete_knowledge_extraction', expect.objectContaining({ _work_id: work, _hash: rawHash, _content: text, _evidence: manifest }));
    expect(port.rpc.mock.calls.filter(([name]) => name === 'complete_knowledge_extraction')).toHaveLength(1);
  });
  it('refuses a binary reading without source evidence before attempting a native save', async () => {
    const port = admin();
    expect(await runKnowledgeExtraction(port, work, async () => ({ text, sha256: rawHash, byte_size: 27, mime_type: 'application/pdf' }))).toMatchObject({ ok: false, status: 'failed' });
    expect(port.rpc.mock.calls.some(([name]) => name === 'complete_knowledge_extraction')).toBe(false);
  });
  it('refuses a changed text hash before completion', async () => {
    const port = admin(); const manifest = await evidence(); manifest.text_sha256 = 'b'.repeat(64);
    expect(await runKnowledgeExtraction(port, work, async () => ({ text, sha256: rawHash, byte_size: 27, mime_type: 'application/pdf', evidence: manifest }))).toMatchObject({ ok: false, status: 'failed' });
    expect(port.rpc.mock.calls.some(([name]) => name === 'complete_knowledge_extraction')).toBe(false);
  });
  it('preserves unknown completion evidence without replay when HTTP success lacks original hashes', async () => {
    const port = admin(false); const manifest = await evidence();
    expect(await runKnowledgeExtraction(port, work, async () => ({ text, sha256: rawHash, byte_size: 27, mime_type: 'application/pdf', evidence: manifest }))).toMatchObject({ ok: false, status: 'outcome_unknown' });
    expect(port.rpc.mock.calls.filter(([name]) => name === 'complete_knowledge_extraction')).toHaveLength(1);
    expect(port.rpc).toHaveBeenLastCalledWith('settle_knowledge_extraction_failure', expect.objectContaining({ _unknown: true }));
  });
  it('captures metadata only before native submission and runs the parser only in worker reading', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 synthetic');
    const fetcher = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    const parsers = { pdf: vi.fn(async () => ({ pages: [text], totalPages: 1 })), docx: vi.fn(async () => '') };
    const meta = await readKnowledgeFileMetadata('https://storage.invalid/source', {}, source.object_name, fetcher as typeof fetch);
    expect(meta).toEqual({ sha256: await sourceHash(bytes), byte_size: bytes.length, mime_type: 'application/pdf' });
    expect(parsers.pdf).not.toHaveBeenCalled(); expect(meta).not.toHaveProperty('text');
    const reading = await readKnowledgeFile('https://storage.invalid/source', {}, source.object_name, parsers, fetcher as typeof fetch);
    expect(parsers.pdf).toHaveBeenCalledTimes(1);
    expect(reading.evidence).toMatchObject({ source_sha256: meta.sha256, text_sha256: await sourceHash(new TextEncoder().encode(text)), coverage: 'partial', format: 'pdf' });
  });
  it('preserves original UTF8 BOM bytes and precise text evidence on the new worker path', async () => {
    const bytes = new Uint8Array([239, 187, 191, 65]);
    const parsers = { pdf: vi.fn(), docx: vi.fn() };
    const reading = await readKnowledgeFile('https://storage.invalid/source', {}, tenant + '/bom.txt', parsers, vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'text/plain' } })) as typeof fetch);
    expect(reading.text.charCodeAt(0)).toBe(0xfeff); expect(reading.sha256).toBe(await sourceHash(bytes));
    expect(reading.evidence).toMatchObject({ source_sha256: reading.sha256, text_sha256: reading.sha256, coverage: 'complete', segments: [{ start: 0, end: 2 }] });
    expect(parsers.pdf).not.toHaveBeenCalled(); expect(parsers.docx).not.toHaveBeenCalled();
  });
  it('reports known parser refusal without leaking parser prose or pretending source absence', async () => {
    const parsers = { pdf: vi.fn(async () => { throw new KnowledgeFileTextError('FILE_ENCRYPTED'); }), docx: vi.fn() };
    await expect(readKnowledgeFile('https://storage.invalid/source', {}, source.object_name, parsers, vi.fn(async () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })) as typeof fetch)).rejects.toMatchObject({ code: 'file_encrypted' });
  });
});
