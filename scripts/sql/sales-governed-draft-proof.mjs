// Disposable local proof only. Canonical Rail function bodies are loaded from tracked migrations.
import {readFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {strict as assert} from 'node:assert';
import {fileURLToPath} from 'node:url';
const [binary,port,user,expectedDirectory]=process.argv.slice(2);
if(!binary||!/^\d+$/.test(port??'')||!user||!expectedDirectory)throw Error('Explicit local cluster arguments required');
const cwd=fileURLToPath(new URL('.',import.meta.url));
let database='postgres';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const args=()=>['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-t','-A'];
const run=sql=>{const p=spawnSync(binary,args(),{cwd,input:sql,encoding:'utf8',maxBuffer:8*1024*1024});if(p.status!==0)throw Error(p.stderr.split(/\r?\n/).filter(line=>!line.includes('NOTICE:')).join('\n'));return p.stdout;};
const normalize=s=>s.trim().replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(run('SHOW data_directory;')),normalize(expectedDirectory),'refuse other clusters');
const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert(start>=0,name);const end=source.indexOf('END $$;',start);assert(end>start,name);return source.slice(start,end+7);};
const rail12=read('../../supabase/migrations/20261212000000_paige_can_show_her_work.sql');
const rail20=read('../../supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
const catalogue=read('../../supabase/migrations/20270543000003_sales_invoice_autonomy_catalogue.sql');
const setup=`
RESET ROLE;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER TABLE auth.users ADD deleted_at timestamptz,ADD banned_until timestamptz;
ALTER TABLE tenants ADD status text DEFAULT 'active',ADD name text,ADD business_name text;
ALTER TABLE tenant_members ADD status text DEFAULT 'active',ADD role text DEFAULT 'owner';
INSERT INTO tenant_members(tenant_id,user_id) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid,full_name text);
INSERT INTO profiles VALUES('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Fixture owner');
CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
${extract(rail20,'_workspace_event_display')}
${extract(rail12,'_record_workspace_rail_event')}
${extract(rail20,'record_capability_run')}
REVOKE ALL ON FUNCTION record_capability_run(uuid,uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_capability_run(uuid,uuid,text,text,uuid,text) TO service_role;
\\ir ../../supabase/migrations/20270543000000_sales_invoice_lifecycle.sql
\\ir ../../supabase/migrations/20270543000000_sales_invoice_lifecycle.sql
CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz);
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql AS 'SELECT false';
${catalogue}
CREATE TABLE channel_connectors(id uuid PRIMARY KEY,tenant_id uuid,active boolean,status text,channel_type text,provider text,from_address text);
CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,contact_id uuid,connector_id uuid,thread_key text,channel_type text,direction text,status text,recipients jsonb,subject text,body_html text,meta jsonb,error text,provider_message_id text);
\\ir ../../supabase/migrations/20270543000002_sales_invoice_delivery.sql
\\ir ../../supabase/migrations/20270543000002_sales_invoice_delivery.sql
`;
const base=read('sales-billing-drafts-proof.sql');
const snapshot=read('sales-invoice-snapshot-proof.sql');
const brandSource=read('../../supabase/migrations/20260711310000_brand_schema_and_cascade.sql');
const brandStart=brandSource.indexOf('CREATE OR REPLACE FUNCTION public.set_tenant_brand(');
const brandEnd=brandSource.indexOf('END $$;',brandStart)+7;
assert(brandStart>=0&&brandEnd>brandStart);
const preferencesSetup=`
RESET ROLE;
ALTER TABLE tenants ADD brand jsonb DEFAULT '{}';
CREATE FUNCTION public.can_manage_tenant_brand(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT is_tenant_admin($1)';
${brandSource.slice(brandStart,brandEnd)}
GRANT SELECT,UPDATE(brand) ON tenants TO authenticated;
\\ir ../../supabase/migrations/20270547000002_sales_collection_autonomy_catalogue.sql
\\ir ../../supabase/migrations/20270548000000_studio_publish_autonomy_catalogue.sql
\\ir ../../supabase/migrations/20270553000000_sales_invoice_preferences.sql
\\ir ../../supabase/migrations/20270553000000_sales_invoice_preferences.sql
`;
const assertions=read('sales-invoice-lifecycle-proof.sql')+'\n'+preferencesSetup+'\n'+read('sales-invoice-preferences-proof.sql');
const draftConcurrency=process.argv[6]==='--draft-concurrency';
const concurrency=draftConcurrency||process.argv[6]==='--concurrency';
const autonomySource=read('../../supabase/migrations/20261039000000_autonomy_respects_the_trust_ceiling.sql');
const autonomyStart=autonomySource.indexOf('CREATE OR REPLACE FUNCTION public.resolve_tool_autonomy(');
const autonomyEnd=autonomySource.indexOf('$$;',autonomyStart)+3;
assert(autonomyStart>=0&&autonomyEnd>autonomyStart,'canonical autonomy resolver source');
const exactProof=read('sales-exact-deposit-proof.sql')+`
CREATE FUNCTION public.trust_effective_rung() RETURNS integer LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.trust_rung',true),''),'2')::integer $$;
${autonomySource.slice(autonomyStart,autonomyEnd)}
GRANT EXECUTE ON FUNCTION resolve_tool_autonomy(uuid,text) TO service_role;
`+'\n'+read('sales-governed-draft-proof.sql');
const ownedDatabase='sales_preferences_race_'+randomUUID().replaceAll('-','');
if(concurrency){assert(/^sales_preferences_race_[a-f0-9]{32}$/.test(ownedDatabase));run(`CREATE DATABASE ${ownedDatabase};`);database=ownedDatabase;}
try{
 run(base.replace('ROLLBACK;',()=>snapshot+'\n'+setup+'\n'+assertions+'\n'+(concurrency&&!draftConcurrency?'SAVEPOINT exact_deposit;\n':'')+exactProof+(draftConcurrency?'\nRESET ROLE; CREATE TABLE proof_concurrent_draft AS SELECT command FROM governed_draft_command; GRANT SELECT ON proof_concurrent_draft TO service_role;':concurrency?'\nROLLBACK TO SAVEPOINT exact_deposit;':'')+(concurrency?'\nCOMMIT;':'\nROLLBACK;')));
 if(concurrency){
  const execute=sql=>new Promise(resolve=>{const p=spawn(binary,args(),{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',data=>stdout+=data);p.stderr.on('data',data=>stderr+=data);p.on('close',code=>resolve({code,stdout,stderr}));p.on('error',error=>resolve({code:1,stdout,stderr:String(error)}));p.stdin.end(sql);});
  if(draftConcurrency){
   const create=`BEGIN;SET LOCAL ROLE service_role;SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000830',(SELECT jsonb_set(command,'{invoice_id}','"60000000-0000-0000-0000-000000000830"') FROM proof_concurrent_draft),proof_draft_governance('invoice.draft_create','billing_create_invoice','standing_autonomy_setting'));COMMIT;`;
   const same=await Promise.all([execute(create),execute(create)]);assert(same.every(r=>r.code===0),JSON.stringify(same));assert.equal(same[0].stdout,same[1].stdout);
   assert.equal(run("SELECT count(*) FROM paige_invoice_operations WHERE id='70000000-0000-0000-0000-000000000830';").trim(),'1');
   assert.equal(run("SELECT count(*) FROM paige_workspace_events WHERE source_id='70000000-0000-0000-0000-000000000830';").trim(),'1');
   const revision=op=>`BEGIN;SET LOCAL ROLE service_role;SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',('70000000-0000-0000-0000-'||lpad('${op}',12,'0'))::uuid,jsonb_build_object('action','invoice.draft_revise','invoice_id','60000000-0000-0000-0000-000000000830','expected_version',1,'draft',(SELECT command->'draft' FROM proof_concurrent_draft)),proof_draft_governance('invoice.draft_revise','sales_revise_invoice_draft'));COMMIT;`;
   const competing=await Promise.all([execute(revision(831)),execute(revision(832))]);assert.equal(competing.filter(r=>r.code===0).length,1,JSON.stringify(competing));assert(competing.find(r=>r.code!==0).stderr.includes('Draft version conflict'));
   assert.equal(run("SELECT billing_draft_version FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000830';").trim(),'2');
  }else{
  const command=(op,version,amount)=>`BEGIN;SET LOCAL ROLE service_role;SELECT proof_command(${op},'{"action":"invoice.record_manual_payment","expected_version":${version},"amount_cents":${amount},"currency":"usd","method":"cash","received_at":"2026-10-01T12:00:00Z"}','sales_record_manual_payment');COMMIT;`;
  const competing=await Promise.all([execute(command(120,5,300)),execute(command(121,5,300))]);assert.equal(competing.filter(r=>r.code===0).length,1);assert(competing.find(r=>r.code!==0).stderr.includes('Invoice version conflict'));
  const replay=await Promise.all([execute(command(122,6,100)),execute(command(122,6,100))]);assert(replay.every(r=>r.code===0));
  assert.equal(run("SELECT count(*) FROM paige_invoice_payments WHERE id='70000000-0000-0000-0000-000000000122';").trim(),'1');
  assert.equal(run("SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FROM paige_invoice_payments WHERE invoice_id='60000000-0000-0000-0000-000000000091';").trim(),'1000');
  const preferenceCommand=op=>`BEGIN;SET LOCAL ROLE service_role;SELECT proof_preferences(${op},3,'{"next_number":30}');COMMIT;`;
  const prefRace=await Promise.all([execute(preferenceCommand(580)),execute(preferenceCommand(581))]);
  assert.equal(prefRace.filter(r=>r.code===0).length,1);assert(prefRace.find(r=>r.code!==0).stderr.includes('Invoice preferences version conflict'));
  const publication=(op,id)=>`BEGIN;SET LOCAL ROLE service_role;SELECT execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',('70000000-0000-0000-0000-'||lpad('${op}',12,'0'))::uuid,'{"action":"invoice.publish","invoice_id":"60000000-0000-0000-0000-${id}","expected_version":1}',proof_governance('invoice.publish','sales_publish_invoice'));COMMIT;`;
  const issued=await Promise.all([execute(publication(582,'000000000504')),execute(publication(583,'000000000505'))]);
  assert(issued.every(r=>r.code===0),JSON.stringify(issued));
  assert.equal(run("SELECT string_agg(invoice_number,',' ORDER BY invoice_number) FROM paige_invoices WHERE id IN ('60000000-0000-0000-0000-000000000504','60000000-0000-0000-0000-000000000505');").trim(),'INV-00030,INV-00031');
  const same=await Promise.all([execute(publication(584,'000000000506')),execute(publication(584,'000000000506'))]);assert(same.every(r=>r.code===0));
  assert.equal(run("SELECT brand#>>'{invoice_preferences,settings,next_number}' FROM tenants WHERE id='20000000-0000-0000-0000-000000000001';").trim(),'33');
  assert.equal(run("SELECT count(*) FROM paige_invoice_operations WHERE id='70000000-0000-0000-0000-000000000584';").trim(),'1');
  const replaySettings=`BEGIN;SET LOCAL ROLE service_role;SELECT proof_preferences(585,7,'{"next_number":50}');COMMIT;`;
  const settingsReplay=await Promise.all([execute(replaySettings),execute(replaySettings)]);assert(settingsReplay.every(r=>r.code===0));assert.equal(settingsReplay[0].stdout,settingsReplay[1].stdout);
  assert.equal(run("SELECT brand#>>'{invoice_preferences,version}' FROM tenants WHERE id='20000000-0000-0000-0000-000000000001';").trim(),'8');
  assert.equal(run("SELECT count(*) FROM paige_invoice_operations WHERE id='70000000-0000-0000-0000-000000000585';").trim(),'1');
  }
 }
 console.log('PASS: governed draft creation, current Trust refusal, immutable replay, canonical readback and atomic Rail rollback; exact-deposit migration replay, role/tenant/replay/version guards and precise issuance; preferences migration replay, roles, numbering, frozen presentation, canonical Rail and '+(draftConcurrency?'real simultaneous draft replay and competing draft CAS':concurrency?'real simultaneous preferences CAS/publication/replay':'serial regression')+'. Hosted authentication/provider proof UNVERIFIED.');
}finally{if(concurrency){database='postgres';run(`DROP DATABASE ${ownedDatabase};`);console.log('Removed only the uniquely owned concurrency database.');}}
