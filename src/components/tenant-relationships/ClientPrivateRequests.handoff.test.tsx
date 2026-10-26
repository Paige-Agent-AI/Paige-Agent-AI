import React,{act,useEffect,useState,useSyncExternalStore} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ClientActionItems} from './ClientActionItems';
import {PaigeAIChat} from '@/components/dashboard/PaigeAIChat';
import {clearPaigeClientScope,getPaigeClientScope,readPaigeOpenScope,setPaigeClientScope,subscribePaigeClientScope} from '@/solo/paigeClientScope';
import {handOffPaigePrompt,takePendingPaigePrompt} from '@/lib/paigePromptHandoff';
import {hasUnsavedWork} from '@/hooks/useBeforeUnloadGuard';
import {setComposerDraftSessionScope} from '@/lib/paigeComposerScopeState';

// Real Portal editor/controller, original client-focus store, original handoff
// and real owner composer. Only identity/network/history/provider edges are mocks.
const actor='e09e0000-0000-4000-8000-000000000001',tenant='e09e0000-0000-4000-8000-000000000002';
const contact='e09e0000-0000-4000-8000-000000000003',work='e09e0000-0000-4000-8000-000000000004';
const intent='e09e0000-0000-4000-8000-000000000005',created='2026-10-24T12:00:00.123456Z';
type AuthListener=(event:string,session:{user:{id:string}}|null)=>void;
const f=vi.hoisted(()=>({rpc:vi.fn(),fetch:vi.fn(),authListeners:new Set<AuthListener>(),tenant:'',actor:'',changeActorOnOpen:false,changeTenantOnOpen:false,ignoreFocus:false,hiddenChat:false,isFetched:true,threads:[] as Array<{id:string;title:string;updated_at:string}>}));
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:null})}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>({activeTenantId:f.tenant,activeUserId:f.actor,accountContextLoading:false,accountContextStatus:'ready',activeTenant:{account_number:'test-tenant-solo'}})}));
vi.mock('@/hooks/useScopedUserId',()=>({useScopedUserId:()=>f.actor}));
vi.mock('@/lib/playbook',()=>({usePlaybook:()=>({persona:{name:'PAIGE'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/voice/DictationMicButton',()=>({DictationMicButton:()=> <button type="button">Dictate</button>}));
vi.mock('@/hooks/useChatDocumentUpload',()=>({useChatDocumentUpload:()=>({attachedDoc:null,isDragOver:false,fileInputRef:{current:null},acceptString:'.pdf',handleFileSelect:vi.fn(),handleDragOver:vi.fn(),handleDragLeave:vi.fn(),handleDrop:vi.fn(),removeAttachment:vi.fn(),openFilePicker:vi.fn(),setAttachedDoc:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args),auth:{
 getUser:async()=>({data:{user:{id:f.actor}},error:null}),
 getSession:async()=>({data:{session:{access_token:'test-only-no-provider'}}}),
 onAuthStateChange:(listener:AuthListener)=>{f.authListeners.add(listener);return {data:{subscription:{unsubscribe:()=>f.authListeners.delete(listener)}}};}
}}}));
vi.mock('@/hooks/usePaigeThreads',()=>({usePaigeThreads:()=>({threads:f.threads,isLoading:!f.isFetched,isFetched:f.isFetched,loadTurns:async()=>[],ensureThread:vi.fn(async()=> 'test-thread'),onTurnPersisted:vi.fn(),renameThread:vi.fn(),archiveThread:vi.fn(),deleteThread:vi.fn()})}));
vi.mock('@/components/paige/live/PaigeLiveConversation',()=>({PaigeLiveConversation:()=> <button type="button">Talk live with Paige</button>}));

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const result={schema_version:1,actor_id:actor,tenant_id:tenant,contact_id:contact,intent_id:intent,found:true,
 request:{work_id:work,status:'assigned',created_at:created,version:created,content_state:'prepared',title:'Review the welcome guide',body:'Private preparation only.',customer_action_id:null},
 recipient_available:true,missing_is_rejection:false,read_at:created};
const native=(name:string)=>{
 if(name==='list_pending_customer_actions')return {data:{schema_version:1,actor_id:actor,tenant_id:tenant,contact_id:contact,access_state:'open',joined:true,shared_context_consent:false,more_actions:false,actions:[]},error:null};
 if(name==='list_client_portal_request_drafts')return {data:{schema_version:1,actor_id:actor,tenant_id:tenant,contact_id:contact,requests:[{intent_id:intent,request:result.request}],more:false,next_cursor:null,recipient_available:true,missing_is_rejection:false,read_at:created},error:null};
 if(name==='read_client_portal_request_draft')return {data:result,error:null};
 throw Error(`Unexpected write or native call: ${name}`);
};

/** Use the original SoloApp open/focus ordering and the original composer. No
 * fake consumer can turn a lost question into a passing handoff assertion. */
function Workspace(){
 const [,refresh]=useState(0);
 const [revealed,setRevealed]=useState(!f.hiddenChat);
 const client=useSyncExternalStore(subscribePaigeClientScope,()=>getPaigeClientScope(f.tenant),()=>null);
 useEffect(()=>{const listener=(event:Event)=>{
  const detail=(event as CustomEvent).detail,scope=readPaigeOpenScope(detail,f.tenant);
  if(scope&&!f.ignoreFocus)setPaigeClientScope(scope);
  if(f.changeActorOnOpen){f.actor='e09e0000-0000-4000-8000-000000000099';refresh(value=>value+1);}
  if(f.changeTenantOnOpen){f.tenant='e09e0000-0000-4000-8000-000000000098';refresh(value=>value+1);}
  handOffPaigePrompt(detail?.prompt);
  setRevealed(true);
 };window.addEventListener('paige:open',listener);return()=>window.removeEventListener('paige:open',listener);},[]);
 return <><ClientActionItems contactId={contact} clientName="Test customer"/>
  {revealed&&<PaigeAIChat hideHeader fill enableHistory soloTenantSafety clientId={client?.clientId??null}/>}</>;
}
let host:HTMLDivElement,root:Root;
const flush=()=>act(async()=>{for(let i=0;i<30;i++)await Promise.resolve();});
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text)!;
const click=async(text:string)=>{await act(async()=>button(text).click());await flush();};
const composer=()=>host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message PAIGE"]')!;
async function openSaved(){
 await act(async()=>root.render(<Workspace/>));await flush();await click('Prepare request');
 const saved=host.querySelector<HTMLButtonElement>('.trc-private-history li button')!;
 await act(async()=>saved.click());await flush();expect(host.textContent).toContain('Saved privately');
}
beforeEach(()=>{
 f.tenant=tenant;f.actor=actor;f.changeActorOnOpen=false;f.changeTenantOnOpen=false;f.ignoreFocus=false;f.hiddenChat=false;f.isFetched=true;f.threads=[];f.rpc.mockReset().mockImplementation(native);f.fetch.mockReset().mockRejectedValue(Error('No model or provider request permitted'));vi.stubGlobal('fetch',f.fetch);
 // The real shell binds the authenticated draft session. Without this fixture
 // boundary, an in-memory draft from a preceding test legitimately survives.
 setComposerDraftSessionScope({kind:'ready',tenantId:tenant,userId:actor});
 takePendingPaigePrompt();clearPaigeClientScope();host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();takePendingPaigePrompt();clearPaigeClientScope();setComposerDraftSessionScope({kind:'clear'});vi.unstubAllGlobals();expect(f.authListeners.size).toBe(0);expect(hasUnsavedWork()).toBe(false);});

it('fills the real owner composer on the first review from an unfocused conversation, without sending',async()=>{
 await openSaved();expect(getPaigeClientScope(tenant)).toBeNull();expect(composer().value).toBe('');
 const reads=f.rpc.mock.calls.length;await click('Review sharing with PAIGE');
 expect(getPaigeClientScope(tenant)?.clientId).toBe(contact);
 expect(composer().value).toContain(`Customer record: ${contact}`);
 expect(composer().value).toContain(`Saved request reference: ${work}`);
 expect(composer().value).not.toContain(result.request.body);expect(composer().value).not.toContain(result.request.title);
 expect(f.rpc.mock.calls).toHaveLength(reads);expect(f.fetch).not.toHaveBeenCalled();
});

it('fills the target client on the first review from a different client conversation',async()=>{
 setPaigeClientScope({tenantId:tenant,clientId:'test-other-client',label:'Other test customer'});
 await openSaved();await click('Review sharing with PAIGE');
 expect(getPaigeClientScope(tenant)?.clientId).toBe(contact);expect(composer().value).toContain(work);
 expect(composer().value).not.toContain(result.request.body);expect(f.fetch).not.toHaveBeenCalled();
});

it('preserves a same-client unsent draft and appends the review question once',async()=>{
 setPaigeClientScope({tenantId:tenant,clientId:contact,label:'Test customer'});await openSaved();
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(composer(),'Keep my current question.');composer().dispatchEvent(new Event('input',{bubbles:true}));});
 await click('Review sharing with PAIGE');expect(composer().value).toMatch(/^Keep my current question\.\n\nHelp me review/);
 expect(composer().value.split(`Saved request reference: ${work}`)).toHaveLength(2);expect(f.fetch).not.toHaveBeenCalled();
});

it('does not hand the previous actor’s request to the composer if the actor changes during focus',async()=>{
 await openSaved();f.changeActorOnOpen=true;await click('Review sharing with PAIGE');
 expect(f.actor).not.toBe(actor);expect(composer().value).not.toContain(work);expect(takePendingPaigePrompt()).toBeNull();
 expect(f.fetch).not.toHaveBeenCalled();expect(f.rpc.mock.calls.every(([name])=>name!=='share_client_portal_request'&&name!=='prepare_client_portal_request')).toBe(true);
});

it('uses the original pending handoff when Chat is first mounted by the review',async()=>{
 f.hiddenChat=true;await openSaved();expect(composer()).toBeNull();await click('Review sharing with PAIGE');
 expect(composer().value).toContain(work);expect(takePendingPaigePrompt()).toBeNull();expect(f.fetch).not.toHaveBeenCalled();
});

it('waits for the original scoped composer to become ready without sending',async()=>{
 f.isFetched=false;await openSaved();await click('Review sharing with PAIGE');expect(composer().value).toBe('');
 f.isFetched=true;await act(async()=>root.render(<Workspace/>));await flush();
 expect(composer().value).toContain(work);expect(composer().value.split(work)).toHaveLength(2);expect(f.fetch).not.toHaveBeenCalled();
});

it('does not queue a question if the original shell did not resolve its client focus',async()=>{
 f.ignoreFocus=true;await openSaved();await click('Review sharing with PAIGE');
 expect(getPaigeClientScope(tenant)).toBeNull();expect(composer().value).toBe('');expect(takePendingPaigePrompt()).toBeNull();expect(f.fetch).not.toHaveBeenCalled();
});

it('retires the previous business’s question if the business changes during focus',async()=>{
 await openSaved();f.changeTenantOnOpen=true;await click('Review sharing with PAIGE');
 expect(f.tenant).not.toBe(tenant);expect(composer().value).not.toContain(work);expect(takePendingPaigePrompt()).toBeNull();expect(f.fetch).not.toHaveBeenCalled();
});

it.each(['actor','business','client'] as const)('retires a queued review if %s changes before composer readiness',async change=>{
 f.isFetched=false;await openSaved();await click('Review sharing with PAIGE');expect(composer().value).toBe('');
 await act(async()=>{
  if(change==='actor')f.actor='e09e0000-0000-4000-8000-000000000097';
  else if(change==='business')f.tenant='e09e0000-0000-4000-8000-000000000096';
  else setPaigeClientScope({tenantId:tenant,clientId:'test-other-client',label:'Other test customer'});
  f.isFetched=true;root.render(<Workspace/>);
 });await flush();
 expect(composer().value).not.toContain(work);expect(takePendingPaigePrompt()).toBeNull();expect(f.fetch).not.toHaveBeenCalled();
});
