import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {prepareAgreementFields} from '../../supabase/functions/_shared/agreements/field-preparation.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {confirmFingerprint} from '../../supabase/functions/_shared/confirm-fingerprint.ts';

// Extends the ORIGINAL directory-checked, unique disposable Agreements DB.
// Actual native actor/preparation/confirmation/autonomy bodies are exercised;
// mailbox/Storage metadata is synthetic. No signer, provider or customer proof.
export async function provePreparedConfirmation({sql,read,context,tenant,actor,client,fresh,quote,startSession,observe}) {
 let checks=0,sessions=0,waits=0;
 const check=(v,m)=>{assert(v,m);checks++;},q=quote;
 const json=s=>{const value=sql(s);return value===''?null:JSON.parse(value);};
 const literal=v=>q(JSON.stringify(v))+'::jsonb';
 const native=s=>'SET ROLE service_role;'+s;
 const refused=(command,code='42501',role='service_role')=>{
  sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${command.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected native approval refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;
 };
 const snapshot=()=>sql("SELECT jsonb_build_object('agreements',(SELECT count(*) FROM paige_agreements),'signers',(SELECT count(*) FROM paige_agreement_signers),'events',(SELECT count(*) FROM paige_agreement_events),'preparations',(SELECT count(*) FROM paige_agreement_document_preparations));");
 const originals=()=>sql("SELECT jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_sales_invoice_actor','_record_agreement_signature','_read_prepared_agreement_seal','_paige_preparation_legacy_effect_hold','_paige_preparation_legacy_token_hold','_read_agreement_document_preparation','_retain_agreement_document_preparation','resolve_tool_autonomy');");
 const before=snapshot(),original=originals();
 const proofSource=read('scripts/agreements/prepared-confirmation-proof.mjs');
 const proofBody=proofSource.slice(proofSource.indexOf('export async function provePreparedConfirmation')+'export '.length).trim();
 check(provePreparedConfirmation.toString()===proofBody,'Executed proof body equals its retained source, including every current control');
 // These actual production columns were absent from the bounded legacy fixture.
 // No fake permission or actor implementation replaces the original helpers.
 sql(`CREATE SCHEMA IF NOT EXISTS private;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
  CREATE TABLE channel_connectors(id uuid PRIMARY KEY,tenant_id uuid,channel_type text,provider text,active boolean,status text);
  DELETE FROM tenant_tool_autonomy WHERE tenant_id='${tenant}' AND tool_key='agreement_send';
  INSERT INTO tenant_tool_autonomy VALUES('${tenant}','agreement_send','confirm',clock_timestamp());`);
 for(const f of ['20261023000000_confirmations_bind_the_approval_to_the_call.sql',
  '20261026000000_a_token_cannot_be_redeemed_by_the_turn_that_minted_it.sql',
  '20261201000400_canonical_proposal_integrity.sql'])sql(read('supabase/migrations/'+f));
 const weekly=read('supabase/migrations/20271112130000_experience05_confirmed_weekly_draft.sql');
 const claimedColumn=weekly.split('\n').find(l=>l.startsWith('ALTER TABLE public.paige_pending_confirmations ADD COLUMN IF NOT EXISTS claimed_in_request uuid;'));
 assert(claimedColumn,'Original claimed-request column ABI');sql(claimedColumn);
 const migration=read('supabase/migrations/20271114140004_e04_prepared_request_confirmation.sql');
 if(!process.argv.includes('--prepared-confirmation-baseline')){sql(migration);sql(migration);}
 check(sql("SELECT to_regprocedure('public._issue_prepared_agreement_confirmation(uuid,uuid,jsonb,text,uuid)') IS NOT NULL;")==='t',
  'Actual originating native confirmation writer exists');
 check(snapshot()===before&&originals()===original,'Migration/replay changes no original record, signature/hold/actor/autonomy body or ACL');
 const fixture=async()=>{
  const a=fresh();
  const source=json(`SELECT jsonb_build_object('tenant_id',a.tenant_id,'agreement_id',a.id,'client_id',a.contact_id,
   'version',a.version,'updated_at',a.updated_at,'status',a.status,'signers',(SELECT jsonb_agg(jsonb_build_object('id',s.id,
    'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,'signing_order',s.signing_order,'status',s.status)
    ORDER BY s.signing_order,s.id) FROM paige_agreement_signers s WHERE s.agreement_id=a.id)) FROM paige_agreements a WHERE a.id='${a.id}';`);
  const signer=source.signers[0],preparation=randomUUID(),connector=randomUUID(),operation=randomUUID(),cycle=randomUUID(),nonce=randomUUID();
  const document={sha256:'a'.repeat(64),byte_length:1234,pages:[{page:1,crop_x:0,crop_y:0,crop_width:600,crop_height:800,rotation:0,width:600,height:800}]};
  const prepared=await prepareAgreementFields(source,document,[{id:randomUUID(),signer_id:signer.id,kind:'signature',page:1,x:20,y:20,width:200,height:40,required:true,label:'Signature'}]);
  assert(prepared.ready_for_review);
  const manifest=canonicalPresentationJson(prepared.manifest),digest=createHash('sha256').update(manifest).digest('hex');
  sql(native(`SELECT public._retain_agreement_document_preparation('${actor}','${tenant}','${a.id}','${client}',${source.version},${q(source.updated_at)},
   '${preparation}',NULL,${q(tenant+'/'+a.id+'/synthetic-source.pdf')},${q(manifest)},'${digest}',NULL);`));
  sql(`INSERT INTO channel_connectors VALUES('${connector}','${tenant}','email','sendgrid',true,'active');`);
  const request={agreementId:a.id,expectedTenantId:tenant,operationId:operation,preparationId:preparation,preparationSha256:digest,
   reviewSha256:'b'.repeat(64),source:{client_id:client,version:source.version,updated_at:source.updated_at},title:'Original supplied document',
   document:{sha256:document.sha256,byte_length:1234,page_count:1},recipients:[{id:signer.id,full_name:signer.full_name,email:signer.email,
    signer_role:signer.signer_role,signing_order:signer.signing_order,field_count:1}],requestSchemaVersion:1,
   sender:{connector_id:connector,provider:'sendgrid',from_address:'business@example.test',from_name:null,reply_to:null},
   messages:[{signer_id:signer.id,to:signer.email,subject:'Please review',body_text:'Synthetic reviewed words',body_html:'<p>Synthetic reviewed words</p>'}]};
  const args={request,request_sha256:createHash('sha256').update(canonicalPresentationJson(request)).digest('hex'),operation_id:operation,
   expected_tenant_id:tenant,approval_subject:'agreement.prepared_signature_request:'+a.id+':'+operation,approval_cycle_nonce:cycle};
  return {a,source,signer,preparation,connector,operation,nonce,args,fp:await confirmFingerprint('agreement_send',args)};
 };
 const issue=(v,args=v.args,fp=v.fp,nonce=v.nonce)=>`SELECT public._issue_prepared_agreement_confirmation('${actor}','${tenant}',${literal(args)},${q(fp)},'${nonce}');`;
 const readApproval=v=>`SELECT public._read_prepared_agreement_confirmation('${actor}','${tenant}','${v.operation}');`;
 const claim=(v,nonce=randomUUID(),fp=v.fp)=>`SELECT public._claim_prepared_agreement_confirmation('${actor}','${tenant}','${v.operation}',${q(fp)},'${nonce}');`;
 const sameRecords=()=>{const stamp=snapshot();return ()=>check(snapshot()===stamp,'Approval operation creates no agreement/signature/document/event effect');};
 const positive=await fixture(),unchanged=sameRecords();
 check(json(native(readApproval(positive)))===null,'Original operation has no approval before issuance');
 const issued=json(native(issue(positive))),row=json(native(readApproval(positive)));
 check(row.state==='proposed'&&canonicalPresentationJson(row.args)===canonicalPresentationJson(positive.args),'Actual original pending row retains exact complete reviewed args');
 check(issued.expires_at===row.expires_at&&Date.parse(issued.expires_at)>Date.now(),'Expiry derives from native clock, not browser data');
 check(json(native(issue(positive))).expires_at===issued.expires_at,'Repeated initial request does not extend expiry or create a new approval');
 check(sql(`SELECT count(*) FROM paige_pending_confirmations WHERE args->>'operation_id'='${positive.operation}';`)==='1','One original proposal per actor/operation');
 check(json(native(claim(positive,positive.nonce)))===null,'Issuing request cannot approve itself');
 check(json(native(claim(positive,randomUUID(),'0'.repeat(16))))===null,'Wrong fingerprint cannot consume the original approval');
 const approvedIn=randomUUID(),claimed=json(native(claim(positive,approvedIn)));
 check(claimed.confirmation_id===row.confirmation_id&&claimed.request_nonce===approvedIn
  &&canonicalPresentationJson(claimed.args)===canonicalPresentationJson(positive.args),'Atomic claim returns stored exact args and actual claimed request identity');
 check(json(native(claim(positive)))===null&&json(native(readApproval(positive))).state==='consumed','Claim is single-use and original read reports consumption');
 refused(issue(positive),'40001');unchanged();
 for(const role of ['anon','authenticated'])for(const command of [readApproval(positive),issue(positive),claim(positive)])refused(command,'42501',role);
 const meta=json("SELECT jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'config',proconfig,'defaults',pronargdefaults,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) ORDER BY proname) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_read_prepared_agreement_confirmation','_issue_prepared_agreement_confirmation','_claim_prepared_agreement_confirmation');");
 check(meta.length===3&&meta.every(m=>m.definer&&m.config.includes('search_path=""')&&m.defaults===0&&m.service&&!m.anon&&!m.authenticated),
  'Exact service-only empty-search-path native ABI, no browser or public execution grant');
 check(sql("SELECT has_function_privilege('service_role','private.e04_prepared_confirmation_source(uuid,uuid,jsonb)','EXECUTE');")==='f','Private source constructor has no external execute grant');
 for(const mutation of [v=>({...v,expected_tenant_id:randomUUID()}),v=>({...v,extra:true}),
  v=>({...v,request_sha256:'0'.repeat(64)}),v=>({...v,approval_subject:'foreign'}),v=>({...v,approval_cycle_nonce:'not-a-uuid'})]){
  const v=await fixture();refused(issue(v,mutation(structuredClone(v.args))),'22023');
 }
 for(const change of [r=>r.title='Changed title',r=>r.document.sha256='c'.repeat(64),r=>r.recipients[0].email='foreign@example.test',
  r=>r.messages[0].to='foreign@example.test',r=>r.sender.connector_id=randomUUID()]){
  const v=await fixture(),args=structuredClone(v.args);change(args.request);
  args.request_sha256=createHash('sha256').update(canonicalPresentationJson(args.request)).digest('hex');
  refused(issue(v,args),'40001');
 }
 for(const [table,set,where,restore]of [
  ['auth.users','is_anonymous=true',`id='${actor}'`,'is_anonymous=false'],
  ['auth.users','deleted_at=clock_timestamp()',`id='${actor}'`,'deleted_at=NULL'],
  ['auth.users',"banned_until=clock_timestamp()+interval '1 day'",`id='${actor}'`,'banned_until=NULL'],
  ['tenants','archived_at=clock_timestamp()',`id='${tenant}'`,'archived_at=NULL'],
  ['profiles',`active_tenant_id='${randomUUID()}'`,`user_id='${actor}'`,`active_tenant_id='${tenant}'`],
  ['tenant_members',"role='member'",`user_id='${actor}' AND tenant_id='${tenant}'`,"role='owner'"]]){
  const v=await fixture();sql(`UPDATE ${table} SET ${set} WHERE ${where};`);
  try{refused(issue(v));refused(readApproval(positive));}finally{sql(`UPDATE ${table} SET ${restore} WHERE ${where};`);}
 }
 const held=await fixture();sql("UPDATE tenant_tool_autonomy SET mode='off' WHERE tool_key='agreement_send';");
 try{refused(issue(held));}finally{sql("UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tool_key='agreement_send';");}
 const policyWithdrawn=await fixture();json(native(issue(policyWithdrawn)));
 sql("UPDATE tenant_tool_autonomy SET mode='off' WHERE tool_key='agreement_send';");
 try{refused(claim(policyWithdrawn));}finally{sql("UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tool_key='agreement_send';");}
 check(json(native(readApproval(policyWithdrawn))).state==='proposed','Withdrawn current autonomy cannot consume a formerly prepared approval');
 const superseded=await fixture();json(native(issue(superseded)));
 const retained=json(`SELECT manifest_canonical::jsonb FROM paige_agreement_document_preparations WHERE id='${superseded.preparation}';`);
 retained.fields[0].label='Corrected signature label';
 const corrected=await prepareAgreementFields(superseded.source,retained.document,retained.fields);
 const canonical=canonicalPresentationJson(corrected.manifest),changedHash=createHash('sha256').update(canonical).digest('hex');
 sql(native(`SELECT public._retain_agreement_document_preparation('${actor}','${tenant}','${superseded.a.id}','${client}',${superseded.source.version},${q(superseded.source.updated_at)},
  '${randomUUID()}','${superseded.preparation}',${q(tenant+'/'+superseded.a.id+'/corrected-source.pdf')},${q(canonical)},'${changedHash}',NULL);`));
 refused(claim(superseded),'40001');
 check(json(native(readApproval(superseded))).state==='proposed','A genuine original preparation revision retires old approval without consuming it');
 const withdrawn=await fixture();json(native(issue(withdrawn)));sql(`UPDATE channel_connectors SET active=false WHERE id='${withdrawn.connector}';`);
 refused(claim(withdrawn),'40001');check(json(native(readApproval(withdrawn))).state==='proposed','Failed sender revalidation does not consume approval');
 const expired=await fixture();json(native(issue(expired)));sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE args->>'operation_id'='${expired.operation}';`);
 check(json(native(claim(expired)))===null&&json(native(readApproval(expired))).state==='expired','Expired proposal remains expired and cannot be claimed');refused(issue(expired),'40001');
 const legacy=await fixture();json(native(issue(legacy)));sql(`UPDATE paige_pending_confirmations SET server_issued_at=NULL WHERE args->>'operation_id'='${legacy.operation}';`);
 check(json(native(claim(legacy)))===null&&json(native(readApproval(legacy))).state==='unverified','Missing original server marker never becomes approval');refused(issue(legacy),'40001');
 const concurrent=await fixture();json(native(issue(concurrent)));const tag='e04_confirmation_'+randomUUID().slice(0,8);
 const one=startSession(tag+'one','BEGIN;'+native(claim(concurrent))+"SELECT pg_sleep(0.8);COMMIT;");
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'one')} AND wait_event='PgSleep');`);
 const two=startSession(tag+'two',native(claim(concurrent))+"SELECT 'claim_returned';");sessions+=2;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'two')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([one,two]);
 check(left.includes('confirmation_id')&&!right.includes('confirmation_id')&&right.includes('claim_returned'),'Two actual concurrent claims return stored args exactly once');
 const waited=await fixture();json(native(issue(waited)));
 sql(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE args->>'operation_id'='${waited.operation}';`);
 const blocker=startSession(tag+'expiryhold',`BEGIN;SELECT id FROM paige_agreements WHERE id='${waited.a.id}' FOR UPDATE;SELECT pg_sleep(1);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'expiryhold')} AND wait_event='PgSleep');`);
 const waiter=startSession(tag+'expiryread',native(claim(waited))+"SELECT 'expired_returned';");sessions+=2;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'expiryread')} AND wait_event_type='Lock');`);waits++;
 const [,expiryRead]=await Promise.all([blocker,waiter]);
 check(!expiryRead.includes('confirmation_id')&&expiryRead.includes('expired_returned'),'Expiry revalidated using actual clock after an observed source lock wait');
 const revoked=await fixture();json(native(issue(revoked)));
 const revoker=startSession(tag+'revoke',`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}' AND tenant_id='${tenant}';SELECT pg_sleep(0.8);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'revoke')} AND wait_event='PgSleep');`);
 const denied=startSession(tag+'denied',native(`DO $proof$ BEGIN BEGIN ${claim(revoked).replace(/^SELECT\s+/,'PERFORM ')} RAISE EXCEPTION 'Expected revocation refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions+=2;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'denied')} AND wait_event_type='Lock');`);waits++;
 try{const [,result]=await Promise.all([revoker,denied]);check(result==='refused','Actual committed role revocation wins before claim');}
 finally{sql(`UPDATE tenant_members SET role='owner' WHERE user_id='${actor}' AND tenant_id='${tenant}';`);}
 check(originals()===original,'Every original signature/hold/actor/preparation/autonomy body and ACL remains unchanged');
 if(process.argv.includes('--prepared-work'))console.log(JSON.stringify({checkpoint:'Original confirmation controls before Work adoption',checks,concurrentSessions:sessions,observedLockWaits:waits}));
 const preparedWork=process.argv.includes('--prepared-work')?await(await import('./prepared-signature-work-proof.mjs')).provePreparedSignatureWork({sql,read,tenant,actor,quote,fixture,issue,claim,startSession,observe}):null;
 return {result:'PASS',checks,migrationReplay:2,concurrentSessions:sessions,observedLockWaits:waits,preparedWork,
  proofBodySha256:createHash('sha256').update(proofBody).digest('hex'),migrationSha256:createHash('sha256').update(migration).digest('hex'),
  scope:'Original native pending-confirmation prerequisite only. Synthetic mailbox/Storage metadata; no prepared issuer/provider/signature/field effect, activation or customer acceptance.'};
}
