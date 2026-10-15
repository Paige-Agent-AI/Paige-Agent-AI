// @vitest-environment node
import {it,expect} from 'vitest';
import {e04CommercialFixture,e04Id} from '../test/fixtures/e04-commercial-presentation';
import {parseCommercialPreparationCommand,readCommercialPreparationConsequence,hasCommercialPreparationReceipt,preparationCommandSchema} from '../../supabase/functions/_shared/sales-commercial/preparation-command';

it('keeps the approved command closed to exact canonical identities/versions/digest',async()=>{
 const f=await e04CommercialFixture();expect(parseCommercialPreparationCommand(f.command)).toEqual(f.command);
 expect(preparationCommandSchema.required.slice().sort()).toEqual(Object.keys(f.command).sort());
 expect(JSON.stringify(f.command)).not.toMatch(/body_markdown|storage_key|document_sha|actor_user_id|approved/);
 for(const key of Object.keys(f.command)){const missing={...f.command} as Record<string,unknown>;delete missing[key];expect(()=>parseCommercialPreparationCommand(missing),key).toThrow();}
 for(const key of ['approved','actor_user_id','tenant_id','prepared','storage_key','document_sha256','body_markdown'])expect(()=>parseCommercialPreparationCommand({...f.command,[key]:'forged'}),key).toThrow();
});
it('rejects malformed identities, source versions and digest',async()=>{
 const {command}=await e04CommercialFixture();
 for(const key of ['agreement_id','invoice_id','terms_id','client_id','offer_id'])expect(()=>parseCommercialPreparationCommand({...command,[key]:'foreign-selector'}),key).toThrow();
 for(const [key,value] of [['invoice_version',0],['invoice_draft_version',1.5],['agreement_version','4'],['terms_version',-1],['payload_digest','x'.repeat(64)]])expect(()=>parseCommercialPreparationCommand({...command,[String(key)]:value}),String(key)).toThrow();
});
it('requires the authoritative matching preparation consequence and explicit commencement',async()=>{
 const f=await e04CommercialFixture();const value={...f.command,kind:'retain_signing_document',principal_minor:350000,currency:'usd',engagement:f.proposed.presentation.payload.engagement};
 expect(readCommercialPreparationConsequence(value,f.command)).toEqual(value);
 for(const change of [{agreement_id:e04Id(99)},{invoice_draft_version:99},{terms_version:99},{payload_digest:'b'.repeat(64)},{principal_minor:null},{currency:'eur'},{engagement:null},{engagement:{...value.engagement,starts_on:'2026-02-30'}},{approved:true}])expect(readCommercialPreparationConsequence({...value,...change},f.command)).toBeNull();
});
it('requires an exact durable historical receipt without claiming a signature or payment',async()=>{
 const f=await e04CommercialFixture();const value={ok:true,outcome:'agreement_prepared',historical_receipt:true,receipt_id:e04Id(8),
  row:{id:f.agreement,tenant_id:f.tenant,version_at_preparation:4,invoice_id:f.invoice,invoice_version:1,invoice_draft_version:2,
   terms_id:f.terms,terms_version:3,client_id:f.client,offer_id:f.offer,payload_digest:f.command.payload_digest,document_sha256:'a'.repeat(64),prepared_at:'2026-10-15T00:00:00Z',actor_user_id:e04Id(9)},
  operation:{id:f.operation,action:f.command.action}};
 expect(hasCommercialPreparationReceipt(value,f.tenant,f.command)).toBe(true);
 for(const change of [{receipt_id:null},{historical_receipt:false},{outcome:'signed'},{capability:'agreement_send'},{body_markdown:'private text'},{row:{...value.row,invoice_version:2}},{row:{...value.row,client_id:e04Id(99)}},{row:{...value.row,payload_digest:'b'.repeat(64)}},{row:{...value.row,document_sha256:''}},{row:{...value.row,prepared_at:'unknown'}},{operation:{id:f.operation,action:'collection.effectuate_terms'}}])expect(hasCommercialPreparationReceipt({...value,...change},f.tenant,f.command)).toBe(false);
});
