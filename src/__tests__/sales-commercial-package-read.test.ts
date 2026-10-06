import {describe,it,expect,vi} from 'vitest';
import {readCommercialPackage,SALES_COMMERCIAL_PACKAGE_SPINE} from '../../supabase/functions/_shared/sales-commercial/package-read';
const tenant='20000000-0000-0000-0000-000000000001',invoice='60000000-0000-0000-0000-000000000001';
const fixture=()=>({schema_version:1,tenant_id:tenant,receipt_id:'90000000-0000-0000-0000-000000000001',state:'needs_input',authority:'not_evaluated',execution:'not_started',missing_fields:['tax_and_fee_treatment'],conflicts:[],
 invoice:{id:invoice,client_id:'30000000-0000-0000-0000-000000000001',status:'issued',version:2,draft_version:1,issued_snapshot_version:1,obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,currency:'usd',receivable_total_minor:350000,allocated_minor:50000,manual_recorded_minor:0,provider_verified_minor:50000,outstanding_minor:300000,due_date:'2026-10-15',delivery_channels:['email']},offers:[],agreement:null,commercial_terms:null});
describe('canonical commercial package caller-JWT read',()=>{
 it('calls only the authenticated reader with exact tenant/invoice',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:fixture(),error:null});
  expect((await readCommercialPackage(tenant,{invoice_id:invoice},{rpc})).content).toMatchObject({success:true,authority:'not_evaluated',execution:'not_started'});
  expect(rpc).toHaveBeenCalledExactlyOnceWith('read_sales_commercial_package',{_expected_tenant_id:tenant,_invoice_id:invoice});
 });
 it('preserves distinct signed and commercial records with an explicit finite schedule',async()=>{
  const data:Record<string,unknown>=fixture();
  data.agreement={id:'70000000-0000-0000-0000-000000000001',version:2,status:'completed',body_source:'tenant_upload',commercial_terms_id:'40000000-0000-0000-0000-000000000001',document_available:true,treatment:'include_existing_signed_document'};
  data.commercial_terms={id:'40000000-0000-0000-0000-000000000001',version:3,updated_at:'2026-10-06T10:00:00Z',status:'active',offer_id:null,amount_minor:350000,currency:'usd',record_owner:'commercial_collection_terms',schedule:{kind:'custom',total_cents:350000,currency:'usd',cadence:'custom',anchor_date:'2026-10-15',count:2,end_date:null,deposit_cents:null,dates:[{due_date:'2026-10-15',amount_cents:50000},{due_date:'2026-11-01',amount_cents:300000}]}};
  const result=await readCommercialPackage(tenant,{invoice_id:invoice},{rpc:vi.fn().mockResolvedValue({data,error:null})});
  expect(result.content).toMatchObject({success:true,commercial_terms:{version:3},agreement:{version:2}});
  Object.assign((data.commercial_terms as Record<string,unknown>).schedule as object,{signing_token:'secret'});
  expect((await readCommercialPackage(tenant,{invoice_id:invoice},{rpc:vi.fn().mockResolvedValue({data,error:null})})).content.success).toBe(false);
 });
 it.each([{invoice_id:invoice,approved:true},{invoice_id:invoice,actor_id:'owner'},{invoice_id:'ambiguous name'},{}])('rejects noncanonical args without IO',async args=>{
  const rpc=vi.fn();expect((await readCommercialPackage(tenant,args,{rpc})).content.success).toBe(false);expect(rpc).not.toHaveBeenCalled();
 });
 it.each(['tenant','invoice','authority','receipt','root_secret','nested_secret','negative_balance'])('refuses %s source corruption',async kind=>{
  const data=fixture();if(kind==='tenant')data.tenant_id='20000000-0000-0000-0000-000000000002';
  if(kind==='invoice')data.invoice.id='60000000-0000-0000-0000-000000000002';if(kind==='authority')data.authority='approved';if(kind==='receipt')data.receipt_id='';
  if(kind==='root_secret')Object.assign(data,{signing_token:'secret'});if(kind==='nested_secret')Object.assign(data.invoice,{document:{token:'secret'}});if(kind==='negative_balance')data.invoice.outstanding_minor=-1;
  expect((await readCommercialPackage(tenant,{invoice_id:invoice},{rpc:vi.fn().mockResolvedValue({data,error:null})})).content.success).toBe(false);
 });
 it('redacts provider/database errors',async()=>{
  const rpc=vi.fn().mockRejectedValue(Error('private-secret-marker raw provider payload'));
  const result=await readCommercialPackage(tenant,{invoice_id:invoice},{rpc});expect(result.content.success).toBe(false);expect(JSON.stringify(result)).not.toContain('private-secret-marker');
 });
 it('declares the bound read without granting package authority',()=>{
  expect(SALES_COMMERCIAL_PACKAGE_SPINE.chatBinding).toBe('LIVE');expect(SALES_COMMERCIAL_PACKAGE_SPINE.action?.approvalAuthority).toBe('none');expect(SALES_COMMERCIAL_PACKAGE_SPINE.action?.chatTool).toBe('read_sales_commercial_package');
 });
});
