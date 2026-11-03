import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReviewedSetupPanel,ReviewedSetupFacts} from './ReviewedSetupFacts';
import {cleanSoloSetupBrief} from './settings-setup-contract';
import type {ReviewedSetupPort} from './data/reviewed-setup-client';
const backend=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({loading:false,accountContextStatus:'ready',
 activeUserId:'10000000-0000-4000-8000-000000000001',activeTenantId:'20000000-0000-4000-8000-000000000001'})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>backend.rpc(...args),auth:{getUser:async()=>({
 data:{user:{id:'10000000-0000-4000-8000-000000000001'}},error:null})}}}));
const actorId='10000000-0000-4000-8000-000000000001',tenantId='20000000-0000-4000-8000-000000000001';
const reviewId='30000000-0000-4000-8000-000000000001',receiptId='60000000-0000-4000-8000-000000000001';
const proposal={schemaVersion:1,actorId,tenantId,reviewId,expectedUpdatedAt:null,expectedContextRevision:0,
 facts:[{field:'offers',value:'Advisory',sourceDecision:'adopt',reference:{contractVersion:1,tenantId,
  documentId:'40000000-0000-4000-8000-000000000001',revision:2,contentSha256:'a'.repeat(64)},excerpts:[{start:0,end:8,text:'Advisory'}]}]};
const recorded={status:'recorded',receiptId,current:true,receipt:{schemaVersion:1,receiptId,requestId:reviewId,reviewId,
 actorId,tenantId,purpose:'setup_business_facts',selectedFacts:proposal.facts,selectionHash:'b'.repeat(64),
 updatedAt:'2026-11-02T12:00:00Z',contextRevision:1}};
let root:Root|null=null,host:HTMLDivElement;
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;});
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=null;host?.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(port:ReviewedSetupPort){host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root?.render(<ReviewedSetupPanel port={port} actorId={actorId} tenantId={tenantId}
  brief={cleanSoloSetupBrief(null)} contextRevision={0} canEdit disabled={false} onSaved={()=>{}}/>));}
async function click(text:string){const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);
 expect(button,`button ${text}`).toBeTruthy();await act(async()=>button?.click());}
