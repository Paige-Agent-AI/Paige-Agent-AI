import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {commsEmailContentDigest} from '../../supabase/functions/_shared/comms-email/contract.ts';

// The original database, original canonical Comms/approval/Work/Rail bodies.
// Provider ids below are explicit synthetic local fixtures; no external call.
export async function provePreparedMessageAdmission({sql,read,q,tenant,actor,approved,governance,origin,startSession,observe,commercial,context}){
 let checks=0,sessions=0,waits=0;const native=s=>'SET ROLE service_role;'+s;
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const check=(v,m)=>{assert(v,m);checks++;};
 const refused=(s,code='42501',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected original agreement-message refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const source=read('scripts/agreements/prepared-message-admission-proof.mjs');
 check(provePreparedMessageAdmission.toString()===source.slice(source.indexOf('export async function provePreparedMessageAdmission')+'export '.length).trim(),'Exact executed admission proof retained');
 const protectedBodies=()=>sql("SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_comms_email_actor','finalize_comms_email_send','read_comms_email_send_result','_comms_email_reconcilable','_comms_email_sendgrid_sender_verified','record_capability_run','_record_workspace_rail_event');");
 const original=protectedBodies();
 const fixture=async(provided)=>{const v=provided??await approved(),g=governance(v),s=json(origin(g,true)),r=s.message;
  sql(`UPDATE channel_connectors SET from_address=${q(s.sender.from_address)} WHERE id='${v.connector}';
   INSERT INTO tenant_email_domains(tenant_id,domain,sendgrid_status,sendgrid_domain_id,sendgrid_verified_at)
    SELECT '${tenant}',split_part(${q(s.sender.from_address)},'@',2),'verified','synthetic-local-domain',clock_timestamp()
    WHERE NOT EXISTS(SELECT 1 FROM tenant_email_domains WHERE tenant_id='${tenant}' AND domain=split_part(${q(s.sender.from_address)},'@',2));`);
  return {...v,g,s,digest:await commsEmailContentDigest({recipient:r.to,connectorId:s.sender.connector_id,subject:r.subject,bodyText:r.body_text})};};
 const prepare=(v,patch={})=>{const b={operation:v.g.operation_id,client:v.s.client_id,to:v.s.message.to,connector:v.s.sender.connector_id,from:v.s.sender.from_address,subject:v.s.message.subject,text:v.s.message.body_text,html:v.s.message.body_html,digest:v.digest,command:v.s.command,governance:v.g,...patch};return `SELECT prepare_comms_email_send('${actor}','${tenant}','${b.operation}','${b.client}',${q(b.to)},'${b.connector}',${q(b.from)},${q(b.subject)},${q(b.text)},${q(b.html)},${q(b.digest)},${q(JSON.stringify(b.command))}::jsonb,${q(JSON.stringify(b.governance))}::jsonb);`;};
 const put=v=>json(native(prepare(v)));
 const claim=(v,reconcile=false)=>`SELECT claim_comms_email_send('${v.message}','${v.g.operation_id}',${reconcile});`;
 const result=v=>json(native(`SELECT read_comms_email_send_result('${actor}','${tenant}','${v.g.operation_id}');`));
 const finalize=(v,outcome='provider_accepted',provider='synthetic-local-provider-receipt',attempt=1)=>`SELECT finalize_comms_email_send('${v.message}','${v.g.operation_id}',${q(outcome)},${provider===null?'NULL':q(provider)},NULL,${attempt});`;
 const count=v=>sql(`SELECT count(*) FROM messages WHERE meta#>>'{comms_email_binding,governance,agreement_work_id}'='${v.s.work_id}';`);
 const v=await fixture(),p=put(v);v.message=p.message_id;
 check(p.ok&&p.state==='prepared'&&!p.replayed,'Original canonical prepare accepts the exact ORIGINAL HIGH agreement source');
 check(put(v).message_id===v.message&&put(v).replayed&&count(v)==='1','Exact transport replay retains the one original message');
 const b=json(native(`SELECT read_comms_email_send_binding('${v.message}');`));
 check(b.eligible&&b.agreement_source.work_id===v.s.work_id&&b.agreement_source.sender.from_address===v.s.sender.from_address,'Same canonical read returns actual original agreement/sender source');
 check(b.governance.tool==='agreement_send'&&b.governance.approval_channel==='chat-canonical'&&b.approval_id===null,'Agreement HIGH decision is not relabeled or copied into a PPA');
 check(!JSON.stringify(b).includes(v.hashes[0].token_hash),'Canonical message/read projection never contains the protected signer verifier');
 for(const patch of [{text:'Changed approved words'},{html:'<p>Changed</p>'},{subject:'Changed'},{to:'other@example.test'},{client:randomUUID()},{connector:randomUUID()},{from:'other@example.test'},{command:{...v.s.command,action:'comms.email_send'}}]){
  const f=await fixture();refused(prepare(f,patch),'40001');check(count(f)==='0','Changed exact source leaves no message');
 }
 for(const role of ['anon','authenticated'])refused(prepare(v),'42501',role);
 const duplicate=structuredClone(v);duplicate.g.operation_id=randomUUID();duplicate.s.command.operation_id=duplicate.g.operation_id;
 refused(prepare(duplicate),'55000');check(count(v)==='1','A second child intent cannot duplicate an approved signer request');
 const noContact=await fixture();
 const methodWhere=`tenant_id='${tenant}' AND client_id='${noContact.s.client_id}' AND kind='email' AND lower(trim(value))=${q(noContact.s.message.to)}`;
 const originalMethods=json(`SELECT coalesce(jsonb_agg(to_jsonb(cm) ORDER BY id),'[]'::jsonb) FROM client_contact_methods cm WHERE ${methodWhere};`);
 try{
  sql(`DELETE FROM client_contact_methods WHERE ${methodWhere};`);
  noContact.message=put(noContact).message_id;
  check(json(native(claim(noContact))).admitted===true,'Original approved signer is valid without inventing a CRM contact method');
  check(json(native(claim(noContact))).admitted===false,'Only one original message claim can dispatch');
  json(native(finalize(noContact)));const done=result(noContact);
  check(done.outcome==='provider_accepted'&&done.provider_receipt_available===true&&done.delivery_confirmed===false,'Synthetic native provider acceptance remains distinct from actual delivery or signing');
  check(sql(`SELECT count(*) FROM paige_workspace_events WHERE source_id='${noContact.g.operation_id}' AND capability_key='comms_send_email';`)==='1','The ORIGINAL native Rail records the actual canonical message operation once');
 }finally{
  // Restore the original LOCAL fixture rows. Later original agreement seeders
  // must not be deprived of their source email by this one negative-contact case.
  sql(`INSERT INTO client_contact_methods SELECT * FROM jsonb_populate_recordset(NULL::client_contact_methods,${q(JSON.stringify(originalMethods))}::jsonb);`);
 }
 assert.deepEqual(json(`SELECT coalesce(jsonb_agg(to_jsonb(cm) ORDER BY id),'[]'::jsonb) FROM client_contact_methods cm WHERE ${methodWhere};`),originalMethods);checks++;
 const uncertain=await fixture();uncertain.message=put(uncertain).message_id;json(native(claim(uncertain)));json(native(finalize(uncertain,'unknown',null)));
 check(result(uncertain).outcome==='unknown'&&result(uncertain).reconcilable===false,'Original native unknown state does not inherit Resend retry permission or claim a provider result');
 check(json(native(claim(uncertain,true))).admitted===false&&json(native(claim(uncertain))).admitted===false,'Uncertain SendGrid outcome never authorizes another provider attempt');
 const retired=await fixture();retired.message=put(retired).message_id;json(native(claim(retired)));
 sql(`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
 try{check(json(native(finalize(retired))).outcome==='provider_accepted','Actual attempted outcome survives later actor retirement');refused(`SELECT read_comms_email_send_result('${actor}','${tenant}','${retired.g.operation_id}');`);}finally{sql(`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);}
 check(result(retired).provider_receipt_available,'Current original owner can inspect saved outcome after authorized role restoration');
 const expired=await fixture();expired.message=put(expired).message_id;sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${expired.s.work_id}';`);refused(claim(expired));
 check(result(expired).outcome==='prepared','Expired admission does not fake a dispatch or completed effect');
 const concurrent=await fixture(),other=structuredClone(concurrent);other.g.operation_id=randomUUID();other.s.command.operation_id=other.g.operation_id;
 const createTag='e04_message_create_'+randomUUID().replaceAll('-','');
 const creator=startSession(createTag+'holder','BEGIN;SET LOCAL ROLE service_role;'+prepare(concurrent)+'SELECT pg_sleep(1.5);COMMIT;');sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(createTag+'holder')} AND wait_event='PgSleep');`);
 const loser=startSession(createTag+'reader',native(`DO $proof$ BEGIN BEGIN ${prepare(other).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected distinct transport refusal';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(createTag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [,createReply]=await Promise.all([creator,loser]);check(createReply==='refused'&&count(concurrent)==='1','Two actual transport intents serialize on ORIGINAL agreement and retain exactly one signer message');
 const waited=await fixture();waited.message=put(waited).message_id;
 sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()+interval '5 seconds' WHERE id='${waited.s.work_id}';`);
 const tag='e04_message_'+randomUUID().replaceAll('-','');
 const held=startSession(tag+'holder',`BEGIN;SELECT id FROM channel_connectors WHERE id='${waited.connector}' FOR UPDATE;SELECT pg_sleep(6);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'holder')} AND wait_event='PgSleep');`);
 const receiving=startSession(tag+'reader',native(`DO $proof$ BEGIN BEGIN ${claim(waited).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected expired post-connector-wait approval';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [,reply]=await Promise.all([held,receiving]);check(reply==='refused','Original approval/lease is revalidated after OBSERVED connector wait');
 check(result(waited).outcome==='prepared','Post-wait refusal leaves the original message unclaimed');
 const voided=await fixture();voided.message=put(voided).message_id;json(native(claim(voided)));
 check(json(context+`SELECT void_agreement_signing('${tenant}','${voided.a.id}');`).ok===true,'Original owner can void after admission but before a provider call');
 refused(`SELECT read_comms_email_send_binding('${voided.message}');`,'40001');
 check(result(voided).outcome==='dispatching'&&result(voided).provider_receipt_available===false,'Post-claim void blocks provider readiness and preserves truthful unresolved original attempt');
 const cv=await fixture(commercial);cv.message=put(cv).message_id;
 check(json(native(claim(cv))).admitted===true,'Exact original commercial request uses SAME canonical message claim');
 check(sql(`SELECT commercial_presentation->'payload'=${q(JSON.stringify(commercial.manifest.commercial.payload))}::jsonb FROM paige_agreements WHERE id='${cv.a.id}';`)==='t','Canonical commercial economics remain exactly the retained original payload, never recalculated');
 check(protectedBodies()===original,'Original actor/finalizer/result/reconciliation/verified sender/Rail bodies and grants remain exact');
 let completion=null;
 if(process.argv.includes('--prepared-signature-completion')){
  assert.equal(checks,47,'All original canonical message controls must precede signing completion');
  console.log(JSON.stringify({checkpoint:'Original complete message admission before signing completion',checks}));
  const {provePreparedSignatureCompletion}=await import('./prepared-signature-completion-proof.mjs');
  completion=await provePreparedSignatureCompletion({sql,read,q,tenant,actor,fixture,put,claim,finalize});
 }
 return {checks,concurrentSessions:sessions,observedLockWaits:waits,completion,proofBodySha256:createHash('sha256').update(provePreparedMessageAdmission.toString()).digest('hex'),scope:'Actual local native canonical message prepare/claim/finalize and synthetic provider facts only; no mounted caller, sender/provider call or authenticated customer acceptance'};
}
