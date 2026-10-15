// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model';
import {readAcceptedCommercialAgreement} from '../../supabase/functions/_shared/agreements/accepted-commercial-read';
import {readCommercialPackage} from '../../supabase/functions/_shared/sales-commercial/package-projection';

const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenant=id(1),client=id(2),offer=id(3),agreement=id(4),terms=id(5),invoice=id(6),receipt=id(7);
const treatment={state:'not_applicable',charges:[],source:'Synthetic recorded decision',policy:'No additional charge'};
const conditions={schema_version:1,tax:treatment,fees:treatment};
async function retained(schemaVersion:1|2=1){
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Synthetic schedule unavailable');
 const body='Synthetic retained service agreement.';
 const presentation=await prepareCommercialPresentation({schema_version:schemaVersion,...(schemaVersion===2?{engagement:{starts_on:"2026-10-01",ends_on:null,price_basis:"negotiated"}}:{}),source:{tenant_id:tenant,client_id:client,offer_id:offer,agreement_id:agreement,agreement_version:4,agreement_updated_at:'2026-10-14T18:00:00Z',body_source:'tenant_template',status:'draft',content_sha256:null,terms_id:terms,terms_version:3,terms_updated_at:'2026-10-14T18:00:00Z',invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:'2026-10-14T18:00:00Z'},title:'Synthetic agreement',body_markdown:body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions,lines:[{unit_minor:350000,quantity:1}]});
 return {schema_version:1,state:'recorded',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:receipt,completed_at:'2026-10-15T00:00:00Z',payload:presentation.payload,payload_digest:presentation.payload_digest,body_markdown:body,presented_body_markdown:commercialPresentationText(body,presentation),document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
}
const read=async(data:unknown)=>readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement},{rpc:async()=>({data,error:null})});
it('reads exact retained economics through only the owner RPC without deriving them from current terms',async()=>{
 const data=await retained(),rpc=vi.fn().mockResolvedValue({data,error:null});
 const result=await readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement},{rpc});
 expect(rpc).toHaveBeenCalledExactlyOnceWith('read_sales_accepted_agreement',{_expected_tenant_id:tenant,_invoice_id:invoice,_agreement_id:agreement});
 expect(result).toMatchObject({state:'recorded',completed_at:data.completed_at,receipt_id:receipt,presentation:{payload:{principal_minor:350000,source:{terms_version:3}}},presented_body_markdown:data.presented_body_markdown});
 expect(JSON.stringify(result)).not.toMatch(/storage_key|token|approved|effective_at/);
});
it('keeps historical absent evidence unverified and rejects added legal text in that state',async()=>{
 const data={schema_version:1,state:'unverified',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:receipt};
 expect(await read(data)).toEqual({state:'unverified'});expect(await read({...data,body_markdown:'Not supported'})).toEqual({state:'refused'});
});
it.each(['tenant','invoice','agreement','principal','obligation','conditions','body','presented_body','digest','sealed_digest','missing_receipt','authority','payload_extra','source_version'])('refuses tampered retained %s without showing partial text',async kind=>{
 const data:Record<string,unknown>=structuredClone(await retained()),p=data.payload as Record<string,unknown>;
 if(kind==='tenant')data.tenant_id=id(99);
 if(kind==='invoice')data.invoice_id=id(99);
 if(kind==='agreement')data.agreement_id=id(99);
 if(kind==='principal')p.principal_minor=350001;
 if(kind==='obligation')(p.obligations as Array<Record<string,unknown>>)[1].amount_cents=30001;
 if(kind==='conditions')(p.conditions as Record<string,unknown>).tax={state:'unknown',charges:[],source:null,policy:null};
 if(kind==='body')data.body_markdown='Rewritten retained text';
 if(kind==='presented_body')data.presented_body_markdown='Rewritten appendix';
 if(kind==='digest')data.payload_digest='c'.repeat(64);
 if(kind==='sealed_digest')data.sealed_sha256='';
 if(kind==='missing_receipt')data.receipt_id=null;
 if(kind==='authority')data.approved=true;
 if(kind==='payload_extra')p.approved=true;
 if(kind==='source_version')(p.source as Record<string,unknown>).terms_version=4;
 expect(await read(data)).toEqual({state:'refused'});
});
it('rejects an added approval input before contacting the owner read',async()=>{
 const rpc=vi.fn();expect(await readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement,approved:true},{rpc})).toEqual({state:'refused'});expect(rpc).not.toHaveBeenCalled();
});
it('withholds confirmation on server refusal or transport failure',async()=>{
 expect(await readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement},{rpc:async()=>({data:await retained(),error:{message:'private detail'}})})).toEqual({state:'refused'});
 expect(await readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement},{rpc:async()=>{throw Error('private detail');}})).toEqual({state:'refused'});
});

