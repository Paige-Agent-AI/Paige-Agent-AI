// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  submitExtraction: vi.fn(), extractionStatus: vi.fn(), extractionReview: vi.fn(),
  saveReview: vi.fn(), publicationStatus: vi.fn(), hash: vi.fn(), submitPublication: vi.fn(),
  upload: vi.fn(), existingReview: vi.fn(), sdk: null as SupabaseClient | null,
}));
const identity = vi.hoisted(() => ({ activeUserId: 'actor-a', activeTenantId: 'tenant-a', loading: false, accountContextStatus: 'ready' }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => identity }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return mocks.sdk ?? { storage: { from: () => ({ upload: mocks.upload }) } }; } }));
vi.mock("@/lib/knowledge-extraction-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-extraction-service")>();
  return { ...actual, submitKnowledgeExtraction: mocks.submitExtraction, readKnowledgeExtractionStatus: mocks.extractionStatus, readKnowledgeExtractionReview: mocks.extractionReview, readKnowledgeExtractionForDocument: mocks.existingReview };
});
vi.mock("@/lib/knowledge-review-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-review-service")>();
  return { ...actual, saveKnowledgeReview: mocks.saveReview, readKnowledgePublicationStatus: mocks.publicationStatus, sha256Hex: mocks.hash };
});
vi.mock("@/lib/knowledge-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/knowledge-service")>();
  return { ...actual, submitKnowledgePublication: mocks.submitPublication };
});
import { AddKnowledgeFlow } from "@/solo/knowledge/AddKnowledgeFlow";
import { ExtractionConsumerError } from "@/lib/knowledge-extraction-service";
import { KnowledgeReviewServiceError } from "@/lib/knowledge-review-service";

