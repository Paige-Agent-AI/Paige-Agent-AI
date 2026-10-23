// Additional original-engine cases in the EXISTING fenced native cluster.
// No hosted signature, real token, customer, sender or separate receipt store.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';

export async function proveSignatureRecord({sql,read,tenant,fresh,quote,startSession,observe}){
  let checks=0;const check=(value,message)=>{assert(value,message);checks++;};
  const q=value=>value===null?'NULL':quote(value),json=input=>JSON.parse(sql(input));
  const migration=read('supabase/migrations/20271113480004_e04_atomic_original_signature.sql');sql(migration);sql(migration);
  const source=()=>{
    const a=fresh(),token=createHash('sha256').update(randomUUID()).digest('hex');
    const s=json(`SELECT row_to_json(s) FROM paige_agreement_signers s WHERE agreement_id='${a.id}' ORDER BY signing_order LIMIT 1;`);
    sql(`UPDATE paige_agreements SET status='sent',content_sha256=repeat('a',64),content_storage_key='${tenant}/${a.id}/original.pdf',expires_at=clock_timestamp()+interval '1 day' WHERE id='${a.id}';
      UPDATE paige_agreement_signers SET token_hash='${token}',token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${s.id}';`);
    return {a,s,token};
  };
  const command=(v,patch={})=>{const p={token:v.token,version:v.a.version,hash:'a'.repeat(64),key:`${tenant}/${v.a.id}/original.pdf`,name:'Synthetic Signer',image:null,read:true,esign:true,slug:'esign-consent',consentVersion:1,consentHash:'c'.repeat(64),ip:'127.0.0.1',ua:'Synthetic native proof',...patch};return `SELECT public._record_agreement_signature(${q(p.token)},${p.version},${q(p.hash)},${q(p.key)},${q(p.name)},${q(p.image)},${p.read},${p.esign},${q(p.slug)},${p.consentVersion},${q(p.consentHash)},${q(p.ip)}::inet,${q(p.ua)});`;};
  const record=(v,patch={})=>json('SET ROLE service_role;'+command(v,patch));
  const refuse=(v,patch={},code='23514',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${command(v,patch).replace(/^SELECT /,'PERFORM ')}RAISE EXCEPTION 'Expected native refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
  const first=source(),receipt=record(first);
  check(receipt.state==='recorded'&&receipt.replayed===false&&receipt.audit_complete===true,'One signature and actual consent/sign audit events commit together');
  const actual=json(`SELECT row_to_json(s) FROM paige_agreement_signers s WHERE id='${first.s.id}';`);
  check(actual.status==='signed'&&actual.signed_at===actual.esign_consent_at&&actual.typed_name==='Synthetic Signer','One native act timestamp and exact original signer evidence');
  check(receipt.signed_at===actual.signed_at&&receipt.signer_id===first.s.id&&receipt.signing_id===first.a.id,'Receipt describes the actual original row');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${first.s.id}' AND event_type IN ('consented','signed');`)==='2','Exactly two original audit events');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE id IN ('${receipt.consented_event_id}','${receipt.signed_event_id}') AND detail->>'document_sha256'=repeat('a',64);`)==='2','Both real events bind exact retained original presentation');
  const replay=record(first,{name:'A replay cannot replace the accepted name',read:false,esign:false});
  check(replay.replayed&&replay.signed_event_id===receipt.signed_event_id&&replay.consented_event_id===receipt.consented_event_id,'Retry reads same original record; no new signing or invented evidence');
  check(sql(`SELECT typed_name FROM paige_agreement_signers WHERE id='${first.s.id}';`)==='Synthetic Signer','Replay cannot revise accepted signature');
  sql(`SET ROLE service_role;DO $proof$ BEGIN BEGIN UPDATE public.paige_agreement_signers SET typed_name='Changed after signature' WHERE id='${first.s.id}';RAISE EXCEPTION 'Recorded signature evidence must be immutable';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;`);checks++;
  check(sql(`SELECT typed_name FROM paige_agreement_signers WHERE id='${first.s.id}';`)==='Synthetic Signer','Native signed evidence stays exact');
  for(const mutation of ["signature_image_png='changed'","signed_at=clock_timestamp()","esign_consent_at=clock_timestamp()","esign_consent_slug='changed'","esign_consent_version=2","esign_consent_sha256=repeat('b',64)","signing_ip='127.0.0.2'","signing_user_agent='changed'"]){
    sql(`SET ROLE service_role;DO $proof$ BEGIN BEGIN UPDATE public.paige_agreement_signers SET ${mutation} WHERE id='${first.s.id}';RAISE EXCEPTION 'Expected immutable signature refusal';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;`);checks++;
  }
  for(const role of ['anon','authenticated'])refuse(first,{},'42501',role);
  for(const patch of [{token:'f'.repeat(64)},{token:'bad'}])refuse(first,patch,'42501');
  for(const patch of [{hash:'b'.repeat(64)},{version:first.a.version+1},{key:'foreign/original.pdf'},{name:''},{read:false},{esign:false},{consentHash:'bad'},{slug:''},{consentVersion:0}]){
    const v=source();refuse(v,patch);check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${v.s.id}';`)==='pending','Refused action leaves signer unchanged');
    check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${v.s.id}' AND event_type IN ('consented','signed');`)==='0','Refusal leaves no success audit');
  }
  for(const mutation of ["token_revoked_at=clock_timestamp()","token_expires_at=clock_timestamp()-interval '1 second'","token_hash=repeat('e',64)"]){
    const v=source();sql(`UPDATE paige_agreement_signers SET ${mutation} WHERE id='${v.s.id}';`);refuse(v,{},'42501');
  }
  for(const mutation of ["status='voided'","expires_at=clock_timestamp()-interval '1 second'"]){const v=source();sql(`UPDATE paige_agreements SET ${mutation} WHERE id='${v.a.id}';`);refuse(v);}
  const old=source();sql(`UPDATE paige_agreement_signers SET status='signed',signed_at=clock_timestamp(),typed_name='Historical original signer',esign_consent_at=clock_timestamp()-interval '1 second',esign_consent_slug='esign-consent',esign_consent_version=1,esign_consent_sha256=repeat('c',64) WHERE id='${old.s.id}';`);
  const historical=record(old);check(historical.replayed&&historical.audit_complete===false&&historical.consented_event_id===null&&historical.signed_event_id===null,'Missing historical audit stays explicitly missing');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${old.s.id}' AND event_type IN ('consented','signed');`)==='0','Recovery never invents retroactive consent/audit');
  sql(`SET ROLE service_role;DO $proof$ BEGIN BEGIN DELETE FROM paige_agreement_signers WHERE id='${old.s.id}';RAISE EXCEPTION 'Historical recorded signature must not be deleted';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;`);checks++;
  check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${old.s.id}';`)==='signed','Historical recorded signature survives even when original audit is missing');
  const ordered=source();sql(`UPDATE paige_agreement_signers SET signing_order=2 WHERE id='${ordered.s.id}';INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order) VALUES('${ordered.a.id}','${tenant}','Earlier original signer','earlier@example.invalid',1);`);refuse(ordered);
  const atomic=source();
  sql(`CREATE FUNCTION public._synthetic_signature_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event_type='signed' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
    CREATE TRIGGER z_synthetic_signature_event_failure BEFORE INSERT ON paige_agreement_events FOR EACH ROW EXECUTE FUNCTION public._synthetic_signature_event_failure();`);
  try{refuse(atomic);check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${atomic.s.id}';`)==='pending','Audit failure rolls original signature back');
    check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${atomic.s.id}' AND event_type IN ('consented','signed');`)==='0','Audit failure rolls earlier consent event back too');
  }finally{sql('DROP TRIGGER z_synthetic_signature_event_failure ON paige_agreement_events;DROP FUNCTION public._synthetic_signature_event_failure();');}
  const duplicate=source(),tag='signature_'+randomUUID().replaceAll('-','');
  const a=startSession(tag+'a','BEGIN;SET ROLE service_role;'+command(duplicate)+'SELECT pg_sleep(1.5);COMMIT;');
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'a')} AND wait_event='PgSleep');`);
  const b=startSession(tag+'b','SET ROLE service_role;'+command(duplicate));
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'b')} AND wait_event_type='Lock');`);checks++;
  await Promise.all([a,b]);check(sql(`SELECT count(*) FROM paige_agreement_events WHERE signer_id='${duplicate.s.id}' AND event_type IN ('consented','signed');`)==='2','Concurrent duplicate commits only one original event pair');
  for(const [label,table,mutation,code] of [['void','paige_agreements',"status='voided'",'23514'],['revoke','paige_agreement_signers',"token_revoked_at=clock_timestamp()",'42501'],['expire','paige_agreement_signers',"token_expires_at=clock_timestamp()+interval '500 milliseconds'",'42501']]){
    const v=source(),name=tag+label,holder=startSession(name+'hold',`BEGIN;UPDATE ${table} SET ${mutation} WHERE id='${table==='paige_agreements'?v.a.id:v.s.id}';SELECT pg_sleep(1.5);COMMIT;`);
    await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'hold')} AND wait_event='PgSleep');`);
    const waiting=startSession(name+'sign','SET ROLE service_role;DO $proof$ BEGIN BEGIN '+command(v).replace(/^SELECT /,'PERFORM ')+`RAISE EXCEPTION 'Expected original act-time refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);
    await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'sign')} AND wait_event_type='Lock');`);checks++;await Promise.all([holder,waiting]);
    check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${v.s.id}';`)==='pending','Committed concurrent authority change cannot be signed');
  }
  const identity='public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)';
  const meta=json(`SELECT jsonb_build_object('definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
  check(meta.definer===false&&meta.config.includes('search_path=""')&&!meta.anon&&!meta.authenticated&&meta.service,'Service-only invoker uses existing grants, no new definer privilege');
  sql(`SET ROLE service_role;UPDATE paige_agreement_signers SET token_hash=repeat('d',64),token_expires_at=clock_timestamp()+interval '2 days',updated_at=clock_timestamp() WHERE id='${first.s.id}';`);
  check(sql(`SELECT token_hash FROM paige_agreement_signers WHERE id='${first.s.id}';`)==='d'.repeat(64),'Original completed-copy credential maintenance remains allowed');refuse(first,{},'42501');
  return {result:'PASS',checks,migrationReplay:2,concurrentSessions:8,observedLockWaits:4,scope:'Synthetic actual native transactions only; no hosted signature/provider/customer acceptance'};
}
