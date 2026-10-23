// Local proof input only. Run with the actual Edge Deno runtime and original
// renderer, then retain the single output. Never imported by product code.
import {readFile} from 'node:fs/promises';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';
import {renderPresentedPdf} from '../../supabase/functions/_shared/agreements/document.ts';
import {inspectAgreementPreparationPdf} from '../../supabase/functions/_shared/agreements/document-preparation.ts';
import {sha256Hex} from '../../supabase/functions/_shared/agreements/token.ts';

const fixture=JSON.parse(await readFile(new URL('../../src/solo/sales/fixtures/agreement-document-source.json',import.meta.url),'utf8'));
const s=fixture.source,schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-22',installment_cents:30000,first_installment_date:'2026-11-22',cadence:'monthly'});
if(schedule.state!=='ready')throw Error('Original controlled schedule is unavailable');
const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'};
const input={schema_version:2,engagement:{starts_on:'2026-10-22',ends_on:null,price_basis:'negotiated'},source:{tenant_id:s.tenant_id,client_id:s.client_id,agreement_id:s.agreement_id,agreement_version:s.version,agreement_updated_at:s.updated_at,
  offer_id:'55555555-0000-4000-8000-000000000001',body_source:'paige_draft',status:'draft',content_sha256:null,terms_id:'66666666-0000-4000-8000-000000000001',terms_version:1,terms_updated_at:s.updated_at,invoice_id:'77777777-0000-4000-8000-000000000001',invoice_version:1,invoice_draft_version:1,invoice_updated_at:s.updated_at},
  title:'Controlled commercial services agreement',body_markdown:'Neutral source for document preparation. No legal sufficiency, signature, delivery or payment claim.',principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions:{schema_version:1,tax:treatment,fees:treatment},lines:[{unit_minor:350000,quantity:1}]};
const presentation=await prepareCommercialPresentation(input),words=commercialPresentationText(input.body_markdown,presentation);
const bytes=await renderPresentedPdf({title:input.title,bodyMarkdown:words}),document=await inspectAgreementPreparationPdf(bytes,await sha256Hex(bytes));
console.log(JSON.stringify({...fixture,input,bytes:Buffer.from(bytes).toString('base64'),document,presentation,presented_body_markdown:words}));
