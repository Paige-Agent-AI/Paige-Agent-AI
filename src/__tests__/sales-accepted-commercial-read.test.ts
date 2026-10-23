// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model';
import {readAcceptedCommercialAgreement} from '../../supabase/functions/_shared/agreements/accepted-commercial-read';


const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const tenant=id(1),client=id(2),offer=id(3),agreement=id(4),terms=id(5),invoice=id(6),receipt=id(7);
const treatment={state:'not_applicable',charges:[],source:'Synthetic recorded decision',policy:'No additional charge'};
const conditions={schema_version:1,tax:treatment,fees:treatment};
async function retained(){
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Synthetic schedule unavailable');
 const body='Synthetic retained service agreement.';
 const presentation=await prepareCommercialPresentation({schema_version:1,source:{tenant_id:tenant,client_id:client,offer_id:offer,agreement_id:agreement,agreement_version:4,agreement_updated_at:'2026-10-14T18:00:00Z',body_source:'tenant_template',status:'draft',content_sha256:null,terms_id:terms,terms_version:3,terms_updated_at:'2026-10-14T18:00:00Z',invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:'2026-10-14T18:00:00Z'},title:'Synthetic agreement',body_markdown:body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions,lines:[{unit_minor:350000,quantity:1}]});
 return {schema_version:1,state:'recorded',tenant_id:tenant,invoice_id:invoice,agreement_id:agreement,receipt_id:receipt,completed_at:'2026-10-15T00:00:00Z',payload:presentation.payload,payload_digest:presentation.payload_digest,body_markdown:body,presented_body_markdown:commercialPresentationText(body,presentation),document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
}
const read=async(data:unknown)=>readAcceptedCommercialAgreement(tenant,{invoice_id:invoice,agreement_id:agreement},{rpc:async()=>({data,error:null})});
it('preserves the current schema2 engagement and exact reviewed appendix',async()=>{
 const data=await retained(),p=data.payload;
 const presentation=await prepareCommercialPresentation({schema_version:2,engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'},
  source:p.source,title:p.title,body_markdown:data.body_markdown,principal_minor:p.principal_minor,currency:p.currency,
  collection_terms:p.collection_terms,conditions:p.conditions,lines:p.lines});
 const current={...data,payload:presentation.payload,payload_digest:presentation.payload_digest,
  presented_body_markdown:commercialPresentationText(data.body_markdown,presentation)};
 expect(await read(current)).toMatchObject({state:'recorded',presentation:{payload:{schema_version:2,
  engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'},principal_minor:350000}}});
});
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


