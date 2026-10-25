import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mintSignerToken,sha256Hex} from '../../supabase/functions/_shared/agreements/token.ts';
import {installOriginalAgreementComms} from './prepared-message-admission-fixture.mjs';
import {preparedCredentialsCommercialFixture} from './prepared-credentials-commercial-fixture.mjs';

// Original fenced Agreements program, after all122 credential controls. This
// private source proof is NOT an email admission, provider or customer proof.
export async function provePreparedMessageOrigin({sql,read,quote,tenant,actor,setup,register,startSession,observe,makeCommercial,issue,claim,context}){
 const q=quote,native=s=>'SET ROLE service_role;'+s;let checks=0;
 const check=(v,m)=>{assert(v,m);checks++;};
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const refused=(s,code='42501',role='proofrunner')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected original message-origin refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const source=read('scripts/agreements/prepared-message-origin-proof.mjs');
 check(provePreparedMessageOrigin.toString()===source.slice(source.indexOf('export async function provePreparedMessageOrigin')+'export '.length).trim(),'Executed message-origin proof equals retained source');
 installOriginalAgreementComms({sql,read});
 const commsAbi=()=>sql("SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef,'defaults',pronargdefaults) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_comms_email_actor','_comms_email_governance','prepare_comms_email_send','read_comms_email_send_binding','claim_comms_email_send','finalize_comms_email_send','read_comms_email_send_result');");
 const originalCommsAbi=commsAbi();
 const protectedMetadata=()=>sql("SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND proname IN ('_record_agreement_signature','create_paige_durable_work','transition_paige_durable_work','_sales_invoice_actor','_freeze_paige_commercial_presentation','_validate_paige_commercial_presentation','_issue_prepared_agreement_confirmation','_claim_prepared_agreement_confirmation','_read_prepared_agreement_work','_register_prepared_agreement_work','_issue_prepared_agreement_credentials','_read_prepared_agreement_credentials','e04_prepared_issuance_write','e04_prepared_issuance_record','_paige_preparation_legacy_token_hold','_paige_preparation_legacy_effect_hold');");
 const before=protectedMetadata(),migration=read('supabase/migrations/20271114230204_e04_agreement_message_origin.sql');
 if(!process.argv.includes('--prepared-message-origin-baseline')){
  const applied=process.argv.includes('--prepared-message-admission-baseline')
   ?migration.slice(0,migration.indexOf('CREATE OR REPLACE FUNCTION public._comms_email_governance'))+'COMMIT;':migration;
  sql(applied);sql(applied);
 }
 check(sql("SELECT to_regprocedure('private.e04_agreement_email_origin(uuid,uuid,jsonb,boolean)') IS NOT NULL;")==='t','Missing original agreement-to-message source contract');
 check(protectedMetadata()===before,'Original approval/Work/signature/credential/hold/authority bodies and grants remain exact');
 const approved=async()=>{const v=await setup();json(native(register(v)));const hashes=await Promise.all(v.args.request.recipients.map(async r=>({signer_id:r.id,token_hash:await sha256Hex(mintSignerToken())})));
  const credential=json(native(`SELECT _issue_prepared_agreement_credentials('${actor}','${tenant}','${v.operation}',${q(v.args.request_sha256)},${q(JSON.stringify(hashes))}::jsonb);`));return {...v,credential,hashes};};
 const governance=v=>({actor_user_id:actor,tenant_id:tenant,tool:'agreement_send',action:'agreement.send',approval_channel:'chat-canonical',decision_receipt_recorded:true,approved_fingerprint:v.fp,purpose:'agreement_signature_request',agreement_work_id:v.credential.work_id,agreement_operation_id:v.operation,agreement_request_sha256:v.args.request_sha256,signer_id:v.signer.id,operation_id:randomUUID()});
 const origin=(g,fresh=false,patch={})=>{const bound={actor,tenant,...patch};return `SELECT private.e04_agreement_email_origin('${bound.actor}','${bound.tenant}',${q(JSON.stringify(g))}::jsonb,${fresh});`;};
 const effects=v=>sql(`SELECT jsonb_build_object('agreement',to_jsonb(a),'signers',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM paige_agreement_signers s WHERE agreement_id=a.id),'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY seq) FROM paige_agreement_events e WHERE agreement_id=a.id),'work',(SELECT to_jsonb(w) FROM paige_durable_work w WHERE intent_id='${v.operation}')) FROM paige_agreements a WHERE id='${v.a.id}';`);
 const v=await approved(),g=governance(v),stamp=effects(v),r=json(origin(g,true));
 check(r.kind==='prepared_agreement_message_source'&&r.source_only===true,'Returns source evidence, never an admitted email/provider result');
 check(r.work_id===v.credential.work_id&&r.agreement_id===v.a.id&&r.client_id===v.args.request.source.client_id&&r.signer.id===v.signer.id,'Original Work/customer/document/signer identities preserved');
 check(r.operation_id===g.operation_id&&r.agreement_operation_id===v.operation&&r.request_sha256===v.args.request_sha256,'Parent and transport intents remain distinct original identities');
 check(r.preparation_id===v.preparation&&r.preparation_sha256===v.args.request.preparationSha256&&r.document_sha256===v.args.request.document.sha256,'Exact retained original preparation/document preserved');
 assert.deepEqual(r.message,v.args.request.messages[0]);assert.deepEqual(r.sender,v.args.request.sender);checks+=2;
 assert.deepEqual(r.recipient_ids,v.args.request.recipients.map(signer=>signer.id));checks++;
 check(r.credential_commitment===await sha256Hex(v.hashes[0].token_hash)&&!JSON.stringify(r).includes(v.hashes[0].token_hash),'Native source exposes only the original one-way witness, never the protected signer hash');
 check(effects(v)===stamp,'Source resolution does not create messages, change documents/credentials or complete Work');
 for(const role of ['anon','authenticated','service_role'])refused(origin(g),'42501',role);
 for(const bad of [null,{}, {...g,extra:true},{...g,operation_id:'bad'},{...g,agreement_request_sha256:'bad'}])refused(origin(bad),'22023');
 for(const patch of [{actor_user_id:randomUUID()},{tenant_id:randomUUID()},{tool:'comms_send_email'},{action:'comms.email_send'},{approval_channel:'operator_card'},{decision_receipt_recorded:false},{approved_fingerprint:'0'.repeat(16)},{agreement_work_id:randomUUID()},{signer_id:randomUUID()}])refused(origin({...g,...patch}));
 const elapsed=await approved(),eg=governance(elapsed);
 sql(`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE intent_id='${elapsed.operation}';`);
 check(json(origin(eg)).work_id===elapsed.credential.work_id,'Historical source remains inspectable after lease expiry');refused(origin(eg,true));
 const expired=await approved(),pg=governance(expired);sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${expired.pending.confirmation_id}';`);
 check(json(origin(pg)).work_id===expired.credential.work_id,'Historical source does not renew an expired consumed approval');refused(origin(pg,true));
 const authority=await approved(),ag=governance(authority);sql(`UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`);
 try{check(json(origin(ag)).work_id===authority.credential.work_id,'Historical facts are distinct from current autonomy');refused(origin(ag,true));}finally{sql(`UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`);}
 sql(`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
 try{refused(origin(g));refused(origin(g,true));}finally{sql(`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);}
 check(protectedMetadata()===before,'Original engines/permissions remain unchanged after all origin controls');
 check(commsAbi()===originalCommsAbi,'All seven ORIGINAL Communications function ABIs/owners/ACLs/search paths/defaults preserved');
 const commercial=await preparedCredentialsCommercialFixture({sql,quote,tenant,actor,makeCommercial,issue,claim,register});
 commercial.hashes=await Promise.all(commercial.args.request.recipients.map(async r=>({signer_id:r.id,token_hash:await sha256Hex(mintSignerToken())})));
 commercial.credential=json(native(`SELECT _issue_prepared_agreement_credentials('${actor}','${tenant}','${commercial.operation}',${q(commercial.args.request_sha256)},${q(JSON.stringify(commercial.hashes))}::jsonb);`));
 const cg=governance(commercial),commercialBefore=effects(commercial),cs=json(origin(cg,true));
 check(cs.document_sha256===commercial.manifest.document.sha256&&cs.agreement_id===commercial.a.id,'Original commercial document/agreement source is preserved');
 check(effects(commercial)===commercialBefore,'Commercial source resolution cannot change original terms, obligations, document or signing evidence');
 console.log(JSON.stringify({checkpoint:'Original private message-source controls before canonical admission',checks}));
 const {provePreparedMessageAdmission}=await import('./prepared-message-admission-proof.mjs');
 const admission=await provePreparedMessageAdmission({sql,read,q,tenant,actor,approved,governance,origin,startSession,observe,commercial,context});
 return {checks,admission,migrationReplay:2,migrationSha256:createHash('sha256').update(migration).digest('hex'),proofBodySha256:createHash('sha256').update(provePreparedMessageOrigin.toString()).digest('hex'),scope:'Local private source and original canonical message admission only; provider/customer acceptance and mounted execution remain owed'};
}
