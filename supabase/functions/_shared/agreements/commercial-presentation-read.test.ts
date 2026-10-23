import {describe,it} from 'https://deno.land/std@0.190.0/testing/bdd.ts';
import assert from 'node:assert/strict';
const expect=(value:unknown)=>({
  toBe:(other:unknown)=>assert.equal(value,other),
  toEqual:(other:unknown)=>assert.deepEqual(value,other),
  toHaveLength:(length:number)=>assert.equal((value as {length:number}).length,length),
  toContain:(text:string)=>assert(String(value).includes(text)),
  toMatchObject:(other:Record<string,unknown>)=>{for(const [key,expected] of Object.entries(other))assert.deepEqual((value as Record<string,unknown>)[key],expected);},
});

import { prepareCommercialPresentationFromRecords, readCommercialPresentationSource } from './commercial-presentation-read.ts';
import { assembleFixedRepaymentSchedule } from '../sales-collections/model.ts';
import {sha256Hex} from './token.ts';

const tenant='aaaaaaaa-0000-4000-8000-000000000001';
const client='bbbbbbbb-0000-4000-8000-000000000001';
const agreement='cccccccc-0000-4000-8000-000000000001';
const invoice='dddddddd-0000-4000-8000-000000000001';
const terms='eeeeeeee-0000-4000-8000-000000000001';
const offer='ffffffff-0000-4000-8000-000000000001';
const date='2026-10-14T18:00:00.123456Z';
const actor='11111111-0000-4000-8000-000000000001';
function fixture(change?: (rows:Record<string,Record<string,unknown>>) => void, admin=true, switchAfter=false) {
  const rows:Record<string,Record<string,unknown>>={
    paige_invoices:{id:invoice,tenant_id:tenant,contact_id:client,status:'draft',currency:'usd',updated_at:date,
      billing_lifecycle_version:2,billing_draft_version:3,billing_draft:{schema_version:3,total_minor:350000,
        agreement_id:agreement,agreement_snapshot:{id:agreement,version:4},commercial_terms_reference:{id:terms,version:5},
        commercial_conditions:{schema_version:1},items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:offer}}]}},
    paige_agreements:{id:agreement,tenant_id:tenant,contact_id:client,offer_id:offer,commercial_terms_id:terms,version:4,
      updated_at:date,title:'Synthetic package',body_markdown:'Existing owner-supplied agreement',body_source:'paige_draft',status:'draft',content_sha256:null,content_storage_key:null,sealed_sha256:null,sealed_storage_key:null},
    tenant_client_agreements:{id:terms,tenant_id:tenant,contact_id:client,offer_id:offer,status:'draft',collection_terms_version:5,
      updated_at:date,agreed_amount_minor:350000,agreed_currency:'USD',starts_on:'2026-10-01',ends_on:null,price_basis:'negotiated',collection_terms:{schema_version:1}},
  };
  change?.(rows);let scopes=0;const filters:Array<[string,string,string]>=[],selects:Array<[string,string]>=[],rpcs:string[]=[];
  const caller={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name:string)=>{rpcs.push(name);return {data:name==='is_tenant_admin'?admin:(++scopes>1&&switchAfter?'99999999-0000-4000-8000-000000000001':tenant),error:null};},
    from(table:string){const query={select(columns:string){selects.push([table,columns]);return query;},eq(key:string,value:string){filters.push([table,key,value]);return query;},
      maybeSingle:async()=>({data:rows[table]??null,error:null})};return query;}};
  return {caller,filters,selects,rpcs};
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
    ['mismatched canonical invoice agreement',(r:Record<string,Record<string,unknown>>)=>{(r.paige_invoices.billing_draft as Record<string,unknown>).agreement_id='99999999-0000-4000-8000-000000000001';}],
    ['stale terms',(r:Record<string,Record<string,unknown>>)=>{r.tenant_client_agreements.collection_terms_version=7;}],
    ['issued invoice',(r:Record<string,Record<string,unknown>>)=>{r.paige_invoices.status='issued';}],
    ['frozen document',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.content_sha256='a'.repeat(64);}],
    ['uploaded document',(r:Record<string,Record<string,unknown>>)=>{r.paige_agreements.body_source='tenant_upload';}],
    ['foreign offer',(r:Record<string,Record<string,unknown>>)=>{r.tenant_client_agreements.offer_id='foreign';}],
  ] as const)it(`refuses ${label} rather than returning a prepared package`,async()=>{
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
      expect(result.presentation.payload.schema_version).toBe(2);
      expect(result.presentation.payload.engagement).toEqual({starts_on:'2026-10-01',ends_on:null,price_basis:'negotiated'});
      expect(result.presentation.appendix).toContain('Service starts: 2026-10-01');
      expect(result.presentation.payload.source.invoice_draft_version).toBe(3);
      expect(result.presentation.appendix).toContain('2027-08-15');
      expect(Object.keys(result)).toEqual(['state','presentation','presented_body_markdown']);
      const body='Existing owner-supplied agreement';
      expect(result.presented_body_markdown).toBe(body+'\n\n'+result.presentation.appendix);
      expect(result.presentation.payload.body_sha256).toBe(await sha256Hex(body));
      expect(result.presented_body_markdown.match(/USD 3,500.00/g)).toHaveLength(1);
    }
  });
  it('leaves unknown source facts unavailable to a financial presentation',async()=>{
    const {caller}=fixture();
    expect(await prepareCommercialPresentationFromRecords(tenant,{invoice_id:invoice,agreement_id:agreement},caller))
      .toEqual({state:'needs_input',fields:['complete_supported_commercial_presentation']});
  });
  it('asks for missing service commencement independently of the deposit date',async()=>{
    const {caller}=fixture(r=>{r.tenant_client_agreements.starts_on=null;});
    expect(await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).toEqual({state:'needs_input',fields:['commercial_service_start']});
  });
  it('asks for an agreed price rather than retaining quote-pending economics',async()=>{
    const {caller}=fixture(r=>{r.tenant_client_agreements.price_basis='quote_pending';});
    expect(await readCommercialPresentationSource(tenant,{invoice_id:invoice,agreement_id:agreement},caller)).toEqual({state:'needs_input',fields:['agreed_price_basis']});
  });
});

