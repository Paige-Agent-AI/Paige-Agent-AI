import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useCuraKnowledge} from './useCuraKnowledge';
import type {CuraKnowledgeSource,CuraShareProposal} from '@/lib/cura-knowledge';

const f=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),unsubscribe:vi.fn(),listener:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:()=>f.getUser(),onAuthStateChange:(cb:typeof f.listener)=>{f.listener=cb;return{data:{subscription:{unsubscribe:f.unsubscribe}}};}},rpc:(...args:unknown[])=>f.rpc(...args)}}));
const scope={actor:'b3b20100-0000-4000-8000-000000000001',tenant:'b3b20200-0000-4000-8000-000000000001'};
const other='b3b20200-0000-4000-8000-000000000002',doc='b3b20300-0000-4000-8000-000000000001';
const generation='b3b20400-0000-4000-8000-000000000001',shareId='b3b20500-0000-4000-8000-000000000001',now='2026-10-21T12:00:00Z';
const terms={kind:'faq' as const,validFrom:null,validUntil:null};
const source=():CuraKnowledgeSource=>({document_id:doc,document_revision:3,title:'Test service FAQ',source_state:'prepared',pending_review:false,source_fingerprint:'a'.repeat(64),generation_id:generation,share:null,share_state:'not_shared',updated_at:now});
let rows:CuraKnowledgeSource[],state:ReturnType<typeof useCuraKnowledge>,host:HTMLDivElement,root:Root;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const flush=async()=>act(async()=>{for(let i=0;i<50;i++)await Promise.resolve();});
function Probe({business=scope.tenant,actor=scope.actor,reference=null}:{business?:string;actor?:string;reference?:string|null}){state=useCuraKnowledge({actor,tenant:business},reference);return <output>{state.phase}:{state.outcome}:{state.notice}</output>;}
const mount=async(props:Parameters<typeof Probe>[0]={})=>{await act(async()=>root.render(<Probe {...props}/>));await flush();};
const inventory=(args:Record<string,unknown>)=>({tenant_id:args.p_tenant_id,audience:'business',as_of:now,documents:rows,next_offset:(args.p_offset as number)+rows.length,has_more:false});
const proposal=(args:Record<string,unknown>):CuraShareProposal=>({tenant_id:args.p_tenant_id as string,audience:'business',document_id:doc,available:args.p_available as boolean,
 customer_kind:args.p_customer_kind as 'faq',valid_from:args.p_valid_from as null,valid_until:args.p_valid_until as null,expected_share_revision:rows[0].share?.share_revision??0,
 proposal_hash:'b'.repeat(64),source_fingerprint:'a'.repeat(64),document_revision:3,generation_id:generation,
 source:args.p_available?'paste':null,title:args.p_available?'Test service FAQ':null,preview:args.p_available?'Approved test answer':null,preview_truncated:false,already_shared:false});
const grant=(args:Record<string,unknown>)=>{
 const available=args.p_available as boolean,rev=(args.p_expected_share_revision as number)+1;
 rows=[{...source(),share_state:available?'shared':'withdrawn',share:{share_id:shareId,share_revision:rev,document_revision:3,generation_id:generation,source_fingerprint:'a'.repeat(64),customer_kind:'faq',valid_from:null,valid_until:null,state:available?'shared':'withdrawn',granted_at:now,revoked_at:available?null:now,receipt_id:args.p_operation_id as string}}];
 return{tenant_id:scope.tenant,audience:'business',document_id:doc,share_id:shareId,receipt_id:args.p_operation_id,replayed:false,changed:true,original_revision:rev,current_revision:rev,customer_kind:'faq',valid_from:null,valid_until:null};
};
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
const writes=()=>f.rpc.mock.calls.filter(c=>c[0]==='set_client_portal_business_knowledge_share');
beforeEach(()=>{
 vi.clearAllMocks();rows=[source()];f.listener=null;f.getUser.mockResolvedValue({data:{user:{id:scope.actor}},error:null});
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='read_client_portal_business_knowledge')return{data:inventory(args),error:null};
  if(name==='prepare_client_portal_business_knowledge_share')return{data:proposal(args),error:null};
  if(name==='read_tenant_knowledge')return{data:{tenant_id:scope.tenant,documents:[{id:doc,tenant_id:scope.tenant,revision:3,title:'Test service FAQ',summary:null,category:null,tags:null,source:'paste',source_url:null,chunk_count:1,created_at:now,updated_at:now,share_to_network:false,network_review_status:'none',content:'Approved test answer'}]},error:null};
  return{data:grant(args),error:null};
 });host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();});

