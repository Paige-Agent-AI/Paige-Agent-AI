// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {findPipelineOriginalEffect} from '../../supabase/functions/_shared/pipeline-original-discovery';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={threadId:id(1),intentId:id(2),actorId:id(3),tenantId:id(4)};
function fixture(){let actor=scope.actorId,tenant=scope.tenantId,effect:unknown=id(5),reads=0;const calls:string[]=[];
 const caller={auth:{getUser:vi.fn(async()=>({data:{user:{id:actor}},error:null}))},rpc:vi.fn(async(name:string)=>{calls.push(name);if(name==='current_user_tenant_id')return{data:tenant,error:null};if(name==='find_pipeline_metadata_original_effect'){reads++;return{data:effect,error:null};}throw Error('Unapproved read');})};
 return {caller,calls,setActor:(v:string)=>actor=v,setTenant:(v:string)=>tenant=v,setEffect:(v:unknown)=>effect=v,getReads:()=>reads};}
describe('canonical original-operation discovery',()=>{
 it('recovers only the caller-bound canonical original effect and rereads it',async()=>{const f=fixture();expect(await findPipelineOriginalEffect(scope,f.caller)).toBe(id(5));expect(f.getReads()).toBe(2);expect(f.calls.every(n=>['current_user_tenant_id','find_pipeline_metadata_original_effect'].includes(n))).toBe(true);expect(f.caller.rpc).toHaveBeenCalledWith('find_pipeline_metadata_original_effect',{_thread:scope.threadId,_intent:scope.intentId});});
 it.each([null,{},[id(5)],'not-an-id',{effectId:id(5),settled:true}])('refuses absent or malformed canonical reference %j',async value=>{const f=fixture();f.setEffect(value);expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();});
 it.each(['actorId','tenantId','threadId','intentId'] as const)('refuses malformed %s before any authority read',async key=>{const f=fixture();expect(await findPipelineOriginalEffect({...scope,[key]:'bad'},f.caller)).toBeNull();expect(f.caller.auth.getUser).not.toHaveBeenCalled();});
 it('refuses foreign actor before resolving',async()=>{const f=fixture();f.setActor(id(9));expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();expect(f.getReads()).toBe(0);});
 it('refuses foreign workspace before resolving',async()=>{const f=fixture();f.setTenant(id(9));expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();expect(f.getReads()).toBe(0);});
 it('refuses a switched actor across the resolver await',async()=>{const f=fixture();f.caller.auth.getUser.mockResolvedValueOnce({data:{user:{id:scope.actorId}},error:null}).mockResolvedValue({data:{user:{id:id(9)}},error:null});expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();});
 it('refuses a switched workspace across the resolver await',async()=>{const f=fixture();const original=f.caller.rpc;f.caller.rpc=vi.fn(async(name:string)=>{const result=await original(name);if(name==='find_pipeline_metadata_original_effect')f.setTenant(id(9));return result;});expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();});
 it('refuses changed final canonical evidence',async()=>{const f=fixture();const original=f.caller.rpc;f.caller.rpc=vi.fn(async(name:string)=>{const result=await original(name);if(name==='find_pipeline_metadata_original_effect')f.setEffect(id(9));return result;});expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();});
 it('contains failed authorization and resolver reads',async()=>{const f=fixture();f.caller.rpc=vi.fn(async()=>{throw Error('unavailable');});expect(await findPipelineOriginalEffect(scope,f.caller)).toBeNull();});
 it('pins mutable input before awaiting current authorization',async()=>{const f=fixture();const mutable={...scope};f.caller.auth.getUser=vi.fn(async()=>{mutable.threadId=id(9);return{data:{user:{id:scope.actorId}},error:null};});expect(await findPipelineOriginalEffect(mutable,f.caller)).toBe(id(5));expect(f.caller.rpc).toHaveBeenCalledWith('find_pipeline_metadata_original_effect',{_thread:scope.threadId,_intent:scope.intentId});});
});
