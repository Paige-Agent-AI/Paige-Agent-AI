import {describe,it,expect} from 'vitest';
import {readAcceptedCollectionTotalEvidence,readCollectionAmountBasis} from '../../supabase/functions/_shared/sales-collections/amount-basis';

const id='40000000-0000-4000-8000-000000000001',tenant='20000000-0000-4000-8000-000000000001',client='30000000-0000-4000-8000-000000000001',offer='50000000-0000-4000-8000-000000000001';
const evidence={schema_version:1,kind:'accepted_effective_principal',tenant_id:tenant,commercial_terms_id:id,client_id:client,offer_id:offer,principal_minor:350000,currency:'usd',current_terms_version:4,accepted_terms_version:1,signing_id:'60000000-0000-4000-8000-000000000001',signing_version:1,source_digest:'a'.repeat(64),operation_id:'70000000-0000-4000-8000-000000000001',receipt_id:'80000000-0000-4000-8000-000000000001'};
const row={id,tenant_id:tenant,client_id:client,offer_id:offer,term_kind:'installment',agreed_amount_minor:350000,agreed_currency:'usd',collection_terms_version:4,agreed_amount_total_evidence:evidence};
describe('matching original accepted-total read evidence, never label-only eligibility',()=>{
 it('retains the original accepted revision separately from the current draft revision',()=>{
  expect(readAcceptedCollectionTotalEvidence(row)).toEqual(evidence);
  expect(row.agreed_amount_total_evidence).toBe(evidence);
 });
 it('does not turn an absent proof or label into accepted source evidence',()=>{
  for(const agreed_amount_total_evidence of [undefined,null])expect(readAcceptedCollectionTotalEvidence({...row,agreed_amount_total_evidence})).toBeNull();
  expect(readAcceptedCollectionTotalEvidence({term_kind:'deposit',agreed_amount_basis:'total'})).toBeNull();
  expect(()=>readCollectionAmountBasis({term_kind:'deposit',agreed_amount_basis:'total'})).toThrow();
 });
 it.each(['recurring','one_time',undefined])('does not attach finite accepted-source evidence to unsupported current kind %s',term_kind=>{
  expect(()=>readAcceptedCollectionTotalEvidence({...row,term_kind})).toThrow('COLLECTION_TOTAL_EVIDENCE_UNVERIFIED');
 });
 it.each(['deposit','custom_quote'])('derives %s total only from full matching original evidence while preserving the older reader marker',term_kind=>{
  const native={...row,term_kind,agreed_amount_basis:'unverified'};
  expect(readCollectionAmountBasis(native)).toBe('total');
  expect(native.agreed_amount_basis).toBe('unverified');
  expect(readCollectionAmountBasis({...native,agreed_amount_total_evidence:null})).toBe('unverified');
  expect(()=>readCollectionAmountBasis({...native,agreed_amount_basis:'total',agreed_amount_total_evidence:null})).toThrow();
  expect(()=>readCollectionAmountBasis({...native,agreed_amount_total_evidence:{...evidence,principal_minor:999}})).toThrow();
 });
 it.each(['tenant_id','id','client_id','offer_id'])('refuses evidence belonging to another original %s',key=>{
  expect(()=>readAcceptedCollectionTotalEvidence({...row,[key]:'90000000-0000-4000-8000-000000000001'})).toThrow('COLLECTION_TOTAL_EVIDENCE_UNVERIFIED');
 });
 it.each([['agreed_amount_minor',350001],['agreed_currency','eur'],['collection_terms_version',5]])('refuses changed current economics/revision %s',(key,value)=>{
  expect(()=>readAcceptedCollectionTotalEvidence({...row,[String(key)]:value})).toThrow();
 });
 it.each([
  ['schema_version',2],['kind','signed'],['principal_minor',0],['principal_minor',350000.5],['principal_minor',2147483648],['currency','USD'],
  ['current_terms_version',3],['accepted_terms_version',5],['accepted_terms_version',-1],['accepted_terms_version',1.5],['signing_version',0],
  ['source_digest','invented'],['signing_id','not-a-record'],['operation_id',null],['receipt_id','provider-accepted'],
 ])('refuses malformed or unsupported original evidence %s=%s',(key,value)=>{
  expect(()=>readAcceptedCollectionTotalEvidence({...row,agreed_amount_total_evidence:{...evidence,[String(key)]:value}})).toThrow();
 });
 it('refuses incomplete, array and authority-claim payloads',()=>{
  const missing={...evidence} as Record<string,unknown>;delete missing.receipt_id;
  for(const agreed_amount_total_evidence of [missing,[],{...evidence,approved:true}])expect(()=>readAcceptedCollectionTotalEvidence({...row,agreed_amount_total_evidence})).toThrow();
 });
});
