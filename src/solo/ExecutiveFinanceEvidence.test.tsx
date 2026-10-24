import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { ExecutiveFinanceEvidence } from './ExecutiveFinanceEvidence';
import type { FinanceReviewEvidence } from '../../supabase/functions/_shared/finance/business-review-evidence';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const evidence=():FinanceReviewEvidence=>({tenant_id:'20000000-0000-4000-8000-000000000001',eligible_sources:1,sources:[{
  company_id:'30000000-0000-4000-8000-000000000001',company_label:'Original company',company_version:1,
  binding_id:'50000000-0000-4000-8000-000000000001',binding_revision:2,provider:'plaid',state:'available',coverage:'partial',pages_complete:false,
  snapshot_version:3,source_observed_at:'2026-10-18T08:00:00Z',synchronized_at:'2026-10-18T08:02:00Z',
  observation_id:'60000000-0000-4000-8000-000000000001',receipt_run_id:'70000000-0000-4000-8000-000000000001',normalized_digest:'a'.repeat(64),
  accounts_count:1,accounts:[{native_id:'native-a',label:'Original account',product:'deposit',currency:'USD',current_balance:'900719925474099312345.123456',available_cash:'0',available_credit:null,credit_limit:null}],
}]});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(data=evidence())=>{await act(async()=>root.render(<ExecutiveFinanceEvidence evidence={data} timezone="UTC"/>));};
it('keeps exact source balance, zero cash and unavailable credit separate in the real component',async()=>{
  await render();const rows=[...host.querySelectorAll('.exec-figures > div')].map(n=>n.textContent);
  expect(rows).toEqual(['Source balanceUSD 900719925474099312345.123456','Available cashUSD 0','Available creditUnavailable','Credit limitUnavailable']);
  expect(host.textContent).toContain('Institution freshness is unverified');expect(host.textContent).toContain('credit is not cash');
  expect(host.querySelector('summary')?.textContent).toContain('Original company');
  expect(host.querySelectorAll('button')).toHaveLength(0);
});
it('makes no-source a useful unavailable state without a fabricated financial zero',async()=>{
  await render({...evidence(),eligible_sources:0,sources:[]});expect(host.textContent).toContain('does not mean a zero balance');
  expect(host.textContent).toContain('Review source setup in Finance');expect(host.textContent).not.toContain('USD 0');
});
it('retains a source-specific unavailable state without exposing stale account values',async()=>{
  const data=evidence(),source=data.sources[0];
  data.sources=[{company_id:source.company_id,company_label:source.company_label,company_version:source.company_version,
    binding_id:source.binding_id,binding_revision:source.binding_revision,provider:source.provider,state:'unavailable',reason:'source_snapshot_unavailable'}];
  await render(data);expect(host.textContent).toContain('Source snapshot unavailable');expect(host.textContent).not.toContain('900719925474099312345');
});
it('withholds monetary display when the currency is unknown',async()=>{
  const data=evidence(),source=data.sources[0];if(source.state!=='available')throw new Error('No fixture');source.accounts[0].currency=null;
  await render(data);expect(host.textContent).toContain('Currency is unavailable');expect(host.textContent).not.toContain('USD 0');
  expect([...host.querySelectorAll('.exec-figures dd')].every(n=>n.textContent==='Unavailable')).toBe(true);
});
it('labels observation/receipt provenance without claiming executed work and escapes source wording',async()=>{
  const data=evidence();data.sources[0].company_label='<script>do not run</script>';
  await render(data);expect(host.querySelector('script')).toBeNull();expect(host.textContent).toContain('<script>do not run</script>');
  expect(host.textContent).toContain('Source receipt reference');expect(host.textContent).toContain('not proof PAIGE executed work');
});
