import { describe, expect, it } from 'vitest';
import { prepareCommercialPresentationFromRecords, readCommercialPresentationSource } from './commercial-presentation-read.ts';
import { assembleFixedRepaymentSchedule } from '../sales-collections/model.ts';

const tenant='aaaaaaaa-0000-4000-8000-000000000001';
const client='bbbbbbbb-0000-4000-8000-000000000001';
const agreement='cccccccc-0000-4000-8000-000000000001';
const invoice='dddddddd-0000-4000-8000-000000000001';
const terms='eeeeeeee-0000-4000-8000-000000000001';
const offer='ffffffff-0000-4000-8000-000000000001';
const date='2026-10-14T18:00:00.000Z';
function fixture(change?: (rows:Record<string,Record<string,unknown>>) => void, admin=true, switchAfter=false) {
  const rows:Record<string,Record<string,unknown>>={
    paige_invoices:{id:invoice,tenant_id:tenant,contact_id:client,status:'draft',currency:'usd',updated_at:date,
      billing_lifecycle_version:2,billing_draft_version:3,billing_draft:{schema_version:3,total_minor:350000,
        agreement_snapshot:{id:agreement,version:4},commercial_terms_reference:{id:terms,version:5},
        commercial_conditions:{schema_version:1},items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:offer}}]}},
    paige_agreements:{id:agreement,tenant_id:tenant,contact_id:client,offer_id:offer,commercial_terms_id:terms,version:4,
      updated_at:date,title:'Synthetic package',body_markdown:'Existing owner-supplied agreement',body_source:'paige_draft',status:'draft',content_sha256:null},
    tenant_client_agreements:{id:terms,tenant_id:tenant,contact_id:client,offer_id:offer,status:'draft',collection_terms_version:5,
      updated_at:date,agreed_amount_minor:350000,agreed_currency:'USD',collection_terms:{schema_version:1}},
  };
  change?.(rows);let scopes=0;const filters:Array<[string,string,string]>=[];
  const caller={rpc:async(name:string)=>({data:name==='is_tenant_admin'?admin:(++scopes>1&&switchAfter?'99999999-0000-4000-8000-000000000001':tenant),error:null}),
    from(table:string){const query={select(){return query;},eq(key:string,value:string){filters.push([table,key,value]);return query;},
      maybeSingle:async()=>({data:rows[table]??null,error:null})};return query;}};
  return {caller,filters};
}
describe('canonical commercial presentation source read',()=>{
  it('reads only existing exact same-workspace drafts with original versions',async()=>{
    const {caller,filters}=fixture();const result=await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller);
    expect(result.state).toBe('source');
    if(result.state==='source')expect(result.input.source).toMatchObject({tenant_id:tenant,client_id:client,
      agreement_version:4,agreement_updated_at:date,invoice_version:2,invoice_draft_version:3,invoice_updated_at:date,terms_version:5});
    expect(filters.filter(f=>f[1]==='tenant_id')).toHaveLength(3);
    expect(filters.every(f=>f[1]!=='tenant_id'||f[2]===tenant)).toBe(true);
  });
  it('refuses an unauthorized role before reading a commercial row',async()=>{
    const {caller,filters}=fixture(undefined,false);expect((await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).state).toBe('refused');
    expect(filters).toHaveLength(0);
  });
  it('refuses a workspace switch during the read',async()=>{
    const {caller}=fixture(undefined,true,true);expect((await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).state).toBe('refused');
  });
  for(const [label,mutate] of [
    ['foreign tenant',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.tenant_id='foreign';}],
    ['foreign client',(r:Record<string,Record<string,unknown>>)=>{r.tenant_client_agreements.contact_id='foreign';}],
    ['stale agreement',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.version=6;}],
    ['stale terms',(r:Record<string,Record<string,unknown>>)=>{r.tenant_client_agreements.collection_terms_version=7;}],
    ['issued invoice',(r:Record<string,Record<string,unknown>>)=>{r.paige_invoices.status='issued';}],
    ['frozen document',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.content_sha256='a'.repeat(64);}],
    ['uploaded document',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.body_source='tenant_upload';}],
    ['foreign offer',(r:Record<string,Record<string,unknown>>)=>{r.tenant_client_agreements.offer_id='foreign';}],
  ] as const)it(`refuses ${label} rather than returning an executable package`,async()=>{
    const {caller}=fixture(mutate);expect((await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).state).toBe('refused');
  });
  it('returns missing canonical references as needs_input without inventing them',async()=>{
    const {caller}=fixture(r=>{delete (r.paige_invoices.billing_draft as Record<string,unknown>).commercial_terms_reference;});
    expect(await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).toEqual({state:'needs_input',fields:['commercial_terms_reference']});
  });
  it('does not accept foreign resource selectors or extra approval fields',async()=>{
    const {caller,filters}=fixture();expect((await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement,approved:true},caller)).state).toBe('refused');
    expect(filters).toHaveLength(0);
  });
  it('prepares the canonical $3500/$500/ten dated $300 facts without approving or collecting',async()=>{
    const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,
      deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
    expect(schedule.state).toBe('ready');if(schedule.state!=='ready')throw Error('Fixture invalid');
    const known={state:'not_applicable',charges:[],source:'Synthetic owner record',policy:'No applicable charge recorded'};
    const {caller}=fixture(r=>{
      r.tenant_client_agreements.collection_terms=schedule.terms;
      (r.paige_invoices.billing_draft as Record<string,unknown>).commercial_conditions={schema_version:1,tax:known,fees:known};
    });
    const result=await prepareCommercialPresentationFromRecords(tenant,{invoice_id:invoice,agreement_id:agreement},caller);
    expect(result.state).toBe('proposed');
    if(result.state==='proposed'){
      expect(result.presentation.payload.obligations).toHaveLength(11);
      expect(result.presentation.payload.obligations[0]).toMatchObject({due_date:'2026-10-15',amount_cents:50000});
      expect(result.presentation.payload.obligations.slice(1).every(r=>r.amount_cents===30000)).toBe(true);
      expect(result.presentation.payload.principal_minor).toBe(350000);
      expect(result.presentation.payload.source.invoice_draft_version).toBe(3);
      expect(result.presentation.appendix).toContain('2027-08-15');
      expect(Object.keys(result)).toEqual(['state','presentation']);
    }
  });
  it('leaves unknown source facts unavailable to a financial presentation',async()=>{
    const {caller}=fixture();
    expect(await prepareCommercialPresentationFromRecords(tenant,{invoice_id:invoice,agreement_id:agreement},caller))
      .toEqual({state:'needs_input',fields:['complete_supported_commercial_presentation']});
  });
});
