import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
test('the actual retirement handler removes server-bound cached audio before finalizing',async()=>{
 const tenant='00000000-0000-0000-0000-000000000011',actor='00000000-0000-0000-0000-000000000001',operation='00000000-0000-0000-0000-000000000031';
 let handler;const effects=[],writes=[];
 const caller={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async name=>({data:name==='operator_can_retire_accounts'?true:{},error:null})};
 const resource={key:'tts_cache:'+tenant,provider:'tts_cache',tenant_id:tenant,objects:[{name:tenant+'/'+('a'.repeat(64))+'.mp3',id:operation}]};
 const admin={rpc:async(name,args)=>{writes.push({name,args});return{data:name==='operator_claim_retirement_resources'?{complete:false,mode:'delete',resources:[resource],results:{}}:name==='operator_assert_retirement_resource'?true:null,error:null};}};
 const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/operator-account-retirement/index.ts','utf8').replace(/^import .*;\r?\n/gm,''),{mode:'transform'});
 vm.runInNewContext(code,{Request,Response,JSON,crypto:webcrypto,Deno:{env:{get:()=> 'synthetic-only'},serve:f=>{handler=f;}},createClient:(_u,_k,o)=>o.global?.headers?caller:admin,masterCreds:()=>null,retireTwilioSubaccount:()=>{throw Error('Wrong provider');},retireTenantTtsCache:async(...args)=>{effects.push(args);return{state:'verified',provider_status:'removed'};}});
 const response=await handler(new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic-only'},body:JSON.stringify({tenant_id:tenant,operation_id:operation,action:'continue'})}));
 assert.equal(response.status,200);assert.equal(effects.length,1);
 const finished=writes.find(r=>r.name==='operator_finish_retirement_resource');assert.equal(finished.args._state,'verified');assert.equal(finished.args._provider_status,'removed');
});
