// @vitest-environment node
import {expect,it} from 'vitest';
import {parseCommercialEffectuationCommand,readCommercialEffectuationConsequence,hasCommercialEffectuationReceipt} from '../../supabase/functions/_shared/sales-commercial/effectuation-command';

const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const command={action:'collection.effectuate_terms',agreement_id:id(5),expected_version:3,
 expected_updated_at:'2026-10-15T05:17:00.123456+00:00',signing_id:id(4),signing_version:4,
 invoice_id:id(6),invoice_draft_version:2,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
const parsed=parseCommercialEffectuationCommand(command);
const current={agreement_id:id(5),signing_id:id(4),signing_version:4,terms_version:3,invoice_id:id(6),
 payload_digest:command.payload_digest,sealed_sha256:command.sealed_sha256,expected_updated_at:command.expected_updated_at,invoice_draft_version:2,
 client_id:id(2),amount_cents:350000,currency:'usd',starts_on:'2026-10-15',ends_on:'2027-08-15',price_basis:'negotiated',
 state_before:'draft',state_after:'active',effect:'activate_matching_terms'};

it('retains every original source brake and exact PostgreSQL timestamp precision',()=>expect(parsed).toEqual(command));
it.each(['tenant_id','actor_user_id','approved','amount_cents','status'])('rejects injected %s rather than accepting caller authority',key=>{
 expect(()=>parseCommercialEffectuationCommand({...command,[key]:'invented'})).toThrow();
});
it('retains the complete schema2 service consequence using the canonical engagement contract',()=>{
 expect(readCommercialEffectuationConsequence(current,parsed)).toEqual(current);
});
it('does not infer accepted service dates or price basis from the legacy sparse preview',()=>{
 const {ends_on,price_basis,...legacy}=current;void ends_on;void price_basis;
 expect(readCommercialEffectuationConsequence(legacy,parsed)).toBeNull();
});
it.each([['ends_on','2026-10-14'],['ends_on','2027-02-30'],['price_basis','quote_pending'],['price_basis','invented'],
 ['starts_on','2026-02-30'],['payload_digest','c'.repeat(64)],['expected_updated_at','2026-10-15T05:17:00.123Z'],['amount_cents',-1]])('refuses malformed or changed accepted consequence %s',(key,value)=>{
 expect(readCommercialEffectuationConsequence({...current,[key]:value},parsed)).toBeNull();
});
it('keeps a genuine open-ended service engagement explicit',()=>{
 expect(readCommercialEffectuationConsequence({...current,ends_on:null},parsed)).toEqual({...current,ends_on:null});
});
it('does not retire an operation from a success flag or a foreign signing receipt',()=>{
 const receipt={ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:id(8),
  row:{id:id(5),tenant_id:id(1),status_at_execution:'active',signing_id:id(4),signing_version:4,terms_version:3,
   effective_at:'2026-10-15T05:17:01.000001Z',source_digest:command.payload_digest,actor_user_id:id(9),effect:'activate_matching_terms'},
  operation:{id:id(7),action:command.action}};
 expect(hasCommercialEffectuationReceipt(receipt,id(1),parsed)).toBe(true);
 expect(hasCommercialEffectuationReceipt({ok:true},id(1),parsed)).toBe(false);
 expect(hasCommercialEffectuationReceipt({...receipt,row:{...receipt.row,signing_id:id(99)}},id(1),parsed)).toBe(false);
 expect(hasCommercialEffectuationReceipt(receipt,id(99),parsed)).toBe(false);
});
