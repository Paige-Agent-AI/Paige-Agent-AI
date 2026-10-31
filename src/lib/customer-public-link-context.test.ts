import {strict as assert} from "node:assert";
import {test} from "vitest";
import {customerPublicLinkUrl, readCustomerPublicLinkContext, admitCustomerPublicLinkCall,CUSTOMER_PUBLIC_LINK_PURPOSE,
  customerPublicLinkTerminalSource} from "../../supabase/functions/_shared/client-portal-public-link.ts";
import type {ClientPortalPersonaInput} from "../../supabase/functions/_shared/client-portal-persona.ts";

const id = (n: number) => `e0997300-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor=id(1), tenant=id(2), contact=id(3), thread=id(4), intent=id(5), dispatch=id(6);
const url="https://example.org/program";
const persona:ClientPortalPersonaInput={binding:{actorId:actor,tenantId:tenant,clientId:contact},enabled:true,
  businessName:"Test Practice",assistantName:"CURA",tone:"Clear",serviceScope:null,humanHandoff:null,tagline:null,supportEmail:null};
function fixture(){return {thread_id:thread,intent_id:intent,mode:"fresh",snapshot:{version:1,kind:"customer_public_link",
  actor_id:actor,tenant_id:tenant,contact_id:contact,thread_id:thread,intent_id:intent,url}};}
const reader=(value:unknown,error:unknown=null)=>({rpc:async()=>({data:value,error})});
const read=(value:unknown,selection:unknown=url)=>readCustomerPublicLinkContext(reader(value),actor,thread,intent,persona,selection);
const call=()=>({id:dispatch,type:"function",function:{name:"web_fetch",arguments:JSON.stringify({url,purpose:CUSTOMER_PUBLIC_LINK_PURPOSE})}});

test("normalizes public-link identity through original Research URL normalization, never DNS or permission",()=>{
  assert.equal(customerPublicLinkUrl(" https://EXAMPLE.org./program "),url);
  // This layer does not replace the ONE canonical SSRF/DNS guard.
  assert.equal(customerPublicLinkUrl("https://127.0.0.1/"),"https://127.0.0.1/");
  for(const value of [null,{},[url],"","http://example.org/","ftp://example.org/","https://user:secret@example.org/",
    "https://example.org/?token=private","https://example.org/#private", "https://example.org/a\nb",
    `https://example.org/${"x".repeat(500)}`])assert.equal(customerPublicLinkUrl(value),null);
});

test("reads only the caller-JWT native selected-link projection and copies its exact accepted identity",async()=>{
  const value=fixture(),calls:unknown[]=[];
  const result=await readCustomerPublicLinkContext({rpc:async(...args)=>{calls.push(args);return {data:value,error:null};}},
    actor,thread,intent,persona,url);
  assert.equal(result.status,"available");assert.equal(result.data?.mode,"fresh");
  assert.deepEqual(calls,[["client_portal_assistant_link_context",{p_thread:thread,p_intent:intent,p_url:url}]]);
  assert.deepEqual(result.data?.snapshot,value.snapshot);
  value.snapshot.url="https://example.org/changed";
  assert.equal(result.data?.snapshot?.url,url);
});

test("accepted link replay must keep its original URL; no-link legacy cannot acquire a link",async()=>{
  const value=fixture();value.mode="bound";
  assert.equal((await read(value,null)).status,"available");
  assert.equal((await read(value,"https://example.org/changed")).status,"degraded");
  assert.equal((await read(fixture(),null)).status,"degraded");
  const legacy={thread_id:thread,intent_id:intent,mode:"legacy",snapshot:null};
  assert.equal((await read(legacy,null)).status,"available");
  assert.equal((await read(legacy)).status,"degraded");
  assert.equal((await read({...legacy,snapshot:fixture().snapshot},null)).status,"degraded");
});

test("invalid persona, input identity or URL is refused without calling a native source",async()=>{
  let calls=0;const caller={rpc:async()=>{calls++;return {data:fixture(),error:null};}};
  for(const [a,t,i,p,selection] of [
    ["bad",thread,intent,persona,url],[actor,"bad",intent,persona,url],[actor,thread,"bad",persona,url],
    [actor,thread,intent,{...persona,enabled:false},url],
    [actor,thread,intent,{...persona,binding:{...persona.binding,actorId:id(99)}},url],
    [actor,thread,intent,persona,{url}], [actor,thread,intent,persona,"https://example.org/?private=1"],
  ] as const)assert.equal((await readCustomerPublicLinkContext(caller,a,t,i,p,selection)).status,"degraded");
  assert.equal(calls,0);
});