function completeFixture(change?:(rows:Record<string,Record<string,unknown>>)=>void){
  const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,
    deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
  assert.equal(schedule.state,'ready');
  if(schedule.state!=='ready')throw Error('Original Collections fixture unavailable');
  const known={state:'not_applicable',charges:[],source:'Synthetic owner record',policy:'No applicable charge recorded'};
  return fixture(rows=>{
    rows.tenant_client_agreements.collection_terms=schedule.terms;
    (rows.paige_invoices.billing_draft as Record<string,unknown>).commercial_conditions={schema_version:1,tax:known,fees:known};
    change?.(rows);
  });
}
const selectors={invoice_id:invoice,agreement_id:agreement};
describe('reconciled original preparation read boundaries',()=>{
  for(const key of ['content_sha256','content_storage_key','sealed_sha256','sealed_storage_key']){
    it(`refuses retained ${key} before proposing another document`,async()=>{
      const {caller}=completeFixture(rows=>{rows.paige_agreements[key]=key.endsWith('sha256')?'a'.repeat(64):`${tenant}/${agreement}/retained.pdf`;});
      expect((await prepareCommercialPresentationFromRecords(tenant,selectors,caller)).state).toBe('refused');
    });
  }
  it('refuses an incomplete source projection instead of assuming missing retention metadata is null',async()=>{
    const {caller}=completeFixture(rows=>{delete rows.paige_agreements.sealed_storage_key;});
    expect((await prepareCommercialPresentationFromRecords(tenant,selectors,caller)).state).toBe('refused');
  });
  for(const kind of ['signed_out','anonymous','error','throws'] as const){
    it(`refuses ${kind} Auth before reading private wording`,async()=>{
      const {caller,filters}=completeFixture();
      const auth={getUser:async()=>{
        if(kind==='throws')throw Error('Synthetic Auth unavailable');
        return {data:{user:kind==='signed_out'?null:{id:actor,is_anonymous:kind==='anonymous'}},error:kind==='error'?{code:'AUTH_UNAVAILABLE'}:null};
      }};
      expect((await readCommercialPresentationSource(tenant,selectors,{...caller,auth})).state).toBe('refused');
      expect(filters).toHaveLength(0);
    });
  }
  it('retires a same-business actor switch during original row reads',async()=>{
    const {caller}=completeFixture();let reads=0;
    const auth={getUser:async()=>({data:{user:{id:++reads<3?actor:client}},error:null})};
    expect((await readCommercialPresentationSource(tenant,selectors,{...caller,auth})).state).toBe('refused');
    expect(reads).toBe(3);
  });
  it('retires a same-business actor switch after asynchronous presentation hashing',async()=>{
    const {caller}=completeFixture();let reads=0;
    const auth={getUser:async()=>({data:{user:{id:++reads<5?actor:client}},error:null})};
    expect((await prepareCommercialPresentationFromRecords(tenant,selectors,{...caller,auth})).state).toBe('refused');
    expect(reads).toBe(5);
  });
  it('refuses post-read owner/admin revocation',async()=>{
    const {caller}=completeFixture();let roles=0;
    const rpc=async(name:string)=>({data:name==='is_tenant_admin'?++roles<2:tenant,error:null});
    expect((await readCommercialPresentationSource(tenant,selectors,{...caller,rpc})).state).toBe('refused');
  });
  it('refuses a final proposal workspace switch after hashing',async()=>{
    const {caller}=completeFixture();let scopes=0;
    const rpc=async(name:string)=>({data:name==='is_tenant_admin'?true:++scopes<3?tenant:client,error:null});
    expect((await prepareCommercialPresentationFromRecords(tenant,selectors,{...caller,rpc})).state).toBe('refused');
  });
  it('refuses a source-query failure without returning wording or exception details',async()=>{
    const {caller}=completeFixture();
    const from=()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:{message:'Synthetic private detail'}})};return query;};
    expect(await readCommercialPresentationSource(tenant,selectors,{...caller,from})).toEqual({state:'refused',code:'PRESENTATION_SOURCE_UNAVAILABLE'});
  });
  it('preserves exact original wording and microsecond source timestamps without a write or provider call',async()=>{
    const body='Original supplied wording\r\n\tKeep this spacing.\n';
    const {caller,selects,rpcs}=completeFixture(rows=>{rows.paige_agreements.body_markdown=body;rows.paige_agreements.token_hash='private-fixture-only';});
    const result=await prepareCommercialPresentationFromRecords(tenant,selectors,caller);
    expect(result.state).toBe('proposed');
    if(result.state!=='proposed')throw Error('Positive original-source control failed');
    expect(result.presented_body_markdown).toBe(body+'\n\n'+result.presentation.appendix);
    expect(result.presentation.payload.body_sha256).toBe(await sha256Hex(body));
    expect(result.presentation.payload.source.agreement_updated_at).toBe(date);
    expect(selects).toHaveLength(3);
    expect(selects.map(([table])=>table)).toEqual(['paige_invoices','paige_agreements','tenant_client_agreements']);
    expect(selects.some(([,columns])=>/token|signature|consent|ip_address|user_agent/.test(columns))).toBe(false);
    expect(rpcs.every(name=>name==='current_user_tenant_id'||name==='is_tenant_admin')).toBe(true);
    expect(JSON.stringify(result).includes('private-fixture-only')).toBe(false);
  });
  for(const [label,change] of [
    ['numeric-string principal',(rows:Record<string,Record<string,unknown>>)=>{(rows.paige_invoices.billing_draft as Record<string,unknown>).total_minor='350000';}],
    ['unsafe invoice version',(rows:Record<string,Record<string,unknown>>)=>{rows.paige_invoices.billing_lifecycle_version=Number.MAX_SAFE_INTEGER+1;}],
    ['string agreement version',(rows:Record<string,Record<string,unknown>>)=>{rows.paige_agreements.version='4';}],
    ['missing service end',(rows:Record<string,Record<string,unknown>>)=>{delete rows.tenant_client_agreements.ends_on;}],
  ] as const){
    it(`never prepares a commercial proposal from ${label}`,async()=>{
      const {caller}=completeFixture(change);
      const result=await prepareCommercialPresentationFromRecords(tenant,selectors,caller);
      expect(result.state==='refused'||result.state==='needs_input').toBe(true);
    });
  }
});
