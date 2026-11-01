// Disposable localhost fixture. Actual candidate + original Setup brief/wrapper
// and E13 validator bodies; getter/identity dependencies below are MODELS.
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
 CREATE TABLE tenant_setup_business_context_meta(tenant_id uuid PRIMARY KEY,revision bigint DEFAULT 0,updated_at timestamptz DEFAULT now(),updated_by uuid);
 CREATE TABLE tenant_business_owners(id uuid,tenant_id uuid,owner_kind text,legal_name text,display_name text,ownership_interest numeric,effective_date date,ownership_status text,representative_user_id uuid,setup_provenance jsonb,created_at timestamptz);
 CREATE TABLE tenant_business_representatives(tenant_id uuid,user_id uuid,source text,confidence text,confirmed_at timestamptz,created_at timestamptz,created_by uuid);
 CREATE TABLE tenant_setup_private_context(tenant_id uuid,private_brief jsonb,setup_provenance jsonb);
 CREATE TABLE paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,actor_role text,action text,target_type text,target_id uuid,tenant_id uuid,payload jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE tenant_knowledge_docs(id uuid PRIMARY KEY,tenant_id uuid,record_state text,revision integer,content text,title text);
 CREATE FUNCTION is_platform_owner(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION is_tenant_admin_as(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT active_tenant_id FROM profiles WHERE user_id=auth.uid()$$;
 CREATE FUNCTION solo_setup_can_read() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION solo_setup_assert_canonical_tenant() RETURNS uuid LANGUAGE sql AS $$SELECT current_user_tenant_id()$$;
 CREATE FUNCTION get_solo_setup_context() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT jsonb_build_object('tenantId',id,'brief',brand->'business_brief','businessOwners','[]'::jsonb) FROM tenants WHERE id=current_user_tenant_id()$$;
 CREATE FUNCTION get_solo_business_context() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT get_solo_setup_context()||jsonb_build_object('contextRevision',coalesce((SELECT revision FROM tenant_setup_business_context_meta WHERE tenant_id=current_user_tenant_id()),0))$$;
 CREATE FUNCTION read_tenant_knowledge(uuid,uuid,integer,integer) RETURNS jsonb LANGUAGE sql SET search_path=public AS $$SELECT jsonb_build_object('tenant_id',$1,'documents',coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb)) FROM tenant_knowledge_docs WHERE tenant_id=$1 AND id=$2 AND record_state='canonical'$$;
 INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO profiles VALUES('${actor}','${tenant}');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','admin',false);
 INSERT INTO tenants VALUES('${tenant}','Example','{"business_brief":{"publicName":"Example","offers":"Before","provenance":{},"updatedAt":"2026-11-01T12:00:00.123456Z"}}','active','standalone',NULL,NULL);
 INSERT INTO tenant_knowledge_docs VALUES('${doc}','${tenant}','canonical',1,'Advisory','Example agreement');
 GRANT USAGE ON SCHEMA auth TO authenticated;REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;`);
 const setup=read('supabase/migrations/20261046000000_solo_setup_persistence_repair.sql');
 for(const name of ['solo_setup_access_scope','save_solo_business_brief','save_solo_setup_context'])db.run(fn(setup,name));
 assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure"),'d70cdc664b5c703395e4f077a30fdbd8','original wrapper matches November1 production body');checks++;
 db.run(fn(read('supabase/migrations/20261103000000_solo_setup_business_context.sql'),'solo_setup_lock_expected_tenant'));
 db.run(fn(read('supabase/migrations/20270531600000_knowledge_durable_authority.sql'),'knowledge_actor_authorized'));
 const extraction=read('supabase/migrations/20270532000000_knowledge_extraction_work.sql');
 db.run(fn(extraction,'lock_knowledge_extraction_authority'));db.run(fn(extraction,'knowledge_utf16_length'));
 db.run(fn(source.stdout,'knowledge_utf16_excerpt_matches'));
 db.run(fn(source.stdout,'lock_knowledge_source_evidence'));
 db.run('REVOKE ALL ON FUNCTION lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role');
 let candidate=read('scripts/proof/exp01-reviewed-setup-candidate.sql');
 if(process.argv.includes('--without-save-source-check')) {
  const original='selected:=public.lock_solo_reviewed_setup_facts(_expected_tenant_id,auth.uid(),selected);';
  assert.equal(candidate.split(original).length,2,'one precise counterfactual save-source seam');
  candidate=candidate.replace(original,'selected:=selected; -- COUNTERFACTUAL FIXTURE ONLY');
 }
 db.run(candidate);db.run(candidate);checks++;
 const facts=`jsonb_build_array(jsonb_build_object('field','offers','value','Advisory','reference',jsonb_build_object('contractVersion',1,'tenantId','${tenant}','documentId','${doc}','revision',1,'contentSha256',encode(sha256(convert_to('Advisory','UTF8')),'hex')),'excerpts','[{"start":0,"end":8,"text":"Advisory"}]'::jsonb))`;
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
 denied(caller+save.replace('setup_business_facts','execute_work'),/SETUP_REVIEW_INVALID/);
 denied(caller+save.replace("'[\"offers\"]'","'[\"offers\",\"offers\"]'"),/SETUP_REVIEW_INVALID/);
 db.run('UPDATE tenant_knowledge_docs SET revision=2');
 const changed=JSON.parse(scalar(caller+inspect.replace(request,request2)));
 assert.equal(changed.current,false);assert.equal(changed.reason,'source_unavailable_or_changed');checks++;
 db.run('UPDATE tenant_members SET status=\'suspended\'');denied(caller+inspect,/SCOPE_CHANGED|AUTHORITY_REQUIRED/);
 db.run('UPDATE tenant_members SET status=\'active\';UPDATE profiles SET active_tenant_id=gen_random_uuid()');
 assert.throws(()=>db.run(caller+inspect),error=>error.code==='40001' && /active workspace changed/.test(error.message));checks++;
 console.log(JSON.stringify({checks,result:'PASS',scope:'candidate + original Setup write bodies in modeled dependency fixture; NOT full-schema/customer/role completeness',originalSourceRef}));
} finally {
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
}
