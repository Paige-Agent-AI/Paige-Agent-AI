import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const tenant='00000000-0000-0000-0000-000000000011',actor='00000000-0000-0000-0000-000000000001',operation='00000000-0000-0000-0000-000000000031';
function load(options={}){
 let handler;const rpc=[],effects=[];
 const resource={key:'twilio:'+tenant,provider:'twilio',tenant_id:tenant,sid:'AC'+'b'.repeat(32)};
 const plan={complete:false,mode:'archive',resources:[resource],results:{},...options.plan};
 const caller={auth:{getUser:async()=>({data:{user:options.unauthenticated?null:{id:actor}},error:null})},rpc:async(name,args)=>{rpc.push({name,args,client:'caller'});return {data:name==='operator_can_retire_accounts'?options.authorized!==false:name==='operator_read_retirement_resources'?{tenant_id:tenant,operation_id:operation,state:'resources_ready',results:[]}:null,error:name==='operator_begin_retirement_resources'&&options.beginError?{code:'40001',message:'private-error'}:null};}};
 const admin={rpc:async(name,args)=>{rpc.push({name,args,client:'service'});return{data:name==='operator_claim_retirement_resources'?plan:name==='operator_assert_retirement_resource'?options.assert!==false:null,error:options.fail===name?{code:'42501',message:'private-error-payload'}:null};}};
 const code=stripTypeScriptTypes(fs.readFileSync(new URL('../operator-account-retirement/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 vm.runInNewContext(code,{Request,Response,JSON,crypto:webcrypto,Deno:{env:{get:()=> 'synthetic-only'},serve:f=>{handler=f;}},createClient:(_u,key,o)=>o.global?caller:admin,masterCreds:()=>({accountSid:'AC'+'a'.repeat(32),authToken:'synthetic-only'}),retireTwilioSubaccount:async(...args)=>{effects.push(args);if(!args[3])assert.equal(await args[4](),true);return options.result??{state:'verified',provider_status:'suspended'};}});
 const request=(body={},headers={Authorization:'Bearer synthetic-only'})=>handler(new Request('https://local.invalid',{method:'POST',headers,body:JSON.stringify({tenant_id:tenant,operation_id:operation,action:'continue',...body})}));
 return{request,rpc,effects};
}
test('actual handler refuses ordinary membership and invalid authentication before service/provider access',async()=>{
 for(const options of [{authorized:false},{unauthenticated:true}]){const h=load(options),r=await h.request();assert.equal(r.status,options.unauthenticated?401:403);assert.equal(h.effects.length,0);assert.ok(!h.rpc.some(r=>r.client==='service'));}
});
test('forged provider identity and stale preflight never reach provider execution',async()=>{
 const h=load();assert.equal((await h.request({sid:'foreign-provider'})).status,400);assert.equal(h.effects.length,0);
 const stale=load({beginError:true});assert.equal((await stale.request({action:'prepare',mode:'archive',version:'stale',confirmation:'Example',retain_external_n8n:true})).status,409);assert.equal(stale.effects.length,0);
});
test('service claim binds verified actor and exact canonical resource; only one resource runs per request',async()=>{
 const h=load({plan:{resources:[{key:'twilio:'+tenant,provider:'twilio',tenant_id:tenant,sid:'AC'+'b'.repeat(32)},{key:'n8n:'+tenant,provider:'n8n',tenant_id:tenant,external_retention:true}]}});
 assert.equal((await h.request()).status,200);assert.equal(h.effects.length,1);
 assert.equal(h.rpc.find(r=>r.name==='operator_claim_retirement_resources').args._actor,actor);
 assert.equal(h.rpc.find(r=>r.name==='operator_finish_retirement_resource').args._key,'twilio:'+tenant);
});
test('late authority refusal and failed service claim prevent provider mutation',async()=>{
 for(const options of [{assert:false},{fail:'operator_claim_retirement_resources'}]){const h=load(options);assert.equal((await h.request()).status,409);assert.equal(h.effects.length,0);}
});
test('read recovery makes Twilio read-only and never disconnects an unprocessed n8n connection',async()=>{
 const h=load();assert.equal((await h.request({action:'read'})).status,200);assert.equal(h.effects[0][3],true);
 const n=load({plan:{resources:[{key:'n8n:'+tenant,provider:'n8n',tenant_id:tenant,external_retention:true}]}});assert.equal((await n.request({action:'read'})).status,200);assert.equal(n.effects.length,0);assert.ok(!n.rpc.some(r=>r.name==='operator_finish_retirement_resource'));
});
test('unknown provider outcome is recorded without claiming completed retirement',async()=>{
 const h=load({result:{state:'unknown',reason:'twilio_readback_unavailable'}});await h.request();const write=h.rpc.find(r=>r.name==='operator_finish_retirement_resource');assert.equal(write.args._state,'unknown');assert.equal(write.args._provider_status,null);
});
test('local finalization failure reports unknown and suppresses sensitive errors',async()=>{
 const h=load({fail:'operator_finish_retirement_resource'}),r=await h.request();assert.equal(r.status,502);assert.equal((await r.json()).error,'resource_outcome_unknown');assert.ok(!h.rpc.some(r=>r.name==='operator_complete_retirement_resources'));
});
test('a completed operation reads its receipt without repeating provider execution',async()=>{
 const h=load({plan:{complete:true}});assert.equal((await h.request()).status,200);assert.equal(h.effects.length,0);
});
