// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {e04CommercialFixture,e04Id} from '../test/fixtures/e04-commercial-presentation';
import {readRetainedCommercialAgreement} from '../../supabase/functions/_shared/agreements/retained-commercial-read';
async function setup(){
 const f=await e04CommercialFixture();
 const preparation={ok:true,outcome:'agreement_prepared',historical_receipt:true,receipt_id:e04Id(8),row:{id:f.agreement,tenant_id:f.tenant,version_at_preparation:4,
  invoice_id:f.invoice,invoice_version:1,invoice_draft_version:2,terms_id:f.terms,terms_version:3,client_id:f.client,offer_id:f.offer,payload_digest:f.command.payload_digest,
  document_sha256:'a'.repeat(64),prepared_at:'2026-10-15T00:00:00Z',actor_user_id:e04Id(9)},operation:{id:f.operation,action:f.command.action}};
 const data={schema_version:1,state:'retained',tenant_id:f.tenant,invoice_id:f.invoice,agreement_id:f.agreement,receipt_id:e04Id(10),current_status:'draft',
  payload:f.proposed.presentation.payload,payload_digest:f.command.payload_digest,body_markdown:f.rows.paige_agreements.body_markdown,presented_body_markdown:f.proposed.presented_body_markdown,document_sha256:'a'.repeat(64),preparation};
 const read=(value:unknown=data)=>readRetainedCommercialAgreement(f.tenant,{invoice_id:f.invoice,agreement_id:f.agreement},{rpc:async()=>({data:value,error:null})});
 return {...f,data,read};
}
it('uses only the exact owner RPC and preserves actual preparation separately from signing',async()=>{
 const f=await setup(),rpc=vi.fn().mockResolvedValue({data:f.data,error:null});
 const result=await readRetainedCommercialAgreement(f.tenant,{invoice_id:f.invoice,agreement_id:f.agreement},{rpc});
 expect(rpc).toHaveBeenCalledExactlyOnceWith('read_sales_prepared_agreement',{_expected_tenant_id:f.tenant,_invoice_id:f.invoice,_agreement_id:f.agreement});
 expect(result).toMatchObject({state:'retained',current_status:'draft',preparation:f.data.preparation,presentation:{payload:{schema_version:2,engagement:{starts_on:'2026-11-01'}}}});
 expect(JSON.stringify(result)).not.toMatch(/token_hash|storage_key|signed_at|delivered_at/);
});
it.each(['tenant','invoice','agreement','body','presented','digest','document_receipt','authority','private_extra'])('refuses retained %s without partial text',async kind=>{
 const f=await setup(),r=structuredClone(f.data) as Record<string,unknown>;
 if(kind==='tenant')r.tenant_id=e04Id(99);if(kind==='invoice')r.invoice_id=e04Id(99);if(kind==='agreement')r.agreement_id=e04Id(99);
 if(kind==='body')r.body_markdown='Different original';if(kind==='presented')r.presented_body_markdown='Different displayed body';if(kind==='digest')r.payload_digest='b'.repeat(64);
 if(kind==='document_receipt')r.document_sha256='b'.repeat(64);if(kind==='authority')r.approved=true;if(kind==='private_extra')r.storage_key='private/object';
 expect(await f.read(r)).toEqual({state:'refused'});
});
it('retains a known document with an explicitly unverified preparation receipt and unknown current status',async()=>{
 const f=await setup(),r={...f.data,preparation:null,current_status:'future_engine_value'};
 expect(await f.read(r)).toMatchObject({state:'retained',preparation:null,current_status:'unrecognised'});
});
it('does not replace missing retained evidence with mutable current terms',async()=>{
 const f=await setup(),r={schema_version:1,state:'unverified',tenant_id:f.tenant,invoice_id:f.invoice,agreement_id:f.agreement,receipt_id:e04Id(10)};
 expect(await f.read(r)).toEqual({state:'unverified'});expect(await f.read({...r,body_markdown:'Not supported'})).toEqual({state:'refused'});
});
it('does not contact the owner RPC with forged selectors or approval',async()=>{
 const f=await setup(),rpc=vi.fn();expect(await readRetainedCommercialAgreement(f.tenant,{invoice_id:f.invoice,agreement_id:f.agreement,approved:true},{rpc})).toEqual({state:'refused'});expect(rpc).not.toHaveBeenCalled();
});
