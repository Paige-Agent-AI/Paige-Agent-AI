// Isolated SQL proof only. Auth identity is a fixture; no remote connection is accepted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { retireSyntheticTenantSQL } from './operator-postgres-fixture.mjs';
process.on('uncaughtException', e => { console.error('FAIL:',e.code ?? e.name,e.message);process.exit(1); });
const native=process.argv[2]==='--postgres';
const db=native?new (await import('./operator-postgres-fixture.mjs')).OperatorPostgresFixture(Number(process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:5432)):new (await import(pathToFileURL(resolve(process.argv[2])).href)).PGlite();
const owner='00000000-0000-0000-0000-000000000001', ordinary='00000000-0000-0000-0000-000000000002';
const agency='00000000-0000-0000-0000-000000000011', child='00000000-0000-0000-0000-000000000012', solo='00000000-0000-0000-0000-000000000013';
await db.exec(`DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END$$; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.actor',true),''))::uuid$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_app_meta_data jsonb);
CREATE TABLE public.user_roles(user_id uuid REFERENCES auth.users(id),role text);
INSERT INTO auth.users VALUES('${owner}','owner@example.invalid','{}'),('${ordinary}','shared@example.invalid','{}'),('00000000-0000-0000-0000-000000000003','admin@example.invalid','{}');
INSERT INTO user_roles VALUES('${owner}','super_admin'),('${ordinary}','user'),('00000000-0000-0000-0000-000000000003','platform_admin');
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role='super_admin')$$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role IN ('super_admin','platform_admin'))$$;
CREATE TYPE public.tenant_status AS ENUM('trial','active','past_due','suspended','canceled');
CREATE TABLE tenants(id uuid PRIMARY KEY,name text,status tenant_status,account_type text,parent_tenant_id uuid REFERENCES tenants(id),features jsonb DEFAULT '{}',stripe_customer_id text,stripe_subscription_id text,owner_user_id uuid,comms_provider_execution_disabled boolean DEFAULT false,updated_at timestamptz DEFAULT now());
CREATE TABLE tenant_members(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),user_id uuid,role text,status text);
CREATE TABLE profiles(id uuid PRIMARY KEY,active_tenant_id uuid REFERENCES tenants(id));
CREATE TABLE tenant_revenue_classification(tenant_id uuid REFERENCES tenants(id),revenue_class text);
CREATE TABLE audit_logs(user_id uuid,action text,entity text,entity_id uuid,data jsonb);
CREATE TABLE paige_audit_log(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,operator_rows_server_only boolean DEFAULT false,summary text);
CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),name text);
CREATE TABLE deals(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),client_id uuid REFERENCES clients(id),title text);
CREATE TABLE deal_activities(id uuid PRIMARY KEY,deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,content text);
CREATE TABLE paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,title text);
CREATE TABLE paige_chat_turns(id uuid PRIMARY KEY,thread_id uuid REFERENCES paige_chat_threads(id) ON DELETE RESTRICT,content text);
CREATE TABLE paige_owner_memory(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),content text);
CREATE TABLE paige_action_kinds(slug text PRIMARY KEY,enabled boolean,draft_subagent_slug text);
CREATE TABLE paige_actions(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),action_kind text REFERENCES paige_action_kinds(slug),status text,draft_content text,assigned_at timestamptz,autonomy_lane text,priority text,filed_at timestamptz DEFAULT now(),assigned_subagent_slug text,contact_id uuid,conversation_id uuid,title text,summary text,payload jsonb);
CREATE TABLE paige_durable_work(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),status text);
INSERT INTO paige_action_kinds VALUES('test_kind',true,'synthetic');
INSERT INTO tenants(id,name,status,account_type,parent_tenant_id) VALUES('${agency}','Example Agency','active','agency',null),('${child}','Example Child','trial','sub_account','${agency}'),('${solo}','Example Solo','active','standalone',null);
INSERT INTO paige_actions(id,tenant_id,action_kind,status,autonomy_lane,priority) VALUES('00000000-0000-0000-0000-000000000061','${child}','test_kind','filed','draft_only','normal'),('00000000-0000-0000-0000-000000000062','${solo}','test_kind','filed','draft_only','normal');
INSERT INTO tenant_members VALUES('00000000-0000-0000-0000-000000000021','${agency}','${ordinary}','owner','active'),('00000000-0000-0000-0000-000000000022','${child}','${ordinary}','admin','active'),('00000000-0000-0000-0000-000000000023','${solo}','${ordinary}','owner','active');
INSERT INTO profiles VALUES('${ordinary}','${agency}');`);
const base=await readFile('supabase/migrations/20260804150000_operator_fleet_seam.sql','utf8');
await db.exec(base.match(/CREATE OR REPLACE FUNCTION public\.operator_set_tenant_status\([\s\S]*?\$\$;/)[0]);
await db.exec(await readFile('supabase/migrations/20270602000202_operator_account_controls.sql','utf8'));
if(true) {
 const migration=await readFile('supabase/migrations/20270602000203_operator_account_archive.sql','utf8');
 await db.exec(migration); await db.exec(migration);
}
const actor=id=>db.query("select set_config('test.actor',$1,false)",[id]);
const preview=async id=>(await db.query('select operator_preview_account_archive($1) v',[id])).rows[0].v;
const refuse=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);};
await db.exec(`CREATE SCHEMA vault; CREATE TABLE vault.secrets(id uuid DEFAULT gen_random_uuid(),name text,secret text);
CREATE TABLE tenant_twilio_subaccounts(id uuid PRIMARY KEY,tenant_id uuid UNIQUE REFERENCES tenants(id),twilio_subaccount_sid text,status text,active boolean,auth_token_vault_ref text,api_key_sid text,inbound_webhook_secret text,twiml_app_sid text);
CREATE TABLE tenant_n8n_connections(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),base_url_ct text,api_key_ct text,api_key_last4 text,status text,last_error text,workflow_count integer,updated_by uuid,updated_at timestamptz);
CREATE TABLE tenant_phone_numbers(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),subaccount_id uuid REFERENCES tenant_twilio_subaccounts(id),phone_number text);
CREATE TABLE mcp_connections(connection_id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),provider_key text,legacy_source text,enabled boolean,server_url_ct text,auth_token_ct text,auth_token_last4 text,refresh_token_ct text,oauth_client_secret_ct text,inbound_contact_secret_hash text,inbound_contact_actor uuid,granted_scopes text[],provider_state jsonb,status text,health text,last_error_code text,last_checked_at timestamptz,updated_by uuid,updated_at timestamptz);
CREATE TABLE mcp_connection_approvals(connection_id uuid REFERENCES mcp_connections(connection_id),pin text);
CREATE TABLE mcp_connection_tools(connection_id uuid REFERENCES mcp_connections(connection_id),tool text);
CREATE TABLE platform_subscriptions(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),status text,stripe_subscription_id text,stripe_customer_id text);
CREATE TABLE platform_usage_events(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),quantity numeric);
CREATE TABLE paige_voice_cost_reservations(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,state text,reserved_usd numeric);
CREATE TABLE paige_voice_tenant_budgets(tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,enabled boolean);
CREATE TABLE paige_voice_tenant_monthly_usage(tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,budget_month date,reserved_usd numeric,PRIMARY KEY(tenant_id,budget_month));
ALTER TABLE platform_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_permissive ON platform_usage_events FOR SELECT TO authenticated USING(true);
GRANT SELECT ON platform_usage_events TO authenticated;
CREATE TABLE paige_llm_trace(id uuid PRIMARY KEY,tenant_id uuid,working_context_tenant_id uuid,cost_estimate_usd numeric,input_excerpt text,output_excerpt text,error_message text,task_id text,deliverable_id uuid,metadata jsonb);
CREATE TABLE email_send_log(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),status text);
CREATE TABLE platform_subscription_plans(id uuid PRIMARY KEY,monthly_price_cents bigint,annual_price_cents bigint);
ALTER TABLE platform_subscriptions ADD COLUMN plan_id uuid REFERENCES platform_subscription_plans(id), ADD COLUMN billing_period text DEFAULT 'monthly';
CREATE TABLE platform_mrr_snapshot(snapshot_date date PRIMARY KEY,mrr_cents bigint,arr_cents bigint,active_tenants integer,tier_breakdown jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
ALTER TABLE tenants ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN trial_ends_at timestamptz;
CREATE TABLE paige_client_events(tenant_id uuid,occurred_at timestamptz);
CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql AS $$SELECT active_tenant_id FROM profiles WHERE id=auth.uid()$$;
CREATE FUNCTION is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
const n8n=await readFile('supabase/migrations/20260711210000_tenant_n8n_connections.sql','utf8');
const start=n8n.indexOf('CREATE OR REPLACE FUNCTION public.clear_tenant_n8n_connection(');
const body=n8n.indexOf('AS $$',start),end=n8n.indexOf('$$;',body+5);
await db.exec(n8n.slice(start,end+3));
if(!process.argv.includes('--resource-baseline')) {
 const migration=await readFile('supabase/migrations/20270602000302_operator_provider_retirement.sql','utf8');await db.exec(migration);await db.exec(migration);
}
if(process.argv.includes('--cached-audio')) {
 await db.exec(`CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb,version text,last_accessed_at timestamptz,is_versioned boolean DEFAULT false,is_delete_marker boolean DEFAULT false);
 INSERT INTO storage.buckets VALUES('tts-cache',false),('documents',false);
 INSERT INTO storage.objects VALUES(gen_random_uuid(),'tts-cache','${child}/${'a'.repeat(64)}.mp3','{}','v1',now(),false,false),(gen_random_uuid(),'tts-cache','${child}/${'b'.repeat(64)}.mp3','{}','v1',now(),false,false),(gen_random_uuid(),'tts-cache','${solo}/${'c'.repeat(64)}.mp3','{}','v1',now(),false,false),(gen_random_uuid(),'tts-cache','_platform/${'d'.repeat(64)}.mp3','{}','v1',now(),false,false);`);
 const migration=await readFile('supabase/migrations/20270602000303_operator_cached_audio_retirement.sql','utf8');await db.exec(migration);await db.exec(migration);
 await db.exec(`DO $$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fixture_storage_owner') THEN CREATE ROLE fixture_storage_owner; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fixture_trigger_migrator') THEN CREATE ROLE fixture_trigger_migrator; END IF; END$$;
 ALTER TABLE storage.objects OWNER TO fixture_storage_owner;
 GRANT USAGE ON SCHEMA storage,public TO fixture_trigger_migrator;
 GRANT TRIGGER ON storage.objects TO fixture_trigger_migrator;
 GRANT EXECUTE ON FUNCTION guard_operator_retired_tts_cache() TO fixture_trigger_migrator;
 SET ROLE fixture_trigger_migrator;
 CREATE OR REPLACE TRIGGER a01_operator_retired_tts_cache BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retired_tts_cache();
 CREATE OR REPLACE TRIGGER a01_operator_retired_tts_cache BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retired_tts_cache();
 RESET ROLE;`);
 await refuse(()=>db.exec("SET ROLE authenticated; SELECT operator_tts_cache_manifest('"+child+"');"),'42501');await db.exec('RESET ROLE');
}
if(process.argv.includes('--generated-media')) {
 await db.exec(`CREATE TABLE marketing_content(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),image_path text,image_url text,status text,meta jsonb,published_at timestamptz);
 CREATE TABLE paige_social_posts(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),media_urls jsonb,status text,published_at timestamptz);
 INSERT INTO storage.buckets VALUES('paige-generated',true);
 INSERT INTO storage.objects(id,bucket_id,name,metadata) VALUES(gen_random_uuid(),'paige-generated','${child}/1780000000000-abcdef12.png','{}'),(gen_random_uuid(),'paige-generated','${child}/1780000000001-abcdef13.webp','{}'),(gen_random_uuid(),'paige-generated','${solo}/1780000000002-abcdef14.jpg','{}');
 INSERT INTO marketing_content VALUES(gen_random_uuid(),'${child}','${child}/1780000000000-abcdef12.png',null,'draft','{"versions":[{"image_path":"${child}/1780000000001-abcdef13.webp"}]}',null);`);
 if(!process.argv.includes('--generated-baseline')){
  const m=await readFile('supabase/migrations/20270602000304_operator_generated_media_retirement.sql','utf8');await db.exec(m);await db.exec(m);
  for(const obligation of ['foreign','published','legal','social']){
   const change=obligation==='foreign'?`insert into marketing_content values(gen_random_uuid(),'${solo}','${child}/1780000000000-abcdef12.png',null,'draft','{}',null)`:
    obligation==='social'?`insert into paige_social_posts values(gen_random_uuid(),'${solo}','["${child}/1780000000000-abcdef12.png"]','draft',null)`:
    `update marketing_content set status='${obligation==='published'?'published':'draft'}',meta='${obligation==='legal'?'{"legal_hold":true}':'{}'}' where tenant_id='${child}'`;
   // One connection owns the transaction, including the refusal and rollback.
   await db.exec(`BEGIN; ${change}; DO $$BEGIN
    BEGIN PERFORM operator_generated_media_manifest('${child}'); RAISE EXCEPTION 'obligation was ignored';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
    END$$; ROLLBACK;`);
  }
  await db.exec(`BEGIN; insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'paige-generated','${child}/independent-document.pdf');
   DO $$BEGIN BEGIN PERFORM operator_generated_media_manifest('${child}'); RAISE EXCEPTION 'unrecognized file became removable';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; END$$; ROLLBACK;`);
  await refuse(()=>db.exec(`SET ROLE authenticated; SELECT operator_generated_media_manifest('${child}');`),'42501');await db.exec('RESET ROLE');
 }
}
if(process.argv.includes('--platform-independent')) {
 if(!process.argv.includes('--independent-baseline')) {
  const forward=await readFile('supabase/migrations/20270602000504_operator_provider_independent_retirement.sql','utf8');
  await db.exec(forward);await db.exec(forward);
 }
 if(process.argv.includes('--file-obligation-baseline')) {
  const legacy=await readFile('supabase/migrations/20270602000304_operator_generated_media_retirement.sql','utf8');
  await db.exec(legacy.match(/CREATE OR REPLACE FUNCTION public\.operator_preview_retirement_resources\([\s\S]*?\$\$;/)[0]);
 }
 try {await (await import('./operator-provider-independent-retirement.mjs')).proveProviderIndependentRetirement({db,actor,preview,refuse,owner,ordinary,agency,child,solo});}
 finally {await db.close();}
 process.exit(0);
}
const op='00000000-0000-0000-0000-000000000080',claim='00000000-0000-0000-0000-000000000081',archiveOp='00000000-0000-0000-0000-000000000082';
const key='twilio:'+child,nkey='n8n:'+agency,admin='00000000-0000-0000-0000-000000000003';
const resourcePreview=async(mode='archive')=>(await db.query('select operator_preview_retirement_resources($1,$2) v',[agency,mode])).rows[0].v;
const read=async()=>(await db.query('select operator_read_retirement_resources($1,$2) v',[agency,op])).rows[0].v;
const begin=async(p,id=op,retain=true)=>db.query('select operator_begin_retirement_resources($1,$2,$3,$4,$5,$6)',[agency,p.mode,p.version,'Example Agency',id,retain]);
const take=async(id=op)=>db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false) v',[agency,id,admin,claim]);
const finish=async(key,state,status,id=op)=>db.query('select operator_finish_retirement_resource($1,$2,$3,$4,$5,$6,$7,$8)',[agency,id,admin,claim,key,state,status,state==='verified'?null:'synthetic_provider_failure']);
const complete=async(id=op)=>db.query('select operator_complete_retirement_resources($1,$2,$3,$4)',[agency,id,admin,claim]);
try {
 await actor(owner);
 await db.query(`insert into tenant_twilio_subaccounts values(gen_random_uuid(),$1,$2,'active',true,$3,'synthetic-key','synthetic-webhook',null)`,[child,'AC'+'b'.repeat(32),'twilio_subaccount_api_key_secret:'+child]);
 await db.query("insert into vault.secrets(name,secret) values($1,'synthetic-secret')",['twilio_subaccount_api_key_secret:'+child]);
 await db.query("insert into tenant_n8n_connections values($1,'synthetic-url','synthetic-key','1234','connected',null,200,null,now())",[agency]);
 await db.query("insert into tenant_phone_numbers select gen_random_uuid(),tenant_id,id,'synthetic-phone' from tenant_twilio_subaccounts");
 await db.query("insert into mcp_connections(connection_id,tenant_id,provider_key,legacy_source,enabled,server_url_ct,auth_token_ct,status) values(gen_random_uuid(),$1,'n8n','tenant_n8n_connections',true,'synthetic-url','synthetic-key','connected')",[agency]);
 await db.query("insert into platform_subscriptions(id,tenant_id,status,stripe_subscription_id,stripe_customer_id) values(gen_random_uuid(),$1,'active',null,null)",[agency]);
 await db.query('insert into platform_usage_events values(gen_random_uuid(),$1,3.50), (gen_random_uuid(),$2,1.25)',[child,solo]);
 await db.query("insert into paige_llm_trace values(gen_random_uuid(),$1,$1,0.20,'deleted-business-input','deleted-business-output',null,'task',null,'{}'),(gen_random_uuid(),$2,$1,0.30,'surviving-business-input','surviving-business-output',null,'survivor-task',null,'{}')",[child,solo]);
 await db.query("insert into email_send_log values(gen_random_uuid(),$1,'sent')",[child]);
 await refuse(()=>db.query('update platform_usage_events set operator_rows_server_only=true where tenant_id=$1',[child]),'42501');
 const old=await preview(agency);assert.equal(old.execution_available,false,'real provider rows block the previous contract');
 let p=await resourcePreview(); // Failing-first baseline lacks this actual SQL seam.
 assert.equal(p.resources.length,2);assert.equal(p.execution_available,true,JSON.stringify(p.blockers));assert.ok(!JSON.stringify(p).includes('synthetic-key'));
 await actor(ordinary);await refuse(()=>resourcePreview(),'42501');await actor(admin);
 await refuse(()=>begin({...p,version:'stale'}),'40001');await refuse(()=>begin(p,op,false),'22023');
 await begin(p);assert.equal((await read()).state,'resources_preparing');
 assert.equal((await db.query('select bool_and(lifecycle_execution_paused) v from tenants where id IN ($1,$2)',[agency,child])).rows[0]?.v,true);
 await refuse(()=>db.query("update tenant_twilio_subaccounts set twilio_subaccount_sid='changed' where tenant_id=$1",[child]),'55000');
 await refuse(()=>db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false)',[agency,op,ordinary,claim]),'42501');
 await actor('');await take();
 await refuse(()=>take(),'55000');
 assert.equal((await db.query('select operator_assert_retirement_resource($1,$2,$3,$4,$5) v',[agency,op,admin,claim,key])).rows[0].v,true);
 await finish(key,'verified','suspended');await finish(nkey,'verified','disconnected');await complete();
 await actor(admin);assert.equal((await read()).state,'resources_ready');
 const cleared=(await db.query('select api_key_ct,status,workflow_count from tenant_n8n_connections')).rows[0];assert.equal(cleared.api_key_ct,null);assert.equal(cleared.status,'unconfigured');assert.equal(cleared.workflow_count,0);
 const projected=(await db.query('select enabled,auth_token_ct from mcp_connections')).rows[0];assert.equal(projected.enabled,false);assert.equal(projected.auth_token_ct,null,'legacy projection must not retain an executable credential');
 p=await preview(agency);assert.equal(p.execution_available,true,JSON.stringify(p.blockers));
 await db.query('select operator_archive_account($1,$2,$3,$4)',[agency,p.version,'Example Agency',archiveOp]);
 await db.query('select operator_restore_archived_account($1,$2)',[agency,archiveOp]);
 assert.equal((await db.query('select status,active from tenant_twilio_subaccounts')).rows[0].status,'suspended');
 assert.equal((await db.query('select lifecycle_execution_paused v from tenants where id=$1',[agency])).rows[0].v,true);
 p=await preview(agency);const second='00000000-0000-0000-0000-000000000083';
 await db.query('select operator_archive_account($1,$2,$3,$4)',[agency,p.version,'Example Agency',second]);
 const deletion=(await db.query('select operator_preview_account_deletion($1) v',[agency])).rows[0].v;
 assert.equal(deletion.execution_available,false,'suspension is not provider closure');
 p=await resourcePreview('delete');
 if(process.argv.includes('--cached-audio')){
  assert.equal(p.resources.find(r=>r.provider==='tts_cache').object_count,2);
  assert.ok(!JSON.stringify(p).includes('a'.repeat(64)), 'public review never exposes private paths');
  for(const bucket of ["'documents'",'NULL']){
   await db.exec(`BEGIN; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),${bucket},'${child}/independent-file');
    DO $$BEGIN IF (operator_preview_retirement_resources('${agency}','delete')->>'execution_available')::boolean THEN RAISE EXCEPTION 'unrecognized storage became ready'; END IF; END$$; ROLLBACK;`);
  }
  await db.exec(`BEGIN; UPDATE storage.buckets SET public=true WHERE id='tts-cache';
   DO $$BEGIN IF (operator_preview_retirement_resources('${agency}','delete')->>'execution_available')::boolean THEN RAISE EXCEPTION 'public cache became ready'; END IF; END$$; ROLLBACK;`);
  // An unrelated active tenant remains writable while the reviewed Agency scope is frozen.
  await db.query("update storage.objects set version='v2' where name=$1",[solo+'/'+('c'.repeat(64))+'.mp3']);
 }
 if(process.argv.includes('--generated-media')){
  assert.equal(p.resources.find(r=>r.provider==='generated_media')?.object_count,2,'ordinary generated files gain their actual cleanup path');
  assert.equal(p.execution_available,true,JSON.stringify(p.blockers));
 }
 const deleteOp='00000000-0000-0000-0000-000000000084';await begin(p,deleteOp);
 await actor('');await take(deleteOp);await finish(key,'unknown',null,deleteOp);await complete(deleteOp);
 await actor(admin);assert.equal((await db.query('select operator_read_retirement_resources($1,$2) v',[agency,deleteOp])).rows[0].v.state,'resources_unknown');
 assert.equal((await db.query('select operator_preview_account_deletion($1) v',[agency])).rows[0].v.execution_available,false);
 await actor('');await take(deleteOp);
 // A surviving tenant's canonical reference must preserve a shared Vault credential.
 // Roll back this control, then prove the exclusive-credential retirement separately.
 await db.exec(`BEGIN;
  CREATE TABLE survivor_secret_binding(tenant_id uuid REFERENCES tenants(id),credentials_vault_ref text);
  INSERT INTO survivor_secret_binding VALUES('${solo}','twilio_subaccount_api_key_secret:${child}');
  SELECT operator_finish_retirement_resource('${agency}','${deleteOp}','${admin}','${claim}','${key}','verified','closed',NULL);
  DO $$ BEGIN IF (SELECT count(*) FROM vault.secrets)<>1 THEN RAISE EXCEPTION 'shared survivor credential was removed'; END IF; END $$;
  ROLLBACK;`);
 await finish(key,'verified','closed',deleteOp);await finish(nkey,'verified','disconnected',deleteOp);
 if(process.argv.includes('--cached-audio')){
  const ckey='tts_cache:'+child;
  await refuse(()=>finish(ckey,'verified','removed',deleteOp),'55000');
  await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'tts-cache',$1)",[child+'/'+('e'.repeat(64))+'.mp3']),'55000');
  await refuse(()=>db.query("update storage.objects set version='changed' where name=$1",[child+'/'+('a'.repeat(64))+'.mp3']),'55000');
  await db.query('update storage.objects set last_accessed_at=now() where name=$1',[child+'/'+('a'.repeat(64))+'.mp3']);
  assert.equal((await db.query('select operator_assert_retirement_resource($1,$2,$3,$4,$5) v',[agency,deleteOp,admin,claim,ckey])).rows[0].v,true);
  // Synthetic metadata disappearance models the Storage API; byte deletion is separately adapter-tested, not claimed by SQL.
  await db.query('delete from storage.objects where name=$1',[child+'/'+('a'.repeat(64))+'.mp3']);
  await finish(ckey,'unknown',null,deleteOp);await complete(deleteOp);
  await take(deleteOp);assert.equal((await db.query('select operator_assert_retirement_resource($1,$2,$3,$4,$5) v',[agency,deleteOp,admin,claim,ckey])).rows[0].v,true,'partial removal permits same-plan recovery');
  await db.query('delete from storage.objects where name=$1',[child+'/'+('b'.repeat(64))+'.mp3']);
  await finish(ckey,'verified','removed',deleteOp);
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,process.argv.includes('--generated-media')?5:2,'surviving Solo/platform audio and pending media remain');
 }
 if(process.argv.includes('--generated-media')){
  const gkey='generated_media:'+child;
  await refuse(()=>finish(gkey,'verified','removed',deleteOp),'55000');
  await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'paige-generated',$1)",[child+'/1780000000003-abcdef15.mp4']),'55000');
  await refuse(()=>db.query("insert into marketing_content values(gen_random_uuid(),$1,$2,null,'draft','{}',null)",[solo,child+'/1780000000000-abcdef12.png']),'55000');
  await refuse(()=>db.query("insert into paige_social_posts values(gen_random_uuid(),$1,$2,'draft',null)",[solo,JSON.stringify([child+'/1780000000000-abcdef12.png'])]),'55000');
  await db.query("delete from storage.objects where name=$1",[child+'/1780000000000-abcdef12.png']);
  await finish(gkey,'unknown',null,deleteOp);await complete(deleteOp);await take(deleteOp);
  assert.equal((await db.query('select operator_assert_retirement_resource($1,$2,$3,$4,$5) v',[agency,deleteOp,admin,claim,gkey])).rows[0].v,true,'partial media cleanup recovers the same plan');
  await db.query("delete from storage.objects where name=$1",[child+'/1780000000001-abcdef13.webp']);
  await finish(gkey,'verified','removed',deleteOp);
 }
 await complete(deleteOp);
 assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n,0,'exclusive retired credential is removed');
 await actor(admin);const ready=(await db.query('select operator_preview_account_deletion($1) v',[agency])).rows[0].v;
 assert.equal(ready.execution_available,true,JSON.stringify(ready.blockers));
 await db.query('select operator_delete_archived_account($1,$2,$3,$4)',[agency,ready.version,'Example Agency',second]);
 if(process.argv.includes('--generated-media')){assert.equal((await db.query('select count(*)::int n from marketing_content')).rows[0].n,0);assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='paige-generated'")).rows[0].n,1,'surviving media preserved');}
 for(const rel of ['tenant_twilio_subaccounts','tenant_n8n_connections','tenant_phone_numbers','mcp_connections','email_send_log'])assert.equal((await db.query(`select count(*)::int n from ${rel}`)).rows[0].n,0);
 assert.equal((await db.query('select sum(quantity)::text v from platform_usage_events')).rows[0].v,'4.75','historical financial quantities are unchanged');
 const retained=(await db.query('select retired_tenant_id,operator_rows_server_only,tenant_id from platform_usage_events where retired_tenant_id=$1',[child])).rows[0];assert.equal(retained.tenant_id,null);assert.equal(retained.operator_rows_server_only,true);
 const traces=(await db.query('select tenant_id,input_excerpt,retired_tenant_id,working_context_tenant_id,retired_working_context_tenant_id,cost_estimate_usd::text cost from paige_llm_trace order by cost_estimate_usd')).rows;
 assert.equal(traces[0].input_excerpt,null);assert.equal(traces[0].cost,'0.20');assert.equal(traces[1].input_excerpt,'surviving-business-input');assert.equal(traces[1].tenant_id,solo);assert.equal(traces[1].working_context_tenant_id,null);assert.equal(traces[1].retired_working_context_tenant_id,child);
 await actor(ordinary);await db.exec('SET ROLE authenticated');assert.equal((await db.query('select count(*)::int n from platform_usage_events')).rows[0].n,1,'a permissive policy cannot expose retained accounting to an ordinary identity');await db.exec('RESET ROLE');await actor(admin);
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[solo])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3);
 const acl=(await db.query("select has_function_privilege('authenticated','operator_finish_retirement_resource(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') v")).rows[0].v;assert.equal(acl,false);
 // Current commercial reporting is independent of retained accounting history.
 const planId='00000000-0000-0000-0000-000000000091';await db.query('insert into platform_subscription_plans values($1,1200,14400)',[planId]);
 await db.query("insert into tenant_revenue_classification values($1,'real')",[solo]);
 await db.query("insert into platform_subscriptions(id,tenant_id,status,stripe_subscription_id,plan_id) values(gen_random_uuid(),$1,'active','sub_synthetic_paid',$2)",[solo,planId]);
 for(const [suffix,classification,status,subscriptionStatus,stripe] of [[92,'test','active','active',true],[93,'internal','active','active',true],[94,'real','canceled','active',true],[95,'real','trial','trialing',true],[96,'real','active','active',false],[97,null,'active','active',true]]){
  const id='00000000-0000-0000-0000-0000000000'+suffix;
  await db.query("insert into tenants(id,name,status,account_type) values($1,'Synthetic reporting fixture',$2,'standalone')",[id,status]);
  if(classification)await db.query('insert into tenant_revenue_classification values($1,$2)',[id,classification]);
  await db.query('insert into platform_subscriptions(id,tenant_id,status,stripe_subscription_id,plan_id) values(gen_random_uuid(),$1,$2,$3,$4)',[id,subscriptionStatus,stripe?'sub_synthetic_'+suffix:null,planId]);
 }
 await db.query("insert into platform_mrr_snapshot values(current_date-1,12345,148140,1,'{}',now())");
 const metric=(await db.query('select operator_dashboard_metrics(30) v')).rows[0].v;assert.equal(metric.mrr_cents,1200);assert.equal(metric.arr_cents,14400);
 const snapshot=(await db.query('select (operator_snapshot_mrr_daily_internal()).*')).rows[0];assert.equal(Number(snapshot.mrr_cents),1200);assert.equal(snapshot.active_tenants,1,'trials, test, internal, canceled, unclassified and unbilled rows are not paying customers');
 assert.equal((await db.query('select mrr_cents::text v from platform_mrr_snapshot where snapshot_date=current_date-1')).rows[0].v,'12345','do not rewrite legitimate past financial snapshots');
 assert.equal((await db.query('select count(*)::int n from platform_usage_events')).rows[0].n,2,'commercial filtering never destroys accounting history');
 if(process.argv.includes('--cached-audio')) {
 const disposable='00000000-0000-0000-0000-000000000098',cacheOp='00000000-0000-0000-0000-000000000099',archiveId='00000000-0000-0000-0000-000000000100';
 await db.query("insert into tenants(id,name,status,account_type) values($1,'Synthetic Solo cache','active','standalone')",[disposable]);
 await db.query("insert into tenant_members values(gen_random_uuid(),$1,$2,'owner','active')",[disposable,ordinary]);
 await db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'tts-cache',$1)",[disposable+'/'+('f'.repeat(64))+'.mp3']);
 if(process.argv.includes('--generated-media'))await db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'paige-generated',$1)",[disposable+'/1780000000004-abcdef16.mp4']);
 let v=await preview(disposable);await db.query('select operator_archive_account($1,$2,$3,$4)',[disposable,v.version,'Synthetic Solo cache',archiveId]);
 assert.equal((await db.query("select count(*)::int n from storage.objects where split_part(name,'/',1)=$1",[disposable])).rows[0].n,process.argv.includes('--generated-media')?2:1,'Archive preserves tenant files');
 v=(await db.query("select operator_preview_retirement_resources($1,'delete') v",[disposable])).rows[0].v;
 await db.query("select operator_begin_retirement_resources($1,'delete',$2,$3,$4,false)",[disposable,v.version,'Synthetic Solo cache',cacheOp]);await actor('');
 await db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false)',[disposable,cacheOp,admin,claim]);
 await db.query("delete from storage.objects where split_part(name,'/',1)=$1",[disposable]);
 await db.query("select operator_finish_retirement_resource($1,$2,$3,$4,$5,'verified','removed',null)",[disposable,cacheOp,admin,claim,'tts_cache:'+disposable]);
 if(process.argv.includes('--generated-media'))await db.query("select operator_finish_retirement_resource($1,$2,$3,$4,$5,'verified','removed',null)",[disposable,cacheOp,admin,claim,'generated_media:'+disposable]);
 await db.query('select operator_complete_retirement_resources($1,$2,$3,$4)',[disposable,cacheOp,admin,claim]);await actor(admin);
 v=(await db.query('select operator_preview_account_deletion($1) v',[disposable])).rows[0].v;assert.equal(v.execution_available,true,JSON.stringify(v.blockers));
 await db.query('select operator_delete_archived_account($1,$2,$3,$4)',[disposable,v.version,'Synthetic Solo cache',archiveId]);
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[disposable])).rows[0].n,0);
 await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'tts-cache',$1)",[disposable+'/'+('f'.repeat(64))+'.mp3']),'55000');
 if(process.argv.includes('--generated-media'))await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'paige-generated',$1)",[disposable+'/1780000000004-abcdef16.mp4']),'55000');
 assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,process.argv.includes('--generated-media')?3:2);
 console.log('PASS: cached-audio API plan/absence, private paths, unrecognized/public Storage refusal, partial removal recovery, archived/missing write freeze, Solo and Agency physical retirement preserve survivor/platform audio and shared identities. SQL metadata disappearance is a synthetic API port; live byte/provider proof UNVERIFIED.');
}
console.log('PASS: actual protected resource preparation, provider binding freeze, Admin/refusal, canonical credential disconnect, Archive/Restore, uncertain closure recovery and real Agency cleanup; shared Auth and independent Solo survive. Provider response is injected through service-only finalization; live provider proof UNVERIFIED.');
if(process.argv.includes('--generated-media'))console.log('PASS: generated image/video cleanup, private manifest ACLs, foreign/published/legal refusal, writer/reference freeze, partial removal recovery, Solo and Agency retirement preserve survivor media. Storage API effects remain separately adapter-tested; live bytes UNVERIFIED.');
}catch(e){console.error('FAIL:',e.code??e.name,e.message);process.exitCode=1;}finally{await db.close();}
