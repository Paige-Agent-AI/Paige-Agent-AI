import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

// ORIGINAL directory-fenced disposable Agreements DB; actual native Work,
// actor/source/confirmation. Surrounding sessions, audit/mail/Storage are synthetic.
export async function provePreparedSignatureWork({sql,read,tenant,actor,quote,fixture,issue,claim,startSession,observe,fresh,context,client,makeCommercial}) {
 const q=quote,native=s=>'SET ROLE service_role;'+s;
 let checks=0,sessions=0,waits=0;
 const check=(v,m)=>{assert(v,m);checks++;};
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const refused=(s,code='42501',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected native work refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const proofSource=read('scripts/agreements/prepared-signature-work-proof.mjs');
 const body=proofSource.slice(proofSource.indexOf('export async function provePreparedSignatureWork')+'export '.length).trim();
 check(provePreparedSignatureWork.toString()===body,'Executed Work proof equals its exact retained source');
 sql(`CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,audience text,is_archived boolean NOT NULL DEFAULT false);
 CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,tenant_id uuid,action text NOT NULL,target_type text,target_id uuid,payload jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());`);
 const original=read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql');
 const cut=original.indexOf('-- Owner-safe status projection.');assert(cut>0);sql(original.slice(0,cut));
 const latest=read('supabase/migrations/20271108201000_e09_customer_private_chat.sql');
 const start=latest.indexOf('CREATE OR REPLACE FUNCTION public.create_paige_durable_work('),end=latest.indexOf('$function$;',start);
 assert(start>=0&&end>start);sql(latest.slice(start,end+'$function$;'.length));
 check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer)'::regprocedure;")==='693340656ec8ec445cd34c25b3d91d80','Exact deployed Work source retains private-audience and Knowledge guards');
 const originals=()=>sql("SELECT jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_paige_durable_work','transition_paige_durable_work','_sales_invoice_actor','_record_agreement_signature','_paige_preparation_legacy_effect_hold','_paige_preparation_legacy_token_hold','_claim_prepared_agreement_confirmation');");
 const stamp=originals(),migration=read('supabase/migrations/20271114160004_e04_prepared_signature_work.sql');
 if(!process.argv.includes('--prepared-work-baseline')){sql(migration);sql(migration);}
 check(sql("SELECT to_regprocedure('public._register_prepared_agreement_work(uuid,uuid,uuid,uuid,text,uuid)') IS NOT NULL;")==='t','Actual originating native registration exists before adoption');
 check(originals()===stamp,'Migration/replay preserves original Work/signature/authority/hold metadata');
 const metadata=json("SELECT jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'config',proconfig,'defaults',pronargdefaults,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_read_prepared_agreement_work','_register_prepared_agreement_work');");
 check(metadata.length===2&&metadata.every(m=>m.definer&&m.defaults===0&&m.service&&!m.anon&&!m.authenticated&&m.config?.includes('search_path=""')),'New exact native ABI is service-only with empty search path and no defaults');
 const setup=async()=>{
  const v=await fixture();json(native(issue(v)));const nonce=randomUUID(),pending=json(native(claim(v,nonce))),audit=randomUUID();
  const payload={capability:'agreement_send',decision:'execute',risk:'high',lane_effective:'confirm',operation_id:v.operation,request_sha256:v.args.request_sha256};
  sql(`INSERT INTO paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload) VALUES('${audit}','${actor}','sales:owner','${tenant}','sales.agreement_signature_request_governed_decision','agreement','${v.a.id}',${q(JSON.stringify(payload))}::jsonb);`);
  return {...v,pending,nonce,audit};
 };
 const register=(v,patch={})=>{const a={actor,tenant,confirmation:v.pending.confirmation_id,nonce:v.nonce,fingerprint:v.fp,audit:v.audit,...patch};return `SELECT public._register_prepared_agreement_work('${a.actor}','${a.tenant}','${a.confirmation}','${a.nonce}',${q(a.fingerprint)},'${a.audit}');`;};
 const readWork=(v,digest=v.args.request_sha256)=>`SELECT public._read_prepared_agreement_work('${actor}','${tenant}','${v.operation}',${q(digest)});`;
 const v=await setup(),before=sql('SELECT count(*) FROM paige_agreement_events;');
 check(json(native(readWork(v)))===null,'Missing Work is not success or repeat permission');
 const result=json(native(register(v)));
 check(result.kind==='prepared_signature_work'&&result.execution==='unavailable'&&result.work_status==='claimed','Reports original Work only, never sending/signing/payment');
 check(result.work_id===json(native(register(v))).work_id,'Exact replay returns same Work');
 check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${v.operation}';`)==='1','One original obligation on replay');
 const stored=json(`SELECT jsonb_build_object('capability',capability_key,'kind',work_kind,'attempts',max_attempts,'context',authority_context) FROM paige_durable_work WHERE intent_id='${v.operation}';`);
 check(stored.capability==='agreement.send'&&stored.kind==='agreement_signature_request'&&stored.attempts===1,'Original capability/kind with one attempt');
 check(!JSON.stringify(stored.context).includes('Synthetic reviewed words')&&!JSON.stringify(stored.context).includes('body_html'),'Work contains references rather than copied messages');
 check(sql('SELECT count(*) FROM paige_agreement_events;')===before,'No signature/document/agreement effect');
 check(json(native(readWork(v))).work_id===result.work_id,'Read retains original scope-bound identity');
 refused(readWork(v,'0'.repeat(64)),'22023');
 for(const role of ['anon','authenticated']){refused(register(v),'42501',role);refused(readWork(v),'42501',role);}
 for(const patch of [{confirmation:randomUUID()},{nonce:randomUUID()},{fingerprint:'0'.repeat(16)},{audit:randomUUID()},{actor:randomUUID()},{tenant:randomUUID()}])refused(register(v,patch));
 for(const [key,value]of [['decision','propose'],['risk','ordinary'],['operation_id',randomUUID()],['request_sha256','0'.repeat(64)]]){
  const bad=await setup();sql(`UPDATE paige_audit_log SET payload=jsonb_set(payload,ARRAY[${q(key)}],${q(JSON.stringify(value))}::jsonb) WHERE id='${bad.audit}';`);refused(register(bad));
 }
 for(const status of ['trial','past_due']){const held=await setup();sql(`UPDATE tenants SET status=${q(status)} WHERE id='${tenant}';`);refused(register(held));check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${held.operation}';`)==='0','Original Work cohort hold preserved: '+status);sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);}
 const expired=await setup();sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${expired.pending.confirmation_id}';`);refused(register(expired));
 const changed=await setup();sql(`UPDATE channel_connectors SET active=false WHERE id='${changed.connector}';`);refused(register(changed),'40001');
 for(const [mutate,restore,label]of [
  [`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`,`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`,'current role'],
  [`UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`,`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`,'selected business'],
  [`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${actor}';`,`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`,'actual user ban'],
  [`UPDATE auth.users SET is_anonymous=true WHERE id='${actor}';`,`UPDATE auth.users SET is_anonymous=false WHERE id='${actor}';`,'anonymous principal'],
  [`UPDATE tenants SET archived_at=clock_timestamp() WHERE id='${tenant}';`,`UPDATE tenants SET archived_at=NULL WHERE id='${tenant}';`,'archived business'],
  [`UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`,`UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`,'current autonomy']]){
  const held=await setup();sql(mutate);try{refused(register(held));check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${held.operation}';`)==='0',label+' withdrawal after approval cannot create Work');}finally{sql(restore);}
 }
 const rollback=await setup();sql(native('BEGIN;'+register(rollback)+'ROLLBACK;'));check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${rollback.operation}';`)==='0','Original Work registration rolls back atomically without an extra obligation');
 sql(`UPDATE channel_connectors SET active=false WHERE id='${v.connector}';`);check(json(native(readWork(v))).work_id===result.work_id,'Historical read precedes changed sender/draft readiness');
 const race=await setup(),tag='e04_original_work_'+randomUUID().replaceAll('-','');
 const first=startSession(tag+'first',native('BEGIN;'+register(race)+'SELECT pg_sleep(1.5);COMMIT;'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'first')} AND wait_event='PgSleep');`);
 const second=startSession(tag+'second',native(register(race)));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'second')} AND wait_event_type='Lock');`);waits++;
 await Promise.all([first,second]);check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${race.operation}';`)==='1','Concurrent same-intent calls converge on original Work');
 const altered=await setup(),alterTag=tag+'alter';
 const changing=startSession(alterTag+'writer',`BEGIN;UPDATE paige_pending_confirmations SET args=jsonb_set(args,'{request,title}',${q(JSON.stringify('Altered while waiting'))}::jsonb) WHERE id='${altered.pending.confirmation_id}';SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(alterTag+'writer')} AND wait_event='PgSleep');`);
 const stale=startSession(alterTag+'reader',native(`DO $proof$ BEGIN BEGIN ${register(altered).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected changed approval refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(alterTag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [,changedReply]=await Promise.all([changing,stale]);check(changedReply==='refused','Complete stored approval is rechecked after an observed pending-row wait');
 check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${altered.operation}';`)==='0','Changed stored words cannot create original Work with an old digest');
 const expiring=await setup(),expiryTag=tag+'expiry';
 sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()+interval '0.8 seconds' WHERE id='${expiring.pending.confirmation_id}';`);
 const holding=startSession(expiryTag+'holder',`BEGIN;SELECT id FROM paige_agreements WHERE id='${expiring.a.id}' FOR UPDATE;SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(expiryTag+'holder')} AND wait_event='PgSleep');`);
 const elapsed=startSession(expiryTag+'reader',native(`DO $proof$ BEGIN BEGIN ${register(expiring).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected act-time approval expiry';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(expiryTag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [,expiredReply]=await Promise.all([holding,elapsed]);check(expiredReply==='refused','Actual clock expiry wins after an observed original source wait');
 check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${expiring.operation}';`)==='0','Expired approval creates no Work obligation');
 const revoked=await setup(),revokeTag=tag+'revoke';
 const revoking=startSession(revokeTag+'writer',`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}' AND tenant_id='${tenant}';SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(revokeTag+'writer')} AND wait_event='PgSleep');`);
 const retired=startSession(revokeTag+'reader',native(`DO $proof$ BEGIN BEGIN ${register(revoked).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected committed role refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(revokeTag+'reader')} AND wait_event_type='Lock');`);waits++;
 try{const [,revokedReply]=await Promise.all([revoking,retired]);check(revokedReply==='refused','Committed role revocation wins after an observed actor lock wait');check(sql(`SELECT count(*) FROM paige_durable_work WHERE intent_id='${revoked.operation}';`)==='0','Retired owner creates no Work or effect');}finally{sql(`UPDATE tenant_members SET role='owner' WHERE user_id='${actor}' AND tenant_id='${tenant}';`);}
 let requestStatus=null;
 if(process.argv.includes('--prepared-status')){
  const {provePreparedRequestStatus}=await import('./prepared-request-status-proof.mjs');
  requestStatus=await provePreparedRequestStatus({sql,read,quote,tenant,actor,setup,register});
 }
 check(originals()===stamp,'Original metadata remains exact after all controls');
 let credentials=null;
 if(process.argv.includes('--prepared-credentials')){
  console.log(JSON.stringify({checkpoint:'Original Work and request-status controls before credential issuance',workChecks:checks,statusChecks:requestStatus?.checks}));
  const {provePreparedSignatureCredentials}=await import('./prepared-signature-credentials-proof.mjs');
  credentials=await provePreparedSignatureCredentials({sql,read,quote,tenant,actor,setup,register,startSession,observe,fresh,context,client,makeCommercial,issue,claim});
 }
 return {checks,migrationReplay:2,concurrentSessions:sessions,observedLockWaits:waits,originalWorkSource:'693340656ec8ec445cd34c25b3d91d80',proofBodySha256:createHash('sha256').update(provePreparedSignatureWork.toString()).digest('hex'),migrationSha256:createHash('sha256').update(migration).digest('hex'),requestStatus,credentials,scope:'Original Work registration/read only; synthetic audit/session/mail/Storage, not approval/send/customer acceptance'};
}
