// Explicit disposable localhost cluster only. Real PostgreSQL locks/caller roles; no provider claim.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [binary,port,user,expectedDirectory,mode]=process.argv.slice(2);
if(!binary||!/^\d+$/.test(port??'')||!user||!expectedDirectory)throw Error('Explicit local cluster arguments required');
if(process.argv.includes('--observation-work'))assert(process.argv.includes('--provider-observations'),'event work requires the original observation proof');
let database='postgres';
const args=()=>['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'];
const run=sql=>{const p=spawnSync(binary,args(),{input:sql,encoding:'utf8',maxBuffer:4e6,windowsHide:true});if(p.status!==0)throw Error(p.stderr);return p.stdout.trim();};
const normalize=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(run('SHOW data_directory;')),normalize(expectedDirectory),'refuse other cluster');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const extract=(source,name)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=source.indexOf('END $$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+7);};
const db='sales_provider_proof_'+randomUUID().replaceAll('-','');run(`CREATE DATABASE ${db};`);database=db;
const actor='10000000-0000-0000-0000-000000000001',otherActor='10000000-0000-0000-0000-000000000002';
const tenant='20000000-0000-0000-0000-000000000001',otherTenant='20000000-0000-0000-0000-000000000002';
const client='30000000-0000-0000-0000-000000000001',otherClient='30000000-0000-0000-0000-000000000002';
const invoice='60000000-0000-0000-0000-000000000001';
const command={action:'invoice.payment_request',invoice_id:invoice,client_id:client,expected_version:2,issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_fixtureA',merchant_binding_version:1,environment:'test',amount_minor:50000,currency:'usd',purpose:'deposit'};
const gov={actor_user_id:actor,tenant_id:tenant,action:'invoice.payment_request',tool:'sales_create_payment_request',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true};
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const service=sql=>'SET ROLE service_role; SET test.actor=\'\';'+sql;
const prepare=(op,cmd=command,g=gov,a=actor,t=tenant)=>`SELECT prepare_sales_invoice_payment_request('${a}','${t}','${op}',${literal(cmd)},${literal(g)});`;
const claim=(op,token=randomUUID(),t=tenant)=>`SELECT claim_sales_invoice_payment_request('${t}','${op}','${token}');`;
const final=(op,token,state='customer_action_required',object='cs_test_fixture',url='https://checkout.stripe.com/c/pay/cs_test_fixture')=>`SELECT finalize_sales_invoice_payment_request('${tenant}','${op}','${token}','${state}',${object===null?'NULL':"'"+object+"'"},'open',${url===null?'NULL':"'"+url+"'"},NULL);`;
const deny=(sql,pattern)=>assert.throws(()=>run(sql),pattern);
const execute=sql=>new Promise((resolve,reject)=>{const p=spawn(binary,args(),{windowsHide:true});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(sql);});
let originalListDefinition=null,forwardListDefinition=null,observationProof=null;
try {
 if(process.argv.includes('--provider-observations')){
  mkdirSync(new URL('../../work/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../work/sales-provider-observation-proof.json',import.meta.url),JSON.stringify({
   proof:'E04_PROVIDER_OBSERVATION_SELECTED_SCHEMA',status:'NOT_COMPLETED',observed_at:new Date().toISOString(),
   boundary:'Selected-schema native proof; no hosted Auth, provider, financial adjustment or customer acceptance'
  },null,2)+'\n');
 }
 run(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE tenants(id uuid PRIMARY KEY,status text);CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid,full_name text);
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text);CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid);
 INSERT INTO auth.users(id) VALUES('${actor}'),('${otherActor}');INSERT INTO tenants VALUES('${tenant}','active'),('${otherTenant}','active');
 INSERT INTO profiles VALUES('${actor}','${tenant}','Fixture owner'),('${otherActor}','${otherTenant}','Other owner');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner'),('${otherTenant}','${otherActor}','active','owner');
 INSERT INTO clients VALUES('${client}','${tenant}'),('${otherClient}','${otherTenant}');
 CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),contact_id uuid REFERENCES clients(id),invoice_number text,status text,amount_total_cents integer,currency text,
  billing_draft_version bigint,billing_draft jsonb,billing_lifecycle_version bigint,billing_issued_snapshot_version bigint,billing_issued_at timestamptz,billing_issued_by uuid,billing_document jsonb,billing_document_digest text,
  UNIQUE(tenant_id,id));
 INSERT INTO paige_invoices VALUES('${invoice}','${tenant}','${client}','INV-1','issued',350000,'USD',1,'{}',2,1,now(),'${actor}','{}',repeat('a',64));
 ALTER TABLE paige_invoices ADD COLUMN updated_at timestamptz DEFAULT now();
 CREATE TABLE paige_invoice_payments(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz,created_at timestamptz DEFAULT now(),reverses_payment_id uuid,import_provenance jsonb,UNIQUE(tenant_id,invoice_id,id));
 CREATE TABLE paige_invoice_operations(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,command jsonb,result jsonb);
 CREATE TABLE tenant_stripe_accounts(tenant_id uuid PRIMARY KEY,stripe_account_id text,binding_version bigint,provider_environment text,charges_enabled boolean,payouts_enabled boolean,details_submitted boolean,sales_payment_permission boolean,sales_readback_at timestamptz);
 INSERT INTO tenant_stripe_accounts VALUES('${tenant}','acct_fixtureA',1,'test',true,true,true,true,now()),('${otherTenant}','acct_fixtureB',1,'test',true,true,true,true,now());
 CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz);
 CREATE FUNCTION resolve_tool_autonomy(uuid,text) RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('test.mode',true),''),'confirm')$$;
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.workspace',true),'')::uuid$$;
 CREATE FUNCTION is_platform_owner() RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE FUNCTION list_tool_autonomy(_tenant_id uuid DEFAULT NULL) RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz) LANGUAGE sql AS $$SELECT 'existing','Existing','Sales','confirm',true,NULL::timestamptz$$;
 GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated,anon;`);
 run(`ALTER TABLE paige_invoices ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN due_date date,ADD COLUMN billing_import_provenance jsonb,ADD COLUMN billing_import_version bigint;
 ALTER TABLE paige_invoice_payments ADD COLUMN reference text,ADD COLUMN notes text,ADD COLUMN reason text;
 CREATE TABLE paige_invoice_access_grants(token_hash text,tenant_id uuid,invoice_id uuid,issued_snapshot_version bigint,revoked_at timestamptz,expires_at timestamptz);
 CREATE TABLE paige_sales_export_snapshots(id uuid PRIMARY KEY,tenant_id uuid,actor_user_id uuid,entity text,membership_count integer,expires_at timestamptz DEFAULT now()+interval '1 hour',created_at timestamptz DEFAULT now());
 CREATE TABLE paige_sales_export_members(snapshot_id uuid,position integer,record_id uuid);
 CREATE FUNCTION _sales_collection_client_name(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT 'Fixture client'$$;`);
 const life=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 run(extract(life,'_sales_invoice_actor')+extract(life,'_sales_invoice_governance')+extract(life,'_sales_invoice_read')+extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 run(extract(read('supabase/migrations/20270555000000_sales_invoice_payment_breakdown.sql'),'_sales_invoice_payment_ledger')+extract(life,'read_public_sales_invoice')+extract(life,'preview_sales_invoice_command')+extract(read('supabase/migrations/20270547000000_sales_collections.sql'),'list_sales_collection_register'));
 run(`ALTER TABLE tenant_members ADD COLUMN is_owner boolean DEFAULT false;
 CREATE TABLE paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,is_archived boolean DEFAULT false);
 CREATE TABLE marketing_content(id uuid PRIMARY KEY);CREATE TABLE paige_chat_turns(id uuid PRIMARY KEY);`);
 // Actual canonical envelope/lease/transition and immutable payload/attempt gate.
 // Only unrelated adopter correlation ALTERs/submission/cron are omitted.
 run(read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql').split('-- Existing capability-specific records')[0]);
 run(read('supabase/migrations/20270418000000_paige_durable_document_work.sql').split('-- Authenticated submission:')[0]);
 if(mode!=='--baseline'){
  const full=read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql');
  const migration=mode==='--s4-baseline'?full.split('-- S4 appends verified provider facts')[0]+'COMMIT;'
   :mode==='--reconciliation-baseline'?full.split('-- GET-only financial reconciliation')[0]+'COMMIT;':full;
  run(migration);run(migration);
 }
 if(mode==='--s4-baseline')run(service(`SELECT allocate_verified_sales_invoice_payment('${tenant}','${randomUUID()}','${randomUUID()}','{}');`));
 if(mode==='--reconciliation-baseline')run(service(`SELECT register_sales_payment_reconciliation_work('${tenant}','${randomUUID()}');`));
 // Run the ENTIRE incumbent role/claim/settlement/Rail/concurrency proof against
 // the additive accepted-target writers too. Legacy unbound commands retain the
 // original contract. Accepted-source positives have their own composition proof;
 // these synthetic provider facts are never production settlement evidence.
 if(process.argv.includes('--accepted-obligation-writers')){
  const source=read('supabase/migrations/20271126010010_e04_accepted_invoice_payment_obligations.sql');
  const exact=(name,tag)=>{
   const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
   const end=source.indexOf('END $'+tag+'$;',start);
   assert(start>=0&&end>start,'original forward writer '+name);
   return source.slice(start,end+('END $'+tag+'$;').length);
  };
  originalListDefinition=run("SELECT pg_get_functiondef('public.list_sales_invoice_payment_operations(uuid,uuid)'::regprocedure);");
  forwardListDefinition=exact('list_sales_invoice_payment_operations','function');
  const forward=exact('_sales_invoice_require_accepted_obligation','target')
   +exact('prepare_sales_invoice_payment_request','function')
   +exact('claim_sales_invoice_payment_request','function')+forwardListDefinition;
  run(forward);run(forward);
  run('REVOKE ALL ON FUNCTION public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb) FROM PUBLIC,anon,authenticated,service_role;');
 }
 // Install the additive test-only candidate BEFORE all incumbent cases. This
 // proves old prepare/claim/settlement/recovery writes retain their behavior
 // with the new row guard, rather than testing two disconnected schemas.
 if(process.argv.includes('--provider-observations')){
  const railSource=read('supabase/migrations/20270107000000_receipt_correlation_and_detail.sql');
  const rail=/create or replace function public\._record_workspace_rail_event\([\s\S]*?as \$\$[\s\S]*?\$\$;/i.exec(railSource)?.[0];
  assert(rail?.includes('_job_attempt_id'),'actual original twelve-argument Rail writer');
  const balanceSource=read('supabase/migrations/20270601000002_sales_performance_contract.sql');
  const balance=/CREATE OR REPLACE FUNCTION public\._sales_invoice_balance_rows\([\s\S]*?AS \$\$[\s\S]*?\$\$;/i.exec(balanceSource)?.[0];
  assert(balance,'actual original canonical receipt balance projection');
  run(balance+`REVOKE ALL ON FUNCTION public._sales_invoice_balance_rows(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
  run(`ALTER TABLE public.paige_workspace_events ADD COLUMN IF NOT EXISTS job_attempt_id text,
   ADD COLUMN IF NOT EXISTS llm_trace_id uuid,ADD COLUMN IF NOT EXISTS release_id text,ADD COLUMN IF NOT EXISTS detail jsonb;`);
  run(rail+`REVOKE ALL ON FUNCTION public._record_workspace_rail_event(uuid,uuid,text,uuid,bigint,text,text,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;`);
  run(read('supabase/tests/fixtures/exp04_provider_observation.sql'));
  if(process.argv.includes('--observation-work'))run(read('supabase/tests/fixtures/exp04_provider_observation_work.sql'));
 }
 const first=randomUUID();
 // --baseline intentionally fails here on current-main: there is no asynchronous operation RPC.
 const prepared=JSON.parse(run(service(prepare(first))).split('\n').at(-1));assert.equal(prepared.state,'prepared');assert(!('dispatch_claim_token' in prepared));
 if(originalListDefinition&&forwardListDefinition){
  const listSql=`SET test.actor='${actor}';SET test.workspace='${tenant}';SET ROLE authenticated;SELECT list_sales_invoice_payment_operations('${tenant}','${invoice}');`;
  run(originalListDefinition+';');const oldList=JSON.parse(run(listSql).split('\n').at(-1));
  run(forwardListDefinition);const currentList=JSON.parse(run(listSql).split('\n').at(-1));
  assert.deepEqual(currentList,oldList,'WHOLE original legacy list JSON remains exact');
  const ref={commercial_terms_id:randomUUID(),signing_id:randomUUID(),signing_version:4,terms_version:1,sequence:2},id=randomUUID();
  // Stored-selector projection only. This failed operation is a rolled-back
  // synthetic fixture, not a preparation, approval, signature or provider result.
  const projected=run(`BEGIN;INSERT INTO paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key,state,dispatch_claim_token,dispatch_started_at)
   SELECT '${id}',tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,'installment',jsonb_set(command,'{obligation}',${literal({reference:ref,source_digest:'a'.repeat(64),due_date:'2026-10-15',scheduled_minor:50000,remaining_minor:50000})}),authority_fingerprint,'sales-payment-${id}','failed',gen_random_uuid(),now() FROM paige_invoice_provider_operations WHERE id='${first}';${listSql}ROLLBACK;`).split('\n').find(line=>line.startsWith('{'));
  assert(projected);const listed=JSON.parse(projected).rows.find(row=>row.id===id);
  assert.deepEqual(listed.obligation_reference,ref,'original owner list retains exact immutable accepted selector');
  assert(!('command' in listed)&&!('dispatch_claim_token' in listed),'no raw command/claim token in owner list');
  assert.equal(run(`SELECT count(*) FROM paige_invoice_provider_operations WHERE id='${id}';`),'0','projection fixture rolls back');
 }
 assert.equal(JSON.parse(run(service(`SELECT _sales_invoice_read('${tenant}','${invoice}',0);`)).split('\n').at(-1)).id,invoice,'existing Edge service read remains executable');
 deny(`SET ROLE anon;SELECT _sales_invoice_read('${tenant}','${invoice}',0);`,/permission denied/);
 deny(`SET ROLE authenticated;SELECT _sales_invoice_read('${tenant}','${invoice}',0);`,/permission denied/);
 deny(service(`SELECT _sales_invoice_read('${otherTenant}','${invoice}',0);`),/Invoice unavailable/);
 assert.equal(JSON.parse(run(service(prepare(first))).split('\n').at(-1)).id,first,'exact replay returns immutable identity');
 deny(`INSERT INTO paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES('${first}','${tenant}','${invoice}','${actor}','{}','{}');`,/belongs to another invoice action/);
 const oldOperation=randomUUID();run(`INSERT INTO paige_invoice_operations VALUES('${oldOperation}','${tenant}','${invoice}','${actor}','{}','{}');`);
 deny(service(prepare(oldOperation)),/belongs to another invoice action/);
 deny(service(prepare(first,{...command,amount_minor:40000})),/reused with different input/);
 deny('SET ROLE authenticated;'+prepare(randomUUID()),/permission denied/);
 deny('SET ROLE anon;'+prepare(randomUUID()),/permission denied/);
 deny("SET ROLE service_role;SET test.actor='"+actor+"';"+prepare(randomUUID()),/Payment operation unavailable/);
 deny(service(prepare(randomUUID(),command,gov,otherActor,tenant)),/Active invoice workspace changed/);
 deny(service(prepare(randomUUID(),command,{...gov,tenant_id:otherTenant},otherActor,otherTenant)),/Payment operation unavailable/);
 deny(service(prepare(randomUUID(),{...command,client_id:otherClient})),/Payment operation unavailable/);
 deny(service(prepare(randomUUID(),{...command,merchant_account_id:'acct_fixtureB'})),/merchant unavailable/);
 deny(service(prepare(randomUUID(),{...command,merchant_binding_version:2})),/merchant unavailable/);
 deny(service(prepare(randomUUID(),{...command,environment:'live'})),/merchant unavailable/);
 deny(service(prepare(randomUUID(),{...command,expected_version:1})),/Invoice changed/);
 deny(service(prepare(randomUUID(),{...command,issued_snapshot_version:2})),/Invoice changed/);
 deny(service(prepare(randomUUID(),{...command,amount_minor:350001})),/amount or currency/);
 deny(service(prepare(randomUUID(),{...command,amount_minor:0})),/Invalid payment request/);
 deny(service(prepare(randomUUID(),{...command,purpose:'full'})),/amount or currency/);
 deny(service(prepare(randomUUID(),{...command,currency:'eur'})),/amount or currency/);
 deny(service(prepare(randomUUID(),{...command,provider:'paypal'})),/provider unavailable/);
 deny(service(prepare(randomUUID(),{...command,card_number:'forbidden-test-field'})),/Invalid payment request/);
 deny(service(prepare(randomUUID(),command,{...gov,approved_fingerprint:'forged'})),/governance required/);
 deny(service("SET test.mode='off';"+prepare(randomUUID())),/authority unavailable/);
 run("UPDATE tenant_stripe_accounts SET sales_readback_at=now()-interval '6 minutes' WHERE tenant_id='"+tenant+"';");
 deny(service(claim(first)),/merchant unavailable/);
 run("UPDATE tenant_stripe_accounts SET sales_readback_at=now() WHERE tenant_id='"+tenant+"';");
 run("UPDATE tenant_stripe_accounts SET sales_payment_permission=false WHERE tenant_id='"+tenant+"';");
 deny(service(claim(first)),/merchant unavailable/);
 run("UPDATE tenant_stripe_accounts SET sales_payment_permission=true WHERE tenant_id='"+tenant+"';");
 deny("UPDATE paige_invoices SET status='void' WHERE id='"+invoice+"';",/Payment request is unresolved/);
 deny("INSERT INTO paige_invoice_payments VALUES(gen_random_uuid(),'"+tenant+"','"+invoice+"','"+actor+"','receipt',1,'usd','cash',now(),now(),NULL);",/Payment request is unresolved/);
 deny(service(prepare(randomUUID())),/already in progress/);
 const a=randomUUID(),b=randomUUID();const race=await Promise.all([execute(service(claim(first,a))),execute(service(claim(first,b)))]);
 assert.equal(race.filter(v=>v.code===0).length,1,'one provider dispatch claim');assert.match(race.find(v=>v.code!==0).err,/already claimed/);
 const token=race[0].code===0?a:b;
 deny(service(final(first,randomUUID())),/Payment operation unavailable/);
 deny(service(final(first,token,'settled')),/Invalid safe provider result/);
 assert.equal(JSON.parse(run(service(final(first,token,'outcome_unknown',null,null))).split('\n').at(-1)).state,'outcome_unknown');
 deny(service(claim(first)),/already claimed/);
 deny(service(`SELECT cancel_prepared_sales_invoice_payment_request('${tenant}','${first}','recovery_abandoned');`),/reconcile instead/);
 assert.equal(JSON.parse(run(service(final(first,token))).split('\n').at(-1)).state,'customer_action_required');
 assert.equal(run('SELECT count(*) FROM paige_invoice_payments;'),'0','provider accepted never allocates');
 assert.equal(run('SELECT amount_total_cents FROM paige_invoices;'),'350000','obligation unchanged');
 deny(service(final(first,token,'customer_action_required','cs_test_other')),/Provider identity conflicts/);
 deny(service(final(first,token,'customer_action_required','cs_test_fixture','https://evil.example/pay')),/Invalid safe provider result/);
 deny('SET ROLE authenticated;SELECT * FROM paige_invoice_provider_operations;',/permission denied/);
 deny('SET ROLE service_role;UPDATE paige_invoice_provider_operations SET amount_minor=1;',/permission denied/);
 deny(`UPDATE paige_invoice_provider_operations SET amount_minor=1 WHERE id='${first}';`,/identity is immutable/);
 deny(`DELETE FROM paige_invoice_provider_operations WHERE id='${first}';`,/history is immutable/);
 const readResult=JSON.parse(run(service(`SELECT read_sales_invoice_payment_request('${actor}','${tenant}','${first}');`)).split('\n').at(-1));assert(!('dispatch_claim_token' in readResult));
 deny(service(`SELECT read_sales_invoice_payment_request('${otherActor}','${otherTenant}','${first}');`),/Payment operation unavailable/);
 run(service(final(first,token,'expired')));
 const second=randomUUID();
 // Preparation, operation row and canonical Rail are one transaction: a Rail failure rolls all back.
 run(`CREATE FUNCTION proof_rail_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'proof Rail unavailable';END $$;CREATE TRIGGER proof_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_rail_fail();`);
 deny(service(prepare(second)),/proof Rail unavailable/);
 assert.equal(run(`SELECT count(*) FROM paige_invoice_provider_operations WHERE id='${second}';`),'0');
 run('DROP TRIGGER proof_rail_fail ON paige_workspace_events;');
 run(service(prepare(second)));
 const secondToken=randomUUID();run(`CREATE TRIGGER proof_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_rail_fail();`);
 deny(service(claim(second,secondToken)),/proof Rail unavailable/);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${second}';`),'prepared','failed Rail dispatch claim rolls back');
 run('DROP TRIGGER proof_rail_fail ON paige_workspace_events;');
 run(service(claim(second,secondToken)));
 run(`CREATE TRIGGER proof_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_rail_fail();`);
 deny(service(final(second,secondToken,'outcome_unknown',null,null)),/proof Rail unavailable/);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${second}';`),'dispatching','Rail result failure does not fabricate final state');
 run('DROP TRIGGER proof_rail_fail ON paige_workspace_events;');
 run(service(final(second,secondToken,'failed',null,null)));
 const third=randomUUID(),fourth=randomUUID();
 const preparedRace=await Promise.all([execute(service(prepare(third))),execute(service(prepare(fourth)))]);
 assert.equal(preparedRace.filter(v=>v.code===0).length,1,'one concurrent invoice request winner');
 assert.match(preparedRace.find(v=>v.code!==0).err,/already in progress/);
 const winner=preparedRace[0].code===0?third:fourth;
 const replayRace=await Promise.all([execute(service(prepare(winner))),execute(service(prepare(winner)))]);
 assert(replayRace.every(v=>v.code===0),'concurrent exact preparation replay safe');
 assert.equal(run(`SELECT count(*) FROM paige_invoice_provider_operations WHERE id='${winner}';`),'1');
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=md5('${first}'||':prepared')::uuid;`),'1','stable child Rail identity');
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=md5('${first}'||':dispatching')::uuid;`),'1','dispatch Rail retained');
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=md5('${first}'||':outcome_unknown')::uuid;`),'1','unknown Rail retained after reconciliation');
 run(`UPDATE profiles SET active_tenant_id='${otherTenant}' WHERE user_id='${actor}';`);
 deny(service(`SELECT read_sales_invoice_payment_request('${actor}','${tenant}','${first}');`),/Active invoice workspace changed/);
 const internal=JSON.parse(run(service(`SELECT read_sales_invoice_payment_dispatch('${tenant}','${first}');`)).split('\n').at(-1));
 assert.equal(internal.dispatch_claim_token,token,'provider recovery independent of interactive workspace');
 deny(service(`SELECT read_sales_invoice_payment_dispatch('${otherTenant}','${first}');`),/Payment operation unavailable/);
 run(`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
 const cancelled=JSON.parse(run(service(`SELECT cancel_prepared_sales_invoice_payment_request('${tenant}','${winner}','merchant_changed');`)).split('\n').at(-1));
 assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.dispatch_started_at,null);assert.equal(cancelled.cancellation_reason,'merchant_changed');
 assert.equal(JSON.parse(run(service(`SELECT cancel_prepared_sales_invoice_payment_request('${tenant}','${winner}','merchant_changed');`)).split('\n').at(-1)).id,winner);
 deny(service(claim(winner)),/already claimed/);
 run(`INSERT INTO paige_invoice_payments VALUES(gen_random_uuid(),'${tenant}','${invoice}','${actor}','receipt',10000,'usd','cash',now(),now(),NULL);UPDATE paige_invoices SET billing_lifecycle_version=3 WHERE id='${invoice}';`);
 const afterReceipt=randomUUID();run(service(prepare(afterReceipt,{...command,expected_version:3,purpose:'full',amount_minor:340000})));
 assert.equal(run(`SELECT amount_minor FROM paige_invoice_provider_operations WHERE id='${afterReceipt}';`),'340000','request derives net canonical receipt balance');
 const cancellationRace=await Promise.all([
  execute(service(`SELECT cancel_prepared_sales_invoice_payment_request('${tenant}','${afterReceipt}','recovery_abandoned');`)),
  execute(service(claim(afterReceipt)))
 ]);
 assert.equal(cancellationRace.filter(v=>v.code===0).length,1,'cancel versus dispatch has one winner');
 assert.equal(run(`SELECT (state='cancelled' AND dispatch_started_at IS NULL) OR (state='dispatching' AND dispatch_started_at IS NOT NULL) FROM paige_invoice_provider_operations WHERE id='${afterReceipt}';`),'t');
 assert.equal(run(`SELECT count(*) FROM list_tool_autonomy('${tenant}') WHERE tool_key='existing';`),'1');
 assert.equal(run(`SELECT mode FROM list_tool_autonomy('${tenant}') WHERE tool_key='sales_create_payment_request';`),'confirm');
 const raceState=run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${afterReceipt}';`);
 if(raceState==='dispatching') {
  const raceToken=run(service(`SELECT read_sales_invoice_payment_dispatch('${tenant}','${afterReceipt}')->>'dispatch_claim_token';`)).split('\n').at(-1);
  run(service(final(afterReceipt,raceToken,'failed',null,null)));
 }
 const paidOp=randomUUID(),paidToken=randomUUID();
 run(service(prepare(paidOp,{...command,expected_version:3})));run(service(claim(paidOp,paidToken)));
 run(`UPDATE tenant_members SET status='inactive' WHERE user_id='${actor}';UPDATE profiles SET active_tenant_id='${otherTenant}' WHERE user_id='${actor}';`);
 run(service(final(paidOp,paidToken,'customer_action_required','cs_test_settlement','https://checkout.stripe.com/c/pay/cs_test_settlement')));
 run(`INSERT INTO paige_invoice_access_grants VALUES(repeat('d',64),'${tenant}','${invoice}',1,NULL,now()+interval '1 hour');`);
 const publicRequest=()=>JSON.parse(run(service(`SELECT coalesce(read_public_sales_invoice_payment_request(repeat('d',64))::text,'null');`)).split('\n').at(-1));
 assert.equal(publicRequest().payment_request.provider_url,null,'unknown expiry never exposes checkout URL');
 run(`UPDATE paige_invoice_provider_operations SET expires_at=now()+interval '1 hour' WHERE id='${paidOp}';`);
 assert.equal(publicRequest().payment_request.provider_url,'https://checkout.stripe.com/c/pay/cs_test_settlement');
 assert.equal(publicRequest().invoice_number,'INV-1');assert.equal(publicRequest().remaining_cents,340000);
 assert(!('id' in publicRequest().payment_request));assert(!('merchant_account_id' in publicRequest().payment_request));
 run(`UPDATE paige_invoice_provider_operations SET expires_at=now()-interval '1 second' WHERE id='${paidOp}';`);
 assert.equal(publicRequest().payment_request.provider_url,null,'expired request URL suppressed');
 run(`UPDATE paige_invoice_provider_operations SET expires_at=now()+interval '1 hour' WHERE id='${paidOp}';`);
 run(`UPDATE paige_invoice_access_grants SET revoked_at=now() WHERE token_hash=repeat('d',64);`);
 assert.equal(publicRequest(),null,'revoked bearer refused');
 run(`UPDATE paige_invoice_access_grants SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash=repeat('d',64);`);
 assert.equal(publicRequest(),null,'expired bearer refused');
 run(`UPDATE paige_invoice_access_grants SET expires_at=now()+interval '1 hour' WHERE token_hash=repeat('d',64);`);
 assert.equal(run(service(`SELECT read_public_sales_invoice_payment_request(repeat('e',64)) IS NULL;`)).split('\n').at(-1),'t','unknown bearer refused');
 deny(`SET ROLE anon;SELECT read_public_sales_invoice_payment_request(repeat('d',64));`,/permission denied/);
 deny(`UPDATE paige_invoices SET billing_lifecycle_version=4 WHERE id='${invoice}';`,/in-flight|active|reconcile/i);
 // Corrupt-state defense fixture only: production callers cannot disable triggers.
 const staleProjection=JSON.parse(run(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE paige_invoices SET billing_lifecycle_version=4 WHERE id='${invoice}';SET LOCAL session_replication_role=origin;SELECT read_public_sales_invoice_payment_request(repeat('d',64));ROLLBACK;`).split('\n').filter(v=>v.startsWith('{')).at(-1));
 assert.equal(staleProjection.payment_request.provider_url,null,'stale invoice version URL suppressed');
 assert.equal(JSON.parse(run(`SELECT _sales_invoice_payment_projection('${tenant}','${invoice}','${paidOp}',49999);`)).provider_url,null,'stale balance URL suppressed');
 run(service(final(paidOp,paidToken,'outcome_unknown','cs_test_settlement','https://checkout.stripe.com/c/pay/cs_test_settlement')));
 assert.equal(publicRequest().payment_request.provider_url,null,'unknown never asks customer to pay again');
 const workRegistrations=await Promise.all([execute(service(`SELECT register_sales_payment_reconciliation_work('${tenant}','${paidOp}');`)),execute(service(`SELECT register_sales_payment_reconciliation_work('${tenant}','${paidOp}');`))]);
 assert.equal(workRegistrations.filter(r=>r.code===0).length,2,workRegistrations.map(r=>r.err).join('\n'));
 const registeredWork=JSON.parse(workRegistrations[0].out.trim().split('\n').at(-1));
 assert.equal(JSON.parse(workRegistrations[1].out.trim().split('\n').at(-1)).work_id,registeredWork.work_id,'registration replay cannot split identity');
 assert.equal(run(`SELECT count(*) FROM paige_durable_work WHERE tenant_id='${tenant}' AND intent_id='${paidOp}';`),'1');
 assert.equal(run(`SELECT initiating_user_id FROM paige_durable_work WHERE id='${registeredWork.work_id}';`),actor,'historical initiating actor preserved despite removal');
 assert.equal(JSON.parse(run(service(`SELECT register_sales_payment_reconciliation_work('${tenant}','${paidOp}');`)).split('\n').at(-1)).work_id,registeredWork.work_id);
 deny(service(`SELECT register_sales_payment_reconciliation_work('${otherTenant}','${paidOp}');`),/Payment operation unavailable/);
 deny(service(`SELECT settle_sales_payment_reconciliation_work('${tenant}','${paidOp}');`),/Canonical payment readback required/);
 deny(`SET ROLE authenticated;SELECT register_sales_payment_reconciliation_work('${tenant}','${paidOp}');`,/permission denied/);
 const workClaims=await Promise.all([execute(service('SELECT claim_sales_payment_reconciliation_work(25);')),execute(service('SELECT claim_sales_payment_reconciliation_work(25);'))]);
 assert.equal(workClaims.filter(c=>c.code===0).length,2,workClaims.map(c=>c.err).join('\n'));
 const allClaims=workClaims.flatMap(c=>JSON.parse(c.out.trim().split('\n').at(-1)).claims);
 assert.equal(allClaims.length,1,'one worker wins each durable attempt');
 let workClaim=allClaims[0];assert.equal(workClaim.operation_id,paidOp);
 const completeWork=(claim,outcome,t=tenant)=>service(`SELECT complete_sales_payment_reconciliation_work('${t}','${claim.work_id}','${claim.server_idempotency_key}',${claim.attempt_count},'${outcome}');`);
 const heartbeatWork=claim=>service(`SELECT heartbeat_sales_payment_reconciliation_work('${tenant}','${claim.work_id}','${claim.server_idempotency_key}',${claim.attempt_count});`);
 deny(completeWork(workClaim,'settled'),/Canonical payment readback required/);
 deny(completeWork(workClaim,'unknown',otherTenant),/lease unavailable/);
 run(heartbeatWork(workClaim));
 const customerWait=run(`BEGIN;
 UPDATE paige_invoice_provider_operations SET state='customer_action_required',expires_at=now()+interval '24 hours' WHERE id='${paidOp}';
 SET ROLE service_role;SET test.actor='';SELECT complete_sales_payment_reconciliation_work('${tenant}','${workClaim.work_id}','${workClaim.server_idempotency_key}',1,'pending');
 RESET ROLE;UPDATE paige_durable_work SET updated_at=now()-interval '6 minutes' WHERE id='${workClaim.work_id}';
 SET ROLE service_role;SELECT claim_sales_payment_reconciliation_work(25);
 RESET ROLE;UPDATE paige_durable_work SET updated_at=now()-interval '65 minutes' WHERE id='${workClaim.work_id}';
 SET ROLE service_role;SELECT claim_sales_payment_reconciliation_work(25);ROLLBACK;`).split('\n').filter(v=>v.startsWith('{')).map(v=>JSON.parse(v)).filter(v=>v.claims);
 assert.equal(customerWait[0].claims.length,0,'unexpired customer checkout is checked hourly, not every five minutes');
 assert.equal(customerWait[1].claims.length,1);assert.equal(customerWait[1].claims[0].attempt_count,2);
 const pendingCompletion=JSON.parse(run(completeWork(workClaim,'unknown')).split('\n').at(-1));
 assert.equal(pendingCompletion.work_status,'blocked');assert.equal(pendingCompletion.blocked_reason,'provider_outcome_unknown');
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${paidOp}';`),'outcome_unknown','durable check cannot invent payment success');
 run(`UPDATE paige_durable_work SET updated_at=now()-interval '6 minutes' WHERE id='${workClaim.work_id}';`);
 const secondWorkClaim=JSON.parse(run(service('SELECT claim_sales_payment_reconciliation_work(25);')).split('\n').at(-1)).claims[0];
 assert.equal(secondWorkClaim.attempt_count,2);deny(completeWork(workClaim,'unknown'),/lease unavailable/);deny(heartbeatWork(workClaim),/lease unavailable/);
 run(`UPDATE paige_durable_work SET lease_until=now()-interval '1 second' WHERE id='${workClaim.work_id}';`);
 workClaim=JSON.parse(run(service('SELECT claim_sales_payment_reconciliation_work(25);')).split('\n').at(-1)).claims[0];
 assert.equal(workClaim.attempt_count,3);deny(completeWork(secondWorkClaim,'unknown'),/lease unavailable/);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${paidOp}';`),'outcome_unknown');
 const readback={provider:'stripe',merchant_account_id:'acct_fixtureA',environment:'test',provider_object_id:'cs_test_settlement',provider_transaction_id:'ch_fixture',provider_settlement_id:'txn_fixture',amount_minor:50000,currency:'usd',status:'verified',readback_reference:'req_fixture',invoice_id:invoice,client_id:client,invoice_version:3,issued_snapshot_version:1,provider_received_at:new Date(Date.now()-1000).toISOString()};
 const allocate=(fact=readback,t=tenant)=>service(`SELECT allocate_verified_sales_invoice_payment('${t}','${paidOp}','${paidToken}',${literal(fact)});`);
 deny(allocate({...readback,amount_minor:50001}),/readback|tuple|conflict/i);
 deny(allocate({...readback,status:'provider_accepted'}),/Invalid|readback/i);
 deny(allocate({...readback,card_number:'4111111111111111'}),/Invalid|readback/i);
 deny(allocate({...readback,currency:'eur'}),/readback|tuple|conflict/i);
 deny(allocate({...readback,environment:'live'}),/readback|tuple|conflict/i);
 deny(allocate({...readback,merchant_account_id:'acct_fixtureB'}),/readback|tuple|conflict/i);
 deny(allocate({...readback,provider_received_at:new Date(Date.now()+600000).toISOString()}),/readback|timestamp|payment time/i);
 deny(allocate(readback,otherTenant),/unavailable/i);
 run(`CREATE TRIGGER proof_work_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW WHEN (NEW.capability_key='sales_payment_reconcile') EXECUTE FUNCTION proof_rail_fail();`);
 deny(allocate(),/proof Rail unavailable/);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${paidOp}';`),'outcome_unknown');
 assert.equal(run(`SELECT status FROM paige_durable_work WHERE id='${workClaim.work_id}';`),'claimed');
 assert.equal(run(`SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${paidOp}';`),'0');
 run(`DROP TRIGGER proof_work_rail_fail ON paige_workspace_events;`);
 const settlementRace=await Promise.all([execute(allocate()),execute(allocate())]);
 assert.equal(settlementRace.filter(v=>v.code===0).length,2,settlementRace.map(v=>v.err).join('\n'));
 assert.equal(run(`SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${paidOp}';`),'1');
 const paidRead=JSON.parse(run(`SELECT _sales_invoice_read('${tenant}','${invoice}');`));
 assert.equal(paidRead.remaining_cents,290000);assert.equal(paidRead.manual_recorded_cents,10000);assert.equal(paidRead.provider_verified_cents,50000);
 assert.equal(paidRead.settlement,'mixed_recorded_partial');
 const ownerProviderReceipt=paidRead.payments.find(p=>p.provider_operation_id===paidOp);
 assert.equal(ownerProviderReceipt.evidence_kind,'provider_verified');assert.equal(ownerProviderReceipt.provider,'stripe');
 assert.equal(ownerProviderReceipt.provenance,'provider_verified');assert(ownerProviderReceipt.provider_verified_at);
 assert.equal(paidRead.payments.find(p=>p.method==='cash').provenance,'human_recorded');
 assert.equal(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${invoice}';`),'4');
 assert.equal(JSON.parse(run(allocate()).split('\n').at(-1)).replayed,true);
 deny(allocate({...readback,provider_transaction_id:'ch_other'}),/readback|conflict/i);
 deny(`SET ROLE authenticated;SELECT allocate_verified_sales_invoice_payment('${tenant}','${paidOp}','${paidToken}',${literal(readback)});`,/permission denied/i);
 deny(`INSERT INTO paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id) SELECT gen_random_uuid(),tenant_id,invoice_id,actor_user_id,'reversal',amount_cents,currency,'cash',now(),id FROM paige_invoice_payments WHERE provider_operation_id='${paidOp}';`,/provider|reconciliation/i);
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=md5('${paidOp}:settlement')::uuid AND actor_id IS NULL;`),'1');
 assert.equal(run(`SELECT status FROM paige_durable_work WHERE id='${workClaim.work_id}';`),'succeeded','allocator atomically closes existing readback work');
 const completedWork=JSON.parse(run(completeWork(workClaim,'settled')).split('\n').at(-1));assert.equal(completedWork.work_status,'succeeded');
 assert.equal(JSON.parse(run(completeWork(workClaim,'settled')).split('\n').at(-1)).replayed,true);
 deny(completeWork(workClaim,'unknown'),/terminal/);
 assert.equal(run(`SELECT terminal_outcome->>'verified_readback' FROM paige_durable_work WHERE id='${workClaim.work_id}';`),'true');
 run(`UPDATE tenant_members SET status='active' WHERE user_id='${actor}';UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
 const ownerOperations=JSON.parse(run(`SET ROLE authenticated;SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_invoice_payment_operations('${tenant}','${invoice}');`).split('\n').at(-1));
 assert(ownerOperations.rows.length>0);assert(ownerOperations.rows.length<=25);
 for(const row of ownerOperations.rows){assert(!('command' in row));assert(!('dispatch_claim_token' in row));assert(!('authority_fingerprint' in row));}
 const savedOwnerIntent=ownerOperations.rows.find(row=>row.id===paidOp);
 assert.equal(savedOwnerIntent.purpose,'deposit');assert.equal(savedOwnerIntent.invoice_version,3);assert.equal(savedOwnerIntent.issued_snapshot_version,1);
 assert.equal(savedOwnerIntent.reconciliation_status,'succeeded');assert.equal(savedOwnerIntent.reconciliation_reason,null);
 assert(!('reconciliation_status' in publicRequest().payment_request));assert(!('reconciliation_reason' in publicRequest().payment_request));
 assert(!('purpose' in publicRequest().payment_request));assert(!('invoice_version' in publicRequest().payment_request));
 deny(`SET ROLE authenticated;SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_invoice_payment_operations('${otherTenant}','${invoice}');`,/workspace unavailable/);
 deny(`SET ROLE authenticated;SET test.actor='${otherActor}';SET test.workspace='${otherTenant}';SELECT list_sales_invoice_payment_operations('${otherTenant}','${invoice}');`,/Invoice unavailable/);
 for(let index=0;index<26;index++){
  const historical=randomUUID();
  run(service(prepare(historical,{...command,expected_version:4,purpose:'partial',amount_minor:1})+`SELECT cancel_prepared_sales_invoice_payment_request('${tenant}','${historical}','recovery_abandoned');`));
 }
 const boundedOperations=JSON.parse(run(`SET ROLE authenticated;SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_invoice_payment_operations('${tenant}','${invoice}');`).split('\n').at(-1));
 assert.equal(boundedOperations.rows.length,25);assert.equal(boundedOperations.has_more,true);
 const paymentId=run(`SELECT id FROM paige_invoice_payments WHERE provider_operation_id='${paidOp}';`);
 const reversalPreview=JSON.parse(run(service(`SELECT preview_sales_invoice_command('${actor}','${tenant}',${literal({action:'invoice.reverse_manual_payment',invoice_id:invoice,expected_version:4,payment_id:paymentId,reason:'Correction'})});`)).split('\n').at(-1));
 assert.equal(reversalPreview.eligible,false);assert.match(reversalPreview.summary,/provider refund or reversal/);
 const ledger=JSON.parse(run(`SELECT _sales_invoice_payment_ledger('${tenant}','${invoice}',100,NULL);`));
 assert.equal(ledger.manual_recorded_cents,10000);assert.equal(ledger.provider_verified_cents,50000);
 assert.equal(ledger.payment_ledger.rows.filter(r=>r.provenance==='provider_verified').length,1);
 run(`INSERT INTO paige_invoice_access_grants VALUES(repeat('b',64),'${tenant}','${invoice}',1,NULL,now()+interval '1 hour');`);
 assert.equal(JSON.parse(run(service(`SELECT read_public_sales_invoice(repeat('b',64));`)).split('\n').at(-1)).provider_verified_cents,50000);
 assert.equal(run(service(`SELECT read_public_sales_invoice(repeat('c',64)) IS NULL;`)).split('\n').at(-1),'t');
 const remainingOp=randomUUID(),remainingToken=randomUUID();
 run(service(prepare(remainingOp,{...command,expected_version:4,purpose:'full',amount_minor:290000})));run(service(claim(remainingOp,remainingToken)));
 run(service(`SELECT register_pending_sales_payment_reconciliation_work('${tenant}','acct_fixtureA','test',25);`));
 const exhaustedClaim=JSON.parse(run(service('SELECT claim_sales_payment_reconciliation_work(25);')).split('\n').at(-1)).claims[0];
 assert.equal(exhaustedClaim.operation_id,remainingOp);
 run(`UPDATE paige_durable_work SET attempt_count=max_attempts,dispatch_started_attempt=max_attempts WHERE id='${exhaustedClaim.work_id}';`);
 const cappedClaim={...exhaustedClaim,attempt_count:25};
 assert.equal(JSON.parse(run(completeWork(cappedClaim,'pending')).split('\n').at(-1)).blocked_reason,'reconciliation_exhausted');
 const exhaustedOwnerRead=JSON.parse(run(`SET ROLE authenticated;SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_invoice_payment_operations('${tenant}','${invoice}');`).split('\n').at(-1)).rows.find(row=>row.id===remainingOp);
 assert.equal(exhaustedOwnerRead.reconciliation_status,'blocked');assert.equal(exhaustedOwnerRead.reconciliation_reason,'reconciliation_exhausted');
 assert(!('request_payload' in exhaustedOwnerRead));assert(!('server_idempotency_key' in exhaustedOwnerRead));
 assert.equal(JSON.parse(run(service('SELECT claim_sales_payment_reconciliation_work(25);')).split('\n').at(-1)).claims.length,0,'exhausted checks do not reset the same work');
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${remainingOp}';`),'dispatching');
 const availabilityBatch=()=>JSON.parse(run(service(`SELECT read_sales_balance_event_operations('${tenant}','acct_fixtureA','test','evt_lateAvailable',3);`)).split('\n').at(-1));
 assert.equal(availabilityBatch().rows[0].id,remainingOp,'signed account availability includes exhausted existing operation');
 deny(service(`SELECT read_sales_balance_event_operations('${otherTenant}','acct_fixtureA','test','evt_lateAvailable',3);`),/scope unavailable/);
 deny(service(`SELECT read_sales_balance_event_operations('${tenant}','acct_fixtureA','live','evt_lateAvailable',3);`),/scope unavailable/);
 const finalReadback={...readback,provider_object_id:'cs_test_final',provider_transaction_id:'ch_final',provider_settlement_id:'txn_final',amount_minor:290000,invoice_version:4};
 const settleFinal=()=>service(`SELECT allocate_verified_sales_invoice_payment('${tenant}','${remainingOp}','${remainingToken}',${literal(finalReadback)});`);
 run(`CREATE TRIGGER proof_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_rail_fail();`);
 deny(settleFinal(),/proof Rail unavailable/);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${remainingOp}';`),'dispatching');
 assert.equal(run(`SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${remainingOp}';`),'0');
 assert.equal(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${invoice}';`),'4');
 run(`DROP TRIGGER proof_rail_fail ON paige_workspace_events;
 CREATE FUNCTION proof_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'proof receipt unavailable';END $$;
 CREATE TRIGGER proof_receipt_fail BEFORE INSERT ON paige_invoice_payments FOR EACH ROW EXECUTE FUNCTION proof_receipt_fail();`);
 deny(settleFinal(),/proof receipt unavailable/);
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=md5('${remainingOp}:settlement')::uuid;`),'0');
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${remainingOp}';`),'dispatching');
 run(`DROP TRIGGER proof_receipt_fail ON paige_invoice_payments;`);
 deny(service(`SELECT allocate_verified_sales_invoice_payment('${tenant}','${remainingOp}','${remainingToken}',${literal({...finalReadback,provider_transaction_id:'ch_fixture',provider_settlement_id:'txn_fixture'})});`),/duplicate key|unique/i);
 assert.equal(run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${remainingOp}';`),'dispatching');
 run(settleFinal());
 run(service(`SELECT complete_sales_balance_event_readback('${tenant}','${remainingOp}','acct_fixtureA','test','evt_lateAvailable');`));
 assert.equal(availabilityBatch().rows.length,0,'event replay cannot add another allocation');
 assert.equal(run(`SELECT status FROM paige_durable_work WHERE id='${cappedClaim.work_id}';`),'succeeded','late verified settlement satisfies exhausted work');
 assert.equal(run(`SELECT attempt_count FROM paige_durable_work WHERE id='${cappedClaim.work_id}';`),'25','terminal close does not reset exhausted attempt budget');
 const fullRead=JSON.parse(run(`SELECT _sales_invoice_read('${tenant}','${invoice}');`));
 assert.equal(fullRead.remaining_cents,0);assert.equal(fullRead.provider_verified_cents,340000);assert.equal(fullRead.settlement,'mixed_recorded_settled');
 const collection=JSON.parse(run(`SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_collection_register('${tenant}','invoice',50,NULL);`).split('\n').at(-1));
 assert.equal(collection.rows[0].collection_required,false);assert.equal(collection.rows[0].remaining_cents,0);assert.equal(collection.rows[0].manual_recorded_cents,10000);assert.equal(collection.balance_basis,'canonical_receipt_allocations');
 deny(`SET test.actor='${actor}';SET test.workspace='${tenant}';SELECT list_sales_collection_register('${otherTenant}','invoice',50,NULL);`,/workspace changed/);
 deny(service(prepare(randomUUID(),{...command,expected_version:5,amount_minor:1,purpose:'partial'})),/amount or currency/);
 assert.equal(publicRequest().payment_request.provider_url,null,'fully allocated request cannot be paid again');
 // Extend this SAME disposable provider proof; this fixture is deliberately not
 // a migration. All incumbent cases use the extended schema and original
 // writers. The additional journal does not adjust any financial balance.
 if(process.argv.includes('--provider-observations')){
  if(process.argv.includes('--observation-link-baseline')){
   // Causal negative control, ONLY in this uniquely owned disposable database.
   // The first direct-pointer assertion must fail without the original guard.
   run('DROP TRIGGER e04_provider_observation_link_guard ON public.paige_invoice_provider_operations;');
  }
  let checks=read('supabase/tests/fixtures/exp04_provider_observation_checks.sql').replaceAll('\r\n','\n');
  for(const [placeholder,value]of [['__OPERATION__',paidOp],['__TOKEN__',paidToken],['__TENANT__',tenant]]){
   assert(/^[a-f0-9-]{36}$/i.test(value),'runner-owned synthetic UUID');
   assert(checks.includes(placeholder),'explicit observation fixture input');
   checks=checks.replaceAll(placeholder,value);
  }
  assert(!/__\w+__/.test(checks),'no unresolved observation fixture input');
  if(process.argv.includes('--observation-self-test')){
   const control=checks.replace('begin;\n',()=> 'begin;\nDROP TRIGGER e04_provider_observation_link_guard ON public.paige_invoice_provider_operations;\n');
   assert.notEqual(control,checks,'explicit transaction-scoped guard-removal control');
   deny(control,/FAIL: source counter cannot advance without a matching immutable observation accepted/);
   console.log('SALES_PROVIDER_OBSERVATION_LINK_CONTROL_PASS: missing guard produced the exact pointer-integrity failure; connection rollback restored the guard and fixtures.');
  }
  const result=run(checks).split('\n').find(line=>line.startsWith('{')&&line.includes('E04_PROVIDER_OBSERVATION_SELECTED_SCHEMA'));
  assert(result,'native observation checks returned their actual summary');
  observationProof=JSON.parse(result);
  assert.equal(observationProof.checks,36,'all selected-schema observation controls executed');
  console.log('SALES_PROVIDER_OBSERVATION_SQL_PASS: '+result);
  const paymentBefore=run(`SELECT to_jsonb(p) FROM public.paige_invoice_payments p WHERE provider_operation_id='${paidOp}';`);
  const workBefore=run(`SELECT to_jsonb(w) FROM public.paige_durable_work w JOIN public.paige_invoice_provider_operations p ON p.reconciliation_work_id=w.id WHERE p.id='${paidOp}';`);
  assert(workBefore,'original terminal settlement work exists');
  const invoiceVersion=Number(run(`SELECT billing_lifecycle_version FROM public.paige_invoices WHERE id='${invoice}';`));
  const snapshot={state:'observed',provider_transaction_id:'ch_fixture',provider_settlement_id:'txn_fixture',refunds:[{
   id:'re_concurrency',amount_minor:100,currency:'usd',created_at:new Date(Date.now()-60000).toISOString(),status:'pending',
   balance_transaction:null,failure_balance_transaction:null
  }],disputes:[]};
  const observe=(version,facts,reference)=>service(`BEGIN;SELECT jsonb_build_object('backend',pg_backend_pid(),'result',public.record_sales_invoice_provider_observation('${tenant}','${paidOp}','${paidToken}',${version},${literal(facts)},'${reference}'));SELECT pg_sleep(0.1);COMMIT;`);
  const same=await Promise.all([execute(observe(0,snapshot,'evt_race_same_a')),execute(observe(0,snapshot,'evt_race_same_b'))]);
  assert(same.every(r=>r.code===0),'both same-fact sessions resolve safely');
  const decoded=same.map(r=>JSON.parse(r.out.split('\n').find(line=>line.startsWith('{'))));
  assert.notEqual(decoded[0].backend,decoded[1].backend,'actual distinct PostgreSQL sessions');
  assert.equal(decoded[0].result.observation_id,decoded[1].result.observation_id,'one same-fact observation identity');
  assert.deepEqual(decoded.map(x=>x.result.replayed).sort(),[false,true],'one commit and one retained replay');
  assert.equal(run(`SELECT provider_observation_version FROM public.paige_invoice_provider_operations WHERE id='${paidOp}';`),'1');
  const failed=structuredClone(snapshot),canceled=structuredClone(snapshot);failed.refunds[0].status='failed';canceled.refunds[0].status='canceled';
  const changed=await Promise.all([execute('\\set VERBOSITY verbose\n'+observe(1,failed,'evt_race_changed_a')),execute('\\set VERBOSITY verbose\n'+observe(1,canceled,'evt_race_changed_b'))]);
  assert.equal(changed.filter(r=>r.code===0).length,1,'only one changed-fact session commits');
  assert.equal(changed.filter(r=>r.code!==0&&/40001/.test(r.err)&&/Payment observation changed/.test(r.err)).length,1,'other source incarnation receives exact stale-source refusal');
  assert.equal(run(`SELECT provider_observation_version FROM public.paige_invoice_provider_operations WHERE id='${paidOp}';`),'2');
  assert.equal(Number(run(`SELECT billing_lifecycle_version FROM public.paige_invoices WHERE id='${invoice}';`)),invoiceVersion+2,'invoice advances exactly once per accepted source');
  assert.equal(run(`SELECT count(*) FROM public.paige_invoice_operations WHERE command->>'action'='invoice.provider_observation';`),'2');
  assert.equal(run(`SELECT count(*) FROM public.paige_workspace_events WHERE detail->>'effect'='provider_observation_only';`),'2');
  assert.equal(run(`SELECT to_jsonb(p) FROM public.paige_invoice_payments p WHERE provider_operation_id='${paidOp}';`),paymentBefore,'concurrent observations preserve original payment');
  assert.equal(run(`SELECT to_jsonb(w) FROM public.paige_durable_work w JOIN public.paige_invoice_provider_operations p ON p.reconciliation_work_id=w.id WHERE p.id='${paidOp}';`),workBefore,'later observations never reopen or reset terminal settlement work');
  observationProof.concurrency_cases=2;
  if(process.argv.includes('--observation-work')){
   let workChecks=read('supabase/tests/fixtures/exp04_provider_observation_work_checks.sql');
   workChecks='begin;\n'+[ ['operation',paidOp],['tenant',tenant],['merchant','acct_fixtureA'],['charge','ch_fixture'],['settlement','txn_fixture'] ].map(([key,value])=>`SELECT set_config('test.e04_work_${key}','${value}',true);`).join('\n')+'\n'+workChecks+'\nrollback;';
   if(process.argv.includes('--observation-self-test')){
    const definitionBefore=run("SELECT pg_get_functiondef('public.register_sales_provider_observation_work(uuid,uuid,text,text,text,text)'::regprocedure);");
    const candidate=read('supabase/tests/fixtures/exp04_provider_observation_work.sql');
    const mutant=candidate.replaceAll('create function','create or replace function').replace('or op.merchant_account_id is distinct from _merchant_account_id','');
    assert.notEqual(mutant,candidate.replaceAll('create function','create or replace function'),'remove only incoming merchant binding control');
    deny(workChecks.replace('begin;\n',()=> 'begin;\n'+mutant+'\n'),/FAIL: different merchant cannot register event work accepted/);
    assert.equal(run("SELECT pg_get_functiondef('public.register_sales_provider_observation_work(uuid,uuid,text,text,text,text)'::regprocedure);"),definitionBefore,'negative-control connection restores exact original event writer');
    console.log('SALES_PROVIDER_OBSERVATION_WORK_CONTROL_PASS: removing merchant binding caused the exact cross-merchant admission failure; rollback restored the original writer.');
   }
   const line=run(workChecks).split('\n').find(x=>x.startsWith('{')&&x.includes('E04_PROVIDER_OBSERVATION_WORK'));
   assert(line,'native work proof summary');observationProof.work=JSON.parse(line);
   assert.equal(observationProof.work.checks,39,'all native event-work controls executed');
   const event='evt_workRealSessions';
   const registerEvent=()=>service(`BEGIN;SELECT jsonb_build_object('backend',pg_backend_pid(),'result',public.register_sales_provider_observation_work('${tenant}','${paidOp}','${event}','acct_fixtureA','test','ch_fixture'));SELECT pg_sleep(0.1);COMMIT;`);
   const registered=await Promise.all([execute(registerEvent()),execute(registerEvent())]);
   assert(registered.every(r=>r.code===0),'both event-registration sessions return safely');
   const registeredRows=registered.map(r=>JSON.parse(r.out.split('\n').find(x=>x.startsWith('{'))));
   assert.notEqual(registeredRows[0].backend,registeredRows[1].backend,'two real event-registration sessions');
   assert.equal(registeredRows[0].result.work_id,registeredRows[1].result.work_id,'one original event-work identity');
   const jsonResult=out=>JSON.parse(out.split('\n').find(x=>x.startsWith('{')));
   const batch=jsonResult(run(service('SELECT claim_sales_provider_observation_work(3);')));
   assert.equal(batch.claims.length,1,'one event occurrence available for dispatch');
   const c=batch.claims[0];assert.equal(c.work_id,registeredRows[0].result.work_id);
   const context=jsonResult(run(service(`SELECT read_sales_provider_observation_work_context('${tenant}','${c.work_id}','${c.server_idempotency_key}',${c.attempt_count});`)));
   const facts=structuredClone(snapshot);facts.refunds[0].id='re_workrace';
   const completeEvent=()=>service(`BEGIN;SELECT jsonb_build_object('backend',pg_backend_pid(),'result',public.complete_sales_provider_observation_work('${tenant}','${c.work_id}','${c.server_idempotency_key}',${c.attempt_count},${context.observation_version},${literal(facts)}));SELECT pg_sleep(0.1);COMMIT;`);
   const finished=await Promise.all([execute(completeEvent()),execute(completeEvent())]);
   assert(finished.every(r=>r.code===0),'both same-work completion sessions recover safely');
   const finishedRows=finished.map(r=>JSON.parse(r.out.split('\n').find(x=>x.startsWith('{'))));
   assert.notEqual(finishedRows[0].backend,finishedRows[1].backend,'two real event-completion sessions');
   assert.deepEqual(finishedRows.map(r=>r.result.replayed).sort(),[false,true],'one event completion and one lost-response replay');
   assert.deepEqual(finishedRows[0].result.receipt,finishedRows[1].result.receipt,'one immutable journal receipt for both attempts');
   assert.equal(Number(run(`SELECT provider_observation_version FROM public.paige_invoice_provider_operations WHERE id='${paidOp}';`)),context.observation_version+1,'event race records exactly one new source incarnation');
   assert.equal(run(`SELECT count(*) FROM public.paige_workspace_events WHERE source_id='${c.work_id}' AND outcome='capability_succeeded';`),'1','one actual work completion Rail');
   const terminalBefore=run(`SELECT to_jsonb(w) FROM public.paige_durable_work w WHERE id='${c.work_id}';`);
   run(registerEvent());
   assert.equal(run(`SELECT to_jsonb(w) FROM public.paige_durable_work w WHERE id='${c.work_id}';`),terminalBefore,'completed event redelivery never resets a terminal work row');
   assert.equal(run(`SELECT to_jsonb(p) FROM public.paige_invoice_payments p WHERE provider_operation_id='${paidOp}';`),paymentBefore,'event races preserve captured payment exactly');
   assert.equal(run(`SELECT to_jsonb(w) FROM public.paige_durable_work w JOIN public.paige_invoice_provider_operations p ON p.reconciliation_work_id=w.id WHERE p.id='${paidOp}';`),workBefore,'event races preserve original terminal settlement work exactly');
   observationProof.work.concurrency_cases=1;
   console.log('SALES_PROVIDER_OBSERVATION_WORK_PASS: '+JSON.stringify(observationProof.work));
  }
  console.log('SALES_PROVIDER_OBSERVATION_CONCURRENCY_PASS: two actual-session cases; same facts commit once, changed facts refuse the stale incarnation; original payment and terminal settlement work unchanged.');
 }
 run(`UPDATE paige_invoices SET status='void' WHERE id='${invoice}';`);
 assert.equal(publicRequest(),null,'void invoice bearer refused');
 if(observationProof){
  const files=['scripts/sql/sales-provider-operation-proof.mjs','supabase/tests/fixtures/exp04_provider_observation.sql','supabase/tests/fixtures/exp04_provider_observation_checks.sql'];
  if(process.argv.includes('--observation-work'))files.push('supabase/tests/fixtures/exp04_provider_observation_work.sql','supabase/tests/fixtures/exp04_provider_observation_work_checks.sql');
  const hashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(read(file)).digest('hex')]));
  mkdirSync(new URL('../../work/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../work/sales-provider-observation-proof.json',import.meta.url),JSON.stringify({
   ...observationProof,status:'PASS',observed_at:new Date().toISOString(),source_hashes:hashes,
   incumbent_lifecycle_passed:true,guard_installed_before_incumbent_cases:true,
   link_guard_negative_control:process.argv.includes('--observation-self-test'),
   native_carrier:'UNPUBLISHED',activation:'UNMOUNTED',hosted_authentication:'UNVERIFIED',provider_settlement:'UNVERIFIED',customer_acceptance:'UNVERIFIED'
  },null,2)+'\n');
 }
 console.log('SALES_PROVIDER_OPERATION_SQL_PASS: real PostgreSQL exact scoped operation/dispatch replay, concurrent once-only allocation, partial/full canonical balance, provider/manual provenance, system Rail after owner deactivation, receipt/Rail rollback, truthful Collections zero-balance stop projection. Local synthetic provider facts; hosted/provider/authenticated production UNVERIFIED.');
} finally {database='postgres';run(`DROP DATABASE ${db};`);}
