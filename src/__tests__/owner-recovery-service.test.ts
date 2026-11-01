import {describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {inspectOwnerRecovery,submitOwnerRecovery,type OwnerRecoveryIntent} from '../lib/owner-recovery-service';

const actor='e8100000-0000-4000-8000-000000000001';
const tenant='e8100000-0000-4000-8000-000000000002';
const target='e8100000-0000-4000-8000-000000000003';
const request='e8100000-0000-4000-8000-000000000004';
const other='e8100000-0000-4000-8000-000000000005';
const intent:OwnerRecoveryIntent={requestId:request,action:'set_account_holder',targetUserId:target,reason:'Synthetic recovery reason'};
const native=()=>({status:'found',audit_id:request,tenant_id:tenant,action:'tenant:owner_recovery.set_account_holder',
 target_user_id:target,recorded_at:'2026-11-01T14:00:00+00:00',receipt:{request_id:request,target,
 reason:intent.reason,outcome:'effect_verified',notice_status:'no_recipients',notices:[],notified:[],email_status:'not_requested'}});
function fixture(){return {scope:{actorId:actor,tenantId:tenant,isCurrent:()=>true},client:{getActor:vi.fn(async()=>actor),
 rpc:vi.fn(async(_name:string,_args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>({data:native(),error:null}))}};}

describe('original operator recovery client (synthetic ports, no mounted flow)',()=>{
 it('uses the installed SDK receiver for both native doors with explicitly mocked actor/fetch',async()=>{
  const requests:{name:string;args:unknown}[]=[];
  const sdk=createClient('https://recovery-fixture.invalid','synthetic-public-key',{
   accessToken:async()=> 'synthetic-signed-in-jwt',auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(input,init)=>{
    const url=new URL(String(input));expect(url.origin).toBe('https://recovery-fixture.invalid');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-signed-in-jwt');
    requests.push({name:url.pathname.split('/').at(-1)!,args:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify(native()),{status:200,headers:{'Content-Type':'application/json'}});
   }},
  });
  const port={getActor:async()=>actor,rpc:(name:string,args:Record<string,unknown>)=>sdk.rpc(name,args)};
  await expect(submitOwnerRecovery(port,{actorId:actor,tenantId:tenant,isCurrent:()=>true},intent)).resolves.toHaveProperty('state','verified');
  expect(requests.map(r=>r.name)).toEqual(['platform_owner_recovery','platform_owner_recovery_receipt']);
  expect(requests[1].args).toEqual({_tenant:tenant,_request:request});
 });
 it.each(['grant_owner','revoke_owner','set_account_holder'] as const)('retains the exact original %s action identity',async selected=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),action:`tenant:owner_recovery.${selected}`},error:null});
  await expect(submitOwnerRecovery(client,scope,{...intent,action:selected})).resolves.toMatchObject({state:'verified',receipt:{action:selected}});
  expect(client.rpc.mock.calls[0][1]).toMatchObject({_act:selected,_request:request});
 });
 it('refuses an incarnation retired between the inner receipt read and public async continuation',async()=>{
  const {client,scope}=fixture();let current=true;scope.isCurrent=()=>current;let reads=0;
  client.getActor.mockImplementation(()=>{
   const response=Promise.resolve(actor);
   if(++reads===2)response.then(()=>queueMicrotask(()=>queueMicrotask(()=>{current=false;})));
   return response;
  });
  await expect(inspectOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(current).toBe(false);expect(client.rpc).toHaveBeenCalledOnce();
 });
 it('submits the exact five native arguments once and verifies through the original same-request receipt',async()=>{
  const {client,scope}=fixture();const result=await submitOwnerRecovery(client,scope,intent);
  expect(result).toMatchObject({state:'verified',receipt:{auditId:request,tenantId:tenant,action:'set_account_holder',targetUserId:target}});
  expect(client.rpc.mock.calls).toEqual([
   ['platform_owner_recovery',{_tenant:tenant,_act:'set_account_holder',_user:target,_reason:intent.reason,_request:request}],
   ['platform_owner_recovery_receipt',{_tenant:tenant,_request:request}],
  ]);
 });
 it('inspects without executing or generating a new request',async()=>{
  const {client,scope}=fixture();await inspectOwnerRecovery(client,scope,intent);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('platform_owner_recovery_receipt',{_tenant:tenant,_request:request});
 });
 it('reconciles an interrupted write response using the same native receipt without resubmission',async()=>{
  const {client,scope}=fixture();client.rpc.mockRejectedValueOnce(Error('private transport body'));
  await expect(submitOwnerRecovery(client,scope,intent)).resolves.toHaveProperty('state','verified');
  expect(client.rpc.mock.calls.map(c=>c[0])).toEqual(['platform_owner_recovery','platform_owner_recovery_receipt']);
 });
 it('keeps unknown outcome when a receipt is not yet visible, without claiming absence or retry safety',async()=>{
  const {client,scope}=fixture();client.rpc.mockRejectedValueOnce(Error('timeout'));
  client.rpc.mockResolvedValueOnce({data:{status:'not_found',request_id:request},error:null});
  await expect(submitOwnerRecovery(client,scope,intent)).resolves.toEqual({state:'unknown',requestId:request});
  expect(client.rpc).toHaveBeenCalledTimes(2);
 });
 it('does not use a writer success response as a substitute for receipt verification',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValueOnce({data:native(),error:null});client.rpc.mockRejectedValueOnce(Error('read unavailable'));
  await expect(submitOwnerRecovery(client,scope,intent)).resolves.toEqual({state:'unknown',requestId:request});
 });
 it('keeps inspection not-found bounded to this request, without executing',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{status:'not_found',request_id:request},error:null});
  await expect(inspectOwnerRecovery(client,scope,intent)).resolves.toEqual({state:'not_found',requestId:request});
  expect(client.rpc).toHaveBeenCalledOnce();
 });
 it('refuses not-found for a different original request',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{status:'not_found',request_id:other},error:null});
  await expect(inspectOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'READBACK_MISMATCH'});
 });
 it.each([
  {notice_status:'in_app_recorded',notices:[],notified:[]},
  {notice_status:'in_app_recorded',notices:[{user_id:target,notification_id:other}],notified:[actor]},
  {notice_status:'in_app_recorded',notices:[{user_id:target,notification_id:other},{user_id:target,notification_id:request}],notified:[target,target]},
 ])('refuses inconsistent native notification receipts %j',async patch=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),receipt:{...native().receipt,...patch}},error:null});
  await expect(inspectOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'READBACK_MISMATCH'});
 });
 it('refuses another actual signed-in actor before any call',async()=>{
  const {client,scope}=fixture();client.getActor.mockResolvedValue(other);
  await expect(submitOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(client.rpc).not.toHaveBeenCalled();
 });
 it('refuses a departed incarnation before native effects',async()=>{
  const {client,scope}=fixture();scope.isCurrent=()=>false;
  await expect(submitOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(client.rpc).not.toHaveBeenCalled();
 });
 it('does not disclose an old result or issue a second call after actor departure during submission',async()=>{
  const {client,scope}=fixture();let current=true;scope.isCurrent=()=>current;
  client.rpc.mockImplementationOnce(async()=>{current=false;return {data:native(),error:null};});
  await expect(submitOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(client.rpc).toHaveBeenCalledOnce();
 });
 it('keeps a native refusal generic and does not retry or use another authority',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'private SQL body'}});
  const error=await submitOwnerRecovery(client,scope,intent).catch(e=>e);
  expect(error).toMatchObject({code:'REFUSED'});expect(error.message).not.toContain('private SQL body');expect(client.rpc).toHaveBeenCalledOnce();
 });
 it.each([{tenant_id:other},{audit_id:other},{target_user_id:other},{action:'tenant:owner_recovery.revoke_owner'},
  {receipt:{...native().receipt,outcome:'preparing'}},{receipt:{...native().receipt,reason:'A different reason'}},
  {receipt:{...native().receipt,request_id:other}},{recorded_at:'not-a-date'}])('refuses mismatched or unverified native receipts %j',async patch=>{
   const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),...patch},error:null});
   await expect(inspectOwnerRecovery(client,scope,intent)).rejects.toMatchObject({code:'READBACK_MISMATCH'});
  });
 it('captures immutable actor, tenant and intent primitives before awaiting',async()=>{
  const {client,scope}=fixture();const selected={...intent};let release!:(s:string)=>void;
  client.getActor.mockReturnValueOnce(new Promise<string>(resolve=>{release=resolve;}));
  const pending=submitOwnerRecovery(client,scope,selected);selected.requestId=other;selected.targetUserId=other;scope.tenantId=other;release(actor);
  await expect(pending).resolves.toHaveProperty('state','verified');
  expect(client.rpc.mock.calls[0][1]).toMatchObject({_tenant:tenant,_user:target,_request:request});
 });
 it('returns only the closed operator projection, never raw private extensions',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),raw_secret:'private',receipt:{...native().receipt,backend_pid:9}},error:null});
  const result=await inspectOwnerRecovery(client,scope,intent);expect(result).not.toHaveProperty('raw_secret');
  expect(JSON.stringify(result)).not.toContain('backend_pid');
 });
 it('rejects invalid input without authority or native work',async()=>{
  const {client,scope}=fixture();await expect(submitOwnerRecovery(client,scope,{...intent,requestId:'invalid'})).rejects.toMatchObject({code:'INPUT_INVALID'});
  expect(client.getActor).not.toHaveBeenCalled();expect(client.rpc).not.toHaveBeenCalled();
 });
});
