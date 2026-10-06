import {describe,it,expect,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
import {decodeInvoice,decodeReceipt,decodeRegister,escapeCsv,exportRegister} from './api';
import {supabase} from '@/integrations/supabase/client';
import {parseCsv,decodeImportBatch} from './importModel';
import {collectionMoney,minorInput} from './presentation';
const tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',client='33333333-3333-4333-8333-333333333333',time='2026-10-04T12:00:00Z';
const invoice={id,tenant_id:tenant,client_id:client,client_name:'Example client',invoice_number:'IMPORTED-1',source_invoice_number:'SOURCE-1',status:'recorded',version:1,amount_cents:10000,currency:'usd',due_date:'2026-10-09',created_at:time,manual_recorded_cents:2500,remaining_cents:7500,receipt_count:1,record_kind:'imported',provenance:'owner_imported_unverified'};
const page={rows:[invoice],has_more:false,next_cursor:null,snapshot_at:time,membership_captured_at:time,facts_read_at:time,export_completed_at:time,membership_count:1,balance_basis:'manual_recorded_only',membership_boundary:'canonical_ids_snapshot'};
describe('Collections truth decoder',()=>{
 it('reads canonical mixed allocations without upgrading manual receipts',()=>{
  const mixed={...invoice,manual_recorded_cents:2500,provider_verified_cents:5000,remaining_cents:2500};
  expect(decodeInvoice(mixed,tenant)).toEqual(expect.objectContaining({manual_recorded_cents:2500,provider_verified_cents:5000,allocated_cents:7500,remaining_cents:2500}));
  expect(decodeRegister({...page,rows:[mixed],balance_basis:'canonical_receipt_allocations'},tenant,'invoice',decodeInvoice)?.rows).toHaveLength(1);
 });
 it('refuses inconsistent, incomplete and overallocated provider facts',()=>{
  const mixed={...invoice,provider_verified_cents:5000,remaining_cents:2500};
  for(const patch of [{remaining_cents:7500},{provider_verified_cents:-1},{provider_verified_cents:10000},{allocated_cents:5000}])expect(decodeInvoice({...mixed,...patch},tenant)).toBeNull();
  expect(decodeRegister({...page,balance_basis:'canonical_receipt_allocations'},tenant,'invoice',decodeInvoice)).toBeNull();
 });
 it('keeps provider-confirmed receipts distinct and refuses contradictory provenance',()=>{
  const receipt={id,tenant_id:tenant,invoice_id:id,client_id:client,client_name:null,invoice_number:'I-1',source_invoice_number:null,kind:'receipt',amount_cents:5000,currency:'usd',method:'stripe',received_at:time,created_at:time,reference:null,notes:null,reason:null,actor_user_id:client,reverses_payment_id:null,provenance:'provider_verified',provider:'stripe'};
  expect(decodeReceipt(receipt,tenant)?.provenance).toBe('provider_verified');
  for(const patch of [{provider:'paypal'},{provider:null},{kind:'reversal'},{reverses_payment_id:client},{provenance:'human_recorded'}])expect(decodeReceipt({...receipt,...patch},tenant)).toBeNull();
 });
 it('keeps imported recorded obligations separate from issued managed invoices',()=>{expect(decodeInvoice(invoice,tenant)?.record_kind).toBe('imported');expect(decodeInvoice({...invoice,provenance:'canonical_record'},tenant)).toBeNull()});
 it('rejects cross-workspace and inconsistent or negative balance projections',()=>{expect(decodeInvoice(invoice,client)).toBeNull();expect(decodeInvoice({...invoice,remaining_cents:10000},tenant)).toBeNull();expect(decodeInvoice({...invoice,manual_recorded_cents:-1},tenant)).toBeNull()});
 it('requires canonical stable ID-membership cursors and truthful pagination',()=>{expect(decodeRegister(page,tenant,'invoice',decodeInvoice)?.rows).toHaveLength(1);expect(decodeRegister({...page,has_more:true},tenant,'invoice',decodeInvoice)).toBeNull();expect(decodeRegister({...page,has_more:true,next_cursor:{snapshot_id:id,after_position:50,entity:'receipt'}},tenant,'invoice',decodeInvoice)).toBeNull();expect(decodeRegister({...page,has_more:true,next_cursor:{snapshot_id:id,after_position:50,entity:'invoice'}},tenant,'invoice',decodeInvoice)?.has_more).toBe(true)});
 it('refuses foreign receipt actor or malformed reversal pointers',()=>{const receipt={id,tenant_id:tenant,invoice_id:id,client_id:client,client_name:'Example client',invoice_number:'I-1',source_invoice_number:null,kind:'receipt',amount_cents:2500,currency:'usd',method:'cash',received_at:time,created_at:time,reference:null,notes:null,reason:null,actor_user_id:client,reverses_payment_id:null,provenance:'human_recorded'};expect(decodeReceipt(receipt,tenant)).not.toBeNull();expect(decodeReceipt({...receipt,tenant_id:client},tenant)).toBeNull();expect(decodeReceipt({...receipt,reverses_payment_id:'bad-id'},tenant)).toBeNull()});
});
describe('CSV import/export boundary',()=>{
 it('exports separate canonical allocation amounts and provider receipt evidence',async()=>{
  const rpc=vi.mocked(supabase.rpc);rpc.mockReset();rpc.mockResolvedValueOnce({data:{...page,balance_basis:'canonical_receipt_allocations',rows:[{...invoice,provider_verified_cents:5000,remaining_cents:2500}]},error:null} as never);
  const csv=await exportRegister(tenant,'invoice');expect(csv).toContain('provider_verified_cents');expect(csv).toContain('allocated_cents');expect(csv).toContain('"2500","5000","7500","2500"');
 });
 it('exports every canonical membership page with readable source references and refuses cursor duplicates',async()=>{const rpc=vi.mocked(supabase.rpc);rpc.mockReset();const cursor={snapshot_id:id,after_position:1,entity:'invoice'};rpc.mockResolvedValueOnce({data:{...page,has_more:true,next_cursor:cursor},error:null} as never).mockResolvedValueOnce({data:{...page,rows:[{...invoice,id:client,invoice_number:'IMPORTED-2',source_invoice_number:'SOURCE-2'}],membership_count:2},error:null} as never);const csv=await exportRegister(tenant,'invoice');expect(csv).toContain('SOURCE-1');expect(csv).toContain('SOURCE-2');expect(csv).toContain('Example client');expect(rpc.mock.calls[1][1]).toEqual(expect.objectContaining({_cursor:cursor}));rpc.mockReset();rpc.mockResolvedValueOnce({data:{...page,has_more:true,next_cursor:cursor},error:null} as never).mockResolvedValueOnce({data:page,error:null} as never);await expect(exportRegister(tenant,'invoice')).rejects.toThrow('cursor repeated')});
 it('preserves JPY zero-decimal and BHD three-decimal units without rounding inputs',()=>{expect(collectionMoney(1234,'jpy')).toContain('1,234');expect(minorInput('1234','jpy')).toBe(1234);expect(minorInput('12.34','jpy')).toBeNull();expect(collectionMoney(1234,'bhd')).toContain('1.234');expect(minorInput('1.234','bhd')).toBe(1234);expect(minorInput('1.2345','bhd')).toBeNull();expect(minorInput('1','zzz')).toBeNull()});
 it('preserves multiline quoted descriptions and escaped quotes',()=>{expect(parseCsv('a,b\r\n1,"line one\nline ""two"""')).toEqual([['a','b'],['1','line one\nline "two"']])});
 it('rejects unclosed quotes, unequal columns and unbounded payload',()=>{expect(()=>parseCsv('a,b\n1,"bad')).toThrow();expect(()=>parseCsv('a,b\n1')).toThrow();expect(()=>parseCsv('a,b\n'+'x'.repeat(250001))).toThrow()});
 it('neutralizes spreadsheet formula prefixes including whitespace',()=>{expect(escapeCsv(' =HYPERLINK("x")')).toBe('"\' =HYPERLINK(""x"")"');expect(escapeCsv('ordinary')).toBe('"ordinary"')});
 it('requires staged review provenance before showing commit',()=>{expect(decodeImportBatch({id,content_digest:'a'.repeat(64),state:'staged',review:{rows:[],conflicts:[],eligible_commit:true,provenance:'owner_imported_unverified'}})).not.toBeNull();expect(decodeImportBatch({id,content_digest:'a'.repeat(64),state:'staged',review:{rows:[],conflicts:[],eligible_commit:true,provenance:'verified'}})).toBeNull()});
});
