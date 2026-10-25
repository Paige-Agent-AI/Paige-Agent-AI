import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// Original isolated native Work/approval/agreement context, no provider or customer evidence.
export async function provePreparedRequestStatus({sql,read,quote,tenant,actor,setup,register}) {
 const q=quote,native=s=>'SET ROLE service_role;'+s;let checks=0;
 const check=(v,m)=>{assert(v,m);checks++;};
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const refused=(s,code='42501',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected original status refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const source=read('scripts/agreements/prepared-request-status-proof.mjs');
 const body=source.slice(source.indexOf('export async function provePreparedRequestStatus')+'export '.length).trim();
 check(provePreparedRequestStatus.toString()===body,'Executed native status proof equals retained source');
 const originals=()=>sql("SELECT jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('create_paige_durable_work','transition_paige_durable_work','_sales_invoice_actor','_record_agreement_signature','_paige_preparation_legacy_effect_hold','_paige_preparation_legacy_token_hold','_claim_prepared_agreement_confirmation','_read_prepared_agreement_work','_register_prepared_agreement_work');");
 const stamp=originals(),migration=read('supabase/migrations/20271114170004_e04_prepared_request_status.sql');
 if(!process.argv.includes('--prepared-status-baseline')){sql(migration);sql(migration);}
 check(sql("SELECT to_regprocedure('public._read_prepared_agreement_request_status(uuid,uuid,uuid,text)') IS NOT NULL;")==='t','Missing native original-request status reader');
 check(originals()===stamp,'Original approval/Work/13-argument signature/holds bodies and permissions remain exact');
 const metadata=json("SELECT jsonb_build_object('definer',prosecdef,'config',proconfig,'defaults',pronargdefaults,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE oid='public._read_prepared_agreement_request_status(uuid,uuid,uuid,text)'::regprocedure;");
 check(metadata.definer&&metadata.defaults===0&&metadata.service&&!metadata.anon&&!metadata.authenticated&&metadata.config.includes('search_path=""'),'Native reader is exact service-only ABI with empty path');
 const v=await setup();const status=(x,patch={})=>{const p={actor,tenant,operation:x.operation,digest:x.args.request_sha256,...patch};return `SELECT public._read_prepared_agreement_request_status('${p.actor}','${p.tenant}','${p.operation}',${q(p.digest)});`;};
 check(json(native(status(v)))===null,'Missing original Work is null before any obligation');
 const snapshot=()=>sql("SELECT jsonb_build_object('events',(SELECT count(*) FROM paige_agreement_events),'work',(SELECT count(*) FROM paige_durable_work),'tokens',(SELECT count(*) FROM paige_agreement_signers WHERE token_hash IS NOT NULL));");
 const registered=json(native(register(v))),before=snapshot();
 const expected={kind:'prepared_signature_request_result',state:'prepared',tenant_id:tenant,actor_id:actor,operation_id:v.operation,request_sha256:v.args.request_sha256,agreement_id:v.a.id,work_id:registered.work_id,receipt_id:null};
 check(isDeepStrictEqual(json(native(status(v))),expected),'Fresh exact Work returns only original prepared identity without a provider receipt');
 for(const role of ['anon','authenticated'])refused(status(v),'42501',role);
 refused(status(v,{digest:'0'.repeat(64)}),'22023');refused(status(v,{actor:randomUUID()}));refused(status(v,{tenant:randomUUID()}));
 check(snapshot()===before,'Fresh status read writes no agreement events, credentials or Work');
 for(const state of ['succeeded','failed','blocked','cancelled','expired','outcome_unknown']){
  const terminal=await setup(),recorded=json(native(register(terminal)));
  const key=sql(`SELECT idempotency_key FROM paige_durable_work WHERE id='${recorded.work_id}';`);
  if(state==='expired')sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${recorded.work_id}';`);
  // Use the ORIGINAL transition and terminal/lease/attempt invariants. This
  // fixture verifies only original Work identity, never a provider side effect.
  const terminalEvidence=['succeeded','failed','cancelled'].includes(state)
   ?q(JSON.stringify({verified_readback:true,fixture_original_work_readback_only:recorded.work_id}))+'::jsonb':'NULL';
  sql(native(`SELECT * FROM public.transition_paige_durable_work('${recorded.work_id}',${q(key)},${q(state)},${terminalEvidence},NULL,${state==='blocked'?q('Synthetic source hold'):'NULL'});`));
  const checkpoint=snapshot(),r=json(native(status(terminal)));
  check(r.state==='outcome_unknown'&&r.work_id===recorded.work_id&&r.receipt_id===null,'Original transitioned Work '+state+' is not provider/signed/payment evidence');
  check(snapshot()===checkpoint,'Reading original '+state+' history writes no events, credentials or Work');
 }
 sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${registered.work_id}';`);
 check(json(native(status(v))).state==='outcome_unknown','Expired original lease cannot imply fresh prepared readiness');
 sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()+interval '5 minutes' WHERE id='${registered.work_id}';UPDATE channel_connectors SET active=false WHERE id='${v.connector}';`);
 const beforeProviderRead=snapshot();
 check(json(native(status(v))).state==='prepared','Historical preparation read does not require current provider readiness or issue anything');
 check(snapshot()===beforeProviderRead,'Historical status read writes no agreement events, credentials or new Work');
 const changed=await setup();json(native(register(changed)));sql(`UPDATE paige_agreements SET title=title||' amended' WHERE id='${changed.a.id}';`);
 check(json(native(status(changed))).state==='outcome_unknown','Changed draft returns original uncertain history without new approval or replacing identity');
 const afterFixture=snapshot();
 for(const [mutate,restore]of [
  [`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`,`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`],
  [`UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`,`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`],
  [`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${actor}';`,`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`],
  [`UPDATE auth.users SET is_anonymous=true WHERE id='${actor}';`,`UPDATE auth.users SET is_anonymous=false WHERE id='${actor}';`],
  [`UPDATE tenants SET archived_at=clock_timestamp() WHERE id='${tenant}';`,`UPDATE tenants SET archived_at=NULL WHERE id='${tenant}';`]]){sql(mutate);try{refused(status(v));}finally{sql(restore);}}
 check(snapshot()===afterFixture,'Revoked status reads cannot create records or effects');
 check(originals()===stamp,'All original native authority and effects remain unchanged after controls');
 return {checks,migrationReplay:2,migrationSha256:createHash('sha256').update(migration).digest('hex'),proofBodySha256:createHash('sha256').update(provePreparedRequestStatus.toString()).digest('hex'),scope:'Original private Work history only, not a provider/status transition, signature or acceptance'};
}
