import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

// Last in the ORIGINAL isolated native chain. This restricts only the original
// E04 source constructor; the original Work engine and all prior controls run.
export async function provePreparedWorkEligibility({sql,read,tenant,actor,quote:q,fixture,issue,claim,startSession,observe}){
 let checks=0,sessions=0,waits=0;const check=(v,m)=>{assert(v,m);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const body=()=>sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='private.e04_prepared_confirmation_source(uuid,uuid,jsonb)'::regprocedure;");
 const others=()=>sql("SELECT jsonb_agg(jsonb_build_object('oid',oid,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'names',proargnames,'defaults',pronargdefaults,'result',prorettype) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_paige_durable_work','transition_paige_durable_work','_sales_invoice_actor','_issue_prepared_agreement_confirmation','_claim_prepared_agreement_confirmation','_read_prepared_agreement_confirmation','_read_prepared_agreement_work','_read_prepared_agreement_request_status');");
 const stamp=others();check(body()==='8f14988369b520427da5f663d37ce00f','Exact original private source before restriction');
 const migration=process.argv.includes('--prepared-work-eligibility-baseline')?null:read('supabase/migrations/20271114280004_e04_prepared_work_availability.sql');
 if(migration){sql(migration);sql(migration);}
 const refused=command=>sql(native(`DO $proof$ BEGIN BEGIN ${command.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected unavailable Work cohort refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;`));
 for(const status of ['trial','past_due','suspended','cancelled']){
  const v=await fixture(),ready=await fixture();json(native(issue(ready)));
  const prior=sql(`SELECT count(*) FROM paige_pending_confirmations WHERE args->>'operation_id'='${v.operation}';`);
  sql(`UPDATE tenants SET status=${q(status)} WHERE id='${tenant}';`);
  try{
   refused(issue(v));check(sql(`SELECT count(*) FROM paige_pending_confirmations WHERE args->>'operation_id'='${v.operation}';`)===prior,`${status} cannot issue HIGH review`);
   refused(claim(ready));check(sql(`SELECT consumed_at IS NULL FROM paige_pending_confirmations WHERE args->>'operation_id'='${ready.operation}';`)==='t',`${status} cannot consume HIGH review`);
  }finally{sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);}
 }
 const active=await fixture(),nonce=randomUUID(),issued=json(native(issue(active)));
 check(Number.isFinite(Date.parse(issued.expires_at))&&json(native(`SELECT public._read_prepared_agreement_confirmation('${actor}','${tenant}','${active.operation}');`)).state==='proposed','Active canonical tenant can prepare the original HIGH review');
 const consumed=json(native(claim(active,nonce)));check(!!consumed?.confirmation_id,'Active original review can be consumed deliberately');
 const audit=randomUUID(),payload={capability:'agreement_send',decision:'execute',risk:'high',lane_effective:'confirm',operation_id:active.operation,request_sha256:active.args.request_sha256};
 sql(`INSERT INTO paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload) VALUES('${audit}','${actor}','sales:owner','${tenant}','sales.agreement_signature_request_governed_decision','agreement','${active.a.id}',${q(JSON.stringify(payload))}::jsonb);`);
 const work=json(native(`SELECT public._register_prepared_agreement_work('${actor}','${tenant}','${consumed.confirmation_id}','${nonce}',${q(active.fp)},'${audit}');`));
 check(!!work.work_id,'Original creator still accepts a current active agreement request');
 sql(`UPDATE tenants SET status='past_due' WHERE id='${tenant}';`);
 try{const historical=json(native(`SELECT public._read_prepared_agreement_request_status('${actor}','${tenant}','${active.operation}',${q(active.args.request_sha256)});`));
  check(historical.work_id===work.work_id&&historical.state==='prepared','Historical result remains readable under the original Sales read cohort; no new Work admission');
 }finally{sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);}
 check(others()===stamp,'All original Work, actor, issue, claim, read and ABI/grant bodies are preserved');
 const tag='e04_work_'+randomUUID().replaceAll('-','').slice(0,16),v=await fixture();json(native(issue(v)));
 const blocker=startSession(tag+'_status',`BEGIN;UPDATE tenants SET status='past_due' WHERE id='${tenant}';SELECT pg_sleep(0.8);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'_status')} AND wait_event='PgSleep');`);
 const denied=startSession(tag+'_claim',native(`DO $proof$ BEGIN BEGIN ${claim(v).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected current cohort refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions+=2;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'_claim')} AND wait_event_type='Lock');`);waits++;
 try{const [,result]=await Promise.all([blocker,denied]);check(result==='refused','Committed status withdrawal wins after actual tenant-row lock wait');
  check(sql(`SELECT consumed_at IS NULL FROM paige_pending_confirmations WHERE args->>'operation_id'='${v.operation}';`)==='t','Waited refusal preserves original unconsumed HIGH review');
 }finally{sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);}
 check(sql("SELECT has_function_privilege('service_role','private.e04_prepared_confirmation_source(uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','private.e04_prepared_confirmation_source(uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('anon','private.e04_prepared_confirmation_source(uuid,uuid,jsonb)','EXECUTE');")==='f','No direct private preflight grant');
  let managedEmail=null;
  if(process.argv.includes('--prepared-managed-email')){
   const {provePreparedManagedEmail}=await import('./prepared-managed-email-proof.mjs');
   managedEmail=await provePreparedManagedEmail({sql,read,tenant,actor,quote:q,fixture,issue,claim});
  }
  return {result:'PASS',checks,migrationReplay:migration?2:0,concurrentSessions:sessions,observedLockWaits:waits,source:body(),managedEmail,
  migrationSha256:migration?createHash('sha256').update(migration).digest('hex'):null,
  scope:'Original issue/claim restriction under the original tenant lock. Synthetic native scope only; subscription-trial enrollment mapping and authenticated billing/cohort acceptance remain separate evidence.'};
}
