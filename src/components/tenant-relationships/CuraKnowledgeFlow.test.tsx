import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {webcrypto} from 'node:crypto';
import {setImmediate as nextNodeTurn,setTimeout as nodeDelay} from 'node:timers';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CuraKnowledgePanel} from './CuraKnowledgePanel';

// Real panel, review hook, closed service adapters and original AddKnowledgeFlow.
// Only transport/identity are synthetic. This is not authenticated/provider proof.
const f=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn()}));
const actor='b3b50100-0000-4000-8000-000000000001',tenant='b3b50200-0000-4000-8000-000000000001';
const doc='b3b50300-0000-4000-8000-000000000001',extract='b3b50400-0000-4000-8000-000000000001',publication='b3b50500-0000-4000-8000-000000000001',run='b3b50600-0000-4000-8000-000000000001';
const now='2026-10-21T12:00:00Z';
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({activeTenantId:tenant,activeUserId:actor,accountContextStatus:'ready',accountContextLoading:false,loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({
 supabase:{
  rpc:(...args:unknown[])=>f.rpc(...args),
  functions:{invoke:(...args:unknown[])=>f.invoke(...args)},
  auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}})}
 }
}));
let host:HTMLDivElement,root:Root,revision:number,saved:boolean,published:boolean,exists:boolean,metadata:{title:string;summary:string|null;category:string|null;tags:string[]};
let inventoryHold:ReturnType<typeof deferred<{data:ReturnType<typeof inventory>;error:null}>>|null;
const content='Original extracted answer for the customer.';
const pending=()=>({schema_version:1,extracted_content:content,reviewed_content:saved?content:null,extraction_version:'native-v1',coverage:'complete'});
const association=()=>({contract_version:1,association:published?'matched':saved?'not_submitted':'unavailable',work_id:published?publication:null,work_status:published?'succeeded':null,generation_id:published?publication:null,outcome:published?'capability_succeeded':null});
const review=()=>({tenant_id:tenant,document_id:doc,revision,record_state:published?'canonical':'draft',source_coverage:'complete',source_binding:null,extraction_source_binding:null,extraction_work_id:published?null:extract,pending_review:published?null:pending(),publication:association()});
const work=()=>({work_id:extract,capability_key:'knowledge.extract',work_kind:'knowledge_extract',work_status:'succeeded',attempt_count:1,max_attempts:3,blocked_reason:null,error_code:null,safe_summary:null,created_at:now,updated_at:now,settled_at:now});
const inventory=()=>({tenant_id:tenant,audience:'business',as_of:now,documents:exists?[{document_id:doc,document_revision:revision,title:metadata.title,source_state:published?'prepared':'draft',pending_review:!published,source_fingerprint:'a'.repeat(64),generation_id:published?publication:null,share:null,share_state:'not_shared',updated_at:now}]:[],next_offset:exists?1:0,has_more:false});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const flush=async()=>act(async()=>{for(let i=0;i<2;i++){await new Promise<void>(resolve=>nextNodeTurn(resolve));for(let j=0;j<80;j++)await Promise.resolve();}});
const mount=async()=>{await act(async()=>root.render(<MemoryRouter><CuraKnowledgePanel tenantId={tenant} onBack={()=>{}}/></MemoryRouter>));await flush();};
const button=(text:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent?.trim()===text)!;
const click=async(text:string)=>{await act(async()=>button(text).click());await flush();};
const publicationSubmitted=async()=>{
 const deadline=Date.now()+3000;
 // WebCrypto settles on a real native turn. Wait for that observable transport,
 // rather than assuming two microtask/Immediate rounds under parallel load.
 while(!f.rpc.mock.calls.some(call=>call[0]==='submit_tenant_knowledge_publication')&&Date.now()<deadline){
  await act(async()=>{await new Promise<void>(resolve=>nodeDelay(resolve,10));});await flush();
 }
 expect(f.rpc.mock.calls.some(call=>call[0]==='submit_tenant_knowledge_publication')).toBe(true);
};
const change=async(id:string,value:string)=>{
 const input=document.getElementById(id) as HTMLInputElement|HTMLTextAreaElement;
 const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
};
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});vi.stubGlobal('crypto',webcrypto);
 revision=3;saved=false;published=false;exists=true;inventoryHold=null;
 metadata={title:'Draft service FAQ',summary:null,category:null,tags:[]};
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='read_client_portal_business_knowledge')return inventoryHold?inventoryHold.promise:{data:inventory(),error:null};
  // Native canonical reader deliberately excludes the original draft.
  if(name==='read_tenant_knowledge')return{data:{tenant_id:tenant,documents:[]},error:null};
  if(name==='read_tenant_knowledge_review')return{data:review(),error:null};
  if(name==='read_tenant_knowledge_pending')return{data:{contract_version:1,tenant_id:tenant,document_id:doc,revision,title:metadata.title,record_state:'draft',review_available:true,extraction_work_id:extract,work:work(),pending_review:pending(),pending_review_metadata:saved?metadata:null},error:null};
  if(name==='get_paige_durable_work')return{data:[work()],error:null};
  if(name==='save_tenant_knowledge_review'){
   metadata=args.p_metadata as typeof metadata;revision++;saved=true;
   return{data:{tenant_id:tenant,document_id:doc,work_id:extract,revision,verified_readback:true,outcome:'capability_succeeded',run_id:run},error:null};
  }
  if(name==='submit_tenant_knowledge_publication'){
   const expected=revision;published=true;revision++;
   return{data:{work_id:publication,document_id:doc,status:'claimed',replayed:false,revision:expected},error:null};
  }
  throw Error('Unexpected transport operation: '+name);
 });
 f.invoke.mockImplementation(async(name:string)=>{if(name!=='kb-extract-submit')throw Error(name);exists=true;revision=1;saved=false;
  return{data:{ok:true,work_id:extract,document_id:doc,status:'claimed',replayed:false,revision:1},error:null};});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});

