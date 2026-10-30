import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BUSINESS_METRIC_TOOLS, type MetricCaller } from "../analytics-metrics/read.ts";
import { VERA_METRIC_READ_TOOL, VERA_METRIC_READ_TIMEOUT_MS, veraMetricReadTools, readVeraMetric,
  type VeraMetricScope, type VeraMetricDeps } from "./vera-metric-read.ts";

const tenant="11111111-1111-4111-8111-111111111111", actor="22222222-2222-4222-8222-222222222222";
const scope=():VeraMetricScope=>({agent:"vera",where:"agent_dm",audience:"business_team",
  tenantId:tenant,actorId:actor,workspaceAdmin:true,storedTools:[VERA_METRIC_READ_TOOL]});
function deferred<T>() { let resolve!:(v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
function measurement(args:Record<string,unknown>={}) {
  const now=Date.now(), at=new Date(now).toISOString();
  return {metric_key:args.p_metric_key??"business.active_clients_current",metric_version:"1.0.0",
    owner_department:"clients",label:"Active clients",definition:"Original native definition",formula:"Original native formula",
    range:{key:args.p_range_key??"week",start:args.p_range_start??"2026-10-01T00:00:00.000Z",
      end:args.p_range_end??"2026-10-08T00:00:00.000Z",bounds:"[start,end)",timezone:"UTC",semantics:"current_snapshot"},
    dimensions:{},values:{kind:"count",count:3},unit:"count",source_refs:["public.contacts"],as_of:at,
    freshness:{queried_at:at,source_updated_through:null},
    coverage:{state:"complete",candidate_count:3,contributing_count:3,excluded_count:0},exclusions:[],truth_state:"LIVE",
    caveats:["A stored measurement is not completed work."],source_revision_ref:"sr_v1_"+"b".repeat(64),
    account_epoch:tenant,account_epoch_ref:"ae_v1_"+"a".repeat(64),evidence_ref:"aneb_v1_"+"c".repeat(64),
    reference_expires_at:new Date(now+60000).toISOString(),private_debug:"must-not-enter-model"};
}
function world() {
  const calls:Array<{name:string;args:Record<string,unknown>|undefined}>=[];
  let source=measurement(), current=true, receipt=true, receipts=0, failure:{code:string}|null=null;
  let patch:Record<string,unknown>={};
  const caller:MetricCaller={rpc:async function(name,args){
    assert.equal(this,caller);calls.push({name,args});
    if(name==="current_user_tenant_id")return {data:tenant,error:null};
    if(name==="issue_analytics_evidence_bundle"){source={...measurement(args),...patch};return {data:structuredClone(source),error:null};}
    if(name==="resolve_analytics_evidence_reference")return {data:failure?null:structuredClone(source),error:failure};
    throw new Error("Unexpected RPC");
  }};
  const deps:VeraMetricDeps={caller,isCurrent:async()=>current,recordRead:async()=>{receipts++;return receipt;}};
  return {calls,caller,deps,setCurrent:(v:boolean)=>{current=v;},setReceipt:(v:boolean)=>{receipt=v;},
    setFailure:(v:{code:string}|null)=>{failure=v;},getSource:()=>source,
    setSource:(v:typeof source)=>{source=v;},patch:(v:Record<string,unknown>)=>{patch=v;},receipts:()=>receipts};
}
test("uses the exact canonical tool/schema only for SAME VERA private business DM",()=>{
  assert.equal(veraMetricReadTools(scope())[0],BUSINESS_METRIC_TOOLS[0]);
});
for(const patch of [{agent:"paige"},{agent:"cura"},{where:"channel"},{where:"dm"},
  {audience:"customer_private"},{workspaceAdmin:false},{workspaceAdmin:"true"},
  {storedTools:null},{storedTools:[]},{tenantId:"foreign"},{actorId:"missing"}])
  test("ineligible server scope reads nothing: "+JSON.stringify(patch),async()=>{
    const w=world(),s={...scope(),...patch} as VeraMetricScope;
    assert.deepEqual(veraMetricReadTools(s),[]);const result=await readVeraMetric(s,w.deps,{metric_key:"business.active_clients_current"});
    assert.equal(result.model.status,"unavailable");assert.equal(w.calls.length,0);
    assert.deepEqual(result.recordLinks,[]);assert.equal(await result.revalidate(),false);
  });
test("original issuer/resolver facts stay closed; exact evidence revalidates WITHOUT another issuance",async()=>{
  const w=world(),result=await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"available");assert.deepEqual(result.model.metric?.values,{kind:"count",count:3});
  assert.equal(JSON.stringify(result.model).includes(tenant),false);assert.equal(JSON.stringify(result.model).includes("must-not-enter-model"),false);
  assert.deepEqual(result.recordLinks,[{destination:"executive",record_id:null}]);
  assert.equal(w.receipts(),1);assert.equal(await result.revalidate(),true);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
  assert.equal(w.calls.filter(c=>c.name==="resolve_analytics_evidence_reference").length,2);
  assert.deepEqual(w.calls.filter(c=>c.name==="resolve_analytics_evidence_reference").map(c=>c.args),
    [{p_evidence_ref:w.getSource().evidence_ref},{p_evidence_ref:w.getSource().evidence_ref}]);
});
for(const input of [{tenant_id:tenant},{metric_key:"business.active_clients_current",actor_id:actor},
  {metric_key:"business.active_clients_current",dimensions:{tenant_id:tenant}},
  {metric_key:"business.active_clients_current",confirm:true},{metric_key:"marketing.leads.daily"},null])
  test("canonical parser refuses scope/dimensions/unsupported args without RPC: "+JSON.stringify(input),async()=>{
    const w=world(),result=await readVeraMetric(scope(),w.deps,input);
    assert.equal(result.model.status,"needs_input");assert.equal(w.calls.length,0);assert.equal(w.receipts(),0);
  });
test("a native permission refusal cannot reissue under a broader identity",async()=>{
  const w=world();w.setFailure({code:"42501"});
  const result=await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"refused");assert.equal(result.model.metric,undefined);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
  assert.equal(await result.revalidate(),false);
});
test("later revocation/expiry/changed facts each withhold publication without replacing evidence",async()=>{
  for(const kind of ["revoked","expired","changed"]){
    const w=world(),result=await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
    if(kind==="revoked")w.setFailure({code:"42501"});
    if(kind==="expired")w.setSource({...w.getSource(),reference_expires_at:new Date(Date.now()-1).toISOString()});
    if(kind==="changed")w.setSource({...w.getSource(),values:{kind:"count",count:4}});
    assert.equal(await result.revalidate(),false,kind);
    assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1,kind);
  }
});
test("wrong native business payload never enters model context",async()=>{
  const w=world();w.patch({account_epoch:actor});
  const result=await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"unavailable");assert.equal(result.model.metric,undefined);assert.deepEqual(result.recordLinks,[]);
});
test("a genuine zero and native unavailable measurement remain different",async()=>{
  const zero=world();zero.patch({values:{kind:"count",count:0},coverage:{state:"complete",candidate_count:0,contributing_count:0,excluded_count:0}});
  const a=await readVeraMetric(scope(),zero.deps,{metric_key:"business.active_clients_current"});
  assert.equal(a.model.status,"available");assert.deepEqual(a.model.metric?.values,{kind:"count",count:0});
  const gap=world();gap.patch({values:null,truth_state:"UNAVAILABLE",coverage:{state:"unavailable",candidate_count:0,contributing_count:0,excluded_count:0}});
  const b=await readVeraMetric(scope(),gap.deps,{metric_key:"business.active_clients_current"});
  assert.equal(b.model.status,"available");assert.equal(b.model.metric?.truth_state,"UNAVAILABLE");assert.equal(b.model.metric?.values,null);
});
test("original per-currency minor values are not summed or promoted into bank cash",async()=>{
  const w=world(),values={kind:"currency_totals",by_currency:[{currency:"usd",amount_minor:"100",record_count:1},
    {currency:"eur",amount_minor:"250",record_count:1}],breakdown:[]};
  w.patch({owner_department:"sales",values,unit:"currency_minor"});
  const result=await readVeraMetric(scope(),w.deps,{metric_key:"sales.cash.recorded_received"});
  assert.equal(result.model.status,"available");assert.deepEqual(result.model.metric?.values,values);
});
test("missing marker, late authority loss and caller exceptions expose no facts",async()=>{
  const w=world();w.setReceipt(false);
  assert.equal((await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"})).model.metric,undefined);
  const v=world();v.setCurrent(false);
  assert.equal((await readVeraMetric(scope(),v.deps,{metric_key:"business.active_clients_current"})).model.status,"unavailable");assert.equal(v.calls.length,0);
  const x=world();x.caller.rpc=async()=>{throw new Error("private-debug");};
  assert.equal(JSON.stringify((await readVeraMetric(scope(),x.deps,{metric_key:"business.active_clients_current"})).model).includes("private-debug"),false);
});
test("scope is captured; a later role change invalidates the prepared answer",async()=>{
  const w=world(),s=scope(),result=await readVeraMetric(s,w.deps,{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"available");w.setCurrent(false);assert.equal(await result.revalidate(),false);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
});
test("returned presentation mutation cannot change the privately captured evidence comparison",async()=>{
  const w=world(),result=await readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"available");if(result.model.metric)result.model.metric.label="changed presentation";
  assert.equal(await result.revalidate(),true);
});
test("an already-aborted turn starts no native read",async()=>{
  const w=world(),controller=new AbortController();controller.abort();
  const result=await readVeraMetric(scope(),{...w.deps,signal:controller.signal},{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"unavailable");assert.equal(w.calls.length,0);
});
test("deadline retires a late scope check before it can begin native I/O",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const w=world(),entered=deferred<void>(),gate=deferred<boolean>();
  const pending=readVeraMetric(scope(),{...w.deps,isCurrent:async()=>{entered.resolve();return gate.promise;}},{metric_key:"business.active_clients_current"});
  await entered.promise;t.mock.timers.tick(VERA_METRIC_READ_TIMEOUT_MS);
  const result=await pending;assert.equal(result.model.status,"unavailable");
  gate.resolve(true);await nextTurn();assert.equal(w.calls.length,0);assert.equal(w.receipts(),0);
});
test("deadline after issuer start prevents resolver/marker/publication after uncertain completion",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const w=world(),entered=deferred<void>(),late=deferred<{data:unknown;error:null}>();
  const original=w.caller.rpc;w.caller.rpc=async function(name,args){
    if(name==="issue_analytics_evidence_bundle"){w.calls.push({name,args});entered.resolve();return late.promise;}
    return original.call(w.caller,name,args);
  };
  const pending=readVeraMetric(scope(),w.deps,{metric_key:"business.active_clients_current"});
  await entered.promise;t.mock.timers.tick(VERA_METRIC_READ_TIMEOUT_MS);assert.equal((await pending).model.status,"unavailable");
  late.resolve({data:measurement(w.calls.find(c=>c.name==="issue_analytics_evidence_bundle")!.args),error:null});
  await nextTurn();assert.equal(w.calls.some(c=>c.name==="resolve_analytics_evidence_reference"),false);assert.equal(w.receipts(),0);
});
test("abort retires a pending marker without waiting for the full deadline",async()=>{
  const w=world(),entered=deferred<void>(),marker=deferred<boolean>(),controller=new AbortController();
  const pending=readVeraMetric(scope(),{...w.deps,signal:controller.signal,recordRead:async()=>{entered.resolve();return marker.promise;}},{metric_key:"business.active_clients_current"});
  await entered.promise;controller.abort();const result=await pending;assert.equal(result.model.status,"unavailable");
  marker.resolve(true);await nextTurn();assert.equal(result.model.metric,undefined);
});

test("truthy non-boolean authority or marker is not authorization",async()=>{
  const a=world(),b=world();
  const r=await readVeraMetric(scope(),{...a.deps,isCurrent:async()=>({ok:true}) as unknown as boolean},{metric_key:"business.active_clients_current"});
  assert.equal(r.model.metric,undefined);assert.equal(a.calls.length,0);
  const s=await readVeraMetric(scope(),{...b.deps,recordRead:async()=>({ok:true}) as unknown as boolean},{metric_key:"business.active_clients_current"});
  assert.equal(s.model.metric,undefined);assert.deepEqual(s.recordLinks,[]);
});
test("the captured server scope is immutable across an asynchronous turn",async()=>{
  const w=world(),s=scope(),entered=deferred<void>(),gate=deferred<boolean>();let first=true;
  const pending=readVeraMetric(s,{...w.deps,isCurrent:async captured=>{
    assert.equal(captured.agent,"vera");assert.equal(captured.tenantId,tenant);
    assert.equal(Object.isFrozen(captured),true);assert.equal(Object.isFrozen(captured.storedTools),true);
    if(first){first=false;entered.resolve();return gate.promise;}return true;
  }},{metric_key:"business.active_clients_current"});
  await entered.promise;Object.assign(s,{agent:"cura",tenantId:actor,storedTools:[]});gate.resolve(true);
  assert.equal((await pending).model.status,"available");
  assert.equal(w.calls.find(c=>c.name==="issue_analytics_evidence_bundle")?.args?.p_account_epoch,tenant);
});
test("even clarification publication bounds a later hung authority check",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const w=world(),entered=deferred<void>(),gate=deferred<boolean>();let hang=false;
  const result=await readVeraMetric(scope(),{...w.deps,isCurrent:async()=>{
    if(hang){entered.resolve();return gate.promise;}return true;
  }},{metric_key:"not-a-canonical-key"});
  assert.equal(result.model.status,"needs_input");hang=true;
  const pending=result.revalidate();await entered.promise;t.mock.timers.tick(VERA_METRIC_READ_TIMEOUT_MS);
  assert.equal(await pending,false);gate.resolve(true);await nextTurn();assert.equal(w.calls.length,0);
});

