import {beforeEach,expect,it,vi} from 'vitest';
import {decodeInvoice,decodeReceipt,decodeRegister,exportRegister,readRegister} from './api';
const f=vi.hoisted(()=>({reply:vi.fn(),calls:[] as {name:string;args:Record<string,unknown>;headers:Record<string,string>}[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
 const headers:Record<string,string>={};const query={setHeader:(k:string,v:string)=>{headers[k]=v;return query;},then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{f.calls.push({name,args,headers});return f.reply();}).then(resolve,reject)};return query;
}}}));
const tenant='e0447500-0000-4000-8000-000000000001',client='e0447500-0000-4000-8000-000000000002',id='e0447500-0000-4000-8000-000000000003',time='2026-10-01T00:00:00Z';
const invoice=()=>({id,tenant_id:tenant,client_id:client,client_name:'Test advisory client',invoice_number:'SYNTHETIC-1',source_invoice_number:null,status:'issued',version:1,amount_cents:10000,currency:'usd',due_date:null,created_at:time,manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:10000,test_provider_verified_cents:5000,payment_evidence_version:2,receipt_count:1,record_kind:'managed',provenance:'canonical_record',collection_required:true});
const receipt=()=>({id,tenant_id:tenant,invoice_id:id,client_id:client,client_name:'Test advisory client',invoice_number:'SYNTHETIC-1',source_invoice_number:null,kind:'receipt',amount_cents:5000,currency:'usd',method:'stripe',received_at:time,created_at:time,reference:null,notes:null,reason:null,actor_user_id:client,reverses_payment_id:null,provenance:'provider_verified',provider:'stripe',provider_environment:'test',payment_evidence_version:2});
const page=(rows:unknown[]=[invoice()])=>({rows,has_more:false,next_cursor:null,snapshot_at:time,membership_captured_at:time,facts_read_at:time,export_completed_at:time,membership_count:rows.length,balance_basis:'canonical_receipt_allocations',membership_boundary:'canonical_ids_snapshot',payment_evidence_version:2});
beforeEach(()=>{f.reply.mockReset();f.calls=[];});
it('uses the SAME scoped register arguments and original native evidence header without mutation',async()=>{
 f.reply.mockResolvedValue({data:page(),error:null});const result=await readRegister(tenant,'invoice',null,decodeInvoice);
 expect(result.rows[0]).toMatchObject({remaining_cents:10000,provider_verified_cents:0,test_provider_verified_cents:5000,payment_evidence_version:2});
 expect(f.calls).toEqual([{name:'list_sales_collection_register',args:{_expected_tenant_id:tenant,_entity:'invoice',_limit:50,_cursor:null},headers:{'x-paige-invoice-evidence-version':'2'}}]);
});
it.each([undefined,null,-1,'5000'])('actual financial evidence requires explicit valid TEST cents: %j',test=>{
 expect(decodeInvoice({...invoice(),test_provider_verified_cents:test},tenant)).toBeNull();
});
it('actual evidence requires the original explicit allocated amount rather than a guessed replacement',()=>{
 expect(decodeInvoice({...invoice(),allocated_cents:undefined},tenant)).toBeNull();
});
it.each([null,1,3,'2',{}])('refuses unsupported native financial marker %j in the original row or page',marker=>{
 expect(decodeInvoice({...invoice(),payment_evidence_version:marker},tenant)).toBeNull();
 expect(decodeRegister({...page(),payment_evidence_version:marker},tenant,'invoice',decodeInvoice)).toBeNull();
});
it('refuses mixed or mismatched row/page representation, including an empty unsupported page',()=>{
 const legacy={...invoice()};delete (legacy as Partial<typeof legacy>).payment_evidence_version;
 expect(decodeRegister(page([legacy]),tenant,'invoice',decodeInvoice)).toBeNull();
 const oldPage={...page([invoice()])};delete (oldPage as Partial<typeof oldPage>).payment_evidence_version;
 expect(decodeRegister(oldPage,tenant,'invoice',decodeInvoice)).toBeNull();
 expect(decodeRegister({...page([]),payment_evidence_version:3},tenant,'invoice',decodeInvoice)).toBeNull();
});
it('keeps genuine actual LIVE/manual amounts independent of larger historical TEST evidence',()=>{
 const full={...invoice(),remaining_cents:0,allocated_cents:10000,provider_verified_cents:7500,manual_recorded_cents:2500,test_provider_verified_cents:20000,collection_required:false};
 expect(decodeInvoice(full,tenant)).toMatchObject(full);
 expect(decodeInvoice({...full,allocated_cents:30000},tenant)).toBeNull();expect(decodeInvoice(full,client)).toBeNull();
});
it.each([undefined,null,'unknown',false])('actual provider receipt requires native TEST/LIVE evidence, got %j',environment=>{
 expect(decodeReceipt({...receipt(),provider_environment:environment},tenant)).toBeNull();
});
it('retains explicit TEST/LIVE receipt classes and refuses provider identity on a manual receipt',()=>{
 expect(decodeReceipt(receipt(),tenant)).toMatchObject({provider_environment:'test',payment_evidence_version:2});
 expect(decodeReceipt({...receipt(),provider_environment:'live'},tenant)).toMatchObject({provider_environment:'live'});
 const manual={...receipt(),provenance:'human_recorded',provider:null,method:'cash',provider_environment:null};
 expect(decodeReceipt(manual,tenant)).not.toBeNull();expect(decodeReceipt({...manual,provider_environment:'test'},tenant)).toBeNull();
 expect(decodeReceipt({...receipt(),provider_environment:['test']},tenant)).toBeNull();
});
it('retains original unversioned invoice/receipt compatibility without upgrading it to actual evidence',()=>{
 const old={...invoice(),manual_recorded_cents:2500,remaining_cents:7500};
 for(const key of ['provider_verified_cents','allocated_cents','payment_evidence_version','test_provider_verified_cents'] as const)delete (old as Partial<typeof old>)[key];
 expect(decodeInvoice(old,tenant)).toMatchObject({manual_recorded_cents:2500,remaining_cents:7500,allocated_cents:2500});
 const oldReceipt={...receipt()};delete (oldReceipt as Partial<typeof oldReceipt>).payment_evidence_version;delete (oldReceipt as Partial<typeof oldReceipt>).provider_environment;
 expect(decodeReceipt(oldReceipt,tenant)).not.toBeNull();
});
it('exports actual TEST context beside unchanged original financial columns',async()=>{
 f.reply.mockResolvedValueOnce({data:{...page([actualInvoice()]),financial_evidence_version:3},error:null});const csv=await exportRegister(tenant,'invoice');
 expect(csv).toContain('test_provider_verified_cents');expect(csv).toContain('payment_evidence_version');expect(csv).toContain('5000');
 f.reply.mockResolvedValueOnce({data:{...page([receipt()]),financial_evidence_version:3},error:null});const receipts=await exportRegister(tenant,'receipt');expect(receipts).toContain('provider_environment');expect(receipts).toContain('"test"');
});
it.each([undefined,2] as const)('returns no partial CSV when a current3 export encounters an older %s continuation',async after=>{
 const current={...page([actualInvoice()]),financial_evidence_version:3,has_more:true,next_cursor:{snapshot_id:id,after_position:1,entity:'invoice'}};
 const old={...page([{...invoice(),id:client}])};if(after===undefined)delete (old as Partial<typeof old>).payment_evidence_version;
 f.reply.mockResolvedValueOnce({data:current,error:null}).mockResolvedValueOnce({data:old,error:null});
 await expect(exportRegister(tenant,'invoice')).rejects.toThrow(/financial|representation/i);expect(f.calls).toHaveLength(2);
});

