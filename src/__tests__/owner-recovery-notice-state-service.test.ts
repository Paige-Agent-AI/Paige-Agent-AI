import {describe,expect,it,vi} from 'vitest';
import * as service from '../lib/owner-recovery-notice-service';
const actor='e8000000-0000-4000-8000-000000097001',notice='e8000000-0000-4000-8000-000000097003';
const other='e8000000-0000-4000-8000-000000097002';
const stamp='2026-11-01T10:00:00.123+00:00';
function fixture(isRead=true){
 const client={getActor:vi.fn(async()=>actor),rpc:vi.fn(async(_name:string,_args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>({data:{notification_id:notice,is_read:isRead,read_at:isRead?stamp:null},error:null}))};
 return {client,scope:{actorId:actor,isCurrent:()=>true}};
}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
describe('original personal notice read-state client (synthetic port only)',()=>{
 it.each([true,false])('publishes only the exact verified native current read state %s',async wanted=>{
  const {client,scope}=fixture(wanted);
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,wanted)).resolves.toEqual({noticeId:notice,isRead:wanted,readAt:wanted?stamp:null});
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('set_my_owner_recovery_notice_read',{_notice:notice,_is_read:wanted});expect(client.getActor).toHaveBeenCalledTimes(2);
 });
 it('preserves the native client method receiver',async()=>{
  const {client,scope}=fixture();client.rpc.mockImplementation(async function(this:typeof client){expect(this).toBe(client);return{data:{notification_id:notice,is_read:true,read_at:stamp},error:null};});
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).resolves.toHaveProperty('isRead',true);
 });
 it.each([null,{},[],{notification_id:other,is_read:true,read_at:stamp},{notification_id:notice,is_read:false,read_at:null},{notification_id:notice,is_read:'true',read_at:stamp},{notification_id:notice,is_read:true,read_at:null},{notification_id:notice,is_read:true,read_at:'not a date'},{notification_id:notice,is_read:true,read_at:stamp,extra:'untrusted'}])('withholds an unconfirmed or expanded receipt %#',async data=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data,error:null});
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:'STATE_UNKNOWN'});expect(client.rpc).toHaveBeenCalledTimes(1);
 });
 it('refuses a contradictory unread timestamp',async()=>{
  const {client,scope}=fixture(false);client.rpc.mockResolvedValue({data:{notification_id:notice,is_read:false,read_at:stamp},error:null});
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,false)).rejects.toMatchObject({code:'STATE_UNKNOWN'});
 });
 it('refuses invalid input before any native call',async()=>{
  const {client,scope}=fixture();await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,'invalid',true)).rejects.toMatchObject({code:'INPUT_INVALID'});expect(client.rpc).not.toHaveBeenCalled();expect(client.getActor).not.toHaveBeenCalled();
 });
 it('never dispatches after its original view context retires',async()=>{
  const {client,scope}=fixture();scope.isCurrent=()=>false;await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(client.rpc).not.toHaveBeenCalled();
 });
 it('re-resolves the actual actor before effect instead of trusting a supplied scope',async()=>{
  const {client,scope}=fixture();client.getActor.mockResolvedValue(other);await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(client.rpc).not.toHaveBeenCalled();
 });
 it('withdraws a late write response after departure',async()=>{
  const {client,scope}=fixture();let current=true;scope.isCurrent=()=>current;const gate=deferred<{data:unknown;error:unknown}>();client.rpc.mockImplementation(()=>gate.promise);
  const pending=service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true);await vi.waitFor(()=>expect(client.rpc).toHaveBeenCalledOnce());current=false;gate.resolve({data:{notification_id:notice,is_read:true,read_at:stamp},error:null});
  await expect(pending).rejects.toMatchObject({code:'SCOPE_CHANGED'});
 });
 it('withdraws a response if actual signed-in actor changed after the write',async()=>{
  const {client,scope}=fixture();client.getActor.mockResolvedValueOnce(actor).mockResolvedValueOnce(other);await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(client.rpc).toHaveBeenCalledOnce();
 });
 it.each([['42501','UNAVAILABLE'],['22023','INPUT_INVALID'],['40001','STATE_UNKNOWN']])('sanitizes native %s and never retries',async(code,expected)=>{
  const {client,scope}=fixture();client.rpc.mockResolvedValue({data:null,error:{code,message:'private SQL and customer text'}});
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:expected,message:'This ownership notice could not be verified.'});expect(client.rpc).toHaveBeenCalledOnce();
 });
 it.each(['read','mark'] as const)('sanitizes a thrown original context guard during %s',async operation=>{
  const {client,scope}=fixture();scope.isCurrent=()=>{throw Error('private departed workspace context');};
  const result=operation==='read'?service.readPersonalOwnerRecoveryNotice(client,scope,notice):service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true);
  await expect(result).rejects.toMatchObject({code:'SCOPE_CHANGED',message:'This ownership notice could not be verified.'});expect(client.rpc).not.toHaveBeenCalled();
 });
 it('leaves interrupted transport unknown for original notice readback with no automatic retry',async()=>{
  const {client,scope}=fixture();client.rpc.mockRejectedValue(Error('private transport payload'));
  await expect(service.setPersonalOwnerRecoveryNoticeRead(client,scope,notice,true)).rejects.toMatchObject({code:'STATE_UNKNOWN',message:'This ownership notice could not be verified.'});expect(client.rpc).toHaveBeenCalledOnce();
 });
});
