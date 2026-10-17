import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({context:{activeUserId:'e0913400-0000-4000-8000-000000000001',activeTenantId:'e0923400-0000-4000-8000-000000000001',accountContextStatus:'ready',accountContextLoading:false},getUser:vi.fn(),invoke:vi.fn(),rpc:vi.fn(),has:vi.fn(),readback:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>f.context}));
vi.mock('@/hooks/useTierFeatures',()=>({useTierFeatures:()=>({has:f.has})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:f.getUser},functions:{invoke:f.invoke},rpc:f.rpc}}));
import {PortalInvitationCommand} from './PortalInvitationCommand';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const tenant='e0923400-0000-4000-8000-000000000001',contact='e0933400-0000-4000-8000-000000000001',actor='e0913400-0000-4000-8000-000000000001';
const operation='e0953400-0000-4000-8000-000000000001',invite='e0943400-0000-4000-8000-000000000001',receipt='e0963400-0000-4000-8000-000000000001';
const proposal=()=>({outcome:'approval_required',capability:'client_portal_invitation_send',operation_id:operation,fingerprint:'a'.repeat(16),summary:'Invite the saved customer at exact@tests.invalid.',expires_at:new Date(Date.now()+600000).toISOString()});
const accepted={ok:true,outcome:'provider_accepted',operation_id:operation,invitation_id:invite,receipt_id:receipt};
const native=(outcome='provider_accepted')=>({actor_id:actor,tenant_id:tenant,operation_id:operation,found:true,invitation_id:invite,receipt_id:receipt,requested_by:actor,reconciled_by:actor,outcome,provider_message_id:outcome==='provider_accepted'?'controlled-message':null,observed_at:'2026-10-17T12:00:00Z'});
let host:HTMLDivElement,root:Root;
async function show(eligible=true){await act(async()=>{root.render(<PortalInvitationCommand tenantId={tenant} contactId={contact} eligible={eligible} onReadback={f.readback}/>)});}
async function click(name:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===name);expect(b,name).toBeTruthy();await act(async()=>b!.click());}
async function review(){await click('Review invitation');expect(host.textContent).toContain('Needs your OK');}
beforeEach(()=>{
 Object.assign(f.context,{activeUserId:actor,activeTenantId:tenant,accountContextStatus:'ready',accountContextLoading:false});
 f.getUser.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});f.has.mockReset().mockReturnValue(true);
 f.invoke.mockReset().mockImplementation(async(_name:string,options:{body:Record<string,unknown>})=>({data:options.body.approved_fingerprint?accepted:proposal(),error:null}));
 f.rpc.mockReset().mockResolvedValue({data:native(),error:null});f.readback.mockReset().mockResolvedValue(undefined);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.restoreAllMocks()});
