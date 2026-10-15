// Local disposable PostgreSQL only. Real tracked actor/governance/Rail function bodies are used.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const [binary,port,expectedDirectory,user='collections_proof']=process.argv.slice(2);
if(!binary||port!=='56347'||!expectedDirectory)throw Error('Explicit isolated cluster arguments required');
let database='postgres';
const args=()=>['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'];
const run=sql=>{const result=spawnSync(binary,args(),{cwd:root,input:sql,encoding:'utf8',maxBuffer:16*1024*1024});if(result.status!==0)throw Error(result.stderr);return result.stdout;};
const norm=value=>value.trim().replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(norm(run('SHOW data_directory;')),norm(expectedDirectory),'refuse other clusters');
database='collections_'+randomUUID().replaceAll('-','');
const create=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-c',`CREATE DATABASE ${database};`],{encoding:'utf8'});assert.equal(create.status,0,create.stderr);
const read=path=>readFileSync(root+path,'utf8');
const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert(start>=0,name);const end=source.indexOf('END $$;',start);assert(end>start,name);return source.slice(start,end+7);};
const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql');
const rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
const setup=`
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE tenants(id uuid PRIMARY KEY,status text DEFAULT 'active',name text,business_name text);
CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid,full_name text);
CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,first_name text,last_name text,entity_name text,entity_type text);
CREATE TABLE deals(id uuid PRIMARY KEY);
CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text DEFAULT 'active',role text DEFAULT 'owner');
CREATE TABLE tenant_products(id uuid PRIMARY KEY,tenant_id uuid,name text,status text);
CREATE TABLE tenant_prices(id uuid PRIMARY KEY,tenant_id uuid,product_id uuid,currency text,unit_amount integer,billing_interval text,interval_count integer,active boolean);
CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.workspace',true),'')::uuid $$;
CREATE FUNCTION is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1=current_user_tenant_id() AND current_setting('test.admin',true)='true' $$;
${read('supabase/migrations/20260629204156_de73719f-ec4d-4fbe-a0f4-5855a64c1562.sql')}
${read('supabase/migrations/20270535000001_sales_billing_drafts.sql')}
CREATE TABLE tenant_client_agreements(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),contact_id uuid NOT NULL REFERENCES clients(id),offer_id uuid,title text,status text DEFAULT 'active',agreed_amount_minor bigint,agreed_currency text);
CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);
CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
${extract(rail20,'_workspace_event_display')}
${extract(rail12,'_record_workspace_rail_event')}
${extract(rail20,'record_capability_run')}
${read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql')}
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
INSERT INTO auth.users(id) VALUES('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO tenants(id) VALUES('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
INSERT INTO profiles(user_id,active_tenant_id) VALUES('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
INSERT INTO tenant_members(tenant_id,user_id) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO clients(id,tenant_id) VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,agreed_amount_minor,agreed_currency) VALUES('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1000,'usd');
CREATE FUNCTION proof_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Proof failed: %',label;END IF;END $$;
CREATE FUNCTION proof_denied(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF SQLSTATE=expected THEN RETURN;END IF;RAISE EXCEPTION 'Wrong refusal % [%] %',label,SQLSTATE,SQLERRM;END;RAISE EXCEPTION 'Missing refusal %',label;END $$;
GRANT EXECUTE ON FUNCTION proof_assert(boolean,text),proof_denied(text,text,text) TO authenticated,anon,service_role;
CREATE FUNCTION proof_governance(action text,tool text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('actor_user_id','10000000-0000-0000-0000-000000000001','tenant_id','20000000-0000-0000-0000-000000000001','action',action,'tool',tool,'approval_channel','operator_card','decision_receipt_recorded',true,'approved_fingerprint','abcdef0123456789') $$;
GRANT EXECUTE ON FUNCTION proof_governance(text,text) TO service_role;
CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz,PRIMARY KEY(tenant_id,tool_key));
CREATE FUNCTION is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION list_tool_autonomy(_tenant_id uuid DEFAULT NULL) RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF auth.uid() IS NULL OR _tenant_id IS DISTINCT FROM current_user_tenant_id() OR NOT EXISTS(SELECT 1 FROM tenant_members WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND role IN ('owner','admin') AND status='active') THEN RAISE EXCEPTION 'Fixture canonical scope guard' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT 'studio_existing'::text,'Existing Studio action'::text,'Studio'::text,'auto'::text,false,'2026-10-01T00:00:00Z'::timestamptz;
END $$;
REVOKE ALL ON FUNCTION list_tool_autonomy(uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION list_tool_autonomy(uuid) TO authenticated,service_role;
SET test.actor='10000000-0000-0000-0000-000000000001';SET test.workspace='20000000-0000-0000-0000-000000000001';SET test.admin='true';
`;
try {
  run(setup);
  // Failing first: the real contract is absent on the canonical pre-change schema.
  assert.throws(()=>run("SELECT list_sales_collection_register('20000000-0000-0000-0000-000000000001');"),/does not exist/);
  const migration=read('supabase/migrations/20270547000000_sales_collections.sql');run(migration);run(migration);
  const catalogue=read('supabase/migrations/20270547000002_sales_collection_autonomy_catalogue.sql');run(catalogue);run(catalogue);
  const contextRead=read('supabase/migrations/20270585000000_sales_collection_read_context.sql');run(contextRead);run(contextRead);
  const output=run(read('scripts/sql/sales-collections-proof.sql'))+run(read('scripts/sql/sales-collection-context-proof.sql'));
  const actor='10000000-0000-0000-0000-000000000001',tenant='20000000-0000-0000-0000-000000000001';
  const stageId=randomUUID(),commitId=randomUUID();
  const rows=[{entity:'invoice',entity_id:'concurrent-i',client_id:'30000000-0000-0000-0000-000000000001',invoice_id:null,invoice_number:'CONCURRENT',currency:'usd',amount_cents:1000,due_date:null,memo:null},{entity:'receipt',entity_id:'concurrent-r',invoice_entity_id:'concurrent-i',invoice_id:null,payment_id:null,currency:'usd',amount_cents:400,method:'cash',received_at:'2026-10-01T12:00:00.000Z',reference:null}];
  const stage={action:'collection.stage_import',source_account:'concurrency-fixture',rows};
  const tools={'collection.stage_import':'sales_stage_collection_import','collection.commit_import':'sales_commit_collection_import','collection.record_receipt':'sales_record_manual_payment','collection.reverse_receipt':'sales_reverse_manual_payment'};
  const execute=(id,command)=>`execute_sales_collection_command('${actor}','${tenant}','${id}','${JSON.stringify(command)}'::jsonb,proof_governance('${command.action}','${tools[command.action]}'))`;
  const stageOutput=run(`SET ROLE service_role;SELECT ${execute(stageId,stage)};`);
  const stageResult=JSON.parse(stageOutput.split(/\r?\n/).find(line=>line.startsWith('{')));
  const commit={action:'collection.commit_import',batch_id:stageId,expected_digest:stageResult.batch.content_digest};
  const concurrent=sql=>new Promise((resolve,reject)=>{const child=spawn(binary,args(),{cwd:root,windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));child.stdin.end(sql);});
  const commits=await Promise.all([concurrent(`BEGIN;SET ROLE service_role;SELECT ${execute(commitId,commit)};SELECT pg_sleep(0.2);COMMIT;`),concurrent(`BEGIN;SET ROLE service_role;SELECT ${execute(commitId,commit)};COMMIT;`)]);
  const results=commits.map(stdout=>JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('{'))));
  assert.deepEqual(results[0],results[1],'concurrent exact operation returns same canonical result');
  assert.equal(run('SELECT count(*) FROM paige_invoices;').trim(),'1');
  assert.equal(run('SELECT count(*) FROM paige_invoice_payments;').trim(),'1');
  assert.equal(run('SELECT count(*) FROM paige_sales_import_bindings;').trim(),'2');
  assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'2');
  const invoiceId=run('SELECT id FROM paige_invoices;').trim();
  const record={action:'collection.record_receipt',invoice_id:invoiceId,expected_version:1,amount_cents:400,currency:'usd',method:'wire',received_at:'2026-10-01T12:00:00.000Z',reference:null,notes:null};
  const recordRace=await Promise.allSettled([concurrent(`SET ROLE service_role;SELECT ${execute(randomUUID(),record)};`),concurrent(`SET ROLE service_role;SELECT ${execute(randomUUID(),record)};`)]);
  assert.equal(recordRace.filter(r=>r.status==='fulfilled').length,1,'one version CAS wins concurrent receipts');
  assert.equal(recordRace.filter(r=>r.status==='rejected').length,1,'stale competing receipt refuses');
  const accepted=JSON.parse(recordRace.find(r=>r.status==='fulfilled').value.split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(accepted.row.remaining_cents,200);assert.equal(accepted.row.version,2);
  const reverse={action:'collection.reverse_receipt',invoice_id:invoiceId,expected_version:2,payment_id:accepted.operation.id,reason:'Concurrent correction fixture'};
  const reverseRace=await Promise.allSettled([concurrent(`SET ROLE service_role;SELECT ${execute(randomUUID(),reverse)};`),concurrent(`SET ROLE service_role;SELECT ${execute(randomUUID(),reverse)};`)]);
  assert.equal(reverseRace.filter(r=>r.status==='fulfilled').length,1,'one full reversal wins race');
  assert.equal(reverseRace.filter(r=>r.status==='rejected').length,1,'stale/repeated competing reversal refuses');
  assert.equal(run("SELECT count(*) FROM paige_invoice_payments WHERE kind='reversal';").trim(),'1');
  assert.equal(run('SELECT billing_import_version FROM paige_invoices;').trim(),'3');
  assert.equal(run("SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FROM paige_invoice_payments;").trim(),'400');
  assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'4');
  const appendRows=[{entity:'receipt',entity_id:'later-receipt',invoice_entity_id:null,invoice_id:invoiceId,payment_id:null,currency:'usd',amount_cents:100,method:'cash',received_at:'2026-10-02T12:00:00.000Z',reference:'later-import'}];
  const appendStageId=randomUUID();
  const appendStage=JSON.parse(run(`SET ROLE service_role;SELECT ${execute(appendStageId,{action:'collection.stage_import',source_account:'later-import',rows:appendRows})};`).split(/\r?\n/).find(line=>line.startsWith('{')));
  // A new unrelated invoice is held locked while a bounded import touches only invoiceId.
  const unrelated=randomUUID();
  run(`INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,line_items,created_by,billing_import_version,billing_import_provenance) SELECT '${unrelated}',tenant_id,contact_id,'CSV-${unrelated}','recorded',1000,'usd','[]',created_by,1,billing_import_provenance FROM paige_invoices WHERE id='${invoiceId}';`);
  let signal;
  const ready=new Promise(resolve=>{signal=resolve;});
  const holder=spawn(binary,args(),{cwd:root,windowsHide:true});
  let holderError='';holder.stderr.on('data',chunk=>holderError+=chunk);
  holder.stdout.on('data',chunk=>{if(String(chunk).includes('LOCK_READY'))signal();});
  const holderDone=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',code=>code===0?resolve():reject(Error(holderError)));});
  holder.stdin.write(`BEGIN;SELECT id FROM paige_invoices WHERE id='${unrelated}' FOR UPDATE;SELECT 'LOCK_READY';\n`);
  await ready;
  try {
    await concurrent(`SET statement_timeout='1500ms';SET ROLE service_role;SELECT ${execute(randomUUID(),{action:'collection.commit_import',batch_id:appendStageId,expected_digest:appendStage.batch.content_digest})};`);
  } finally {holder.stdin.end('ROLLBACK;\n');await holderDone;}
  assert.equal(run(`SELECT billing_import_version FROM paige_invoices WHERE id='${invoiceId}';`).trim(),'4','later historical receipt import advances canonical receipt CAS');
  const stale=await Promise.allSettled([concurrent(`SET ROLE service_role;SELECT ${execute(randomUUID(),{...record,expected_version:3,amount_cents:1})};`)]);
  assert.equal(stale[0].status,'rejected','form opened before later import cannot write stale receipt');
  const summary='PASS bounded invoice locks: unrelated locked invoice does not block import; later imported receipt advances version and refuses stale form.\nPASS concurrent identical commit: one invoice, one receipt, two bindings, exact replay result, one stage + one commit Rail.\nPASS competing receipt CAS and full reversal race: one winner each, exact balance/version, original retained, one Rail per winner.\n';
  writeFileSync(root+'supabase/functions/_shared/sales-collections/sql-proof-result.txt',`Local PostgreSQL 16 proof, ${new Date().toISOString()}\nDatabase ${database} loopback ${port}\nMigration applied twice. Real tracked actor/governance/Rail; auth.uid/current workspace fixtures. Hosted JWT UNVERIFIED.\n${output}${summary}`);
  process.stdout.write(output+summary);
} finally {
  const drop=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','-c',`DROP DATABASE ${database} WITH (FORCE);`],{encoding:'utf8'});
  assert.equal(drop.status,0,drop.stderr);
}
