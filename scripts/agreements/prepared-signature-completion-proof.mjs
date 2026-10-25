import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

// Extend the SAME original fenced native program, after its complete approval,
// credential and canonical message controls. Provider acceptance here is an
// explicitly synthetic input to the ORIGINAL native finalizer, never a send.
export async function provePreparedSignatureCompletion({sql,read,q,tenant,actor,fixture,put,claim,finalize,context,startSession,observe}){
 let checks=0,sessions=0,waits=0;const check=(value,message)=>{assert(value,message);checks++;};
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
 const publish=(f,patch={})=>{const args={actor,tenant,operation:f.operation,digest:f.args.request_sha256,...patch};return `SELECT _publish_prepared_agreement_request('${args.actor}','${args.tenant}','${args.operation}',${q(args.digest)});`;};
 const refused=(statement,code='23514',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected prepared publication refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const count=f=>sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${f.a.id}' AND event_type='sent' AND detail->>'action'='prepared_signature_request_recorded';`);
 const acceptedFixture=async()=>{const f=await fixture();f.message=put(f).message_id;json(native(claim(f)));json(native(finalize(f,'provider_accepted','synthetic-publication-'+f.g.operation_id)));return f;};
 check(published.receipt_id&&published.accepted_count===1&&published.recipient_count===v.args.request.recipients.length
  &&published.delivery_confirmed===false,'Actual original event identity is a provider receipt, never delivery/signature/payment evidence');
 const replay=json(native(publish(v)));
 check(replay.replayed&&replay.receipt_id===published.receipt_id&&count(v)==='1','Same real provider evidence retains one original publication event');
 const event=json(`SELECT detail FROM paige_agreement_events WHERE id='${published.receipt_id}';`);
 check(!JSON.stringify(event).includes(v.hashes[0].token_hash)&&event.child_receipts[0].message_id===v.message,'Publication retains only original record/Rail references, never a credential verifier');
 for(const role of ['anon','authenticated'])refused(publish(v),'42501',role);
 for(const patch of [{actor:randomUUID()},{tenant:randomUUID()},{operation:randomUUID()}])refused(publish(v,patch),'42501');
 refused(publish(v,{digest:'0'.repeat(64)}),'22023');
 for(const outcome of ['prepared','unknown','failed']){
  const f=await fixture();f.message=put(f).message_id;
  if(outcome!=='prepared'){json(native(claim(f)));json(native(finalize(f,outcome,null)));}
  refused(publish(f));
  check(count(f)==='0'&&sql(`SELECT status FROM paige_agreements WHERE id='${f.a.id}';`)==='draft','Missing/unknown/failed provider outcome cannot become sent');
 }
 const withdrawn=await acceptedFixture();
 sql(`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
 try{refused(publish(withdrawn),'42501');}finally{sql(`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);}
 check(count(withdrawn)==='0'&&json(native(`SELECT read_comms_email_send_result('${actor}','${tenant}','${withdrawn.g.operation_id}');`)).provider_receipt_available,'Authority withdrawal blocks new record activation without erasing original provider facts');
 const voided=await acceptedFixture();
 check(json(context+`SELECT void_agreement_signing('${tenant}','${voided.a.id}');`).ok===true,'Original authorized void remains available after real message acceptance');
 refused(publish(voided));check(count(voided)==='0'&&sql(`SELECT status FROM paige_agreements WHERE id='${voided.a.id}';`)==='voided','Publication never revives original voided access');
 // Recording the result of an ALREADY accepted action is not a fresh send and
 // must not renew an expired approval or claim that no provider effect occurred.
 sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${v.s.work_id}';
  UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${v.pending.confirmation_id}';`);
 check(json(native(publish(v))).receipt_id===published.receipt_id&&count(v)==='1','Expired execution lease does not discard or duplicate the original accepted record');
 const currentAgreement=json(`SELECT jsonb_build_object('version',version,'sha256',content_sha256,'storage_key',content_storage_key) FROM paige_agreements WHERE id='${v.a.id}';`);
 const signature=`SELECT _record_agreement_signature(${q(v.hashes[0].token_hash)},${currentAgreement.version},${q(currentAgreement.sha256)},${q(currentAgreement.storage_key)},'Original recipient',NULL,true,true,'synthetic-consent',1,repeat('a',64),NULL,'synthetic-local-proof');`;
 refused(signature);
 check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${v.a.id}' AND status='signed';`)==='0','Publication does not bypass the prepared signature/field hold');
 refused(`UPDATE paige_agreements SET sealed_storage_key='synthetic-never-uploaded.pdf',sealed_sha256=repeat('a',64),status='completed' WHERE id='${v.a.id}'`);
 check(sql(`SELECT sealed_storage_key IS NULL AND status='sent' FROM paige_agreements WHERE id='${v.a.id}';`)==='t','No fabricated completed file or service/payment outcome');
 const concurrent=await acceptedFixture(),tag='e04_publish_'+randomUUID().replaceAll('-','');
 const first=startSession(tag+'holder','BEGIN;SET LOCAL ROLE service_role;'+publish(concurrent)+'SELECT pg_sleep(1.5);COMMIT;');sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'holder')} AND wait_event='PgSleep');`);
 const second=startSession(tag+'reader',native(publish(concurrent)));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([first,second]),a=JSON.parse(left),b=JSON.parse(right);
 check(a.receipt_id===b.receipt_id&&a.replayed!==b.replayed&&count(concurrent)==='1','Two real sessions serialize publication and retain one real event identity');
 const raced=await acceptedFixture(),voidTag='e04_publish_void_'+randomUUID().replaceAll('-','');
 const holder=startSession(voidTag+'holder','BEGIN;'+context+`SELECT void_agreement_signing('${tenant}','${raced.a.id}');SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(voidTag+'holder')} AND wait_event='PgSleep');`);
 const reader=startSession(voidTag+'reader',native(`DO $proof$ BEGIN BEGIN ${publish(raced).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected post-wait void refusal';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(voidTag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [,answer]=await Promise.all([holder,reader]);check(answer==='refused'&&count(raced)==='0','Observed concurrent void wins without a false sent record');
 check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)');")===originalSignature,'Original signature engine is unchanged after all publication controls');
 let fieldSignature=null;
 if(process.argv.includes('--prepared-field-signatures')){
  const {provePreparedFieldSignature}=await import('./prepared-field-signature-proof.mjs');
  fieldSignature=await provePreparedFieldSignature({sql,q,acceptedFixture,publish});
 }
 return {checks,concurrentSessions:sessions,observedLockWaits:waits,originalSignature,fieldSignature,proofBodySha256:createHash('sha256').update(provePreparedSignatureCompletion.toString()).digest('hex'),scope:'Original local publication and closed signature/seal fences with explicit synthetic provider input; no complete signing/provider/customer acceptance'};
}
