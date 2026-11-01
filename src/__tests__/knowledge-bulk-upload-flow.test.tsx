// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {KnowledgeFlowObservers} from '@/solo/knowledge/knowledge-flow-observers';
const api=vi.hoisted(()=>({prepare:vi.fn(),upload:vi.fn(),inspect:vi.fn(),submit:vi.fn(),review:vi.fn(),restore:vi.fn()}));
const tenant='11111111-1111-4111-8111-111111111111';
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({activeTenantId:'11111111-1111-4111-8111-111111111111',activeUserId:'22222222-2222-4222-8222-222222222222',loading:false,accountContextStatus:'ready'})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{storage:{from:()=>({})}}}));
vi.mock('@/lib/knowledge-extraction-service',async(original)=>({...await original<typeof import('@/lib/knowledge-extraction-service')>(),prepareKnowledgeUploadSelection:api.prepare,uploadKnowledgeFileOnce:api.upload,inspectKnowledgeUploadedFile:api.inspect,submitKnowledgeExtraction:api.submit,readKnowledgeExtractionReview:api.review,readKnowledgePendingReviewTarget:api.restore}));
vi.mock('@/solo/knowledge/AddKnowledgeFlow',()=>({AddKnowledgeFlow:({onPublished,onClose,onPublicationVerified,replacementTarget,sourceLifetime}:{onPublished:()=>void;onClose:()=>void;replacementTarget:{id:string;revision:number};sourceLifetime:()=>boolean}&KnowledgeFlowObservers)=><><button onClick={()=>{onPublicationVerified?.(Object.freeze({tenantId:tenant,documentId:replacementTarget.id,revision:replacementTarget.revision+1,workId:'published-'+replacementTarget.id,generationId:'published-'+replacementTarget.id,outcome:'capability_succeeded'}),{isCurrent:sourceLifetime});onPublished();}}>Verified original publication</button><button onClick={onClose}>Return to files</button></>}));
import {BulkKnowledgeUploadFlow} from '@/solo/knowledge/BulkKnowledgeUploadFlow';
import {Dialog} from '@/components/ui/dialog';
let root:Root,host:HTMLDivElement;
const rows=()=>['Agreement.pdf','Notes.txt'].map((name,i)=>({phase:'prepared',name,intentId:`intent-${i}`,source:{path:tenant+`/source-${i}`,bytes:new Uint8Array([i]),mime:'text/plain'}}));
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);api.prepare.mockResolvedValue(rows());api.upload.mockImplementation(async(_c,_s,source)=>({phase:'stored',path:source.path}));api.inspect.mockImplementation(async(_c,_s,source)=>({phase:'stored',path:source.path}));api.submit.mockResolvedValue({reference:{tenantId:tenant,documentId:'doc',workId:'work'},status:'claimed'});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.resetAllMocks();});
const click=async(text:string)=>{const b=[...document.body.querySelectorAll('button')].find(b=>b.textContent===text);expect(b).toBeTruthy();await act(async()=>b!.click());};
const render=async(onPublished?:()=>void,observers:KnowledgeFlowObservers={})=>{await act(async()=>root.render(<Dialog open><BulkKnowledgeUploadFlow tenantId={tenant} onClose={()=>{}} onBack={()=>{}} onPublished={onPublished} {...observers}/></Dialog>));};
async function choose(files=[new File(['one'],'Agreement.pdf'),new File(['two'],'Notes.txt')]){const input=document.body.querySelector('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:files});await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,25));});}
it.each([
  ['claimed','requested · open to check progress'],
  ['succeeded','finished · review required'],
  ['failed','failed · inspect original'],
  ['blocked','paused · inspect original'],
  ['cancelled','cancelled · inspect original'],
  ['expired','needs recovery · inspect original'],
  ['outcome_unknown','unconfirmed · inspect original'],
])('shows the last confirmed %s reading state without claiming publication',async(status,label)=>{
  api.submit.mockResolvedValue({reference:{tenantId:tenant,documentId:'doc',workId:'work'},status,replayed:false});
  const published=vi.fn();await render(published);await choose();await click('Upload and read files');
  expect(document.body.textContent).toContain('Last confirmed reading: '+label);
  expect(document.body.textContent).not.toContain('Original reading available');
  expect(document.body.textContent).not.toContain('Reviewed text published');
  expect(published).not.toHaveBeenCalled();expect(api.submit).toHaveBeenCalledTimes(2);
  expect(api.review).not.toHaveBeenCalled();expect(api.restore).not.toHaveBeenCalled();
});
it('accepts multiple files and submits each verified source through its own original intent',async()=>{await render();expect(document.body.querySelector('input')?.multiple).toBe(true);await choose();await click('Upload and read files');expect(api.upload).toHaveBeenCalledTimes(2);expect(api.submit.mock.calls.map(c=>c[2])).toEqual(rows().map(r=>({kind:'file',intent_id:r.intentId,title:r.name,path:r.source.path})));});
it('isolates uncertain upload and uses inspect-only recovery without another upload',async()=>{api.upload.mockResolvedValueOnce({phase:'upload_unknown',path:rows()[0].source.path});await render();await choose();await click('Upload and read files');expect(api.submit).toHaveBeenCalledTimes(1);await click('Inspect original');expect(api.upload).toHaveBeenCalledTimes(2);expect(api.submit).toHaveBeenCalledTimes(1);await click('Read stored source');expect(api.submit).toHaveBeenCalledTimes(2);expect(api.inspect.mock.calls[0][2].path).toBe(rows()[0].source.path);});
it('stops before the next transfer while retaining a source already stored',async()=>{let resolve!:(v:unknown)=>void;api.upload.mockImplementationOnce(()=>new Promise(r=>resolve=r));await render();await choose();await click('Upload and read files');await click('Stop remaining uploads');await act(async()=>resolve({phase:'stored',path:rows()[0].source.path}));expect(api.upload).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();expect(document.body.textContent).toContain('Not started');expect(document.body.textContent).toContain('Stored source');});
it('isolates one local file-read rejection and uploads readable siblings',async()=>{const files=['First.txt','Unreadable.txt','Last.txt'].map(name=>new File(['text'],name));files.forEach((file,i)=>Object.defineProperty(file,'arrayBuffer',{value:()=>i===1?Promise.reject(new Error('local read failed')):Promise.resolve(new Uint8Array([i]).buffer)}));api.prepare.mockResolvedValue([...rows(),{...rows()[1],name:'Last.txt',intentId:'intent-2',source:{...rows()[1].source,path:tenant+'/source-2'}}]);await render();await choose(files);await click('Upload and read files');expect(api.upload).toHaveBeenCalledTimes(2);expect(api.upload.mock.calls.map(c=>c[2].path)).toEqual([rows()[0].source.path,tenant+'/source-2']);expect(api.submit).toHaveBeenCalledTimes(2);});
it('forwards original completion only after all admitted files have verified publication',async()=>{const complete=vi.fn();api.review.mockResolvedValue({revision:2,record_state:'draft',pending_review:{}});api.restore.mockResolvedValue({id:'doc',tenant_id:tenant,revision:2,title:'Reviewed',content:'Source',tags:[]});await render(complete);await choose();await click('Upload and read files');expect(complete).not.toHaveBeenCalled();await click('Open reading');await click('Verified original publication');expect(complete).not.toHaveBeenCalled();await click('Return to files');await click('Open reading');await click('Verified original publication');expect(complete).toHaveBeenCalledTimes(1);});
it('correlates each original admission with a captured selection index and immutable native references',async()=>{
  api.submit.mockImplementation(async(_c,_s,input)=>({reference:{tenantId:tenant,documentId:'doc-'+input.intent_id,workId:'work-'+input.intent_id,intentId:input.intent_id,revision:1},status:'claimed',replayed:false}));
  const observer=vi.fn();await render(undefined,{onExtractionAcknowledged:observer});await choose();await click('Upload and read files');
  expect(observer.mock.calls.map(([value,context])=>({value,index:context.selectionIndex}))).toEqual(rows().map((row,i)=>({value:{reference:{tenantId:tenant,documentId:'doc-'+row.intentId,workId:'work-'+row.intentId,intentId:row.intentId,revision:1},status:'claimed',replayed:false},index:i})));
  expect(observer.mock.calls.every(([value,context])=>Object.isFrozen(value)&&Object.isFrozen(value.reference)&&Object.isFrozen(context)&&context.isCurrent())).toBe(true);
  await click('Close');expect(observer.mock.calls.every(([,context])=>!context.isCurrent())).toBe(true);
});
it('isolates rejected per-file host notifications while continuing the original transfer once',async()=>{
  const observer=vi.fn(()=>Promise.reject(new Error('host link unavailable')));
  api.submit.mockImplementation(async(_c,_s,input)=>({reference:{tenantId:tenant,documentId:'doc-'+input.intent_id,workId:'work-'+input.intent_id,intentId:input.intent_id},status:'claimed',replayed:false}));
  await render(undefined,{onExtractionAcknowledged:observer});await choose();await click('Upload and read files');
  expect(observer).toHaveBeenCalledTimes(2);expect(api.upload).toHaveBeenCalledTimes(2);expect(api.submit).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain('Reading submission unconfirmed');
});
it('keeps publication notifications per original file and emits each generation only once',async()=>{
  api.submit.mockImplementation(async(_c,_s,input)=>({reference:{tenantId:tenant,documentId:'doc-'+input.intent_id,workId:'work-'+input.intent_id,intentId:input.intent_id},status:'claimed',replayed:false}));
  api.review.mockResolvedValue({revision:3,record_state:'draft',pending_review:{}});
  api.restore.mockImplementation(async(_c,_s,ref)=>({id:ref.documentId,tenant_id:tenant,revision:3,title:'Reviewed',content:'Source',tags:[]}));
  const observer=vi.fn();await render(undefined,{onPublicationVerified:observer});await choose();await click('Upload and read files');
  await click('Open reading');await click('Verified original publication');await click('Verified original publication');
  expect(observer).toHaveBeenCalledOnce();expect(observer.mock.calls[0][0]).toEqual({tenantId:tenant,documentId:'doc-intent-0',revision:4,workId:'published-doc-intent-0',generationId:'published-doc-intent-0',outcome:'capability_succeeded'});
  expect(observer.mock.calls[0][1].selectionIndex).toBe(0);
  await click('Return to files');await click('Open reading');await click('Verified original publication');
  expect(observer).toHaveBeenCalledTimes(2);expect(observer.mock.calls[1][1].selectionIndex).toBe(1);expect(api.submit).toHaveBeenCalledTimes(2);
});
it('does not notify or start another file after close while an admission acknowledgment is pending',async()=>{
  let resolve!:(value:unknown)=>void;api.submit.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const observer=vi.fn();
  await render(undefined,{onExtractionAcknowledged:observer});await choose();await click('Upload and read files');await click('Close');
  await act(async()=>resolve({reference:{tenantId:tenant,documentId:'doc',workId:'work',intentId:'intent-0'},status:'claimed',replayed:false}));
  expect(observer).not.toHaveBeenCalled();expect(api.upload).toHaveBeenCalledOnce();expect(api.submit).toHaveBeenCalledOnce();
});
