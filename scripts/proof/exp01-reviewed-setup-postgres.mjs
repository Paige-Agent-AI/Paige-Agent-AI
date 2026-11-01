// Disposable localhost fixture. Actual candidate + original Setup brief/wrapper
// and E13 validator/getter bodies; identity/Knowledge reader dependencies are MODELS.
// This is NOT full-schema, production, legal-owner or delegated-management proof.
import { readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { OperatorPostgresFixture } from './operator-postgres-fixture.mjs';
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const port=Number(process.argv[2]??55461);
const originalSourceRef=process.env.EXP01_SOURCE_VALIDATOR_REF;
if(!originalSourceRef||!/^[a-f0-9]{40}$/.test(originalSourceRef))throw Error('Supply the inspected, pinned original E13 source commit in EXP01_SOURCE_VALIDATOR_REF');
const source=spawnSync('git',['show',`${originalSourceRef}:supabase/migrations/20271126210013_knowledge_source_writer_validation.sql`],{encoding:'utf8'});
assert.equal(source.status,0,'exact original E13 candidate source available locally');
const fn=(sql,name)=>{
 const start=new RegExp(`create or replace function public\\.${name}\\s*\\(`,'i').exec(sql);
 assert.ok(start,`original ${name} present`);
 const body=sql.slice(start.index), delimiter=/\bas\s+(\$[\w]*\$)/i.exec(body);
 assert.ok(delimiter);const end=body.indexOf(delimiter[1],delimiter.index+delimiter[0].length);
 assert.ok(end>0);return body.slice(0,end+delimiter[1].length)+';';
};
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
const review='30000000-0000-4000-8000-000000000001',request='50000000-0000-4000-8000-000000000001';
const doc='40000000-0000-4000-8000-000000000001';
const db=new OperatorPostgresFixture(port);let checks=0;
const caller=`SELECT set_config('test.actor','${actor}',false);SET ROLE authenticated;`;
const scalar=sql=>db.run(sql).split('\n').at(-1);
const denied=(sql,pattern)=>{assert.throws(()=>db.run(sql),pattern);checks++;};
async function raceHeld(first,second,application) {
 const held=await db.holdArchive(first,[],{manualRelease:true});
 const process=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',error='';
 process.stdout.on('data',b=>{out+=b;});process.stderr.on('data',b=>{error+=b;});
 const done=new Promise((resolve,reject)=>{process.on('error',reject);process.on('close',resolve);});
 process.stdin.end(`SET application_name='${application}';${second};`);
 try {
  const deadline=Date.now()+5000;let blocked=false;
  while(Date.now()<deadline){
   blocked=scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${application}' AND cardinality(pg_blocking_pids(pid))>0`)==='1';
   if(blocked)break;await new Promise(r=>setTimeout(r,30));
  }
  assert.ok(blocked,application+' actually blocks on competing transaction');checks++;
 }finally{held.release();await held.completed;}
 return {status:await done,out,error};
}
try{
 db.run(`CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 DO $$BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
 DO $$BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
 DO $$BEGIN CREATE ROLE service_role;EXCEPTION WHEN duplicate_object THEN NULL;END$$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE tenants(id uuid PRIMARY KEY,name text,brand jsonb,status text,account_type text,parent_tenant_id uuid,owner_user_id uuid);
 CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text,is_owner boolean DEFAULT false);
 CREATE TABLE user_roles(user_id uuid,role text);
 CREATE TABLE tenant_setup_business_context_meta(tenant_id uuid PRIMARY KEY,revision bigint DEFAULT 0,updated_at timestamptz DEFAULT now(),updated_by uuid,primary_email_provenance jsonb,primary_email_snapshot text);
 CREATE TABLE tenant_business_owners(id uuid,tenant_id uuid,owner_kind text,legal_name text,display_name text,ownership_interest numeric,effective_date date,ownership_status text,representative_user_id uuid,setup_provenance jsonb,created_at timestamptz);
 CREATE TABLE tenant_business_representatives(tenant_id uuid,user_id uuid,source text,confidence text,confirmed_at timestamptz,created_at timestamptz,created_by uuid);
 CREATE TABLE tenant_setup_private_context(tenant_id uuid,private_brief jsonb,setup_provenance jsonb);
 CREATE TABLE tenant_legal_profile(tenant_id uuid,setup_provenance jsonb);
 CREATE TABLE tenant_email_identities(tenant_id uuid,local_part text);
 CREATE TABLE platform_email_settings(shared_domain text);
 CREATE TABLE tenant_setup_knowledge_sources(id uuid,tenant_id uuid,source_type text,title text,category text,source_url text,reference text,notes text,review_status text,setup_provenance jsonb,updated_at timestamptz);
 CREATE TABLE tenant_setup_paige_profiles(tenant_id uuid,profile jsonb,setup_provenance jsonb);
 CREATE TABLE tenant_setup_voice_examples(id uuid,tenant_id uuid,channel text,example_kind text,example_text text,note text,setup_provenance jsonb,updated_at timestamptz);
 CREATE TABLE paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,action text,target_type text,target_id uuid,tenant_id uuid,payload jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE tenant_knowledge_docs(id uuid PRIMARY KEY,tenant_id uuid,record_state text,revision integer,content text,title text);
 CREATE FUNCTION is_platform_owner(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION is_tenant_admin_as(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT active_tenant_id FROM profiles WHERE user_id=auth.uid()$$;
 CREATE FUNCTION solo_setup_can_read() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION solo_setup_operator_can_read() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION solo_setup_assert_canonical_tenant() RETURNS uuid LANGUAGE sql AS $$SELECT current_user_tenant_id()$$;
 CREATE FUNCTION solo_setup_assert_canonical_tenant_for_read() RETURNS uuid LANGUAGE sql AS $$SELECT current_user_tenant_id()$$;
 CREATE FUNCTION solo_setup_managed_email_registration_ready() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION get_solo_setup_identity() RETURNS TABLE(tenant_id uuid,tenant_name text,business_brief jsonb,pending_proposal jsonb,primary_business_email text,business_registration_number_last_4 text)
 LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT id,name,brand->'business_brief',NULL::jsonb,NULL::text,NULL::text FROM tenants WHERE id=current_user_tenant_id()$$;
 CREATE FUNCTION read_tenant_knowledge(uuid,uuid,integer,integer) RETURNS jsonb LANGUAGE sql SET search_path=public AS $$SELECT jsonb_build_object('tenant_id',$1,'documents',coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb)) FROM tenant_knowledge_docs WHERE tenant_id=$1 AND id=$2 AND record_state='canonical'$$;
 INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO profiles VALUES('${actor}','${tenant}');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','admin',false);
 INSERT INTO tenants VALUES('${tenant}','Example','{"business_brief":{"publicName":"Example","offers":"Before","deliveryModel":"Unselected current value","provenance":{},"updatedAt":"2026-11-01T12:00:00.123456Z"}}','active','standalone',NULL,NULL);
 INSERT INTO tenant_knowledge_docs VALUES('${doc}','${tenant}','canonical',1,'Advisory','Example agreement');
 GRANT USAGE ON SCHEMA auth TO authenticated;REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;`);
 db.run(`ALTER TABLE paige_audit_log ENABLE ROW LEVEL SECURITY;GRANT INSERT ON paige_audit_log TO authenticated;
 CREATE POLICY original_fixture_actor_events ON paige_audit_log FOR INSERT TO authenticated WITH CHECK(actor_user_id=auth.uid());`);
 const setup=read('supabase/migrations/20261046000000_solo_setup_persistence_repair.sql');
 for(const name of ['solo_setup_access_scope','save_solo_business_brief','save_solo_setup_context'])db.run(fn(setup,name));
 assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure"),'d70cdc664b5c703395e4f077a30fdbd8','original wrapper matches November1 production body');checks++;
 db.run(fn(read('supabase/migrations/20261103000000_solo_setup_business_context.sql'),'solo_setup_lock_expected_tenant'));
 const reads=read('supabase/migrations/20270513000000_operator_act_as_reads_solo_setup.sql');
 for(const name of ['get_solo_setup_context','get_solo_business_context'])db.run(fn(reads,name));
 db.run(`REVOKE ALL ON FUNCTION public.solo_setup_access_scope(),public.solo_setup_lock_expected_tenant(uuid),public.get_solo_setup_context(),public.get_solo_business_context(),public.save_solo_setup_context(jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.get_solo_setup_context(),public.get_solo_business_context(),public.save_solo_setup_context(jsonb,jsonb,text,uuid) TO authenticated;`);
 db.run(fn(read('supabase/migrations/20270531600000_knowledge_durable_authority.sql'),'knowledge_actor_authorized'));
 const extraction=read('supabase/migrations/20270532000000_knowledge_extraction_work.sql');
 db.run(fn(extraction,'lock_knowledge_extraction_authority'));db.run(fn(extraction,'knowledge_utf16_length'));
 db.run(fn(source.stdout,'knowledge_utf16_excerpt_matches'));
 db.run(fn(source.stdout,'lock_knowledge_source_evidence'));
 db.run('REVOKE ALL ON FUNCTION lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role');
 const candidate=read('scripts/proof/exp01-reviewed-setup-candidate.sql');
 const install=()=>{
  const run=spawnSync(db.psql,db.args(),{input:candidate,encoding:'utf8',timeout:30000});
  if(run.status!==0)throw Error('Candidate installation in disposable fixture: '+run.stderr);
 };
 install();install();checks++;
 // Every failed reinstall runs in a disconnected, rolled-back transaction.
 // Do not silently repair drift in original source, ACLs or a partial install.
 for(const [mutation,reason] of [
  ['ALTER FUNCTION public.get_solo_setup_context() SET search_path=public,vault','SETUP_REVIEW_INSTALL_DRIFT'],
  ['GRANT EXECUTE ON FUNCTION public.inspect_solo_reviewed_business_facts(uuid,uuid,uuid) TO anon','SETUP_REVIEW_INSTALLED_DRIFT'],
  ['DROP FUNCTION public.inspect_solo_reviewed_business_facts(uuid,uuid,uuid)','SETUP_REVIEW_PARTIAL_INSTALL'],
  ['DROP POLICY exp01_reviewed_facts_server_events ON public.paige_audit_log','SETUP_REVIEW_PARTIAL_INSTALL'],
  ['ALTER TABLE public.tenant_setup_business_context_meta ALTER COLUMN reviewed_fact_proposal SET DEFAULT \'{}\'::jsonb','SETUP_REVIEW_COLUMN_DRIFT'],
 ]) {
  const run=spawnSync(db.psql,db.args(),{input:`BEGIN;${mutation};\n${candidate}`,encoding:'utf8',timeout:30000});
  assert.notEqual(run.status,0);assert.match(run.stderr,new RegExp(reason));checks++;
 }
 install();checks++;
 if(process.argv.includes('--without-save-source-check')) {
  const original='selected:=public.lock_solo_reviewed_setup_facts(_expected_tenant_id,auth.uid(),selected);';
  assert.equal(candidate.split(original).length,2,'one precise counterfactual save-source seam');
  db.run(fn(candidate,'save_solo_reviewed_business_facts').replace(original,'selected:=selected; -- COUNTERFACTUAL FIXTURE ONLY'));
 }
 denied(caller+`INSERT INTO paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload) VALUES('${actor}','admin','solo_setup.reviewed_facts_approved','solo_business_brief','${tenant}','${tenant}','{}')`,/row-level security/);
 const oneFact=`jsonb_build_array(jsonb_build_object('field','offers','value','Advisory','reference',jsonb_build_object('contractVersion',1,'tenantId','${tenant}','documentId','${doc}','revision',1,'contentSha256',encode(sha256(convert_to('Advisory','UTF8')),'hex')),'excerpts','[{"start":0,"end":8,"text":"Advisory"}]'::jsonb))`;
 const facts=`(${oneFact}||jsonb_build_array(jsonb_set((${oneFact})->0,'{field}','"deliveryModel"'::jsonb)))`;
 const stage=`SELECT stage_solo_reviewed_business_facts('${tenant}','${actor}','${review}','2026-11-01T12:00:00.123456Z',0,${facts})`;
 const save=`SELECT save_solo_reviewed_business_facts('${tenant}','${actor}','${review}','${request}','2026-11-01T12:00:00.123456Z',0,'["offers"]','setup_business_facts')`;
 const inspect=`SELECT inspect_solo_reviewed_business_facts('${tenant}','${actor}','${request}')`;
 assert.equal(JSON.parse(scalar(caller+inspect)).status,'absent_at_read');checks++;
 assert.equal(scalar('SELECT count(*) FROM tenant_setup_business_context_meta'),'0');checks++;
 denied(caller+save,/SETUP_REVIEW_CONFLICT/);
 denied(caller+stage.replace("'field','offers'","'field',NULL"),/SETUP_REVIEW_INVALID/);
 db.run(caller+stage);assert.equal(scalar(`SELECT brand#>>'{business_brief,offers}' FROM tenants`),'Before');checks++;
 db.run(caller+stage);assert.equal(scalar("SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_staged'"),'1');checks++;
 denied(caller+save.replace("'[\"offers\"]'","'[\"industry\"]'"),/SETUP_REVIEW_SELECTION_CHANGED/);
 db.run(`UPDATE tenant_knowledge_docs SET revision=2`);
 denied(caller+save,/KNOWLEDGE_SOURCE_CHANGED/);
 assert.equal(scalar('SELECT count(*) FROM paige_audit_log WHERE action=\'solo_setup.reviewed_facts_approved\''),'0');checks++;
 db.run(`UPDATE tenant_knowledge_docs SET revision=1`);
 const result=JSON.parse(scalar(caller+save));assert.equal(result.current,true);checks++;
 assert.equal(result.receipt.selectedFacts[0].value,'Advisory');checks++;
 assert.equal(result.receipt.selectedFacts.length,1);checks++;
 assert.equal(scalar("SELECT brand#>>'{business_brief,deliveryModel}' FROM tenants"),'Unselected current value');checks++;
 assert.equal(scalar(`SELECT brand#>>'{business_brief,offers}' FROM tenants`),'Advisory');checks++;
 const repeated=JSON.parse(scalar(caller+save));assert.equal(repeated.receiptId,result.receiptId);checks++;
 denied(caller+save.replace("'[\"offers\"]'","'[\"industry\"]'"),/SETUP_REVIEW_REQUEST_REUSED/);
 assert.equal(scalar(`SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_approved'`),'1');checks++;
 // A lost-ack repeat racing the first actual native commit must observe ONE
 // receipt/revision. Wait for an actual PostgreSQL blocker, not a timed guess.
 const review2='30000000-0000-4000-8000-000000000002',request2='50000000-0000-4000-8000-000000000002';
 const stage2=stage.replace(review,review2).replace('2026-11-01T12:00:00.123456Z',result.receipt.updatedAt).replace(',0,',',1,');
 const save2=save.replace(review,review2).replace(request,request2).replace('2026-11-01T12:00:00.123456Z',result.receipt.updatedAt).replace(',0,',',1,');
 db.run(caller+stage2);
 const held=await db.holdArchive(caller+save2,[],{manualRelease:true});
 const second=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let secondOut='',secondErr='';
 second.stdout.on('data',b=>{secondOut+=b;});second.stderr.on('data',b=>{secondErr+=b;});
 const completed=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',code=>code===0?resolve():reject(Error(secondErr)));});
 completed.catch(()=>{});
 second.stdin.end(`SET application_name='exp01_receipt_same_request';${caller}${save2};`);
 try {
  const deadline=Date.now()+5000;let blocked=false;
  while(Date.now()<deadline){
   blocked=scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='exp01_receipt_same_request' AND cardinality(pg_blocking_pids(pid))>0")==='1';
   if(blocked)break;await new Promise(r=>setTimeout(r,30));
  }
  assert.ok(blocked,'second native same-request call actually blocked on the first');checks++;
 } finally {held.release();await held.completed;await completed;}
 assert.equal(scalar(`SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'='${request2}'`),'1');checks++;
 assert.equal(scalar('SELECT revision FROM tenant_setup_business_context_meta'),'2');checks++;
 const secondRows=secondOut.trim().split(/\r?\n/).filter(line=>line.startsWith('{'));
 assert.equal(secondRows.length,1);assert.equal(JSON.parse(secondRows[0]).current,true);checks++;
 db.run('UPDATE tenant_knowledge_docs SET revision=2');
 assert.equal(JSON.parse(scalar(caller+inspect.replace(request,request2))).reason,'source_unavailable_or_changed');checks++;
 db.run('UPDATE tenant_knowledge_docs SET revision=1');
 // An original manual Setup save wins its own transaction before a staged
 // approval proceeds. The receipt must wait, then refuse its now-stale CAS.
 const c=JSON.parse(scalar(caller+'SELECT public.get_solo_business_context()'));
 const review3='30000000-0000-4000-8000-000000000003',request3='50000000-0000-4000-8000-000000000003';
 const stage3=stage.replace(review,review3).replace('2026-11-01T12:00:00.123456Z',c.brief.updatedAt).replace(',0,',',2,');
 const save3=save.replace(review,review3).replace(request,request3).replace('2026-11-01T12:00:00.123456Z',c.brief.updatedAt).replace(',0,',',2,');
 db.run(caller+stage3);
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const manual=`SELECT public.save_solo_setup_context(${literal({...c.brief,offers:'Manual current'})},${literal(c.businessOwners)},'${c.brief.updatedAt}',NULL)`;
 const manualHeld=await db.holdArchive(caller+manual,[],{manualRelease:true});
 const stale=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let staleErr='';
 stale.stderr.on('data',b=>{staleErr+=b;});stale.stdout.resume();
 const staleDone=new Promise((resolve,reject)=>{stale.on('error',reject);stale.on('close',resolve);});
 stale.stdin.end(`SET application_name='exp01_receipt_after_manual';${caller}${save3};`);
 try {
  const deadline=Date.now()+5000;let blocked=false;
  while(Date.now()<deadline){
   blocked=scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='exp01_receipt_after_manual' AND cardinality(pg_blocking_pids(pid))>0")==='1';
   if(blocked)break;await new Promise(r=>setTimeout(r,30));
  }
  assert.ok(blocked,'receipt actually waits behind original manual writer');checks++;
 } finally {manualHeld.release();await manualHeld.completed;}
 assert.notEqual(await staleDone,0);assert.match(staleErr,/SETUP_REVIEW_CONFLICT/);checks++;
 assert.equal(scalar("SELECT brand#>>'{business_brief,offers}' FROM tenants"),'Manual current');checks++;
 assert.equal(scalar(`SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'='${request3}'`),'0');checks++;
 assert.equal(JSON.parse(scalar(caller+inspect.replace(request,request2))).reason,'setup_changed');checks++;
 // Both observed serializations of membership revocation vs actual approval.
 // Fixture authority storage is modeled; the lock/recheck functions are original.
 const current=JSON.parse(scalar(caller+'SELECT public.get_solo_business_context()'));
 const review4='30000000-0000-4000-8000-000000000004',request4='50000000-0000-4000-8000-000000000004';
 const stage4=stage.replace(review,review4).replace('2026-11-01T12:00:00.123456Z',current.brief.updatedAt).replace(',0,',',2,');
 const save4=save.replace(review,review4).replace(request,request4).replace('2026-11-01T12:00:00.123456Z',current.brief.updatedAt).replace(',0,',',2,');
 db.run(caller+stage4);
 const revoke="UPDATE public.tenant_members SET status='suspended'";
 const revokeFirst=await raceHeld(revoke,caller+save4,'exp01_revoke_then_receipt');
 assert.notEqual(revokeFirst.status,0);assert.match(revokeFirst.error,/SETUP_REVIEW_SCOPE_CHANGED/);checks++;
 assert.equal(scalar(`SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'='${request4}'`),'0');checks++;
 assert.equal(scalar("SELECT brand#>>'{business_brief,offers}' FROM tenants"),'Manual current');checks++;
 db.run("UPDATE public.tenant_members SET status='active'");
 const saveFirst=await raceHeld(caller+save4,revoke,'exp01_receipt_then_revoke');
 assert.equal(saveFirst.status,0,saveFirst.error);checks++;
 assert.equal(scalar(`SELECT count(*) FROM paige_audit_log WHERE action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'='${request4}'`),'1');checks++;
 denied(caller+inspect.replace(request,request4),/SETUP_REVIEW_SCOPE_CHANGED/);
 db.run("UPDATE public.tenant_members SET status='active'");
 denied(caller+save.replace('setup_business_facts','execute_work'),/SETUP_REVIEW_INVALID/);
 denied(caller+save.replace("'[\"offers\"]'","'[\"offers\",\"offers\"]'"),/SETUP_REVIEW_INVALID/);
 db.run('UPDATE tenant_knowledge_docs SET revision=2');
 const changed=JSON.parse(scalar(caller+inspect.replace(request,request2)));
 assert.equal(changed.current,false);assert.equal(changed.reason,'setup_changed');checks++;
 db.run('UPDATE tenant_members SET status=\'suspended\'');denied(caller+inspect,/SCOPE_CHANGED|AUTHORITY_REQUIRED/);
 db.run('UPDATE tenant_members SET status=\'active\';UPDATE profiles SET active_tenant_id=gen_random_uuid()');
 assert.throws(()=>db.run(caller+inspect),error=>error.code==='40001' && /active workspace changed/.test(error.message));checks++;
 console.log(JSON.stringify({checks,result:'PASS',scope:'candidate + original Setup write bodies in modeled dependency fixture; NOT full-schema/customer/role completeness',originalSourceRef}));
} finally {
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
}
