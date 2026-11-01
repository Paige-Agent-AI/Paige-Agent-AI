import {describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {readPersonalOwnerRecoveryNotice,OwnerRecoveryNoticeError} from '../lib/owner-recovery-notice-service';

const actor='e8000000-0000-4000-8000-000000097001';
const other='e8000000-0000-4000-8000-000000097002';
const notice='e8000000-0000-4000-8000-000000097003';
const tenant='e8000000-0000-4000-8000-000000097004';
const audit='e8000000-0000-4000-8000-000000097005';
const native=()=>({audit_id:audit,notification_id:notice,tenant_id:tenant,
 business_name:'Synthetic business',action:'tenant:owner_recovery.set_account_holder',
 target_user_id:other,reason:'Synthetic native recovery reason',recorded_at:'2026-11-01T10:00:00+00:00',is_read:false});
function fixture(){
 const getActor=vi.fn(async()=>actor);
 const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>({data:native(),error:null}));
 return {client:{getActor,rpc},scope:{actorId:actor,isCurrent:()=>true}};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

describe('personal native owner-recovery notice read (synthetic client proof)',()=>{
 it('uses the installed SDK through the original bound receiver; fetch and actor are explicitly synthetic',async()=>{
  const requests:unknown[]=[];
  const sdk=createClient('https://notice-fixture.invalid','synthetic-anon-key',{
   accessToken:async()=> 'synthetic-ordinary-user-jwt',
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(input,init)=>{
    const url=new URL(String(input));expect(url.origin).toBe('https://notice-fixture.invalid');
    expect(url.pathname).toBe('/rest/v1/rpc/get_my_owner_recovery_notice');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-ordinary-user-jwt');
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(native()),{status:200,headers:{'Content-Type':'application/json'}});
   }},
  });
  const port={getActor:async()=>actor,rpc:(name:string,args:Record<string,unknown>)=>sdk.rpc(name,args)};
  await expect(readPersonalOwnerRecoveryNotice(port,{actorId:actor,isCurrent:()=>true},notice)).resolves.toHaveProperty('auditId',audit);
  expect(requests).toEqual([{_notice:notice}]);
 });
 it('reads only the original personal door and returns the verified event without selecting a workspace',async()=>{
  const {client,scope}=fixture();const result=await readPersonalOwnerRecoveryNotice(client,scope,notice);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_my_owner_recovery_notice',{_notice:notice});
  expect(client.getActor).toHaveBeenCalledTimes(2);
  expect(result).toEqual({auditId:audit,noticeId:notice,tenantId:tenant,businessName:'Synthetic business',
   action:'set_account_holder',targetUserId:other,reason:'Synthetic native recovery reason',
   recordedAt:'2026-11-01T10:00:00+00:00',isRead:false});
 });
 it('refuses a different actual actor before any native request',async()=>{
  const {client,scope}=fixture();client.getActor.mockResolvedValue(other);
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(client.rpc).not.toHaveBeenCalled();
 });
 it('refuses a signed-out actor before any native request',async()=>{
  const {client,scope}=fixture();const getActor=vi.fn(async()=>null);
  await expect(readPersonalOwnerRecoveryNotice({...client,getActor},scope,notice)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
  expect(client.rpc).not.toHaveBeenCalled();
 });
 it('does not release content after an actor change during the actual request',async()=>{
  const {client,scope}=fixture();client.getActor.mockResolvedValueOnce(actor).mockResolvedValueOnce(other);
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'SCOPE_CHANGED'});
 });
 it('keeps a departed incarnation invalid through A to B to A, even if the final actor matches',async()=>{
  const {client}=fixture();let departed=false;
  const response=deferred<{data:unknown;error:unknown}>();client.rpc.mockReturnValue(response.promise);
  const pending=readPersonalOwnerRecoveryNotice(client,{actorId:actor,isCurrent:()=>!departed},notice);
  await vi.waitFor(()=>expect(client.rpc).toHaveBeenCalledOnce());departed=true;
  response.resolve({data:native(),error:null});
  await expect(pending).rejects.toMatchObject({code:'SCOPE_CHANGED'});
 });
 it('does not send a request if scope departs during the authority read',async()=>{
  const {client}=fixture();let departed=false;const resolving=deferred<string>();client.getActor.mockReturnValue(resolving.promise);
  const pending=readPersonalOwnerRecoveryNotice(client,{actorId:actor,isCurrent:()=>!departed},notice);
  departed=true;resolving.resolve(actor);
  await expect(pending).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(client.rpc).not.toHaveBeenCalled();
 });
 it('distinguishes a missing native contract from an admitted result and never falls back',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'private internal detail'}});
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(client.rpc).toHaveBeenCalledOnce();
 });
 it('keeps native denial generic without exposing returned SQL or private context',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'private internal detail'}});
  const error=await readPersonalOwnerRecoveryNotice(client,scope,notice).catch(e=>e);
  expect(error).toBeInstanceOf(OwnerRecoveryNoticeError);expect(error.code).toBe('UNAVAILABLE');
  expect(error.message).not.toContain('private internal detail');
 });
 it('rejects a receipt for another requested notice',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),notification_id:other},error:null});
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'READBACK_MISMATCH'});
 });
 it.each([
  {action:'tenant:owner_recovery.unknown'}, {action:{toString:()=> 'tenant:owner_recovery.grant_owner'}},
  {tenant_id:'not-a-tenant'}, {audit_id:null},
  {is_read:'true'}, {reason:null}, {recorded_at:'not-a-date'}, {business_name:null}, {target_user_id:42},
 ])('refuses malformed native data %j without a guessed success',async patch=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),...patch},error:null});
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'READBACK_MISMATCH'});
 });
 it('returns only the declared notice fields, never raw server extensions',async()=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:{...native(),private_email:'not-for-client',receipt:{secret:'opaque'}},error:null});
  const result=await readPersonalOwnerRecoveryNotice(client,scope,notice);
  expect(result).not.toHaveProperty('private_email');expect(result).not.toHaveProperty('receipt');
 });
 it('captures the original actor and ID before any await',async()=>{
  const {client,scope}=fixture();const resolve=deferred<string>();client.getActor.mockReturnValueOnce(resolve.promise);
  const pending=readPersonalOwnerRecoveryNotice(client,scope,notice);scope.actorId=other;resolve.resolve(actor);
  await expect(pending).resolves.toHaveProperty('noticeId',notice);
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_my_owner_recovery_notice',{_notice:notice});
 });
 it('refuses invalid inputs before authority/native work',async()=>{
  const {client,scope}=fixture();
  await expect(readPersonalOwnerRecoveryNotice(client,scope,'not-a-notice')).rejects.toMatchObject({code:'INPUT_INVALID'});
  expect(client.getActor).not.toHaveBeenCalled();expect(client.rpc).not.toHaveBeenCalled();
 });
 it('does not retry a failed transport or disclose its error body',async()=>{
  const {client,scope}=fixture();client.rpc.mockRejectedValue(new Error('private transport body'));
  await expect(readPersonalOwnerRecoveryNotice(client,scope,notice)).rejects.toMatchObject({code:'READ_FAILED'});
  expect(client.rpc).toHaveBeenCalledOnce();
 });
});