it('requires an exact fresh review and deliberate confirmation; inventory alone never shares',async()=>{
 await mount();await act(async()=>state.confirm());expect(writes()).toHaveLength(0);
 await act(async()=>state.review(doc,true,terms));expect(state.outcome).toBe('review');expect(writes()).toHaveLength(0);
 await act(async()=>state.confirm());expect(writes()).toHaveLength(1);expect(state.outcome).toBe('saved');expect(state.rows[0].share?.receipt_id).toBe(writes()[0][1].p_operation_id);
});
it('prepares withdrawal through the original writer and preserves customer-specific boundary',async()=>{
 grant({p_available:true,p_expected_share_revision:1,p_operation_id:other});await mount();
 await act(async()=>state.review(doc,false,terms));expect(state.proposal?.preview).toBeNull();await act(async()=>state.confirm());
 expect(writes()[0][1]).toMatchObject({p_available:false,p_expected_share_revision:2});expect(state.outcome).toBe('saved');expect(state.notice).toContain('Customer-specific');
});
it('locks double confirmation synchronously',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const pending=deferred<{data:ReturnType<typeof grant>;error:null}>(),original=f.rpc.getMockImplementation()!;let ack!:ReturnType<typeof grant>;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){ack=grant(args);return pending.promise;}return original(name,args);});
 let first!:Promise<void>,second!:Promise<void>;act(()=>{first=state.confirm();second=state.confirm();});await flush();expect(writes()).toHaveLength(1);
 pending.resolve({data:ack,error:null});await act(async()=>{await first;await second;});expect(state.outcome).toBe('saved');
});
it('recovers a lost acknowledgement with the exact original receipt and zero further writes',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){grant(args);throw Error('lost acknowledgement');}return original(name,args);});
 await act(async()=>state.confirm());expect(state.outcome).toBe('unknown');await act(async()=>{await state.confirm();await state.load();await state.review(doc,true,terms);});
 expect(writes()).toHaveLength(1);await act(async()=>state.recover());expect(state.outcome).toBe('saved');expect(writes()).toHaveLength(1);
});
it('never treats a missing or foreign receipt as a successful save',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){const result=grant(args);return{data:{...result,receipt_id:other},error:null};}return original(name,args);});
 await act(async()=>state.confirm());expect(state.outcome).toBe('unknown');rows[0].share!.receipt_id=other;await act(async()=>state.recover());expect(state.outcome).toBe('unknown');expect(writes()).toHaveLength(1);
});
it('requires new review after a native source-version conflict',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='set_client_portal_business_knowledge_share'?{data:null,error:{code:'40001'}}:original(name,args));
 await act(async()=>state.confirm());expect(state.outcome).toBe('conflict');expect(state.proposal).toBeNull();await act(async()=>state.confirm());expect(writes()).toHaveLength(1);
});
it('separates an original recorded decision from subsequent source drift',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{const result=await original(name,args);if(name==='set_client_portal_business_knowledge_share'){rows[0].document_revision=4;rows[0].source_fingerprint='c'.repeat(64);rows[0].share_state='source_changed';rows[0].share!.state='source_changed';}return result;});
 await act(async()=>state.confirm());expect(state.outcome).toBe('saved');expect(state.notice).toContain('has since changed');expect(state.notice).not.toContain('can use');
});
it('retains exact recovery across same-actor token rotation and transient Auth failure',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){grant(args);throw Error('lost');}return original(name,args);});
 await act(async()=>state.confirm());act(()=>f.listener?.('TOKEN_REFRESHED',{user:{id:scope.actor}}));f.getUser.mockResolvedValueOnce({data:{user:null},error:{message:'offline'}});
 await act(async()=>state.recover());expect(state.outcome).toBe('unknown');await act(async()=>state.recover());expect(state.outcome).toBe('saved');expect(writes()).toHaveLength(1);
});
it.each(['acknowledged','interrupted'])('clears private data and permits safe exit after %s readback is denied',async mode=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){const result=await original(name,args);if(mode==='interrupted')throw Error('lost');return result;}if(name==='read_client_portal_business_knowledge')return{data:null,error:{code:'42501'}};return original(name,args);});
 await act(async()=>state.confirm());if(mode==='interrupted')await act(async()=>state.recover());expect(state.phase).toBe('unavailable');expect(state.rows).toEqual([]);expect(state.notice).toContain('may already be saved');
 await act(async()=>state.confirm());expect(writes()).toHaveLength(1);
});
it('retires late A-to-B-to-A review results by incarnation',async()=>{
 await mount();const pending=deferred<{data:CuraShareProposal;error:null}>(),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='prepare_client_portal_business_knowledge_share'?pending.promise:original(name,args));
 let job!:Promise<void>;act(()=>{job=state.review(doc,true,terms);});await flush();await mount({business:other});await mount();
 pending.resolve({data:proposal({p_tenant_id:scope.tenant,p_available:true,p_customer_kind:'faq',p_valid_from:null,p_valid_until:null}),error:null});await act(async()=>job);
 expect(state.outcome).toBe('list');expect(state.proposal).toBeNull();expect(writes()).toHaveLength(0);
});
it('discards proposals on sign-out and cannot confirm them after Auth changes',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));act(()=>f.listener?.('SIGNED_OUT',null));await flush();expect(state.rows).toEqual([]);expect(state.proposal).toBeNull();await act(async()=>state.confirm());expect(writes()).toHaveLength(0);
});
it('cancels an in-flight review without changing the source or grant',async()=>{
 await mount();const pending=deferred<{data:CuraShareProposal;error:null}>(),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='prepare_client_portal_business_knowledge_share'?pending.promise:original(name,args));
 let job!:Promise<void>;act(()=>{job=state.review(doc,true,terms);});await flush();act(()=>state.cancel());pending.resolve({data:proposal({p_tenant_id:scope.tenant,p_available:true,p_customer_kind:'faq',p_valid_from:null,p_valid_until:null}),error:null});await act(async()=>job);
 expect(state.outcome).toBe('list');expect(state.proposal).toBeNull();expect(writes()).toHaveLength(0);
});
it('opens correction from the current canonical source without writing or sharing',async()=>{
 await mount();await act(async()=>state.correct(doc));expect(state.outcome).toBe('correction');expect(state.correction?.content).toBe('Approved test answer');expect(writes()).toHaveLength(0);
});
it('refuses a correction read that is no longer the inventory version',async()=>{
 await mount();rows[0].document_revision=4;await act(async()=>state.correct(doc));expect(state.outcome).toBe('conflict');expect(state.correction).toBeNull();expect(writes()).toHaveLength(0);
});
it('allows an explicit uncertain-status exit without a retry or later stale success',async()=>{
 await mount();await act(async()=>state.review(doc,true,terms));const original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='set_client_portal_business_knowledge_share'){grant(args);throw Error('lost');}return original(name,args);});
 await act(async()=>state.confirm());expect(state.outcome).toBe('unknown');act(()=>state.leave());await act(async()=>{await state.recover();await state.confirm();await state.load();});expect(state.phase).toBe('unavailable');expect(writes()).toHaveLength(1);
});
it.each(['publication refresh','focus refresh'])('closing an original publication dialog does not strand a pending %s',async reason=>{
 await mount();const read=deferred<{data:ReturnType<typeof inventory>;error:null}>(),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='read_client_portal_business_knowledge'?read.promise:original(name,args));
 let job:Promise<void>|undefined;
 if(reason==='publication refresh')act(()=>{job=state.load();});else act(()=>window.dispatchEvent(new Event('focus')));
 await flush();expect(state.phase).toBe('loading');act(()=>state.cancel());read.resolve({data:inventory({p_tenant_id:scope.tenant,p_offset:0}),error:null});
 if(job)await act(async()=>job);await flush();expect(state.phase).toBe('ready');expect(state.rows).toHaveLength(1);expect(writes()).toHaveLength(0);
});

