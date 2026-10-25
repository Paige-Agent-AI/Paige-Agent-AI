import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Extend the SAME original fenced native program, after its complete approval,
// credential and canonical message controls. Provider acceptance here is an
// explicitly synthetic input to the ORIGINAL native finalizer, never a send.
export async function provePreparedSignatureCompletion({sql,read,q,tenant,actor,fixture,put,claim,finalize}){
 let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>{const result=sql(s);return result===''?null:JSON.parse(result);};
 const source=read('scripts/agreements/prepared-signature-completion-proof.mjs');
 check(provePreparedSignatureCompletion.toString()===source.slice(source.indexOf('export async function provePreparedSignatureCompletion')+'export '.length).trim(),'Exact executed completion proof retained');
 const originalSignature=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)');");
 check(originalSignature==='3a2fa340fca9838aa9c6737f1e41ae61','The original13-argument signature engine must remain authoritative');
 const v=await fixture();v.message=put(v).message_id;
 check(json(native(claim(v))).admitted===true,'The ORIGINAL canonical claim, not a synthetic new approval, admits the message');
 const accepted=json(native(finalize(v,'provider_accepted','synthetic-completion-provider-receipt')));
 check(accepted.outcome==='provider_accepted','The ORIGINAL finalizer records the explicit synthetic provider evidence');
 const before=json(`SELECT jsonb_build_object('status',a.status,'document_sha256',a.content_sha256,'preparation_id',p.id,
  'signed',(SELECT count(*) FROM paige_agreement_signers s WHERE s.agreement_id=a.id AND s.status='signed'),
  'field_receipts',(SELECT count(*) FROM paige_agreement_events e WHERE e.agreement_id=a.id AND e.event_type='field_values_recorded'))
  FROM paige_agreements a JOIN paige_agreement_document_preparations p ON p.agreement_id=a.id AND p.is_current WHERE a.id='${v.a.id}';`);
 check(before.status==='draft'&&before.signed===0&&before.field_receipts===0,'Message acceptance alone cannot invent publication, signature or field evidence');
 if(!process.argv.includes('--prepared-signature-completion-baseline')){
  const migration=read('supabase/migrations/20271114200004_e04_prepared_signing_completion.sql');sql(migration);sql(migration);
 }
 // Causal baseline must reach this genuine missing native effect transition
 // AFTER the exact original consumed approval/Work/credential/message result.
 const published=json(native(`SELECT _publish_prepared_agreement_request('${actor}','${tenant}','${v.operation}',${q(v.args.request_sha256)});`));
 check(published.state==='recorded'&&published.agreement_id===v.a.id&&published.agreement_status==='sent','Record only actual canonical provider-accepted publication for the same original agreement');
 return {checks,originalSignature,proofBodySha256:createHash('sha256').update(provePreparedSignatureCompletion.toString()).digest('hex'),scope:'Original local publication-to-signature prerequisites with explicit synthetic provider input; no customer/provider acceptance'};
}
