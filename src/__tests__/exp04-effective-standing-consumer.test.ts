import {describe,expect,it} from 'vitest';
import raw from './fixtures/exp04-client-status-source.json';
import {composeClientEngagementStatus,type ClientEngagementSource} from '../../supabase/functions/_shared/client-engagement/status';
import {projectClientStanding} from '../../supabase/functions/_shared/client-engagement/chat';

import {effectiveStandingFixture as fixture} from './fixtures/exp04-effective-standing-source';

const compose=composeClientEngagementStatus;
describe('original accepted terms in the client-standing consumer',()=>{
 it('uses retained accepted dates, principal and revision after a working draft changes',()=>{
  const {source}=fixture(),before=structuredClone(source),s=compose(source);
  expect(s.terms).toMatchObject({basis:'accepted',version:1,working_version:2,working_differs:true,agreed_minor:350000});
  expect(s.agreement).toMatchObject({effective:'verified',signing_id:source.signings[0].id});
  expect(s.money).toMatchObject({contracted_minor:350000,due_to_date_minor:80000,behind_schedule_minor:20000,
   overdue_minor:32000,outstanding_minor:302000,received:{verified_minor:10000,recorded_by_owner_minor:50000,test_environment_minor:30000}});
  expect(s.attention).not.toContain('invoice_terms_version_mismatch');expect(source).toEqual(before);
 });
 it('does not mix a proposed new price or currency into accepted invoice economics',()=>{
  const {source,t}=fixture();t.agreed_amount_minor=360000;t.agreed_currency='eur';
  expect(compose(source).money).toMatchObject({currency:'usd',mixed_currency:false,contracted_minor:350000,due_to_date_minor:80000});
 });
 it('preserves current paused status separately from historical effectuation',()=>{
  const {source,t}=fixture();t.status='paused';
  expect(compose(source).terms).toMatchObject({status:'paused',basis:'accepted',version:1});
 });
 it('selects the exact effectuated signing instead of a newer completed amendment',()=>{
  const {source,accepted}=fixture();source.signings.unshift({...source.signings[0],id:'e4000000-0000-4000-8000-0000000a0002',
   title:'Unaccepted amendment',created_at:'2026-10-14T00:00:00Z'});
  expect(compose(source).agreement).toMatchObject({signing_id:accepted.signing_id,title:'Test consulting agreement',effective:'verified'});
 });
 it('retains exact accepted identity when that signing is outside the bounded title list',()=>{
  const {source,accepted}=fixture();source.signings=[];source.signings_has_more=true;
  expect(compose(source).agreement).toMatchObject({state:'signed',signing_id:accepted.signing_id,title:null,completed_at:accepted.completed_at,effective:'verified'});
 });
 it.each(['tenant_id','client_id','commercial_terms_id','offer_id'] as const)('refuses foreign native %s evidence',key=>{
  const {source,accepted}=fixture();accepted[key]='e4000000-0000-4000-8000-000000099999';
  expect(()=>compose(source)).toThrow('CLIENT_EFFECTIVE_TERMS_SOURCE_INVALID');
 });
 it('withholds plan claims for explicitly unverified provenance while keeping real balances',()=>{
  const {source,t}=fixture();Object.assign(t,{effective_terms:{schema_version:1,state:'unverified',tenant_id:source.tenant_id,
   client_id:source.contact_id,commercial_terms_id:t.id,offer_id:t.offer_id,working_terms_version:2}});
  const s=compose(source);expect(s.agreement.effective).toBe('unverified');
  expect(s.money).toMatchObject({contracted_minor:null,due_to_date_minor:null,overdue_minor:null,outstanding_minor:302000});
  const text=projectClientStanding(s);expect(text).toContain('verification pending — original invoice terms need verification');
  expect(text).not.toContain('not recognised');
 });
 it('does not let a working-version invoice borrow an earlier accepted schedule',()=>{
  const {source,invoice}=fixture();invoice.commercial_terms_reference!.version=2;
  const s=compose(source);expect(s.money).toMatchObject({contracted_minor:null,due_to_date_minor:null,overdue_minor:null,outstanding_minor:302000});
  expect(s.attention).toContain('invoice_terms_version_mismatch');
 });
 it('does not let an unverified working currency hide canonical invoice balances',()=>{
  const {source,t}=fixture();t.agreed_currency='eur';
  Object.assign(t,{effective_terms:{schema_version:1,state:'unverified',tenant_id:source.tenant_id,client_id:source.contact_id,
   commercial_terms_id:t.id,offer_id:t.offer_id,working_terms_version:2}});
  expect(compose(source).money).toMatchObject({currency:'usd',mixed_currency:false,contracted_minor:null,
   due_to_date_minor:null,overdue_minor:null,outstanding_minor:302000,received:{verified_minor:10000,recorded_by_owner_minor:50000,test_environment_minor:30000}});
 });
 it('withholds dates without a usable business zone without losing accepted identity',()=>{
  const {source}=fixture();source.business_time_zone={state:'missing',zone:null};
  const s=compose(source);expect(s.agreement.effective).toBe('verified');
  expect(s.money).toMatchObject({contracted_minor:350000,due_to_date_minor:null,overdue_minor:null,outstanding_minor:302000});
  expect(s.terms?.schedule.every(row=>row.due===null)).toBe(true);
 });
 it('refuses a contradictory exact signing in the same projection',()=>{
  const {source}=fixture();source.signings[0].sealed=false;
  expect(()=>compose(source)).toThrow('CLIENT_STATUS_SOURCE_INVALID:effective_signing_conflict');
 });
 it('keeps old readers compatible without inventing an effective record',()=>{
  const s=compose(structuredClone(raw) as ClientEngagementSource);
  expect(s.terms).toMatchObject({basis:'working',version:1,working_version:1});
  expect(s.agreement).toMatchObject({effective:'not_recorded',effective_source:'reader_unavailable'});
  expect(s.money.due_to_date_minor).toBe(80000);
 });
 it('explains accepted and working revisions in the same PAIGE read without a global absence claim',()=>{
  const {source}=fixture(),text=projectClientStanding(compose(source));
  expect(text).toContain('Accepted revision 1 · Working draft revision 2 differs');
  expect(text).toContain('Original accepted terms are retained with this signed agreement.');
  expect(text).not.toContain('Effective terms are not established by this standing view.');
  expect(text).not.toContain('terms_effective_transition');
 });
});