const REF = { tenantId: "tenant-a", intentId: "intent-a", documentId: "doc-a", workId: "work-a", revision: 1 };
const status = (work_status: string, extra: Record<string, unknown> = {}) => ({ work_id: "work-a", capability_key: "knowledge.extract", work_kind: "knowledge_extract", work_status, attempt_count: 1, max_attempts: 3, blocked_reason: null, error_code: null, safe_summary: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", settled_at: null, ...extra });
const review = { phase: "awaiting_review" as const, tenant_id: "tenant-a", document_id: "doc-a", revision: 2, record_state: "draft" as const, source_coverage: "complete" as const, source_binding: null, extraction_work_id: "work-a", extraction_source_binding: null, pending_review: { schema_version: 1, extracted_content: "Extracted source text", reviewed_content: null, extraction_version: "v1", coverage: "complete" as const } };

let container: HTMLDivElement, root: Root, onPublished: () => void;
const render = async (overrides: Record<string, unknown> = {}) => { await act(async () => root.render(<Dialog open onOpenChange={() => {}}><AddKnowledgeFlow tenantId="tenant-a" onPublished={onPublished} onClose={() => {}} {...overrides} /></Dialog>)); };
const body = () => document.body.textContent ?? "";
const button = (text: string) => { const b = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === text); expect(b, `button ${text}`).toBeTruthy(); return b!; };
const field = (id: string) => { const el = document.getElementById(id) as HTMLInputElement & HTMLTextAreaElement; expect(el, `field ${id}`).toBeTruthy(); return el; };
const set = (el: HTMLInputElement & HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const click = async (text: string) => { await act(async () => { button(text).click(); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  mocks.sdk = null;
  mocks.existingReview.mockReset().mockImplementation(async (_client, scope, documentId, revision) => ({ ...review, tenant_id: scope.tenantId, document_id: documentId, revision, phase: "review_unavailable", extraction_work_id: null, pending_review: null }));
  Object.assign(identity, { activeUserId: 'actor-a', activeTenantId: 'tenant-a', loading: false, accountContextStatus: 'ready' });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onPublished = vi.fn(() => {});
  mocks.submitExtraction.mockReset().mockResolvedValue({ reference: REF, status: "claimed", replayed: false });
  mocks.extractionStatus.mockReset().mockResolvedValue(status("succeeded"));
  mocks.extractionReview.mockReset().mockResolvedValue(review);
  mocks.saveReview.mockReset().mockResolvedValue({ revision: 3, outcome: "capability_succeeded", runId: "run-a" });
  mocks.publicationStatus.mockReset().mockResolvedValue({ phase: "resolved", status: "succeeded" });
  mocks.hash.mockReset().mockResolvedValue("a".repeat(64));
  mocks.submitPublication.mockReset().mockResolvedValue({ work_id: "pub-work", document_id: "doc-a", status: "claimed", replayed: false, revision: 3 });
  mocks.upload.mockReset().mockResolvedValue({ error: null });
});

describe('real SDK Knowledge read receiver', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const doc = '22222222-2222-4222-8222-222222222222';
  const work = '33333333-3333-4333-8333-333333333333';
  const nativeReview = { ...review, tenant_id: tenant, document_id: doc, revision: 5, record_state: 'canonical', extraction_work_id: work };
  const nativeStatus = { ...status('succeeded'), work_id: work };
  const target = { id: doc, tenant_id: tenant, revision: 5, title: 'Existing guide', content: 'Canonical text', summary: null, category: null, tags: [] };
  const calls: { name: string; args: Record<string, unknown>; authorization: string | null }[] = [];
  async function sdkPorts(reply: (name: string) => unknown | Promise<unknown> = name => name === 'read_tenant_knowledge_review' ? nativeReview : [nativeStatus]) {
    calls.length = 0;
    mocks.sdk = createClient('https://knowledge-fixture.invalid', 'synthetic-anon-key', {
      accessToken: async () => 'synthetic-ordinary-user-jwt',
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe('https://knowledge-fixture.invalid');
        expect(url.pathname).toMatch(/^\/rest\/v1\/rpc\//);
        const name = url.pathname.split('/').pop()!;
        calls.push({ name, args: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify(await reply(name)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } },
    });
    const rpc = vi.spyOn(mocks.sdk, 'rpc');
    const actual = await vi.importActual<typeof import('@/lib/knowledge-extraction-service')>('@/lib/knowledge-extraction-service');
    mocks.extractionStatus.mockImplementation(actual.readKnowledgeExtractionStatus);
    mocks.extractionReview.mockImplementation(actual.readKnowledgeExtractionReview);
    Object.assign(identity, { activeTenantId: tenant });
    mocks.submitExtraction.mockResolvedValue({ reference: { tenantId: tenant, intentId: '44444444-4444-4444-8444-444444444444', documentId: doc, workId: work, revision: 4 }, status: 'claimed', replayed: false });
    return { rpc, actual };
  }
  it('uses the actual SDK receiver and original JWT for bound review/status reads', async () => {
    const { rpc } = await sdkPorts();
    await render({ tenantId: tenant });
    set(field('knowledge-add-title'), 'Notes'); set(field('knowledge-add-content'), 'Input');
    await click('Send to Paige'); await tick(800);
    expect(body()).toContain('Review what Paige read');
    expect(calls.map(c => c.name)).toEqual(['read_tenant_knowledge_review', 'get_paige_durable_work', 'read_tenant_knowledge_review']);
    expect(calls[0].args).toEqual({ p_expected_tenant: tenant, p_doc_id: doc });
    expect(calls[1].args).toEqual({ _work_id: work });
    expect(calls.every(c => c.authorization === 'Bearer synthetic-ordinary-user-jwt')).toBe(true);
    expect(rpc.mock.contexts.every(context => context === mocks.sdk)).toBe(true);
    expect(mocks.submitExtraction).toHaveBeenCalledOnce();
    expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('does not dispatch a read after the original actor scope retires', async () => {
    await sdkPorts(); await render({ tenantId: tenant });
    set(field('knowledge-add-title'), 'Notes'); set(field('knowledge-add-content'), 'Input');
    await click('Send to Paige'); identity.activeUserId = 'actor-b'; await render({ tenantId: tenant }); await tick(800);
    expect(calls).toEqual([]); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('reopens the original unsaved native review after reload with zero extraction or publication', async () => {
    const { actual, rpc } = await sdkPorts();
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    mocks.saveReview.mockResolvedValue({ revision: 6, outcome: 'capability_succeeded', runId: 'run-a' });
    mocks.submitPublication.mockResolvedValue({ work_id: 'pub-work', document_id: doc, status: 'claimed', replayed: false, revision: 6 });
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain('Review what Paige read');
    expect(field('knowledge-review-content').value).toBe(nativeReview.pending_review.extracted_content);
    expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
    expect(calls.map(c => c.name)).toEqual(['read_tenant_knowledge_review', 'read_tenant_knowledge_review', 'get_paige_durable_work', 'read_tenant_knowledge_review']);
    expect(rpc.mock.contexts.every(context => context === mocks.sdk)).toBe(true);
    await click('Save review'); expect(mocks.saveReview.mock.calls[0].slice(1,5)).toEqual([tenant,doc,work,5]);
    expect(mocks.submitPublication).not.toHaveBeenCalled();
    await click('Publish to Knowledge'); expect(mocks.submitPublication.mock.calls[0].slice(1,5)).toEqual([tenant,doc,work,6]);
    expect(mocks.submitExtraction).not.toHaveBeenCalled();
  });
  it('keeps an already saved resumed review held rather than overwriting or publishing it', async () => {
    const { actual } = await sdkPorts(name => name === 'read_tenant_knowledge_review' ? { ...nativeReview, pending_review: { ...nativeReview.pending_review, reviewed_content: 'Saved exact text' } } : [nativeStatus]);
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain('Saved review needs confirmation');
    expect(document.getElementById('knowledge-review-content')).toBeNull();
    expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it.each(['outcome_unknown','blocked','failed','cancelled'])('resumes the original %s work honestly with zero new dispatch', async work_status => {
    const { actual } = await sdkPorts(name => name === 'read_tenant_knowledge_review' ? nativeReview : [{ ...nativeStatus, work_status, blocked_reason: work_status === 'blocked' ? 'authority_changed' : null }]);
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain(work_status === 'outcome_unknown' ? 'Reading outcome unconfirmed' : work_status === 'blocked' ? 'Reading paused' : 'Reading failed');
    expect(document.getElementById('knowledge-add-content')).toBeNull(); expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('does not confuse a work-present missing review with idle or successful publication', async () => {
    const { actual } = await sdkPorts(name => name === 'read_tenant_knowledge_review' ? { ...nativeReview, pending_review: null } : [nativeStatus]);
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain('Review unavailable'); expect(document.getElementById('knowledge-add-content')).toBeNull(); expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(onPublished).not.toHaveBeenCalled();
  });
  it('keeps malformed or stale discovery unavailable instead of opening a new source', async () => {
    const { actual } = await sdkPorts(() => ({ ...nativeReview, revision: 6 }));
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain('Existing reading unavailable'); expect(calls).toHaveLength(1); expect(mocks.submitExtraction).not.toHaveBeenCalled();
  });
  it.each(['actor','workspace','unmount'])('drops late native discovery after %s retirement without another read or effect', async kind => {
    const pending: ((data: unknown) => void)[] = [];
    const { actual } = await sdkPorts(() => new Promise(r => { pending.push(r); }));
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(calls).toHaveLength(1);
    if (kind === 'actor') identity.activeUserId = 'actor-b';
    if (kind === 'workspace') identity.activeTenantId = 'other-tenant';
    await act(async () => root.render(<Dialog open><AddKnowledgeFlow tenantId={tenant} replacementTarget={target} onClose={() => {}} /></Dialog>));
    if (kind === 'unmount') await act(async () => root.render(<span>Closed</span>));
    if (kind === 'actor') identity.activeUserId = 'actor-a';
    if (kind === 'workspace') identity.activeTenantId = tenant;
    if (kind !== 'unmount') await render({ tenantId: tenant, replacementTarget: target });
    const beforeLate = calls.length;
    await act(async () => pending[0](nativeReview));
    expect(calls).toHaveLength(beforeLate);
    expect(calls.every(call => call.name === 'read_tenant_knowledge_review')).toBe(true);
    expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
    expect(body()).not.toContain('Review what Paige read');
  });
  it('permits new input only after a verified both-null native idle projection', async () => {
    const { actual } = await sdkPorts(() => ({ ...nativeReview, extraction_work_id: null, pending_review: null }));
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(field('knowledge-add-content').value).toBe(target.content);
    expect(calls).toHaveLength(1); expect(mocks.submitExtraction).not.toHaveBeenCalled();
    expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('checks the same original work after a transient read failure without resubmitting', async () => {
    let fail = true;
    const { actual } = await sdkPorts(name => {
      if (name === 'get_paige_durable_work' && fail) { fail = false; return []; }
      return name === 'read_tenant_knowledge_review' ? nativeReview : [nativeStatus];
    });
    mocks.existingReview.mockImplementation(actual.readKnowledgeExtractionForDocument);
    await render({ tenantId: tenant, replacementTarget: target });
    expect(body()).toContain('Reading status failed');
    await click('Check reading');
    expect(body()).toContain('Review what Paige read');
    expect(calls.filter(c => c.name === 'get_paige_durable_work').map(c => c.args)).toEqual([{ _work_id: work }, { _work_id: work }]);
    expect(mocks.submitExtraction).not.toHaveBeenCalled(); expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
});

describe('same-document Knowledge content correction', () => {
  const target = { id: 'doc-a', tenant_id: 'tenant-a', revision: 4, title: 'Original guide', content: 'Original canonical text', summary: 'Original summary', category: 'Guide', tags: ['original'] };
  async function correction(overrides: Record<string, unknown> = {}) {
    mocks.submitExtraction.mockResolvedValue({ reference: { ...REF, revision: 5 }, status: 'claimed', replayed: false });
    mocks.extractionReview.mockResolvedValue({ ...review, record_state: 'canonical', revision: 6 });
    mocks.saveReview.mockResolvedValue({ revision: 7, outcome: 'capability_succeeded', runId: 'run-a' });
    mocks.submitPublication.mockResolvedValue({ work_id: 'pub-work', document_id: 'doc-a', status: 'claimed', replayed: false, revision: 7 });
    await render({ replacementTarget: target, ...overrides });
  }
  it('corrects the original ID through exact extraction, review and publication payloads', async () => {
    await correction();
    expect(body()).toContain('Correct Knowledge content');
    expect(field('knowledge-add-content').value).toBe(target.content);
    set(field('knowledge-add-content'), 'Corrected input');
    await click('Send to Paige');
    expect(mocks.submitExtraction.mock.calls[0][2]).toMatchObject({ doc_id: 'doc-a', expected_revision: 4, content: 'Corrected input' });
    await tick(800);
    set(field('knowledge-review-content'), 'Exact corrected review');
    await click('Save review');
    expect(mocks.saveReview).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'doc-a', 'work-a', 6, 'Exact corrected review', { title: target.title, summary: target.summary, category: target.category, tags: target.tags });
    await click('Publish to Knowledge');
    expect(mocks.hash).toHaveBeenCalledWith('Exact corrected review');
    expect(mocks.submitPublication).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'doc-a', 'work-a', 7, expect.any(String), 'a'.repeat(64));
    await tick(800);
    expect(onPublished).toHaveBeenCalledOnce();
    expect(body()).toContain('same document');
  });
  it('refuses a foreign or malformed frozen target before any submission', async () => {
    await correction({ replacementTarget: { ...target, tenant_id: 'tenant-b' } });
    expect(body()).toContain('Source unavailable');
    expect(mocks.submitExtraction).not.toHaveBeenCalled();
    expect(document.getElementById('knowledge-add-content')).toBeNull();
  });
  it('stops on a native stale-revision refusal without refreshing the target or making a new document', async () => {
    await correction();
    mocks.submitExtraction.mockRejectedValue(new ExtractionConsumerError('40001', 'KNOWLEDGE_REVISION_CONFLICT'));
    await click('Send to Paige');
    expect(body()).toContain('Submission refused');
    expect(mocks.submitExtraction).toHaveBeenCalledOnce();
    expect(mocks.submitExtraction.mock.calls[0][2]).toMatchObject({ doc_id: 'doc-a', expected_revision: 4 });
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });
  it('reuses the exact frozen replacement payload and intent after lost acknowledgement', async () => {
    await correction();
    mocks.submitExtraction.mockRejectedValueOnce(new ExtractionConsumerError('EXTRACTION_SUBMISSION_UNKNOWN', 'lost', true));
    await click('Send to Paige');
    const first = mocks.submitExtraction.mock.calls[0][2];
    await click('Retry same request');
    expect(mocks.submitExtraction.mock.calls[1][2]).toEqual(first);
    expect(first).toMatchObject({ doc_id: 'doc-a', expected_revision: 4 });
  });
  it.each(['actor', 'workspace'])('retires pending extraction after %s A→B→A without reviving old state', async kind => {
    let resolve!: (value: unknown) => void;
    await correction();
    mocks.submitExtraction.mockImplementation(() => new Promise(r => { resolve = r; }));
    await click('Send to Paige');
    const scope = mocks.submitExtraction.mock.calls[0][1];
    if (kind === 'actor') identity.activeUserId = 'actor-b'; else identity.activeTenantId = 'tenant-b';
    await render({ replacementTarget: target });
    if (kind === 'actor') identity.activeUserId = 'actor-a'; else identity.activeTenantId = 'tenant-a';
    await render({ replacementTarget: target });
    await act(async () => resolve({ reference: { ...REF, revision: 5 }, status: 'claimed', replayed: false }));
    await tick(800);
    expect(scope.isCurrent()).toBe(false);
    expect(mocks.extractionStatus).not.toHaveBeenCalled();
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });
  it('does not publish after identity changes during the reviewed-text hash await', async () => {
    await correction();
    await click('Send to Paige'); await tick(800); await click('Save review');
    let resolve!: (value: string) => void;
    mocks.hash.mockImplementation(() => new Promise(r => { resolve = r; }));
    await click('Publish to Knowledge');
    identity.activeUserId = 'actor-b'; await render({ replacementTarget: target });
    await act(async () => resolve('a'.repeat(64)));
    expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('closing a pending correction prevents polling and completion callbacks', async () => {
    let resolve!: (value: unknown) => void;
    const onClose = vi.fn();
    await correction({ onClose });
    mocks.submitExtraction.mockImplementation(() => new Promise(r => { resolve = r; }));
    await click('Send to Paige');
    await act(async () => root.render(<Dialog open><span>Closed correction</span></Dialog>));
    await act(async () => resolve({ reference: { ...REF, revision: 5 }, status: 'claimed', replayed: false }));
    await tick(800);
    expect(mocks.extractionStatus).not.toHaveBeenCalled(); expect(onPublished).not.toHaveBeenCalled();
  });
  it('rejects a review for a different document without save or publication', async () => {
    await correction();
    mocks.extractionReview.mockResolvedValue({ ...review, document_id: 'other-doc', record_state: 'canonical', revision: 6 });
    await click('Send to Paige'); await tick(800);
    expect(body()).toContain('Review unavailable');
    expect(mocks.saveReview).not.toHaveBeenCalled(); expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('keeps the target revision captured at entry even if the supplied object is later mutated', async()=>{
    const supplied={...target};await correction({replacementTarget:supplied});supplied.revision=99;
    await click('Send to Paige');
    expect(mocks.submitExtraction.mock.calls[0][2]).toMatchObject({doc_id:'doc-a',expected_revision:4});
  });
  it('closing the review never saves, publishes or deletes the existing canonical source',async()=>{
    const onClose=vi.fn();await correction({onClose});await click('Send to Paige');await tick(800);await click('Close');
    expect(onClose).toHaveBeenCalledOnce();expect(mocks.saveReview).not.toHaveBeenCalled();expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('keeps an invalid publication acknowledgement unknown and never offers another publication',async()=>{
    const {KnowledgeServiceError}=await import('@/lib/knowledge-service');
    await correction();await click('Send to Paige');await tick(800);await click('Save review');
    mocks.submitPublication.mockRejectedValue(new KnowledgeServiceError('KNOWLEDGE_RESPONSE_INVALID','malformed acknowledgement'));
    await click('Publish to Knowledge');
    expect(body()).toContain('Publication unconfirmed');expect(mocks.submitPublication).toHaveBeenCalledOnce();
    expect([...document.body.querySelectorAll('button')].some(b=>b.textContent==='Publish again')).toBe(false);
  });
  it('halts a rejected review read without leaking an unhandled error or offering publication',async()=>{
    await correction();mocks.extractionReview.mockRejectedValue(Error('invalid review envelope'));
    await click('Send to Paige');await tick(800);
    expect(body()).toContain('Review unavailable');expect(mocks.saveReview).not.toHaveBeenCalled();expect(mocks.submitPublication).not.toHaveBeenCalled();
  });
  it('reuses the uploaded object as well as the original intent when submission acknowledgement is lost',async()=>{
    await correction();await click('Text file');
    const input=field('knowledge-add-file');
    Object.defineProperty(input,'files',{value:[new File(['Corrected file text'],'guide.txt',{type:'text/plain'})]});
    await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
    mocks.submitExtraction.mockRejectedValueOnce(new ExtractionConsumerError('EXTRACTION_SUBMISSION_UNKNOWN','lost',true));
    await click('Send to Paige');const first=mocks.submitExtraction.mock.calls[0][2];await click('Retry same request');
    expect(mocks.upload).toHaveBeenCalledOnce();expect(mocks.submitExtraction.mock.calls[1][2]).toEqual(first);
    expect(first).toMatchObject({kind:'file',doc_id:'doc-a',expected_revision:4,path:expect.any(String)});
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe("the governed Knowledge add flow", () => {
  it("drives submit → read → review → publish with exact arguments and truthful completion", async () => {
    await render();
    set(field("knowledge-add-title"), "Discovery script");
    set(field("knowledge-add-content"), "The exact pasted text");
    await click("Send to Paige");
    expect(mocks.submitExtraction).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ tenantId: "tenant-a" }), expect.objectContaining({ title: "Discovery script", kind: "paste", content: "The exact pasted text" }));
    await tick(800);
    expect(mocks.extractionStatus).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), REF);
    expect(body()).toContain("Review what Paige read");
    set(field("knowledge-review-content"), "Reviewed source text");
    set(field("knowledge-review-tags"), "intake");
    await click("Save review");
    expect(mocks.saveReview).toHaveBeenCalledExactlyOnceWith(expect.anything(), "tenant-a", "doc-a", "work-a", 2, "Reviewed source text", { title: "Discovery script", summary: null, category: null, tags: ["intake"] });
    await click("Publish to Knowledge");
    expect(mocks.hash).toHaveBeenCalledWith("Reviewed source text");
    expect(mocks.submitPublication).toHaveBeenCalledExactlyOnceWith(expect.anything(), "tenant-a", "doc-a", "work-a", 3, expect.any(String), "a".repeat(64));
    await tick(800);
    expect(body()).toContain("Published. The reviewed text is now part of Knowledge.");
    expect(onPublished).toHaveBeenCalledExactlyOnceWith();
  });

  it("keeps polling while Paige reads, then proceeds", async () => {
    mocks.extractionStatus.mockResolvedValueOnce(status("claimed")).mockResolvedValueOnce(status("claimed")).mockResolvedValue(status("succeeded"));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800 + 1500 + 1500);
    expect(mocks.extractionStatus).toHaveBeenCalledTimes(3);
    expect(body()).toContain("Review what Paige read");
  });

  it("replays the SAME intent after an unconfirmed submission, never a duplicate", async () => {
    mocks.submitExtraction.mockRejectedValueOnce(new ExtractionConsumerError("EXTRACTION_SUBMISSION_UNKNOWN", "lost", true));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    expect(body()).toContain("Submission unconfirmed");
    expect(body()).toContain("never a duplicate");
    await click("Retry same request");
    expect(mocks.submitExtraction).toHaveBeenCalledTimes(2);
    const first = mocks.submitExtraction.mock.calls[0][2] as { intent_id: string };
    const second = mocks.submitExtraction.mock.calls[1][2] as { intent_id: string };
    expect(second.intent_id).toBe(first.intent_id);
  });

  it("halts honestly when the reading fails and offers no publish path", async () => {
    mocks.extractionStatus.mockResolvedValue(status("failed", { safe_summary: "The stored file could not be read." }));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    expect(body()).toContain("Reading failed");
    expect(body()).toContain("The stored file could not be read.");
    expect(mocks.extractionReview).not.toHaveBeenCalled();
  });

  it("reloads the review after a save conflict instead of repeating the save", async () => {
    mocks.saveReview.mockRejectedValueOnce(new KnowledgeReviewServiceError("40001", "KNOWLEDGE_REVIEW_CONFLICT"));
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    set(field("knowledge-review-content"), "Reviewed once");
    await click("Save review");
    expect(body()).toContain("Review changed");
    await click("Reload review");
    expect(mocks.extractionReview).toHaveBeenCalledTimes(2);
    expect(mocks.saveReview).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Review what Paige read");
  });

  it("refuses a second publication while one is in flight", async () => {
    const { KnowledgeServiceError } = await import("@/lib/knowledge-service");
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    mocks.submitPublication.mockRejectedValueOnce(new KnowledgeServiceError("55000", "KNOWLEDGE_PUBLICATION_PENDING"));
    await click("Publish to Knowledge");
    expect(body()).toContain("Already publishing");
    expect(body()).toContain("do not start another");
  });

  it("never re-publishes after an unconfirmed publication; check status only", async () => {
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    await click("Publish to Knowledge");
    mocks.publicationStatus.mockResolvedValue({ phase: "reconcile", status: "outcome_unknown", errorCode: "completion_unknown" });
    await tick(800 + 1500);
    expect(body()).toContain("Publication unconfirmed");
    expect(body()).toContain("do not publish again");
    expect([...document.body.querySelectorAll("button")].some(b => b.textContent?.trim() === "Publish again")).toBe(false);
    expect(mocks.submitPublication).toHaveBeenCalledTimes(1);
  });

  it("a failed publication may publish again under a NEW intent", async () => {
    mocks.publicationStatus.mockResolvedValueOnce({ phase: "resolved", status: "failed", errorCode: "embedding_failed" }).mockResolvedValue({ phase: "resolved", status: "succeeded" });
    await render();
    set(field("knowledge-add-title"), "Notes");
    set(field("knowledge-add-content"), "text");
    await click("Send to Paige");
    await tick(800);
    await click("Save review");
    await click("Publish to Knowledge");
    await tick(800 + 1500);
    expect(body()).toContain("Publication failed");
    await click("Publish again");
    expect(mocks.submitPublication).toHaveBeenCalledTimes(2);
    const first = mocks.submitPublication.mock.calls[0][5] as string;
    const second = mocks.submitPublication.mock.calls[1][5] as string;
    expect(second).not.toBe(first);
    await tick(800 + 1500);
    expect(onPublished).toHaveBeenCalledExactlyOnceWith();
  });

  it("rejects unsupported files before any upload", async () => {
    await render();
    await click("Text file");
    const input = field("knowledge-add-file") as unknown as HTMLInputElement & { files: FileList };
    Object.defineProperty(input, "files", { value: { 0: new File(["x"], "doc.pdf", { type: "application/pdf" }), length: 1, item: () => new File(["x"], "doc.pdf") } });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    set(field("knowledge-add-title"), "Notes");
    await click("Send to Paige");
    expect(body()).toContain(".txt, .md, .markdown, .csv and .json");
    expect(mocks.submitExtraction).not.toHaveBeenCalled();
  });
});