describe('one canonical owner invitation UI',()=>{
 it('prepares only the shared command, then approves its exact stored operation and fingerprint',async()=>{
  await show();await review();expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.invoke.mock.calls[0][0]).toBe('send-portal-invite');
  expect(f.invoke.mock.calls[0][1].body).toMatchObject({expected_tenant_id:tenant,contact_id:contact});expect(Object.keys(f.invoke.mock.calls[0][1].body).sort()).toEqual(['contact_id','expected_tenant_id','operation_id']);
  await click('Approve');expect(f.invoke.mock.calls[1][1].body).toEqual({expected_tenant_id:tenant,contact_id:contact,operation_id:operation,approved_fingerprint:'a'.repeat(16)});
  expect(host.textContent).toContain('email provider accepted');expect(host.textContent).toContain('Delivery and customer acceptance are separate');expect(host.textContent).toContain('exact@tests.invalid');expect(host.textContent).not.toContain('PRIVATE');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('Not now requests no email and returns to review',async()=>{await show();await review();await click('Not now');expect(f.invoke).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Review invitation');expect(host.textContent).not.toContain('Approve');});
 it('moves native dialog fallback focus to the review card instead of Approve',async()=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');
  host.setAttribute('role','dialog');host.tabIndex=-1;host.focus();expect(document.activeElement).toBe(host);
  await act(async()=>resolve({data:proposal(),error:null}));
  expect(document.activeElement).toBe(host.querySelector('[role="group"][data-card-mode="decide"]'));
  expect(document.activeElement?.textContent).not.toBe('Approve');expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it('preserves another focused input while an invitation review arrives',async()=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');
  const other=document.createElement('input');document.body.append(other);other.focus();
  try{await act(async()=>resolve({data:proposal(),error:null}));expect(document.activeElement).toBe(other);expect(f.invoke).toHaveBeenCalledTimes(1)}finally{other.remove()}
 });
 for(const stage of ['review','approval','status'])it('requires sign-in and a fresh review when Auth is lost before '+stage,async()=>{
  await show();if(stage!=='review')await review();
  f.getUser.mockResolvedValue({data:{user:null},error:null});
  await click(stage==='review'?'Review invitation':stage==='approval'?'Approve':'Not now');
  if(stage==='status')await click('Refresh history');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('fresh review');
  expect(host.querySelector('a')?.getAttribute('href')).toMatch(/^\/auth\?mode=login&next=/);
  expect(host.textContent).not.toContain('Check status');expect(host.textContent).not.toContain('may have completed');
  expect(host.textContent).not.toContain('Approve');expect(f.invoke).toHaveBeenCalledTimes(stage==='review'?0:1);expect(f.rpc).not.toHaveBeenCalled();
 });
 for(const response of [{data:{code:'UNAUTHENTICATED'},error:null},{data:null,error:{context:{status:401}}}])it('recognizes a definite server authentication refusal without offering send recovery',async()=>{
  await show();await review();f.invoke.mockResolvedValue(response);await click('Approve');
  expect(host.textContent).toContain('Sign in again');expect(host.textContent).not.toContain('Review recovery');expect(host.textContent).not.toContain('Approve');expect(f.invoke).toHaveBeenCalledTimes(2);
 });
 for(const kind of ['wrong tenant','loading','not eligible','no tier','wrong Auth'])it('starts no command for '+kind,async()=>{
  if(kind==='wrong tenant')f.context.activeTenantId='other';if(kind==='loading')f.context.accountContextLoading=true;if(kind==='no tier')f.has.mockReturnValue(false);if(kind==='wrong Auth')f.getUser.mockResolvedValue({data:{user:{id:'other'}},error:null});
  await show(kind!=='not eligible');await click('Review invitation');expect(f.invoke).not.toHaveBeenCalled();
 });
 it('does not repeat a command while its response is outstanding',async()=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');expect(f.invoke).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Preparing review…');
  await act(async()=>{host.querySelector<HTMLButtonElement>('button')!.click();resolve({data:proposal(),error:null})});expect(f.invoke).toHaveBeenCalledTimes(1);
 });
 it('retires a late proposal on workspace change',async()=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');f.context.activeTenantId='other';await show();
  await act(async()=>resolve({data:proposal(),error:null}));expect(host.textContent).not.toContain('exact@tests.invalid');expect(host.textContent).not.toContain('Approve');expect(f.readback).not.toHaveBeenCalled();
 });
 it('does not invoke after an authentication wait is unmounted',async()=>{
  let resolve!:(v:unknown)=>void;f.getUser.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');act(()=>root.unmount());root=createRoot(host);
  await act(async()=>resolve({data:{user:{id:actor}},error:null}));expect(f.invoke).not.toHaveBeenCalled();
 });
 it('a loading→ready round trip retires the earlier request instead of restoring a stuck spinner',async()=>{
  let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));await show();await click('Review invitation');
  f.context.accountContextLoading=true;await show();f.context.accountContextLoading=false;await show();
  await act(async()=>resolve({data:proposal(),error:null}));expect(host.textContent).not.toContain('Needs your OK');expect(host.textContent).not.toContain('Preparing review…');expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
 });
 it('a browser deadline keeps an approval uncertain and ignores a later response until explicit readback',async()=>{
  await show();await review();let resolve!:(v:unknown)=>void;f.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));vi.useFakeTimers();await click('Approve');
  await act(async()=>{await vi.advanceTimersByTimeAsync(30001)});expect(host.textContent).toContain('Check status');expect(f.invoke).toHaveBeenCalledTimes(2);
  await act(async()=>resolve({data:accepted,error:null}));expect(host.textContent).not.toContain('email provider accepted');
  vi.useRealTimers();await click('Check status');expect(host.textContent).toContain('original email provider acceptance is recorded');expect(f.invoke).toHaveBeenCalledTimes(2);
 });
 it('reads the exact original native result after a lost approval response without sending again',async()=>{
  f.invoke.mockImplementation(async(_name:string,o:{body:Record<string,unknown>})=>{if(o.body.approved_fingerprint)throw Error('private transport details');return {data:proposal(),error:null}});
  await show();await review();await click('Approve');expect(host.textContent).toContain('Check status');expect(host.textContent).not.toContain('private transport');
  await click('Check status');expect(f.invoke).toHaveBeenCalledTimes(2);expect(f.rpc).toHaveBeenCalledWith('read_client_portal_invitation_delivery',{p_tenant_id:tenant,p_operation_id:operation});expect(host.textContent).toContain('original email provider acceptance is recorded');
 });
 for(const change of [{tenant_id:'other'},{actor_id:'other'},{operation_id:'other'},{provider_message_id:null},{token:'forbidden'}])it('refuses malformed/foreign native status '+Object.keys(change)[0],async()=>{
  f.invoke.mockImplementation(async(_n:string,o:{body:Record<string,unknown>})=>({data:o.body.approved_fingerprint?{outcome:'outcome_unknown',operation_id:operation}:proposal(),error:null}));f.rpc.mockResolvedValue({data:{...native(),...change},error:null});
  await show();await review();await click('Approve');await click('Check status');expect(host.textContent).toContain('could not be checked');expect(host.textContent).not.toContain('acceptance is recorded');expect(f.invoke).toHaveBeenCalledTimes(2);
 });
 it('an absent delivery record is inconclusive and recovery requires a new card for the original operation',async()=>{
  f.invoke.mockImplementation(async(_n:string,o:{body:Record<string,unknown>})=>({data:o.body.approved_fingerprint?{outcome:'outcome_unknown',operation_id:operation}:proposal(),error:null}));f.rpc.mockResolvedValue({data:{actor_id:actor,tenant_id:tenant,operation_id:operation,found:false},error:null});
  await show();await review();await click('Approve');await click('Check status');expect(host.textContent).toContain('No delivery result is recorded');await click('Review recovery');expect(host.textContent).toContain('Needs your OK');expect(f.invoke.mock.calls.at(-1)![1].body.operation_id).toBe(operation);expect(f.invoke.mock.calls.at(-1)![1].body.approved_fingerprint).toBeUndefined();
 });
 it('preserves provider acceptance when history reload fails',async()=>{await show();await review();f.readback.mockRejectedValue(Error('private'));await click('Approve');expect(host.textContent).toContain('email provider accepted');expect(host.textContent).toContain('history could not reload');expect(host.textContent).not.toContain('private');});
 it('an explicit resend starts a fresh review, never replays the completed operation',async()=>{await show();await review();await click('Approve');await click('Review resend');expect(f.invoke.mock.calls.at(-1)![1].body.operation_id).not.toBe(operation);expect(f.invoke.mock.calls.at(-1)![1].body.approved_fingerprint).toBeUndefined();expect(host.textContent).toContain('Needs your OK');});
});
