// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { interactiveEffect } from '../../supabase/functions/_shared/paige-turn/interactive';
import { parseResearchSourcePolicy, researchResultHonorsSourcePolicy } from '../../supabase/functions/_shared/research-source-policy';
import { originalResearchPayload, readAcceptedResearchTurn, researchCallerCurrent } from '../../supabase/functions/_shared/paige-turn/research-work';
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Statement | undefined;
function visit(n: ts.Node) { if (ts.isIfStatement(n) && n.expression.getText(ast) === 'tc.function.name === "deep_research"') branch = n.thenStatement; ts.forEachChild(n, visit); }
visit(ast);
if (!branch) throw new Error('Canonical Research dispatch missing');
let append: ts.Expression | undefined;
function findAppend(n: ts.Node) {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'appendAssistant') append = n.initializer;
  ts.forEachChild(n, findAppend);
}
findAppend(ast);
if (!append) throw new Error('Original assistant settlement missing');
const code = ts.transpileModule(`async function dispatch(tc, supabaseClient, personaCtx, user, toolResults,
  supabase, logAnalyticsEvent, fetch, supabaseUrl, supabaseServiceKey, formatDossier, parseResearchSourcePolicy, researchResultHonorsSourcePolicy,
  originalResearchPayload, readAcceptedResearchTurn, researchCallerCurrent, scope = null, turnRecord = null, mixedBatch = false) {
    const interactiveReceiptScope = scope, customerPortal = false, studioSessionId = null;
    const req = { signal: new AbortController().signal }, toolCalls = [tc, ...(mixedBatch ? [{id:'other-call',function:{name:'plan_create'}}] : [])], readOriginalResearchTurnRecord = () => turnRecord;
    let originalResearchAccepted = null;
    for (const selected of [tc]) ${branch.getText(ast)}
    return { originalResearchBinding: interactiveReceiptScope?.researchWork ?? null, originalResearchAccepted };
  }`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dispatch = new Function(`${code}; return dispatch;`)();
const missingIdentityCode = code.replace('tenant_id: tenantId, actor_user_id: user.id,', '');
if (missingIdentityCode === code) throw new Error('Required native identity causal mutation did not apply');
const dispatchWithoutAuthorityIdentity = new Function(`${missingIdentityCode}; return dispatch;`)();
const missingAcceptanceCode = code.replace(/if \(!originalResearchAccepted && researchStarted && originalResearchBinding && !researchScopeInvalidated\) \{[\s\S]*?\n\s*\}/, '');
if (missingAcceptanceCode === code) throw new Error('Acceptance reconciliation causal mutation did not apply');
const dispatchWithoutAcceptanceRead = new Function(`${missingAcceptanceCode}; return dispatch;`)();
let acceptedPause: ts.Statement | undefined;
function findAcceptedPause(n: ts.Node) {
  if (ts.isIfStatement(n) && n.expression.getText(ast) === 'interactive && originalResearchAccepted') acceptedPause = n;
  ts.forEachChild(n, findAcceptedPause);
}
findAcceptedPause(ast);
if (!acceptedPause) throw new Error('Original Research accepted pause missing');
const runOriginalPause = new Function('dispatchOnce', `return (async () => {
  const interactive = true, enc = new TextEncoder();
  let durableResearchPause = false, forcedTermination = false, finalAssistantText = '', finalChunks = [], modelCalls = 0;
  for (let round = 0; round < 2; round++) {
    modelCalls++;
    const originalResearchAccepted = await dispatchOnce(round);
    ${acceptedPause.getText(ast)}
  }
  return { modelCalls, durableResearchPause, forcedTermination, finalAssistantText };
})();`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant=id(1), actor=id(2), run=id(3), question='Fixture public question';
const sources=[{ index:1,url:'https://example.com/source',title:'Fixture source',snippet:'Source text',
  reliability_score:.9,tier:'T1',reliability:'high',excluded:false,published_at:null,fetched_at:'2026-10-15T16:00:00Z' }];
const findings=[{text:'Fixture cited finding',citations:[1],confidence:'high'}];
const native={run_id:run,question,findings,sources,coverage:{configured:true,stop_reason:'answered',hops_used:1,searches:1,reads:1,note:''}};
const saved={id:run,question,domain:'general',caller:'chat',configured:true,stop_reason:'answered',findings,sources,coverage:native.coverage};
async function drive(options: { readback?:unknown; readError?:unknown; native?:unknown; status?:number; tenant?:string|null; scopes?:string[]; transportLost?:boolean; afterLoss?:'actor'|'tenant'|'read-error'; scopeErrorAt?:number; args?:Record<string,unknown>; durable?:boolean; accepted?:boolean; omitAuthorityIdentity?:boolean; omitAcceptanceRead?:boolean; mixedBatch?:boolean }={}) {
  const calls:Array<{body:Record<string,unknown>;headers:Record<string,string>}>=[];
  const outputs:Array<{content:string}>=[];
  const rpcs:Array<{name:string;args:unknown}>=[];
  let scopeReads=0;
  let analytics=0;
  let responseLost=false;
  const record = { v: 1, state: 'FINAL', mode: 'answer', rounds: 2, tools: 3 };
  const issued = { id:id(8), role:'assistant',content:'The original research job was accepted.',
    interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_intent_id:id(4),interactive_terminal_state:'WAIT_WORK',
    bundle_ref:{turn_state:{...record,state:'WAIT_WORK'},interactive:{request_intent_id:id(4),
      effects:[{tool:'deep_research',outcome:'durable_accepted',work_id:run}]}}};
  const query = { eq:()=>query, maybeSingle:async()=>({data:options.accepted===false?null:issued,
    error:responseLost&&options.afterLoss==='read-error'?new Error('native receipt unavailable'):null}) };
  const caller={auth:{getUser:async()=>({data:{user:{id:responseLost&&options.afterLoss==='actor'?id(99):actor}},error:null})},
    from:()=>({select:()=>query}),rpc:async(name:string,args:unknown)=>{
    rpcs.push({name,args});
    if(name==='current_user_tenant_id'){
      const index=scopeReads++;
      if(options.scopeErrorAt===index)throw new TypeError('Scope response unavailable');
      return {data:responseLost&&options.afterLoss==='tenant'?id(99):options.scopes?.[index]??tenant,error:null};
    }
    return {data:'readback' in options?options.readback:saved,error:options.readError??null};
  }};
  const preparations: Array<{name:string;args:unknown}> = [];
  const service = {rpc:async(name:string,args:unknown)=>{
    preparations.push({name,args});
    const input = args as { _tenant_id: string; _initiating_user_id: string; _authority_context: Record<string,unknown> };
    // Original create_paige_durable_work identity invariant (20271108201000):
    // native preparation must refuse before dispatch if the context omits/mismatches either field.
    if (input._authority_context.tenant_id !== input._tenant_id || input._authority_context.actor_user_id !== input._initiating_user_id)
      return {data:null,error:{code:'22023',message:'DURABLE_WORK_AUTHORITY_CONTEXT_INVALID'}};
    return{error:null,
    data:[{work_id:run,work_status:'blocked',blocked_reason:'research_execution_not_enabled',resumed_existing:false}]};}};
  const invokeDispatch = options.omitAuthorityIdentity ? dispatchWithoutAuthorityIdentity
    : options.omitAcceptanceRead ? dispatchWithoutAcceptanceRead : dispatch;
  const outcome = await invokeDispatch({id:'research-fixture',function:{name:'deep_research',arguments:JSON.stringify({question,
      ...(options.durable?{}:{expected_tenant_id:id(99),user_id:id(98)}),...options.args})}},
    caller,{tenant_id:'tenant' in options?options.tenant:tenant},{id:actor},outputs,service,()=>{analytics++;},
    async(_url:string,init:{body:string;headers:Record<string,string>})=>{
      calls.push({body:JSON.parse(init.body),headers:init.headers});
      if(options.transportLost){responseLost=true;throw new TypeError('fixture secret provider body');}
      return Response.json('native' in options?options.native:native,{status:options.status??200});
    },'https://fixture.invalid','fixture-service-key',()=>null,parseResearchSourcePolicy,researchResultHonorsSourcePolicy,
    originalResearchPayload,readAcceptedResearchTurn,researchCallerCurrent,
    options.durable?{thread:id(5),intent:id(4),tenant}:null,record,options.mixedBatch);
  expect(outputs).toHaveLength(1);
  return {calls,rpcs,analytics,preparations,outcome,result:JSON.parse(outputs[0].content)};
}
describe('Research Chat native invocation and durable library proof',()=>{
  it('the actual accepted-pause control stops a lost-response objective before another model round',async()=>{
    for (const omitAcceptanceRead of [true,false]) {
      let workerCalls=0;
      const observed = await runOriginalPause(async(round:number)=>{
        if (round > 0) return null; // A later model answer, not a replayed worker call.
        const result=await drive({durable:true,transportLost:true,omitAcceptanceRead});
        workerCalls+=result.calls.length;
        return result.outcome.originalResearchAccepted;
      });
      expect(observed.modelCalls).toBe(omitAcceptanceRead?2:1);
      expect(workerCalls).toBe(1);
      expect(observed.durableResearchPause).toBe(!omitAcceptanceRead);
      if(!omitAcceptanceRead) expect(observed.finalAssistantText).toBe('The original research job was accepted.');
    }
  });
  it.each(['actor','tenant','read-error'] as const)('withholds lost-response acceptance after %s changes without replay',async afterLoss=>{
    const {calls,result,outcome}=await drive({durable:true,transportLost:true,afterLoss});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({outcome_unknown:true,saved:false});
    expect(result.accepted).toBeUndefined();
    expect(outcome.originalResearchAccepted).toBeNull();
  });
  it('reconciles the original native acceptance after a lost worker response without another dispatch',async()=>{
    const {calls,result,outcome}=await drive({durable:true,transportLost:true});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({accepted:true,work_id:run,outcome_unknown:true,saved:false});
    expect(outcome.originalResearchAccepted?.id).toBe(id(8));
    expect(result.findings).toBeUndefined();
  });
  it('does not invent native acceptance after a lost response when its original read is unavailable',async()=>{
    const {calls,result,outcome}=await drive({durable:true,transportLost:true,accepted:false});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({outcome_unknown:true,saved:false});
    expect(result.accepted).toBeUndefined();
    expect(outcome.originalResearchAccepted).toBeNull();
  });
  it.each([{mixedBatch:true},{args:{expected_tenant_id:id(99)}}])('refuses unsupported v1/mixed-batch preparation before any worker call: %j',async options=>{
    const {calls,preparations,result}=await drive({durable:true,...options});
    expect(calls).toHaveLength(0);expect(preparations).toHaveLength(0);
    expect(result).toMatchObject({success:false,not_applied:true});
  });
  it('reproduces the reviewed missing-native-identity fault causally before any worker/provider invocation',async()=>{
    const broken = await drive({durable:true,omitAuthorityIdentity:true});
    expect(broken.preparations).toHaveLength(1);
    expect(broken.calls).toHaveLength(0);
    expect(broken.result).toMatchObject({success:false,not_applied:true});
    const corrected = await drive({durable:true});
    expect(corrected.calls).toHaveLength(1);
    expect(corrected.result).toMatchObject({accepted:true,work_id:run,saved:true});
  });
  it('the actual assistant settlement preserves the original accepted turn and never issues FINAL over it',async()=>{
    const row = { id:id(8), role:'assistant', content:'Original accepted message',
      interactive_actor_id:actor,interactive_tenant_id:tenant,interactive_intent_id:id(4),interactive_terminal_state:'WAIT_WORK',
      bundle_ref:{turn_state:{v:1,state:'WAIT_WORK'},interactive:{request_intent_id:id(4),
        effects:[{tool:'deep_research',outcome:'durable_accepted',work_id:run}]}}};
    const writes: unknown[] = [];
    const query = { eq:()=>query,maybeSingle:async()=>({data:row,error:null}) };
    const caller = { auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},
      rpc:async()=>({data:tenant,error:null}),from:()=>({select:()=>query}) };
    const js = ts.transpileModule(`function make(readAcceptedResearchTurn,supabaseClient,supabase,user,req) {
      const interactiveReceiptScope={thread:'${id(5)}',tenant:'${tenant}',intent:'${id(4)}',
        researchWork:{actorId:'${actor}',tenantId:'${tenant}',threadId:'${id(5)}',intentId:'${id(4)}',workId:'${run}'}};
      return ${append!.getText(ast)};
    }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const make = new Function(`${js};return make;`)();
    const preserve = make(readAcceptedResearchTurn,caller,{rpc:(...args:unknown[])=>{writes.push(args);throw new Error('unexpected write');}},
      {id:actor},{signal:new AbortController().signal});
    expect(await preserve({p_thread_id:id(5),p_role:'assistant',p_content:'Do not overwrite with this FINAL',
      p_bundle_ref:{turn_state:{v:1,state:'FINAL'}}})).toEqual({data:id(8),error:null});
    expect(writes).toHaveLength(0);
    expect(row.content).toBe('Original accepted message');
    await expect(preserve({p_thread_id:id(99),p_role:'assistant'})).rejects.toThrow('INTERACTIVE_RECEIPT_SCOPE_MISMATCH');
  });
  it('prepares the same original identity and actual tracker snapshot, then consumes native acceptance before saved readback',async()=>{
    const {calls,preparations,result,outcome}=await drive({durable:true});
    expect(preparations).toHaveLength(1);
    expect(preparations[0]).toMatchObject({name:'prepare_paige_research_work',args:{_tenant_id:tenant,
      _initiating_user_id:actor,_intent_id:id(4),_thread_id:id(5),_request_payload:{version:1,question,caller:'chat'},
      _authority_context:{authority_source:'server_resolved',approval_reusable:false,tenant_id:tenant,actor_user_id:actor,
        chat_turn_record:{v:1,mode:'answer',rounds:2,tools:3}}}});
    expect(calls).toHaveLength(1);
    expect(calls[0].body.durable_work).toEqual({work_id:run,thread_id:id(5),intent_id:id(4)});
    expect(result).toMatchObject({accepted:true,work_id:run,saved:true,run_id:run});
    expect(outcome.originalResearchAccepted.id).toBe(id(8));
  });
  it('a native pending response retains only the same accepted job, without inventing a report',async()=>{
    const {calls,result}=await drive({durable:true,status:202,native:{research_state:'in_progress',run_id:run}});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({accepted:true,work_id:run});
    expect(result.saved).toBeUndefined(); expect(result.findings).toBeUndefined();
  });
  it('refuses unverified accepted metadata after dispatch without fabricating a durable effect',async()=>{
    const {result}=await drive({durable:true,accepted:false});
    expect(result).toMatchObject({success:false,saved:false,outcome_unknown:true});
    expect(result.accepted).toBeUndefined();
  });
  it('keeps a filtered legacy request intact instead of silently widening it for durable Work',async()=>{
    const {calls,preparations}=await drive({durable:true,args:{allowed_domains:['example.com'],max_sources:3}});
    expect(preparations).toHaveLength(0);
    expect(calls[0].body).toMatchObject({allowed_domains:['example.com'],max_sources:3});
    expect(calls[0].body.durable_work).toBeUndefined();
  });
  it('uses JS trim only for the durable producer readback, preserving the raw frozen objective',async()=>{
    const {result,preparations}=await drive({durable:true,args:{question:`  ${question}  `}});
    expect(result.saved).toBe(true);
    expect(preparations[0]).toMatchObject({args:{_request_payload:{question:`  ${question}  `}}});
  });
  it('forwards normalized source constraints and preserves exact policy in the governed saved readback',async()=>{
    const source_policy={max_sources:3,allowed_domains:['example.com'],admitted_sources:1,limit_reached:false};
    const coverage={...native.coverage,source_policy};
    const {calls,result}=await drive({args:{max_sources:3,allowed_domains:['Example.com']},native:{...native,coverage},readback:{...saved,coverage}});
    expect(calls[0].body).toMatchObject({max_sources:3,allowed_domains:['example.com']});
    expect(result).toMatchObject({success:true,saved:true,source_policy});
  });
  it.each([{max_sources:0},{max_sources:'3'},{allowed_domains:[]},{allowed_domains:['https://example.com']}])('refuses invalid constraints before analytics or provider: %j',async args=>{
    const {calls,result,analytics}=await drive({args});expect(calls).toHaveLength(0);expect(analytics).toBe(0);
    expect(result).toMatchObject({not_applied:true,saved:false});
  });
  it.each([undefined,{max_sources:3,allowed_domains:['wrong.invalid'],admitted_sources:1,limit_reached:false}])('withholds a native response that did not enforce the requested policy (%j)',async source_policy=>{
    const coverage={...native.coverage,...(source_policy?{source_policy}:{})};
    const {calls,result}=await drive({args:{max_sources:3,allowed_domains:['example.com']},native:{...native,coverage},readback:{...saved,coverage}});
    expect(calls).toHaveLength(1);expect(result).toMatchObject({success:false,outcome_unknown:true,saved:false});
    expect(result.findings).toBeUndefined();
  });
  it('binds the existing engine request to the server workspace and authenticated actor',async()=>{
    const {calls,result}=await drive();
    expect(calls).toHaveLength(1); expect(calls[0].body).toMatchObject({expected_tenant_id:tenant,user_id:actor,caller:'chat',persist:true});
    expect(result).toMatchObject({success:true,saved:true,run_id:run,research_run_id:run});
    expect(interactiveEffect('deep_research',result)).toMatchObject({outcome:'reported_success',record_refs:[{kind:'research_run',id:run}]});
  });
  it.each([[],{},null,{...saved,id:id(99)},{...saved,findings:[]},{...saved,sources:[]}].map(readback=>[readback]))('never treats incomplete or different library data as saved: %j',async readback=>{
    const {result}=await drive({readback});
    expect(result.saved).toBe(false); expect(result.research_run_id).toBeUndefined();
    expect(interactiveEffect('deep_research',result)?.record_refs??[]).not.toContainEqual({kind:'research_run',id:run});
  });
  it('an error alongside stale data is not saved proof',async()=>{
    const {result}=await drive({readError:{code:'42501'}});
    expect(result.saved).toBe(false); expect(result.research_run_id).toBeUndefined();
  });
  it('keeps an unconfigured unsaved invocation separate from a durable Research record',async()=>{
    const {result}=await drive({native:{...native,findings:[],sources:[],coverage:{...native.coverage,configured:false,stop_reason:'unconfigured'}},readback:null});
    expect(result.saved).toBe(false); expect(result.research_run_id).toBeUndefined();
    expect(interactiveEffect('deep_research',result)?.record_refs??[]).toEqual([]);
  });
  it.each([0,1])('withholds research identity when current workspace read %i throws',async scopeErrorAt=>{
    const {result,calls}=await drive({scopeErrorAt});
    expect(calls).toHaveLength(scopeErrorAt===0?0:1);
    expect(result.saved).toBe(false); expect(result.run_id).toBeUndefined(); expect(result.research_run_id).toBeUndefined();
    expect(result.findings).toBeUndefined();
  });
  it('accepts native timestamp normalization without dropping matching source evidence',async()=>{
    expect((await drive({readback:{...saved,sources:[{...sources[0],fetched_at:'2026-10-15T16:00:00+00:00'}]}})).result.saved).toBe(true);
  });
  it.each([{native:{}},{native:{error:'fixture secret provider body'},status:503},{transportLost:true}])('does not fabricate engine readiness or leak a failed invocation: %j',async options=>{
    const {calls,result}=await drive(options);
    expect(calls).toHaveLength(1); expect(result).toMatchObject({success:false,saved:false,outcome_unknown:true});
    expect(result.configured).not.toBe(true); expect(JSON.stringify(result)).not.toContain('fixture secret');
  });
  it.each([{tenant:null},{scopes:[id(99)]}])('does not invoke a provider without the same current workspace: %j',async options=>{
    const {calls,result}=await drive(options);
    expect(calls).toHaveLength(0); expect(result).toMatchObject({success:false,not_applied:true,saved:false});
  });
  it('does not publish old-workspace findings after a scope change during readback',async()=>{
    const {result}=await drive({scopes:[tenant,id(99)]});
    expect(result).toMatchObject({success:false,saved:false,outcome_unknown:true});
    expect(result.findings).toBeUndefined();
  });
});