test("evidence expiring during the initial final marker wait is withheld",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const w=world(),entered=deferred<void>(),marker=deferred<boolean>();
  w.patch({reference_expires_at:new Date(Date.now()+1000).toISOString()});
  const pending=readVeraMetric(scope(),{...w.deps,recordRead:async()=>{entered.resolve();return marker.promise;}},
    {metric_key:"business.active_clients_current"});
  await entered.promise;t.mock.timers.tick(1001);marker.resolve(true);
  const result=await pending;assert.equal(result.model.status,"unavailable");
  assert.equal(result.model.metric,undefined);assert.deepEqual(result.recordLinks,[]);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
});

test("same-ref evidence expiring after native validation cannot pass publication revalidation",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const w=world(),entered=deferred<void>(),marker=deferred<boolean>();let wait=false;
  w.patch({reference_expires_at:new Date(Date.now()+1000).toISOString()});
  const result=await readVeraMetric(scope(),{...w.deps,recordRead:async()=>{
    if(wait){entered.resolve();return marker.promise;}return true;
  }},{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"available");wait=true;
  const pending=result.revalidate();await entered.promise;t.mock.timers.tick(1000);marker.resolve(true);
  assert.equal(await pending,false);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
  assert.equal(w.calls.filter(c=>c.name==="resolve_analytics_evidence_reference").length,2);
});