it('reads the exact linked source directly, even outside the ordinary first page',async()=>{
 await mount({reference:doc});
 expect(f.rpc).toHaveBeenCalledExactlyOnceWith('read_client_portal_business_knowledge',expect.objectContaining({p_document_id:doc,p_offset:0,p_query:''}));
 expect(state.focusedId).toBe(doc);expect(state.rows[0].document_id).toBe(doc);expect(writes()).toHaveLength(0);
 await act(async()=>state.load());expect(f.rpc.mock.calls.every(c=>c[1].p_document_id===doc)).toBe(true);
 await act(async()=>state.correct(doc));expect(state.correction?.id).toBe(doc);expect(writes()).toHaveLength(0);
});
it('keeps a missing linked source distinct from empty inventory and never substitutes another source',async()=>{
 rows=[];await mount({reference:doc});expect(state.phase).toBe('ready');expect(state.focusedId).toBe(doc);expect(state.rows).toEqual([]);
 expect(f.rpc.mock.calls.every(c=>c[1].p_document_id===doc)).toBe(true);
 await act(async()=>state.search(''));expect(f.rpc.mock.calls.at(-1)?.[1].p_document_id).toBeNull();expect(state.focusedId).toBeNull();expect(writes()).toHaveLength(0);
});
it('refuses a foreign linked read without a global-inventory fallback',async()=>{
 f.rpc.mockResolvedValue({data:{tenant_id:other,audience:'business',as_of:now,documents:[source()],next_offset:1,has_more:false},error:null});
 await mount({reference:doc});expect(state.phase).toBe('error');expect(state.rows).toEqual([]);expect(f.rpc).toHaveBeenCalledTimes(1);expect(writes()).toHaveLength(0);
});
it('retires late reference A-to-B-to-A reads within the same authenticated business',async()=>{
 const late=deferred<{data:ReturnType<typeof inventory>;error:null}>(),original=f.rpc.getMockImplementation()!;
 f.rpc.mockImplementationOnce(()=>late.promise);await mount({reference:doc});expect(state.phase).toBe('loading');
 rows=[{...source(),document_id:other}];await mount({reference:other});expect(state.rows[0].document_id).toBe(other);
 rows=[source()];await mount({reference:doc});late.resolve({data:inventory({p_tenant_id:scope.tenant,p_offset:0}),error:null});await flush();
 expect(state.focusedId).toBe(doc);expect(state.rows[0].document_id).toBe(doc);expect(writes()).toHaveLength(0);expect(original).toBeDefined();
});
