import {test} from "node:test";
import assert from "node:assert/strict";
import {readClientPortalPersonaSource} from "./client-portal-persona.ts";
import {readCustomerBillingContext,customerBillingMessages,customerBillingTerminalSource,CUSTOMER_BILLING_TIMEOUT_MS} from "./client-portal-billing-context.ts";

// Synthetic transport only. No native financial source or customer identity is established here.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mutable hostile transport fixtures intentionally violate every DTO leaf.
type Row=any;
const actor="11111111-1111-4111-8111-111111111111",client="22222222-2222-4222-8222-222222222222";
const tenant="33333333-3333-4333-8333-333333333333",thread="44444444-4444-4444-8444-444444444444";
const intent="55555555-5555-4555-8555-555555555555",invoice="66666666-6666-4666-8666-666666666666";
const observed="2026-10-28T14:00:00+00:00";
const frame=()=>({actor_id:actor,profile:{id:client,tenant_id:tenant,linked_user_id:actor},
 brand:{tenant_id:tenant,tenant_name:"Harbor Lane Advisors"},config:{assistant:{enabled:true,display_name:"Cura"}}});
const fixture=():Row=>({frame:frame(),thread_id:thread,intent_id:intent,mode:"bound",
 snapshot:{version:1,kind:"customer_billing",tenant_id:tenant,contact_id:client,source_fingerprint:"a".repeat(64),observed_at:observed},
 billing:{schema_version:1,tenant_id:tenant,business_name:"Harbor Lane Advisors",read_at:observed,invoice_count:1,open_count:1,has_more:false,next_cursor:null,
  invoices:[{id:invoice,invoice_number:"HL-001",status:"issued",currency:"usd",issued_at:observed,due_date:"2026-11-03",
   amount_minor:"10000",remaining_minor:"6000",provider_verified_minor:"3000",manual_recorded_minor:"1000",test_provider_minor:"500",payable:true,past_due:false}],
  balances:[{currency:"usd",remaining_minor:"6000",provider_verified_minor:"3000",manual_recorded_minor:"1000",test_provider_minor:"500"}]}});
async function persona(){const r=await readClientPortalPersonaSource({rpc:async()=>({data:frame(),error:null})},actor);assert(r.data);return r.data;}
async function read(data:unknown,error:unknown=null){return readCustomerBillingContext({rpc:async()=>({data,error})},actor,thread,intent,await persona());}

test("one caller-bound native response retains original string money and exact source identity",async()=>{
 const calls:unknown[]=[];const caller={rpc:async function(name:string,args:Record<string,unknown>){assert.equal(this,caller);calls.push([name,args]);return{data:fixture(),error:null};}};
 const result=await readCustomerBillingContext(caller,actor,thread,intent,await persona());
 assert.equal(result.status,"available");assert.equal(result.data?.billing?.invoices[0].remaining_minor,"6000");
 assert.equal(result.data?.snapshot?.contact_id,client);
 assert.deepEqual(calls,[["client_portal_assistant_billing_context",{p_thread:thread,p_intent:intent}]]);
});

test("retain the complete original invoice page rather than stripping schema, business and continuation identity",async()=>{
 const data=fixture();
 Object.assign(data.billing,{schema_version:1,business_name:"Harbor Lane Advisors",next_cursor:null});
 const result=await read(data);
 assert.equal(result.status,"available");
 assert.deepEqual(result.data?.billing,data.billing);
});

test("a bounded page preserves original all-page counts, balances and its exact native continuation",async()=>{
 const data=fixture();data.billing.invoice_count=9;data.billing.open_count=7;data.billing.has_more=true;
 data.billing.next_cursor={issued_at:observed,id:invoice};
 data.billing.balances[0].remaining_minor="123456";
 const result=await read(data);assert.equal(result.status,"available");
 assert.deepEqual(result.data?.billing,data.billing);
 assert.equal(result.data?.billing?.invoices.length,1);
 assert.equal(result.data?.billing?.invoice_count,9);
 assert.equal(result.data?.billing?.balances[0].remaining_minor,"123456");
});