describe('every invoice retains its own original schedule applicability',()=>{
 function other(){
  const source=structuredClone(raw) as ClientEngagementSource;
  const t={...structuredClone(source.terms[0]),id:'e4000000-0000-4000-8000-0000000d0002',status:'paused'};
  source.terms.push(t);
  const invoice={...structuredClone(source.invoices.find(i=>i.invoice_number==='E4-0001')!),id:'e4000000-0000-4000-8000-0000000e0005',
   invoice_number:'E4-0005',commercial_terms_reference:{id:t.id,version:1}};source.invoices.push(invoice);
  return {source,t,invoice};
 }
 it('applies the other known agreement schedule instead of aging its whole principal from the first date',()=>{
  const {source}=other();const s=compose(source);
  expect(s.invoices.find(i=>i.number==='E4-0005')).toMatchObject({past_due_minor:20000,overdue:true});
  expect(s.money.overdue_minor).toBe(52000);
 });
 it('withholds an unknown other agreement schedule instead of aging the full invoice',()=>{
  const {source,t}=other();source.terms=source.terms.filter(row=>row.id!==t.id);
  const s=compose(source);expect(s.invoices.find(i=>i.number==='E4-0005')).toMatchObject({past_due_minor:null,overdue:null});
  expect(s.money.overdue_minor).toBeNull();expect(s.money.outstanding_minor).toBe(592000);
 });
 it('withholds the other agreement when its original revision is unavailable',()=>{
  const {source,t}=other();t.collection_terms_version=2;
  expect(compose(source).invoices.find(i=>i.number==='E4-0005')!.past_due_minor).toBeNull();
 });
 it('detects duplicate whole-principal invoices for the other agreement',()=>{
  const {source,invoice}=other();source.invoices.push({...structuredClone(invoice),id:'e4000000-0000-4000-8000-0000000e0006',invoice_number:'E4-0006'});
  const s=compose(source);expect(s.money.overdue_minor).toBeNull();expect(s.attention).toContain('terms_invoiced_more_than_once');
 });
 it('withholds schedule judgments when bound invoice amount or currency contradicts its source',()=>{
  for(const patch of [{amount_minor:349999},{currency:'eur'}]){
   const {source,invoice}=other();Object.assign(invoice,patch);
   expect(compose(source).invoices.find(i=>i.number==='E4-0005')!.past_due_minor).toBeNull();
  }
 });
});
