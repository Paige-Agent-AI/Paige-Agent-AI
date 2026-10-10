import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
for(const kind of ['tts_cache','generated_media'])test('the actual retirement handler removes server-bound '+kind+' before finalizing',async()=>{
 const tenant='00000000-0000-0000-0000-000000000011',actor='00000000-0000-0000-0000-000000000001',operation='00000000-0000-0000-0000-000000000031';
 let handler;const effects=[],writes=[];
 const caller={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async name=>({data:name==='operator_can_retire_accounts'?true:{},error:null})};
 const resource={key:kind+':'+tenant,provider:kind,tenant_id:tenant,objects:[{name:tenant+(kind==='tts_cache'?'/'+('a'.repeat(64))+'.mp3':'/1780000000000-abcdef12.png'),id:operation}]};
 const admin={rpc:async(name,args)=>{writes.push({name,args});return{data:name==='operator_claim_retirement_resources'?{complete:false,mode:'delete',resources:[resource],results:{}}:name==='operator_assert_retirement_resource'?true:null,error:null};}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/operator-account-retirement/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 const remove=async(...args)=>{effects.push(args);return{state:'verified',provider_status:'removed'};};
 vm.runInNewContext(code,{Request,Response,JSON,crypto:webcrypto,Deno:{env:{get:()=> 'synthetic-only'},serve:f=>{handler=f;}},createClient:(_u,_k,o)=>o.global?.headers?caller:admin,masterCreds:()=>null,retireTwilioSubaccount:()=>{throw Error('Wrong provider');},retireTenantTtsCache:kind==='tts_cache'?remove:()=>{throw Error('Wrong storage');},retireTenantGeneratedMedia:kind==='generated_media'?remove:()=>{throw Error('Wrong storage');}});
 const response=await handler(new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-only'},body:JSON.stringify({tenant_id:tenant,operation_id:operation,action:'continue'})}));
 assert.equal(response.status,200);assert.equal(effects.length,1);
 const finished=writes.find(r=>r.name==='operator_finish_retirement_resource');assert.equal(finished.args._state,'verified');assert.equal(finished.args._provider_status,'removed');
});
