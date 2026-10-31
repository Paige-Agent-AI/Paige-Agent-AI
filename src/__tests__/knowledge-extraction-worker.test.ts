import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {sourceHash} from '../../supabase/functions/_shared/knowledge-extraction';
const state=vi.hoisted(()=>({rpc:vi.fn(),authorized:true,model:vi.fn(),binary:{pdf:vi.fn(),docx:vi.fn()},handler:null as null|((r:Request)=>Promise<Response>)}));
// This Node handler harness models the Deno-only parser port. Actual pinned
// PDF/DOCX implementations run separately in the original native Deno suite.
vi.mock('../../supabase/functions/_shared/knowledge-binary-adapters.ts',()=>({knowledgeBinaryParsers:state.binary}));
vi.mock('../../supabase/functions/_shared/systems-check-http.ts',()=>({adminClient:()=>({rpc:state.rpc}),isAuthorizedInternalCaller:async()=>state.authorized,json:(status:number,body:unknown)=>new Response(JSON.stringify(body),{status})}));
vi.mock('../../supabase/functions/_shared/model-router.ts',()=>({callModel:state.model}));
vi.mock('../../supabase/functions/_shared/document-production.ts',()=>({validateDocumentBrief:()=>({ok:true,value:{}}),buildDocumentAuthoringPrompt:()=>[],parseDocumentModelOutput:()=>({docType:'guide',title:'Guide',blocks:[]})}));
const work='70000000-0000-0000-0000-000000000001';const doc='20000000-0000-0000-0000-000000000001';
beforeEach(async()=>{vi.resetModules();state.rpc.mockReset();state.model.mockReset();state.binary.pdf.mockReset();state.binary.docx.mockReset();state.authorized=true;vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='SUPABASE_URL'?'https://fixture.invalid':'local-test-only'},serve:(handler:typeof state.handler)=>{state.handler=handler;}});// Execute the real worker handler through Vitest's mocked runtime. Its Deno module graph is typechecked by the affected-edge CI gate, not the browser TS project.
const edgeHandlerPath='../../supabase/functions/paige-document-worker/index.ts';await import(/* @vite-ignore */ edgeHandlerPath);});
afterEach(()=>vi.unstubAllGlobals());
const request=(body:unknown)=>new Request('https://worker.invalid',{method:'POST',body:JSON.stringify(body)});
describe('actual native worker handler with fake ports',()=>{
 it('refuses untrusted callers before dispatch',async()=>{state.authorized=false;const response=await state.handler!(request({mode:'knowledge-run',work_id:work}));expect(response.status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();expect(state.model).not.toHaveBeenCalled();expect(state.binary.pdf).not.toHaveBeenCalled();expect(state.binary.docx).not.toHaveBeenCalled();});
 it('binds the actual worker PDF route to its original work and distinct source/text evidence',async()=>{
  const tenant='00000000-0000-0000-0000-000000000001';const actor='10000000-0000-0000-0000-000000000001';
  const bytes=new TextEncoder().encode('%PDF-1.4 synthetic worker source');const text='A source-backed report.';
  const rawHash=await sourceHash(bytes);const textHash=await sourceHash(new TextEncoder().encode(text));
  const source={object_id:doc,object_name:tenant+'/agreement.pdf',bucket:'tenant-knowledge',sha256:rawHash,byte_size:bytes.length,mime_type:'application/pdf'};
  state.binary.pdf.mockResolvedValue({pages:[text],totalPages:1});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes,{headers:{'content-type':'application/pdf'}})));
  state.rpc.mockImplementation(async(n:string)=>({error:null,data:n==='start_knowledge_extraction'
   ?{status:'claimed',work_id:work,document_id:doc,server_key:'key',attempt:1,revision:1,actor_id:actor,tenant_id:tenant,source,input_hash:rawHash}
   :n==='resolve_knowledge_extraction_source'?source
   :{verified_readback:true,phase:'awaiting_review',document_id:doc,outcome:'capability_succeeded',source_sha256:rawHash,text_sha256:textHash}}));
  const response=await state.handler!(request({mode:'knowledge-run',work_id:work}));
  expect(await response.json()).toMatchObject({status:'succeeded',phase:'awaiting_review',document_id:doc});
  expect(state.binary.pdf).toHaveBeenCalledTimes(1);expect(state.binary.docx).not.toHaveBeenCalled();expect(state.model).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenCalledWith('resolve_knowledge_extraction_source',{_actor:actor,_tenant:tenant,_path:source.object_name});
  expect(state.rpc).toHaveBeenCalledWith('complete_knowledge_extraction',expect.objectContaining({_work_id:work,_hash:rawHash,_content:text,_evidence:expect.objectContaining({format:'pdf',source_sha256:rawHash,text_sha256:textHash,coverage:'partial'})}));
  expect(state.rpc.mock.calls.filter(([name])=>name==='complete_knowledge_extraction')).toHaveLength(1);
 });
 it('routes knowledge-run to pending-review RPCs without a provider',async()=>{const hash=await sourceHash(new TextEncoder().encode('Text'));state.rpc.mockImplementation(async(n:string)=>({error:null,data:n==='start_knowledge_extraction'?{status:'claimed',work_id:work,document_id:doc,server_key:'key',attempt:1,revision:1,source:null,input:'Text',input_hash:hash}:{verified_readback:true,phase:'awaiting_review',document_id:doc,outcome:'capability_succeeded'}}));const response=await state.handler!(request({mode:'knowledge-run',work_id:work}));expect(await response.json()).toMatchObject({status:'succeeded',phase:'awaiting_review'});expect(state.model).not.toHaveBeenCalled();expect(state.rpc.mock.calls.map(([n])=>n)).toEqual(['start_knowledge_extraction','complete_knowledge_extraction']);});
 it('existing sweep drains Knowledge from the same handler',async()=>{state.rpc.mockImplementation(async(n:string)=>({error:null,data:n==='recover_paige_document_work'?[]:n==='recover_knowledge_extraction'?[{work_id:work}]:{status:'blocked'}}));const response=await state.handler!(request({mode:'sweep'}));expect(await response.json()).toMatchObject({recovered:0,results:[],knowledge_results:[{status:'blocked'}]});expect(state.rpc.mock.calls.map(([n])=>n)).toEqual(['recover_paige_document_work','recover_knowledge_extraction','start_knowledge_extraction','recover_knowledge_publication']);});
 it('legacy document route still uses its own provider and completion',async()=>{state.model.mockResolvedValue({content:'fixture',provider:'fake',model:'fake'});state.rpc.mockImplementation(async(n:string)=>({error:null,data:n==='start_paige_document_work_execution'?[{work_id:work,work_status:'claimed',server_idempotency_key:'key',attempt_count:1,request_payload:{}}]:[{work_status:'succeeded',content_id:doc}]}));const response=await state.handler!(request({mode:'run',work_id:work}));expect(await response.json()).toMatchObject({status:'succeeded',content_id:doc});expect(state.model).toHaveBeenCalledTimes(1);expect(state.rpc.mock.calls.map(([n])=>n)).toEqual(['start_paige_document_work_execution','complete_paige_document_work']);expect(state.binary.pdf).not.toHaveBeenCalled();expect(state.binary.docx).not.toHaveBeenCalled();});
});
