import { describe, expect, it, vi } from 'vitest';
import { selectSnapshotDomains, validateDomainSnapshot } from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import { composeBusinessReview } from '../../supabase/functions/_shared/paige-context/business-review.ts';
import { businessReviewRecordLinks } from '../../supabase/functions/_shared/paige-context/business-review-chat.ts';
import { formatFinanceSourceAmount, validateFinanceReviewEvidence } from '../../supabase/functions/_shared/finance/business-review-evidence.ts';

const tenant='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001';
const company='30000000-0000-4000-8000-000000000001', binding='50000000-0000-4000-8000-000000000001';
const now=new Date('2026-10-19T12:00:00Z');
const catalogue=()=>({tenant_id:tenant,read_at:now.toISOString(),entities:[{id:company,legal_name:'Source company',kind:'workspace_company',identity_basis:'owner_entered',version:1,is_active:true}],
  sources:[{id:binding,entity_id:company,provider:'plaid',environment:'production',verification_state:'verified',revision:1,connection_active:true}]});
const observation=()=>({binding_id:binding,binding_revision:1,version:3,provider:'plaid',environment:'production',coverage:'partial',pages_complete:false,
  source_observed_at:'2026-10-18T08:00:00Z',synchronized_at:'2026-10-18T08:02:00Z',normalized_digest:'a'.repeat(64),
  observation_id:'60000000-0000-4000-8000-000000000001',receipt_run_id:'70000000-0000-4000-8000-000000000001',temporal_basis:'source_snapshot',institution_freshness_verified:false,
  accounts:[{native_id:'account-a',source_label:'Original account',product:'deposit',currency:'USD',current_balance:'900719925474099312345.123456',available_cash:'0',available_credit:null,credit_limit:null}]});
function caller(options: {catalogue?: (n:number)=>unknown; observation?:()=>unknown; deniedCatalogue?:number}={}) {
  let catalogues=0;
  return {auth:{getUser:vi.fn(async()=>({data:{user:{id:actor}},error:null}))},rpc:vi.fn(async(name:string)=>{
    if(name==='current_user_tenant_id')return{data:tenant,error:null};
    if(name==='read_finance_source_catalog'){
      catalogues++;
      return options.deniedCatalogue && catalogues>=options.deniedCatalogue?{data:null,error:{code:'42501',message:'PRIVATE provider diagnostic'}}
        :{data:options.catalogue?.(catalogues)??catalogue(),error:null};
    }
    if(name==='read_finance_account_source')return{data:options.observation?.()??observation(),error:null};
    throw new Error(`Unexpected business-review RPC: ${name}`);
  })};
}
async function review(client=caller()) {
  const result=await composeBusinessReview(client,{actorId:actor,tenantId:tenant,role:'owner',accountShape:'solo'},
    {focus:['finance'],timezone:'UTC'}, {now});
  if(!result.ok)throw new Error('Unexpected period refusal');
  return result;
}

