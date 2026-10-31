import {it,expect,vi} from 'vitest';
import {readInvoiceRecord,listInvoiceRecords} from './invoiceLifecycleApi';
const tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const snapshot={schema_version:2,client_id:'33333333-3333-4333-8333-333333333333',items:[{price_id:null,item:'Service',description:'Original\nUnicode 日本語',unit_minor:1000,quantity:1,price_snapshot:null}],kind:'one_time',deposit_basis_points:null,currency:'usd',cadence:null,recipient_email:'client@example.test',recipient_phone:null,email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,agreement_snapshot:null,processor_intent:null,payment_method_intents:['cash'],delivery_channel_intents:['email'],due_date:'2026-10-10',memo:null,total_minor:1000,due_now_minor:1000,remainder_minor:0};
const row=(patch:Record<string,unknown>={})=>({id,tenant_id:tenant,status:'issued',invoice_number:'INV1',billing_draft_version:1,version:2,amount_total_cents:1000,billing_draft:snapshot,issued_snapshot_version:1,document:{renderer_version:'paige-invoice-html-v1',snapshot},document_input_digest:'a'.repeat(64),manual_recorded_cents:400,remaining_cents:600,payments:[],payments_count:1,payments_has_more:true,...patch});
it('reads immutable issued facts and aggregate balance even when register omits history',()=>{expect(readInvoiceRecord(row(),tenant)).toMatchObject({status:'issued',version:2,remainingMinor:600,manualRecordedMinor:400,payments:[],paymentsCount:1,paymentsHasMore:true,snapshot:{items:[{description:'Original\nUnicode 日本語'}]}});});
it.each([{payments_count:-1},{payments_has_more:false},{remaining_cents:700},{manual_recorded_cents:1001},{issued_snapshot_version:2},{document_input_digest:''},{status:'paid'},{tenant_id:id},{billing_draft:{...snapshot,schema_version:3}}])('fails closed invalid lifecycle projection %j',patch=>expect(readInvoiceRecord(row(patch),tenant)).toBeNull());
it('readable drafts remain editable v2 facts without requiring issued document',()=>expect(readInvoiceRecord(row({status:'draft',version:1,issued_snapshot_version:null,document:null,document_input_digest:null,manual_recorded_cents:0,remaining_cents:1000,payments_count:0,payments_has_more:false}),tenant)).toMatchObject({status:'draft',version:1}));
it('fails entire page for foreign projection and uses canonical page reader',async()=>{const rpc=vi.fn().mockResolvedValue({data:{rows:[row(),row({tenant_id:id})],has_more:false,next_cursor:null},error:null});expect(await listInvoiceRecords(rpc,tenant)).toMatchObject({ok:false});expect(rpc).toHaveBeenCalledWith('list_sales_invoices',{_expected_tenant_id:tenant,_limit:50,_before_id:null});});

it('reads provider allocation without promoting manual receipts into provider evidence',()=>expect(readInvoiceRecord(row({manual_recorded_cents:100,provider_verified_cents:300,allocated_cents:400,remaining_cents:600}),tenant)).toMatchObject({manualRecordedMinor:100,providerVerifiedMinor:300,allocatedMinor:400,remainingMinor:600}));
it.each([{manual_recorded_cents:100,provider_verified_cents:300,allocated_cents:399},{provider_verified_cents:-1},{provider_verified_cents:300},{provider_verified_cents:300,allocated_cents:700,remaining_cents:601}])('refuses inconsistent split balance %j',patch=>expect(readInvoiceRecord(row(patch),tenant)).toBeNull());

