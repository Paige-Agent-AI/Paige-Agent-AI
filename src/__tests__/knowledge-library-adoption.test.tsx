// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeDocuments } from '../hooks/useKnowledgeDocuments';
import { useSoloKnowledge } from '../solo/data/useSoloKnowledge';
import { KnowledgeMetadataEditor } from '../components/knowledge/KnowledgeMetadataEditor';
import { KnowledgeServiceError, type KnowledgeDocument } from '../lib/knowledge-service';
const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useTenantContext', () => ({ useOptionalTenantContext: () => ({ activeTenantId: 'tenant-a' }) }));
vi.mock('@/lib/knowledge-service', async importOriginal => ({ ...await importOriginal<object>(), readKnowledge: api.read, updateKnowledgeMetadata: api.update }));
vi.mock('@/components/ui/dialog', () => ({ DialogContent: 'section', DialogHeader: 'header', DialogTitle: 'h2', DialogDescription: 'p' }));
const doc: KnowledgeDocument = { id:'doc-a', tenant_id:'tenant-a', revision:1, title:'Reference', summary:null, category:null, tags:[], source:'paste', source_url:null, chunk_count:1, created_at:'2026-09-30', updated_at:'2026-09-30', share_to_network:false, network_review_status:'none' };
let root: Root; let host: HTMLDivElement;
function mount(element: React.ReactNode) { host=document.createElement('div');document.body.append(host);root=createRoot(host);return act(async()=>{root.render(element);}); }
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.clearAllMocks();});
function deferred<T>() { let resolve!: (v:T)=>void;return {promise:new Promise<T>(r=>{resolve=r;}),resolve}; }
async function click(text:string) { const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!; expect(button).toBeTruthy(); await act(async()=>button.click()); }
describe('canonical Knowledge read lifecycle',()=>{
 let value: ReturnType<typeof useKnowledgeDocuments>;
 function View({tenant,id}:{tenant:string|null;id?:string}) {value=useKnowledgeDocuments(tenant,id);return createElement('p',null,value.docs.map(d=>d.title).join(','));}
 it('makes no request without resolved scope and distinguishes it from empty',async()=>{await mount(createElement(View,{tenant:null}));expect(api.read).not.toHaveBeenCalled();expect(value.error).toMatch(/workspace/i);expect(value.docs).toEqual([]);});
 it('discards old A responses even after switching back to A',async()=>{const first=deferred<KnowledgeDocument[]>(),second=deferred<KnowledgeDocument[]>(),third=deferred<KnowledgeDocument[]>();api.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);await mount(createElement(View,{tenant:'tenant-a'}));await act(async()=>root.render(createElement(View,{tenant:'tenant-b'})));await act(async()=>root.render(createElement(View,{tenant:'tenant-a'})));await act(async()=>third.resolve([{...doc,title:'Current'}]));await act(async()=>first.resolve([{...doc,title:'Stale'}]));await act(async()=>second.resolve([{...doc,tenant_id:'tenant-b',title:'Wrong'}]));expect(value.docs.map(d=>d.title)).toEqual(['Current']);});
 it('separates read failure from genuine empty and allows explicit reload',async()=>{api.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);await mount(createElement(View,{tenant:'tenant-a'}));expect(value.error).toBeTruthy();await act(async()=>value.reload());expect(value.error).toBeNull();expect(value.docs).toEqual([]);});
 it('paginates through the canonical seam',async()=>{api.read.mockResolvedValueOnce(Array.from({length:100},(_,i)=>({...doc,id:`doc-${i}`}))).mockResolvedValueOnce([{...doc,id:'last'}]);await mount(createElement(View,{tenant:'tenant-a'}));expect(value.hasMore).toBe(true);await act(async()=>value.loadMore());expect(api.read).toHaveBeenLastCalledWith(expect.anything(),'tenant-a',{limit:100,offset:100});expect(value.docs).toHaveLength(101);expect(value.hasMore).toBe(false);});
 it('reads a requested source by exact id independently of its list position',async()=>{api.read.mockResolvedValue([doc]);await mount(createElement(View,{tenant:'tenant-a',id:'doc-a'}));expect(api.read).toHaveBeenCalledWith(expect.anything(),'tenant-a',{documentId:'doc-a',limit:100,offset:0});});
 it('rejects a mismatched source in a targeted response',async()=>{api.read.mockResolvedValue([doc]);await mount(createElement(View,{tenant:'tenant-a',id:'different'}));expect(value.docs).toEqual([]);expect(value.error).toBeTruthy();});
 it('fences changed document requests as well as changed tenants',async()=>{const old=deferred<KnowledgeDocument[]>();api.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{...doc,id:'doc-b'}]);await mount(createElement(View,{tenant:'tenant-a',id:'doc-a'}));await act(async()=>root.render(createElement(View,{tenant:'tenant-a',id:'doc-b'})));await act(async()=>old.resolve([doc]));expect(value.docs[0].id).toBe('doc-b');});
});
describe('Solo exact-source truth', () => {
 let value: ReturnType<typeof useSoloKnowledge>;
 function View() { value = useSoloKnowledge('doc-a'); return null; }
 for (const failure of [false, true]) it(`does not revive stale list metadata after exact read ${failure ? 'fails' : 'returns empty'}`, async () => {
   api.read.mockImplementation((_client, _tenant, options) => options.documentId ? (failure ? Promise.reject(new Error('offline')) : Promise.resolve([])) : Promise.resolve([doc]));
   await mount(createElement(View));
   expect(value.docs.some(row => row.id === 'doc-a')).toBe(false);
   expect(value.requestedDocumentState).toBe(failure ? 'error' : 'missing');
 });
});
describe('revision-bound metadata editor',()=>{
 const onSaved=vi.fn(),onClose=vi.fn();
 async function editor(){await mount(createElement(KnowledgeMetadataEditor,{document:doc,tenantId:'tenant-a',onSaved,onClose}));}
 async function save(){await click('Save metadata');}
 it('keeps a saved-without-receipt warning visible and does not repeat the write',async()=>{api.update.mockResolvedValue({document:{...doc,revision:2},outcome:'capability_completed_unrecorded',runId:'run'});await editor();await save();expect(api.update).toHaveBeenCalledOnce();expect(api.update.mock.calls[0].slice(1,4)).toEqual(['tenant-a','doc-a',1]);expect(onSaved).toHaveBeenCalledOnce();expect(onClose).not.toHaveBeenCalled();expect(host.textContent).toMatch(/saved.*receipt/i);expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Save metadata')).toBe(false);});
 it('requires readback and review after a revision conflict, never overwrites automatically',async()=>{api.update.mockRejectedValue(new KnowledgeServiceError('40001','KNOWLEDGE_REVISION_CONFLICT'));api.read.mockResolvedValue([{...doc,revision:4,title:'Someone else changed this'}]);await editor();await save();expect(host.textContent).toMatch(/changed/i);await click('Read current version');expect(api.update).toHaveBeenCalledOnce();expect((host.querySelector('#knowledge-title') as HTMLInputElement).value).toBe('Reference');expect(host.textContent).toContain('Someone else changed this');await click('Use current version');expect((host.querySelector('#knowledge-title') as HTMLInputElement).value).toBe('Someone else changed this');});
 it('lost acknowledgement never retries, even after readback',async()=>{api.update.mockRejectedValue(new Error('transport'));api.read.mockResolvedValue([{...doc,revision:2}]);await editor();await save();await click('Read current version');expect(api.update).toHaveBeenCalledOnce();expect(host.textContent).toMatch(/could not confirm|uncertain/i);expect(onSaved).not.toHaveBeenCalled();});
 it('does not notify a closed editor when a save resolves late',async()=>{const pending=deferred<unknown>();api.update.mockReturnValue(pending.promise);await editor();await save();await act(async()=>root.unmount());await act(async()=>pending.resolve({document:{...doc,revision:2},outcome:'capability_succeeded',runId:'run'}));expect(onSaved).not.toHaveBeenCalled();});
 it('refuses server-denied edits without claiming persistence or enabling retry',async()=>{api.update.mockRejectedValue(new KnowledgeServiceError('42501','KNOWLEDGE_FORBIDDEN'));await editor();await save();expect(host.textContent).toContain('save was refused');expect(onSaved).not.toHaveBeenCalled();expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Save metadata')).toBe(false);});
 it('fences late saves after workspace switch-back',async()=>{const pending=deferred<unknown>();api.update.mockReturnValue(pending.promise);await editor();await save();await act(async()=>root.render(createElement(KnowledgeMetadataEditor,{document:{...doc,tenant_id:'tenant-b'},tenantId:'tenant-b',onSaved,onClose})));await act(async()=>root.render(createElement(KnowledgeMetadataEditor,{document:doc,tenantId:'tenant-a',onSaved,onClose})));await act(async()=>pending.resolve({document:{...doc,revision:2},outcome:'capability_succeeded',runId:'run'}));expect(onSaved).not.toHaveBeenCalled();});
});
