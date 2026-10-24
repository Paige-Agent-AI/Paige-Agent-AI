// Isolated SQL proof only. Auth identity is a fixture; no remote connection is accepted.
// The team_hub_files storage retirement provider (20271113870009), EXP08 Team Hub increment 3 §6.
// The fixture below is operator-provider-retirement.mjs's canonical isolated lifecycle fixture with
// its cached-audio and generated-media cases enabled (the chain this provider re-emits from), copied
// rather than imported because that file runs its own lifecycle on import. Keep the two in step.
process.argv.push('--cached-audio','--generated-media');
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
try {
 // Newest chain the provider re-emits from: R0 registry + operator_may, 504, the ANT-47 split, the plan repairs.
 const roleGuard=await readFile('supabase/migrations/20270510000000_operator_standing_one_answer.sql','utf8');
 for (const shape of [/CREATE TABLE IF NOT EXISTS public\.platform_operator_roles \([\s\S]*?\n\);/, /CREATE TABLE IF NOT EXISTS public\.platform_operator_capabilities \([\s\S]*?\n\);/, /CREATE TABLE IF NOT EXISTS public\.platform_operator_role_capabilities \([\s\S]*?\n\);/]) await db.exec(roleGuard.match(shape)[0]);
 await db.exec(roleGuard.match(/CREATE OR REPLACE FUNCTION public\.operator_may\(_capability text\)[\s\S]*?\n\$\$;/)[0]);
 await db.exec(`INSERT INTO platform_operator_roles(role,rank,holds_unlisted,description,ruling) VALUES ('super_admin',100,true,'The platform owner tier. Holds every capability, listed or not.','R0, owner ruling 2026-09-27'),('platform_admin',50,false,'The delegated operator tier. Holds the capabilities granted to it and nothing else.','R0, owner ruling 2026-09-27'),('moderator',10,false,'Proof-only delegated tier granted archive and nothing else.','ANT-47 proof fixture');
 INSERT INTO platform_operator_capabilities(capability,description,ruling) VALUES ('fleet.account.archive','Archive and restore eligible accounts through the canonical Fleet lifecycle.','ANT-47 owner rule 2026-10-10'),('fleet.account.permanent_delete','Permanently delete archived eligible accounts. Irreversible.','ANT-47 owner rule 2026-10-10');
 INSERT INTO platform_operator_role_capabilities(role,capability,ruling,in_force) VALUES ('super_admin','fleet.account.archive','ANT-47 owner rule 2026-10-10',true),('super_admin','fleet.account.permanent_delete','ANT-47 owner rule 2026-10-10',true),('platform_admin','fleet.account.archive','ANT-47 owner rule 2026-10-10',true),('platform_admin','fleet.account.permanent_delete','ANT-47 owner rule 2026-10-10',true),('moderator','fleet.account.archive','ANT-47 proof fixture',true);`);
 for(const f of ['20270602000504_operator_provider_independent_retirement.sql','20271020000100_operator_archive_delete_authority.sql','20271020000400_operator_deletion_plan_worklist.sql','20271020000420_operator_deletion_plan_catalog.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 // Minimal Team Hub shape (columns the provider and the plan read) and the A10 'delete' disposition.
 await db.exec(`CREATE TABLE team_hub_channels(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE);
 CREATE TABLE team_hub_messages(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,channel_id uuid NOT NULL REFERENCES team_hub_channels(id) ON DELETE CASCADE,deleted_at timestamptz);
 CREATE TABLE team_hub_files(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,channel_id uuid NOT NULL REFERENCES team_hub_channels(id) ON DELETE CASCADE,uploaded_by uuid NOT NULL,storage_path text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'pending',message_id uuid REFERENCES team_hub_messages(id) ON DELETE CASCADE,
  CONSTRAINT team_hub_files_path_chk CHECK (storage_path=tenant_id::text||'/team-hub/'||id::text));
 DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
  body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
  IF at=0 THEN RAISE EXCEPTION 'anchor'; END IF;
  EXECUTE left(body,at+length(anchor)-1)||'''team_hub_channels'',''team_hub_messages'',''team_hub_files'','||substr(body,at+length(anchor));
 END $$;
 INSERT INTO storage.buckets VALUES('comms-attachments',false);`);
 const m=await readFile('supabase/migrations/20271113870009_exp08_team_hub_files_retirement.sql','utf8');await db.exec(m);await db.exec(m);
 // The trigger is created by the storage-owning role in production; mirror the fixture's ownership split.
 await db.exec(`GRANT EXECUTE ON FUNCTION guard_operator_retired_team_hub_files() TO fixture_trigger_migrator; SET ROLE fixture_trigger_migrator;
  CREATE OR REPLACE TRIGGER a01_operator_retired_team_hub_files BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retired_team_hub_files(); RESET ROLE;`);
 const admin='00000000-0000-0000-0000-000000000003',claim='00000000-0000-0000-0000-000000000081';
 const th='00000000-0000-0000-0000-0000000000c1',thOp='00000000-0000-0000-0000-0000000000c2',resOp='00000000-0000-0000-0000-0000000000c3',chan='00000000-0000-0000-0000-0000000000c4',msg='00000000-0000-0000-0000-0000000000c5';
 const f1='0f0e0d0c-0b0a-4908-8706-050403020101',f2='0f0e0d0c-0b0a-4908-8706-050403020102',f3='0f0e0d0c-0b0a-4908-8706-050403020103',sf='0f0e0d0c-0b0a-4908-8706-050403020104',schan='00000000-0000-0000-0000-0000000000c6';
 const p1=th+'/team-hub/'+f1,p2=th+'/team-hub/'+f2,p3=th+'/team-hub/'+f3,sp=solo+'/team-hub/'+sf;
 await actor(admin);
 await db.query("insert into tenants(id,name,status,account_type) values($1,'Synthetic Team Hub Solo','active','standalone')",[th]);
 await db.query("insert into tenant_members values(gen_random_uuid(),$1,$2,'owner','active')",[th,ordinary]);
 await db.query('insert into team_hub_channels values($1,$2),($3,$4)',[chan,th,schan,solo]);
 await db.query('insert into team_hub_messages values($1,$2,$3,null)',[msg,th,chan]);
 // Two posted files with bytes, one pending record whose upload never happened, and a survivor's file.
 await db.query("insert into team_hub_files(id,tenant_id,channel_id,uploaded_by,storage_path,state,message_id) values($1,$2,$3,$4,$5,'ready',$6),($7,$2,$3,$4,$8,'ready',$6),($9,$2,$3,$4,$10,'pending',null),($11,$12,$13,$4,$14,'ready',null)",[f1,th,chan,ordinary,p1,msg,f2,p2,f3,p3,sf,solo,schan,sp]);
 await db.query("insert into storage.objects(id,bucket_id,name,metadata) values(gen_random_uuid(),'comms-attachments',$1,'{}'),(gen_random_uuid(),'comms-attachments',$2,'{}'),(gen_random_uuid(),'comms-attachments',$3,'{}')",[p1,p2,sp]);
 let v=await preview(th);assert.equal(v.execution_available,true,JSON.stringify(v.blockers));
 await db.query('select operator_archive_account($1,$2,$3,$4)',[th,v.version,'Synthetic Team Hub Solo',thOp]);
 assert.equal((await db.query("select count(*)::int n from storage.objects where split_part(name,'/',1)=$1",[th])).rows[0].n,2,'Archive preserves Team Hub files');
 // Guard: no new Team Hub object, rename or metadata rewrite once archived; Inbox objects and access-time touches unchanged.
 await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'comms-attachments',$1)",[p3]),'55000');
 await refuse(()=>db.query("update storage.objects set metadata='{\"size\":\"1\"}' where name=$1",[p1]),'55000');
 await refuse(()=>db.query("update storage.objects set name=$2 where name=$1",[p1,th+'/moved.pdf']),'55000');
 await db.query('update storage.objects set last_accessed_at=now() where name=$1',[p1]);
 await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'comms-attachments','not-a-tenant/team-hub/x')"),'42501');
 await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'comms-attachments',$1)",[th+'/team-hub']),'55000');
 await db.exec(`BEGIN; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/inbox-reply.pdf'); ROLLBACK;`);
 await db.exec(`BEGIN; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${solo}/team-hub/1f0e0d0c-0b0a-4908-8706-050403020105'); ROLLBACK;`);
 // Before purge the deletion preview still refuses: bytes exist, and the file records name them.
 v=(await db.query('select operator_preview_account_deletion($1) v',[th])).rows[0].v;assert.equal(v.execution_available,false);
 assert.ok(v.blockers.includes('team_hub_files: 2 file-bearing records require canonical object cleanup and absence verification before deletion.'),JSON.stringify(v.blockers));
 // Other comms objects keep blocking, exactly as before; malformed, oversized or public scopes refuse.
 for(const change of [`INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/1f0e0d0c-0b0a-4908-8706-050403020106-invoice.pdf')`,
  `INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/Team-Hub/${f3}')`,
  `INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/TEAM-HUB/${f3}')`,
  // The two-segment name is inside the prefix (split_part(name,'/',2)), the rule the storage
  // policies of 20271113870008 share, so browsers cannot create it; one that exists still refuses.
  `ALTER TABLE storage.objects DISABLE TRIGGER USER; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/team-hub')`,
  `ALTER TABLE storage.objects DISABLE TRIGGER USER; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/team-hub/${f3}/nested')`,
  `ALTER TABLE storage.objects DISABLE TRIGGER USER; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${th}/team-hub/${f3.toUpperCase()}')`,
  `ALTER TABLE storage.objects DISABLE TRIGGER USER; INSERT INTO storage.objects(id,bucket_id,name) SELECT gen_random_uuid(),'comms-attachments','${th}/team-hub/'||gen_random_uuid() FROM generate_series(1,99)`,
  `UPDATE storage.buckets SET public=true WHERE id='comms-attachments'`]){
  await db.exec(`BEGIN; ${change}; DO $$BEGIN IF (operator_preview_retirement_resources('${th}','delete')->>'execution_available')::boolean THEN RAISE EXCEPTION 'unsupported Team Hub/comms scope became ready'; END IF; END$$; ROLLBACK;`);
 }
 let p=(await db.query("select operator_preview_retirement_resources($1,'delete') v",[th])).rows[0].v;
 assert.equal(p.execution_available,true,JSON.stringify(p.blockers));
 assert.deepEqual(p.resources,[{provider:'team_hub_files',tenant_id:th,action:'remove_files',object_count:2}]);
 assert.ok(!JSON.stringify(p).includes(f1),'public review never exposes private paths');
 await refuse(()=>db.exec(`SET ROLE authenticated; SELECT operator_team_hub_files_manifest('${th}');`),'42501');await db.exec('RESET ROLE');
 await refuse(()=>db.exec(`SET ROLE service_role; SELECT operator_team_hub_files_subset('${th}','[]');`),'42501');await db.exec('RESET ROLE');
 await db.query("select operator_begin_retirement_resources($1,'delete',$2,$3,$4,false)",[th,p.version,'Synthetic Team Hub Solo',resOp]);
 const plan=(await db.query('select resource_plan v from operator_account_archives where id=$1',[resOp])).rows[0].v;
 assert.deepEqual(plan.map(i=>[i.key,i.provider,i.objects.map(o=>o.name)]),[['team_hub_files:'+th,'team_hub_files',[p1,p2]]],'plan binds exactly the two Team Hub objects, never the survivor');
 const key='team_hub_files:'+th;
 await actor('');
 // A widened scope (an object outside the reviewed plan) refuses the claim; a narrowed one (bytes already gone) does not.
 await db.exec(`BEGIN; ALTER TABLE storage.objects DISABLE TRIGGER USER; INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'comms-attachments','${p3}');
  DO $$BEGIN BEGIN PERFORM operator_claim_retirement_resources('${th}','${resOp}','${admin}','${claim}',false); RAISE EXCEPTION 'widened Team Hub scope was claimed';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END; END$$; ROLLBACK;`);
 await db.query('delete from storage.objects where name=$1',[p1]);
 await db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false)',[th,resOp,admin,claim]);
 const fin=(state,status)=>db.query('select operator_finish_retirement_resource($1,$2,$3,$4,$5,$6,$7,$8)',[th,resOp,admin,claim,key,state,status,state==='verified'?null:'synthetic_storage_failure']);
 const asserted=async()=>(await db.query('select operator_assert_retirement_resource($1,$2,$3,$4,$5) v',[th,resOp,admin,claim,key])).rows[0].v;
 await refuse(()=>fin('verified','removed'),'55000');
 assert.equal(await asserted(),true);
 // Synthetic metadata disappearance models the Storage API removal; partial removal recovers the same plan.
 await fin('unknown',null);await db.query('select operator_complete_retirement_resources($1,$2,$3,$4)',[th,resOp,admin,claim]);
 await db.query('select operator_claim_retirement_resources($1,$2,$3,$4,false)',[th,resOp,admin,claim]);
 assert.equal(await asserted(),true,'partial Team Hub cleanup recovers the same plan');
 await db.query('delete from storage.objects where name=$1',[p2]);
 await fin('verified','removed');await db.query('select operator_complete_retirement_resources($1,$2,$3,$4)',[th,resOp,admin,claim]);
 await actor(admin);
 const receipt=(await db.query('select operator_read_retirement_resources($1,$2) v',[th,resOp])).rows[0].v;
 assert.equal(receipt.state,'resources_ready');assert.equal(receipt.file_only,true);
 assert.equal((await db.query("select operator_resource_ready('team_hub_files',$1,'delete') v",[th])).rows[0].v,true);
 v=(await db.query('select operator_preview_account_deletion($1) v',[th])).rows[0].v;
 assert.equal(v.execution_available,true,JSON.stringify(v.blockers));
 await db.query('select operator_delete_archived_account($1,$2,$3,$4)',[th,v.version,'Synthetic Team Hub Solo',thOp]);
 assert.equal((await db.query('select count(*)::int n from tenants where id=$1',[th])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from team_hub_files where tenant_id=$1',[th])).rows[0].n,0,'Team Hub file records go with the account');
 assert.equal((await db.query('select count(*)::int n from team_hub_files where tenant_id=$1',[solo])).rows[0].n,1,'survivor record preserved');
 assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1",[sp])).rows[0].n,1,'survivor Team Hub bytes preserved');
 await refuse(()=>db.query("insert into storage.objects(id,bucket_id,name) values(gen_random_uuid(),'comms-attachments',$1)",[p1]),'55000');
 console.log('PASS: Team Hub files provider — private bounded canonical manifest, Inbox/look-alike/two-segment/nested/upper-case/oversized/public scopes refuse, archived write/rename/metadata freeze with access-time touch allowed, deletion refuses while bytes exist, plan binds exact objects, premature finish refused, partial removal recovers, file-only receipt, absence releases the records, Solo retirement preserves a survivor. Storage API effects are a synthetic metadata port; live bytes UNVERIFIED.');
}catch(e){console.error('FAIL:',e.code??e.name,e.message);process.exitCode=1;}finally{await db.close();}