const providerReceipt={id:'55555555-5555-4555-8555-555555555555',kind:'receipt',amount_cents:500,method:'stripe',received_at:'2026-01-01T00:00:00Z',actor_user_id:'33333333-3333-4333-8333-333333333333',reference:null,notes:null,reverses_payment_id:null,reason:null,evidence_kind:'provider_verified',provider:'stripe',provider_verified_at:'2026-01-01T00:00:00Z',provider_environment:'test'};
const evidenceRow=(patch:Record<string,unknown>={})=>row({payment_evidence_version:2,test_provider_verified_cents:500,manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:1000,payments:[providerReceipt],payments_count:1,payments_has_more:false,...patch});
it('retains native TEST verification without reducing business debt or claiming live cash',()=>{
 const actual=readInvoiceRecord(evidenceRow(),tenant);
 expect(actual).toMatchObject({paymentEvidenceVersion:2,testProviderVerifiedMinor:500,manualRecordedMinor:0,providerVerifiedMinor:0,allocatedMinor:0,remainingMinor:1000,payments:[{provider_environment:'test',evidence_kind:'provider_verified'}]});
});
it('retains the native business projection on a paginated read without summing its visible receipts',()=>{
 expect(readInvoiceRecord(evidenceRow({manual_recorded_cents:100,provider_verified_cents:300,allocated_cents:400,remaining_cents:600,payments:[],payments_count:3,payments_has_more:true}),tenant)).toMatchObject({manualRecordedMinor:100,providerVerifiedMinor:300,testProviderVerifiedMinor:500,allocatedMinor:400,remainingMinor:600});
});
it('preserves historical receipt environment when the current merchant mode differs',()=>{
 expect(readInvoiceRecord(evidenceRow({payments:[{...providerReceipt,provider_environment:'live'}],provider_verified_cents:500,test_provider_verified_cents:0,allocated_cents:500,remaining_cents:500}),tenant)).toMatchObject({providerVerifiedMinor:500,testProviderVerifiedMinor:0,payments:[{provider_environment:'live'}]});
});
it.each([{payment_evidence_version:3},{payment_evidence_version:'2'},{test_provider_verified_cents:undefined},{test_provider_verified_cents:null},{test_provider_verified_cents:-1},{test_provider_verified_cents:0.5},{test_provider_verified_cents:Number.MAX_SAFE_INTEGER+1},{test_provider_verified_cents:NaN}])('refuses unsupported or incomplete native environment evidence %j',patch=>expect(readInvoiceRecord(evidenceRow(patch),tenant)).toBeNull());
it('refuses a TEST total without its declared native projection version',()=>expect(readInvoiceRecord(row({test_provider_verified_cents:500}),tenant)).toBeNull());
it.each([undefined,null,'TEST','production',['test'],['live'],{environment:'test'}])('requires an exact persisted environment on v2 provider receipts: %s',environment=>expect(readInvoiceRecord(evidenceRow({payments:[{...providerReceipt,provider_environment:environment}]}),tenant)).toBeNull());
it.each([undefined,['provider_verified'],['manual_recorded'],{}])('requires the exact v2 evidence class instead of guessing from the method: %j',evidence=>expect(readInvoiceRecord(evidenceRow({payments:[{...providerReceipt,evidence_kind:evidence}]}),tenant)).toBeNull());
it('preserves human recorded evidence with no claimed provider environment',()=>{
 const manual={...providerReceipt,evidence_kind:'manual_recorded',method:'cash',provider:null,provider_environment:null,provider_verified_at:null};
 expect(readInvoiceRecord(evidenceRow({manual_recorded_cents:500,allocated_cents:500,remaining_cents:500,test_provider_verified_cents:0,payments:[manual]}),tenant)).toMatchObject({manualRecordedMinor:500,providerVerifiedMinor:0,payments:[{evidence_kind:'manual_recorded',provider_environment:null}]});
 expect(readInvoiceRecord(evidenceRow({payments:[{...manual,provider_environment:'live'}]}),tenant)).toBeNull();
});
it('does not manufacture v2 authority or a zero TEST total for legacy records',()=>{
 const actual=readInvoiceRecord(row(),tenant);
 expect(actual).not.toHaveProperty('paymentEvidenceVersion');expect(actual).not.toHaveProperty('testProviderVerifiedMinor');
});
