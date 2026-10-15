import assert from 'node:assert/strict';
import {hasCommercialEffectuationReceipt} from '../../supabase/functions/_shared/sales-commercial/effectuation-command.ts';

/** Actual installed Sales writers/actor/approval/Rail bodies in the caller's
 * directory-checked unique disposable DB only. No hosted role or business. */
export async function proveEffectiveCommercialTerms({sql,concurrent,read,scope,tenant,actor,termsId,invoiceId,agreementId,prepared,migration}){
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
  ALTER TABLE tenant_client_agreements ADD COLUMN starts_on date DEFAULT '2026-10-15',ADD COLUMN price_basis text DEFAULT 'negotiated';
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
 const manualBefore=[];
 for(const [prefix,status,stamp] of [["SET test.uid='';",'active'],["SET test.admin='false';",'active'],['','bogus'],['','active',"'2000-01-01'::timestamptz"],['BEGIN;UPDATE tenant_client_agreements SET starts_on=NULL;','active']]){
  let failure;try{sql(scope+prefix+'SET ROLE authenticated;'+manual(status,stamp));}catch(error){failure=error.message;}
  assert(failure,'Manual guard must refuse before extraction');manualBefore.push(failure.split('\n').find(line=>line.startsWith('ERROR:')));
 }
 sql(read(migration));sql(read(migration));
 const helper=sql("SELECT pg_get_functiondef('_set_client_agreement_status(uuid,uuid,uuid,text,timestamptz)'::regprocedure);");
 const business=original.slice(original.indexOf('  _status :='),original.lastIndexOf('\nEND;')).trimEnd();
 assert(helper.includes(business),JSON.stringify({businessTail:business.slice(-80),helperTail:helper.slice(-100)}));checks++;
 const wrapper=sql("SELECT pg_get_functiondef('set_client_agreement_status(uuid,uuid,text,timestamptz)'::regprocedure);");
 assert.equal(wrapper,original.replace(business,'  RETURN public._set_client_agreement_status(_actor,_tenant,_agreement_id,_status,_expected_updated_at);'));checks++;
 let index=0;
 for(const [prefix,status,stamp] of [["SET test.uid='';",'active'],["SET test.admin='false';",'active'],['','bogus'],['','active',"'2000-01-01'::timestamptz"],['BEGIN;UPDATE tenant_client_agreements SET starts_on=NULL;','active']]){
  assert.throws(()=>sql(scope+prefix+'SET ROLE authenticated;'+manual(status,stamp)),error=>error.message.split('\n').find(line=>line.startsWith('ERROR:'))===manualBefore[index++]);checks++;
 }
 for(const key of ['set_business_time_zone','read_business_time_zone','other_key'])for(const outcome of ['capability_succeeded','capability_failed']){
  assert.equal(sql(`SELECT _workspace_event_display('capability_run','${outcome}','${key}')=_workspace_event_display_before_e04_effectuation('capability_run','${outcome}','${key}');`),'t');checks++;
 }
 assert.equal(JSON.parse(sql("SELECT _workspace_event_display('capability_run','capability_succeeded','sales_effectuate_commercial_terms');")).actor_type,'owner_staff');checks++;
 assert.equal(JSON.parse(sql(scope+'SET ROLE service_role;'+preview())).eligible,true);checks++;
 for(const [key,value] of [['extra_approval',true],['expected_version',1.5],['signing_version',0],['invoice_draft_version',null],['expected_updated_at','2026-10-15'],['payload_digest','z'.repeat(64)],['sealed_sha256',null],['signing_id','not-a-uuid']]){
  assert.throws(()=>sql(scope+'SET ROLE service_role;'+preview({...command,[key]:value})),/22023/);checks++;
 }
 for(const key of Object.keys(command)){const bad={...command};delete bad[key];assert.throws(()=>sql(scope+'SET ROLE service_role;'+preview(bad)),/22023/);checks++;}
 for(const mutation of [
  `UPDATE tenant_client_agreements SET starts_on=NULL WHERE id='${termsId}';`,
  `UPDATE tenant_client_agreements SET price_basis='quote_pending' WHERE id='${termsId}';`,
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
 // Concurrent different request IDs for one pair must return one original act.
 const races=await concurrent([op,'77777777-0000-4000-8000-000000000002'].map(id=>scope+'SET ROLE service_role;'+execute(command,governance,id)));
 const first=JSON.parse(races[0]);assert(first.ok);checks++;assert.deepEqual(first,JSON.parse(races[1]));checks++;
 assert.equal(hasCommercialEffectuationReceipt(first,tenant,command),true);checks++;
 assert.equal(first.historical_receipt,true);checks++;
 assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'active');checks++;
 const current=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT read_sales_commercial_package('${tenant}','${invoiceId}');`));
 assert.equal(current.commercial_terms.status,'active');checks++;
 assert.equal(current.commercial_terms.effective_provenance.operation_id,first.operation.id);checks++;
 assert.equal(current.commercial_terms.effective_provenance.signing_id,agreementId);checks++;
 assert.equal(current.commercial_terms.effective_provenance.terms_version,command.expected_version);checks++;
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
 assert.equal(later.commercial_terms.status,'paused');checks++;assert.deepEqual(later.commercial_terms.effective_provenance,current.commercial_terms.effective_provenance);checks++;
 assert.throws(()=>sql("SET ROLE service_role;UPDATE paige_sales_collection_operations SET result='{}';"),/42501/);checks++;
 return checks;
}
