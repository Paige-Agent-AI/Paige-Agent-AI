#!/usr/bin/env node
// Execute the ORIGINAL registered callback. Only request identity and database transport
// are synthetic. Real native role/workspace authority is tested separately in SQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source=readFileSync('supabase/functions/paige-mcp/index.ts','utf8');
const start=source.indexOf('mcp.tool("get_skill_run",');
const end=source.indexOf('\n});',start);
assert.ok(start>=0&&end>start,'original registration must exist');
const registration=source.slice(start,end+4);
const A='e0910000-0000-4000-8000-000000000001';
const T='e0920000-0000-4000-8000-000000000001';
const R='e0930000-0000-4000-8000-000000000001';
const C='e0940000-0000-4000-8000-000000000001';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const original={id:R,skill_id:A,skill_slug:'progress_checkin_draft',contact_id:C,invoker_kind:'mcp',invoker_user_id:A,
 inputs:{topic:'Review this client progress'},outputs:{draft:'A private draft'},status:'succeeded',error:null,
 steps_log:[{status:'draft_saved'}],duration_ms:42,created_at:'2026-01-01T00:00:00Z',completed_at:null};
const projected=()=>{const {steps_log,duration_ms,...rest}=structuredClone(original);return {...rest,steps:steps_log,latency_ms:duration_ms};};

function harness(options={}){
 const actor=Object.hasOwn(options,'actor')?options.actor:{kind:'user',user_id:A,scopes:['crm.read']};
 const calls=[],selects=[];let handler;
 const schema={uuid(){return this;}};
 const z={object(){return schema;},string(){return schema;}};
 const admin={
  async rpc(name,args){calls.push({name,args});if(options.throwRpc)throw new Error('private database detail');return {data:Object.hasOwn(options,'result')?options.result:projected(),error:options.error??null};},
  from(table){
   selects.push(table);
   assert.equal(actor?.kind,'platform','ordinary callers must not read privileged table payloads');
   assert.equal(table,'paige_skill_runs');
   const query={select(columns){
    selects.push(columns);
    for(const field of columns.split(',').map(x=>x.trim()))assert.ok(Object.hasOwn(original,field.split(':').at(-1)),`real column required: ${field}`);
    return query;
   },eq(key,value){assert.equal(key,'id');assert.equal(value,R);return query;},async maybeSingle(){return {data:Object.hasOwn(options,'result')?options.result:projected(),error:options.error??null};}};
   return query;
  }
 };
 const ok=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
 const err=error=>({content:[{type:'text',text:JSON.stringify({error})}],isError:true});
 new Function('mcp','z','admin','actorStore','actorTenantId','ok','err','AUDIT_UUID',registration)(
  {tool(name,spec){assert.equal(name,'get_skill_run');handler=spec.handler;}},z,admin,{getStore(){return actor;}},
  async()=>Object.hasOwn(options,'tenant')?options.tenant:T,ok,err,UUID);
 return {calls,selects,async read(args={run_id:R}){const result=await handler(args);return {error:result.isError===true,value:JSON.parse(result.content[0].text)};}};
}

test('owner/staff result uses validated actor and expected workspace in native read',async()=>{
 const h=harness(),r=await h.read();assert.equal(r.error,false);assert.deepEqual(r.value,projected());
 assert.deepEqual(h.calls,[{name:'read_mcp_skill_run',args:{_actor:A,_expected_tenant:T,_run_id:R}}]);assert.deepEqual(h.selects,[]);
});
test('model-supplied actor, tenant and invoker do not become authority',async()=>{
 const h=harness();await h.read({run_id:R,_actor:C,tenant_id:C,invoker_user_id:C,platform:true});
 assert.deepEqual(h.calls[0].args,{_actor:A,_expected_tenant:T,_run_id:R});
});
test('wrong readback identity is refused',async()=>{const h=harness({result:{...projected(),id:C}});assert.equal((await h.read()).value.error,'skill_run_unavailable');});
for(const [name,options] of [
 ['missing row',{result:null}],['native denial',{result:null}],['native transport error',{error:{message:'private schema details'}}],
 ['thrown transport error',{throwRpc:true}],['missing request context',{actor:undefined}],['null request actor',{actor:null}],
 ['user without verified identity',{actor:{kind:'user',user_id:null}}],['unknown actor kind',{actor:{kind:'other',user_id:A}}],
 ['unresolved workspace',{tenant:null}],
])test(name+' returns one safe unavailable result',async()=>{
 const h=harness(options),r=await h.read();assert.equal(r.error,true);assert.deepEqual(r.value,{error:'skill_run_unavailable'});
 if(['missing request context','null request actor','user without verified identity','unknown actor kind','unresolved workspace'].includes(name))assert.deepEqual(h.calls,[]);
});
test('malformed run reference is rejected before any read',async()=>{const h=harness();assert.equal((await h.read({run_id:'not-a-run'})).value.error,'skill_run_unavailable');assert.deepEqual(h.calls,[]);assert.deepEqual(h.selects,[]);});
test('explicit authenticated platform-key context retains its existing native result projection',async()=>{
 const h=harness({actor:{kind:'platform',user_id:null}}),r=await h.read();assert.equal(r.error,false);assert.deepEqual(r.value,projected());
 assert.deepEqual(h.calls,[]);assert.equal(h.selects[0],'paige_skill_runs');
 assert.match(h.selects[1],/steps:steps_log/);assert.match(h.selects[1],/latency_ms:duration_ms/);
});
test('platform reader does not disclose internal database errors',async()=>{
 const h=harness({actor:{kind:'platform',user_id:null},error:{message:'private detail'}});assert.deepEqual((await h.read()).value,{error:'skill_run_unavailable'});
});
test('platform reader still refuses missing and mismatched rows',async()=>{
 for(const result of [null,{...projected(),id:C}])assert.deepEqual((await harness({actor:{kind:'platform',user_id:null},result}).read()).value,{error:'skill_run_unavailable'});
});
