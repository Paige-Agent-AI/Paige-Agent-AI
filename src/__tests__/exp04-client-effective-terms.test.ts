import {describe,expect,it} from 'vitest';
import source from './fixtures/exp04-client-status-source.json';
import {readClientEffectiveTerms,type EffectiveTermsScope} from '../../supabase/functions/_shared/client-engagement/effective-terms';

// Contract-shaped synthetic decoder input only. Native provenance is exercised
// separately by the original directory-fenced signing/effectuation proof.
function fixture(){
 const row=structuredClone(source.terms[0]);
 const scope:EffectiveTermsScope={tenant_id:source.tenant_id,client_id:source.contact_id,commercial_terms_id:row.id,
  offer_id:row.offer_id,working_terms_version:row.collection_terms_version};
 const value={schema_version:1,state:'verified',...scope,terms_version:row.collection_terms_version,
  signing_id:'e4000000-0000-4000-8000-0000000a0001',signing_version:1,completed_at:'2026-09-02T10:00:00+00:00',
  document_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64),effectuated_at:'2026-09-02T11:00:00+00:00',
  operation_id:'e4000000-0000-4000-8000-000000070001',receipt_id:'e4000000-0000-4000-8000-000000070002',
  source_digest:'c'.repeat(64),invoice_id:source.invoices[0].id,principal_minor:row.agreed_amount_minor,
  currency:row.agreed_currency,collection_terms:row.collection_terms,
  engagement:{starts_on:row.starts_on,ends_on:row.ends_on,price_basis:'negotiated'},working_differs:false};
 return {scope,value};
}
const bad='CLIENT_EFFECTIVE_TERMS_SOURCE_INVALID';
describe('original effective commercial read decoder',()=>{
 it('keeps older readers compatible without manufacturing an effective record',()=>{
  expect(readClientEffectiveTerms(undefined,fixture().scope)).toEqual({state:'reader_unavailable'});
 });
 it.each(['not_recorded','unverified'])('retains the exact %s state without accepted economics',state=>{
  const {scope}=fixture(),record={schema_version:1,state,...scope};
  expect(readClientEffectiveTerms(record,scope)).toEqual(record);
  expect(()=>readClientEffectiveTerms({...record,principal_minor:350000},scope)).toThrow(bad);
 });
 it('decodes original accepted economics with no input mutation',()=>{
  const {scope,value}=fixture(),before=structuredClone(value),result=readClientEffectiveTerms(value,scope);
  expect(result).toMatchObject({state:'verified',principal_minor:350000,terms_version:1,working_differs:false});
  expect(value).toEqual(before);
 });
 it('keeps the accepted revision separate from a later working revision',()=>{
  const {scope,value}=fixture();scope.working_terms_version=2;value.working_terms_version=2;value.working_differs=true;
  expect(readClientEffectiveTerms(value,scope)).toMatchObject({state:'verified',terms_version:1,working_terms_version:2,
   principal_minor:350000,working_differs:true});
 });
 it('compares explicit-offset instants without changing them',()=>{
  const {scope,value}=fixture();value.effectuated_at='2026-09-02T04:00:00-07:00';
  expect(readClientEffectiveTerms(value,scope)).toMatchObject({state:'verified',effectuated_at:value.effectuated_at});
 });
 it.each(['tenant_id','client_id','commercial_terms_id','offer_id'] as const)('refuses another original %s',key=>{
  const {scope,value}=fixture();value[key]='e4000000-0000-4000-8000-000000099999';
  expect(()=>readClientEffectiveTerms(value,scope)).toThrow(bad);
 });
 it.each([
  {schema_version:2},{state:'signed'},{working_terms_version:2},{terms_version:2},{terms_version:-1},
  {signing_version:0},{receipt_id:null},{invoice_id:'not-an-id'},{operation_id:null},
  {document_sha256:null},{sealed_sha256:'b'.repeat(63)},{source_digest:'not-a-digest'},
  {completed_at:'2026-09-02T12:00:00Z'},{effectuated_at:'2026-09-02T11:00:00'},
  {effectuated_at:'2026-02-31T11:00:00Z'},{state:{toString:()=> 'unverified'}},
  {working_differs:'false'},{principal_minor:0},{principal_minor:350001},{currency:'eur'},
  {extra:'unrecognized'},
 ])('refuses an incomplete, contradictory or unrecognized snapshot %j',patch=>{
  const {scope,value}=fixture();expect(()=>readClientEffectiveTerms({...value,...patch},scope)).toThrow(bad);
 });
 it('refuses a later version that falsely claims no working change',()=>{
  const {scope,value}=fixture();scope.working_terms_version=2;value.working_terms_version=2;
  expect(()=>readClientEffectiveTerms(value,scope)).toThrow(bad);
 });
 it.each([{starts_on:'2026-02-31'},{ends_on:'2026-01-01'},{price_basis:''},{extra:'unknown'}])('reuses canonical engagement date/shape validation %j',patch=>{
  const {scope,value}=fixture();expect(()=>readClientEffectiveTerms({...value,engagement:{...value.engagement,...patch}},scope)).toThrow(bad);
 });
});
