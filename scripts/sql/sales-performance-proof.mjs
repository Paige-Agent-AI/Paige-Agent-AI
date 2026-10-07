// Synthetic, isolated PostgreSQL proof. No production connection or provider calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [binary,port,user,expectedDirectory]=process.argv.slice(2);
if(!binary||!/^\d+$/.test(port??'')||!user||!expectedDirectory)throw Error('Explicit isolated cluster required');
let database='postgres';
const run=sql=>{const p=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],{input:sql,encoding:'utf8',windowsHide:true,maxBuffer:8e6});if(p.status!==0)throw Error(p.stderr);return p.stdout.trim();};
const normalize=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(run('SHOW data_directory;')),normalize(expectedDirectory),'refuse another cluster');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const extract=(s,n)=>{const start=s.indexOf('CREATE OR REPLACE FUNCTION public.'+n+'('),end=s.indexOf('END $$;',start);assert(start>=0&&end>start,n);return s.slice(start,end+7);};
const migrationPath='supabase/migrations/20270601000002_sales_performance_contract.sql';
let migration=read(migrationPath);
const mutation=process.argv[6]==='--mutation'?process.argv[7]:null;
const mutants={
 mixed_currency:["lower(d.currency)","'usd'"],
 foreign_rows:['WHERE d.tenant_id=p_tenant_id AND','WHERE true AND'],
 void_invoice:["WHEN i.status='void' THEN 'voided_invoice'","WHEN false THEN 'voided_invoice'"],
 reversal:['CASE WHEN kind=\'receipt\' THEN amount_cents ELSE -amount_cents END','amount_cents'],
 widened_role:["m.role IN ('owner','admin')","m.role IN ('owner','admin','member')"],
 stale_revision:["'rows',source_rows","'rows','[]'::jsonb"],
 changed_version:["p_metric_version IS DISTINCT FROM '1.0.0'","p_metric_version NOT IN ('1.0.0','2.0.0')"]
};
if(mutation){assert(mutants[mutation],mutation);assert(migration.includes(mutants[mutation][0]));migration=migration.replaceAll(...mutants[mutation]);}
const db='sales_performance_'+randomUUID().replaceAll('-','');run(`CREATE DATABASE ${db};`);database=db;
const id=(family,n)=>`${family}0000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=id(1,1),otherActor=id(1,2),tenant=id(2,1),foreign=id(2,2),pipeline=id(3,1),foreignPipeline=id(3,2),stage=id(4,1),foreignStage=id(4,2);
const invoice=id(6,1),euroInvoice=id(6,2),importInvoice=id(6,3),draft=id(6,4),voidInvoice=id(6,5),paidInvoice=id(6,6),testInvoice=id(6,7);
const scope=(a=actor,t=tenant)=>`SET test.actor='${a}';SET test.workspace='${t}';`;
const metric=(key,dimensions={},t=tenant,version='1.0.0')=>`SELECT public._sales_performance_metric_bundle('${t}','${key}','${version}','2026-10-01Z','2026-11-01Z','2026-11-03Z','${JSON.stringify(dimensions)}'::jsonb);`;
const json=sql=>JSON.parse(run(sql).split(/\r?\n/).find(x=>x.startsWith('{')));
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const denied=(sql,code='42501')=>{assert.throws(()=>run(sql),e=>e.message.includes(code));checks++;};
const get=(key,dimensions={})=>json(scope()+metric(key,dimensions));
const amount=(b,c='usd')=>b.values.by_currency.find(x=>x.currency===c)?.amount_minor;
try{
run(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;
CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.workspace',true),'')::uuid$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text);
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid,full_name text);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text,role text);
CREATE TABLE public.pipelines(id uuid PRIMARY KEY,tenant_id uuid,updated_at timestamptz DEFAULT now());
CREATE TABLE public.pipeline_stages(id uuid PRIMARY KEY,tenant_id uuid,pipeline_id uuid,updated_at timestamptz DEFAULT now());
CREATE TABLE public.deals(id uuid PRIMARY KEY,tenant_id uuid,pipeline_id uuid,stage_id uuid,owner_user_id uuid,status text,value_cents bigint,currency text,actual_close_date date,created_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,invoice_number text,status text,amount_total_cents integer,currency text,due_date date,
billing_draft_version bigint,billing_draft jsonb,billing_lifecycle_version bigint,billing_issued_snapshot_version bigint,billing_issued_at timestamptz,billing_issued_by uuid,billing_document jsonb,billing_document_digest text,billing_import_provenance jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,evidence_kind text,provider text,provider_environment text,provider_verified_at timestamptz);
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
INSERT INTO auth.users(id) VALUES('${actor}'),('${otherActor}');INSERT INTO tenants VALUES('${tenant}','active'),('${foreign}','active');
INSERT INTO profiles VALUES('${actor}','${tenant}','Fixture owner'),('${otherActor}','${foreign}','Other owner');
INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner'),('${foreign}','${otherActor}','active','owner');
INSERT INTO pipelines VALUES('${pipeline}','${tenant}',now()),('${foreignPipeline}','${foreign}',now());
INSERT INTO pipeline_stages VALUES('${stage}','${tenant}','${pipeline}',now()),('${foreignStage}','${foreign}','${foreignPipeline}',now());
INSERT INTO deals(id,tenant_id,pipeline_id,stage_id,owner_user_id,status,value_cents,currency,actual_close_date,created_at) VALUES
('${id(5,1)}','${tenant}','${pipeline}','${stage}','${actor}','open',100000,'USD',NULL,'2026-10-02Z'),
('${id(5,2)}','${tenant}','${pipeline}','${stage}','${actor}','open',50000,'EUR',NULL,'2026-09-01Z'),
('${id(5,3)}','${tenant}','${pipeline}','${stage}','${actor}','won',200000,'USD','2026-10-15','2026-08-01Z'),
('${id(5,4)}','${tenant}','${pipeline}','${stage}','${actor}','lost',30000,'USD','2026-10-16','2026-10-01Z'),
('${id(5,5)}','${tenant}','${pipeline}','${stage}','${actor}','won',80000,'EUR',NULL,'2026-10-03Z'),
('${id(5,6)}','${tenant}','${pipeline}','${stage}','${actor}','open',0,'USD',NULL,'2026-10-04Z'),
('${id(5,7)}','${tenant}','${foreignPipeline}','${foreignStage}','${actor}','open',900000,'USD',NULL,'2026-10-05Z'),
('${id(5,8)}','${foreign}','${foreignPipeline}','${foreignStage}','${otherActor}','open',999999,'USD',NULL,'2026-10-06Z'),
('${id(5,9)}','${tenant}','${pipeline}','${stage}','${actor}','open',-1,'USD',NULL,'2026-10-07Z'),
('${id(5,10)}','${tenant}','${pipeline}','${stage}','${actor}','open',800,'INVALID',NULL,'2026-10-08Z');
INSERT INTO paige_invoices(id,tenant_id,invoice_number,status,amount_total_cents,currency,due_date,billing_draft_version,billing_lifecycle_version,billing_issued_snapshot_version,billing_issued_at,billing_document,billing_import_provenance) VALUES
('${invoice}','${tenant}','INV-1','issued',350000,'USD','2026-10-20',1,2,1,'2026-10-01Z','{}',NULL),
('${euroInvoice}','${tenant}','INV-2','issued',100000,'EUR','2026-12-01',1,2,1,'2026-10-02Z','{}',NULL),
('${importInvoice}','${tenant}','IMP-1','recorded',50000,'USD',NULL,NULL,NULL,NULL,NULL,NULL,'{}'),
('${draft}','${tenant}','D-1','draft',999999,'USD','2026-09-01',1,1,NULL,NULL,NULL,NULL),
('${voidInvoice}','${tenant}','INV-VOID','void',80000,'USD','2026-09-01',1,3,1,'2026-10-03Z','{}',NULL),
('${paidInvoice}','${tenant}','INV-PAID','issued',20000,'USD','2026-10-01',1,2,1,'2026-09-01Z','{}',NULL),
('${testInvoice}','${tenant}','INV-TEST','issued',30000,'USD','2026-12-01',1,2,1,'2026-10-04Z','{}',NULL),
('${id(6,8)}','${foreign}','FOREIGN','issued',999999,'USD','2026-09-01',1,2,1,'2026-10-01Z','{}',NULL),
('${id(6,9)}','${tenant}','LEGACY','sent',70000,'USD','2026-09-01',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO paige_invoice_payments(id,tenant_id,invoice_id,kind,amount_cents,currency,received_at,created_at,evidence_kind,provider_environment,import_provenance) VALUES
('${id(7,1)}','${tenant}','${invoice}','receipt',40000,'usd','2026-10-05Z','2026-10-05Z','manual_recorded',NULL,NULL),
('${id(7,8)}','${tenant}','${invoice}','receipt',10000,'usd','2026-10-05Z','2026-10-05Z','manual_recorded',NULL,NULL),
('${id(7,2)}','${tenant}','${invoice}','reversal',10000,'usd','2026-10-05Z','2026-11-02Z','manual_recorded',NULL,NULL),
('${id(7,3)}','${tenant}','${invoice}','receipt',100000,'usd','2026-10-06Z','2026-10-06Z','provider_verified','live',NULL),
('${id(7,4)}','${tenant}','${importInvoice}','receipt',10000,'usd','2026-10-07Z','2026-10-07Z','manual_recorded',NULL,'{}'),
('${id(7,5)}','${tenant}','${paidInvoice}','receipt',20000,'usd','2026-09-01Z','2026-09-01Z','manual_recorded',NULL,NULL),
('${id(7,6)}','${tenant}','${testInvoice}','receipt',10000,'usd','2026-10-08Z','2026-10-08Z','provider_verified','test',NULL),
('${id(7,7)}','${foreign}','${id(6,8)}','receipt',999999,'usd','2026-10-09Z','2026-10-09Z','provider_verified','live',NULL);
UPDATE paige_invoice_payments SET reverses_payment_id='${id(7,8)}' WHERE id='${id(7,2)}';
UPDATE paige_invoice_payments SET provider='stripe',provider_verified_at=received_at WHERE evidence_kind='provider_verified';
UPDATE paige_invoices SET billing_document_digest=repeat('a',64),billing_issued_by='${actor}' WHERE billing_issued_at IS NOT NULL;
ALTER TABLE paige_invoices ADD billing_import_version bigint;
ALTER TABLE paige_invoice_payments ADD reference text,ADD notes text,ADD reason text;
CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,entity_name text,entity_type text,first_name text,last_name text);
INSERT INTO clients VALUES('${id(8,1)}','${tenant}','Fixture business','business',NULL,NULL),('${id(8,2)}','${foreign}','Other business','business',NULL,NULL);
UPDATE paige_invoices SET contact_id=CASE WHEN tenant_id='${tenant}' THEN '${id(8,1)}'::uuid ELSE '${id(8,2)}'::uuid END;
CREATE TABLE paige_invoice_provider_operations(id uuid,tenant_id uuid,invoice_id uuid,amount_cents bigint,state text);
INSERT INTO paige_invoice_provider_operations VALUES(gen_random_uuid(),'${tenant}','${invoice}',999999,'customer_action_required');`);
const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
run(extract(lifecycle,'_sales_invoice_read').replace('public._sales_invoice_read(','public._sales_invoice_read_before_provider('));
run(extract(read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql'),'_sales_invoice_read'));
run(extract(lifecycle,'_sales_invoice_actor'));
const collections=read('supabase/migrations/20270547000000_sales_collections.sql');
const nameStart=collections.indexOf('CREATE OR REPLACE FUNCTION public._sales_collection_client_name(');
run(collections.slice(nameStart,collections.indexOf('$$;',nameStart)+3));
run(collections.slice(collections.indexOf('CREATE TABLE IF NOT EXISTS public.paige_sales_export_snapshots('),collections.indexOf('CREATE OR REPLACE FUNCTION public.list_sales_collection_register(')));
run(extract(collections,'list_sales_collection_register').replace('public.list_sales_collection_register(','public._list_sales_collection_register_before_provider('));
run(extract(read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql'),'list_sales_collection_register'));
run('REVOKE ALL ON FUNCTION list_sales_collection_register(uuid,text,integer,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION list_sales_collection_register(uuid,text,integer,jsonb) TO authenticated;');
const register=(entity='invoice',limit=50,cursor=null,a=actor,t=tenant)=>json(scope(a,t)+`SET ROLE authenticated;SELECT list_sales_collection_register('${t}','${entity}',${limit},${cursor?"'"+JSON.stringify(cursor)+"'::jsonb":'NULL'});`);
const baselineInvoices=register().rows,baselineReceipts=register('receipt').rows;
const baselineDocument=json(scope()+`SELECT _sales_invoice_read('${tenant}','${invoice}',50);`);
denied(scope()+metric('sales.opportunities.created'),'42883');
run(migration);run(migration); // New migration is deterministic/replayable.
eq(register().rows,baselineInvoices);eq(register('receipt').rows,baselineReceipts);
eq(json(scope()+`SELECT _sales_invoice_read('${tenant}','${invoice}',50);`),baselineDocument);
const firstPage=register('invoice',2);const nextPage=register('invoice',2,firstPage.next_cursor);eq(nextPage.rows.length,2);assert(firstPage.rows.every(x=>!nextPage.rows.some(y=>y.id===x.id)));checks++;
denied(scope(otherActor,foreign)+`SET ROLE authenticated;SELECT list_sales_collection_register('${tenant}','invoice',2,'${JSON.stringify(firstPage.next_cursor)}');`);
run(`UPDATE paige_sales_export_snapshots SET expires_at=now()-interval '1 second' WHERE id='${firstPage.next_cursor.snapshot_id}';`);
denied(scope()+`SET ROLE authenticated;SELECT list_sales_collection_register('${tenant}','invoice',2,'${JSON.stringify(firstPage.next_cursor)}');`);
eq(get('sales.opportunities.created').values.count,7);
eq(get('sales.opportunities.open_current').values.count,6);
eq(get('sales.opportunities.won_current_close_date').values.count,1);
eq(get('sales.opportunities.won_current_close_date').coverage.excluded_count,1);
eq(get('sales.opportunities.lost_current_close_date').values.count,1);
const pipelineResult=get('sales.pipeline.open_value');eq(amount(pipelineResult),'100000');eq(amount(pipelineResult,'eur'),'50000');eq(pipelineResult.coverage.excluded_count,3);eq(pipelineResult.truth_state,'PARTIAL');
const issued=get('sales.invoices.issued_amount');eq(amount(issued),'380000');eq(amount(issued,'eur'),'100000');eq(get('sales.invoices.issued_count').values.count,3);
eq(issued.exclusions.find(x=>x.reason==='voided_invoice')?.count,1);
const outstanding=get('sales.receivables.outstanding_current');eq(amount(outstanding),'270000');eq(amount(outstanding,'eur'),'100000');
eq(outstanding.coverage.owner_imported_count,1);eq(outstanding.coverage.test_affected_obligation_count,1);eq(outstanding.range.semantics,'current_snapshot');
const collectible=register().rows.filter(x=>['issued','recorded'].includes(x.status));
eq(String(collectible.filter(x=>x.currency==='usd').reduce((n,x)=>n+x.remaining_cents,0)),amount(outstanding));
eq(String(collectible.filter(x=>x.currency==='eur').reduce((n,x)=>n+x.remaining_cents,0)),amount(outstanding,'eur'));
eq(amount(get('sales.receivables.overdue_current')),'210000');
const cash=get('sales.cash.recorded_received');eq(amount(cash),'150000');eq(cash.values.breakdown.find(x=>x.source==='provider_verified_live').amount_minor,'100000');eq(cash.values.breakdown.find(x=>x.source==='owner_imported_unverified').amount_minor,'10000');
eq(cash.exclusions.find(x=>x.reason==='test_payment')?.count,1);
eq(amount(get('sales.payments.posted_net_allocations')),'160000');
eq(json(scope(otherActor,foreign)+metric('sales.opportunities.created',{},foreign)).values.count,1);
denied(scope()+metric('sales.opportunities.created',{},foreign));
denied(scope()+metric('sales.pipeline.open_value',{pipeline_id:foreignPipeline}));
denied(scope()+metric('sales.pipeline.open_value',{stage_id:foreignStage}));
denied(scope()+metric('sales.pipeline.open_value',{invoice_id:id(6,8)}),'22023');
denied(scope()+metric('sales.pipeline.open_value',{provider:'stripe'}),'22023');
denied(scope()+metric('sales.pipeline.open_value',{pipeline_id:null}),'22023');
denied(scope()+metric('sales.cash.recorded_received',{pipeline_id:pipeline}),'22023');
denied(scope()+metric('sales.opportunities.created',{},tenant,'2.0.0'),'22023');
denied(scope()+metric('sales.close_rate'),'22023');
denied(scope()+"SELECT _sales_performance_metric_bundle('"+tenant+"','sales.opportunities.created','1.0.0','2026-11-01Z','2026-10-01Z','2026-11-01Z','{}');",'22023');
denied("SET test.actor='';"+metric('sales.opportunities.created'));
run(`UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`);denied(scope()+metric('sales.cash.recorded_received'));run(`UPDATE tenant_members SET role='owner' WHERE user_id='${actor}';`);
run(`UPDATE profiles SET active_tenant_id='${foreign}' WHERE user_id='${actor}';`);denied(scope()+metric('sales.opportunities.created'));run(`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
run(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actor}';`);denied(scope()+metric('sales.opportunities.created'));run(`UPDATE auth.users SET banned_until=NULL WHERE id='${actor}';`);
run(`UPDATE tenant_members SET status='inactive' WHERE user_id='${actor}';`);denied(scope()+metric('sales.opportunities.created'));run(`UPDATE tenant_members SET status='active' WHERE user_id='${actor}';`);
run(`UPDATE tenants SET status='cancelled' WHERE id='${tenant}';`);denied(scope()+metric('sales.opportunities.created'));run(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);
run(`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}';`);denied(scope()+metric('sales.opportunities.created'));run(`UPDATE auth.users SET deleted_at=NULL WHERE id='${actor}';`);
for(const role of ['anon','authenticated','service_role'])denied(scope()+`SET ROLE ${role};`+metric('sales.opportunities.created'));
// Exact digest changes despite unchanged count and unchanged maximum updated_at.
const before=get('sales.pipeline.open_value');run(`UPDATE deals SET value_cents=value_cents+1 WHERE id='${id(5,1)}';`);const after=get('sales.pipeline.open_value');assert.notEqual(before.source_revision_ref,after.source_revision_ref);checks++;eq(amount(after),'100001');run(`UPDATE deals SET value_cents=value_cents-1 WHERE id='${id(5,1)}';`);
eq(get('sales.pipeline.open_value').source_revision_ref,before.source_revision_ref);
// Source mutations are visible even without updated_at changes; no stale values.
const cashBefore=get('sales.cash.recorded_received');run(`UPDATE paige_invoice_payments SET amount_cents=amount_cents+1 WHERE id='${id(7,1)}';`);assert.notEqual(get('sales.cash.recorded_received').source_revision_ref,cashBefore.source_revision_ref);checks++;eq(amount(get('sales.cash.recorded_received')),'150001');run(`UPDATE paige_invoice_payments SET amount_cents=amount_cents-1 WHERE id='${id(7,1)}';`);
run(`INSERT INTO paige_invoice_payments(id,tenant_id,invoice_id,kind,amount_cents,currency,received_at,evidence_kind) VALUES('${id(7,9)}','${tenant}','${id(6,8)}','receipt',777777,'usd','2026-10-01Z','manual_recorded');`);
eq(amount(get('sales.cash.recorded_received')),'150000');eq(get('sales.cash.recorded_received').exclusions.find(x=>x.reason==='invalid_invoice_relationship')?.count,1);run(`DELETE FROM paige_invoice_payments WHERE id='${id(7,9)}';`);
eq(run(`SELECT count(*) FROM _sales_invoice_balance_rows('${tenant}','${invoice}');`),'1');
eq(run(`SELECT count(*) FROM _sales_invoice_balance_rows('${tenant}','${id(6,8)}');`),'0');
eq(get('sales.pipeline.open_value',{pipeline_id:pipeline}).values.by_currency.find(x=>x.currency==='usd').amount_minor,'100000');
eq(get('sales.opportunities.created',{stage_id:stage}).values.count,6);
const readBalance=i=>json(scope()+`SELECT _sales_invoice_read('${tenant}','${i}',0);`);
eq(readBalance(invoice).remaining_cents,210000);eq(readBalance(paidInvoice).remaining_cents,0);eq(readBalance(testInvoice).remaining_cents,20000);
assert(!JSON.stringify(cash).includes('Fixture owner'));checks++;
eq(cash.evidence_ref,null);eq(cash.evidence_state,'shared_issuance_required');
const schema=run("SELECT string_agg(p.proname||':'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,''),E'\\n' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '_sales_performance%';");
const report={checks,postgres:run('SHOW server_version;'),migration:migrationPath,migration_sha256:createHash('sha256').update(migration).digest('hex'),schema_fingerprint:createHash('sha256').update(schema).digest('hex'),evidence:'synthetic isolated PostgreSQL; shared issuer/runtime not proven',production:false};
mkdirSync(new URL('../../work/',import.meta.url),{recursive:true});writeFileSync(new URL('../../work/sales-performance-proof.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{database='postgres';run(`DROP DATABASE ${db} WITH (FORCE);`);}
