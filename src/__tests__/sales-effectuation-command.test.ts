import {describe,it,expect} from 'vitest';
import {parseCollectionCommand} from '../../supabase/functions/_shared/sales-collections/contract';
import {readCommercialEffectuationConsequence} from '../../supabase/functions/_shared/sales-commercial/effectuation-command';
import {SALES_COMMERCIAL_EFFECTUATE_CAPABILITY,SALES_COLLECTION_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/sales_collections';

const command={action:'collection.effectuate_terms',agreement_id:'55555555-0000-4000-8000-000000000001',expected_version:3,
 expected_updated_at:'2026-10-15T05:17:00.123456+00:00',signing_id:'99999999-0000-4000-8000-000000000001',signing_version:4,
 invoice_id:'66666666-0000-4000-8000-000000000001',invoice_draft_version:2,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
describe('exact signed-term command through the incumbent Collections parser',()=>{
 it('accepts only source brakes and retains all timestamp microseconds',()=>{
  expect(parseCollectionCommand(command)).toEqual(command);
 });
 it.each(['approval','actor_user_id','tenant_id','governance','amount_cents','status','origin'])('refuses injected %s',key=>{
  expect(()=>parseCollectionCommand({...command,[key]:'invented'})).toThrow();
 });
 it.each(Object.keys(command))('requires %s',key=>{
  const input:Record<string,unknown>={...command};delete input[key];expect(()=>parseCollectionCommand(input)).toThrow();
 });
 it.each([['expected_version',-1],['expected_version',1.5],['expected_version',Number.MAX_SAFE_INTEGER+1],['signing_version',0],['invoice_draft_version',0],
  ['expected_updated_at','2026-02-30T05:17:00Z'],['expected_updated_at','2026-10-15T25:17:00Z'],['expected_updated_at','2026-10-15T05:17:00.1234567Z'],
  ['expected_updated_at','2026-10-15'],['payload_digest','z'.repeat(64)],['sealed_sha256',null],['signing_id','wrong']])('refuses invalid %s=%s',(key,value)=>{
  expect(()=>parseCollectionCommand({...command,[key]:value})).toThrow();
 });
});
describe('bounded authoritative effectuation review',()=>{
 const parsed=parseCollectionCommand(command);if(parsed.action!=='collection.effectuate_terms')throw Error('Wrong fixture');
 const consequence={agreement_id:command.agreement_id,signing_id:command.signing_id,signing_version:4,terms_version:3,invoice_id:command.invoice_id,
  payload_digest:command.payload_digest,sealed_sha256:command.sealed_sha256,expected_updated_at:command.expected_updated_at,invoice_draft_version:2,
  client_id:'33333333-0000-4000-8000-000000000001',amount_cents:350000,currency:'usd',starts_on:'2026-10-15',state_before:'draft',state_after:'active',effect:'activate_matching_terms'};
 it('renders a server-bound consequence without inventing financial facts',()=>expect(readCommercialEffectuationConsequence(consequence,parsed)).toEqual(consequence));
 it.each(Object.keys(consequence))('refuses missing consequence %s',key=>{
  const input:Record<string,unknown>={...consequence};delete input[key];expect(readCommercialEffectuationConsequence(input,parsed)).toBeNull();
 });
 it.each([['agreement_id',command.signing_id],['signing_id',command.agreement_id],['signing_version',5],['terms_version',4],['payload_digest','c'.repeat(64)],
  ['sealed_sha256','c'.repeat(64)],['expected_updated_at','2026-10-15T05:17:00.123Z'],['invoice_draft_version',3],['amount_cents',-1],['amount_cents',350000.5],['currency','eur'],
  ['starts_on','2026-02-30'],['state_before','cancelled'],['state_after','completed'],['effect','send_invoice'],['approval','trusted']])('refuses changed consequence %s',(key,value)=>{
  expect(readCommercialEffectuationConsequence({...consequence,[key]:value},parsed)).toBeNull();
 });
 it('requires provenance-only copy when terms are already active',()=>{
  expect(readCommercialEffectuationConsequence({...consequence,state_before:'active'},parsed)).toBeNull();
  expect(readCommercialEffectuationConsequence({...consequence,state_before:'active',effect:'record_provenance_only'},parsed)).not.toBeNull();
 });
 it('declares the canonical high/confirm door while keeping Chat and Mind unavailable',()=>{
  expect(SALES_COMMERCIAL_EFFECTUATE_CAPABILITY.governance).toMatchObject({risk:'high',approval:'confirm',actionRiskKey:'sales_effectuate_commercial_terms'});
  const seams=SALES_COLLECTION_CAPABILITIES.filter(c=>c.key==='sales_collections.effectuate_terms');expect(seams).toHaveLength(1);
  expect(seams[0]).toMatchObject({chatBinding:'UNAVAILABLE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL'});expect(seams[0].action).toBeUndefined();
 });
});
