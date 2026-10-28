import {describe,expect,it} from 'vitest';
import source from './fixtures/exp04-client-status-source.json';
import {composeClientEngagementStatus,parseClientEngagementSource,type ClientEngagementSource} from '../../supabase/functions/_shared/client-engagement/status';

// Reuse the incumbent full-schema native projection. These are controlled
// revision-drift cases, not customer receipts or proof of production acceptance.
const base=()=>structuredClone(source) as ClientEngagementSource;
const contract=(s:ClientEngagementSource)=>s.invoices.find(i=>i.invoice_number==='E4-0001')!;
const compose=(s:ClientEngagementSource)=>composeClientEngagementStatus(parseClientEngagementSource(s));

describe('original invoice terms revision continuity',()=>{
 it('keeps the matched original schedule and separate receipt classes',()=>{
  const result=compose(base());
  expect(result.money).toMatchObject({contracted_minor:350000,due_to_date_minor:80000,behind_schedule_minor:20000,
   invoiced_against_terms_minor:350000,outstanding_minor:302000,
   received:{verified_minor:10000,recorded_by_owner_minor:50000,test_environment_minor:30000}});
  expect(result.attention).not.toContain('invoice_terms_version_mismatch');
 });

 it.each([0,2])('withholds current-plan claims when the original invoice references revision %i',version=>{
  const s=base();contract(s).commercial_terms_reference!.version=version;
  const result=compose(s);
  expect(result.money).toMatchObject({contracted_minor:null,due_to_date_minor:null,behind_schedule_minor:null,
   invoiced_against_terms_minor:null,not_yet_invoiced_minor:null,overdue_minor:null,
   received_against_terms:{verified_minor:null,recorded_by_owner_minor:null}});
  expect(result.attention).toContain('invoice_terms_version_mismatch');
  expect(result.terms?.schedule.every(row=>row.due===null)).toBe(true);
  // The actual invoice balances and receipt evidence do not disappear because
  // its schedule revision cannot be established by this read.
  expect(result.money).toMatchObject({invoiced_minor:362000,outstanding_minor:302000,
   received:{verified_minor:10000,recorded_by_owner_minor:50000,test_environment_minor:30000}});
  expect(result.invoices.find(i=>i.number==='E4-0001')).toMatchObject({past_due_minor:null,overdue:null,
   outstanding_minor:290000,payment_state:'awaiting_confirmation',bound_to_terms:true});
  expect(result.invoices.find(i=>i.number==='E4-0002')!.past_due_minor).toBe(12000);
 });

 it('does not judge an old invoice against later proposed dates with the same principal',()=>{
  const s=base();s.terms[0].collection_terms_version=2;
  const t=s.terms[0].collection_terms as {anchor_date:string;dates:{due_date:string}[]};
  t.anchor_date='2028-09-03';
  t.dates.forEach(row=>{row.due_date=row.due_date.replace(/^2026/,'2028').replace(/^2027/,'2029');});
  const result=compose(s);
  expect(result.money.due_to_date_minor).toBeNull();
  expect(result.money.behind_schedule_minor).toBeNull();
  expect(result.invoices.find(i=>i.number==='E4-0001')!.past_due_minor).toBeNull();
  expect(result.money.outstanding_minor).toBe(302000);
  expect(result.attention).toContain('invoice_terms_version_mismatch');
 });

 it('does not let an old unissued draft invalidate a matched billed obligation',()=>{
  const s=base();s.terms[0].collection_terms_version=2;
  contract(s).commercial_terms_reference!.version=2;
  const draft=s.invoices.find(i=>i.invoice_number==='E4-0003')!;
  draft.commercial_terms_reference={id:s.terms[0].id,version:1};
  const result=compose(s);
  expect(result.attention).not.toContain('invoice_terms_version_mismatch');
  expect(result.money).toMatchObject({contracted_minor:350000,due_to_date_minor:80000,
   behind_schedule_minor:20000,overdue_minor:32000,invoiced_against_terms_minor:350000});
 });
});
