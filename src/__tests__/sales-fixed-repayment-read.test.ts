import {describe,it,expect,vi} from 'vitest';
import {dispatchSalesCollectionsChat} from '../../supabase/functions/_shared/sales-collections-chat';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model';
const tenant='20000000-0000-0000-0000-000000000001',agreement='40000000-0000-0000-0000-000000000001',client='30000000-0000-0000-0000-000000000001',offer='50000000-0000-0000-0000-000000000001',receipt='90000000-0000-0000-0000-000000000001';
const row=()=>({id:agreement,tenant_id:tenant,client_id:client,offer_id:offer,title:'Synthetic terms',title_truncated:false,client_name:'Synthetic client',client_name_truncated:false,status:'draft',agreed_amount_minor:350000,agreed_currency:'usd',collection_terms:null,collection_terms_version:0,terms_current:false});
const intent={agreement_id:agreement,deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-01',cadence:'monthly'};
function harness(source:unknown[]= [row()]){const rpc=vi.fn().mockResolvedValue({data:{tenant_id:tenant,receipt_id:receipt,rows:source,has_more:false,next_cursor:null},error:null}),invoke=vi.fn(),from=vi.fn();return {rpc,invoke,from,deps:{caller:{rpc,functions:{invoke}},admin:{from}}};}
const read=(args:Record<string,unknown>,h= harness())=>dispatchSalesCollectionsChat({tenantId:tenant,userId:'test-actor',toolName:'read_sales_collections',args,approved:new Set(),sameToolCalls:1,turn:{thread_id:null,user_turn_ordinal:1,user_turn:'Preview repayment'}},h.deps as never);
describe('canonical fixed repayment read through existing Collections',()=>{
 it('calculates350000/50000/ten30000 from authenticated commercial facts without writing or granting authority',async()=>{
  const h=harness(),r=(await read({entity:'agreement',fixed_repayment:intent},h)).content;
  expect(r).toMatchObject({success:true,receipt_id:receipt,repayment_preview:{state:'ready_for_review',basis:'principal_only',source:{commercial_terms_id:agreement,client_id:client,offer_id:offer,collection_terms_version:0},total_cents:350000,currency:'usd',deposit_cents:50000,remaining_after_deposit_cents:300000,installment_count:10,authority:'not_evaluated',execution:'not_started'}});
  const p=r.repayment_preview as {rows:{amount_cents:number;due_date:string}[]};
  expect(p.rows.map(x=>x.amount_cents)).toEqual([50000,...Array(10).fill(30000)]);expect(p.rows[10].due_date).toBe('2027-08-01');
  expect(p).not.toHaveProperty('terms');expect(p).not.toHaveProperty('balance');expect(p).not.toHaveProperty('late_fee');expect(h.from).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();
 });
 it('asks only for the missing repayment start date without guessing one',async()=>{
  const {first_installment_date,...partial}=intent;
  expect((await read({entity:'agreement',fixed_repayment:partial})).content).toMatchObject({success:true,repayment_preview:{state:'needs_input',fields:['first_installment_date']}});
 });
 it.each([{total_cents:1},{currency:'eur'},{approved:true},{agreement_id:'named client'},{cadence:'annual'},{deposit_date:'2026-02-30'}])('refuses injected or malformed preview input %j before reading',async change=>{
  const h=harness();expect((await read({entity:'agreement',fixed_repayment:{...intent,...change}},h)).content.success).toBe(false);expect(h.rpc).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();
 });
 it('requires exact reference in the bounded page instead of name matching or broadening the read',async()=>{
  const h=harness([{...row(),id:offer}]);expect((await read({entity:'agreement',fixed_repayment:intent},h)).content).toMatchObject({success:true,repayment_preview:{state:'needs_input',fields:['commercial_terms_reference_in_read_page']}});expect(h.rpc).toHaveBeenCalledOnce();
 });
 it('refuses foreign source and duplicate exact candidates',async()=>{
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...row(),tenant_id:offer}]))).content.success).toBe(false);
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([row(),row()]))).content.success).toBe(false);
 });
 it.each(['paused','cancelled','completed'])('does not propose a new plan against%s terms',async status=>{
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...row(),status}]))).content).toMatchObject({success:true,repayment_preview:{state:'refused',code:'COMMERCIAL_TERMS_INACTIVE'}});
 });
 it('does not use principal preview on invoice or receipt reads',async()=>{
  const h=harness();expect((await read({entity:'invoice',fixed_repayment:intent},h)).content.success).toBe(false);expect(h.rpc).not.toHaveBeenCalled();
 });
 it('preserves stale terms and rejects a competing recorded schedule',async()=>{
  const assembled=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',...Object.fromEntries(Object.entries(intent).filter(([key])=>key!=='agreement_id'))});
  if(assembled.state!=='ready')throw Error('fixture');
  const saved={...row(),collection_terms:assembled.terms,collection_terms_version:1,terms_current:true};
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([saved]))).content).toMatchObject({repayment_preview:{state:'ready_for_review',source:{collection_terms_version:1}}});
  expect((await read({entity:'agreement',fixed_repayment:{...intent,installment_cents:40000}},harness([saved]))).content).toMatchObject({repayment_preview:{state:'conflict',code:'RECORDED_SCHEDULE_DIFFERS'}});
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...saved,agreed_amount_minor:360000,terms_current:false}]))).content).toMatchObject({repayment_preview:{state:'conflict',code:'RECORDED_TERMS_STALE'}});
 });
 it('does not convert an existing subscription into finite installments',async()=>{
  const saved={...row(),collection_terms:{schema_version:1,kind:'recurring',currency:'usd',total_cents:350000,anchor_date:'2026-11-01',cadence:'monthly',count:10},collection_terms_version:1,terms_current:true};
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([saved]))).content).toMatchObject({repayment_preview:{state:'conflict',code:'RECORDED_SCHEDULE_DIFFERS'}});
 });
 it('asks for missing canonical economics rather than accepting model amounts',async()=>{
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...row(),agreed_amount_minor:null,agreed_currency:null}]))).content).toMatchObject({repayment_preview:{state:'needs_input',fields:['total_cents','currency']}});
 });
 it('does not conceal an unresolved canonical offer',async()=>{
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...row(),offer_id:null}]))).content).toMatchObject({repayment_preview:{state:'needs_input',fields:['canonical_offer']}});
 });
 it('preserves exact currency minor units and a smaller final installment',async()=>{
  const r=(await read({entity:'agreement',fixed_repayment:{...intent,deposit_cents:500,installment_cents:300}},harness([{...row(),agreed_amount_minor:3501,agreed_currency:'jpy'}]))).content;
  const p=r.repayment_preview as {rows:{amount_cents:number;currency:string}[]};
  expect(p.rows.map(x=>x.amount_cents)).toEqual([500,...Array(10).fill(300),1]);expect(p.rows.every(x=>x.currency==='jpy')).toBe(true);
 });
 it('does not infer the deposit due date or allow zero total',async()=>{
  const {deposit_date,...partial}=intent;
  expect((await read({entity:'agreement',fixed_repayment:partial})).content).toMatchObject({repayment_preview:{state:'needs_input',fields:['deposit_date']}});
  expect((await read({entity:'agreement',fixed_repayment:intent},harness([{...row(),agreed_amount_minor:0}]))).content).toMatchObject({repayment_preview:{state:'refused',code:'INVALID_REPAYMENT_INPUT'}});
 });
});
