import {strict as assert} from "node:assert";
import {test} from "vitest";
import {readCustomerInvoicesContext,customerInvoicesMessages,customerInvoicesTerminalSource}
  from "../../supabase/functions/_shared/client-portal-invoices-context.ts";
import type {ClientPortalPersonaInput} from "../../supabase/functions/_shared/client-portal-persona.ts";

const id=(n:number)=>`e0997500-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),tenant=id(2),contact=id(3),thread=id(4),intent=id(5);
const captured="2026-10-29T18:00:00.000Z",fingerprint="ab".repeat(32);
const persona:ClientPortalPersonaInput={binding:{actorId:actor,tenantId:tenant,clientId:contact},enabled:true,
 businessName:"Test Advisory",assistantName:"CURA",tone:"Clear",serviceScope:null,humanHandoff:null,tagline:null,supportEmail:null};
function fixture(){return {thread_id:thread,intent_id:intent,mode:"bound",snapshot:{version:1 as const,kind:"customer_invoices" as const,actor_id:actor,
 tenant_id:tenant,contact_id:contact,thread_id:thread,intent_id:intent,observation_identity:fingerprint,captured_at:captured},
 billing:{tenant_id:tenant,contact_id:contact,captured_at:captured,calendar:{state:"missing",zone:null,local_date:null},
 invoices:[{id:id(6),invoice_number:"INV-TEST-1",status:"issued",currency:"usd",issued_at:captured,due_date:"2026-11-01",
 amount_minor:"9007199254740993",remaining_minor:"9007199254740993",provider_verified_minor:"0",manual_recorded_minor:"0",
 test_provider_minor:"0",payable:false,past_due:null,issued_snapshot_version:1}],
 invoice_count:1,open_count:1,has_more:false,next_cursor:null,
 balances:[{currency:"usd",remaining_minor:"9007199254740993",provider_verified_minor:"0",manual_recorded_minor:"0",test_provider_minor:"0"}]}};}
type Fixture=ReturnType<typeof fixture>;
const caller=(data:unknown,error:unknown=null)=>({rpc:async()=>({data,error})});
const read=(data:unknown)=>readCustomerInvoicesContext(caller(data),actor,thread,intent,persona);

test("reads the caller-JWT minimized native observation without converting money, changing records or exposing source internals",async()=>{
 const f=fixture(),calls:unknown[]=[];
 const r=await readCustomerInvoicesContext({rpc:async(...args)=>{calls.push(args);return{data:f,error:null};}},actor,thread,intent,persona);
 assert.equal(r.status,"available");assert.deepEqual(calls,[["client_portal_assistant_invoices_context",{p_thread:thread,p_intent:intent}]]);
 if(r.status!=="available"||!r.data?.billing)throw Error("Expected bounded native source");
 assert.equal(r.data.billing.invoices[0].remaining_minor,"9007199254740993");
 assert.equal(r.data.billing.calendar.local_date,null);assert.equal(r.data.billing.invoices[0].past_due,null);
 f.billing.invoices[0].invoice_number="Changed after decode";assert.equal(r.data.billing.invoices[0].invoice_number,"INV-TEST-1");
 assert.equal(JSON.stringify(r.data).includes("_native_sources"),false);
});
test("fresh, bound and legacy are distinct; an old accepted turn cannot acquire new financial data",async()=>{
 const f=fixture();f.mode="fresh";assert.equal((await read(f)).status,"available");
 const legacy={thread_id:thread,intent_id:intent,mode:"legacy",snapshot:null,billing:null};
 const r=await read(legacy);assert.equal(r.status,"available");if(r.status==="available")assert.equal(r.data?.billing,null);
 assert.equal((await read({...legacy,billing:fixture().billing})).status,"degraded");
});
test("invalid input or disabled/wrong actor persona performs no native read",async()=>{
 let calls=0;const native={rpc:async()=>{calls++;return{data:fixture(),error:null};}};
 for(const p of [{...persona,enabled:false},{...persona,binding:{...persona.binding,actorId:id(9)}}])
  assert.equal((await readCustomerInvoicesContext(native,actor,thread,intent,p)).status,"degraded");
 assert.equal((await readCustomerInvoicesContext(native,"invalid",thread,intent,persona)).status,"degraded");assert.equal(calls,0);
});
const invalid:Array<{name:string;change:(f:Fixture)=>unknown}>=[
 {name:"wrong actor",change:f=>(f.snapshot.actor_id=id(9),f)},
 {name:"wrong business",change:f=>(f.snapshot.tenant_id=id(9),f)},
 {name:"wrong customer",change:f=>(f.snapshot.contact_id=id(9),f)},
 {name:"wrong private thread",change:f=>(f.snapshot.thread_id=id(9),f)},
 {name:"wrong intent",change:f=>(f.snapshot.intent_id=id(9),f)},
 {name:"wrong response thread",change:f=>(f.thread_id=id(9),f)},
 {name:"wrong response intent",change:f=>(f.intent_id=id(9),f)},
 {name:"missing identity",change:f=>(f.snapshot.observation_identity="",f)},
 {name:"bad captured time",change:f=>(f.snapshot.captured_at="invalid",f)},
 {name:"changed accepted capture time",change:f=>(f.billing.captured_at="2026-10-29T18:01:00Z",f)},
 {name:"foreign financial rows",change:f=>(f.billing.contact_id=id(9),f)},
 {name:"foreign financial business",change:f=>(f.billing.tenant_id=id(9),f)},
 {name:"owner payload",change:f=>({...f,owner_context:{private:true}})},
 {name:"unminimized source",change:f=>({...f,billing:{...f.billing,_native_sources:{secret:true}}})},
 {name:"numerically rounded money",change:f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],amount_minor:9007199254740992}]}})},
 {name:"invalid amount",change:f=>(f.billing.invoices[0].amount_minor="1.50",f)},
 {name:"fabricated paid status",change:f=>(f.billing.invoices[0].status="paid",f)},
 {name:"invalid issued version",change:f=>(f.billing.invoices[0].issued_snapshot_version=0,f)},
 {name:"duplicate invoice",change:f=>(f.billing.invoices.push({...f.billing.invoices[0]}),f)},
 {name:"duplicate currency total",change:f=>(f.billing.balances.push({...f.billing.balances[0]}),f)},
 {name:"unknown calendar invents date",change:f=>({...f,billing:{...f.billing,calendar:{state:"missing",zone:null,local_date:"2026-10-29"}}})},
 {name:"unproved overdue",change:f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],past_due:true}]}})},
 {name:"calendar control character",change:f=>({...f,billing:{...f.billing,calendar:{state:"configured",zone:"America/New_York\u0000",local_date:"2026-10-29"}}})},
 {name:"more pages without original cursor",change:f=>(f.billing.has_more=true,f)},
 {name:"overbroad page",change:f=>(f.billing.invoices=Array.from({length:6},(_,n)=>({...f.billing.invoices[0],id:id(20+n)})),f)},
];
for(const {name,change}of invalid)test(`refuses ${name} rather than manufacturing an empty or authorized invoice source`,async()=>{
 assert.equal((await read(change(fixture()))).status,"degraded");
});
test("retains actual original source semantics for void/test/manual/negative balances and nullable legacy issued versions",async()=>{
 const f=fixture();f.billing.invoices[0].issued_snapshot_version=null;
 f.billing.invoices[0].remaining_minor="-10";f.billing.balances[0].remaining_minor="-10";
 const r=await read(f);assert.equal(r.status,"available");
 if(r.status==="available")assert.equal(r.data?.billing?.invoices[0].remaining_minor,"-10");
});
test("genuine zero invoices differs from failure or missing data",async()=>{
 const f=fixture();f.billing.invoices=[];f.billing.balances=[];f.billing.invoice_count=0;f.billing.open_count=0;
 assert.equal((await read(f)).status,"available");assert.equal((await read(null)).status,"degraded");
});
test("keeps the original five-row page, cursor and complete multi-currency totals without inventing a next payment",async()=>{
 const f=fixture();
 f.billing.calendar={state:"configured",zone:"America/New_York",local_date:"2026-10-29"};
 f.billing.invoices=Array.from({length:5},(_,n)=>({...f.billing.invoices[0],id:id(10+n),currency:n%2?"eur":"usd",
  amount_minor:"100",remaining_minor:"100",past_due:false}));
 f.billing.invoice_count=7;f.billing.open_count=7;f.billing.has_more=true;
 const last=f.billing.invoices[4];f.billing.next_cursor={id:last.id,issued_at:last.issued_at};
 f.billing.balances=[{currency:"usd",remaining_minor:"500",provider_verified_minor:"0",manual_recorded_minor:"0",test_provider_minor:"0"},
  {currency:"eur",remaining_minor:"200",provider_verified_minor:"0",manual_recorded_minor:"0",test_provider_minor:"0"}];
 const r=await read(f);assert.equal(r.status,"available");
 if(r.status==="available"){
  assert.equal(r.data?.billing?.invoices.length,5);assert.equal(r.data?.billing?.invoice_count,7);
  assert.deepEqual(r.data?.billing?.balances,f.billing.balances);assert.deepEqual(r.data?.billing?.next_cursor,f.billing.next_cursor);
 }
});
test("invalid business calendar stays explicit and model budget refusal never becomes zero invoices",async()=>{
 const f=fixture();f.billing.calendar.state="invalid";assert.equal((await read(f)).status,"available");
 assert.equal((await read({...fixture(),billing:{...fixture().billing,invoices:[{...fixture().billing.invoices[0],invoice_number:"x".repeat(33000)}]}})).status,"degraded");
});
test("native revocation, failed source and timed-out/late results never become financial facts",async()=>{
 assert.equal((await readCustomerInvoicesContext(caller(null,{code:"42501"}),actor,thread,intent,persona)).status,"unavailable");
 assert.equal((await readCustomerInvoicesContext(caller(null,{code:"42883"}),actor,thread,intent,persona)).status,"degraded");
 const r=await readCustomerInvoicesContext({rpc:async()=>{await new Promise(resolve=>setTimeout(resolve,15));return{data:fixture(),error:null};}},actor,thread,intent,persona,2);
 assert.equal(r.status,"degraded");await new Promise(resolve=>setTimeout(resolve,20));assert.equal(r.status,"degraded");
});
test("model data discloses original bounded source/calendar and never grants payment, owner authority or global next-payment knowledge",async()=>{
 const r=await read(fixture());if(r.status!=="available"||!r.data)throw Error("Expected source");
 const text=customerInvoicesMessages(r.data).map(m=>m.content).join("\n");
 for(const word of ["untrusted","minor units","test","manual","five","next payment","Billing","approval"])assert.ok(text.includes(word),word);
 assert.equal(text.includes(fingerprint),false);assert.equal(text.includes(actor),false);
});
test("terminal metadata is the original accepted source, while withdrawal/interruption stays empty and source-free",()=>{
 const s=fixture().snapshot;
 assert.deepEqual(customerInvoicesTerminalSource(s,"Reply",{}),{content:"Reply",metadata:{customer_invoices:s}});
 for(const state of ["WITHHELD","INTERRUPTED","REFUSED"])
  assert.deepEqual(customerInvoicesTerminalSource(s,"late",{turn_state:{state}}),{content:"",metadata:{}});
});

test("uses canonical exact-string commercial labels and retains large native strings",async()=>{
 const f=fixture();f.billing.calendar={state:"configured",zone:"America/New_York",local_date:"2026-10-29"};
 f.billing.invoices=[{...f.billing.invoices[0],amount_minor:"100",remaining_minor:"9007199254740993",provider_verified_minor:"25",manual_recorded_minor:"10",test_provider_minor:"5"}];
 const r=await read(f);if(r.status!=="available"||!r.data)throw Error("Expected original facts");
 const text=customerInvoicesMessages(r.data)[0].content;
 assert.ok(text.includes('"amount":"USD 1.00"'));
 assert.ok(text.includes('"provider_verified":"USD 0.25"'));
 assert.ok(text.includes('"manual_recorded":"USD 0.10"'));
 assert.ok(text.includes('"test_provider":"USD 0.05"'));
 assert.ok(text.includes('USD 90,071,992,547,409.93'));
 assert.equal(text.includes('90,071,992,547,409.92'),false);
 assert.equal(r.data.billing.invoices[0].remaining_minor,"9007199254740993");
});

for(const [currency,minor,label] of [["usd","9007199254740991","USD 90,071,992,547,409.91"],
 ["kwd","9007199254740991","KWD 9,007,199,254,740.991"],["eur","-9007199254740991","EUR -90,071,992,547,409.91"]])
 test("retains every minor unit through the original exact-string formatter "+currency,async()=>{
  const f=fixture();f.billing.invoices[0].currency=currency;f.billing.invoices[0].remaining_minor=minor;
  f.billing.balances[0].currency=currency;f.billing.balances[0].remaining_minor=minor;
  const r=await read(f);if(r.status!=="available"||!r.data?.billing)throw Error("Expected original facts");
  const content=customerInvoicesMessages(r.data)[0].content;
  assert.ok(content.includes(label));
  assert.equal(r.data.billing.invoices[0].remaining_minor,minor);
  assert.equal(r.data.billing.balances[0].remaining_minor,minor);
 });

for(const [currency,minor,label] of [["jpy","1234","JPY 1,234"],["kwd","1234","KWD 1.234"],["eur","-10","EUR -0.10"]])
 test("retains original commercial currency presentation "+currency,async()=>{
  const f=fixture();f.billing.invoices[0].currency=currency;f.billing.invoices[0].remaining_minor=minor;
  const r=await read(f);if(r.status!=="available"||!r.data)throw Error("Expected original facts");
  assert.ok(customerInvoicesMessages(r.data)[0].content.includes(label));
 });

test("bounds the final model projection after original amount labels without dropping balances or rounding money",async()=>{
 const f=fixture(),large="9223372036854775807";
 f.billing.invoices=Array.from({length:5},(_,n)=>({...f.billing.invoices[0],id:id(20+n)}));
 f.billing.invoice_count=100;f.billing.open_count=100;f.billing.has_more=true;
 f.billing.next_cursor={issued_at:captured,id:id(24)};
 const alphabet="abcdefghijklmnopqrstuvwxyz";
 f.billing.balances=Array.from({length:100},(_,n)=>({currency:"a"+alphabet[Math.floor(n/26)]+alphabet[n%26],remaining_minor:large,
  provider_verified_minor:large,manual_recorded_minor:large,test_provider_minor:large}));
 assert.ok(JSON.stringify(f).length<32000,"Native input fits the existing input bound");
 assert.equal((await read(f)).status,"degraded","Presentation expansion cannot silently exceed model budget");
 assert.equal(f.billing.balances.length,100);assert.equal(f.billing.balances[99].remaining_minor,large);
});

// O5 native current financial facts: synthetic responses through the SAME caller.
function currentFixture(){const f=fixture();return {...f,billing:{...f.billing,payment_evidence_version:2,financial_evidence_version:3,
 invoices:[{...f.billing.invoices[0],remaining_minor:'50000' as string|null,financial_standing:'recorded',financial_revision:'cd'.repeat(32),
 refund_payable_minor:'10000' as string|null,credit_minor:'25000' as string|null,provider_net_minor:'20000' as string|null}],
 balances:[{...f.billing.balances[0],remaining_minor:'50000' as string|null,financial_standing:'recorded',
 refund_payable_minor:'10000' as string|null,credit_minor:'25000' as string|null,provider_net_minor:'20000' as string|null}],open_count:1 as number|null}};}
test('current native facts retain simultaneous debt/refund/credit/net as separate exact strings',async()=>{
 const r=await read(currentFixture());assert.equal(r.status,'available');if(r.status!=='available'||!r.data?.billing)throw Error('Expected current source');
 const b=r.data.billing;assert.equal(b.invoices[0].remaining_minor,'50000');
 const text=customerInvoicesMessages(r.data)[0].content;
 for(const s of ['USD 500.00','USD 100.00','USD 250.00','USD 200.00','refund','credit','current outstanding'])assert.ok(text.includes(s),s);
 assert.equal(text.includes('cd'.repeat(32)),false,'Opaque original source revision is not model content');
});
test('held current financial facts remain null with no invented zero amount or payment action',async()=>{
 const f=currentFixture();Object.assign(f.billing.invoices[0],{financial_standing:'needs_review',financial_revision:null,remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});
 Object.assign(f.billing.balances[0],{financial_standing:'needs_review',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});f.billing.open_count=null;
 const r=await read(f);assert.equal(r.status,'available');if(r.status!=='available'||!r.data?.billing)throw Error('Expected explicit held source');
 assert.equal(r.data.billing.open_count,null);assert.equal(r.data.billing.invoices[0].remaining_minor,null);
 const text=customerInvoicesMessages(r.data)[0].content;assert.ok(text.includes('Amount awaiting verification'));assert.ok(text.includes('never treat unknown as zero'));
});
test('current zero or credit never establishes collected money or provider settlement',async()=>{
 const f=currentFixture();Object.assign(f.billing.invoices[0],{remaining_minor:'0',refund_payable_minor:'0',credit_minor:'125000'});
 Object.assign(f.billing.balances[0],{remaining_minor:'0',refund_payable_minor:'0',credit_minor:'125000'});f.billing.open_count=0;
 const r=await read(f);assert.equal(r.status,'available');if(r.status!=='available'||!r.data)throw Error('Expected current zero');
 const text=customerInvoicesMessages(r.data)[0].content;assert.ok(text.includes('No amount currently due'));assert.ok(text.includes('does not establish payment completion'));
});
test('native current provider net preserves a negative exact minor string without refund authorization',async()=>{
 const f=currentFixture();f.billing.invoices[0].provider_net_minor='-9007199254740991';f.billing.balances[0].provider_net_minor='-9007199254740991';
 const r=await read(f);assert.equal(r.status,'available');if(r.status!=='available'||!r.data)throw Error('Expected signed native net');
 assert.ok(customerInvoicesMessages(r.data)[0].content.includes('EUR')===false);assert.ok(customerInvoicesMessages(r.data)[0].content.includes('USD -90,071,992,547,409.91'));
});
const invalidCurrent:Array<[string,(f:ReturnType<typeof currentFixture>)=>unknown]>=[
 ['unsupported financial marker',f=>({...f,billing:{...f.billing,financial_evidence_version:4}})],
 ['wrong payment marker',f=>({...f,billing:{...f.billing,payment_evidence_version:1}})],
 ['missing explicit marker',f=>{const {financial_evidence_version:_v,...billing}=f.billing;return {...f,billing};}],
 ['rounded current amount',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],remaining_minor:50000}]}})],
 ['recorded null amount',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],remaining_minor:null}]}})],
 ['negative debt',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],remaining_minor:'-1'}]}})],
 ['negative credit',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],credit_minor:'-1'}]}})],
 ['unknown with inferred zero',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],financial_standing:'needs_review',remaining_minor:'0'}]}})],
 ['malformed source revision',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],financial_revision:'bad'}]}})],
 ['current private provider context',f=>({...f,billing:{...f.billing,invoices:[{...f.billing.invoices[0],merchant_account_id:'forbidden'}]}})],
 ['missing current refund',f=>{const {refund_payable_minor:_r,...row}=f.billing.invoices[0];return {...f,billing:{...f.billing,invoices:[row]}};}],
 ['current source invents count',f=>({...f,billing:{...f.billing,open_count:null}})],
];for(const[name,change]of invalidCurrent)test('current financial source refuses '+name,async()=>{assert.equal((await read(change(currentFixture()))).status,'degraded');});

test('current void facts remain not applicable without implying verification, debt or payment',async()=>{
 const f=currentFixture();Object.assign(f.billing.invoices[0],{status:'void',financial_standing:'not_applicable',financial_revision:null,
  remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null,payable:false,past_due:false});
 f.billing.balances=[];f.billing.open_count=0;const r=await read(f);
 assert.equal(r.status,'available');if(r.status!=='available'||!r.data)throw Error('Expected original void source');
 const text=customerInvoicesMessages(r.data)[0].content;assert.ok(text.includes('Not applicable'));assert.equal(text.includes('Amount awaiting verification'),false);
});
test('off-page held balance withholds the total count without guessing from visible recorded invoices',async()=>{
 const f=currentFixture();Object.assign(f.billing.balances[0],{financial_standing:'needs_review',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});
 f.billing.open_count=null;f.billing.invoice_count=6;f.billing.has_more=true;
 f.billing.invoices=Array.from({length:5},(_,n)=>({...f.billing.invoices[0],id:id(30+n)}));
 const last=f.billing.invoices[4];f.billing.next_cursor={id:last.id,issued_at:last.issued_at};
 const r=await read(f);assert.equal(r.status,'available');if(r.status!=='available'||!r.data?.billing)throw Error('Expected full-source unknown');
 assert.equal(r.data.billing.open_count,null);assert.equal(r.data.billing.balances[0].remaining_minor,null);
});
for(const standing of ['allocation_required','unavailable'])test('current '+standing+' is recoverable evidence, never inferred zero',async()=>{
 const f=currentFixture();Object.assign(f.billing.invoices[0],{financial_standing:standing,financial_revision:null,
  remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});
 Object.assign(f.billing.balances[0],{financial_standing:'needs_review',remaining_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});f.billing.open_count=null;
 assert.equal((await read(f)).status,'available');
});
