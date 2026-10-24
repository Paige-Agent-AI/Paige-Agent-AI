import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {hasCommercialEffectuationReceipt,readCommercialEffectuationConsequence,parseCommercialEffectuationCommand} from '../../supabase/functions/_shared/sales-commercial/effectuation-command.ts';

/** Actual installed Sales writers/actor/approval/Rail bodies in the caller's
 * directory-checked unique disposable DB only. Selective original2191 proof,
 * current schema2/closed-package compatibility. No hosted role or business. */
export async function proveEffectiveCommercialTerms({sql,concurrent,refuseAfterLock,read,scope,tenant,actor,termsId,invoiceId,agreementId,prepared,migration}){
 let checks=0;
 const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const extract=(source,name)=>{
  const re=new RegExp('create or replace function public\\.'+name+'\\(','i'),start=source.search(re);assert(start>=0,name);
  const body=source.indexOf('$$',start),end=source.indexOf('$$;',body+2);assert(body>start&&end>body,name);return source.slice(start,end+3);
 };
 const collections=read('supabase/migrations/20270547000000_sales_collections.sql');
 sql(collections.slice(collections.indexOf('CREATE TABLE IF NOT EXISTS public.paige_sales_collection_operations('),collections.indexOf('CREATE INDEX IF NOT EXISTS sales_collection_batches_tenant')));
 sql(extract(collections,'_sales_collection_frozen'));
 sql(`CREATE TRIGGER sales_collection_operations_frozen BEFORE UPDATE OR DELETE ON paige_sales_collection_operations FOR EACH ROW EXECUTE FUNCTION _sales_collection_frozen();
  -- Current native document fixture already has starts_on/ends_on/price_basis.
  CREATE TRIGGER effective_test_timestamp BEFORE UPDATE ON tenant_client_agreements FOR EACH ROW EXECUTE FUNCTION tenant_set_updated_at();
  ALTER TABLE paige_workspace_events ADD COLUMN job_attempt_id text,ADD COLUMN llm_trace_id uuid,ADD COLUMN release_id text,ADD COLUMN detail jsonb;
  CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz);
  CREATE FUNCTION trust_effective_rung() RETURNS integer LANGUAGE sql STABLE AS 'SELECT coalesce(nullif(current_setting(''test.rung'',true),''''),''1'')::integer';`);
 const autonomy=read('supabase/migrations/20270540000000_tool_autonomy_ceiling_fact.sql');
 sql(extract(autonomy,'_tool_autonomy_resolution')+extract(autonomy,'resolve_tool_autonomy'));
 const writer=read('supabase/migrations/20270532100000_commercial_terms_refusals_reach_the_operator.sql');
 const writerStart=writer.indexOf('CREATE OR REPLACE FUNCTION public.set_client_agreement_status('),writerEnd=writer.indexOf('$function$;',writer.indexOf('AS $function$',writerStart)+14)+11;
 sql(writer.slice(writerStart,writerEnd));
 const original=sql("SELECT pg_get_functiondef('set_client_agreement_status(uuid,uuid,text,timestamptz)'::regprocedure);");
 const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 sql(extract(lifecycle,'_sales_invoice_governance'));
 sql(extract(collections,'read_sales_collection_command_result'));
 const commands=read('supabase/migrations/20270587000000_sales_governed_commercial_create.sql');
 sql(extract(commands,'preview_sales_collection_command')+extract(commands,'execute_sales_collection_command'));
 sql(commands.slice(commands.indexOf('REVOKE ALL ON FUNCTION public.preview_sales_collection_command'),commands.indexOf('-- Extend the installed catalogue')));
 const rail=read('supabase/migrations/20270107000000_receipt_correlation_and_detail.sql');
 sql(extract(rail,'_record_workspace_rail_event')+extract(rail,'record_capability_run'));
 sql(read('supabase/migrations/20270411090000_one_record_capability_run_not_two.sql'));
 sql(read('supabase/migrations/20271031004000_exp04_s3_owner_time_zone_change_attribution.sql'));
 // Current final Rail wrapper, not the old branch's time-zone-only fixture.
 // Its source pins pg_catalog/public; deployed metadata pins empty. Both exact
 // known configurations are retained, and their difference is not attributed.
 sql(read('supabase/migrations/20271113040000_e2_read_receipt_labels.sql'));
 // Execute the unchanged E02 pgTAP assertion15 predicate on the real native
 // functions before and after composition. This is its contract, not an E04
 // replacement expectation; the original20-assertion suite stays unchanged.
 const e02ReceiptMetadata=`SELECT bool_and(provolatile='i' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'])
  FROM pg_proc WHERE oid IN ('public._workspace_event_display(text,text,text)'::regprocedure,
   'public._workspace_event_display_before_e02_reads(text,text,text)'::regprocedure);`;
 assert.equal(sql(e02ReceiptMetadata),'t','Original E02 receipt metadata contract before E04 composition');checks++;
 const command={action:'collection.effectuate_terms',agreement_id:termsId,expected_version:prepared.payload.source.terms_version,
  expected_updated_at:prepared.payload.source.terms_updated_at,signing_id:agreementId,signing_version:prepared.payload.source.agreement_version,
  invoice_id:invoiceId,invoice_draft_version:prepared.payload.source.invoice_draft_version,payload_digest:prepared.payload_digest,sealed_sha256:'b'.repeat(64)};
 const op='77777777-0000-4000-8000-000000000001';
 const governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_effectuate_commercial_terms',action:command.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
 const preview=(value=command)=>`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(value)});`;
 const execute=(value=command,g=governance,id=op,who=actor,t=tenant)=>`SELECT execute_sales_collection_command('${who}','${t}','${id}',${literal(value)},${literal(g)});`;
 // Before the new migration this action has no canonical implementation.
 assert.throws(()=>sql(scope+'SET ROLE service_role;'+preview()),/22023/);checks++;
 const manual=(status,stamp='NULL')=>`SELECT set_client_agreement_status('${tenant}','${termsId}','${status}',${stamp});`;
 const oldManualKeys=Object.keys(JSON.parse(sql(scope+'BEGIN;SET ROLE authenticated;'+manual('active')))).sort();
 const manualBefore=[];
 for(const [prefix,status,stamp] of [["SET test.uid='';",'active'],["SET test.admin='false';",'active'],['','bogus'],['','active',"'2000-01-01'::timestamptz"],['BEGIN;UPDATE tenant_client_agreements SET starts_on=NULL;','active']]){
  let failure;try{sql(scope+prefix+'SET ROLE authenticated;'+manual(status,stamp));}catch(error){failure=error.message;}
  assert(failure,'Manual guard must refuse before extraction');manualBefore.push(failure.split('\n').find(line=>line.startsWith('ERROR:')));
 }
 const incumbents=['set_client_agreement_status(uuid,uuid,text,timestamptz)','read_sales_collection_command_result(uuid,uuid,uuid,jsonb)',
  'preview_sales_collection_command(uuid,uuid,jsonb)','execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)','_workspace_event_display(text,text,text)'];
 const refuseDrift=(identity,metadata=false)=>{
  // Rollback-only changes in this unique disposable DB. Keep every original
  // dispatch anchor present: a substring check must not accept changed source.
  const drift=metadata?`ALTER FUNCTION public.${identity} SET search_path=pg_catalog;`:
   `DO $drift$ DECLARE b text; d text; BEGIN SELECT prosrc,pg_get_functiondef(oid) INTO b,d FROM pg_proc WHERE oid='public.${identity}'::regprocedure;
    EXECUTE replace(d,b,b||E'\n-- synthetic drift, original dispatch anchors retained'); END $drift$;`;
  assert.throws(()=>sql('BEGIN;'+drift+read(migration)),error=>/23514:/.test(error.message)&&/changed:/.test(error.message));checks++;
 };
 for(const identity of incumbents){refuseDrift(identity);refuseDrift(identity,true);}
 sql(read(migration));sql(read(migration));
 assert.equal(sql(e02ReceiptMetadata),'t','Preserve the original E02 immutable/invoker/pinned-path contract after E04 and replay');checks++;
 for(const identity of [...incumbents,'_set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)',
  '_sales_effective_provenance_guard()','_validate_sales_effectuation(jsonb)','_preview_sales_effectuation(uuid,uuid,jsonb)',
  '_execute_sales_effectuation(uuid,uuid,uuid,jsonb,jsonb)','_workspace_event_display_before_e04_effectuation(text,text,text)']){
  refuseDrift(identity);refuseDrift(identity,true);
 }
 const helper=sql("SELECT pg_get_functiondef('_set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)'::regprocedure);");
 const business=original.slice(original.indexOf('  _status :='),original.lastIndexOf('\nEND;')).trimEnd();
 assert(helper.includes(business),JSON.stringify({businessTail:business.slice(-80),helperTail:helper.slice(-100)}));checks++;
 const wrapper=sql("SELECT pg_get_functiondef('set_client_agreement_status(uuid,uuid,text,timestamptz)'::regprocedure);");
 assert.equal(wrapper,original.replace(business,'  RETURN public._set_client_agreement_status(_actor,_tenant,_agreement_id,_status,_expected_updated_at) - ARRAY[\'effective_signing_id\',\'effective_terms_version\',\'effective_at\',\'effective_operation_id\',\'effective_source_digest\'];'));checks++;
 assert.deepEqual(Object.keys(JSON.parse(sql(scope+'BEGIN;SET ROLE authenticated;'+manual('active')))).sort(),oldManualKeys);checks++;
 let index=0;
 for(const [prefix,status,stamp] of [["SET test.uid='';",'active'],["SET test.admin='false';",'active'],['','bogus'],['','active',"'2000-01-01'::timestamptz"],['BEGIN;UPDATE tenant_client_agreements SET starts_on=NULL;','active']]){
  assert.throws(()=>sql(scope+prefix+'SET ROLE authenticated;'+manual(status,stamp)),error=>error.message.split('\n').find(line=>line.startsWith('ERROR:'))===manualBefore[index++]);checks++;
 }
 for(const key of ['set_business_time_zone','read_business_time_zone','read_sales_collections','read_sales_commercial_package','other_key'])for(const outcome of ['capability_succeeded','capability_failed']){
  assert.equal(sql(`SELECT _workspace_event_display('capability_run','${outcome}','${key}')=_workspace_event_display_before_e04_effectuation('capability_run','${outcome}','${key}');`),'t');checks++;
 }
 assert.equal(JSON.parse(sql("SELECT _workspace_event_display('capability_run','capability_succeeded','sales_effectuate_commercial_terms');")).actor_type,'owner_staff');checks++;
 const eligible=JSON.parse(sql(scope+'SET ROLE service_role;'+preview()));
 assert.equal(eligible.eligible,true);checks++;
 assert(readCommercialEffectuationConsequence(eligible.consequence,parseCommercialEffectuationCommand(command)));checks++;
 for(const [key,value] of [['extra_approval',true],['expected_version',1.5],['signing_version',0],['invoice_draft_version',null],['expected_updated_at','2026-10-15'],['payload_digest','z'.repeat(64)],['sealed_sha256',null],['signing_id','not-a-uuid']]){
  assert.throws(()=>sql(scope+'SET ROLE service_role;'+preview({...command,[key]:value})),/22023/);checks++;
 }
 for(const key of Object.keys(command)){const bad={...command};delete bad[key];assert.throws(()=>sql(scope+'SET ROLE service_role;'+preview(bad)),/22023/);checks++;}
 for(const mutation of [
  `UPDATE tenant_client_agreements SET starts_on=NULL WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET price_basis='quote_pending' WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET starts_on='2026-10-16' WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET ends_on='2027-08-15' WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET price_basis='catalog' WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET updated_at=updated_at+interval '1 microsecond' WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET agreed_amount_minor=999 WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET collection_terms_version=2 WHERE id='${termsId}';`,
  `UPDATE paige_agreements SET sealed_sha256=repeat('d',64) WHERE id='${agreementId}';`,
  `UPDATE paige_agreement_signers SET status='viewed' WHERE agreement_id='${agreementId}';`,
  `UPDATE paige_invoices SET billing_draft_version=2 WHERE id='${invoiceId}';`,
 ]){
  assert.equal(JSON.parse(sql(scope+'BEGIN;SET LOCAL session_replication_role=replica;'+mutation+'SET ROLE service_role;'+preview())).eligible,false);checks++;
  assert.throws(()=>sql(scope+'BEGIN;SET LOCAL session_replication_role=replica;'+mutation+'SET ROLE service_role;'+execute()),/40001/);checks++;
 }
 for(const [prefix,g] of [
  ['',{}],['',{...governance,approval_channel:'standing_autonomy_setting'}],['',{...governance,approved_fingerprint:null}],
  ['',{...governance,decision_receipt_recorded:false}],
  [`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`,governance],
  [`BEGIN;UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`,governance],
  ["SET test.rung='0';",governance],
  [`BEGIN;INSERT INTO tenant_tool_autonomy VALUES('${tenant}','sales_effectuate_commercial_terms','off',now());`,governance],
 ]){assert.throws(()=>sql(scope+prefix+'SET ROLE service_role;'+execute(command,g)),/42501/);checks++;}
 for(const role of ['anon','authenticated']){
  assert.throws(()=>sql(scope+`SET ROLE ${role};`+execute()),/42501/);checks++;
 }
 for(const role of ['anon','authenticated','service_role'])for(const signature of ['_set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)','_execute_sales_effectuation(uuid,uuid,uuid,jsonb,jsonb)','_preview_sales_effectuation(uuid,uuid,jsonb)','_validate_sales_effectuation(jsonb)']){
  assert.equal(sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f');checks++;
 }
 sql('GRANT UPDATE,SELECT ON tenant_client_agreements TO authenticated,service_role;');
 for(const role of ['authenticated','service_role']){
  assert.throws(()=>sql(scope+`SET ROLE ${role};UPDATE tenant_client_agreements SET effective_signing_id='${agreementId}',effective_terms_version=1,effective_at=now(),effective_operation_id='${op}',effective_source_digest=repeat('a',64) WHERE id='${termsId}';`),/42501/);checks++;
 }
 // Force the real Rail INSERT to fail: all business/provenance/operations roll back.
 assert.throws(()=>sql(scope+`BEGIN;ALTER TABLE paige_workspace_events ADD CONSTRAINT fail_effectuation_receipt CHECK(capability_key IS DISTINCT FROM 'sales_effectuate_commercial_terms');SET ROLE service_role;`+execute()),/23514/);checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'draft');checks++;
 assert.equal(sql(`SELECT count(*) FROM paige_sales_collection_operations;`),'0');checks++;
 assert.equal(sql(`SELECT effective_operation_id IS NULL FROM tenant_client_agreements WHERE id='${termsId}';`),'t');checks++;
 assert.throws(()=>sql(scope+`BEGIN;INSERT INTO paige_workspace_events(tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key) VALUES('${tenant}','${actor}','capability_run','${op}',0,'capability_succeeded','other_key');SET ROLE service_role;`+execute()),/55000/);checks++;
 for(const column of ['effective_terms_version','effective_source_digest']){
  const values={effective_signing_id:`'${agreementId}'`,effective_terms_version:'1',effective_at:'now()',effective_operation_id:`'${op}'`,effective_source_digest:"repeat('a',64)",[column]:'NULL'};
  assert.throws(()=>sql(`BEGIN;UPDATE tenant_client_agreements SET ${Object.entries(values).map(([key,value])=>`${key}=${value}`).join(',')} WHERE id='${termsId}';`),/23514/);checks++;
 }
 const active=JSON.parse(sql(scope+`BEGIN;SET LOCAL session_replication_role=replica;UPDATE tenant_client_agreements SET status='active' WHERE id='${termsId}';SET ROLE service_role;`+execute()));
 assert.equal(active.row.effect,'record_provenance_only');checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'draft');checks++;
 const beforeCounts=sql('SELECT json_build_array((SELECT count(*) FROM paige_invoices),(SELECT count(*) FROM paige_invoice_payments),(SELECT count(*) FROM paige_agreements));');
 await refuseAfterLock(scope+'SET ROLE service_role;'+execute());checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'draft');checks++;
 assert.equal(sql('SELECT count(*) FROM paige_sales_collection_operations;'),'0');checks++;
 assert.equal(sql("SELECT count(*) FROM paige_workspace_events WHERE capability_key='sales_effectuate_commercial_terms';"),'0');checks++;
 // Concurrent different request IDs for one pair must return one original act.
 const races=await concurrent([op,'77777777-0000-4000-8000-000000000002'].map(id=>scope+'SET ROLE service_role;'+execute(command,governance,id)));
 const first=JSON.parse(races[0]);assert(first.ok);checks++;assert.deepEqual(first,JSON.parse(races[1]));checks++;
 assert.equal(hasCommercialEffectuationReceipt(first,tenant,command),true);checks++;
 assert.equal(first.historical_receipt,true);checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'active');checks++;
 const current=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT read_sales_commercial_package('${tenant}','${invoiceId}');`));
 assert.equal(current.commercial_terms.status,'active');checks++;
 assert.equal(Object.hasOwn(current.commercial_terms,'effective_provenance'),false);checks++;
 const provenance=JSON.parse(sql(`SELECT jsonb_build_object('operation_id',effective_operation_id,'signing_id',effective_signing_id,'terms_version',effective_terms_version) FROM tenant_client_agreements WHERE id='${termsId}';`));
 assert.equal(provenance.operation_id,first.operation.id);checks++;
 assert.equal(provenance.signing_id,agreementId);checks++;
 assert.equal(provenance.terms_version,command.expected_version);checks++;
 assert.equal(sql('SELECT count(*) FROM paige_sales_collection_operations;'),'1');checks++;
 assert.equal(sql("SELECT count(*) FROM paige_workspace_events WHERE capability_key='sales_effectuate_commercial_terms';"),'1');checks++;
 assert.equal(sql(`SELECT effective_operation_id::text FROM tenant_client_agreements WHERE id='${termsId}';`),first.operation.id);checks++;
 assert.equal(sql("SELECT detail->>'origin' FROM paige_workspace_events WHERE capability_key='sales_effectuate_commercial_terms';"),'owner_ui');checks++;
 assert.equal(sql('SELECT json_build_array((SELECT count(*) FROM paige_invoices),(SELECT count(*) FROM paige_invoice_payments),(SELECT count(*) FROM paige_agreements));'),beforeCounts);checks++;
 assert.deepEqual(JSON.parse(sql(scope+'SET ROLE service_role;'+execute(command,governance,first.operation.id))),first);checks++;
 assert.deepEqual(JSON.parse(sql(scope+'SET ROLE service_role;'+execute(command,governance,'77777777-0000-4000-8000-000000000003'))),first);checks++;
 assert.throws(()=>sql(scope+'SET ROLE service_role;'+execute({...command,payload_digest:'d'.repeat(64)},governance,first.operation.id)),/22023/);checks++;
 assert.throws(()=>sql(scope+'SET ROLE service_role;'+execute({...command,payload_digest:'d'.repeat(64)},governance,'77777777-0000-4000-8000-000000000004')),/22023/);checks++;
 // Replaying after a later manual pause returns history, never reactivates.
 sql(scope+'SET ROLE authenticated;'+manual('paused'));
 assert.deepEqual(JSON.parse(sql(scope+'SET ROLE service_role;'+execute(command,governance,first.operation.id))),first);checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'paused');checks++;
 const later=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT read_sales_commercial_package('${tenant}','${invoiceId}');`));
 assert.equal(later.commercial_terms.status,'paused');checks++;assert.equal(Object.hasOwn(later.commercial_terms,'effective_provenance'),false);checks++;
 assert.equal(sql(`SELECT effective_operation_id::text FROM tenant_client_agreements WHERE id='${termsId}';`),first.operation.id);checks++;
 assert.throws(()=>sql("SET ROLE service_role;UPDATE paige_sales_collection_operations SET result='{}';"),/42501/);checks++;
 console.log(JSON.stringify({checkpoint:'C19 actual native contract identities',functions:JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'definer',p.prosecdef,'path',p.proconfig)) FROM pg_proc p WHERE p.oid IN (
  '_set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)'::regprocedure,'set_client_agreement_status(uuid,uuid,text,timestamptz)'::regprocedure,
  '_sales_effective_provenance_guard()'::regprocedure,'_validate_sales_effectuation(jsonb)'::regprocedure,'_preview_sales_effectuation(uuid,uuid,jsonb)'::regprocedure,
  '_execute_sales_effectuation(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,'read_sales_collection_command_result(uuid,uuid,uuid,jsonb)'::regprocedure,
  'preview_sales_collection_command(uuid,uuid,jsonb)'::regprocedure,'execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,
  '_workspace_event_display(text,text,text)'::regprocedure);`))}));
 return checks;
}

/** Same source producer/fenced cluster/native signature writer as the accepted
 * history proof. This is metadata evidence, never actual hosted files/signing. */
export async function proveEffectiveCommercialCurrent({sql:originalSql,read,quote,tenant,actor,makeCommercial,startSession,observe}){
 // Psql reads stdin in the original adapter. Scope genuine SQLSTATE diagnostics
 // to this added proof; original assertions, adapter and timeouts are unchanged.
 const sql=input=>originalSql('\\set VERBOSITY verbose\n'+input);
 const literal=value=>quote(JSON.stringify(value))+'::jsonb',json=input=>JSON.parse(sql(input));
 const c=await makeCommercial(),agreementId=c.p.source.agreement_id,manifest=JSON.parse(c.p.manifest),prepared=manifest.commercial;
 const freeze=json(`SET ROLE service_role;SELECT _freeze_paige_commercial_presentation('${actor}','${tenant}',${literal(prepared.payload)},${quote(prepared.payload_digest)},${quote(prepared.presented_body_markdown)},${quote(prepared.presented_body_sha256)},${quote(c.p.storage)},${quote(manifest.document.sha256)});`);
 assert.equal(freeze.state,'frozen');
 sql(`UPDATE paige_agreements SET status='sent',expires_at=clock_timestamp()+interval '1 day' WHERE id='${agreementId}';`);
 const signers=json(`SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name) ORDER BY signing_order,id) FROM paige_agreement_signers WHERE agreement_id='${agreementId}';`);
 assert(Array.isArray(signers)&&signers.length>0);
 for(const signer of signers){
  const token=createHash('sha256').update(randomUUID()).digest('hex');
  sql(`UPDATE paige_agreement_signers SET token_hash=${quote(token)},token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${signer.id}';`);
  const recorded=json(`SET ROLE service_role;SELECT _record_agreement_signature(${quote(token)},${c.p.source.version},${quote(manifest.document.sha256)},${quote(c.p.storage)},${quote(signer.name)},NULL,true,true,'esign-consent',1,repeat('c',64),NULL,'Synthetic exact-terms proof');`);
  assert(recorded.state==='recorded'&&recorded.audit_complete===true);
 }
 sql(`UPDATE paige_agreements SET status='completed',completed_at=clock_timestamp(),sealed_storage_key='${tenant}/${agreementId}/sealed-proof.pdf',sealed_sha256=repeat('b',64) WHERE id='${agreementId}';
  INSERT INTO paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,detail)
  VALUES('${agreementId}','${tenant}','sealed','system',jsonb_build_object('sealed_sha256',repeat('b',64),'presented_sha256',${quote(manifest.document.sha256)})),
   ('${agreementId}','${tenant}','completed','system','{}');`);
 assert.deepEqual(json(`SELECT _paige_accepted_commercial_payload(a) FROM paige_agreements a WHERE id='${agreementId}';`),prepared.payload);
 const tag='e04_effective_'+randomUUID().replaceAll('-','');
 const concurrent=async statements=>{
  const holder=startSession(tag+'holder',`BEGIN;SELECT id FROM paige_agreements WHERE id='${agreementId}' FOR UPDATE;SELECT pg_sleep(3);COMMIT;`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}holder' AND wait_event='PgSleep');`);
  const first=startSession(tag+'one',statements[0]);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}one' AND wait_event_type='Lock');`);
  const second=startSession(tag+'two',statements[1]);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}two' AND wait_event_type='Lock');`);
  const result=await Promise.all([holder,first,second]);return result.slice(1);
 };
 const refuseAfterLock=async statement=>{
  const holder=startSession(tag+'authholder',`BEGIN;SELECT id FROM paige_agreements WHERE id='${agreementId}' FOR UPDATE;SELECT pg_sleep(3);COMMIT;`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}authholder' AND wait_event='PgSleep');`);
  // Attach rejection handling immediately; only the observed database refusal
  // may establish PASS, never a timeout or rejected assertion.
  const waiting=startSession(tag+'authority','\n\\set VERBOSITY verbose\n'+statement).then(value=>({value}),error=>({error}));
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}authority' AND wait_event_type='Lock');`);
  sql(`INSERT INTO tenant_tool_autonomy VALUES('${tenant}','sales_effectuate_commercial_terms','off',clock_timestamp());`);
  try{await holder;const result=await waiting;assert(result.error&&/ERROR:\s+42501:/.test(String(result.error)),String(result.error??result.value));}
  finally{sql(`DELETE FROM tenant_tool_autonomy WHERE tenant_id='${tenant}' AND tool_key='sales_effectuate_commercial_terms';`);}
 };
 const checks=await proveEffectiveCommercialTerms({sql,read,concurrent,refuseAfterLock,scope:`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';`,
  tenant,actor,termsId:c.terms,invoiceId:c.invoice,agreementId,prepared,migration:'supabase/migrations/20271113640004_e04_exact_signed_terms.sql'});
 const {proveEffectiveCommercialCatalogue}=await import('./effective-commercial-catalogue-proof.mjs');
 const catalogue=proveEffectiveCommercialCatalogue({sql,read,tenant,actor});
 return {checks:checks+catalogue.checks,catalogue,concurrentSessions:5,observedLockWaits:3,migrationReplay:2,scope:'Canonical native writers/operations/receipts with synthetic identity/Trust rung and metadata files; no real files/provider/customer acceptance'};
}
