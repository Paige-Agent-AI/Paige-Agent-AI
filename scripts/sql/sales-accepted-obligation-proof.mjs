// Extend the original Sales SQL proof in a uniquely owned localhost database.
// Actual tracked function bodies + original neutral commercial metadata; reduced
// table types/Test Auth seam. Not full schema, hosted identity, consent or settlement.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const [binary,port,user,directory]=process.argv.slice(2);
assert(binary&&/^\d+$/.test(port??'')&&user&&path.isAbsolute(directory??''),'explicit local proof target required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replaceAll('\r\n','\n');
const normalize=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
const database='e04_obligations_'+crypto.randomUUID().replaceAll('-','');
const migration=read('supabase/migrations/20271126010010_e04_accepted_invoice_payment_obligations.sql');
const metadata=JSON.parse(read('supabase/tests/fixtures/exp04_accepted_obligation_types.json'));
const fixtureSql=read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql');
const match=/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/.exec(fixtureSql);
assert(match,'original captured metadata fixture');const fixture=JSON.parse(match[1]);
assert.match(fixture.scope,/^Synthetic/);
function original(file,name){
 const source=read('supabase/migrations/'+file);
 const start=source.search(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\(','i'));
 assert(start>=0,'tracked original function '+name);
 const tail=source.slice(start),body=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(tail);
 assert(body,'original dollar body '+name);
 const end=tail.indexOf(body[1],body.index+body[0].length);
 assert(end>=0,'closed original body '+name);
 return tail.slice(0,end+body[1].length)+';';
}
const files={
 _paige_commercial_canonical_json:'20271113230004_agreement_commercial_presentation.sql',
 _paige_retained_commercial_payload:'20271113810004_e04_accepted_commercial_evidence.sql',
 _paige_accepted_commercial_payload:'20271113810004_e04_accepted_commercial_evidence.sql',
 read_sales_accepted_agreement:'20271113810004_e04_accepted_commercial_evidence.sql',
 _sales_collection_accepted_total_evidence:'20271121131304_sales_collection_total_evidence.sql',
 _sales_invoice_balance_rows:'20270601000002_sales_performance_contract.sql',
 prepare_sales_invoice_payment_request:'20270597000001_sales_invoice_provider_operations.sql',
 claim_sales_invoice_payment_request:'20270597000001_sales_invoice_provider_operations.sql',
 list_sales_invoice_payment_operations:'20270597000001_sales_invoice_provider_operations.sql',
 _sales_invoice_actor:'20270543000000_sales_invoice_lifecycle.sql',
 _sales_payment_operation_service:'20270597000001_sales_invoice_provider_operations.sql',
};
const definitions=Object.fromEntries(Object.entries(files).map(([name,file])=>[name,original(file,name)]));
const financial=Object.entries(definitions).map(([identity,definition])=>({identity:identity+'(',definition}));
let activeDatabase='postgres',created=false,passes=0;const log=[];
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
function run(sql){const r=cp.spawnSync(binary,['-X','-w','-h','127.0.0.1','-p',port,'-U',user,'-d',activeDatabase,'-v','ON_ERROR_STOP=1','-qAt'],{input:sql,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16e6});if(r.status!==0)throw Error(r.stderr||r.error?.message||'local SQL refused');return r.stdout.trim();}
function check(label,value){assert.equal(value,true,label);passes++;log.push('PASS '+label);}
const observe=()=>JSON.parse(run(`SELECT public._sales_invoice_accepted_obligations(i,'${fixture.effective.signing_id}') FROM public.paige_invoices i WHERE id='${fixture.effective.invoice_id}';`));
function withPatch(sql,reason,label){const result=JSON.parse(run(`BEGIN;${sql} SELECT public._sales_invoice_accepted_obligations(i,'${fixture.effective.signing_id}') FROM public.paige_invoices i WHERE id='${fixture.effective.invoice_id}';ROLLBACK;`));check(label,result.state==='held'&&result.reason===reason&&result.obligations.length===0);}
try{
 assert.equal(normalize(run('SHOW data_directory;')),normalize(directory),'refuse another cluster');
 assert.match(database,/^e04_obligations_[a-f0-9]{32}$/);run('CREATE DATABASE '+database+';');created=true;activeDatabase=database;
 run(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;`);
 for(const sql of metadata.enum_ddl??[])run(sql);
 for(const sql of metadata.table_ddl)run(sql);
 // Actual canonical actor/service function bodies, reduced fixture identity tables.
 // Test-only Auth seam is not a hosted-authentication or full-schema claim.
 run(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text,role text);
 INSERT INTO auth.users(id) VALUES('${fixture.actor_id}');
 INSERT INTO tenants VALUES('${fixture.tenant_id}','active');
 INSERT INTO profiles VALUES('${fixture.actor_id}','${fixture.tenant_id}');
 INSERT INTO tenant_members VALUES('${fixture.tenant_id}','${fixture.actor_id}','active','owner');
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;`);
 for(const name of ['_sales_invoice_actor','_sales_payment_operation_service'])run(financial.find(r=>r.identity.startsWith(name+'(')).definition);
 run('CREATE TABLE e04_commercial_fixture(data jsonb NOT NULL);'+fixtureSql);
 for(const name of ['tenant_client_agreements','paige_agreements','paige_agreement_signers','paige_agreement_events','paige_sales_collection_operations','paige_workspace_events','paige_invoices']){
  const rows=structuredClone(fixture.records[name]);
  if(name==='tenant_client_agreements')for(const row of rows)row.status='active';
  if(name==='paige_invoices')for(const row of rows)Object.assign(row,{status:'issued',billing_lifecycle_version:2,billing_issued_snapshot_version:1,billing_issued_at:'2026-10-29T12:00:00Z',billing_document:{schema_version:1,scope:'Synthetic issued metadata only'}});
  run(`INSERT INTO public.${name} SELECT * FROM jsonb_populate_recordset(NULL::public.${name},${literal(rows)});`);
 }
 const find=name=>definitions[name];
 for(const name of ['_paige_commercial_canonical_json','_paige_retained_commercial_payload','_paige_accepted_commercial_payload','_sales_collection_accepted_total_evidence','_sales_invoice_balance_rows','read_sales_accepted_agreement','prepare_sales_invoice_payment_request','claim_sales_invoice_payment_request','list_sales_invoice_payment_operations']){const source=find(name);assert(source,'actual original source '+name);run(source);}
 run('REVOKE ALL ON FUNCTION public.read_sales_accepted_agreement(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.read_sales_accepted_agreement(uuid,uuid,uuid) TO authenticated;');
 run('REVOKE ALL ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb),public.claim_sales_invoice_payment_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb),public.claim_sales_invoice_payment_request(uuid,uuid,uuid) TO service_role;');
 const old=run(`SELECT jsonb_build_object('oid',p.oid,'body',md5(p.prosrc),'acl',p.proacl,'config',p.proconfig,'owner',p.proowner) FROM pg_proc p WHERE p.oid='public.read_sales_accepted_agreement(uuid,uuid,uuid)'::regprocedure;`);
 run(migration);
 check('old reader OID/body/ACL/config/owner unchanged',run(`SELECT jsonb_build_object('oid',p.oid,'body',md5(p.prosrc),'acl',p.proacl,'config',p.proconfig,'owner',p.proowner) FROM pg_proc p WHERE p.oid='public.read_sales_accepted_agreement(uuid,uuid,uuid)'::regprocedure;`)===old);
 check('new private helper has no browser/service grant',run(`SELECT NOT has_function_privilege('anon','public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','EXECUTE');`)==='t');
 check('unique obligation API keeps original audience and no overload',run(`SELECT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE') AND p.pronargdefaults=0 AND (SELECT count(*) FROM pg_proc q JOIN pg_namespace n ON n.oid=q.pronamespace WHERE n.nspname='public' AND q.proname='read_sales_accepted_agreement')=1 FROM pg_proc p WHERE p.oid='public.read_sales_accepted_invoice_obligations(uuid,uuid,uuid)'::regprocedure;`)==='t');
 const initial=observe();check('all eleven exact original accepted obligations',initial.state==='available'&&initial.obligations.length===11);
 check('initial500 and ten300 retain single3500 principal',initial.obligations[0].scheduled_minor===50000&&initial.obligations.slice(1).every(r=>r.scheduled_minor===30000)&&initial.obligations.reduce((s,r)=>s+r.scheduled_minor,0)===350000);
 check('working revision cannot replace accepted dates',initial.obligations[0].due_date==='2026-10-15'&&initial.obligations[0].reference.terms_version===1);
 check('current invoice version stays distinct from accepted signing',initial.invoice_version===2&&initial.obligations[0].reference.signing_version===fixture.effective.signing_version);
 const serviceRead=(reference=initial.obligations[0].reference,actor=fixture.actor_id,tenant=fixture.tenant_id,invoice=fixture.effective.invoice_id)=>`SELECT public.read_sales_invoice_payment_obligation('${actor}','${tenant}','${invoice}',${literal(reference)});`;
 const scoped=JSON.parse(run('SET ROLE service_role;'+serviceRead()));
 check('original service actor resolves exact target without customer JWT',scoped.tenant_id===fixture.tenant_id&&scoped.client_id===fixture.client_id&&scoped.invoice_id===fixture.effective.invoice_id&&JSON.stringify(scoped.obligation)===JSON.stringify(initial.obligations[0]));
 function deniedSql(statement,pattern,label){assert.throws(()=>run(statement),pattern,label);passes++;log.push('PASS '+label);}
 deniedSql('SET ROLE authenticated;'+serviceRead(),/permission denied/,'ordinary authenticated caller cannot invoke service admission');
 deniedSql('SET ROLE anon;'+serviceRead(),/permission denied/,'anonymous caller cannot invoke service admission');
 deniedSql(serviceRead(),/Payment operation unavailable/,'owner SQL role cannot impersonate command service');
 deniedSql(`SET ROLE service_role;SET test.actor='${fixture.actor_id}';`+serviceRead(),/Payment operation unavailable/,'service with asserted customer JWT is refused');
 deniedSql('SET ROLE service_role;'+serviceRead(initial.obligations[0].reference,fixture.actor_id,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),/workspace unavailable/,'foreign workspace is denied by original actor');
 deniedSql('SET ROLE service_role;'+serviceRead({...initial.obligations[0].reference,sequence:99}),/obligation changed/,'unaccepted target selector has no source');
 deniedSql('SET ROLE service_role;'+serviceRead({...initial.obligations[0].reference,extra:true}),/obligation changed/,'service reference cannot acquire extra fields');
 deniedSql(`BEGIN;UPDATE tenant_members SET status='inactive';SET ROLE service_role;`+serviceRead(),/authority unavailable/,'inactive canonical membership denies source');
 deniedSql(`BEGIN;UPDATE auth.users SET deleted_at=now();SET ROLE service_role;`+serviceRead(),/actor unavailable/,'deleted actor denies source');
 const targetCommand=row=>({action:'invoice.payment_request',invoice_id:fixture.effective.invoice_id,client_id:fixture.client_id,expected_version:initial.invoice_version,issued_snapshot_version:initial.issued_snapshot_version,provider:'stripe',purpose:row.reference.sequence===1?'deposit':'installment',amount_minor:row.remaining_minor,currency:'usd',obligation:row});
 const targetCheck=command=>run(`SELECT public._sales_invoice_require_accepted_obligation(i,${literal(command)}) FROM public.paige_invoices i WHERE id='${fixture.effective.invoice_id}';`);
 check('exact accepted deposit passes native final guard',targetCheck(targetCommand(initial.obligations[0]))==='');
 check('exact accepted installment passes same native guard',targetCheck(targetCommand(initial.obligations[1]))==='');
 function refuseTarget(command,code,label){const statement=`SELECT public._sales_invoice_require_accepted_obligation(i,${literal(command)}) FROM public.paige_invoices i WHERE id='${fixture.effective.invoice_id}'`;check(label,run(`DO $check$ BEGIN BEGIN EXECUTE ${"'"+statement.replaceAll("'","''")+"'"};EXCEPTION WHEN OTHERS THEN IF SQLSTATE='${code}' THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'target unexpectedly accepted';END $check$;`)==='');}
 for(const [change,label] of [
  [c=>({...c,amount_minor:49999}),'changed amount'],
  [c=>({...c,obligation:{...c.obligation,due_date:'2026-10-16'}}),'changed date'],
  [c=>({...c,obligation:{...c.obligation,source_digest:'0'.repeat(64)}}),'wrong source digest'],
  [c=>({...c,obligation:{...c.obligation,extra:true}}),'extra target field'],
  [c=>({...c,expected_version:3}),'stale invoice revision'],
  [c=>({...c,client_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}),'foreign client selector'],
 ])refuseTarget(change(targetCommand(initial.obligations[0])),'40001','native target refuses '+label);
 refuseTarget({...targetCommand(initial.obligations[1]),purpose:'deposit'},'22023','later installment cannot be relabelled deposit');
 refuseTarget({...targetCommand(initial.obligations[0]),purpose:'full'},'22023','accepted target cannot be relabelled full');
 withPatch(`UPDATE tenant_client_agreements SET status='paused';`,'commercial_terms_inactive','paused terms withhold action targets');
 withPatch(`UPDATE paige_invoices SET billing_draft_version=2;`,'accepted_source_changed','changed original invoice draft withholds targets');
 withPatch(`UPDATE paige_invoices SET billing_document=NULL;`,'invoice_not_issued','missing issued evidence withholds targets');
 withPatch(`UPDATE paige_agreement_signers SET esign_consent_at=NULL;`,'accepted_source_changed','missing original consent evidence withholds targets');
 withPatch(`DELETE FROM paige_workspace_events;`,'accepted_source_changed','missing original effectuation Rail withholds targets');
 const paymentIds=[];
 function receipt(row,amount,environment='live',targeted=true){
  const operation=crypto.randomUUID(),payment=crypto.randomUUID();paymentIds.push(payment);
  const command={action:'invoice.payment_request',invoice_id:fixture.effective.invoice_id,client_id:fixture.client_id,expected_version:2,issued_snapshot_version:1,provider:'stripe',purpose:row.reference.sequence===1?'deposit':'installment',amount_minor:amount,currency:'usd',merchant_account_id:'acct_fixture',merchant_binding_version:1,environment,...(targeted?{obligation:{...row,remaining_minor:amount}}:{})};
  const op={id:operation,tenant_id:fixture.tenant_id,invoice_id:fixture.effective.invoice_id,client_id:fixture.client_id,actor_user_id:fixture.actor_id,state:'settled',allocation_payment_id:payment,amount_minor:amount,currency:'usd',environment,provider:'stripe',command,verified_readback:{scope:'Simulated provider metadata only'}};
  const paid={id:payment,tenant_id:fixture.tenant_id,invoice_id:fixture.effective.invoice_id,kind:'receipt',amount_cents:amount,currency:'usd',evidence_kind:'provider_verified',provider:'stripe',provider_operation_id:operation,provider_environment:environment};
  run(`INSERT INTO paige_invoice_provider_operations SELECT * FROM jsonb_populate_record(NULL::paige_invoice_provider_operations,${literal(op)});INSERT INTO paige_invoice_payments SELECT * FROM jsonb_populate_record(NULL::paige_invoice_payments,${literal(paid)});UPDATE paige_invoices SET billing_lifecycle_version=billing_lifecycle_version+1;`);
 }
 receipt(initial.obligations[0],50000);let paid=observe();check('same original settled500 allocates only first target',paid.state==='available'&&paid.obligations[0].remaining_minor===0&&paid.obligations[1].remaining_minor===30000&&paid.invoice_version===3);
 withPatch(`UPDATE paige_invoice_payments SET currency='eur';`,'allocation_required','wrong receipt currency cannot fulfill accepted principal');
 withPatch(`UPDATE paige_invoice_payments SET provider='paypal';`,'allocation_required','wrong receipt processor cannot fulfill accepted target');
 const manual={id:crypto.randomUUID(),tenant_id:fixture.tenant_id,invoice_id:fixture.effective.invoice_id,kind:'receipt',amount_cents:10000,currency:'usd',evidence_kind:'manual_recorded'};
 withPatch(`INSERT INTO paige_invoice_payments SELECT * FROM jsonb_populate_record(NULL::paige_invoice_payments,${literal(manual)});`,'allocation_required','unassigned manual receipt is never guessed FIFO');
 withPatch(`UPDATE paige_invoice_payments SET provider_environment='test';`,'test_payment_evidence','TEST evidence cannot fulfill actual obligations');
 withPatch(`UPDATE paige_invoice_provider_operations SET command=jsonb_set(command,'{obligation,source_digest}','"invalid"');`,'allocation_required','wrong accepted digest cannot allocate a target');
 receipt(initial.obligations[1],12500);paid=observe();check('partial allocation retains exact remaining dated amount',paid.state==='available'&&paid.obligations[1].remaining_minor===17500);
 receipt(initial.obligations[1],17500);for(const row of initial.obligations.slice(2))receipt(row,30000);
 const completed=observe();check('all original receipts allocate exactly original principal once',completed.state==='available'&&completed.obligations.every(r=>r.remaining_minor===0)&&run('SELECT count(*) FROM paige_invoices;')==='1');
 check('financial source observation does not declare service completion',!('service_completed'in completed)&&!('engagement_completed'in completed));
 run(migration);check('same migration replay preserves exact observation',JSON.stringify(observe())===JSON.stringify(completed));
 check('replay still preserves entire old reader metadata',run(`SELECT jsonb_build_object('oid',p.oid,'body',md5(p.prosrc),'acl',p.proacl,'config',p.proconfig,'owner',p.proowner) FROM pg_proc p WHERE p.oid='public.read_sales_accepted_agreement(uuid,uuid,uuid)'::regprocedure;`)===old);
 log.push('BOUNDARY: minimal-table original-source composition and simulated provider metadata only; full-schema writer/role/concurrency/provider/customer proof owed.');
 console.log(JSON.stringify({passes,scope:'isolated original-source PostgreSQL composition',database,sourceHash:crypto.createHash('sha256').update(migration).digest('hex')}));
}catch(e){log.push('FAIL '+e.stack);console.error(e.message);process.exitCode=1;}
finally{
 if(created){activeDatabase='postgres';try{run('DROP DATABASE '+database+';');log.push('Disposable database removed.');}catch(e){log.push('CLEANUP FAILED '+e.message);process.exitCode=1;}}
 console.log(log.join('\n'));
}