test("last-page has_more false never replaces the source's all-page count with this page's length",async()=>{
 const data=fixture();data.billing.invoice_count=9;data.billing.open_count=7;
 const result=await read(data);assert.equal(result.status,"available");
 assert.deepEqual(result.data?.billing,data.billing);
});

test("null business name and empty invoice page retain the original public shape",async()=>{
 const data=fixture();Object.assign(data.billing,{business_name:null,invoices:[],balances:[],invoice_count:0,open_count:0});
 const result=await read(data);assert.equal(result.status,"available");assert.deepEqual(result.data?.billing,data.billing);
});

for(const [name,mutate] of [
 ["missing schema",(r:Row)=>delete r.billing.schema_version],
 ["different schema",(r:Row)=>r.billing.schema_version=2],
 ["coerced schema",(r:Row)=>r.billing.schema_version="1"],
 ["invalid business name",(r:Row)=>r.billing.business_name={name:"other"}],
 ["missing cursor",(r:Row)=>delete r.billing.next_cursor],
 ["cursor without more",(r:Row)=>r.billing.next_cursor={issued_at:observed,id:invoice}],
 ["more without cursor",(r:Row)=>{r.billing.has_more=true;r.billing.invoice_count=9;}],
 ["foreign continuation",(r:Row)=>{r.billing.has_more=true;r.billing.invoice_count=9;r.billing.next_cursor={issued_at:observed,id:client};}],
 ["different continuation instant",(r:Row)=>{r.billing.has_more=true;r.billing.invoice_count=9;r.billing.next_cursor={issued_at:"2026-10-28T13:00:00Z",id:invoice};}],
 ["widened continuation",(r:Row)=>{r.billing.has_more=true;r.billing.invoice_count=9;r.billing.next_cursor={issued_at:observed,id:invoice,tenant_id:tenant};}],
] as const)test("withhold incomplete original page: "+name,async()=>{
 const data=fixture();mutate(data);assert.notEqual((await read(data)).status,"available");
});

test("invalid actor or intent and mismatched expected customer never dispatch a native read",async()=>{
 let calls=0;const caller={rpc:async()=>{calls++;return{data:fixture(),error:null};}};const expected=await persona();
 for(const [a,t,i,p] of [["bad",thread,intent,expected],[actor,"bad",intent,expected],[actor,thread,"bad",expected],
  [actor,thread,intent,{...expected,binding:{...expected.binding,actorId:invoice}}]] as const){
  assert.equal((await readCustomerBillingContext(caller,a,t,i,p)).status,"degraded");
 }
 assert.equal(calls,0);
});

