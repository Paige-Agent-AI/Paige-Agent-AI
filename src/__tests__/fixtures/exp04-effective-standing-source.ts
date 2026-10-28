import raw from './exp04-client-status-source.json';
import type {ClientEngagementSource} from '../../../supabase/functions/_shared/client-engagement/status';

// Native-shaped synthetic projection only. Actual provenance, roles, signing,
// payment and customer acceptance require their separate native/runtime proof.
export function effectiveStandingFixture(){
 const source=structuredClone(raw) as ClientEngagementSource;
 const t=source.terms[0],invoice=source.invoices.find(i=>i.invoice_number==='E4-0001')!;
 const accepted={schema_version:1,state:'verified',tenant_id:source.tenant_id,client_id:source.contact_id,
  commercial_terms_id:t.id,offer_id:t.offer_id,working_terms_version:2,terms_version:1,
  signing_id:source.signings[0].id,signing_version:1,completed_at:source.signings[0].completed_at!,
  document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64),effectuated_at:'2026-09-02T11:00:00Z',
  operation_id:'e4000000-0000-4000-8000-000000070001',receipt_id:'e4000000-0000-4000-8000-000000070002',
  source_digest:'c'.repeat(64),invoice_id:invoice.id,principal_minor:t.agreed_amount_minor!,currency:t.agreed_currency!,
  collection_terms:structuredClone(t.collection_terms),engagement:{starts_on:t.starts_on!,ends_on:t.ends_on,price_basis:'negotiated'},working_differs:true};
 t.collection_terms_version=2;
 const terms=t.collection_terms as {anchor_date:string;dates:{due_date:string}[]};
 terms.anchor_date='2028-09-03';terms.dates.forEach(r=>{r.due_date=r.due_date.replace(/^2026/,'2028').replace(/^2027/,'2029');});
 Object.assign(t,{effective_terms:accepted});
 return {source,t,invoice,accepted};
}