const actualSummary=(extra:Record<string,unknown>={})=>({schema_version:3,invoice_id:id,invoice_version:1,currency:'usd',standing:'recorded',outstanding_minor:9000,refund_payable_minor:1000,credit_minor:0,manual_recorded_minor:0,provider_confirmed_minor:10000,provider_net_minor:9000,test_provider_minor:5000,source_hash:'a'.repeat(64),...extra});
const actualInvoice=(extra:Record<string,unknown>={})=>({...invoice(),financial_evidence_version:3,financial_summary:actualSummary(),provider_verified_cents:10000,allocated_cents:10000,remaining_cents:9000,...extra});
it('copies native current debt after a refund without applying gross receipt arithmetic',()=>{
 const row=decodeInvoice(actualInvoice(),tenant);expect(row).toMatchObject({remaining_cents:9000,financial_evidence_version:3,financial:{outstanding_minor:9000,refund_payable_minor:1000}});
});
it('retains an unknown managed invoice while withholding debt and collection judgments',()=>{
 const summary=actualSummary({standing:'needs_review',outstanding_minor:null,refund_payable_minor:null,credit_minor:null,provider_net_minor:null});
 expect(decodeInvoice(actualInvoice({financial_summary:summary,remaining_cents:null,collection_required:null}),tenant)).toMatchObject({remaining_cents:null,collection_required:null,financial:{standing:'needs_review'}});
});
it.each([{financial_summary:actualSummary({invoice_id:client})},{financial_summary:actualSummary({invoice_version:2})},{remaining_cents:0},{collection_required:false},{financial_summary:actualSummary({outstanding_minor:null})}])('refuses mismatched current financial identity or collection truth: %j',change=>{
 expect(decodeInvoice(actualInvoice(change),tenant)).toBeNull();
});
it('cannot silently accept an unsupported current marker as an ordinary allocation row',()=>{
 expect(decodeInvoice({...invoice(),financial_evidence_version:4},tenant)).toBeNull();
});

it('a current-register caller refuses an older valid financial response instead of treating it as adjusted debt',async()=>{
 f.reply.mockResolvedValue({data:page(),error:null});await expect(readRegister(tenant,'invoice',null,decodeInvoice,true)).rejects.toThrow(/current financial evidence/i);
});
it('a current-register caller explicitly negotiates native3 and retains its closed current summary',async()=>{
 f.reply.mockResolvedValue({data:{...page([actualInvoice()]),financial_evidence_version:3},error:null});expect((await readRegister(tenant,'invoice',null,decodeInvoice,true)).rows[0]).toMatchObject({remaining_cents:9000,financial:{refund_payable_minor:1000}});expect(f.calls[0].headers).toEqual({'x-paige-invoice-evidence-version':'3'});
});

it.each([5000,15000])('rejects a gross history total %i that contradicts the explicit receipt split',allocated_cents=>{expect(decodeInvoice(actualInvoice({allocated_cents}),tenant)).toBeNull();});
it('retains gross receipt history above principal when native adjusted debt supports it',()=>{const financial_summary=actualSummary({provider_confirmed_minor:15000,provider_net_minor:14000});expect(decodeInvoice(actualInvoice({provider_verified_cents:15000,allocated_cents:15000,financial_summary}),tenant)).toMatchObject({allocated_cents:15000,remaining_cents:9000});});