test("expiry is checked after the final authority await as well as the marker",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const w=world(),entered=deferred<void>(),gate=deferred<boolean>();let checks=0;
  w.patch({reference_expires_at:new Date(Date.now()+1000).toISOString()});
  const result=await readVeraMetric(scope(),{...w.deps,isCurrent:async()=>{
    if(++checks===6){entered.resolve();return gate.promise;}return true;
  }},{metric_key:"business.active_clients_current"});
  assert.equal(result.model.status,"available");
  const pending=result.revalidate();await entered.promise;t.mock.timers.tick(1000);gate.resolve(true);
  assert.equal(await pending,false);assert.equal(w.receipts(),2);
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
});

for(const phase of ["initial","revalidation"]) test("expiry during bounded-result delivery is withheld: "+phase,async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  const w=world();let checks=0;
  w.patch({reference_expires_at:new Date(Date.now()+1000).toISOString()});
  const result=await readVeraMetric(scope(),{...w.deps,isCurrent:async()=>{
    if(++checks===(phase==="initial"?3:6))
      queueMicrotask(()=>queueMicrotask(()=>t.mock.timers.tick(1000)));
    return true;
  }},{metric_key:"business.active_clients_current"});
  if(phase==="initial"){
    assert.equal(result.model.status,"unavailable");assert.equal(result.model.metric,undefined);
  }else{
    assert.equal(result.model.status,"available");assert.equal(await result.revalidate(),false);
  }
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
});

for(const phase of ["initial","revalidation"]) test("abort during bounded-result delivery is withheld: "+phase,async()=>{
  const w=world(),controller=new AbortController();let checks=0;
  const result=await readVeraMetric(scope(),{...w.deps,signal:controller.signal,isCurrent:async()=>{
    if(++checks===(phase==="initial"?3:6))queueMicrotask(()=>queueMicrotask(()=>controller.abort()));
    return true;
  }},{metric_key:"business.active_clients_current"});
  if(phase==="initial"){
    assert.equal(result.model.status,"unavailable");assert.equal(result.model.metric,undefined);
  }else{
    assert.equal(result.model.status,"available");assert.equal(await result.revalidate(),false);
  }
  assert.equal(w.calls.filter(c=>c.name==="issue_analytics_evidence_bundle").length,1);
});
