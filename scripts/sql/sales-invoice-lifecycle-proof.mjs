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
const assertions=read('sales-invoice-lifecycle-proof.sql');
const concurrency=process.argv[6]==='--concurrency';
const ownedDatabase='sales_lifecycle_race_'+randomUUID().replaceAll('-','');
if(concurrency){assert(/^sales_lifecycle_race_[a-f0-9]{32}$/.test(ownedDatabase));run(`CREATE DATABASE ${ownedDatabase};`);database=ownedDatabase;}
try{
 run(base.replace('ROLLBACK;',()=>snapshot+'\n'+setup+'\n'+assertions+(concurrency?'\nCOMMIT;':'\nROLLBACK;')));
 if(concurrency){
  const execute=sql=>new Promise(resolve=>{const p=spawn(binary,args(),{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',data=>stdout+=data);p.stderr.on('data',data=>stderr+=data);p.on('close',code=>resolve({code,stdout,stderr}));p.on('error',error=>resolve({code:1,stdout,stderr:String(error)}));p.stdin.end(sql);});
  const command=(op,version,amount)=>`BEGIN;SET LOCAL ROLE service_role;SELECT proof_command(${op},'{"action":"invoice.record_manual_payment","expected_version":${version},"amount_cents":${amount},"currency":"usd","method":"cash","received_at":"2026-10-01T12:00:00Z"}','sales_record_manual_payment');COMMIT;`;
  const competing=await Promise.all([execute(command(120,5,300)),execute(command(121,5,300))]);assert.equal(competing.filter(r=>r.code===0).length,1);assert(competing.find(r=>r.code!==0).stderr.includes('Invoice version conflict'));
  const replay=await Promise.all([execute(command(122,6,100)),execute(command(122,6,100))]);assert(replay.every(r=>r.code===0));
  assert.equal(run("SELECT count(*) FROM paige_invoice_payments WHERE id='70000000-0000-0000-0000-000000000122';").trim(),'1');
  assert.equal(run("SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FROM paige_invoice_payments WHERE invoice_id='60000000-0000-0000-0000-000000000091';").trim(),'1000');
 }
 console.log('PASS: isolated lifecycle, sender role/filter, delivery single-claim/unknown and canonical Rail proof'+(concurrency+' simultaneous receipt conservation/replay proof'+'.')+'. Hosted authentication/provider proof UNVERIFIED.');
}finally{if(concurrency){database='postgres';run(`DROP DATABASE ${ownedDatabase};`);console.log('Removed only the uniquely owned concurrency database.');}}
