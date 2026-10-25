import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

// Same fenced native campaign and ORIGINAL synthetic provider finalizer.
// No network, provider action or hosted customer acceptance.
export async function provePreparedPublicationStatus({sql,read,q,tenant,actor,fixture,approved,put,claim,finalize,publish,acceptedFixture,original,published,context,startSession,observe}){
 let checks=0,sessions=0,waits=0;const check=(ok,message)=>{assert(ok,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const source=read('scripts/agreements/prepared-publication-status-proof.mjs');
 check(provePreparedPublicationStatus.toString()===source.slice(source.indexOf('export async function provePreparedPublicationStatus')+'export '.length).trim(),'Exact executed publication status proof retained');
 const migration=read('supabase/migrations/20271114250004_e04_original_publication_status.sql');
 const protectedMetadata=()=>sql("SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND proname IN ('_read_prepared_agreement_work','_register_prepared_agreement_work','_record_agreement_signature','_complete_prepared_agreement_seal','e04_prepared_publication_record','_publish_prepared_agreement_request','finalize_comms_email_send','create_paige_durable_work','transition_paige_durable_work');");
 const protectedBefore=protectedMetadata();
 if(!process.argv.includes('--prepared-publication-status-baseline')){sql(migration);sql(migration);}
 const status=(v,patch={})=>{const p={actor,tenant,operation:v.operation,digest:v.args.request_sha256,...patch};return `SELECT public._read_prepared_agreement_request_status('${p.actor}','${p.tenant}','${p.operation}',${q(p.digest)});`;};
 const effects=()=>sql("SELECT jsonb_build_object('events',(SELECT count(*) FROM paige_agreement_events),'work',(SELECT count(*) FROM paige_durable_work),'messages',(SELECT count(*) FROM messages),'tokens',(SELECT count(*) FROM paige_agreement_signers WHERE token_hash IS NOT NULL));");
 const before=effects(),first=json(native(status(original)));
 check(first.state==='provider_accepted'&&first.receipt_id===published.receipt_id&&first.work_id===original.s.work_id,'Genuine original provider publication survives expired execution lease in owner history');
 check(json(native(status(original))).receipt_id===first.receipt_id&&effects()===before,'Repeated original status reads cannot send, publish, remint credentials or create Work');
 const refused=(statement,code='42501',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected publication history refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 for(const role of ['anon','authenticated'])refused(status(original),'42501',role);
 for(const patch of [{actor:randomUUID()},{tenant:randomUUID()}])refused(status(original,patch));
 refused(status(original,{digest:'0'.repeat(64)}),'22023');
 for(const state of ['prepared','unknown','failed']){
  const v=await fixture();v.message=put(v).message_id;
  if(state!=='prepared'){json(native(claim(v)));json(native(finalize(v,state,null)));}
  const snapshot=effects(),r=json(native(status(v)));
  check(r.state==='outcome_unknown'&&r.receipt_id===null,'Missing or '+state+' provider publication is never acceptance or not-sent evidence');
  check(effects()===snapshot,'Reading '+state+' history has no effects');
 }
 const partial=await fixture(await approved({secondSigner:true}));partial.message=put(partial).message_id;
 json(native(claim(partial)));json(native(finalize(partial,'provider_accepted','synthetic-partial-publication-status')));
 check(json(native(status(partial))).receipt_id===null,'A canonical accepted message alone does not invent the original publication event');
 const partialReceipt=json(native(publish(partial))),part=json(native(status(partial)));
 check(partialReceipt.accepted_count===1&&partialReceipt.recipient_count===2&&part.state==='provider_partial'&&part.receipt_id===partialReceipt.receipt_id,'Exact original accepted child count differs from the immutable two-recipient request');
 const full=await acceptedFixture({secondSigner:true}),fullReceipt=json(native(publish(full)));
 check(json(native(status(full))).state==='provider_accepted'&&json(native(status(full))).receipt_id===fullReceipt.receipt_id,'All actual original recipient receipts establish provider acceptance, never delivery');
 check(json(context+`SELECT void_agreement_signing('${tenant}','${full.a.id}');`).ok===true,'Original owner can withdraw signing after genuine publication');
 check(json(native(status(full))).receipt_id===fullReceipt.receipt_id&&sql(`SELECT status FROM paige_agreements WHERE id='${full.a.id}';`)==='voided','Historical provider acceptance survives void without reviving access or changing current agreement status');
 sql(`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
 try{refused(status(full));}finally{sql(`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);}
 const concurrent=await acceptedFixture(),tag='e04_publication_status_'+randomUUID().replaceAll('-','');
 const holding=startSession(tag+'publisher','BEGIN;SET LOCAL ROLE service_role;'+publish(concurrent)+'SELECT pg_sleep(1.5);COMMIT;');sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'publisher')} AND wait_event='PgSleep');`);
 const waiting=startSession(tag+'reader',native(status(concurrent)));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'reader')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([holding,waiting]),publication=JSON.parse(left),returned=JSON.parse(right);
 check(returned.state==='provider_accepted'&&returned.receipt_id===publication.receipt_id,'Actual status reader waits for original publication and reads the committed receipt');
 const guard=migration.slice(migration.indexOf('DO $guard$'),migration.indexOf('END $guard$;')+'END $guard$;'.length);
 for(const mutation of [
  "ALTER FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) SET search_path=public",
  "GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) TO authenticated",
  "GRANT EXECUTE ON FUNCTION private.e04_prepared_publication_record(uuid,uuid,uuid) TO service_role",
  "ALTER FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) STRICT"]){
  sql(`BEGIN;${mutation};DO $negative$ BEGIN BEGIN EXECUTE ${q(guard)};RAISE EXCEPTION 'Expected current source guard refusal';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $negative$;ROLLBACK;`);checks++;
 }
 check(protectedMetadata()===protectedBefore,'All original approval/Work/Communications/signature/completion bodies and grants remain exact');
 const meta=json("SELECT jsonb_build_object('body',md5(prosrc),'definer',prosecdef,'defaults',pronargdefaults,'path',proconfig,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE oid='public._read_prepared_agreement_request_status(uuid,uuid,uuid,text)'::regprocedure;");
 check(meta.body==='716caa2b2535ad966271ca87f88a64f8'&&meta.definer&&meta.defaults===0&&meta.path.includes('search_path=""')&&meta.service&&!meta.anon&&!meta.auth,'Exact original service-only reader body/metadata retained');
 return {checks,migrationReplay:2,concurrentSessions:sessions,observedLockWaits:waits,migrationSha256:createHash('sha256').update(migration).digest('hex'),proofBodySha256:createHash('sha256').update(provePreparedPublicationStatus.toString()).digest('hex'),scope:'Actual isolated native original publication/status only; synthetic provider facts, no hosted/customer/provider execution'};
}
