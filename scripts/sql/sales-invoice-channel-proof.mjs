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
CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,contact_id uuid,connector_id uuid,thread_key text,channel_type text,direction text,status text,recipients jsonb,subject text,body_html text,body_text text,meta jsonb,error text,provider_message_id text);
\\ir ../../supabase/migrations/20270543000002_sales_invoice_delivery.sql
\\ir ../../supabase/migrations/20270543000002_sales_invoice_delivery.sql
`;
const channelMigration=read('../../supabase/migrations/20270547000001_sales_invoice_channel_delivery.sql');
const dispatchGuard=read('../../supabase/migrations/20270562000000_sales_invoice_dispatch_version_guard.sql');
const base=read('sales-billing-drafts-proof.sql');
const snapshot=read('sales-invoice-snapshot-proof.sql');
const original=read('sales-invoice-lifecycle-proof.sql');
const prefix=original.slice(0,original.indexOf('CREATE FUNCTION proof_delivery(')).replace('CREATE TEMP TABLE issued_result',`RESET ROLE; UPDATE paige_invoices SET billing_draft=jsonb_set(billing_draft,'{recipient_phone}','"+12025550123"') WHERE id='60000000-0000-0000-0000-000000000091'; SET LOCAL ROLE service_role; CREATE TEMP TABLE issued_result`);
const checks=read('sales-invoice-channel-proof.sql');
run(base.replace('ROLLBACK;',()=>snapshot+'\n'+setup+'\n'+channelMigration+'\n'+channelMigration+'\n'+dispatchGuard+'\n'+dispatchGuard+'\n'+prefix+'\n'+checks+'\nROLLBACK;'));
console.log('PASS: actual isolated channel migration twice, frozen SMS recipient, replay, single admission and unknown fencing. No provider/JWT proof.');
const raceDatabase='sales_channel_race_'+randomUUID().replaceAll('-','');
assert(/^sales_channel_race_[a-f0-9]{32}$/.test(raceDatabase));
run(`CREATE DATABASE ${raceDatabase};`);database=raceDatabase;
try {
 const ready=checks.slice(0,checks.indexOf('SELECT proof_assert(claim_sales'));
 run(base.replace('ROLLBACK;',()=>snapshot+'\n'+setup+'\n'+channelMigration+'\n'+dispatchGuard+'\n'+prefix+'\n'+ready+'\nRESET ROLE; COMMIT;'));
 const attempt=op=>new Promise(resolve=>{const p=spawn(binary,args(),{cwd,stdio:['pipe','pipe','pipe']});let stderr='';p.stderr.on('data',chunk=>stderr+=chunk);p.on('close',code=>resolve({code,stderr}));p.on('error',error=>resolve({code:1,stderr:String(error)}));p.stdin.end(`SET ROLE service_role; SELECT claim_sales_invoice_delivery((read_sales_invoice_delivery_result('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000${op}','{"action":"invoice.sms_send","invoice_id":"60000000-0000-0000-0000-000000000091","expected_version":5,"connector_id":null}') ->>'message_id')::uuid,'70000000-0000-0000-0000-000000000${op}','90000000-0000-0000-0000-000000000${op}',repeat('${op===210?'b':'c'}',64),now()+interval '1 day');`);});
 const race=await Promise.all([attempt(210),attempt(211)]);
 assert.equal(race.filter(r=>r.code===0).length,1,'exactly one distinct approved operation admits '+JSON.stringify(race));
 assert.equal(run("SELECT count(*) FROM messages WHERE meta#>>'{sales_invoice_binding,state}'='dispatching';").trim(),'1');
 console.log('PASS: actual concurrent distinct-operation SMS provider admission has one winner.');

 // Hold an uncommitted claim while another session tries to insert a financial receipt.
 // The marker starts the second session only after the real invoice lock is held.
 run("TRUNCATE messages,paige_invoice_access_grants; DELETE FROM paige_invoice_operations WHERE id IN ('70000000-0000-0000-0000-000000000210','70000000-0000-0000-0000-000000000211'); SET ROLE service_role; SELECT proof_sms(210);");
 const session=(sql,marker)=>{
  let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
  const done=new Promise(resolve=>{const p=spawn(binary,args(),{cwd,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
   p.stdout.on('data',chunk=>{stdout+=chunk;if(marker&&stdout.includes(marker))readyResolve();});p.stderr.on('data',chunk=>stderr+=chunk);
   p.on('close',code=>{readyResolve();resolve({code,stdout,stderr});});p.on('error',error=>{readyResolve();resolve({code:1,stdout,stderr:String(error)});});
   p.stdin.end("SET statement_timeout='5s';\n"+sql);
  });return{ready,done};
 };
 const claimMessage=run("SELECT id FROM messages WHERE meta#>>'{sales_invoice_binding,operation_id}'='70000000-0000-0000-0000-000000000210';").trim();assert(/^[a-f0-9-]{36}$/.test(claimMessage));
 const claimSql=`SET ROLE service_role; BEGIN; SELECT claim_sales_invoice_delivery('${claimMessage}'::uuid,'70000000-0000-0000-0000-000000000210','90000000-0000-0000-0000-000000000212',repeat('d',64),now()+interval '1 day');`;
 const claimant=session(claimSql+"\n\\echo CLAIM_ADMITTED\nSELECT pg_sleep(0.4); COMMIT;",'CLAIM_ADMITTED');await claimant.ready;
 const receipt=session("INSERT INTO paige_invoice_payments(id,invoice_id,tenant_id,actor_user_id,kind,amount_cents,currency,method,received_at) VALUES('70000000-0000-0000-0000-000000000224','60000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','receipt',100,'usd','cash',now());");
 const [claimed,refused]=await Promise.all([claimant.done,receipt.done]);assert.equal(claimed.code,0,claimed.stderr);assert(claimed.stdout.includes('CLAIM_ADMITTED'));assert.notEqual(refused.code,0);assert(refused.stderr.includes('Invoice delivery is in progress'),refused.stderr);
 assert.equal(run("SELECT count(*) FROM paige_invoice_payments WHERE id='70000000-0000-0000-0000-000000000224';").trim(),'0');
 run(`SET ROLE service_role; SELECT finalize_sales_invoice_delivery('${claimMessage}'::uuid,'70000000-0000-0000-0000-000000000210','failed',NULL,NULL);`);
 assert.equal(run(`SET ROLE service_role; SELECT proof_command(225,'{"action":"invoice.record_manual_payment","expected_version":5,"amount_cents":100,"currency":"usd","method":"cash","received_at":"2026-10-04T12:00:00Z"}','sales_record_manual_payment')#>>'{row,remaining_cents}';`).trim().split(/\r?\n/).at(-1),'300');
 console.log('PASS: concurrent receipt waits for invoice claim then refuses; finalization releases the financial write.');

}finally{database='postgres';run(`DROP DATABASE ${raceDatabase};`);}