for(const [name,mutate] of [
 ["foreign actor",(r:Row)=>r.frame.actor_id=invoice],
 ["foreign business",(r:Row)=>r.frame.profile.tenant_id=invoice],
 ["relinked customer",(r:Row)=>r.frame.profile.id=invoice],
 ["disabled Cura",(r:Row)=>r.frame.config.assistant.enabled=false],
 ["wrong thread",(r:Row)=>r.thread_id=invoice],
 ["wrong intent",(r:Row)=>r.intent_id=invoice],
 ["foreign snapshot",(r:Row)=>r.snapshot.contact_id=invoice],
 ["foreign invoice page",(r:Row)=>r.billing.tenant_id=invoice],
 ["different source time",(r:Row)=>r.billing.read_at="2026-10-28T14:01:00Z"],
 ["unknown binding mode",(r:Row)=>r.mode="current"],
 ["coerced binding mode",(r:Row)=>r.mode=["bound"]],
 ["payment URL exposure",(r:Row)=>r.billing.invoices[0].provider_url="https://example.invalid/private"],
 ["owner fields",(r:Row)=>r.billing.owner_notes="internal"],
 ["duplicate invoice",(r:Row)=>r.billing.invoices.push({...r.billing.invoices[0]})],
 ["duplicate balance currency",(r:Row)=>r.billing.balances.push({...r.billing.balances[0]})],
 ["draft invoice",(r:Row)=>r.billing.invoices[0].status="draft"],
 ["unbounded invoice number",(r:Row)=>r.billing.invoices[0].invoice_number="x".repeat(301)],
 ["overstated count",(r:Row)=>r.billing.invoice_count=0],
 ["missing continuation evidence",(r:Row)=>{r.billing.has_more=true;r.billing.invoices=[];}],
 ["impossible date",(r:Row)=>r.billing.invoices[0].due_date="2026-02-31"],
 ["unsafe amount",(r:Row)=>r.billing.invoices[0].amount_minor="9007199254740992"],
 ["numeric instead of canonical string",(r:Row)=>r.billing.invoices[0].remaining_minor=6000],
 ["negative amount",(r:Row)=>r.billing.balances[0].remaining_minor="-1"],
 ["fractional amount",(r:Row)=>r.billing.invoices[0].amount_minor="10.5"],
 ["noncanonical zero padding",(r:Row)=>r.billing.invoices[0].amount_minor="01000"],
 ["unknown currency",(r:Row)=>r.billing.balances[0].currency="USD; send"],
 ["invalid fingerprint",(r:Row)=>r.snapshot.source_fingerprint="not-a-native-source"],
] as const)test("withhold financial context: "+name,async()=>{const data=fixture();mutate(data);assert.notEqual((await read(data)).status,"available");});

test("legacy accepted questions cannot acquire new financial facts",async()=>{
 const r=fixture();r.mode="legacy";r.snapshot=null;r.billing=null;
 const result=await read(r);assert.equal(result.status,"available");assert.equal(result.data?.billing,null);
 assert.deepEqual(customerBillingMessages(result.data!),[]);
 r.billing=fixture().billing;assert.notEqual((await read(r)).status,"available");
});

test("an authoritative empty window stays distinct from denied, failed and thrown reads",async()=>{
 const empty=fixture();empty.billing.invoices=[];empty.billing.balances=[];empty.billing.invoice_count=0;empty.billing.open_count=0;
 const result=await read(empty);assert.equal(result.status,"available");assert.equal(result.data?.billing?.invoice_count,0);
 assert.equal((await read(null,{code:"42501"})).status,"unavailable");
 assert.equal((await read(null,{code:"500"})).status,"degraded");
 assert.equal((await read(null)).status,"degraded");
 assert.equal((await readCustomerBillingContext({rpc:()=>{throw new Error("offline");}},actor,thread,intent,await persona())).status,"degraded");
});

test("scope input is frozen before awaiting the native reader",async()=>{
 const expected=await persona();const original=fixture();let resolve!:(value:{data:unknown;error:null})=>void;
 const pending=readCustomerBillingContext({rpc:()=>new Promise(r=>{resolve=r;})},actor,thread,intent,expected);
 (expected.binding as {clientId:string}).clientId=invoice;
 resolve({data:original,error:null});
 const result=await pending;assert.equal(result.status,"available");assert.equal(result.data?.snapshot?.contact_id,client);
});

