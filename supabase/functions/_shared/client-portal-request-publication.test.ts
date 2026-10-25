import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executePortalRequestPublication} from './client-portal-request-publication.ts';

const id=(n:number)=>`e09fc000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope=()=>({actorId:id(1),tenantId:id(2),threadId:id(3) as string|null,clientId:id(4) as string|null,audience:'owner' as const});
const target=()=>({expected_tenant_id:id(2),contact_id:id(4),work_id:id(5),version:'2026-10-25T12:34:56.123456+00:00',
 title:'Review the welcome guide',body:'Start with section one.',recipient_user_id:id(6),access_version:null});
const claim=()=>({id:id(7),fingerprint:'0123456789abcdef',requestNonce:id(8),threadId:id(3) as string|null,clientId:id(4) as string|null});
const receipt=()=>({schema_version:1,actor_id:id(1),tenant_id:id(2),contact_id:id(4),work_id:id(5),customer_action_id:id(9),
 status:'shared',replayed:false,published_at:'2026-10-25T12:35:01.123456+00:00'});
function fixture(){
 const s=scope(),t=target(),c=claim(),calls:{name:string,args:Record<string,unknown>}[]=[];
 let active=true,actor:string|null=id(1),authError:unknown=null,rpcError:unknown=null,rpcData:unknown=receipt(),throwRpc=false;
 let during:()=>void=()=>{};
 const deps={current:()=>active,caller:{auth:{getUser:async()=>({data:{user:actor?{id:actor}:null},error:authError})},
  rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});during();if(throwRpc)throw Error('connection interrupted');return {data:rpcData,error:rpcError};}}};
 return {s,t,c,calls,deps,run:()=>executePortalRequestPublication(deps,s,t,c),
  setActive:(x:boolean)=>{active=x;},setActor:(x:string|null)=>{actor=x;},setAuthError:(x:unknown)=>{authError=x;},
  setData:(x:unknown)=>{rpcData=x;},setError:(x:unknown)=>{rpcError=x;},setThrow:()=>{throwRpc=true;},during:(x:()=>void)=>{during=x;}};
}
test('owner-focused stored call uses one original native RPC and a closed safe result',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.outcome,'shared');assert.equal(r.customer_action_id,id(9));assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0],{name:'share_client_portal_request',args:{_expected_actor_id:id(1),_expected_tenant_id:id(2),
  _confirmation_id:id(7),_fingerprint:'0123456789abcdef',_claimed_in_request:id(8),_thread_id:id(3)}});
 for(const hidden of ['recipient_user_id','requestNonce','fingerprint','Review the welcome guide','section one'])assert(!JSON.stringify(r).includes(hidden));
});
test('unfocused owner call retains the same native mechanism',async()=>{
 const f=fixture();f.s.clientId=null;f.c.clientId=null;assert.equal((await f.run()).outcome,'shared');assert.equal(f.calls.length,1);
});
test('same native replay is historical success without another dispatch inside the adapter',async()=>{
 const f=fixture();f.setData({...receipt(),replayed:true});const r=await f.run();assert.equal(r.outcome,'shared');assert.equal(r.replayed,true);assert.equal(f.calls.length,1);
});
for(const [name,mutate]of [
 ['customer audience',(f:ReturnType<typeof fixture>)=>{f.s.audience='customer' as 'owner';}],
 ['foreign selected CRM focus',(f:ReturnType<typeof fixture>)=>{f.s.clientId=id(30);}],
 ['claim from another focus',(f:ReturnType<typeof fixture>)=>{f.c.clientId=id(30);}],
 ['claim from another conversation',(f:ReturnType<typeof fixture>)=>{f.c.threadId=id(30);}],
 ['stored target from another business',(f:ReturnType<typeof fixture>)=>{f.t.expected_tenant_id=id(30);}],
 ['invalid claim fingerprint',(f:ReturnType<typeof fixture>)=>{f.c.fingerprint='not-a-fingerprint';}],
 ['stale turn',(f:ReturnType<typeof fixture>)=>{f.setActive(false);}],
 ['missing actual user',(f:ReturnType<typeof fixture>)=>{f.setActor(null);}],
 ['wrong actual user',(f:ReturnType<typeof fixture>)=>{f.setActor(id(30));}],
 ['unavailable actual Auth',(f:ReturnType<typeof fixture>)=>{f.setAuthError({message:'unavailable'});}],
]as const)test('no native dispatch for '+name,async()=>{const f=fixture();mutate(f);const r=await f.run();assert.notEqual(r.outcome,'shared');assert.equal(f.calls.length,0);});
for(const [key,value]of [['confirm',true],['confirmation_id',id(7)],['payload',{private:true}],['actor_id',id(1)]]as const)
 test('model-style extra stored field '+key+' cannot enter publication',async()=>{const f=fixture();Object.assign(f.t,{[key]:value});assert.notEqual((await f.run()).outcome,'shared');assert.equal(f.calls.length,0);});
for(const [key,value]of [['actor_id',id(30)],['tenant_id',id(30)],['contact_id',id(30)],['work_id',id(30)],
 ['customer_action_id',null],['status','executing'],['published_at','not-time'],['replayed','true'],['private_payload',{hidden:true}]]as const)
 test('foreign or malformed native receipt '+key+' remains unknown after one dispatch',async()=>{const f=fixture();f.setData({...receipt(),[key]:value});assert.equal((await f.run()).outcome,'outcome_unknown');assert.equal(f.calls.length,1);});
test('interrupted transport never retries or calls a fallback publisher',async()=>{const f=fixture();f.setThrow();assert.equal((await f.run()).outcome,'outcome_unknown');assert.equal(f.calls.length,1);});
test('native permission refusal is definite and does not fabricate a receipt',async()=>{const f=fixture();f.setData(null);f.setError({code:'42501',message:'native owner refused'});const r=await f.run();assert.equal(r.outcome,'refused');assert(!('customer_action_id'in r));assert.equal(f.calls.length,1);});
test('late success after a workspace/turn change is withheld',async()=>{const f=fixture();f.during(()=>f.setActive(false));const r=await f.run();assert.equal(r.outcome,'outcome_unknown');assert(!('customer_action_id'in r));assert.equal(f.calls.length,1);});
test('late success after actual user changes is withheld',async()=>{const f=fixture();f.during(()=>f.setActor(id(30)));const r=await f.run();assert.equal(r.outcome,'outcome_unknown');assert(!('customer_action_id'in r));});
test('captured values cannot be retargeted by mutation while Auth is awaited',async()=>{
 const f=fixture();const promise=f.run();f.s.tenantId=id(30);f.t.work_id=id(30);f.c.requestNonce=id(30);
 const r=await promise;assert.equal(r.outcome,'refused');assert(!('customer_action_id'in r));assert.equal(f.calls.length,0);
});
test('a retired turn in the final Auth continuation cannot dispatch a mutation',async()=>{
 const f=fixture(),current=f.deps.current;let checks=0;
 f.deps.current=()=>{if(++checks===2)queueMicrotask(()=>f.setActive(false));return current();};
 const r=await f.run();assert.equal(r.outcome,'refused');assert.equal(f.calls.length,0);
});
test('a retired turn in the final result continuation cannot expose a saved receipt',async()=>{
 const f=fixture(),current=f.deps.current;let replyChecks=0;
 f.deps.current=()=>{if(f.calls.length&&++replyChecks===2)queueMicrotask(()=>f.setActive(false));return current();};
 const r=await f.run();assert.equal(r.outcome,'outcome_unknown');assert(!('customer_action_id'in r));
});
