// Disposable localhost PostgreSQL proof. Real actor, balance, terms and Rail bodies.
import {readFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const [binary,port,user,expectedDirectory]=process.argv.slice(2);
if(!binary||!/^\d+$/.test(port??'')||!user||!expectedDirectory)throw Error('Explicit isolated cluster required');
let database='postgres';
const run=sql=>{const p=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],{input:sql,encoding:'utf8',windowsHide:true,maxBuffer:4e6});if(p.status!==0)throw Error(p.stderr);return p.stdout.trim();};
const norm=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(norm(run('SHOW data_directory;')),norm(expectedDirectory),'refuse another cluster');
const db='sales_terms_reference_'+randomUUID().replaceAll('-','');run(`CREATE DATABASE ${db};`);database=db;
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
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text);CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,entity_name text,entity_type text,first_name text,last_name text);
 CREATE TABLE tenant_products(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,invoice_number text,status text,amount_total_cents integer,currency text,
 billing_draft_version bigint,billing_draft jsonb,billing_lifecycle_version bigint,billing_issued_snapshot_version bigint,billing_issued_at timestamptz,billing_issued_by uuid,billing_document jsonb,billing_document_digest text,due_date date,billing_import_version bigint,billing_import_provenance jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,evidence_kind text,provider text,provider_environment text,provider_verified_at timestamptz,reference text,notes text,reason text);
 CREATE TABLE paige_agreements(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,offer_id uuid,commercial_terms_id uuid,version integer,status text,body_source text,content_sha256 text,content_storage_key text,sealed_sha256 text,sealed_storage_key text,expires_at timestamptz);
 CREATE TABLE tenant_client_agreements(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,offer_id uuid,status text,agreed_amount_minor bigint,agreed_currency text,collection_terms jsonb,collection_terms_version bigint,updated_at timestamptz DEFAULT now());
 CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 INSERT INTO auth.users(id) VALUES('${actor}'),('${otherActor}');INSERT INTO tenants VALUES('${tenant}','active'),('${foreign}','active');
 INSERT INTO profiles VALUES('${actor}','${tenant}','Fixture owner'),('${otherActor}','${foreign}','Other owner');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner'),('${foreign}','${otherActor}','active','owner');
 INSERT INTO clients(id,tenant_id) VALUES('${client}','${tenant}'),('${otherClient}','${foreign}');INSERT INTO tenant_products VALUES('${offer}','${tenant}');
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
 const collections=read('supabase/migrations/20270547000000_sales_collections.sql');
 const nameStart=collections.indexOf('CREATE OR REPLACE FUNCTION public._sales_collection_client_name(');
 run(collections.slice(nameStart,collections.indexOf('$$;',nameStart)+3));
 run(collections.slice(collections.indexOf('CREATE TABLE IF NOT EXISTS public.paige_sales_export_snapshots('),collections.indexOf('CREATE OR REPLACE FUNCTION public.list_sales_collection_register(')));
 run(extract(collections,'list_sales_collection_register').replace('public.list_sales_collection_register(','public._list_sales_collection_register_before_provider('));
 const balanceOwner=read('supabase/migrations/20270601000002_sales_performance_contract.sql');
 const balanceStart=balanceOwner.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_balance_rows(');
 run(balanceOwner.slice(balanceStart,balanceOwner.indexOf('$$;',balanceStart)+3));
 run(extract(balanceOwner,'_sales_invoice_read')+extract(balanceOwner,'list_sales_collection_register'));
 run('REVOKE ALL ON FUNCTION list_sales_collection_register(uuid,text,integer,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION list_sales_collection_register(uuid,text,integer,jsonb) TO authenticated;');
 assert.equal(run("SELECT position('_sales_invoice_balance_rows' in pg_get_functiondef('public._sales_invoice_read(uuid,uuid,integer)'::regprocedure))>0;"),'t');checks++;
 run(extract(read('supabase/migrations/20270547000000_sales_collections.sql'),'_sales_collection_validate_terms'));
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 run(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 denied(scope+call(),'42883'); // The callable package contract is absent before this migration.
 const migration=read('supabase/migrations/20270598000001_sales_commercial_package_read.sql');run(migration);run(migration);
 const get=(prefix='')=>JSON.parse(run(prefix+scope+call()).split(/\r?\n/).find(x=>x.startsWith('{')));
 // Load the current real shared draft writer, not an approximate fixture writer.
 run(`ALTER TABLE tenant_products ADD name text,ADD status text DEFAULT 'active';
 CREATE TABLE tenant_prices(id uuid,tenant_id uuid,product_id uuid,active boolean,currency text,unit_amount integer,billing_interval text,interval_count integer);
 CREATE TABLE client_contact_methods(id uuid,tenant_id uuid,client_id uuid,kind text,value text);
 ALTER TABLE paige_agreements ADD title text;
 ALTER TABLE paige_invoices ADD hosted_invoice_url text,ADD stripe_invoice_id text,ADD sent_at timestamptz,ADD paid_at timestamptz,
 ADD billing_last_operation_id uuid,ADD billing_last_request jsonb,ADD line_items jsonb,ADD memo text,ADD created_by uuid;
 CREATE FUNCTION is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1=current_user_tenant_id()$$;`);
 const writer=read('supabase/migrations/20270582000000_sales_governed_invoice_draft.sql');
 const kernelStart=writer.indexOf('CREATE OR REPLACE FUNCTION public._save_sales_billing_draft('),kernelEnd=writer.indexOf('\n$$;',kernelStart);
 assert(kernelStart>=0&&kernelEnd>kernelStart);run(writer.slice(kernelStart,kernelEnd+4));
 run(extract(writer,'save_sales_billing_draft'));
 run('REVOKE ALL ON FUNCTION save_sales_billing_draft(uuid,uuid,bigint,uuid,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION save_sales_billing_draft(uuid,uuid,bigint,uuid,jsonb) TO authenticated;');
 const none={state:'not_applicable',charges:[],source:'Explicit invoice terms',policy:'No additional charge'};
 const unknown={state:'unknown',charges:[],source:null,policy:null};
 const conditions={schema_version:1,tax:none,fees:none};
 const invoice2='60000000-0000-0000-0000-000000000002',op=randomUUID();
 const intent={schema_version:3,client_id:client,kind:'deposit',deposit_basis_points:null,deposit_minor:50000,currency:'usd',cadence:null,
 items:[{price_id:null,item:'Synthetic commercial obligation',unit_minor:350000,quantity:1}],recipient_email:null,recipient_phone:null,
 email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,processor_intent:null,payment_method_intents:[],delivery_channel_intents:['email'],due_date:'2026-10-15',memo:null,commercial_conditions:conditions};
 const save=(payload=intent,operation=op)=>scope+`SELECT save_sales_billing_draft('${tenant}','${invoice2}',0,'${operation}',${literal(payload)});`;
 denied(save(),'22023'); // New field is not accepted by the original canonical writer.
 const conditionsMigration=read('supabase/migrations/20270601000009_sales_commercial_conditions.sql');
 run(conditionsMigration);
 run(conditionsMigration); // Forward migration must safely replay on its already-upgraded bodies.
 const validator=value=>`SELECT _sales_validate_commercial_conditions(${literal(value)},'[{"unit_minor":350000,"quantity":1}]');`;
 run(validator(conditions));checks++;
 run(validator({...conditions,tax:unknown}));checks++;
 const recorded={state:'recorded',charges:[{line_index:0,amount_minor:500,currency:'usd'}],source:'Recorded line',policy:'Included in line amount'};
 run(validator({...conditions,tax:recorded}));checks++;
 for(const tax of [{...recorded,charges:[{line_index:0,amount_minor:350001,currency:'usd'}]},
  {...recorded,charges:[{line_index:0,amount_minor:500,currency:'eur'}]},
  {...recorded,charges:[{line_index:0,amount_minor:500,currency:'usd'},{line_index:0,amount_minor:500,currency:'usd'}]},
  {...unknown,source:'False assertion'}, {...none,charges:recorded.charges},
  {...recorded,charges:[{line_index:50,amount_minor:500,currency:'usd'}]},
  {...recorded,charges:[{line_index:0,amount_minor:2147483648,currency:'usd'}]},
  {...recorded,charges:[{line_index:0,amount_minor:0,currency:'usd'}]},
  {...recorded,source:''}, {...recorded,policy:'x'.repeat(1001)}])denied(validator({...conditions,tax}),'22023');
 denied(validator({...conditions,tax:{...recorded,charges:[{line_index:0,amount_minor:200000,currency:'usd'}]},fees:{...recorded,charges:[{line_index:0,amount_minor:200000,currency:'usd'}]}}),'22023');
 const saved=JSON.parse(run(save()).split(/\r?\n/).find(x=>x.startsWith('{')));
 assert.deepEqual(saved.row.billing_draft.commercial_conditions,conditions);assert.equal(saved.row.billing_draft.total_minor,350000);assert.equal(saved.row.billing_draft.due_now_minor,50000);checks+=3;
 assert.deepEqual(JSON.parse(run(save()).split(/\r?\n/).find(x=>x.startsWith('{'))),saved);checks++;
 denied(save({...intent,commercial_conditions:{...conditions,tax:unknown}}),'22023');
 // Publication freezes commercial facts: even a fresh operation may not revise issued data.
 denied(`BEGIN;UPDATE paige_invoices SET status='issued' WHERE id='${invoice2}';`+scope+`SELECT save_sales_billing_draft('${tenant}','${invoice2}',1,'${randomUUID()}',${literal({...intent,commercial_conditions:{...conditions,tax:unknown}})});`,'22023');
 assert.deepEqual(JSON.parse(run(`SELECT billing_draft->'commercial_conditions' FROM paige_invoices WHERE id='${invoice2}';`).split(/\r?\n/).find(x=>x.startsWith('{'))),conditions);checks++;
 // A resolved Catalog price freezes price_snapshot today, not catalog_facts.
 const catalogInvoice=randomUUID(),catalogPrice='80000000-0000-0000-0000-000000000001';
 run(`UPDATE tenant_products SET name='Synthetic offer' WHERE id='${offer}';INSERT INTO tenant_prices VALUES('${catalogPrice}','${tenant}','${offer}',true,'usd',350000,'one_time',1);`);
 const catalogIntent={...intent,items:[{price_id:catalogPrice,item:'Synthetic commercial obligation',unit_minor:null,quantity:1}]};
 const catalogSaved=JSON.parse(run(scope+`SELECT save_sales_billing_draft('${tenant}','${catalogInvoice}',0,'${randomUUID()}',${literal(catalogIntent)});`).split(/\r?\n/).find(x=>x.startsWith('{')));
 assert.equal(catalogSaved.row.billing_draft.items[0].price_snapshot.product_id,offer);checks++;
 const catalogPackage=JSON.parse(run(scope+call(tenant,catalogInvoice)).split(/\r?\n/).find(x=>x.startsWith('{')));
 assert.equal(catalogPackage.offers.length,1,'package must consume the canonical writer frozen price_snapshot');
 assert.equal(catalogPackage.offers[0].id,offer);assert(!catalogPackage.missing_fields.includes('canonical_offer'));checks+=3;
 // Included recorded charge annotations may not silently move to a different invoice item.
 const chargedInvoice=randomUUID(),chargedIntent={...intent,commercial_conditions:{...conditions,tax:recorded}};
 run(scope+`SELECT save_sales_billing_draft('${tenant}','${chargedInvoice}',0,'${randomUUID()}',${literal(chargedIntent)});`);
 const changedLine={...chargedIntent,items:[{...chargedIntent.items[0],item:'Different commercial item'}]};
 denied(scope+`SELECT save_sales_billing_draft('${tenant}','${chargedInvoice}',1,'${randomUUID()}',${literal(changedLine)});`,'22023');
 // An explicit revised treatment can be reviewed against the changed line.
 const revisedTreatment={...changedLine,commercial_conditions:{...conditions,tax:{...recorded,source:'Re-reviewed different commercial item',policy:'Included in the revised item amount'}}};
 run(scope+`SELECT save_sales_billing_draft('${tenant}','${chargedInvoice}',1,'${randomUUID()}',${literal(revisedTreatment)});`);checks++;
 // Read the invoice-owned conditions alongside unchanged canonical balances.
 run(`UPDATE paige_invoices SET billing_draft=billing_draft||${literal({commercial_conditions:conditions,agreement_snapshot:{id:agreement,version:2}})} WHERE id='${invoice}';`);
 const result=get();assert.deepEqual(result.commercial_conditions,conditions);assert(!result.missing_fields.includes('tax_and_fee_treatment'));assert(result.missing_fields.includes('signed_terms_compatibility'));assert.equal(result.invoice.outstanding_minor,300000);checks+=4;
 assert.deepEqual(result.commercial_terms.schedule.dates,rows.map(({due_date,amount_cents})=>({due_date,amount_cents})));
 assert.equal(result.invoice.obligation_total_minor,350000);assert.equal(result.invoice.due_now_minor,50000);assert.equal(result.invoice.remaining_scheduled_minor,300000);checks+=4;
 const stale=get(`BEGIN;UPDATE paige_agreements SET version=3;`);assert(stale.conflicts.includes('agreement_version_mismatch'));checks++;
 const unsigned=get(`BEGIN;UPDATE paige_agreements SET status='draft',expires_at=NULL;`);assert.equal(unsigned.agreement.treatment,'unsigned_canonical_agreement');assert(unsigned.missing_fields.includes('signature_before_collection_policy'));checks+=2;
 const missing=get(`BEGIN;UPDATE paige_invoices SET billing_draft=billing_draft||${literal({commercial_conditions:{...conditions,tax:unknown}})} WHERE id='${invoice}';`);assert(missing.missing_fields.includes('tax_and_fee_treatment'));checks++;
 const inactive=get(`BEGIN;UPDATE tenant_client_agreements SET status='cancelled';`);assert(inactive.conflicts.includes('commercial_terms_inactive'));checks++;
 const otherOffer=randomUUID();run(`INSERT INTO tenant_products(id,tenant_id,name,status) VALUES('${otherOffer}','${tenant}','Other synthetic offer','active');`);
 const offerMismatch=get(`BEGIN;UPDATE paige_agreements SET offer_id='${otherOffer}',commercial_terms_id=NULL;`);
 assert(offerMismatch.conflicts.includes('agreement_offer_conflict'),'agreement offer must agree with invoice even without linked commercial terms');checks++;
 for(const change of [`UPDATE paige_agreements SET tenant_id='${foreign}';`,`UPDATE paige_agreements SET contact_id='${otherClient}';`])denied('BEGIN;'+change+scope+call());
 denied(scope+call(foreign));denied(`SET ROLE anon;`+call());denied(`SET ROLE service_role;`+call());
 denied(`SET test.actor='${otherActor}';SET test.workspace='${tenant}';SET ROLE authenticated;`+call());
 denied(`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`+scope+call());
 const before=run('SELECT count(*) FROM paige_workspace_events;');
 denied(`BEGIN;ALTER TABLE paige_workspace_events ADD CONSTRAINT proof_receipt_failure CHECK(false) NOT VALID;`+scope+call(),'23514');
 assert.equal(run('SELECT count(*) FROM paige_workspace_events;'),before);assert.equal(run('SELECT count(*) FROM paige_invoice_payments;'),'1');assert.equal(get().invoice.outstanding_minor,300000);checks+=3;

 // Failing-first new reference: unchanged writer rejects it and an unsigned package has no terms.
 const reference={id:terms,version:3},referenceIntent={...catalogIntent,commercial_terms_reference:reference};
 const referenceInvoice=randomUUID(),referenceOperation=randomUUID();
 const saveReference=(payload=referenceIntent,id=referenceInvoice,operation=referenceOperation,version=0)=>scope+`SELECT save_sales_billing_draft('${tenant}','${id}',${version},'${operation}',${literal(payload)});`;
 denied(saveReference(),'22023');
 assert.equal(catalogPackage.commercial_terms,null);checks++;
 const beforeSigning=run('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM paige_agreements a;');
 const referenceMigration=read('supabase/migrations/20270601000012_sales_invoice_terms_reference.sql');
 run(referenceMigration);run(referenceMigration);
 const parseResult=sql=>JSON.parse(run(sql).split(/\r?\n/).find(x=>x.startsWith('{')));
 const linked=parseResult(saveReference());
 assert.deepEqual(linked.row.billing_draft.commercial_terms_reference,reference);
 assert.equal(linked.row.billing_draft.total_minor,350000);assert.equal(linked.row.billing_draft.due_now_minor,50000);assert.equal(linked.row.billing_draft.remainder_minor,300000);checks+=4;
 const linkedPackage=parseResult(scope+call(tenant,referenceInvoice));
 assert.deepEqual(linkedPackage.invoice.commercial_terms_reference,reference);assert.equal(linkedPackage.commercial_terms.id,terms);
 assert.equal(linkedPackage.agreement,null);assert(linkedPackage.missing_fields.includes('agreement_or_document'));assert(!linkedPackage.missing_fields.includes('commercial_terms'));checks+=5;
 assert.deepEqual(linkedPackage.commercial_terms.schedule.dates,rows.map(({due_date,amount_cents})=>({due_date,amount_cents})));checks++;
 assert.equal(linkedPackage.commercial_terms.schedule.total_cents,350000);assert.equal(linkedPackage.commercial_terms.schedule.dates[0].amount_cents,50000);assert.equal(linkedPackage.commercial_terms.schedule.dates.slice(1).reduce((sum,row)=>sum+row.amount_cents,0),300000);checks+=3;
 assert.deepEqual(parseResult(saveReference()),linked);checks++;
 denied(saveReference({...referenceIntent,commercial_terms_reference:{id:terms,version:2}},referenceInvoice,referenceOperation),'22023');
 // Shape is closed and absent is the only legacy omission; explicit null is not an association.
 for(const ref of [null,{id:terms,version:-1},{id:terms,version:1.5},{id:terms,version:9007199254740992},{id:'bad',version:3},{id:terms,version:'3'},{id:terms,version:3,approved:true}])denied(saveReference({...referenceIntent,commercial_terms_reference:ref},randomUUID(),randomUUID()),'22023');
 const fresh=(payload=referenceIntent)=>saveReference(payload,randomUUID(),randomUUID());
 const typedDeposit={...schedule,kind:'deposit',count:2,deposit_cents:50000,dates:[rows[0],{...rows[1],amount_cents:300000}]};
 parseResult(`BEGIN;UPDATE tenant_client_agreements SET collection_terms=${literal(typedDeposit)} WHERE id='${terms}';`+fresh());checks++;
 const typedDrift={...typedDeposit,deposit_cents:70000,dates:[{...rows[0],amount_cents:70000},{...rows[1],amount_cents:280000}]};
 denied(`BEGIN;UPDATE tenant_client_agreements SET collection_terms=${literal(typedDrift)} WHERE id='${terms}';`+fresh(),'22023');
 const driftSchedule={...schedule,dates:schedule.dates.map((row,index)=>({...row,amount_cents:index===0?70000:index===1?10000:row.amount_cents}))};
 const driftSql=`UPDATE tenant_client_agreements SET collection_terms=${literal(driftSchedule)} WHERE id='${terms}';`;
 denied('BEGIN;'+driftSql+fresh(),'22023');
 const driftRead=parseResult('BEGIN;'+driftSql+scope+call(tenant,referenceInvoice));assert(driftRead.conflicts.includes('invoice_terms_conflict'));assert.equal(driftRead.commercial_terms.schedule,null);checks+=2;
 denied(fresh({...referenceIntent,due_date:'2027-12-01'}),'22023');
 const dateRead=parseResult(`BEGIN;UPDATE paige_invoices SET billing_draft=jsonb_set(billing_draft,'{due_date}','"2027-12-01"'::jsonb) WHERE id='${referenceInvoice}';`+scope+call(tenant,referenceInvoice));assert(dateRead.conflicts.includes('invoice_terms_conflict'));assert.equal(dateRead.commercial_terms.schedule,null);checks+=2;
 const fullIntent={...referenceIntent,schema_version:2,kind:'one_time',deposit_basis_points:null};delete fullIntent.deposit_minor;parseResult(fresh(fullIntent));checks++;

 for(const version of [0,2147483648,9007199254740991]){parseResult(`BEGIN;UPDATE tenant_client_agreements SET collection_terms_version=${version},collection_terms=NULL WHERE id='${terms}';`+fresh({...referenceIntent,commercial_terms_reference:{id:terms,version}}));checks++;}

 denied(fresh({...referenceIntent,commercial_terms_reference:{id:terms,version:2}}),'40001');
 const changedSource=()=>`UPDATE tenant_client_agreements SET collection_terms_version=4 WHERE id='${terms}';`;
 run(changedSource());
 assert.deepEqual(parseResult(saveReference()),linked,'exact replay precedes mutable source version');checks++;
 denied(fresh(),'40001');
 const changedPackage=parseResult(scope+call(tenant,referenceInvoice));assert(changedPackage.conflicts.includes('commercial_terms_version_changed'));assert.equal(changedPackage.commercial_terms.version,4);checks+=2;
 run(`UPDATE tenant_client_agreements SET collection_terms_version=3 WHERE id='${terms}';`);
 for(const change of [`UPDATE tenant_client_agreements SET tenant_id='${foreign}' WHERE id='${terms}';`,`UPDATE tenant_client_agreements SET contact_id='${otherClient}' WHERE id='${terms}';`]){
  denied('BEGIN;'+change+fresh(),'42501');denied('BEGIN;'+change+scope+call(tenant,referenceInvoice),'42501');
 }
 for(const change of [`agreed_amount_minor=350001`,`agreed_currency='eur'`,`agreed_amount_minor=NULL,agreed_currency=NULL`,`offer_id='${otherOffer}'`,`status='cancelled'`,`status='completed'`])denied(`BEGIN;UPDATE tenant_client_agreements SET ${change} WHERE id='${terms}';`+fresh(),'22023');
 for(const status of ['draft','paused']){
  parseResult(`BEGIN;UPDATE tenant_client_agreements SET status='${status}' WHERE id='${terms}';`+fresh());checks++;
 }
 const paused=parseResult(`BEGIN;UPDATE tenant_client_agreements SET status='paused' WHERE id='${terms}';`+scope+call(tenant,referenceInvoice));assert(paused.conflicts.includes('commercial_terms_inactive'));checks++;
 const unscheduled=parseResult(`BEGIN;UPDATE tenant_client_agreements SET collection_terms=NULL WHERE id='${terms}';`+scope+call(tenant,referenceInvoice));assert(unscheduled.missing_fields.includes('collection_schedule'));assert.equal(unscheduled.commercial_terms.schedule,null);checks+=2;
 parseResult(`BEGIN;UPDATE tenant_client_agreements SET collection_terms=NULL WHERE id='${terms}';`+fresh());checks++;
 // Signing linkage is independently projected; an explicit different source never rewrites signing.
 const otherTerms=randomUUID();run(`INSERT INTO tenant_client_agreements SELECT '${otherTerms}',tenant_id,contact_id,offer_id,status,agreed_amount_minor,agreed_currency,collection_terms,collection_terms_version,updated_at FROM tenant_client_agreements WHERE id='${terms}';`);
 const conflicting=parseResult(`BEGIN;UPDATE paige_invoices SET billing_draft=billing_draft||${literal({commercial_terms_reference:{id:otherTerms,version:3}})} WHERE id='${invoice}';`+scope+call());
 assert(conflicting.conflicts.includes('agreement_commercial_terms_conflict'));assert.equal(conflicting.commercial_terms.id,otherTerms);assert.equal(conflicting.agreement.commercial_terms_id,terms);checks+=3;
 const legacy=get();assert(!Object.hasOwn(legacy.invoice,'commercial_terms_reference'));assert.equal(legacy.commercial_terms.id,terms);assert.equal(legacy.invoice.outstanding_minor,300000);checks+=3;
 denied(`BEGIN;UPDATE paige_invoices SET status='issued' WHERE id='${referenceInvoice}';`+saveReference(referenceIntent,referenceInvoice,randomUUID(),1),'22023');
 assert.deepEqual(parseResult(scope+call(tenant,referenceInvoice)).invoice.commercial_terms_reference,reference);checks++;
 assert.equal(run('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM paige_agreements a;'),beforeSigning,'association and read never mutate signing');checks++;
 denied(`SET ROLE anon;SELECT _sales_invoice_terms_reference_shape(${literal(reference)});`,'42501');
 denied(`SET ROLE authenticated;SELECT _sales_validate_invoice_terms_reference('${tenant}','${client}',${literal(reference)},${literal(linked.row.billing_draft)});`,'42501');

 // Real two-session negative control: the canonical save holds its terms SHARE lock to commit.
 const held=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let heldError='';held.stderr.on('data',d=>heldError+=d);
 const ended=new Promise((resolve,reject)=>held.on('close',code=>code===0?resolve():reject(Error(heldError))));
 try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Canonical lock holder did not become ready')),10000);
   held.stdout.on('data',d=>{output+=d;if(output.includes('SOURCE_LOCK_READY')){clearTimeout(timer);resolve();}});held.once('error',reject);
   held.stdin.write('BEGIN;'+fresh()+"SELECT 'SOURCE_LOCK_READY';\n");
  });
  denied("SET lock_timeout='100ms';"+changedSource(),'55P03');
  held.stdin.end('COMMIT;\n');await ended;checks++;
 }catch(error){held.stdin.end('ROLLBACK;\n');await ended.catch(()=>{});throw error;}
 assert.equal(run(`SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${terms}';`),'3');checks++;
 console.log(`PASS ${checks} real PostgreSQL invoice terms-reference and inherited commercial-condition checks: actual single writer, optional source binding, source locks/version/economics, 350000 principal with 50000 plus ten dated 30000 rows, legacy projection, replay, issued immutability, tenant/client refusal and unchanged signing/balance/Rail. Provider execution and authenticated app acceptance remain UNVERIFIED.`);
}finally{database='postgres';run(`DROP DATABASE ${db} WITH (FORCE);`);}
