// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model';
import {readAcceptedInvoicePaymentPlan} from '../../supabase/functions/_shared/sales-payments/accepted-obligation-read';
import {dispatchSalesInvoiceChat} from '../../supabase/functions/_shared/sales-invoice-chat';
const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenant=id(1),client=id(2),agreement=id(4),terms=id(5),invoice=id(6);
const input={invoice_id:invoice,agreement_id:agreement,client_id:client,invoice_version:2,invoice_draft_version:1,issued_snapshot_version:1,currency:'usd'};
async function makeFixture(){
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Synthetic schedule unavailable');
 const treatment={state:'not_applicable',charges:[],source:'Synthetic recorded decision',policy:'No additional charge'},body='Synthetic retained commercial record.';
 const p=await prepareCommercialPresentation({schema_version:2,engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'},source:{tenant_id:tenant,client_id:client,offer_id:id(3),agreement_id:agreement,agreement_version:4,agreement_updated_at:'2026-10-14T18:00:00Z',body_source:'tenant_template',status:'draft',content_sha256:null,terms_id:terms,terms_version:3,terms_updated_at:'2026-10-14T18:00:00Z',invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:'2026-10-14T18:00:00Z'},title:'Synthetic agreement',body_markdown:body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions:{schema_version:1,tax:treatment,fees:treatment},lines:[{unit_minor:350000,quantity:1}]});
 return {schema_version:1,state:'recorded',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:id(7),completed_at:'2026-10-15T00:00:00Z',payload:p.payload,payload_digest:p.payload_digest,body_markdown:body,presented_body_markdown:commercialPresentationText(body,p),document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64),payment_obligations:{schema_version:1,state:'available',tenant_id:tenant,client_id:client,invoice_id:invoice,invoice_version:2,invoice_draft_version:1,issued_snapshot_version:1,obligations:p.payload.obligations.filter(r=>r.amount_cents>0).map(r=>({reference:{commercial_terms_id:terms,signing_id:agreement,signing_version:4,terms_version:3,sequence:r.sequence},source_digest:p.payload_digest,due_date:r.due_date,scheduled_minor:r.amount_cents,remaining_minor:r.amount_cents}))}};
}
type Fixture=Awaited<ReturnType<typeof makeFixture>>;
const seed=makeFixture(),fixture=async()=>structuredClone(await seed);
const read=async(data:unknown,args:unknown=input)=>readAcceptedInvoicePaymentPlan(tenant,args,{rpc:async()=>({data,error:null})});
it('reads the exact accepted dated schedule through only the distinct original-owner admission',async()=>{
 const data=await fixture(),rpc=vi.fn().mockResolvedValue({data,error:null});
 const result=await readAcceptedInvoicePaymentPlan(tenant,input,{rpc});
 expect(rpc).toHaveBeenCalledExactlyOnceWith('read_sales_accepted_invoice_obligations',{_expected_tenant_id:tenant,_invoice_id:invoice,_agreement_id:agreement});
 expect(result).toMatchObject({state:'available',currency:'usd',accepted:{state:'recorded',presentation:{payload:{principal_minor:350000}}},obligations:data.payment_obligations.obligations});
 if(result.state!=='available')throw Error('Accepted schedule missing');
 expect(result.obligations).toHaveLength(11);expect(result.obligations[0]).toMatchObject({due_date:'2026-10-15',scheduled_minor:50000});
 expect(result.obligations.slice(1).every(r=>r.scheduled_minor===30000)).toBe(true);
 expect(JSON.stringify(result)).not.toMatch(/dispatch_claim|service_role|merchant_account|approved_fingerprint/);
});
it('retains native remaining allocations without recomputing or distributing them',async()=>{
 const data=await fixture();data.payment_obligations.obligations[0].remaining_minor=0;data.payment_obligations.obligations[1].remaining_minor=10000;
 const result=await read(data);expect(result.state).toBe('available');if(result.state!=='available')throw Error('Native allocation missing');
 expect(result.obligations[0].remaining_minor).toBe(0);expect(result.obligations[1].remaining_minor).toBe(10000);
});
it.each(['invoice_not_issued','accepted_source_unavailable','commercial_terms_inactive','accepted_source_changed','test_payment_evidence','allocation_conflict','allocation_required'])('retains the native held reason %s without exposing eligible targets',async reason=>{
 const data=await fixture();const held={...data,payment_obligations:{...data.payment_obligations,state:'held',reason,obligations:[]}};
 expect(await read(held)).toEqual({state:'held',reason});
});
const invalidCases:Array<[string,(d:Fixture)=>void]>=[
 ['outer tenant',d=>{d.tenant_id=id(90)}],['outer invoice',d=>{d.invoice_id=id(90)}],['outer signing',d=>{d.agreement_id=id(90)}],
 ['observation tenant',d=>{d.payment_obligations.tenant_id=id(90)}],['observation client',d=>{d.payment_obligations.client_id=id(90)}],['observation invoice',d=>{d.payment_obligations.invoice_id=id(90)}],
 ['accepted wording',d=>{d.body_markdown+=' altered'}],['accepted payload',d=>{d.payload.principal_minor++}],['accepted digest',d=>{d.payload_digest='c'.repeat(64)}],
 ['target signing',d=>{d.payment_obligations.obligations[0].reference.signing_id=id(90)}],['target terms',d=>{d.payment_obligations.obligations[0].reference.commercial_terms_id=id(90)}],
 ['target signing revision',d=>{d.payment_obligations.obligations[0].reference.signing_version++}],['target terms revision',d=>{d.payment_obligations.obligations[0].reference.terms_version++}],
 ['target sequence',d=>{d.payment_obligations.obligations[0].reference.sequence++}],['target digest',d=>{d.payment_obligations.obligations[0].source_digest='c'.repeat(64)}],
 ['target date',d=>{d.payment_obligations.obligations[0].due_date='2026-10-16'}],['target principal',d=>{d.payment_obligations.obligations[0].scheduled_minor++}],
 ['excess remaining',d=>{d.payment_obligations.obligations[0].remaining_minor++}],['negative remaining',d=>{d.payment_obligations.obligations[0].remaining_minor=-1}],
 ['missing row',d=>{d.payment_obligations.obligations.pop()}],['extra row',d=>{d.payment_obligations.obligations.push(d.payment_obligations.obligations[0])}],
 ['duplicate row',d=>{d.payment_obligations.obligations[1]=d.payment_obligations.obligations[0]}],['reordered rows',d=>{d.payment_obligations.obligations.reverse()}],
];
it.each(invalidCases)('withholds all plan data for altered %s',async(_label,mutate)=>{const data=await fixture();mutate(data);expect(await read(data)).toEqual({state:'refused'});});
it.each(['invoice_version','invoice_draft_version','issued_snapshot_version'] as const)('retires a read after native %s changes',async field=>{const data=await fixture();data.payment_obligations[field]++;expect(await read(data)).toEqual({state:'stale'});});
it('refuses unexpected envelope or target authority fields rather than accepting a partial object',async()=>{
 const data=await fixture();expect(await read({...data,approved:true})).toEqual({state:'refused'});
 expect(await read({...data,payment_obligations:{...data.payment_obligations,may_execute:true}})).toEqual({state:'refused'});
 data.payment_obligations.obligations[0]={...data.payment_obligations.obligations[0],approved:true} as typeof data.payment_obligations.obligations[0];
 expect(await read(data)).toEqual({state:'refused'});
});
it('refuses unsupported native states or held reasons instead of silently treating them as empty',async()=>{
 const data=await fixture();expect(await read({...data,payment_obligations:{...data.payment_obligations,state:'paid'}})).toEqual({state:'refused'});
 expect(await read({...data,payment_obligations:{...data.payment_obligations,state:'held',reason:'unknown_future_reason',obligations:[]}})).toEqual({state:'refused'});
});
it('preserves missing accepted evidence without showing current terms as a signed schedule',async()=>{
 const data=await fixture();const base={schema_version:data.schema_version,tenant_id:data.tenant_id,invoice_id:data.invoice_id,agreement_id:data.agreement_id,receipt_id:data.receipt_id,payment_obligations:data.payment_obligations};
 expect(await read({...base,state:'unverified',payment_obligations:{...base.payment_obligations,state:'held',reason:'accepted_source_unavailable',obligations:[]}})).toEqual({state:'unverified'});
});
it.each([{...input,amount_minor:50000},{...input,approved:true},{...input,client_id:id(90),currency:'USD'},{...input,invoice_version:0},{...input,issued_snapshot_version:0}])('rejects invalid caller context before contacting native source: %o',async args=>{
 const rpc=vi.fn();expect(await readAcceptedInvoicePaymentPlan(tenant,args,{rpc})).toEqual({state:'refused'});expect(rpc).not.toHaveBeenCalled();
});
it('withholds private data on server refusal and transport rejection',async()=>{
 expect(await readAcceptedInvoicePaymentPlan(tenant,input,{rpc:async()=>({data:await fixture(),error:{message:'private detail'}})})).toEqual({state:'refused'});
 expect(await readAcceptedInvoicePaymentPlan(tenant,input,{rpc:async()=>{throw Error('private detail')}})).toEqual({state:'refused'});
});

const chatContext={tenantId:tenant,userId:id(8),toolName:'read_sales_invoice',args:{invoice_id:invoice,include_accepted_payment_plan:true},approved:new Set<string>(),sameToolCalls:1,turn:{thread_id:null,user_turn_ordinal:1,user_turn:'Inspect the accepted payment plan'}};
const invoiceRow=()=>({id:invoice,tenant_id:tenant,status:'issued',version:2,issued_snapshot_version:1,billing_draft_version:1,currency:'usd',amount_total_cents:350000,remaining_cents:350000,
 billing_draft:{schema_version:3,client_id:client,agreement_id:agreement,currency:'usd',memo:'PRIVATE_INVOICE_WORDING'},document:'PRIVATE_DOCUMENT'});
async function chatRead(native:unknown,row:unknown=invoiceRow(),args:Record<string,unknown>=chatContext.args){
 const rpc=vi.fn(async(name:string)=>({data:name==='read_sales_invoice'?row:native,error:null}));
 const invoke=vi.fn(),from=vi.fn(()=>{throw Error('Read cannot select an approval')});
 const result=await dispatchSalesInvoiceChat({...chatContext,args},{admin:{from},caller:{rpc,functions:{invoke}}});
 expect(from).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();
 return {result,rpc};
}
it('discovers the exact dated accepted plan through the original invoice read and native reader',async()=>{
 const data=await fixture();data.payment_obligations.obligations[0].remaining_minor=0;data.payment_obligations.obligations[1].remaining_minor=10000;
 const {result,rpc}=await chatRead(data);
 expect(rpc.mock.calls).toEqual([['read_sales_invoice',{_expected_tenant_id:tenant,_invoice_id:invoice}],['read_sales_accepted_invoice_obligations',{_expected_tenant_id:tenant,_invoice_id:invoice,_agreement_id:agreement}]]);
 expect(result.content).toMatchObject({success:true,invoice:{id:invoice,version:2},payment_plan:{state:'available',currency:'usd',principal_minor:350000,invoice_version:2,issued_snapshot_version:1,acceptance_recorded_at:data.completed_at,acceptance_receipt_id:data.receipt_id,obligations:data.payment_obligations.obligations}});
 const plan=result.content.payment_plan as Record<string,unknown>;
 expect(Object.keys(plan).sort()).toEqual(['state','currency','principal_minor','invoice_version','issued_snapshot_version','acceptance_recorded_at','acceptance_receipt_id','obligations'].sort());
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|Synthetic retained commercial record|sealed_sha256|body_markdown|presented_body_markdown|approved_fingerprint|merchant_account/);
 expect(plan).not.toHaveProperty('paid');expect(plan).not.toHaveProperty('may_execute');
});
it.each([undefined,false])('preserves the exact original one-RPC read when plan inspection is %s',async flag=>{
 const args={invoice_id:invoice,...(flag===undefined?{}:{include_accepted_payment_plan:flag})};
 const {result,rpc}=await chatRead(await fixture(),invoiceRow(),args);
 expect(result.content.success).toBe(true);expect(result.content).not.toHaveProperty('payment_plan');expect(rpc).toHaveBeenCalledTimes(1);
});
it.each(['invoice_not_issued','accepted_source_unavailable','commercial_terms_inactive','accepted_source_changed','test_payment_evidence','allocation_conflict','allocation_required'])('returns the original native %s hold without eligible targets',async reason=>{
 const data=await fixture();const {result}=await chatRead({...data,payment_obligations:{...data.payment_obligations,state:'held',reason,obligations:[]}});
 expect(result.content.payment_plan).toEqual({state:'held',reason});
});
it('withholds stale or altered accepted source facts at the Chat entry',async()=>{
 const data=await fixture();data.payment_obligations.invoice_version++;
 expect((await chatRead(data)).result.content.payment_plan).toEqual({state:'stale'});
 const changed=await fixture();changed.payment_obligations.obligations[0].due_date='2026-10-16';
 expect((await chatRead(changed)).result.content.payment_plan).toEqual({state:'refused'});
 const foreign=await fixture();foreign.payment_obligations.client_id=id(90);
 expect((await chatRead(foreign)).result.content.payment_plan).toEqual({state:'refused'});
});
it('retains unverified acceptance without inventing a signed plan',async()=>{
 const data=await fixture();const native={schema_version:1,state:'unverified',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:data.receipt_id,
 payment_obligations:{...data.payment_obligations,state:'held',reason:'accepted_source_unavailable',obligations:[]}};
 expect((await chatRead(native)).result.content.payment_plan).toEqual({state:'unverified'});
});
it.each([{status:'draft'},{status:'void'}])('does not ask native for an unissued or void plan: %o',async change=>{
 const {result,rpc}=await chatRead(await fixture(),{...invoiceRow(),...change});
 expect(result.content.payment_plan).toEqual({state:'held',reason:'invoice_not_issued'});expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([{billing_draft:null},{billing_draft_version:2},{issued_snapshot_version:null},{currency:'eur'},
 {billing_draft:{schema_version:'3',client_id:client,agreement_id:agreement,currency:'usd'}},
 {billing_draft:{schema_version:4,client_id:client,agreement_id:agreement,currency:'usd'}},
 {billing_draft:{schema_version:3,client_id:client,agreement_id:null,currency:'usd'}}])('does not invent missing or mismatched retained coordinates: %o',async change=>{
 const {result,rpc}=await chatRead(await fixture(),{...invoiceRow(),...change});
 expect(result.content.payment_plan).toEqual({state:'unverified'});expect(rpc).toHaveBeenCalledTimes(1);
});
it('hands a discovered target to the existing exact approval door without a caller amount',async()=>{
 const inspected=await chatRead(await fixture());
 const plan=inspected.result.content.payment_plan as {obligations:Array<{reference:Record<string,unknown>}>};
 const reference=plan.obligations[1].reference;
 const invoke=vi.fn(async()=>({data:{outcome:'approval_required',fingerprint:'0123456789abcdef',summary:'Review the exact accepted payment'},error:null}));
 const rpc=vi.fn(),from=vi.fn(()=>{throw Error('No approval was granted')});
 const result=await dispatchSalesInvoiceChat({...chatContext,toolName:'sales_create_payment_request',args:{invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'installment',obligation_reference:reference}},
  {admin:{from},caller:{rpc,functions:{invoke}}});
 expect(invoke).toHaveBeenCalledExactlyOnceWith('sales-invoice-command',{body:{expected_tenant_id:tenant,operation_id:expect.stringMatching(/^[a-f0-9-]{36}$/),
  command:{action:'invoice.payment_request',invoice_id:invoice,expected_version:2,provider:'stripe',purpose:'installment',obligation_reference:reference}}});
 expect(result.content).toMatchObject({success:false,needs_confirm:true,requires_operator_approval:true,confirm_fingerprint:'0123456789abcdef'});
 expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
it('keeps an accepted-plan transport failure separate from the already scoped invoice read',async()=>{
 const rpc=vi.fn(async(name:string)=>name==='read_sales_invoice'?{data:invoiceRow(),error:null}:{data:null,error:{message:'PRIVATE_BACKEND_ERROR'}});
 const result=await dispatchSalesInvoiceChat(chatContext,{admin:{from(){throw Error('No approval lookup')}},caller:{rpc,functions:{invoke(){throw Error('No mutation')}}}});
 expect(result.content).toMatchObject({success:true,invoice:{id:invoice},payment_plan:{state:'refused'}});
 expect(JSON.stringify(result)).not.toContain('PRIVATE_');
 const rejected=await dispatchSalesInvoiceChat(chatContext,{admin:{from(){throw Error('No approval lookup')}},caller:{rpc:async name=>{if(name==='read_sales_invoice')return {data:invoiceRow(),error:null};throw Error('PRIVATE_TRANSPORT')},functions:{invoke(){throw Error('No mutation')}}}});
 expect(rejected.content).toMatchObject({success:true,payment_plan:{state:'refused'}});expect(JSON.stringify(rejected)).not.toContain('PRIVATE_');
});
it.each([{include_accepted_payment_plan:'true'},{include_accepted_payment_plan:null},{agreement_id:agreement},{client_id:client},{approved:true}])('rejects model-authored plan context or malformed opt-in before any read: %o',async change=>{
 const {result,rpc}=await chatRead(await fixture(),invoiceRow(),{...chatContext.args,...change});
 expect(result.content.success).toBe(false);expect(rpc).not.toHaveBeenCalled();
});
