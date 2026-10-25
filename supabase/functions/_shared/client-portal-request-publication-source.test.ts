import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparePortalRequestPublication} from './client-portal-request-publication.ts';

const id=(n:number)=>`e09fc000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target=()=>({expected_tenant_id:id(2),contact_id:id(4),work_id:id(5),version:'2026-10-25T12:34:56.123456+00:00',
 title:'Review the welcome guide',body:'Start with section one.',recipient_user_id:id(6),access_version:null});
const source=()=>({schema_version:1,actor_id:id(1),tenant_id:id(2),contact_id:id(4),work_id:id(5),
 source_state:'prepared',args:target(),customer_action_id:null,read_at:'2026-10-25T12:35:01.123456+00:00'});
function fixture(){
 const scope={actorId:id(1),tenantId:id(2),threadId:id(3) as string|null,clientId:id(4) as string|null,audience:'owner' as 'owner'|'customer'};
 const input={contact_id:id(4),work_id:id(5)},calls:{name:string;args:unknown}[]=[];
 let active=true,actor:string|null=id(1),data:unknown=source(),error:unknown=null,authError:unknown=null,during=()=>{};
 const deps={current:()=>active,caller:{auth:{getUser:async()=>({data:{user:actor?{id:actor}:null},error:authError})},
  rpc:async(name:string,args:unknown)=>{calls.push({name,args});during();return {data,error};}}};
 return {scope,input,calls,deps,run:()=>preparePortalRequestPublication(deps,scope,input),
  active:(x:boolean)=>{active=x;},actor:(x:string|null)=>{actor=x;},data:(x:unknown)=>{data=x;},error:(x:unknown)=>{error=x;},
  authError:(x:unknown)=>{authError=x;},during:(x:()=>void)=>{during=x;}};
}
test('source preparation reads one exact owner-JWT native source and retains native precision',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.outcome,'prepared');if(r.outcome!=='prepared')return;
 assert.deepEqual(r.args,target());assert(Object.isFrozen(r.args));
 assert.deepEqual(f.calls,[{name:'read_client_portal_request_share_source',args:{_expected_actor_id:id(1),_expected_tenant_id:id(2),_contact_id:id(4),_work_id:id(5)}}]);
 for(const forbidden of ['confirmed','confirmation_id','fingerprint','requestNonce','private_intent'])assert(!(forbidden in r));
});
test('already shared returns only original identities for recovery, never replacement proposal words',async()=>{
 const f=fixture();f.data({...source(),source_state:'shared',args:null,customer_action_id:id(9)});
 assert.deepEqual(await f.run(),{success:true,outcome:'already_shared',work_id:id(5),customer_action_id:id(9)});assert.equal(f.calls.length,1);
});
test('unfocused owner uses the same trusted source reader',async()=>{const f=fixture();f.scope.clientId=null;assert.equal((await f.run()).outcome,'prepared');});
for(const [name,change]of [
 ['customer persona',(f:ReturnType<typeof fixture>)=>{f.scope.audience='customer';}],
 ['wrong focused client',(f:ReturnType<typeof fixture>)=>{f.scope.clientId=id(99);}],
 ['inactive request',(f:ReturnType<typeof fixture>)=>f.active(false)],
 ['missing actual user',(f:ReturnType<typeof fixture>)=>f.actor(null)],
 ['different actual user',(f:ReturnType<typeof fixture>)=>f.actor(id(99))],
 ['failed Auth',(f:ReturnType<typeof fixture>)=>f.authError({message:'unavailable'})],
 ['model-authored approval',(f:ReturnType<typeof fixture>)=>{Object.assign(f.input,{confirmed:true});}],
]as const)test('source read refuses '+name+' before RPC',async()=>{const f=fixture();change(f);assert.equal((await f.run()).outcome,'source_unavailable');assert.equal(f.calls.length,0);});
for(const [key,value]of [
 ['actor_id',id(99)],['tenant_id',id(99)],['contact_id',id(99)],['work_id',id(99)],['schema_version',2],
 ['read_at','yesterday'],['source_state','approved'],['customer_action_id',id(9)],['private_payload',{hidden:true}],
]as const)test('foreign or malformed source '+key+' exposes no proposed words',async()=>{const f=fixture();f.data({...source(),[key]:value});assert.deepEqual(await f.run(),{success:false,outcome:'source_unavailable'});});
for(const [key,value]of [
 ['expected_tenant_id',id(99)],['contact_id',id(99)],['work_id',id(99)],['recipient_user_id',null],['version','now'],
 ['access_version','infinity'],['title',''],['body',''],['confirmation_id',id(9)],
]as const)test('malformed native argument '+key+' cannot reach original approval',async()=>{const f=fixture();f.data({...source(),args:{...target(),[key]:value}});assert.equal((await f.run()).outcome,'source_unavailable');});
test('shared source must not carry preparation words',async()=>{const f=fixture();f.data({...source(),source_state:'shared',customer_action_id:id(9)});assert.equal((await f.run()).outcome,'source_unavailable');});
test('native denial or missing source cannot become a proposal',async()=>{const f=fixture();f.error({code:'42501'});assert.equal((await f.run()).outcome,'source_unavailable');});
test('interrupted source fetch does not retry or invoke a writer',async()=>{const f=fixture();f.deps.caller.rpc=async()=>{throw Error('interrupted');};assert.equal((await f.run()).outcome,'source_unavailable');});
test('workspace change during read withholds words',async()=>{const f=fixture();f.during(()=>f.active(false));assert.equal((await f.run()).outcome,'source_unavailable');});
test('retargeting captured source while Auth is awaited refuses before RPC',async()=>{const f=fixture(),pending=f.run();f.input.work_id=id(99);assert.equal((await pending).outcome,'source_unavailable');assert.equal(f.calls.length,0);});
test('retirement at final Auth continuation refuses before read',async()=>{const f=fixture(),original=f.deps.current;let checks=0;f.deps.current=()=>{if(++checks===2)queueMicrotask(()=>f.active(false));return original();};assert.equal((await f.run()).outcome,'source_unavailable');assert.equal(f.calls.length,0);});
test('retirement at final source continuation withholds words',async()=>{const f=fixture(),original=f.deps.current;let checks=0;f.deps.current=()=>{if(f.calls.length&&++checks===2)queueMicrotask(()=>f.active(false));return original();};assert.equal((await f.run()).outcome,'source_unavailable');});