describe('ordinary business-review Finance focus', () => {
  it('keeps an explicit Finance question in the Finance domain instead of silently defaulting to other areas', () => {
    expect(selectSnapshotDomains({ focus: ['finance'] })).toEqual(['finance']);
  });
  it('preserves the original twelve-area response for legacy web tabs without reading Finance',async()=>{
    const c=caller(),r=await composeBusinessReview(c,{actorId:actor,tenantId:tenant,role:'owner',accountShape:'solo'},
      {timezone:'UTC'},{now,financeEvidence:false});
    if(!r.ok)throw new Error('Bad period');
    expect(r.snapshot.requested).toHaveLength(12);expect(r.snapshot.requested).not.toContain('finance');
    expect(r.snapshot.requested).toEqual(expect.arrayContaining(['payments','sales_pipeline','clients','operations','game_plan','outcomes']));
    expect(c.rpc.mock.calls.some(x=>x[0].startsWith('read_finance_'))).toBe(false);
  });
  it('uses canonical stored source contracts, keeps exact amounts and emits the existing Finance record link',async()=>{
    const client=caller(),result=await review(client),entry=result.snapshot.domains.finance;
    expect(entry.status).toBe('available');
    if(entry.status!=='available')throw new Error('Finance not available');
    const source=entry.data.finance_evidence!.sources[0];
    expect(source.state).toBe('available');
    if(source.state!=='available')throw new Error('No source facts');
    expect(source.accounts[0]).toMatchObject({current_balance:'900719925474099312345.123456',available_cash:'0',available_credit:null});
    expect(result.projection).toContain('USD 900719925474099312345.123456');
    expect(result.projection).toContain('available cash "USD 0"');
    expect(result.projection).toContain('available credit "Unavailable"');
    expect(result.projection).toContain('not live bank-wide cash, profit or a forecast');
    expect(entry.data.outcomes).toEqual([]);expect(entry.data.risks).toEqual([]);
    expect(businessReviewRecordLinks(result.snapshot)).toContainEqual({destination:'finance',record_id:null});
    expect(new Set(client.rpc.mock.calls.map(c=>c[0]))).toEqual(new Set(['current_user_tenant_id','read_finance_source_catalog','read_finance_account_source']));
  });
  it('reports no company/source as unavailable financial figures, never a zero balance',async()=>{
    const result=await review(caller({catalogue:()=>({...catalogue(),entities:[],sources:[]})}));
    expect(result.projection).toContain('no eligible verified production source');
    expect(result.projection).toContain('not a zero balance');
    expect(result.projection).not.toContain('USD 0');
  });
  it.each(['sandbox','development'])('excludes %s figures without calling the account reader',async environment=>{
    const client=caller({catalogue:()=>{const c=catalogue();c.sources[0].environment=environment;return c;}});
    const r=await review(client);
    expect(client.rpc.mock.calls.some(c=>c[0]==='read_finance_account_source')).toBe(false);
    expect(r.projection).not.toContain('900719925474099312345');
  });
  it.each(['unverified','revoked'])('does not activate a %s source',async verification_state=>{
    const c=caller({catalogue:()=>{const c=catalogue();c.sources[0].verification_state=verification_state;return c;}});
    const r=await review(c);expect(r.projection).toContain('no eligible verified production source');
    expect(c.rpc.mock.calls.some(c=>c[0]==='read_finance_account_source')).toBe(false);
  });
  it('reports a missing source snapshot without inventing accounts or amounts',async()=>{
    const r=await review(caller({observation:()=>({coverage:'unavailable',reason:'snapshot_not_supplied',accounts:null})}));
    expect(r.projection).toContain('Source snapshot unavailable');expect(r.projection).not.toContain('USD 0');
  });
  it('preserves permitted amounts when optional source wording is missing',async()=>{
    const r=await review(caller({observation:()=>{const o=observation();o.accounts[0].source_label='';o.accounts[0].product='';return o;}}));
    expect(r.snapshot.domains.finance.status).toBe('available');expect(r.projection).toContain('Source account');expect(r.projection).toContain('USD 0');
  });
  it('refuses unavailable/revoked authority without raw diagnostic leakage',async()=>{
    for(const deniedCatalogue of [1,4]){
      const r=await review(caller({deniedCatalogue}));
      expect(r.snapshot.domains.finance.status).toBe('degraded');
      expect(r.projection).not.toContain('PRIVATE');expect(r.projection).not.toContain('900719925474099312345');
    }
  });
  it.each(['revision','company','label','connection','source_set'])('voids earlier figures after a late %s change',async change=>{
    const c=caller({catalogue:n=>{const c=catalogue();if(n<4)return c;
      if(change==='revision')c.sources[0].revision=2;
      if(change==='company')c.entities[0].version=2;
      if(change==='label')c.entities[0].legal_name='Changed company';
      if(change==='connection')c.sources[0].connection_active=false;
      if(change==='source_set')c.sources=[];
      return c;}});
    const r=await review(c);expect(r.snapshot.domains.finance.status).toBe('degraded');expect(r.projection).not.toContain('900719925474099312345');
  });
  it('refuses a different actor before reading Finance records',async()=>{
    const c=caller();c.auth.getUser.mockResolvedValue({data:{user:{id:company}},error:null});
    const r=await review(c);expect(r.snapshot.domains.finance.status).toBe('degraded');
    expect(c.rpc.mock.calls.some(x=>x[0]==='read_finance_source_catalog')).toBe(false);
  });
  it('does not use a privileged fallback when the caller has no auth contract',async()=>{
    const c=caller();const result=await composeBusinessReview({rpc:c.rpc},{actorId:actor,tenantId:tenant,role:'owner',accountShape:'solo'},
      {focus:['finance'],timezone:'UTC'},{now});
    expect(result.ok&&result.snapshot.domains.finance.status).toBe('degraded');
    expect(c.rpc.mock.calls.some(x=>x[0]==='read_finance_source_catalog')).toBe(false);
  });
  it('voids source facts if the actor changes after the last canonical catalogue read',async()=>{
    const c=caller();let checks=0;c.auth.getUser.mockImplementation(async()=>({data:{user:{id:++checks>=11?company:actor}},error:null}));
    const r=await review(c);expect(checks).toBeGreaterThanOrEqual(11);expect(r.snapshot.domains.finance.status).toBe('degraded');
    expect(r.projection).not.toContain('900719925474099312345');
  });
  it('rejects a foreign workspace catalogue before any account reader',async()=>{
    const c=caller({catalogue:()=>({...catalogue(),tenant_id:company})});const r=await review(c);
    expect(r.snapshot.domains.finance.status).toBe('degraded');expect(c.rpc.mock.calls.some(x=>x[0]==='read_finance_account_source')).toBe(false);
  });
  it('fails closed on a workspace switch observed during canonical Finance reads',async()=>{
    const c=caller(),original=c.rpc.getMockImplementation()!;let scopes=0;
    c.rpc.mockImplementation(async name=>name==='current_user_tenant_id'&&++scopes>=3?{data:company,error:null}:original(name));
    const r=await review(c);expect(r.snapshot.domains.finance.status).toBe('degraded');expect(r.projection).not.toContain('900719925474099312345');
  });
  it('does not add multiple source companies or currencies',async()=>{
    const r=await review(caller({observation:()=>{const o=observation();o.accounts.push({...o.accounts[0],native_id:'euro-account',currency:'EUR',available_cash:'5'});return o;}}));
    expect(r.projection).toContain('available cash "USD 0"');expect(r.projection).toContain('available cash "EUR 5"');
    const e=r.snapshot.domains.finance;if(e.status!=='available')throw new Error('No Finance');expect(e.data.headline).toEqual([]);
  });
  it.each(['future','bad_receipt','false_freshness','test_evidence','mismatched_binding'])('refuses %s source claims',async kind=>{
    const r=await review(caller({observation:()=>{const o=observation();
      if(kind==='future')o.source_observed_at='2030-01-01T00:00:00Z';
      if(kind==='bad_receipt')o.receipt_run_id='not-a-source-receipt';
      if(kind==='false_freshness')o.institution_freshness_verified=true;
      if(kind==='test_evidence')o.environment='sandbox';
      if(kind==='mismatched_binding')o.binding_id=company;
      return o;}}));
    expect(r.snapshot.domains.finance.status).toBe('degraded');expect(r.projection).not.toContain('900719925474099312345');
  });
  it.each(['current_balance','available_cash','available_credit','credit_limit'])('refuses numeric rather than exact decimal %s',async key=>{
    const r=await review(caller({observation:()=>{const o=observation();(o.accounts[0] as Record<string,unknown>)[key]=9.99;return o;}}));
    expect(r.snapshot.domains.finance.status).toBe('degraded');expect(r.projection).not.toContain('900719925474099312345');
  });
  it('bounds source accounts without turning a sample into complete portfolio evidence',async()=>{
    const r=await review(caller({observation:()=>{const o=observation();o.accounts=Array.from({length:15},(_,i)=>({...o.accounts[0],native_id:`account-${i}`}));return o;}}));
    const e=r.snapshot.domains.finance;if(e.status!=='available')throw new Error('No Finance');
    const s=e.data.finance_evidence!.sources[0];if(s.state!=='available')throw new Error('No source');
    expect(s.accounts_count).toBe(15);expect(s.accounts).toHaveLength(12);expect(r.projection).toContain('Showing 2 of 15 source accounts');
    expect(e.data.coverage).toBe('partial');
  });
  it('rejects duplicate source account identity rather than combining balances',async()=>{
    const r=await review(caller({observation:()=>{const o=observation();o.accounts.push({...o.accounts[0]});return o;}}));
    expect(r.snapshot.domains.finance.status).toBe('degraded');
  });
  it('validates the closed UI transport and rejects a wrong tenant, extra financial claim or wrong domain',async()=>{
    const r=await review(),entry=r.snapshot.domains.finance;if(entry.status!=='available')throw new Error('No Finance');
    const e=entry.data.finance_evidence!;
    expect(validateFinanceReviewEvidence(e,company,now.getTime())).toBeNull();
    expect(validateFinanceReviewEvidence({...e,net_profit:'100000'},tenant,now.getTime())).toBeNull();
    const checked=validateDomainSnapshot({...entry.data,domain:'payments'},{domain:'payments',period:r.snapshot.period,tenantId:tenant,notAfter:now});
    expect(checked).toMatchObject({ok:false,reason:'finance_domain_mismatch'});
    const malicious=structuredClone(e);if(malicious.sources[0].state==='available')Object.assign(malicious.sources[0].accounts[0],{label:null});
    expect(validateFinanceReviewEvidence(malicious,tenant,now.getTime())).toBeNull();
  });
  it('never float-converts exact decimals or mistakes unavailable amounts for zero',()=>{
    expect(formatFinanceSourceAmount('0','USD')).toBe('USD 0');
    expect(formatFinanceSourceAmount('-900719925474099312345.123456','EUR')).toBe('EUR -900719925474099312345.123456');
    expect(formatFinanceSourceAmount(null,'USD')).toBe('Unavailable');expect(formatFinanceSourceAmount('0',null)).toBe('Unavailable');
  });
});
