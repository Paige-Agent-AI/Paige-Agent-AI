import {expect,it,vi} from 'vitest';
import {readOperationsTeamPresence,type OperationsPresenceCaller} from './operations-team-presence';
const scope={actorId:'test-person-a',tenantId:'test-tenant-a'};
const members=[{user_id:'test-person-a',status:'active'},{user_id:'test-person-b',status:'active'}];
const row={user_id:'test-person-a',tenant_id:scope.tenantId,effective_status:'busy',last_seen:'2026-10-14T10:00:00Z',full_name:'Synthetic person',avatar_url:'private-image',override_reason:'Private status reason'};
function fixture(rows:unknown=[row]){return {auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:scope.actorId}}},error:null})},rpc:vi.fn().mockResolvedValue({data:rows,error:null})} satisfies OperationsPresenceCaller;}
it('reads the existing explicit-tenant Team seam and never infers working hours',async()=>{
 const caller=fixture();const result=await readOperationsTeamPresence(caller,scope,members,()=>true);
 expect(caller.rpc).toHaveBeenCalledWith('presence_list_effective',{p_tenant_id:scope.tenantId,p_window_seconds:75,p_override_ttl_seconds:43200});
 expect(result).toEqual({kind:'ready',...scope,source:'presence_list_effective',availableMinutes:null,omittedCount:0,people:[{userId:'test-person-a',status:'busy',lastSeen:row.last_seen},{userId:'test-person-b',status:'unknown',lastSeen:null}]});
 expect(JSON.stringify(result)).not.toMatch(/private-image|Private status reason|Synthetic person/);
});
it('an empty presence result means unknown, not offline or zero availability',async()=>{
 const result=await readOperationsTeamPresence(fixture([]),scope,members,()=>true);expect(result.kind).toBe('ready');
 if(result.kind==='ready'){expect(result.people.every(p=>p.status==='unknown'&&p.lastSeen===null)).toBe(true);expect(result.availableMinutes).toBeNull();}
});
it.each([[{...row,tenant_id:'test-tenant-foreign'}],[row,row],[{...row,effective_status:'available-for-40-hours'}],[{...row,last_seen:'nonsense'}],null])('refuses invalid or foreign source %j',async rows=>{
 expect(await readOperationsTeamPresence(fixture(rows),scope,members,()=>true)).toEqual({kind:'unavailable'});
});
it('does not expose suspended or unrepresented identities',async()=>{
 const result=await readOperationsTeamPresence(fixture([row,{...row,user_id:'test-person-suspended'},{...row,user_id:'test-person-unrepresented'}]),scope,[...members,{user_id:'test-person-suspended',status:'suspended'}],()=>true);
 expect(result.kind).toBe('ready');if(result.kind==='ready'){expect(result.omittedCount).toBe(2);expect(result.people.map(p=>p.userId)).toEqual(members.map(m=>m.user_id));}
});
it('refuses a preview actor before any source read',async()=>{
 const caller=fixture();caller.auth.getSession.mockResolvedValue({data:{session:{user:{id:'test-other-actor'}}},error:null});
 expect(await readOperationsTeamPresence(caller,scope,members,()=>true)).toEqual({kind:'scope_changed'});expect(caller.rpc).not.toHaveBeenCalled();
});
it('rejects a late actual-session change without publishing old source',async()=>{
 const caller=fixture();caller.auth.getSession.mockResolvedValueOnce({data:{session:{user:{id:scope.actorId}}},error:null}).mockResolvedValueOnce({data:{session:{user:{id:'test-other-actor'}}},error:null});
 expect(await readOperationsTeamPresence(caller,scope,members,()=>true)).toEqual({kind:'scope_changed'});
});
it('pins original actor and tenant arguments across awaited caller work',async()=>{
 const requested={...scope};const caller=fixture();caller.auth.getSession.mockImplementationOnce(async()=>{
  requested.tenantId='test-tenant-changed';return {data:{session:{user:{id:scope.actorId}}},error:null};
 });
 const result=await readOperationsTeamPresence(caller,requested,members,()=>true);
 expect(caller.rpc.mock.calls[0][1]).toMatchObject({p_tenant_id:scope.tenantId});expect(result.kind).toBe('ready');
 if(result.kind==='ready')expect(result.tenantId).toBe(scope.tenantId);
});
it('an async retirement cannot return named source data even if a tuple later repeats',async()=>{
 let current=true;const caller=fixture();caller.rpc.mockImplementation(async()=>{current=false;return {data:[row],error:null};});
 expect(await readOperationsTeamPresence(caller,scope,members,()=>current)).toEqual({kind:'scope_changed'});
});
it('refuses source errors or a throwing fence without leaking a raw failure',async()=>{
 const caller=fixture();caller.rpc.mockRejectedValue(new Error('PRIVATE_FAILURE'));
 expect(await readOperationsTeamPresence(caller,scope,members,()=>true)).toEqual({kind:'unavailable'});
 expect(await readOperationsTeamPresence(caller,scope,members,()=>{throw new Error('PRIVATE_FENCE');})).toEqual({kind:'scope_changed'});
});
