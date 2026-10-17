// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { interactiveEffect } from '../../supabase/functions/_shared/paige-turn/interactive';
import { parseResearchSourcePolicy, researchResultHonorsSourcePolicy } from '../../supabase/functions/_shared/research-source-policy';
const source = readFileSync('supabase/functions/paige-ai-chat/index.ts', 'utf8');
const ast = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let branch: ts.Statement | undefined;
function visit(n: ts.Node) { if (ts.isIfStatement(n) && n.expression.getText(ast) === 'tc.function.name === "deep_research"') branch = n.thenStatement; ts.forEachChild(n, visit); }
visit(ast);
if (!branch) throw new Error('Canonical Research dispatch missing');
const code = ts.transpileModule(`async function dispatch(tc, supabaseClient, personaCtx, user, toolResults,
  supabase, logAnalyticsEvent, fetch, supabaseUrl, supabaseServiceKey, formatDossier, parseResearchSourcePolicy, researchResultHonorsSourcePolicy) ${branch.getText(ast)}`,
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dispatch = new Function(`${code}; return dispatch;`)();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant=id(1), actor=id(2), run=id(3), question='Fixture public question';
const sources=[{ index:1,url:'https://example.com/source',title:'Fixture source',snippet:'Source text',
  reliability_score:.9,tier:'T1',reliability:'high',excluded:false,published_at:null,fetched_at:'2026-10-15T16:00:00Z' }];
const findings=[{text:'Fixture cited finding',citations:[1],confidence:'high'}];
const native={run_id:run,question,findings,sources,coverage:{configured:true,stop_reason:'answered',hops_used:1,searches:1,reads:1,note:''}};
const saved={id:run,question,domain:'general',caller:'chat',configured:true,stop_reason:'answered',findings,sources,coverage:native.coverage};
async function drive(options: { readback?:unknown; readError?:unknown; native?:unknown; status?:number; tenant?:string|null; scopes?:string[]; transportLost?:boolean; scopeErrorAt?:number; args?:Record<string,unknown> }={}) {
  const calls:Array<{body:Record<string,unknown>;headers:Record<string,string>}>=[];
  const outputs:Array<{content:string}>=[];
  const rpcs:Array<{name:string;args:unknown}>=[];
  let scopeReads=0;
  let analytics=0;
  const caller={rpc:async(name:string,args:unknown)=>{
    rpcs.push({name,args});
    if(name==='current_user_tenant_id'){
      const index=scopeReads++;
      if(options.scopeErrorAt===index)throw new TypeError('Scope response unavailable');
      return {data:options.scopes?.[index]??tenant,error:null};
    }
    return {data:'readback' in options?options.readback:saved,error:options.readError??null};
  }};
  await dispatch({id:'research-fixture',function:{name:'deep_research',arguments:JSON.stringify({question,expected_tenant_id:id(99),user_id:id(98),...options.args})}},
    caller,{tenant_id:'tenant' in options?options.tenant:tenant},{id:actor},outputs,{},()=>{analytics++;},
    async(_url:string,init:{body:string;headers:Record<string,string>})=>{
      calls.push({body:JSON.parse(init.body),headers:init.headers});
      if(options.transportLost)throw new TypeError('fixture secret provider body');
      return Response.json('native' in options?options.native:native,{status:options.status??200});
    },'https://fixture.invalid','fixture-service-key',()=>null,parseResearchSourcePolicy,researchResultHonorsSourcePolicy);
  expect(outputs).toHaveLength(1);
  return {calls,rpcs,analytics,result:JSON.parse(outputs[0].content)};
}
describe('Research Chat native invocation and durable library proof',()=>{
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