it('full reload discovers the same approval receipt without staging or saving',async()=>{
 const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:{proposal:null,approval:{requestId:reviewId,inspection:recorded}},error:null}));
 await render({getScope:async()=>({actorId,tenantId}),rpc});await click('Review facts or reopen receipt');
 expect(host.textContent).toContain(receiptId);expect(host.textContent).toContain('offers: Advisory');
 expect(rpc.mock.calls).toHaveLength(1);expect(rpc.mock.calls[0][0]).toBe('read_solo_reviewed_business_facts');
});
it('server-staged review after UNKNOWN must inspect before any explicit approval',async()=>{
 const rpc=vi.fn(async(name:string,_args:Record<string,unknown>)=>({data:name==='read_solo_reviewed_business_facts'?{proposal,approval:null}:
  name==='inspect_solo_reviewed_business_facts'?recorded:proposal,error:null}));
 await render({getScope:async()=>({actorId,tenantId}),rpc});await click('Review facts or reopen receipt');
 expect(host.textContent).toContain('Inspect original save');expect(host.textContent).not.toContain('Approve and save selected facts');
 await click('Inspect original save');expect(host.textContent).toContain(receiptId);
 expect(rpc.mock.calls.map(c=>c[0])).toEqual(['read_solo_reviewed_business_facts','inspect_solo_reviewed_business_facts']);
 expect(rpc.mock.calls[1][1]._request_id).toBe(reviewId);
});
it('unmount prevents a late source receipt from being rendered or retried',async()=>{
 let release!:(v:unknown)=>void;const pending=new Promise(resolve=>{release=resolve;});
 const rpc=vi.fn(async()=>pending as Promise<{data:unknown;error:unknown}>);
 await render({getScope:async()=>({actorId,tenantId}),rpc});
 await click('Review facts or reopen receipt');await act(async()=>root?.unmount());root=null;
 await act(async()=>release({data:{proposal:null,approval:{requestId:reviewId,inspection:recorded}},error:null}));
 expect(host.textContent).toBe('');expect(rpc).toHaveBeenCalledTimes(1);
});
it('missing backend refuses without claiming stored facts or approval',async()=>{
 const rpc=vi.fn(async()=>({data:null,error:{code:'PGRST202'}}));await render({getScope:async()=>({actorId,tenantId}),rpc});
 await click('Review facts or reopen receipt');expect(host.textContent).toContain('could not be verified');
 expect(host.textContent).not.toContain('Approval receipt');expect(rpc).toHaveBeenCalledTimes(1);
});
it('recovered absent save can return to edit; edited facts require selection and a new explicit review',async()=>{
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='read_solo_reviewed_business_facts'?{proposal,approval:null}:
  name==='inspect_solo_reviewed_business_facts'?{status:'absent_at_read'}:
  {...proposal,reviewId:args._review_id,facts:args._facts},error:null}));
 await render({getScope:async()=>({actorId,tenantId}),rpc});await click('Review facts or reopen receipt');
 expect(host.textContent).not.toContain('Edit reviewed facts');await click('Inspect original save');await click('Edit reviewed facts');
 const checkbox=host.querySelector<HTMLInputElement>('input[type=checkbox]')!;expect(checkbox.checked).toBe(false);
 expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Review selected facts')?.disabled).toBe(true);
 const textarea=host.querySelector<HTMLTextAreaElement>('#review-value-offers')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Corrected advisory');
  textarea.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>checkbox.click());await click('Review selected facts');
 const stages=rpc.mock.calls.filter(c=>c[0]==='stage_solo_reviewed_business_facts');expect(stages).toHaveLength(2);
 expect(stages[1][1]._review_id).not.toBe(reviewId);
 expect((stages[1][1]._facts as typeof proposal.facts)[0].value).toBe('Corrected advisory');
 expect(rpc.mock.calls.filter(c=>c[0]==='save_solo_reviewed_business_facts')).toHaveLength(0);
});
it('actual host boundary preserves verified receipt through authoritative refresh, then removes it on settled role denial',async()=>{
 backend.rpc.mockResolvedValue({data:{proposal:null,approval:{requestId:reviewId,inspection:recorded}},error:null});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const display=(canEdit:boolean,refreshing:boolean)=>root?.render(<ReviewedSetupFacts tenantId={tenantId}
  brief={cleanSoloSetupBrief(null)} contextRevision={1} canEdit={canEdit} refreshing={refreshing} disabled={refreshing} onSaved={()=>{}}/>);
 await act(async()=>display(true,false));await click('Review facts or reopen receipt');expect(host.textContent).toContain(receiptId);
 await act(async()=>display(false,true));expect(host.textContent).toContain(receiptId);
 expect(host.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
 await act(async()=>display(true,false));expect(host.textContent).toContain(receiptId);
 await act(async()=>display(false,false));expect(host.textContent).toBe('');
 expect(backend.rpc).toHaveBeenCalledTimes(1);
});
it('later manual Setup save makes the mounted old receipt historical, without disclosing old approved facts',async()=>{
 const rpc=vi.fn(async()=>({data:{proposal:null,approval:{requestId:reviewId,inspection:recorded}},error:null}));
 const port={getScope:async()=>({actorId,tenantId}),rpc};await render(port);await click('Review facts or reopen receipt');
 expect(host.textContent).toContain('offers: Advisory');
 await act(async()=>root?.render(<ReviewedSetupPanel port={port} actorId={actorId} tenantId={tenantId}
  brief={cleanSoloSetupBrief({updatedAt:recorded.receipt.updatedAt,offers:'Advisory'})} contextRevision={1}
  canEdit disabled={false} onSaved={()=>{}}/>));
 expect(host.textContent).toContain('offers: Advisory');expect(host.textContent).not.toContain('receipt is historical');
 await act(async()=>root?.render(<ReviewedSetupPanel port={port} actorId={actorId} tenantId={tenantId}
  brief={cleanSoloSetupBrief({updatedAt:'2026-11-02T12:01:00Z',offers:'Manual correction'})} contextRevision={2}
  canEdit disabled={false} onSaved={()=>{}}/>));
 expect(host.textContent).toContain('receipt is historical');expect(host.textContent).not.toContain('offers: Advisory');
 expect(rpc).toHaveBeenCalledTimes(1);
});
it('lost save acknowledgement then complete client destruction reopens the same receipt with one save',async()=>{
 let committed=false;
 const rpc=vi.fn(async(name:string)=>{
  if(name==='read_solo_reviewed_business_facts')return {data:committed?
   {proposal:null,approval:{requestId:reviewId,inspection:recorded}}:{proposal,approval:null},error:null};
  if(name==='inspect_solo_reviewed_business_facts')return {data:committed?recorded:{status:'absent_at_read'},error:null};
  if(name==='stage_solo_reviewed_business_facts')return {data:proposal,error:null};
  if(name==='save_solo_reviewed_business_facts'){committed=true;throw Error('lost acknowledgement');}
  throw Error('Unexpected RPC');
 });
 const port={getScope:async()=>({actorId,tenantId}),rpc};await render(port);
 await click('Review facts or reopen receipt');await click('Inspect original save');await click('Approve and save selected facts');
 expect(host.textContent).toContain('Inspect original save');
 await act(async()=>root?.unmount());root=null;host.remove();await render(port);await click('Review facts or reopen receipt');
 expect(host.textContent).toContain(receiptId);expect(host.textContent).toContain('offers: Advisory');
 expect(rpc.mock.calls.filter(c=>c[0]==='save_solo_reviewed_business_facts')).toHaveLength(1);
});
it('selected Windows-newline document passage retains exact original UTF16 offsets and quotation',async()=>{
 let digestComplete:Promise<ArrayBuffer>|null=null;
 vi.stubGlobal('crypto',{randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:(...args:Parameters<typeof webcrypto.subtle.digest>)=>{
  digestComplete=webcrypto.subtle.digest(...args);return digestComplete;
 }}});
 const doc={id:proposal.facts[0].reference.documentId,tenant_id:tenantId,revision:2,title:'Neutral service note',summary:null,
  category:null,tags:[],source:'paste',source_url:null,chunk_count:1,created_at:'2026-11-02T12:00:00Z',updated_at:'2026-11-02T12:00:00Z',
  share_to_network:false,network_review_status:'none',content:'Line one\r\nAdvisory'};
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>({data:name==='read_solo_reviewed_business_facts'?{proposal:null,approval:null}:
  name==='read_tenant_knowledge'?{tenant_id:tenantId,documents:[doc]}:
  {...proposal,reviewId:args._review_id,facts:args._facts},error:null}));
 await render({getScope:async()=>({actorId,tenantId}),rpc});await click('Review facts or reopen receipt');await click('Choose a Knowledge document');
 const select=host.querySelector<HTMLSelectElement>(`#reviewed-source-${actorId}`)!;
 await act(async()=>{select.value=doc.id;select.dispatchEvent(new Event('change',{bubbles:true}));
  await vi.waitFor(()=>expect(digestComplete).not.toBeNull());await digestComplete;});
 const input=host.querySelector<HTMLTextAreaElement>('#reviewed-value')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Advisory');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const decision=host.querySelector<HTMLSelectElement>('#reviewed-decision')!;
 await act(async()=>{decision.value='adopt';decision.dispatchEvent(new Event('change',{bubbles:true}));});
 const source=host.querySelector<HTMLTextAreaElement>('#reviewed-source-text')!;
 expect(source.value).toBe('Line one\nAdvisory');source.setSelectionRange(9,17);
 await click('Add selected passage for review');await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
 await click('Review selected facts');
 const facts=rpc.mock.calls.find(c=>c[0]==='stage_solo_reviewed_business_facts')![1]._facts as typeof proposal.facts;
 expect(facts[0].excerpts).toEqual([{start:10,end:18,text:'Advisory'}]);vi.unstubAllGlobals();
});
