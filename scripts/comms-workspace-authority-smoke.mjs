#!/usr/bin/env node
// Original EXP03 calling authority. Actual handlers, synthetic Auth/DB/provider ports only.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const proofRoot=fs.realpathSync(process.env.COMMS_AUTH_PROOF_DIR??os.tmpdir());
const dir=fs.mkdtempSync(path.join(proofRoot,"comms-authority-"));
const TENANT="20000000-0000-4000-8000-000000000001",OTHER="20000000-0000-4000-8000-000000000002",ACTOR="10000000-0000-4000-8000-000000000001";
let scenario={},calls=[],tenantReads=0,roleReads=0,ownerReads=0,handler;
globalThis.__commsAuthority={
  user:()=>({data:{user:scenario.noUser?null:{id:ACTOR}},error:scenario.userError?{message:"synthetic unavailable"}:null}),
  async rpc(name,args){
    calls.push({name,args});
    if(name==="current_user_tenant_id")return{data:scenario.changedDuringRole||(scenario.switchTenant&&++tenantReads>1)||(scenario.lateSwitch&&++tenantReads>2)?OTHER:TENANT,error:scenario.tenantError?{message:"synthetic unavailable"}:null};
    if(name==="is_platform_owner")return{data:scenario.operator===true&&(!scenario.revokeOwner||++ownerReads===1),error:scenario.ownerError?{message:"synthetic unavailable"}:null};
    if(name==="has_role")return{data:scenario.globalAdmin===true,error:null};
    if(name==="is_tenant_admin_as"){
      roleReads++;
      if(scenario.roleThrows)throw new Error("synthetic unavailable");
      if(scenario.switchDuringRole&&roleReads===2)scenario.changedDuringRole=true;
      return{data:scenario.malformedRole?"true":scenario.tenantAdmin===true&&(!scenario.revokeRole||roleReads===1),error:scenario.roleError?{message:"synthetic unavailable"}:null};
    }
    if(name==="comms_provider_execution_allowed")return{data:true,error:null};
    return{data:null,error:null};
  },
  read:table=>({data:table==="tenant_twilio_subaccounts"?{id:"synthetic-sub",inbound_webhook_secret:"synthetic-only"}:table==="tenants"?{name:"Synthetic business"}:table==="platform_number_pricing"?{retail_monthly_cents:120}:null,error:null}),
  provider(name,...args){calls.push({name,args});return{ok:false,needs_config:true,outcome:"blocked_needs_config",steps:[]};},
};
globalThis.Deno={env:{get:k=>({SUPABASE_URL:"https://example.test",SUPABASE_ANON_KEY:"synthetic",SUPABASE_SERVICE_ROLE_KEY:"synthetic"}[k])},serve:h=>{handler=h;}};
fs.writeFileSync(path.join(dir,"client.mjs"),`
export function createClient(){const g=globalThis.__commsAuthority;return{auth:{getUser:async()=>g.user()},rpc:(n,a)=>g.rpc(n,a),from:t=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>g.read(t),then:ok=>Promise.resolve(g.read(t)).then(ok)};return q;}};}
`);
fs.writeFileSync(path.join(dir,"twilio.mjs"),`
export const resolveTwilioCreds=async(_a,t)=>{globalThis.__commsAuthority.provider("credentials",t);return{ok:true,data:{accountSid:"synthetic",authToken:"synthetic",apiKeySid:"synthetic"}};};
export const purchaseNumber=async(...a)=>globalThis.__commsAuthority.provider("purchase",...a);
export const listAvailableNumbers=async(...a)=>globalThis.__commsAuthority.provider("search",...a);
export const voiceTwimlUrl=()=>"https://example.test/inert";
export const computeTwilioSignature=()=>{throw new Error("not a callback test");};
export const validateTwilioSignature=()=>{throw new Error("not a callback test");};
`);
fs.writeFileSync(path.join(dir,"provision.mjs"),`export const provisionTenantTwilio=async(...a)=>globalThis.__commsAuthority.provider("setup",...a);`);
let passed=0;const failures=[];
try{
  for(const endpoint of ["comms-search-numbers","comms-purchase-number","comms-setup-calling"]){
    const file=path.join(dir,endpoint+".mjs");
    await build({entryPoints:[`supabase/functions/${endpoint}/index.ts`],outfile:file,bundle:true,format:"esm",platform:"neutral",target:"es2022",plugins:[{name:"synthetic-ports",setup(b){
      b.onResolve({filter:/^https:\/\/esm\.sh\/@supabase\/supabase-js/},()=>({path:path.join(dir,"client.mjs")}));
      b.onResolve({filter:/_shared\/twilio\.ts$/},()=>({path:path.join(dir,"twilio.mjs")}));
      b.onResolve({filter:/_shared\/twilio-provision\.ts$/},()=>({path:path.join(dir,"provision.mjs")}));
    }}]});
    await import(pathToFileURL(file).href);assert.equal(typeof handler,"function");
    const cases=[
      ["own tenant administrator, no global role",{tenantAdmin:true},200,true],
      ["global-only role is not business authority",{globalAdmin:true},403,false],
      ["ordinary member",{},403,false],
      ["existing explicit platform-owner exception",{operator:true},200,true],
      ["role read failure",{tenantAdmin:true,roleError:true},503,false],
      ["role read transport failure",{tenantAdmin:true,roleThrows:true},503,false],
      ["active-business read failure",{tenantAdmin:true,tenantError:true},503,false],
      ["active business changed before provider",{tenantAdmin:true,switchTenant:true},409,false],
      ["unverified user",{noUser:true},401,false],
      ["authentication error alongside user",{tenantAdmin:true,userError:true},401,false],
      ["platform-owner read failure",{tenantAdmin:true,ownerError:true},503,false],
      ["malformed role result",{malformedRole:true},403,false],
      ["role revoked after credential read",{tenantAdmin:true,revokeRole:true,late:true},403,false],
      ["platform-owner privilege revoked",{operator:true,revokeOwner:true,late:true},403,false],
      ["business switched after credential read",{tenantAdmin:true,lateSwitch:true,late:true},409,false],
      ["business switched while final role read completes",{tenantAdmin:true,switchDuringRole:true,late:true},409,false],
      ["missing Authorization",{noAuth:true},401,false],
    ];
    for(const [name,state,status,allowed]of cases){
      scenario=state;calls=[];tenantReads=0;roleReads=0;ownerReads=0;
      try{
        const response=await handler(new Request("https://example.test/handler",{method:"POST",headers:{...(!state.noAuth?{Authorization:"Bearer synthetic"}:{}),"Content-Type":"application/json"},body:JSON.stringify({phone_number:"+15555550101",area_code:"555",tenant_id:OTHER,dry_run:true})}));
        assert.equal(response.status,status);const provider=calls.filter(c=>(state.late?["purchase","search","setup"]:["credentials","purchase","search","setup"]).includes(c.name));
        assert.equal(provider.length>0,allowed,"denied scope must stop before credential/provider access");
        if(!state.noUser&&!state.noAuth&&!state.userError&&!state.operator&&!state.tenantError&&!state.ownerError){
          const role=calls.find(c=>c.name==="is_tenant_admin_as");assert.deepEqual(role?.args,{_actor:ACTOR,_tenant:TENANT});
        }
        if(allowed&&!state.operator)assert.ok(calls.every(c=>c.name!=="has_role"),"global role is not a fallback");
        if(allowed)assert.ok(provider.every(c=>c.name!=="credentials"||c.args[0]===TENANT),"body cannot select another tenant");
        passed++;console.log(`PASS ${endpoint}: ${name}`);
      }catch(error){failures.push(`${endpoint}: ${name}: ${error.message}`);}
    }
  }
}finally{assert.equal(path.dirname(fs.realpathSync(dir)),proofRoot,"cleanup stays inside the owned proof directory");fs.rmSync(dir,{recursive:true,force:true});delete globalThis.__commsAuthority;delete globalThis.Deno;}
console.log(JSON.stringify({passed,failed:failures.length,failures},null,2));
assert.equal(failures.length,0,"original calling authority boundary failed");