test("the same customer uses one decoder for independently bound businesses, never the previous business response",async()=>{
 const other=fixture(),otherTenant="77777777-7777-4777-8777-777777777777",otherClient="88888888-8888-4888-8888-888888888888";
 const otherThread="99999999-9999-4999-8999-999999999999",otherIntent="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 other.frame.profile.tenant_id=otherTenant;other.frame.profile.id=otherClient;
 other.frame.brand.tenant_id=otherTenant;other.frame.brand.tenant_name="Northwind Studio";
 other.snapshot.tenant_id=otherTenant;other.snapshot.contact_id=otherClient;other.snapshot.source_fingerprint="b".repeat(64);
 other.billing.tenant_id=otherTenant;other.thread_id=otherThread;other.intent_id=otherIntent;
 const expected=await readClientPortalPersonaSource({rpc:async()=>({data:other.frame,error:null})},actor);assert(expected.data);
 const calls:unknown[]=[];
 const result=await readCustomerBillingContext({rpc:async(name,args)=>{calls.push([name,args]);return{data:other,error:null};}},actor,otherThread,otherIntent,expected.data);
 assert.equal((await read(fixture())).status,"available");assert.equal(result.status,"available");
 assert.equal(result.data?.snapshot?.contact_id,otherClient);assert.equal(result.data?.billing?.tenant_id,otherTenant);
 assert.deepEqual(calls,[["client_portal_assistant_billing_context",{p_thread:otherThread,p_intent:otherIntent}]]);
 const previous=fixture();previous.thread_id=otherThread;previous.intent_id=otherIntent;
 assert.notEqual((await readCustomerBillingContext({rpc:async()=>({data:previous,error:null})},actor,otherThread,otherIntent,expected.data)).status,"available");
});

test("an unfamiliar ordinary customer binding uses the same path without seeded actor or client IDs",async()=>{
 const data=fixture(),newActor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",newClient="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
 data.frame.actor_id=newActor;data.frame.profile.linked_user_id=newActor;data.frame.profile.id=newClient;
 data.snapshot.contact_id=newClient;
 const expected=await readClientPortalPersonaSource({rpc:async()=>({data:data.frame,error:null})},newActor);assert(expected.data);
 const result=await readCustomerBillingContext({rpc:async()=>({data,error:null})},newActor,thread,intent,expected.data);
 assert.equal(result.status,"available");assert.equal(result.data?.snapshot?.contact_id,newClient);
 // Synthetic response decoding is not new-account provisioning, real Auth, RLS or two-cohort proof.
});

test("slow native read times out once without a service/owner fallback",async t=>{
 const expected=await persona();let calls=0;t.mock.timers.enable({apis:["setTimeout"]});
 try{const pending=readCustomerBillingContext({rpc:()=>{calls++;return new Promise(()=>{});}},actor,thread,intent,expected);
  t.mock.timers.tick(CUSTOMER_BILLING_TIMEOUT_MS);const result=await pending;
  assert.equal(result.status,"degraded");assert.equal(result.reason,"customer_billing_timed_out");assert.equal(calls,1);
 }finally{t.mock.timers.reset();}
});

test("bounded mixed-currency facts stay separate and carry no payment or owner action",async()=>{
 const r=fixture();r.billing.invoice_count=9;r.billing.has_more=true;r.billing.next_cursor={issued_at:observed,id:invoice};
 r.billing.balances.push({...r.billing.balances[0],currency:"eur",remaining_minor:"900"});
 const result=await read(r);assert.equal(result.status,"available");
 const messages=customerBillingMessages(result.data!);assert.equal(messages.length,1);
 assert.match(messages[0].content,/untrusted data/i);assert.match(messages[0].content,/minor units/i);
 assert.match(messages[0].content,/test/i);assert.match(messages[0].content,/manual/i);assert.match(messages[0].content,/as.of/i);
 assert.match(messages[0].content,/Billing/);assert.match(messages[0].content,/additional|bounded/i);
 assert.equal(result.data?.billing?.balances.length,2);
 assert.doesNotMatch(messages[0].content,/provider_url|payment_url|owner_notes/);
});

test("terminal receipt retains only the verified source binding and withholds interrupted claims",async()=>{
 const result=await read(fixture());const snapshot=result.data!.snapshot!;
 assert.deepEqual(customerBillingTerminalSource(snapshot,"source-backed answer",{}),{content:"source-backed answer",metadata:{customer_billing:snapshot}});
 for(const state of ["WITHHELD","INTERRUPTED","REFUSED"]){
  assert.deepEqual(customerBillingTerminalSource(snapshot,"stale answer",{turn_state:{state}}),{content:"",metadata:{}});
 }
 assert.deepEqual(customerBillingTerminalSource(null,"legacy answer",{}),{content:"legacy answer",metadata:{}});
});
