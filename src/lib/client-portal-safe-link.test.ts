import {expect,it,vi} from 'vitest';
import {readLinkedPortalClient} from './client-delivery-portal';

const id=(n:number)=>`ec041200-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),client=id(2),tenant=id(3);
const profile={id:client,tenant_id:tenant,linked_user_id:actor};
function fixture(){
  return {auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},
    from:vi.fn(()=>{throw Error('Raw CRM reads are retired for this client surface');}),
    rpc:vi.fn().mockResolvedValue({data:profile,error:null})};
}
it('adopts the released subject-bound projection without any raw CRM lookup',async()=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:{...profile,first_name:'Synthetic private name',email:'synthetic@example.invalid'},error:null});
  const result=await readLinkedPortalClient(caller,actor,()=>true);
  expect(result).toEqual({kind:'ready',scope:{actorId:actor,clientId:client,tenantId:tenant}});
  expect(caller.rpc).toHaveBeenCalledExactlyOnceWith('client_portal_self_profile',{});
  expect(caller.from).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('Synthetic private name');
  expect(JSON.stringify(result)).not.toContain('synthetic@example.invalid');
  expect(caller.auth.getUser).toHaveBeenCalledTimes(2);
});
it('keeps a null authorized relationship unlinked',async()=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:null,error:null});
  expect(await readLinkedPortalClient(caller,actor,()=>true)).toEqual({kind:'unlinked'});
  expect(caller.from).not.toHaveBeenCalled();
});
it.each(['42501','PGRST202','offline'])('never falls back after projection refusal or unavailability (%s)',async code=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:null,error:{code}});
  expect(await readLinkedPortalClient(caller,actor,()=>true)).toEqual({kind:'unavailable'});
  expect(caller.from).not.toHaveBeenCalled();
});
it('does not manufacture authority from a different linked subject',async()=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data:{...profile,linked_user_id:id(9)},error:null});
  expect(await readLinkedPortalClient(caller,actor,()=>true)).toEqual({kind:'refused'});
  expect(caller.from).not.toHaveBeenCalled();
});
it.each([{data:[profile,profile]},{data:{}},{data:{...profile,tenant_id:'invalid'}}])('refuses malformed or plural projections without choosing a first row',async({data})=>{
  const caller=fixture();caller.rpc.mockResolvedValue({data,error:null});
  expect(await readLinkedPortalClient(caller,actor,()=>true)).toEqual({kind:'unavailable'});
  expect(caller.from).not.toHaveBeenCalled();
});
it('retires a pending safe projection after the original view epoch changes',async()=>{
  const caller=fixture();let epoch=1;
  caller.rpc.mockImplementation(async()=>{epoch=3;return {data:profile,error:null};});
  expect(await readLinkedPortalClient(caller,actor,()=>epoch===1)).toEqual({kind:'scope_changed'});
  expect(caller.from).not.toHaveBeenCalled();
});
it('rechecks the actual actor after the projection before returning an identity',async()=>{
  const caller=fixture();caller.auth.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValue({data:{user:{id:id(9)}},error:null});
  expect(await readLinkedPortalClient(caller,actor,()=>true)).toEqual({kind:'refused'});
  expect(caller.from).not.toHaveBeenCalled();
});