async function packageFixture(){
 const r=await retained(),p=r.payload;
 return {schema_version:1,tenant_id:tenant,receipt_id:receipt,state:'needs_input',authority:'not_evaluated',execution:'not_started',missing_fields:[],conflicts:[],
  invoice:{id:invoice,client_id:client,status:'issued',version:2,draft_version:1,issued_snapshot_version:1,obligation_total_minor:350000,due_now_minor:50000,remaining_scheduled_minor:300000,currency:'usd',receivable_total_minor:350000,allocated_minor:50000,manual_recorded_minor:0,provider_verified_minor:50000,outstanding_minor:300000,due_date:'2026-10-15',delivery_channels:['email']},
  offers:[],agreement:{id:agreement,version:4,status:'completed',body_source:'tenant_template',commercial_terms_id:terms,document_available:true,treatment:'include_existing_signed_document'},
  commercial_terms:{id:terms,version:3,updated_at:'2026-10-14T18:00:00Z',status:'draft',offer_id:offer,amount_minor:350000,currency:'usd',record_owner:'commercial_collection_terms',schedule:null},commercial_conditions:conditions,
  compatibility:{basis:'canonical_relationship_and_invoice_source_version',signed_economics:'recorded_immutable_presentation'},
  accepted_commercial_terms:{schema_version:1,basis:'completed_immutable_presentation',agreement_id:agreement,agreement_version:4,completed_at:r.completed_at,commercial_terms_id:terms,commercial_terms_version:3,invoice_id:invoice,invoice_draft_version:1,principal_minor:350000,currency:'usd',obligations:structuredClone(p.obligations),conditions}};
}
const packageRead=async(data:unknown)=>(await readCommercialPackage(tenant,{invoice_id:invoice},{rpc:async()=>({data,error:null})})).content;
it('extends the same bounded package with accepted principal and dates, preserving current balances and no execution authority',async()=>{
 const data=await packageFixture();expect(await packageRead(data)).toMatchObject({success:true,accepted_commercial_terms:{principal_minor:350000,commercial_terms_version:3},invoice:{outstanding_minor:300000},authority:'not_evaluated',execution:'not_started'});
});
it('shows changed current terms as a conflict while retaining original accepted amounts',async()=>{
 const data=await packageFixture();data.state='conflict';data.conflicts=['accepted_commercial_terms_changed'];data.commercial_terms.version=4;data.commercial_terms.amount_minor=999900;
 expect(await packageRead(data)).toMatchObject({success:true,commercial_terms:{amount_minor:999900,version:4},accepted_commercial_terms:{principal_minor:350000,commercial_terms_version:3},schedule_preview:null});
 data.conflicts=[];expect((await packageRead(data)).success).toBe(false);
});
it.each(['identity','amount','rows','leak','unsigned','invented_compatibility','invoice_revision','terms_revision'])('rejects inconsistent or unbounded accepted projection %s',async kind=>{
 const data=await packageFixture(),a=data.accepted_commercial_terms as Record<string,unknown>;
 if(kind==='identity')a.agreement_id=id(99);
 if(kind==='amount')a.principal_minor=350001;
 if(kind==='rows')(a.obligations as Array<Record<string,unknown>>)[0].paid=true;
 if(kind==='leak')a.content_storage_key='private-marker';
 if(kind==='unsigned')data.agreement.status='draft';
 if(kind==='invented_compatibility')data.compatibility.signed_economics='compatible';
 if(kind==='invoice_revision')data.invoice.draft_version=2;
 if(kind==='terms_revision')data.commercial_terms.version=4;
 expect((await packageRead(data)).success).toBe(false);
});

it('reads retained v2 service facts without borrowing the later mutable source',async()=>{
 const data=await retained(2),result=await read(data);
 expect(result).toMatchObject({state:'recorded',presentation:{payload:{schema_version:2,engagement:{starts_on:'2026-10-01',ends_on:null,price_basis:'negotiated'}}}});
 if(result.state==='recorded')expect(result.presented_body_markdown).toContain('Service starts: 2026-10-01');
 const changed=structuredClone(data);(changed.payload.engagement as {starts_on:string}).starts_on='2026-10-02';
 expect(await read(changed)).toEqual({state:'refused'});
});