it('resumes the real original draft review and saves against its original work, without another extraction',async()=>{
 await mount();await click('Review or correct');
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review what Paige read');
 expect((document.getElementById('knowledge-review-content') as HTMLTextAreaElement).value).toBe(content);
 expect((document.getElementById('knowledge-review-title') as HTMLInputElement).value).toBe(metadata.title);
 expect(f.invoke).not.toHaveBeenCalled();
 await click('Save review');
 const write=f.rpc.mock.calls.find(call=>call[0]==='save_tenant_knowledge_review')!;
 expect(write[1]).toMatchObject({p_doc_id:doc,p_work_id:extract,p_expected_revision:3,p_content:content,p_metadata:metadata});
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Publish to Knowledge');
 expect(f.invoke).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(call=>call[0]==='set_client_portal_business_knowledge_share')).toBe(false);
});
it('retains saved staged metadata and resumes publication without replacing the source',async()=>{
 saved=true;metadata={title:'Saved FAQ',summary:'Approved summary',category:'Services',tags:['onboarding']};
 await mount();await click('Review or correct');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Your saved review is ready');
 await click('Publish to Knowledge');
 await publicationSubmitted();
 const write=f.rpc.mock.calls.find(call=>call[0]==='submit_tenant_knowledge_publication')!;
 expect(write[1]).toMatchObject({p_doc_id:doc,p_work_id:extract,p_expected_revision:3});expect(write[1].p_review_hash).toMatch(/^[a-f0-9]{64}$/);
 expect(metadata).toEqual({title:'Saved FAQ',summary:'Approved summary',category:'Services',tags:['onboarding']});
 expect(f.invoke).not.toHaveBeenCalled();expect(f.rpc.mock.calls.some(call=>call[0]==='save_tenant_knowledge_review')).toBe(false);
});
it('settles a focus refresh after the real Add source dialog is closed',async()=>{
 await mount();await click('Add a source');expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add Knowledge');
 inventoryHold=deferred();act(()=>window.dispatchEvent(new Event('focus')));await flush();
 expect(host.querySelector('[aria-label="Loading CURA Knowledge"]')).not.toBeNull();await click('Close');
 inventoryHold.resolve({data:inventory(),error:null});await flush();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.textContent).toContain('Draft service FAQ');expect(host.querySelector('[aria-label="Loading CURA Knowledge"]')).toBeNull();expect(f.invoke).not.toHaveBeenCalled();
});
it('settles publication refresh even when Done closes the real original flow first',async()=>{
 exists=false;revision=1;await mount();await click('Add a source');
 await change('knowledge-add-title','New service FAQ');await change('knowledge-add-content',content);await click('Send to Paige');
 await act(async()=>vi.advanceTimersByTimeAsync(800));await flush();expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review what Paige read');
 await click('Save review');await click('Publish to Knowledge');await publicationSubmitted();inventoryHold=deferred();
 await act(async()=>vi.advanceTimersByTimeAsync(800));await flush();expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Published to Knowledge');
 expect(host.querySelector('[aria-label="Loading CURA Knowledge"]')).not.toBeNull();await click('Done');
 inventoryHold.resolve({data:inventory(),error:null});await flush();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.querySelector('[aria-label="Loading CURA Knowledge"]')).toBeNull();expect(host.textContent).toContain('Private Knowledge');
 expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls.filter(call=>call[0]==='submit_tenant_knowledge_publication')).toHaveLength(1);
 expect(f.rpc.mock.calls.some(call=>call[0]==='set_client_portal_business_knowledge_share')).toBe(false);
});
