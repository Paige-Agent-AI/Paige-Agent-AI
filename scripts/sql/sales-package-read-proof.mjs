// Disposable localhost PostgreSQL proof. Real actor, balance, terms and Rail bodies.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const [binary,port,user,expectedDirectory]=process.argv.slice(2);
if(!binary||!/^\d+$/.test(port??'')||!user||!expectedDirectory)throw Error('Explicit isolated cluster required');
let database='postgres';
const run=sql=>{const p=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],{input:sql,encoding:'utf8',windowsHide:true,maxBuffer:4e6});if(p.status!==0)throw Error(p.stderr);return p.stdout.trim();};
const norm=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(norm(run('SHOW data_directory;')),norm(expectedDirectory),'refuse another cluster');
const db='sales_package_'+randomUUID().replaceAll('-','');run(`CREATE DATABASE ${db};`);database=db;
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=source.indexOf('END $$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+7);};
const actor='10000000-0000-0000-0000-000000000001',otherActor='10000000-0000-0000-0000-000000000002';
const tenant='20000000-0000-0000-0000-000000000001',foreign='20000000-0000-0000-0000-000000000002';
const client='30000000-0000-0000-0000-000000000001',otherClient='30000000-0000-0000-0000-000000000002';
const terms='40000000-0000-0000-0000-000000000001',offer='50000000-0000-0000-0000-000000000001';
const invoice='60000000-0000-0000-0000-000000000001',agreement='70000000-0000-0000-0000-000000000001';
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const rows=[{due_date:'2026-10-15',amount_cents:50000,label:'Deposit'},...Array.from({length:10},(_,i)=>({due_date:`${2026+Math.floor((10+i)/12)}-${String((10+i)%12+1).padStart(2,'0')}-01`,amount_cents:30000,label:`Installment ${i+1}`}))];
const schedule={schema_version:1,kind:'custom',currency:'usd',total_cents:350000,anchor_date:rows[0].due_date,cadence:'custom',count:11,end_date:null,dates:rows,deposit_cents:null,late_fee:{fixed_cents:0,rate_bps:0,grace_days:0,agreement_basis:null},interest:{annual_bps:0,agreement_basis:null}};
const draft={schema_version:3,client_id:client,total_minor:350000,due_now_minor:50000,remainder_minor:300000,agreement_id:agreement,delivery_channel_intents:['email'],items:[{quantity:1,catalog_facts:{product_id:offer,price_id:'80000000-0000-0000-0000-000000000001',unit_minor:350000,currency:'usd'}}]};
const scope=`SET test.actor='${actor}';SET test.workspace='${tenant}';SET ROLE authenticated;`;
const call=(t=tenant,i=invoice)=>`SELECT read_sales_commercial_package('${t}','${i}');`;
let checks=0;
const denied=(sql,code='42501')=>{assert.throws(()=>run(sql),e=>e.message.includes(code));checks++;};
try {
 run(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.workspace',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE tenants(id uuid PRIMARY KEY,status text);CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid,full_name text);
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text);CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE tenant_products(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,invoice_number text,status text,amount_total_cents integer,currency text,
 billing_draft_version bigint,billing_draft jsonb,billing_lifecycle_version bigint,billing_issued_snapshot_version bigint,billing_issued_at timestamptz,billing_issued_by uuid,billing_document jsonb,billing_document_digest text,due_date date);
 CREATE TABLE paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,evidence_kind text,provider text,provider_verified_at timestamptz);
 CREATE TABLE paige_agreements(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,offer_id uuid,commercial_terms_id uuid,version integer,status text,body_source text,content_sha256 text,content_storage_key text,sealed_sha256 text,sealed_storage_key text,expires_at timestamptz);
 CREATE TABLE tenant_client_agreements(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,offer_id uuid,status text,agreed_amount_minor bigint,agreed_currency text,collection_terms jsonb,collection_terms_version bigint,updated_at timestamptz DEFAULT now());
 CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 INSERT INTO auth.users(id) VALUES('${actor}'),('${otherActor}');INSERT INTO tenants VALUES('${tenant}','active'),('${foreign}','active');
 INSERT INTO profiles VALUES('${actor}','${tenant}','Fixture owner'),('${otherActor}','${foreign}','Other owner');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner'),('${foreign}','${otherActor}','active','owner');
 INSERT INTO clients VALUES('${client}','${tenant}'),('${otherClient}','${foreign}');INSERT INTO tenant_products VALUES('${offer}','${tenant}');
 INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,billing_draft_version,billing_draft,billing_lifecycle_version,billing_issued_snapshot_version,due_date)
 VALUES('${invoice}','${tenant}','${client}','INV-1','issued',350000,'USD',1,${literal(draft)},2,1,'2026-10-15');
 INSERT INTO paige_invoice_payments(id,tenant_id,invoice_id,kind,amount_cents,currency,method,evidence_kind,provider,provider_verified_at)
 VALUES(gen_random_uuid(),'${tenant}','${invoice}','receipt',50000,'usd','stripe','provider_verified','stripe',now());
 INSERT INTO paige_agreements VALUES('${agreement}','${tenant}','${client}','${offer}','${terms}',2,'completed','tenant_upload',repeat('a',64),'private-secret-marker',repeat('b',64),'private-secret-marker',now()-interval '1 day');
 INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,status,agreed_amount_minor,agreed_currency,collection_terms,collection_terms_version)
 VALUES('${terms}','${tenant}','${client}','${offer}','active',350000,'usd',${literal(schedule)},3);`);
 const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 run(extract(lifecycle,'_sales_invoice_actor')+extract(lifecycle,'_sales_invoice_read').replace('public._sales_invoice_read(','public._sales_invoice_read_before_provider('));
 run(extract(read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql'),'_sales_invoice_read'));
 run(extract(read('supabase/migrations/20270547000000_sales_collections.sql'),'_sales_collection_validate_terms'));
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 run(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 denied(scope+call(),'42883'); // The callable package contract is absent before this migration.
 const migration=read('supabase/migrations/20270598000001_sales_commercial_package_read.sql');run(migration);run(migration);
 const get=(prefix='')=>JSON.parse(run(prefix+scope+call()).split(/\r?\n/).find(x=>x.startsWith('{')));
 const result=get();assert.equal(result.invoice.outstanding_minor,300000);assert.equal(result.invoice.allocated_minor,50000);checks+=2;
 assert.equal(result.invoice.obligation_total_minor,350000);assert.equal(result.invoice.due_now_minor,50000);assert.equal(result.invoice.remaining_scheduled_minor,300000);checks+=3;
 assert.equal(result.agreement.id,agreement);assert.equal(result.commercial_terms.id,terms);assert.notEqual(agreement,terms);checks+=3;
 assert.deepEqual(result.commercial_terms.schedule.dates,rows.map(({due_date,amount_cents})=>({due_date,amount_cents})));checks++;
 assert.deepEqual(result.missing_fields,['tax_and_fee_treatment','signed_terms_compatibility']);assert.deepEqual(result.conflicts,[]);checks+=2;
 assert.equal(result.authority,'not_evaluated');assert.equal(result.execution,'not_started');assert.equal(result.agreement.treatment,'include_existing_signed_document');checks+=3;
 assert(!JSON.stringify(result).includes('private-secret-marker'));assert(!JSON.stringify(result).includes('content_storage_key'));checks+=2;
 const reload=get();assert.deepEqual(reload.invoice,result.invoice);assert.deepEqual(reload.commercial_terms,result.commercial_terms);assert.notEqual(reload.receipt_id,result.receipt_id);checks+=3;
 assert.equal(result.invoice.provider_verified_minor,50000);assert.equal(result.invoice.manual_recorded_minor,0);checks+=2;
 const otherInvoice=randomUUID(),otherDraft={...draft,client_id:otherClient,agreement_id:null,items:[]};
 run(`INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,billing_draft_version,billing_draft)
 VALUES('${otherInvoice}','${foreign}','${otherClient}','INV-1','draft',350000,'USD',1,${literal(otherDraft)});`);
 const second=JSON.parse(run(`SET test.actor='${otherActor}';SET test.workspace='${foreign}';SET ROLE authenticated;`+call(foreign,otherInvoice)).split(/\r?\n/).find(x=>x.startsWith('{')));
 assert.equal(second.tenant_id,foreign);assert.equal(second.invoice.client_id,otherClient);assert.equal(second.invoice.outstanding_minor,350000);checks+=3;
 denied(scope+call(foreign));denied(scope+call(tenant,randomUUID()));denied(`SET ROLE anon;`+call());denied(`SET ROLE service_role;`+call());
 denied(`SET test.actor='${otherActor}';SET test.workspace='${tenant}';SET ROLE authenticated;`+call());
 denied(`BEGIN;UPDATE profiles SET active_tenant_id='${foreign}' WHERE user_id='${actor}';`+scope+call());
 for(const change of [`UPDATE paige_agreements SET tenant_id='${foreign}';`,`UPDATE paige_agreements SET contact_id='${otherClient}';`,`UPDATE tenant_client_agreements SET tenant_id='${foreign}';`,`UPDATE tenant_products SET tenant_id='${foreign}';`])denied('BEGIN;'+change+scope+call()+'ROLLBACK;');
 let changed=get(`BEGIN;UPDATE tenant_client_agreements SET agreed_amount_minor=350001;`);assert(changed.conflicts.includes('invoice_terms_conflict'));assert(changed.conflicts.includes('recorded_terms_stale'));checks+=2;
 // Each psql process closes its unfinished transaction and rolls back the fixture change.
 changed=get(`BEGIN;UPDATE paige_agreements SET status='draft',expires_at=NULL;`);assert(changed.missing_fields.includes('signature_before_collection_policy'));assert.equal(changed.agreement.treatment,'unsigned_canonical_agreement');checks+=2;
 changed=get(`BEGIN;UPDATE paige_agreements SET commercial_terms_id=NULL;`);assert(changed.missing_fields.includes('commercial_terms'));assert.equal(changed.commercial_terms,null);checks+=2;
 changed=get(`BEGIN;UPDATE paige_invoices SET billing_draft=jsonb_set(billing_draft,'{delivery_channel_intents}','null');`);assert(changed.missing_fields.includes('delivery_channel'));checks++;
 const before=Number(run('SELECT count(*) FROM paige_workspace_events;'));
 denied(`BEGIN;ALTER TABLE paige_workspace_events ADD CONSTRAINT proof_receipt_failure CHECK(false) NOT VALID;`+scope+call(),'23514');
 assert.equal(Number(run('SELECT count(*) FROM paige_workspace_events;')),before);assert.equal(run('SELECT count(*) FROM paige_invoice_payments;'),'1');checks+=2;
 console.log(`PASS ${checks} real PostgreSQL package checks: canonical bridge, arithmetic/source facts, provider balance, owner/tenant isolation, missing/conflict truth, reload, redaction and Rail rollback. Authenticated application acceptance remains UNVERIFIED.`);
}finally{database='postgres';run(`DROP DATABASE ${db} WITH (FORCE);`);}
