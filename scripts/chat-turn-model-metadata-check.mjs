import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {drive} from './thread-summary-fabric-check.mjs';

// Reuse the incumbent actual-handler recording fixture; its21 fold/recall regressions
// also run on import. Every transport is synthetic; no real provider/key/JWT.
let passed=0,failed=0;
async function check(name,run){try{await run();passed++;console.log(`PASS metadata ${name}`);}catch(error){failed++;console.error(`FAIL metadata ${name}: ${error.message}`);}}
for(const route of ['primary','fallback'])await check(`actual ${route} answer persists NULL without changing content/state`,async()=>{
 const result=await drive({noFold:true,answerRoute:route});
 assert.equal(result.status,200);assert.deepEqual(result.answerProviders,route==='primary'?['openai']:['openai','anthropic']);
 const saved=result.rec.rpc.filter(call=>call.name==='paige_chat_interactive_settle');assert.equal(saved.length,1);
 assert.equal(saved[0].args.p_model,null);assert.equal(saved[0].args.p_content,'Ordinary reply.');
 assert.equal(saved[0].args.p_bundle_ref.turn_state.state,'FINAL');assert.equal(saved[0].args.p_bundle_ref.turn_state.rounds,1);
 assert.equal(saved[0].args.p_bundle_ref.turn_state.tools,0);assert.equal(result.folds.length,0);
 for(const entry of saved[0].args.p_bundle_ref.turn_trace??[])assert.deepEqual(Object.keys(entry).sort(),['group','label','status']);
});

// The explicit model option has no current whole-handler caller. Execute the
// exact private persistence closure through protected append/settlement ports
// to preserve that existing contract, rather than manufacturing a request field.
const source=ts.createSourceFile('chat.ts',fs.readFileSync(new URL('../supabase/functions/paige-ai-chat/index.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let persistence;
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='persistAssistantTurn')persistence=node.initializer;ts.forEachChild(node,visit);};visit(source);
assert.ok(persistence&&ts.isArrowFunction(persistence));
const executable=ts.transpileModule(`const persistAssistantTurn=${persistence.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
for(const explicit of [undefined,'gpt-6.1-sol'])await check(explicit?'explicit server model remains exact':'server-authored no-model terminal persists NULL',async()=>{
 const writes=[];let settlements=0;
 const thread='00000000-0000-4000-8000-000000000004',intent='00000000-0000-4000-8000-000000000005';
 const append=async args=>{writes.push(args);return {data:'00000000-0000-4000-8000-000000000008',error:null};};
 const persist=new Function('payloadThreadId','appendAssistant','interactiveSettlement','interactive','interactiveConversational','payloadRequestIntentId',`${executable};return persistAssistantTurn;`)
  (thread,append,{persist:async write=>{settlements++;return write();}},true,false,intent);
 const bundle={turn_state:{v:1,state:'FINAL',mode:'action',rounds:0,tools:1},turn_trace:[{group:'owner',label:'Fixture work',status:'done'}]};
 await persist('Canonical server-authored result.',{bundleRef:bundle,surfaces:['owner'],...(explicit?{model:explicit}:{})},true);
 assert.equal(settlements,1);assert.equal(writes.length,1);
 assert.deepEqual(writes[0],{p_thread_id:thread,p_role:'assistant',p_content:'Canonical server-authored result.',p_surfaces_used:['owner'],p_load_id:null,
  p_model:explicit??null,p_tokens_used:null,p_latency_ms:null,p_bundle_ref:{...bundle,interactive:{request_intent_id:intent}},p_tool_calls:null});
});
console.log(`${passed} passed, ${failed} failed focused model-metadata controls (2 actual handler,2 exact private closure); native SQL/provider acceptance unverified`);
if(failed)process.exitCode=1;
