import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {preparedSignatureCredentialStore} from '../../supabase/functions/_shared/agreements/prepared-signature-credentials.ts';
import {mintSignerToken,sha256Hex,SIGNING_TOKEN_TTL_DAYS} from '../../supabase/functions/_shared/agreements/token.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {preparedCredentialsCommercialFixture,approvePreparedCredentialsFixture} from './prepared-credentials-commercial-fixture.mjs';

// Same original isolated native program/records; no hosted Storage/provider/customer proof.
export async function provePreparedSignatureCredentials({sql,read,quote,tenant,actor,setup,register,startSession,observe,fresh,context,makeCommercial,issue,claim}){
 const q=quote,native=s=>'SET ROLE service_role;'+s;let checks=0,sessions=0,waits=0;
 const fixtureOwner=sql('SELECT current_user;');assert.equal(fixtureOwner,'proofrunner','Original isolated native fixture owner required');
 const check=(v,m)=>{assert(v,m);checks++;};
 const json=s=>{const v=sql(s);return v===''?null:JSON.parse(v);};
 const refused=(s,code='42501',role='service_role')=>{sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${s.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected prepared issuance refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
 const source=read('scripts/agreements/prepared-signature-credentials-proof.mjs');
 check(provePreparedSignatureCredentials.toString()===source.slice(source.indexOf('export async function provePreparedSignatureCredentials')+'export '.length).trim(),'Executed issuer proof equals its retained source');
 const protectedMetadata=()=>sql("SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_record_agreement_signature','create_paige_durable_work','transition_paige_durable_work','_sales_invoice_actor','_freeze_paige_commercial_presentation','_validate_paige_commercial_presentation','_issue_prepared_agreement_confirmation','_claim_prepared_agreement_confirmation','_read_prepared_agreement_work','_register_prepared_agreement_work','_read_agreement_signing_fields','_read_prepared_agreement_seal','void_paige_agreement','void_agreement_signing');");
 const before=protectedMetadata(),migration=read('supabase/migrations/20271114180004_e04_approved_signing_credentials.sql');
 if(!process.argv.includes('--prepared-credentials-baseline')){sql(migration);sql(migration);}
 check(sql("SELECT to_regprocedure('public._issue_prepared_agreement_credentials(uuid,uuid,uuid,text,jsonb)') IS NOT NULL;")==='t','Missing native exact approved credential producer');
 check(protectedMetadata()===before,'Original signature13/Work/authority/commercial/field/seal sources and permissions remain exact');
 const approval=async()=>{const v=await setup();json(native(register(v)));return v;};
 const hashes=async v=>Promise.all(v.args.request.recipients.map(async s=>({signer_id:s.id,token_hash:await sha256Hex(mintSignerToken())})));
 const get=(v,patch={})=>{const a={actor,tenant,operation:v.operation,digest:v.args.request_sha256,...patch};return `SELECT public._read_prepared_agreement_credentials('${a.actor}','${a.tenant}','${a.operation}',${q(a.digest)});`;};
 const put=(v,credentials,patch={})=>{const a={actor,tenant,operation:v.operation,digest:v.args.request_sha256,...patch};return `SELECT public._issue_prepared_agreement_credentials('${a.actor}','${a.tenant}','${a.operation}',${q(a.digest)},${q(JSON.stringify(credentials))}::jsonb);`;};
 const nativeService=v=>({async rpc(name,args){assert.equal(args._actor,actor);assert.equal(args._tenant,tenant);assert.equal(args._operation,v.operation);assert.equal(args._request_sha256,v.args.request_sha256);
  try{return {data:json(native(name==='_read_prepared_agreement_credentials'?get(v):name==='_issue_prepared_agreement_credentials'?put(v,args._credentials):assert.fail('Unapproved native API'))),error:null};}catch(error){return {data:null,error};}
 }});
 const makeStore=(v,service=nativeService(v))=>preparedSignatureCredentialStore(service,{actorId:actor,tenantId:tenant,operationId:v.operation,agreementId:v.a.id,preparationId:v.preparation,requestSha256:v.args.request_sha256,preparationSha256:v.args.request.preparationSha256,documentSha256:v.args.request.document.sha256},v.args.request.recipients.map(r=>r.id));
 const effects=v=>sql(`SELECT jsonb_build_object('agreement',to_jsonb(a),'signers',
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM paige_agreement_signers s WHERE agreement_id=a.id),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY seq) FROM paige_agreement_events e WHERE agreement_id=a.id)) FROM paige_agreements a WHERE id='${v.a.id}';`);
 const noEffects=(v,fn,label)=>{const before=effects(v);fn();check(effects(v)===before,label+' has no document, signer or event effect');};
 const commercial=()=>preparedCredentialsCommercialFixture({sql,quote,tenant,actor,makeCommercial,issue,claim,register});
 const repeatApproval=async v=>{
  const next=structuredClone(v),operation=randomUUID();next.operation=operation;next.nonce=randomUUID();
  next.args.operation_id=operation;next.args.request.operationId=operation;next.args.approval_cycle_nonce=randomUUID();
  next.args.approval_subject='agreement.prepared_signature_request:'+v.a.id+':'+operation;
  next.args.request_sha256=createHash('sha256').update(canonicalPresentationJson(next.args.request)).digest('hex');
  return approvePreparedCredentialsFixture({sql,quote,tenant,actor,issue,claim,register},next);
 };
 const meta=json("SELECT jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'config',proconfig,'defaults',pronargdefaults,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_read_prepared_agreement_credentials','_issue_prepared_agreement_credentials');");
 check(meta.length===2&&meta.every(m=>m.definer&&m.defaults===0&&m.service&&!m.anon&&!m.authenticated&&m.config?.includes('search_path=""')),'Exact new native ABI remains service-only, empty path, no defaults');
 for(const id of ['private.e04_prepared_issuance_record(uuid,uuid,uuid,text)','private.e04_prepared_issuance_write(uuid,uuid,uuid)'])
  check(sql(`SELECT NOT has_function_privilege('service_role','${id}','EXECUTE') AND NOT has_function_privilege('authenticated','${id}','EXECUTE') AND NOT has_function_privilege('anon','${id}','EXECUTE');`)==='t','Private native source is not an externally callable permission');
 const v=await approval(),store=makeStore(v);
 check(await store.read()===null,'No credential record before native issuance');
 const issued=await store.issue(),receipt=issued.receipt;
 check(receipt.kind==='prepared_agreement_credentials'&&receipt.state==='recorded'&&receipt.work_id===json(native(`SELECT public._read_prepared_agreement_work('${actor}','${tenant}','${v.operation}',${q(v.args.request_sha256)});`)).work_id,'Actual source bridge adopts only original native credential identity');
 const raw=issued.takeCredential(v.signer.id);
 check(typeof raw==='string'&&await sha256Hex(raw)===sql(`SELECT token_hash FROM paige_agreement_signers WHERE id='${v.signer.id}';`),'Original CSPRNG credential matches the committed original signer hash');
 const visibleHistory=sql(context+`SELECT jsonb_agg(to_jsonb(e))::text FROM paige_agreement_events e WHERE agreement_id='${v.a.id}';`);
 check(receipt.credentials.every(c=>!visibleHistory.includes(c.token_hash)),'Owner-readable original agreement events never expose protected credential hashes');
 const witness=json(context+`SELECT detail->'credentials' FROM paige_agreement_events WHERE id='${receipt.event_id}';`);
 check(witness[0].token_commitment===await sha256Hex(receipt.credentials[0].token_hash)&&!Object.hasOwn(witness[0],'token_hash'),'Actual readable audit witness commits to the protected hash without copying it');
 check(issued.takeCredential(v.signer.id)===null,'Original invocation releases each credential once');
 const frozen=json(`SELECT jsonb_build_object('key',content_storage_key,'sha',content_sha256,'status',status) FROM paige_agreements WHERE id='${v.a.id}';`);
 check(frozen.key===sql(`SELECT content_storage_key FROM paige_agreement_document_preparations WHERE id='${v.preparation}';`)&&frozen.sha===v.args.request.document.sha256&&frozen.status==='draft','Exact reviewed file is frozen before any delivery, agreement remains Draft');
 const windowSeconds=Number(sql(`SELECT extract(epoch FROM (s.token_expires_at-e.created_at)) FROM paige_agreement_signers s,paige_agreement_events e WHERE s.id='${v.signer.id}' AND e.id='${receipt.event_id}';`));
 check(windowSeconds>0&&windowSeconds<=SIGNING_TOKEN_TTL_DAYS*24*60*60,'Native signing window never exceeds original fixed-hour policy across DST');
 check(!sql(`SELECT (SELECT to_jsonb(a)::text FROM paige_agreements a WHERE id='${v.a.id}')||(SELECT jsonb_agg(to_jsonb(e))::text FROM paige_agreement_events e WHERE agreement_id='${v.a.id}');`).includes(raw),'Raw credential is absent from original agreement/history');
 check(!sql(`SELECT to_jsonb(w)::text FROM paige_durable_work w WHERE intent_id='${v.operation}';`).includes(raw),'Original Work also contains no raw signing credential');
 const history=await makeStore(v).issue();check(history.recovered&&history.takeCredential(v.signer.id)===null,'Historical native read cannot rotate/reconstruct a link');
 const originalHashes=receipt.credentials.map(c=>({signer_id:c.signer_id,token_hash:c.token_hash}));
 check(json(native(put(v,originalHashes))).event_id===receipt.event_id,'Same hashes/intent return the original event, not a second token');
 refused(put(v,await hashes(v)),'40001');
 for(const role of ['anon','authenticated']){refused(get(v),'42501',role);refused(put(v,originalHashes),'42501',role);}
 const toVoid=await approval(),toVoidIssued=await makeStore(toVoid).issue();toVoidIssued.dispose();
 check(json(context+`SELECT void_agreement_signing('${tenant}','${toVoid.a.id}');`).ok===true,'Original authenticated void remains usable after approved credential preparation');
 check(sql(`SELECT a.status='voided' AND a.voided_at IS NOT NULL AND s.token_hash IS NULL AND s.token_expires_at IS NULL AND s.token_revoked_at IS NOT NULL FROM paige_agreements a JOIN paige_agreement_signers s ON s.agreement_id=a.id WHERE a.id='${toVoid.a.id}';`)==='t','Original void both revokes and clears credential before returning');
 check(json(native(get(toVoid))).event_id===toVoidIssued.receipt.event_id,'Voiding preserves immutable original issuance history');
 const voidHistory=await makeStore(toVoid).issue();
 check(voidHistory.recovered&&voidHistory.receipt.credentials.every(c=>c.token_hash===null)&&voidHistory.takeCredential(toVoid.signer.id)===null,'Actual original void history preserves NULL retired hashes and never reconstructs/reissues a link');
 const notGenuinelyVoided=await approval(),unproven=await makeStore(notGenuinelyVoided).issue();unproven.dispose();
 sql(`UPDATE paige_agreements SET status='voided',voided_at=clock_timestamp() WHERE id='${notGenuinelyVoided.a.id}';
  UPDATE paige_agreement_signers SET token_revoked_at=clock_timestamp() WHERE id='${notGenuinelyVoided.signer.id}';`);
 const unprovenBefore=effects(notGenuinelyVoided);
 sql(context.replace('SET ROLE authenticated;','SET ROLE '+fixtureOwner+';')+`DO $proof$ BEGIN BEGIN
  UPDATE paige_agreement_signers SET token_hash=NULL,token_expires_at=NULL WHERE id='${notGenuinelyVoided.signer.id}';
  RAISE EXCEPTION 'Expected original void-event requirement';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;`);
 check(effects(notGenuinelyVoided)===unprovenBefore,'A void status label and revocation without ORIGINAL void evidence cannot clear credentials');
 const malformed=await approval(),validHashes=await hashes(malformed);
 for(const bad of [null,{},[],[{}],[{...validHashes[0],extra:true}],
  [{...validHashes[0],token_hash:null}],[{...validHashes[0],token_hash:'A'.repeat(64)}],
  [{...validHashes[0],signer_id:'not-a-signer'}],[validHashes[0],validHashes[0]]])
  noEffects(malformed,()=>refused(put(malformed,bad),'22023'),'Invalid credential structure');
 noEffects(malformed,()=>refused(put(malformed,[{...validHashes[0],signer_id:randomUUID()}]),'40001'),'Foreign original signer');
 for(const patch of [{actor:randomUUID()},{tenant:randomUUID()},{operation:randomUUID()}])
  noEffects(malformed,()=>refused(put(malformed,validHashes,patch)),'Wrong actor, tenant or original intent');
 noEffects(malformed,()=>refused(put(malformed,validHashes,{digest:'0'.repeat(64)}),'22023'),'Different reviewed request');
 const missingWork=await setup(),missingHashes=await hashes(missingWork);
 noEffects(missingWork,()=>refused(put(missingWork,missingHashes)),'Missing Work');
 for(const [mutate,restore,label]of [
  [`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`,`UPDATE tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${actor}';`,'current role'],
  [`UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`,`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`,'selected business'],
  [`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='${actor}';`,`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`,'actual user ban'],
  [`UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='${actor}';`,`UPDATE auth.users SET deleted_at=NULL WHERE id='${actor}';`,'deleted user'],
  [`UPDATE auth.users SET is_anonymous=true WHERE id='${actor}';`,`UPDATE auth.users SET is_anonymous=false WHERE id='${actor}';`,'anonymous principal'],
  [`UPDATE tenants SET archived_at=clock_timestamp() WHERE id='${tenant}';`,`UPDATE tenants SET archived_at=NULL WHERE id='${tenant}';`,'archived business'],
  [`UPDATE tenants SET status='trial' WHERE id='${tenant}';`,`UPDATE tenants SET status='active' WHERE id='${tenant}';`,'original trial cohort'],
  [`UPDATE tenants SET status='past_due' WHERE id='${tenant}';`,`UPDATE tenants SET status='active' WHERE id='${tenant}';`,'original past-due cohort'],
  [`UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`,`UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`,'current autonomy']]){
  const held=await approval(),credentials=await hashes(held);sql(mutate);
  try{noEffects(held,()=>refused(put(held,credentials)),label+' withdrawal');}
  finally{sql(restore);}
 }
 for(const [mutate,code,label]of [
  [v=>`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${v.pending.confirmation_id}';`,'42501','expired original approval'],
  [v=>`UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE intent_id='${v.operation}';`,'42501','expired original Work lease'],
  [v=>`UPDATE paige_pending_confirmations SET claimed_in_request=issued_in_request WHERE id='${v.pending.confirmation_id}';`,'42501','issuing request cannot approve itself'],
  [v=>`UPDATE paige_audit_log SET payload=jsonb_set(payload,'{risk}','"ordinary"') WHERE id='${v.audit}';`,'42501','missing HIGH decision'],
  [v=>`UPDATE channel_connectors SET active=false WHERE id='${v.connector}';`,'40001','withdrawn original connector']]){
  const held=await approval(),credentials=await hashes(held);sql(mutate(held));
  noEffects(held,()=>refused(put(held,credentials),code),label);
 }
 const rollback=await approval(),rollbackHashes=await hashes(rollback),rollbackBefore=effects(rollback);
 sql(native('BEGIN;'+put(rollback,rollbackHashes)+'ROLLBACK;'));
 check(effects(rollback)===rollbackBefore,'Original document, signer hashes and issuance event roll back in one transaction');
 const failedWrite=await approval(),failedHashes=await hashes(failedWrite);
 sql(`CREATE FUNCTION public.e04_fixture_fail_credential() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic original signer write failure' USING ERRCODE='23514'; END $$;
  CREATE TRIGGER e04_fixture_fail_credential BEFORE UPDATE OF token_hash ON paige_agreement_signers FOR EACH ROW EXECUTE FUNCTION public.e04_fixture_fail_credential();`);
 try{noEffects(failedWrite,()=>refused(put(failedWrite,failedHashes),'23514'),'Failure after original document freeze');}
 finally{sql('DROP TRIGGER e04_fixture_fail_credential ON paige_agreement_signers;DROP FUNCTION public.e04_fixture_fail_credential();');}
 const commercialApproved=await commercial();
 const finance=()=>sql(`SELECT jsonb_build_object('terms',to_jsonb(t),'invoice',to_jsonb(i)) FROM tenant_client_agreements t,paige_invoices i WHERE t.id='${commercialApproved.terms}' AND i.id='${commercialApproved.invoice}';`);
 const financeBefore=finance(),commercialResult=await makeStore(commercialApproved).issue(),manifest=commercialApproved.manifest;
 const capsule=json(`SELECT commercial_presentation FROM paige_agreements WHERE id='${commercialApproved.a.id}';`);
 check(canonicalPresentationJson(capsule)===canonicalPresentationJson({schema_version:1,payload:manifest.commercial.payload,payload_digest:manifest.commercial.payload_digest,
  presented_body_sha256:manifest.commercial.presented_body_sha256,content_storage_key:sql(`SELECT content_storage_key FROM paige_agreement_document_preparations WHERE id='${commercialApproved.preparation}';`),document_sha256:manifest.document.sha256}),
  'Original commercial engine freezes EXACT approved schema-two principal/deposit/installment presentation');
 check(json(`SELECT to_jsonb(presented_body_markdown) FROM paige_agreements WHERE id='${commercialApproved.a.id}';`)===manifest.commercial.presented_body_markdown,'Original exact retained commercial words, including final newlines, are not regenerated');
 check(finance()===financeBefore&&commercialResult.receipt.state==='recorded','Credential preparation creates no invoice/payment/obligation or financial-source mutation');
 commercialResult.dispose();
 for(const [mutate,label]of [
  [v=>`UPDATE tenant_client_agreements SET collection_terms_version=collection_terms_version+1 WHERE id='${v.terms}';`,'revised original accepted-terms source'],
  [v=>`UPDATE paige_invoices SET billing_draft_version=billing_draft_version+1 WHERE id='${v.invoice}';`,'revised original invoice source']]){
  const held=await commercial(),credentials=await hashes(held);sql(mutate(held));
  noEffects(held,()=>refused(put(held,credentials),'40001'),label);
 }
 const lost=await approval(),lostService=nativeService(lost);let issueCalls=0;
 const recovered=await makeStore(lost,{async rpc(name,args){const result=await lostService.rpc(name,args);if(name==='_issue_prepared_agreement_credentials'){issueCalls++;return {data:null,error:new Error('Synthetic transport lost only after actual native COMMIT')};}return result;}}).issue();
 const recoveredRaw=recovered.takeCredential(lost.signer.id);
 check(issueCalls===1&&!recovered.recovered&&typeof recoveredRaw==='string'&&await sha256Hex(recoveredRaw)===sql(`SELECT token_hash FROM paige_agreement_signers WHERE id='${lost.signer.id}';`),'Lost native acknowledgement reconciles exact committed hashes without issuing another link');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${lost.a.id}' AND detail->>'action'='prepared_signature_credentials_recorded';`)==='1','Lost acknowledgement leaves one original event');
 recovered.dispose();
 const tag='e04_credential_'+randomUUID().replaceAll('-','');
 const race=await approval(),raceHashes=await hashes(race);
 const first=startSession(tag+'first',native('BEGIN;'+put(race,raceHashes)+'SELECT pg_sleep(1.5);COMMIT;'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'first')} AND wait_event='PgSleep');`);
 const second=startSession(tag+'second',native(put(race,raceHashes)));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'second')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([first,second]);
 check(JSON.parse(left).event_id===JSON.parse(right).event_id,'Observed concurrent same-intent calls converge on the SAME original issuance');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${race.a.id}' AND detail->>'action'='prepared_signature_credentials_recorded';`)==='1','Concurrent retry cannot duplicate original issuance evidence');
 const refusalBlock=(v,credentials,code)=>native(`DO $proof$ BEGIN BEGIN ${put(v,credentials).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected original issuance refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;SELECT 'refused';`);
 const replacement=await approval(),replacementHashes=await hashes(replacement),otherHashes=await hashes(replacement);
 const issuing=startSession(tag+'issued',native('BEGIN;'+put(replacement,replacementHashes)+'SELECT pg_sleep(1.5);COMMIT;'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'issued')} AND wait_event='PgSleep');`);
 const replacing=startSession(tag+'replacement',refusalBlock(replacement,otherHashes,'40001'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'replacement')} AND wait_event_type='Lock');`);waits++;
 const [,replacementReply]=await Promise.all([issuing,replacing]);check(replacementReply==='refused','Observed concurrent replacement cannot rotate the original credential');
 const distinct=await approval(),otherIntent=await repeatApproval(distinct),distinctHashes=await hashes(distinct),otherIntentHashes=await hashes(otherIntent);
 const originalIntent=startSession(tag+'intent',native('BEGIN;'+put(distinct,distinctHashes)+'SELECT pg_sleep(1.5);COMMIT;'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'intent')} AND wait_event='PgSleep');`);
 const competingIntent=startSession(tag+'otherintent',refusalBlock(otherIntent,otherIntentHashes,'40001'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'otherintent')} AND wait_event_type='Lock');`);waits++;
 const [,otherReply]=await Promise.all([originalIntent,competingIntent]);
 check(otherReply==='refused'&&sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${distinct.a.id}' AND detail->>'action'='prepared_signature_credentials_recorded';`)==='1','Different approved intents cannot issue competing credentials for the same original document');
 const expiring=await approval(),expiringHashes=await hashes(expiring);
 sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()+interval '0.8 seconds' WHERE id='${expiring.pending.confirmation_id}';`);
 const holding=startSession(tag+'expiryhold',`BEGIN;SELECT id FROM paige_agreements WHERE id='${expiring.a.id}' FOR UPDATE;SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'expiryhold')} AND wait_event='PgSleep');`);
 const expiringBefore=effects(expiring),elapsed=startSession(tag+'expiry',refusalBlock(expiring,expiringHashes,'42501'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'expiry')} AND wait_event_type='Lock');`);waits++;
 const [,expiredReply]=await Promise.all([holding,elapsed]);check(expiredReply==='refused'&&effects(expiring)===expiringBefore,'Actual approval expiry after an observed source wait leaves no credential/document effect');
 const revoked=await approval(),revokedHashes=await hashes(revoked),revokedBefore=effects(revoked);
 const revoking=startSession(tag+'revoke',`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}' AND tenant_id='${tenant}';SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'revoke')} AND wait_event='PgSleep');`);
 const retired=startSession(tag+'retired',refusalBlock(revoked,revokedHashes,'42501'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'retired')} AND wait_event_type='Lock');`);waits++;
 try{const [,retiredReply]=await Promise.all([revoking,retired]);check(retiredReply==='refused'&&effects(revoked)===revokedBefore,'Committed owner-role withdrawal wins after an observed actor wait');}
 finally{sql(`UPDATE tenant_members SET role='owner' WHERE user_id='${actor}' AND tenant_id='${tenant}';`);}
 const changedCommercial=await commercial(),changedHashes=await hashes(changedCommercial),changedBefore=effects(changedCommercial);
 const changing=startSession(tag+'terms',`BEGIN;UPDATE tenant_client_agreements SET collection_terms_version=collection_terms_version+1 WHERE id='${changedCommercial.terms}';SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'terms')} AND wait_event='PgSleep');`);
 const stale=startSession(tag+'stale',refusalBlock(changedCommercial,changedHashes,'40001'));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'stale')} AND wait_event_type='Lock');`);waits++;
 const [,staleReply]=await Promise.all([changing,stale]);check(staleReply==='refused'&&effects(changedCommercial)===changedBefore,'Original commercial source is revalidated after observed terms-row wait');
 const historicalBefore=effects(v);
 sql(`UPDATE channel_connectors SET active=false WHERE id='${v.connector}';UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';UPDATE paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE intent_id='${v.operation}';`);
 try{check(json(native(get(v))).event_id===receipt.event_id&&effects(v)===historicalBefore,'History survives changed delivery eligibility/expiry/autonomy without reminting or claiming sending');}
 finally{sql(`UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tenant_id='${tenant}' AND tool_key='agreement_send';`);}
 // These consequential holds MUST remain closed in this native prerequisite.
 refused(`UPDATE public.paige_agreements SET status='sent' WHERE id='${v.a.id}';`,'23514',fixtureOwner);
 for(const state of ['viewed','partially_signed','completed'])
  refused(`UPDATE public.paige_agreements SET status='${state}' WHERE id='${v.a.id}';`,'23514',fixtureOwner);
 refused(`UPDATE public.paige_agreement_signers SET status='viewed' WHERE id='${v.signer.id}';`,'23514',fixtureOwner);
 refused(`UPDATE public.paige_agreement_signers SET status='signed' WHERE id='${v.signer.id}';`,'23514',fixtureOwner);
 refused(`UPDATE public.paige_agreements SET sealed_storage_key='${tenant}/${v.a.id}/invented-seal.pdf',sealed_sha256=repeat('b',64) WHERE id='${v.a.id}';`,'23514',fixtureOwner);
 refused(`UPDATE public.paige_agreement_signers SET token_expires_at=token_expires_at+interval '1 day' WHERE id='${v.signer.id}';`,'23514',fixtureOwner);
 refused(`UPDATE public.paige_agreement_signers SET token_hash=NULL WHERE id='${v.signer.id}';`,'23514',fixtureOwner);
 sql(`UPDATE paige_agreement_signers SET token_revoked_at=clock_timestamp() WHERE id='${v.signer.id}';`);
 refused(`UPDATE public.paige_agreement_signers SET token_revoked_at=NULL WHERE id='${v.signer.id}';`,'23514',fixtureOwner);
 check((await store.read()).event_id===receipt.event_id,'Revocation preserves historical credential evidence without making a link usable');
 const legacy=fresh(),legacyHash=await sha256Hex(mintSignerToken()),legacySigner=sql(`SELECT id FROM paige_agreement_signers WHERE agreement_id='${legacy.id}' ORDER BY signing_order LIMIT 1;`);
 sql(`UPDATE paige_agreements SET content_storage_key='${tenant}/${legacy.id}/original-legacy.pdf',content_sha256=repeat('a',64) WHERE id='${legacy.id}';
  UPDATE paige_agreement_signers SET token_hash=${q(legacyHash)},token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${legacySigner}';`);
 check(sql(`SELECT token_hash=${q(legacyHash)} FROM paige_agreement_signers WHERE id='${legacySigner}';`)==='t','Unprepared legacy document/credential behavior is unchanged, with no prepared-path exception');
 for(const identity of ['public._read_prepared_agreement_credentials(uuid,uuid,uuid,text)',
  'public._freeze_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)']){
  const originalDefinition=sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`);
  sql(originalDefinition.replace('BEGIN','BEGIN\n -- Synthetic later writer; only this disposable proof database.'));
  let denied=false;try{sql(migration);}catch(error){denied=String(error).includes('reconcile before applying');}
  finally{sql(originalDefinition);}
  check(denied,'Forward migration refuses to overwrite changed '+identity);
 }
 sql('ALTER TABLE paige_agreement_signers DISABLE TRIGGER trg_paige_preparation_legacy_token_hold;');
 let triggerRefused=false;try{sql(migration);}catch(error){triggerRefused=String(error).includes('trigger changed; reconcile before applying');}
 finally{sql('ALTER TABLE paige_agreement_signers ENABLE TRIGGER trg_paige_preparation_legacy_token_hold;');}
 check(triggerRefused,'Forward migration refuses a disabled or changed original credential hold');
 check(protectedMetadata()===before,'Original protected engines remain exact after issuance controls');
 return {checks,migrationReplay:2,concurrentSessions:sessions,observedLockWaits:waits,migrationSha256:createHash('sha256').update(migration).digest('hex'),proofBodySha256:createHash('sha256').update(provePreparedSignatureCredentials.toString()).digest('hex'),scope:'Local original native/source credential proof only; no sending/signing/provider or customer acceptance'};
}