const invalidNativeBindings: ReadonlyArray<readonly [string, (value: ReturnType<typeof fixture>) => void]> = [
  ["wrong thread",(v:ReturnType<typeof fixture>)=>{v.thread_id=id(99);}],
  ["wrong intent",(v:ReturnType<typeof fixture>)=>{v.intent_id=id(99);}],
  ...["actor_id","tenant_id","contact_id","thread_id","intent_id"].map(key=>[
    `wrong snapshot ${key}`,(v:ReturnType<typeof fixture>)=>{Object.assign(v.snapshot,{[key]:id(99)});}] as const),
  ["wrong version",(v:ReturnType<typeof fixture>)=>{v.snapshot.version=2;}],
  ["wrong kind",(v:ReturnType<typeof fixture>)=>{v.snapshot.kind="owner_web";}],
  ["wrong URL",(v:ReturnType<typeof fixture>)=>{v.snapshot.url="https://example.org/another";}],
  ["unnormalized URL",(v:ReturnType<typeof fixture>)=>{v.snapshot.url="https://EXAMPLE.org/program";}],
  ["extra root authority",(v:ReturnType<typeof fixture>)=>{Object.assign(v,{owner_override:true});}],
  ["extra snapshot authority",(v:ReturnType<typeof fixture>)=>{Object.assign(v.snapshot,{owner_override:true});}],
  ["model content smuggled into source",(v:ReturnType<typeof fixture>)=>{Object.assign(v.snapshot,{content:"private knowledge"});}],
];
test.each(invalidNativeBindings)("native %s cannot become usable link context",async(_name,mutate)=>{
  const value=fixture();mutate(value);assert.equal((await read(value)).status,"degraded");
});

test("native denial, source failure and exception remain distinct unavailable/degraded outcomes",async()=>{
  assert.equal((await readCustomerPublicLinkContext(reader(null,{code:"42501"}),actor,thread,intent,persona)).status,"unavailable");
  assert.equal((await readCustomerPublicLinkContext(reader(null,{code:"500"}),actor,thread,intent,persona)).status,"degraded");
  assert.equal((await readCustomerPublicLinkContext({rpc:()=>{throw Error("private diagnostics");}},actor,thread,intent,persona)).status,"degraded");
});

test("a timed-out native result never later becomes available",async()=>{
  let finish!:(v:{data:unknown;error:null})=>void;
  const result=await readCustomerPublicLinkContext({rpc:()=>new Promise(resolve=>{finish=resolve;})},actor,thread,intent,persona,url,5);
  assert.equal(result.status,"degraded");assert.equal(result.reason,"customer_link_timed_out");
  finish({data:fixture(),error:null});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(result.status,"degraded");
});

test("only the single server-issued exact web_fetch dispatch may pass the customer boundary",async()=>{
  const bound=fixture();bound.mode="bound";const source=(await read(bound)).data;assert.ok(source?.snapshot);
  assert.equal(admitCustomerPublicLinkCall(source,dispatch,call(),false),true);
  assert.equal(admitCustomerPublicLinkCall(source,dispatch,call(),true),false);
  assert.equal(admitCustomerPublicLinkCall(null,dispatch,call(),false),false);
  assert.equal(admitCustomerPublicLinkCall({...source,mode:"fresh"},dispatch,call(),false),false);
  for(const changed of [
    {...call(),id:id(99)}, {...call(),function:{name:"web_search",arguments:JSON.stringify({url})}},
    {...call(),function:{name:"web_fetch",arguments:JSON.stringify({url:"https://example.org/other"})}},
    {...call(),function:{name:"web_fetch",arguments:JSON.stringify({url,query:"private knowledge"})}},
    {...call(),function:{name:"web_fetch",arguments:JSON.stringify({url,purpose:"Private conversation must not egress"})}},
    {...call(),function:{name:"web_fetch",arguments:"bad-json"}},
    {...call(),function:{name:"web_fetch",arguments:JSON.stringify([url])}},
  ])assert.equal(admitCustomerPublicLinkCall(source,dispatch,changed,false),false);
});

test("original terminal metadata binds the accepted link, and withheld/refused/interrupted output stays empty",async()=>{
  const value=fixture();value.mode="bound";const snapshot=(await read(value)).data?.snapshot;assert.ok(snapshot);
  assert.deepEqual(customerPublicLinkTerminalSource(snapshot,"Answer",{turn_state:{state:"FINAL"}}),
    {content:"Answer",metadata:{customer_public_link:snapshot}});
  for(const state of ["WITHHELD","REFUSED","INTERRUPTED"])
    assert.deepEqual(customerPublicLinkTerminalSource(snapshot,"Must not escape",{turn_state:{state}}),{content:"",metadata:{}});
  assert.deepEqual(customerPublicLinkTerminalSource(null,"Legacy",{}),{content:"Legacy",metadata:{}});
});
