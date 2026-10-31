import {beforeEach,expect,it,vi} from 'vitest';
import {dispatchSalesCollectionsChat} from '../../supabase/functions/_shared/sales-collections-chat';
const tenant='e0447600-0000-4000-8000-000000000001',id='e0447600-0000-4000-8000-000000000002',receiptId='e0447600-0000-4000-8000-000000000003';
const invoice=()=>({id,tenant_id:tenant,status:'issued',record_kind:'managed',currency:'usd',amount_cents:100000,manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:100000,test_provider_verified_cents:50000,payment_evidence_version:2,collection_required:true,client_name:'PRIVATE_SOURCE',client_id:'PRIVATE_SOURCE',merchant_account_id:'PRIVATE_SOURCE',notes:'PRIVATE_SOURCE'});
const receipt=()=>({id,tenant_id:tenant,invoice_id:receiptId,kind:'receipt',provenance:'provider_verified',provider:'stripe',provider_environment:'test',currency:'usd',amount_cents:50000,payment_evidence_version:2,reference:'PRIVATE_SOURCE',notes:'PRIVATE_SOURCE'});
const page=(rows:unknown[]=[invoice()])=>({tenant_id:tenant,receipt_id:receiptId,rows,has_more:false,next_cursor:null,payment_evidence_version:2});
const f={payload:page() as Record<string,unknown>,error:null as unknown,calls:[] as {name:string;args:Record<string,unknown>;headers:Record<string,string>}[],invoke:vi.fn()};
const deps={admin:{from:()=>{throw Error('read cannot use approval lookup');}},caller:{rpc:(name:string,args:Record<string,unknown>)=>{const headers:Record<string,string>={};const query={setHeader:(k:string,v:string)=>{headers[k]=v;return query;},then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{f.calls.push({name,args,headers});return{data:f.payload,error:f.error};}).then(resolve,reject)};return query;},functions:{invoke:f.invoke}}};
const read=(entity='invoice',args:Record<string,unknown>={})=>dispatchSalesCollectionsChat({tenantId:tenant,userId:receiptId,toolName:'read_sales_collections',args:{entity,...args},approved:new Set(),sameToolCalls:1,turn:{thread_id:null,user_turn_ordinal:1,user_turn:'Read my original Collections'}},deps as never);
beforeEach(()=>{f.payload=page();f.error=null;f.calls=[];f.invoke.mockReset();});
it('uses original caller/receipt/RPC arguments with only the existing financial representation header',async()=>{
 const result=await read();expect(result.content).toMatchObject({success:true,receipt_id:receiptId,payment_evidence_version:2,rows:[{id,remaining_cents:100000,provider_verified_cents:0,allocated_cents:0,test_provider_verified_cents:50000,payment_evidence_version:2,collection_required:true}]});
 expect(f.calls).toEqual([{name:'read_sales_collections',args:{_expected_tenant_id:tenant,_entity:'invoice',_limit:25,_cursor:null,_before_id:null},headers:{'x-paige-invoice-evidence-version':'2'}}]);
 expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE');expect(f.invoke).not.toHaveBeenCalled();expect(String(result.content.note)).toMatch(/no money moved|moved no money/i);
});
it('preserves mixed actual receipts independently of larger historical TEST activity',async()=>{
 f.payload=page([{...invoice(),manual_recorded_cents:25000,provider_verified_cents:50000,allocated_cents:75000,remaining_cents:25000,test_provider_verified_cents:200000}]);
 expect((await read()).content.rows).toEqual([expect.objectContaining({manual_recorded_cents:25000,provider_verified_cents:50000,allocated_cents:75000,remaining_cents:25000,test_provider_verified_cents:200000})]);
});
it.each([null,1,3,'2',{}])('unsupported root financial version %j cannot become success',async marker=>{
 f.payload={...page(),payment_evidence_version:marker};expect((await read()).content.success).toBe(false);expect(f.calls).toHaveLength(1);
});
it.each([undefined,null,1,'2'])('a mismatched actual row version %j is refused',async marker=>{
 f.payload=page([{...invoice(),payment_evidence_version:marker}]);expect((await read()).content.success).toBe(false);
});
it.each([undefined,null,-1,'50000'])('actual TEST evidence must be explicit valid native facts: %j',async test=>{
 f.payload=page([{...invoice(),test_provider_verified_cents:test}]);const result=await read();expect(result.content.success).toBe(false);expect(result.content).not.toHaveProperty('rows');
});
it('a foreign actual row is refused even when the outer receipt/tenant matches',async()=>{
 f.payload=page([{...invoice(),tenant_id:receiptId}]);expect((await read()).content.success).toBe(false);
});
it.each([{remaining_cents:50000},{allocated_cents:50000},{provider_verified_cents:-1},{currency:'USD'}])('inconsistent actual financial facts %j never reach the model',async patch=>{
 f.payload=page([{...invoice(),...patch}]);expect((await read()).content.success).toBe(false);
});
it('keeps original actual provider TEST identity/environment with no private source extension',async()=>{
 f.payload=page([receipt()]);const result=await read('receipt');expect(result.content).toMatchObject({success:true,rows:[{id,kind:'receipt',provenance:'provider_verified',provider:'stripe',provider_environment:'test',payment_evidence_version:2,amount_cents:50000}]});expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE');
});
it.each([{value:undefined},{value:null},{value:'unknown'},{value:['live']}])('actual provider environment must be a native TEST/LIVE string: %j',async({value})=>{
 f.payload=page([{...receipt(),provider_environment:value}]);expect((await read('receipt')).content.success).toBe(false);
});
it('manual actual receipt remains human recorded and refuses a provider environment',async()=>{
 f.payload=page([{...receipt(),provenance:'human_recorded',provider:null,provider_environment:null}]);expect((await read('receipt')).content).toMatchObject({success:true,rows:[{provenance:'human_recorded',provider_environment:null}]});
 f.payload=page([{...receipt(),provenance:'human_recorded',provider:null,provider_environment:'test'}]);expect((await read('receipt')).content.success).toBe(false);
});
it('preserves unversioned facts as explicitly legacy, without certifying actual debt',async()=>{
 f.payload={tenant_id:tenant,receipt_id:receiptId,rows:[{id,status:'recorded',amount_cents:100000,remaining_cents:50000,currency:'usd',record_kind:'imported'}],has_more:false,next_cursor:null};
 const result=await read();expect(result.content).toMatchObject({success:true,rows:[{id,remaining_cents:50000}]});expect(result.content).not.toHaveProperty('payment_evidence_version');expect(String(result.content.note)).toMatch(/unversioned.*TEST/i);
});
it('agreement context keeps its original scope and does not acquire a financial header or authority',async()=>{
 f.payload={tenant_id:tenant,receipt_id:receiptId,rows:[],has_more:false,next_cursor:null};expect((await read('agreement')).content.success).toBe(true);expect(f.calls[0].headers).toEqual({});expect(f.invoke).not.toHaveBeenCalled();
});
it('model-supplied representation flags remain outside the original argument contract',async()=>{
 expect((await read('invoice',{payment_evidence_version:2})).content.success).toBe(false);expect(f.calls).toEqual([]);
});
it('an unknown read result neither retries nor executes a financial action',async()=>{
 f.error={code:'synthetic_unknown'};expect((await read()).content.success).toBe(false);expect(f.calls).toHaveLength(1);expect(f.invoke).not.toHaveBeenCalled();
});
it.each([{amount_cents:'100000'},{status:['issued']},{collection_required:false}])('contradictory or coerced native actual invoice facts %j are refused',async patch=>{
 f.payload=page([{...invoice(),...patch}]);expect((await read()).content.success).toBe(false);
});
it('an actual receipt must retain a valid original invoice reference',async()=>{
 f.payload=page([{...receipt(),invoice_id:'not-an-original-reference'}]);expect((await read('receipt')).content.success).toBe(false);
});
