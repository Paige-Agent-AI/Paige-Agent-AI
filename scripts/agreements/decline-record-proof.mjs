// Original decline transaction in the existing task-owned native proof only.
// A local race is engineering evidence, never a production/customer finding.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

export async function proveDeclineRecord({sql,read,tenant,fresh,quote,startSession,observe,applyMigration=true}){
  let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
  const json=input=>JSON.parse(sql(input));
  // Match production's actual pgcrypto namespace and exact original function,
  // rather than accidentally proving the older fixture's public.digest version.
  sql('CREATE SCHEMA IF NOT EXISTS extensions;ALTER EXTENSION pgcrypto SET SCHEMA extensions;');
  const original=read('supabase/migrations/20271110040000_fix_pgcrypto_search_path_signing.sql');
  const from=original.indexOf('CREATE OR REPLACE FUNCTION public.decline_agreement_signing(');
  const to=original.indexOf('-- accept_invitation:',from);
  assert(from>=0&&to>from);sql(original.slice(from,to));
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.decline_agreement_signing(text,text)'::regprocedure;")==='654e4364555e35ee4e0d47601aea0754','Exact production decline body reproduced before repair');
  if(applyMigration){const migration=read('supabase/migrations/20271114100004_e04_decline_act_time.sql');sql(migration);sql(migration);}
  const source=()=>{
    const a=fresh(),token=createHash('sha256').update(randomUUID()).digest('hex');
    const hash=createHash('sha256').update(token).digest('hex');
    const s=json(`SELECT row_to_json(s) FROM paige_agreement_signers s WHERE agreement_id='${a.id}' ORDER BY signing_order,id LIMIT 1;`);
    sql(`UPDATE paige_agreements SET status='sent',content_sha256=repeat('a',64),content_storage_key='${tenant}/${a.id}/original.pdf',expires_at=clock_timestamp()+interval '1 day' WHERE id='${a.id}';
      UPDATE paige_agreement_signers SET token_hash='${hash}',token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${s.id}';`);
    return {a,s,token,hash};
  };
  const command=(v,reason='Synthetic decline reason')=>`SELECT public.decline_agreement_signing(${quote(v.token)},${quote(reason)});`;
  const eventCount=v=>Number(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${v.a.id}' AND event_type='declined';`));
  const race=async(label,table,mutation)=>{
    const v=source(),tag='decline_'+label+'_'+randomUUID().replaceAll('-','');
    const holder=startSession(tag+'hold',`BEGIN;UPDATE ${table} SET ${mutation} WHERE id='${table==='paige_agreements'?v.a.id:v.s.id}';SELECT pg_sleep(1.5);COMMIT;`);
    await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'hold')} AND wait_event='PgSleep');`);
    const waiting=startSession(tag+'act','SET ROLE anon;'+command(v));
    await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'act')} AND wait_event_type='Lock');`);
    const [,answer]=await Promise.all([holder,waiting]);checks++;
    console.log(JSON.stringify({checkpoint:'Original native decline race',label,reply:JSON.parse(answer),
      agreementStatus:sql(`SELECT status FROM paige_agreements WHERE id='${v.a.id}';`),
      signerStatus:sql(`SELECT status FROM paige_agreement_signers WHERE id='${v.s.id}';`),declinedEvents:eventCount(v)}));
    check(JSON.parse(answer).ok===false,'Concurrent '+label+' must refuse the decline after the observed lock wait');
    check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${v.s.id}';`)==='pending','Refused '+label+' cannot change the original signer');
    check(eventCount(v)===0,'Refused '+label+' cannot claim a declined event');
    return v;
  };
  // The baseline must reach a real wait and the consequential stale-read defect.
  // Keep this before the remaining new controls so a setup failure is not a RED.
  const voided=await race('void','paige_agreements',"status='voided'");
  check(sql(`SELECT status FROM paige_agreements WHERE id='${voided.a.id}';`)==='voided','The actual prior void remains authoritative');
  await race('credential_expiry','paige_agreement_signers',"token_expires_at=clock_timestamp()+interval '500 milliseconds'");
  await race('revocation','paige_agreement_signers','token_revoked_at=clock_timestamp()');
  await race('agreement_expiry','paige_agreements',"expires_at=clock_timestamp()+interval '500 milliseconds'");
  const declined=source(),receipt=json('SET ROLE anon;'+command(declined));
  check(receipt.ok===true&&Object.keys(receipt).join(',')==='ok','The original anonymous token contract returns only its actual acknowledgement');
  const retained=json(`SELECT jsonb_build_object('agreement_status',a.status,'signer_status',s.status,'agreement_at',a.declined_at,'signer_at',s.declined_at,'reason',s.decline_reason,'revoked_at',s.token_revoked_at,'signed_at',s.signed_at,'consent_at',s.esign_consent_at) FROM paige_agreements a JOIN paige_agreement_signers s ON s.agreement_id=a.id WHERE s.id='${declined.s.id}';`);
  check(retained.agreement_status==='declined'&&retained.signer_status==='declined','One decision changes the original agreement and recipient together');
  check(retained.agreement_at===retained.signer_at&&retained.signer_at===retained.revoked_at,'One actual act timestamp covers the decision and credential closure');
  check(retained.reason==='Synthetic decline reason'&&retained.signed_at===null&&retained.consent_at===null,'Decline records its reason, never signature or electronic consent');
  check(eventCount(declined)===1,'Exactly one original decline event');
  check(json('SET ROLE authenticated;'+command(declined)).ok===false&&eventCount(declined)===1,'Revoked-token replay cannot create or recover a second decline');
  const event=json(`SELECT row_to_json(e) FROM paige_agreement_events e WHERE agreement_id='${declined.a.id}' AND event_type='declined';`);
  check(event.tenant_id===tenant&&event.signer_id===declined.s.id&&event.actor_kind==='signer'&&event.actor_email===declined.s.email,'Original event identity comes only from the token-derived records');
  check(event.created_at===retained.signer_at&&event.detail.reason===retained.reason,'Retained event uses the actual same decision time and bounded reason');
  for(const token of [null,'bad','f'.repeat(64),'A'.repeat(64)]){
    const input=token===null?'NULL':quote(token);
    check(json(`SET ROLE anon;SELECT public.decline_agreement_signing(${input},NULL);`).ok===false,'Invalid/unknown token has the same uniform refusal');
  }
  for(const [table,mutation] of [['paige_agreements',"status='voided'"],['paige_agreements',"expires_at=clock_timestamp()-interval '1 second'"],['paige_agreement_signers',"token_expires_at=clock_timestamp()-interval '1 second'"],['paige_agreement_signers','token_revoked_at=clock_timestamp()']]){
    const v=source();sql(`UPDATE ${table} SET ${mutation} WHERE id='${table==='paige_agreements'?v.a.id:v.s.id}';`);
    check(json('SET ROLE anon;'+command(v)).ok===false&&eventCount(v)===0,'Current source/credential refusal leaves no decision event');
  }
  const simultaneous=source(),tag='decline_pair_'+randomUUID().replaceAll('-','');
  const first=startSession(tag+'first','BEGIN;SET ROLE anon;'+command(simultaneous)+'SELECT pg_sleep(1.5);COMMIT;');
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'first')} AND wait_event='PgSleep');`);
  const second=startSession(tag+'second','SET ROLE anon;'+command(simultaneous));
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'second')} AND wait_event_type='Lock');`);checks++;
  const [firstReply,secondReply]=await Promise.all([first,second]);
  check(JSON.parse(firstReply).ok===true&&JSON.parse(secondReply).ok===false&&eventCount(simultaneous)===1,'Concurrent duplicate records only the original single decision');
  const signCommand=v=>`SELECT public._record_agreement_signature('${v.hash}',${v.a.version},repeat('a',64),'${tenant}/${v.a.id}/original.pdf','Synthetic Signer',NULL,true,true,'esign-consent',1,repeat('c',64),'127.0.0.1'::inet,'Synthetic decline race proof');`;
  const signed=source(),signTag='decline_signed_'+randomUUID().replaceAll('-','');
  const signing=startSession(signTag+'sign','BEGIN;SET ROLE service_role;'+signCommand(signed)+'SELECT pg_sleep(1.5);COMMIT;');
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(signTag+'sign')} AND wait_event='PgSleep');`);
  const lateDecline=startSession(signTag+'decline','SET ROLE anon;'+command(signed));
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(signTag+'decline')} AND wait_event_type='Lock');`);checks++;
  const [,lateAnswer]=await Promise.all([signing,lateDecline]);
  check(JSON.parse(lateAnswer).ok===false&&eventCount(signed)===0,'Committed original signature wins over the waiting decline');
  check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${signed.s.id}';`)==='signed','Decline never rewrites a recorded signature');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${signed.s.id}' AND event_type IN ('signed','consented');`)==='2','Original signature/consent audit pair remains exact');
  const declinedFirst=source(),declineTag='decline_first_'+randomUUID().replaceAll('-','');
  const declining=startSession(declineTag+'decline','BEGIN;SET ROLE anon;'+command(declinedFirst)+'SELECT pg_sleep(1.5);COMMIT;');
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(declineTag+'decline')} AND wait_event='PgSleep');`);
  const lateSignature=startSession(declineTag+'sign','SET ROLE service_role;DO $proof$ BEGIN BEGIN '+signCommand(declinedFirst).replace(/^SELECT /,'PERFORM ')+"RAISE EXCEPTION 'Expected revoked signing refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;");
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(declineTag+'sign')} AND wait_event_type='Lock');`);checks++;
  await Promise.all([declining,lateSignature]);
  check(eventCount(declinedFirst)===1&&sql(`SELECT status FROM paige_agreement_signers WHERE id='${declinedFirst.s.id}';`)==='declined','Committed original decline wins over the waiting signature');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${declinedFirst.s.id}' AND event_type IN ('signed','consented');`)==='0','Waiting refused signature cannot produce consent/signature events');
  const bounded=source();check(json('SET ROLE authenticated;'+command(bounded,'x'.repeat(1100))).ok===true,'Original authenticated token caller remains supported');
  check(sql(`SELECT length(s.decline_reason)=1000 AND s.decline_reason=e.detail->>'reason' FROM paige_agreement_signers s JOIN paige_agreement_events e ON e.signer_id=s.id AND e.event_type='declined' WHERE s.id='${bounded.s.id}';`)==='t','Original reason bound applies consistently to the signer and event');
  const failed=source();
  sql("CREATE FUNCTION public._synthetic_decline_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='declined' THEN RAISE EXCEPTION 'Synthetic decline audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END$$;CREATE TRIGGER z_synthetic_decline_audit_failure BEFORE INSERT ON paige_agreement_events FOR EACH ROW EXECUTE FUNCTION public._synthetic_decline_audit_failure();");
  try{
    sql('SET ROLE anon;DO $proof$ BEGIN BEGIN '+command(failed).replace(/^SELECT /,'PERFORM ')+"RAISE EXCEPTION 'Expected original audit failure';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;");checks++;
    check(sql(`SELECT a.status='sent' AND s.status='pending' AND a.declined_at IS NULL AND s.declined_at IS NULL AND s.token_revoked_at IS NULL FROM paige_agreements a JOIN paige_agreement_signers s ON s.agreement_id=a.id WHERE s.id='${failed.s.id}';`)==='t'&&eventCount(failed)===0,'Audit failure rolls back the original decision and every token revocation');
  }finally{sql('DROP TRIGGER z_synthetic_decline_audit_failure ON paige_agreement_events;DROP FUNCTION public._synthetic_decline_audit_failure();');}
  const identity='public.decline_agreement_signing(text,text)';
  const meta=json(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'config',proconfig,'defaults',pronargdefaults,'definer',prosecdef,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'),'args',pg_get_function_identity_arguments(oid)) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
  check(meta.owner==='proofrunner'&&meta.definer&&meta.defaults===1&&meta.anon&&meta.authenticated&&!meta.service&&meta.args==='_token text, _reason text'&&meta.config.includes('search_path=public, pg_temp'),'Original ABI, owner, definer, search path and role permissions remain exact');
  const exact=sql("SELECT pg_get_functiondef('public.decline_agreement_signing(text,text)'::regprocedure);");
  sql(exact.replace('BEGIN','BEGIN\n  -- Synthetic later writer, only in this disposable proof.'));
  assert.throws(()=>sql(read('supabase/migrations/20271114100004_e04_decline_act_time.sql')),/Original agreement decline contract changed/);checks++;
  sql(exact);
  return {result:'PASS',checks,migrationReplay:2,forwardGuardRefusals:1,concurrentSessions:14,observedLockWaits:7,scope:'Same original native proof; no hosted decline/customer acceptance or public recovery privilege'};
}
