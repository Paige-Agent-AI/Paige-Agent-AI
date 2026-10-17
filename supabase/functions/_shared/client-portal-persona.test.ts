import {test} from "node:test";
import assert from "node:assert/strict";
import {readClientPortalPersonaInput, buildClientPortalPersonaMessages} from "./client-portal-persona.ts";

const actor="11111111-1111-4111-8111-111111111111";
const client="22222222-2222-4222-8222-222222222222";
const tenant="33333333-3333-4333-8333-333333333333";
const self={id:client,tenant_id:tenant,linked_user_id:actor};
const privateMarker="INTERNAL_ONLY_SENTINEL";
function fixture(options:Record<string,unknown>={}){
  const calls:string[]=[];
  const caller={rpc:async(name:string)=>{
    calls.push(name);
    if(name==="client_portal_frame")return {data:"frame"in options?options.frame:{
      actor_id:options.frameActor??actor,
      profile:"profile"in options?options.profile:self,
      brand:"brand"in options?options.brand:{tenant_id:tenant,tenant_name:"Test Coaching",support_email:"help@example.test",business_brief:privateMarker,from_name:privateMarker,private_notes:privateMarker},
      config:options.config??{welcome:{headline:privateMarker},assistant:{display_name:"Guide",tone:"Warm",service_scope:"Assigned coaching program",human_handoff:"Contact your coach",internal_notes:privateMarker,knowledge:privateMarker},private_memory:privateMarker},
    },error:options.error??null};
    throw new Error("Unexpected native read");
  }};return {caller,calls};
}
test("uses only one caller-bound atomic snapshot and the exact relationship",async()=>{
  const {caller,calls}=fixture();const input=await readClientPortalPersonaInput(caller,actor);
  assert.ok(input);assert.deepEqual(input.binding,{actorId:actor,clientId:client,tenantId:tenant});
  assert.deepEqual(calls,["client_portal_frame"]);
  assert.equal(input.businessName,"Test Coaching");assert.equal(input.assistantName,"Guide");
  assert.equal(JSON.stringify(input).includes(privateMarker),false);
  const messages=buildClientPortalPersonaMessages(input);
  assert.match(messages[0].content,/representing the business/);assert.match(messages[0].content,/not the business owner's operating assistant/);
  assert.match(messages[0].content,/explicitly shared/);assert.match(messages[0].content,/do not grant record access/);
  assert.match(messages[1].content,/Test Coaching/);assert.equal(JSON.stringify(messages).includes(privateMarker),false);
});
for(const [label,options]of Object.entries({
  "wrong business":{brand:{tenant_id:client,tenant_name:"Other"}},
  "ambiguous brands":{brand:[{tenant_id:tenant},{tenant_id:tenant}]},
  "empty brand":{brand:null},"malformed brand":{brand:42},
  "permission error":{error:{code:"42501"}},"read error":{error:{code:"08006"}},
  "revoked":{frame:null},"invalid client":{profile:{...self,id:"invalid"}},
  "changed business":{profile:{...self,tenant_id:client}},"changed actor":{profile:{...self,linked_user_id:client}},
  "ambiguous relation":{profile:[self]},"foreign frame actor":{frameActor:client},
}))test(`refuses ${label} instead of using another audience`,async()=>{
  assert.equal(await readClientPortalPersonaInput(fixture(options).caller,actor),null);
});
test("unknown actor is refused before any native presentation read",async()=>{
  const {caller,calls}=fixture();assert.equal(await readClientPortalPersonaInput(caller,""),null);assert.deepEqual(calls,[]);
});
test("malformed optional settings fall back to fixed customer defaults",async()=>{
  const input=await readClientPortalPersonaInput(fixture({config:{assistant:{display_name:{secret:privateMarker},tone:[],service_scope:42,enabled:"false"}}}).caller,actor);
  assert.ok(input);assert.equal(input.enabled,true);assert.equal(input.assistantName,"PAIGE");
  assert.equal(input.tone,"Warm, clear and professional");assert.equal(input.serviceScope,null);
});
test("owner disablement is explicit and cannot be overridden by configuration prose",async()=>{
  const input=await readClientPortalPersonaInput(fixture({config:{assistant:{enabled:false,display_name:"Guide",system_prompt:privateMarker,tools:["read_private_business"]}}}).caller,actor);
  assert.ok(input);assert.equal(input.enabled,false);assert.deepEqual(buildClientPortalPersonaMessages(input),[]);
});
test("unknown configuration fields and owner playbook instructions never enter the prompt",async()=>{
  const input=await readClientPortalPersonaInput(fixture({config:{assistant:{display_name:"Guide",role:privateMarker,system_prompt:privateMarker},playbook_config:{persona:{role:privateMarker}},brand:{business_brief:privateMarker}}}).caller,actor);
  assert.ok(input);assert.equal(JSON.stringify(buildClientPortalPersonaMessages(input)).includes(privateMarker),false);
});
test("native transport errors fail closed without returning sensitive diagnostics",async()=>{
  const caller={rpc:async()=>{throw new Error(privateMarker);}};
  assert.equal(await readClientPortalPersonaInput(caller,actor),null);
});
