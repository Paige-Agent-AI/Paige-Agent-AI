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
// Optional extension of this SAME reduced-schema proof; original checks run first.
// Native actor/governance/replay/writer bodies are original tracked source. Result
// projection, preview predecessor and Rail ports below are explicit local stand-ins;
// this does not prove full-schema RLS, real receipts, hosted Auth or customer use.
const manualMode=process.argv.includes('--manual-allocations');
const manualBaseline=process.argv.includes('--manual-baseline');
const allocationBaseline=process.argv.includes('--allocation-baseline');
const financial=Object.entries(definitions).map(([identity,definition])=>({identity:identity+'(',definition}));
let activeDatabase='postgres',created=false,passes=0,manualSourceHash=null;const log=[];
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
 if(manualMode){
  run(`DELETE FROM public.paige_invoice_payments;DELETE FROM public.paige_invoice_provider_operations;
   UPDATE public.paige_invoices SET billing_lifecycle_version=2;
   ALTER TABLE public.paige_invoice_payments ADD PRIMARY KEY(id);
   ALTER TABLE public.paige_invoice_payments ALTER COLUMN evidence_kind SET DEFAULT 'manual_recorded';
   CREATE UNIQUE INDEX manual_proof_one_full_reversal ON public.paige_invoice_payments(reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
   CREATE TABLE public.paige_invoice_operations(id uuid PRIMARY KEY,tenant_id uuid,invoice_id uuid,actor_user_id uuid,command jsonb,result jsonb,created_at timestamptz DEFAULT now());
   CREATE TABLE public.messages(id uuid PRIMARY KEY,meta jsonb);
   CREATE FUNCTION public._sales_invoice_read(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('scope','Synthetic projection port only')$$;
   CREATE FUNCTION public.record_capability_run(t uuid,a uuid,tool text,outcome text,op uuid,detail text) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
    INSERT INTO public.paige_workspace_events(id,tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key)
    VALUES(op,t,a,'capability',op,1,outcome,tool);RETURN op;END$$;
   CREATE FUNCTION public._preview_sales_invoice_before_provider(a uuid,t uuid,c jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
    PERFORM public._sales_invoice_actor(a,t);RETURN jsonb_build_object('eligible',true,'summary','Synthetic predecessor consequence only; not production preview evidence.','scope','Synthetic predecessor port only');END$$;`);
  for(const name of ['_sales_invoice_governance','read_sales_invoice_command_result'])run(original('20270543000000_sales_invoice_lifecycle.sql',name));
  let incumbent=original('20270543000000_sales_invoice_lifecycle.sql','execute_sales_invoice_command')
   .replace('public.execute_sales_invoice_command(','public._sales_invoice_prior_execute(')
   .replace("allowed:=ARRAY['action','invoice_id','expected_version'];","allowed:=ARRAY['action','invoice_id','expected_version','template'];")
   .replace("r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb","(r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb AND r.billing_draft->'schema_version' IS DISTINCT FROM '3'::jsonb)");
  run(incumbent);
  run(original('20270553000000_sales_invoice_preferences.sql','execute_sales_invoice_command'));
  run(original('20270597000001_sales_invoice_provider_operations.sql','preview_sales_invoice_command'));
  run(`REVOKE ALL ON FUNCTION public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
   REVOKE ALL ON FUNCTION public._sales_invoice_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public._sales_invoice_actor(uuid,uuid) TO service_role;
   REVOKE ALL ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb),public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
   GRANT EXECUTE ON FUNCTION public.preview_sales_invoice_command(uuid,uuid,jsonb),public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) TO service_role;`);
  check('tracked incumbent manual executor matches actual reviewed native source',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure;")==='fcbb272628a13b5dc218bb72489b5c0a');
  check('tracked incumbent public preview matches actual reviewed native source',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.preview_sales_invoice_command(uuid,uuid,jsonb)'::regprocedure;")==='6a7e67779cc1f1cf04f7ba9b63306b29');
  const nativeBefore=run(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'path',proconfig,'args',pg_get_function_arguments(oid),'return',pg_get_function_result(oid),'definer',prosecdef) ORDER BY oid)
   FROM pg_proc WHERE oid IN ('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,'public.preview_sales_invoice_command(uuid,uuid,jsonb)'::regprocedure,'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)'::regprocedure);`);
  const manualForward=read('supabase/migrations/20271126080004_e04_original_manual_payment_allocations.sql');
  manualSourceHash=crypto.createHash('sha256').update(manualForward).digest('hex');
  if(!manualBaseline&&!allocationBaseline)run(manualForward);
  // Test-only caller context ports; the production API still uses the ORIGINAL
  // current_user_tenant_id/auth.uid/actor contract, never a supplied actor.
  run(`CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.tenant',true),'')::uuid$$;`);
  const receiptRead=(payment,expected=version(),tenant=fixture.tenant_id)=>`public.read_sales_invoice_manual_allocations('${tenant}','${fixture.effective.invoice_id}',${expected},'${payment}')`;
  const asOwner=sql=>`SET ROLE authenticated;SET test.actor='${fixture.actor_id}';SET test.tenant='${fixture.tenant_id}';SELECT ${sql};RESET ROLE;RESET test.actor;RESET test.tenant;`;
  const inspectReceipt=(payment,expected)=>JSON.parse(run(asOwner(receiptRead(payment,expected))).split('\n').find(x=>x.startsWith('{')));
  const denyReceipt=(payment,label,{expected=version(),tenant=fixture.tenant_id,patch='',state='42501'}={})=>{
   run(`BEGIN;${patch}SET ROLE authenticated;SET test.actor='${fixture.actor_id}';SET test.tenant='${fixture.tenant_id}';
    DO $deny$ BEGIN BEGIN PERFORM ${receiptRead(payment,expected,tenant)};RAISE EXCEPTION 'Expected receipt read refusal absent' USING ERRCODE='P9001';
    EXCEPTION WHEN SQLSTATE '${state}' THEN NULL;END;END $deny$;RESET ROLE;ROLLBACK;`);check(label,true);
  };
  const recordedAt='2026-10-01T12:00:00.000Z';
  const governance=action=>({actor_user_id:fixture.actor_id,tenant_id:fixture.tenant_id,action,
   tool:action==='invoice.record_manual_payment'?'sales_record_manual_payment':'sales_reverse_manual_payment',
   approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true});
  const nativeCall=(op,c)=>`public.execute_sales_invoice_command('${fixture.actor_id}','${fixture.tenant_id}','${op}',${literal(c)},${literal(governance(c.action))})`;
  const native=(op,c)=>`SET ROLE service_role;SELECT ${nativeCall(op,c)};RESET ROLE;`;
  const expectRefusal=(op,c,label,patch='',state='22023')=>{
   assert.match(state,/^[A-Z0-9]{5}$/);
   run(`BEGIN;${patch}SET ROLE service_role;DO $refusal$ BEGIN BEGIN
    PERFORM ${nativeCall(op,c)};RAISE EXCEPTION 'Expected native refusal absent' USING ERRCODE='P9001';
    EXCEPTION WHEN SQLSTATE '${state}' THEN NULL;END;END $refusal$;RESET ROLE;ROLLBACK;`);check(label,true);
  };
  const version=()=>Number(run('SELECT billing_lifecycle_version FROM public.paige_invoices;'));
  const manualCommand=(amount,allocations)=>({action:'invoice.record_manual_payment',invoice_id:fixture.effective.invoice_id,expected_version:version(),amount_cents:amount,currency:'usd',method:'cash',received_at:recordedAt,reference:null,notes:null,...(allocations?{allocations}:{})});
  const reverse=(payment_id)=>({action:'invoice.reverse_manual_payment',invoice_id:fixture.effective.invoice_id,expected_version:version(),payment_id,reason:'Synthetic correction of the original business record, no refund'});
  async function authorityRace(label,table,cmd){
   assert(['paige_invoices','paige_agreements'].includes(table));
   const token=crypto.randomUUID().replaceAll('-',''),blockName='e04_block_'+token,writerName='e04_write_'+token,op=crypto.randomUUID();
   const args=['-X','-w','-h','127.0.0.1','-p',port,'-U',user,'-d',activeDatabase,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-qAt'];
   const child=()=>{const process=cp.spawn(binary,args,{windowsHide:true});let out='',err='';const done=new Promise((resolve,reject)=>{process.stdout.on('data',b=>out+=b);process.stderr.on('data',b=>err+=b);process.on('error',reject);process.on('close',code=>resolve({code,out,err}));});return{process,done};};
   const blocker=child();let writer,revoker,released=false,writerSucceeded=false;
   const before=observe();
   try{
    const id=table==='paige_invoices'?fixture.effective.invoice_id:fixture.effective.signing_id;
    blocker.process.stdin.write(`SET application_name='${blockName}';BEGIN;SELECT id FROM public.${table} WHERE id='${id}' FOR UPDATE;SELECT 'lock ready';\n`);
    let blocking=false;
    for(let attempt=0;attempt<30&&!blocking;attempt++){
     blocking=run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${blockName}' AND state='idle in transaction');`)==='t';
     if(!blocking)await new Promise(r=>setTimeout(r,30));
    }
    assert(blocking,'owned native blocker reached held transaction');
    writer=child();writer.process.stdin.end(`SET application_name='${writerName}';${native(op,cmd)}`);
    let waiting=false;
    for(let attempt=0;attempt<30&&!waiting;attempt++){
     waiting=run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity b ON b.application_name='${blockName}'
      WHERE w.datname=current_database() AND w.application_name='${writerName}' AND w.wait_event_type='Lock' AND b.pid=ANY(pg_blocking_pids(w.pid)));`)==='t';
     if(!waiting)await new Promise(r=>setTimeout(r,30));
    }
    assert(waiting,'actual native writer waits on the identified original row lock');
    revoker=child();const revokeName='e04_revoke_'+token;
    revoker.process.stdin.end(`SET application_name='${revokeName}';UPDATE public.tenant_members SET status='inactive';`);
    let revokeWaiting=false;
    for(let attempt=0;attempt<30&&!revokeWaiting;attempt++){
     revokeWaiting=run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity r JOIN pg_stat_activity w ON w.application_name='${writerName}'
      WHERE r.datname=current_database() AND r.application_name='${revokeName}' AND r.wait_event_type='Lock' AND w.pid=ANY(pg_blocking_pids(r.pid)));`)==='t';
     if(!revokeWaiting)await new Promise(r=>setTimeout(r,30));
    }
    assert(revokeWaiting,'original authority row lock holds revocation behind the admitted writer');
    blocker.process.stdin.end('ROLLBACK;\n');released=true;await blocker.done;
    const result=await writer.done;
    writerSucceeded=result.code===0;
    const revoked=await revoker.done;
    check(label,writerSucceeded&&revoked.code===0&&run("SELECT count(*) FROM tenant_members WHERE status='inactive';")==='1'
     &&run(`SELECT (SELECT count(*) FROM paige_invoice_payments WHERE id='${op}')=1 AND (SELECT count(*) FROM paige_invoice_operations WHERE id='${op}')=1;`)==='t');
    expectRefusal(crypto.randomUUID(),manualCommand(1000),'next original write is refused after serialized revocation','','42501');
   }finally{
    if(!released){blocker.process.stdin.end('ROLLBACK;\n');await blocker.done;}
    if(writer)await writer.done;
    if(revoker)await revoker.done;
    run("UPDATE public.tenant_members SET status='active';");
   }
   if(writerSucceeded){
    run(native(crypto.randomUUID(),reverse(op)));
    check('original full correction restores the concurrency-case allocation without deleting its history',JSON.stringify(observe().obligations)===JSON.stringify(before.obligations));
   }
  }
  if(!allocationBaseline){
   const providerPayment=crypto.randomUUID();
   const providerRow={id:providerPayment,tenant_id:fixture.tenant_id,invoice_id:fixture.effective.invoice_id,actor_user_id:fixture.actor_id,kind:'receipt',amount_cents:1000,currency:'usd',method:'stripe',received_at:recordedAt,evidence_kind:'provider_verified',provider:'stripe',merchant_account_id:'acct_fixture',provider_environment:'live',provider_operation_id:crypto.randomUUID(),provider_transaction_id:'pi_fixture',provider_settlement_id:'txn_fixture',provider_verified_at:recordedAt};
   expectRefusal(crypto.randomUUID(),reverse(providerPayment),'actual native manual reversal refuses provider evidence, even when preview is not used',`INSERT INTO public.paige_invoice_payments SELECT * FROM jsonb_populate_record(NULL::public.paige_invoice_payments,${literal(providerRow)});`);
  }
  const beforeManual=observe(),first=crypto.randomUUID();
  const firstCommand=manualCommand(80000,[{obligation:beforeManual.obligations[0],amount_cents:50000},{obligation:beforeManual.obligations[1],amount_cents:30000}]);
  if(!manualBaseline&&!allocationBaseline){
   const preview=JSON.parse(run(`SET ROLE service_role;SELECT preview_sales_invoice_command('${fixture.actor_id}','${fixture.tenant_id}',${literal(firstCommand)});RESET ROLE;`).split('\n').find(x=>x.startsWith('{')));
   check('native review returns the exact validated manual allocation instruction',JSON.stringify(preview.manual_allocations)===JSON.stringify(firstCommand.allocations));
   check('canonical approval summary names every exact received-payment assignment',firstCommand.allocations.every(item=>preview.summary.includes(`Payment ${item.obligation.reference.sequence} · $${(item.amount_cents/100).toFixed(2)} USD · due ${item.obligation.due_date} · accepted terms version ${item.obligation.reference.terms_version} · signing version ${item.obligation.reference.signing_version}`)));
   check('canonical approval summary uses readable lines rather than escaped newline text',preview.summary.includes('\nAccepted payment assignments:\n')&&!preview.summary.includes('\\n'));
   check('new composition/validation helpers have no browser or service execution grant',run(`SELECT bool_and(NOT has_function_privilege(r.role,s.signature,'EXECUTE')) FROM (VALUES('anon'),('authenticated'),('service_role'))r(role)
    CROSS JOIN (VALUES('public._sales_invoice_manual_allocation_intent(jsonb)'),('public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments)'),('public._sales_invoice_manual_allocations(public.paige_invoices)'),('public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)'))s(signature);`)==='t');
   const maximumSplits=Array.from({length:240},(_,index)=>({obligation:{...beforeManual.obligations[2],reference:{...beforeManual.obligations[2].reference,sequence:index+1}},amount_cents:1}));
   const maximumCommand=manualCommand(240,maximumSplits);
   check('all240 bounded native transport assignments survive without truncation',run(`SELECT jsonb_array_length(public._sales_invoice_manual_allocation_intent(${literal(maximumCommand)}))=240 AND octet_length(${literal(maximumCommand)}::text)>8000 AND octet_length(${literal(maximumCommand)}::text)<=131072;`)==='t');
   expectRefusal(crypto.randomUUID(),maximumCommand,'large bounded assignment transport still requires exact ORIGINAL accepted targets','','40001');
   expectRefusal(crypto.randomUUID(),manualCommand(241,[...maximumSplits,{...maximumSplits[0]}]),'native assignment transport refuses more than240 targets');
  }
  const firstResult=JSON.parse(run(native(first,firstCommand)).split('\n').find(x=>x.startsWith('{')));
  let current=observe();
  check('one original manual receipt explicitly allocates deposit and installment',current.state==='available'&&current.obligations[0].remaining_minor===0&&current.obligations[1].remaining_minor===0&&current.obligations[2].remaining_minor===30000);
  check('original manual receipt and immutable operation are singular and source-bound',run(`SELECT (SELECT count(*) FROM paige_invoice_payments WHERE id='${first}')=1 AND (SELECT count(*) FROM paige_invoice_operations WHERE id='${first}' AND command=${literal(firstCommand)})=1;`)==='t');
  const receiptHistory=inspectReceipt(first,3);
  check('ordinary original owner can reopen the immutable receipt assignments',receiptHistory.state==='assigned'&&receiptHistory.invoice_version===3&&receiptHistory.payment_id===first&&receiptHistory.reversal_payment_id===null&&receiptHistory.amount_cents===80000&&JSON.stringify(receiptHistory.allocations)===JSON.stringify(firstCommand.allocations));
  check('original receipt inspection is Auth-only and never exposes the raw command or notes',run(`SELECT has_function_privilege('authenticated','public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid)','EXECUTE');`)==='t'&&Object.keys(receiptHistory).sort().join(',')==='allocations,amount_cents,currency,invoice_id,invoice_version,payment_id,reversal_payment_id,state');
  denyReceipt(first,'stale original receipt observation requires reloading the invoice',{expected:2,state:'40001'});
  denyReceipt(first,'receipt inspection refuses a foreign workspace',{tenant:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
  denyReceipt(crypto.randomUUID(),'receipt inspection refuses an unknown original receipt');
  denyReceipt(first,'receipt inspection retires revoked original membership',{patch:"UPDATE tenant_members SET status='inactive';"});
  denyReceipt(first,'receipt inspection does not grant financial authority to an unassigned member',{patch:"UPDATE tenant_members SET role='member';"});
  const malformed=JSON.parse(run(`BEGIN;UPDATE paige_invoice_operations SET command=jsonb_set(command,'{amount_cents}','79999') WHERE id='${first}';`+asOwner(receiptRead(first,3))+'ROLLBACK;').split('\n').find(x=>x.startsWith('{')));
  check('corrupt original receipt provenance is visibly unverified with no invented assignments',malformed.state==='unverified'&&malformed.allocations.length===0);
  const replay=JSON.parse(run(native(first,firstCommand)).split('\n').find(x=>x.startsWith('{')));
  check('same operation replays original result before stale invoice or allocation eligibility',JSON.stringify(replay)===JSON.stringify(firstResult)&&version()===3&&run(`SELECT count(*) FROM paige_invoice_payments WHERE id='${first}';`)==='1');
  expectRefusal(first,{...firstCommand,amount_cents:79999},'same operation cannot be rebound to different receipt money');
  const partial=crypto.randomUUID(),partialCommand=manualCommand(12000,[{obligation:current.obligations[2],amount_cents:12000}]);
  run(native(partial,partialCommand));current=observe();
  check('partial original manual receipt retains exact dated remaining amount',current.state==='available'&&current.obligations[2].remaining_minor===18000);
  const adminOp=crypto.randomUUID(),adminCommand=manualCommand(1000,[{obligation:current.obligations[3],amount_cents:1000}]);
  const adminResult=run("BEGIN;UPDATE public.tenant_members SET role='admin';"+native(adminOp,adminCommand)+'ROLLBACK;');
  check('original tenant Admin remains admitted without a global role or new grant',adminResult.includes(adminOp)&&version()===4&&run(`SELECT count(*) FROM paige_invoice_payments WHERE id='${adminOp}';`)==='0');
  expectRefusal(crypto.randomUUID(),manualCommand(12000,partialCommand.allocations),'captured remaining amount must still match current accepted source','','40001');
  expectRefusal(crypto.randomUUID(),manualCommand(1000,[{obligation:current.obligations[3],amount_cents:999}]),'native amount must equal exact split sum');
  expectRefusal(crypto.randomUUID(),manualCommand(1000,[{obligation:current.obligations[3],amount_cents:500},{obligation:current.obligations[3],amount_cents:500}]),'native duplicate accepted target is refused');
  const changed=structuredClone(current.obligations[3]);changed.source_digest='b'.repeat(64);
  expectRefusal(crypto.randomUUID(),manualCommand(1000,[{obligation:changed,amount_cents:1000}]),'native rejects changed accepted digest','','40001');
  expectRefusal(crypto.randomUUID(),manualCommand(1000,[{obligation:current.obligations[3],amount_cents:1000}]),'revoked original actor cannot record a split',"UPDATE tenant_members SET status='inactive';",'42501');
  expectRefusal(crypto.randomUUID(),manualCommand(1000,[{obligation:current.obligations[3],amount_cents:1000}]),'unassigned member cannot record a split',"UPDATE tenant_members SET role='member';",'42501');
  const correction=crypto.randomUUID(),correctionCommand=reverse(first);
  run(native(correction,correctionCommand));current=observe();
  check('full original reversal restores only its deposit/installment allocation',current.state==='available'&&current.obligations[0].remaining_minor===50000&&current.obligations[1].remaining_minor===30000&&current.obligations[2].remaining_minor===18000);
  check('correction retains original receipt and exact full reversal, never a provider refund',run(`SELECT count(*) FROM paige_invoice_payments WHERE id='${first}' OR (id='${correction}' AND reverses_payment_id='${first}' AND amount_cents=80000 AND evidence_kind='manual_recorded' AND provider_operation_id IS NULL);`)==='2');
  const correctedHistory=inspectReceipt(first,5);
  check('reopened corrected receipt retains its exact original assignments and full reversal identity',correctedHistory.state==='assigned'&&correctedHistory.reversal_payment_id===correction&&JSON.stringify(correctedHistory.allocations)===JSON.stringify(firstCommand.allocations));
  withPatch(`UPDATE public.paige_invoice_payments SET provider_environment='test' WHERE id='${correction}';`,'allocation_required','provider-tagged correction cannot restore accepted manual obligations');
  const correctionReplay=run(native(correction,correctionCommand));
  check('correction replay does not add another reversal or invoice',correctionReplay.includes(correction)&&version()===5&&run(`SELECT count(*) FROM paige_invoice_payments WHERE reverses_payment_id='${first}';`)==='1'&&run('SELECT count(*) FROM paige_invoices;')==='1');
  expectRefusal(crypto.randomUUID(),reverse(first),'a second correction cannot reverse the same original receipt');
  // Actual PostgreSQL rollback with an explicit synthetic Rail port failing inside
  // the original function transaction. Full original Rail implementation proof owed.
  await authorityRace('original actor lock serializes revocation during invoice wait','paige_invoices',manualCommand(1000));
  await authorityRace('original actor lock serializes revocation during accepted-source wait','paige_agreements',manualCommand(1000,[{obligation:current.obligations[3],amount_cents:1000}]));
  const beforeRail=version();
  run(`CREATE FUNCTION manual_proof_fail_rail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic Rail port failed' USING ERRCODE='P9002';END$$;
   CREATE TRIGGER manual_proof_fail_rail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION manual_proof_fail_rail();`);
  const failed=crypto.randomUUID();expectRefusal(failed,manualCommand(1000,[{obligation:current.obligations[3],amount_cents:1000}]),'Rail-port failure rolls back the original manual writer','','P9002');
  check('failed transaction retains no receipt/operation/version change',version()===beforeRail&&run(`SELECT (SELECT count(*) FROM paige_invoice_payments WHERE id='${failed}')=0 AND (SELECT count(*) FROM paige_invoice_operations WHERE id='${failed}')=0;`)==='t');
  run('DROP TRIGGER manual_proof_fail_rail ON paige_workspace_events;');
  const sourceAfter=run(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'path',proconfig,'args',pg_get_function_arguments(oid),'return',pg_get_function_result(oid),'definer',prosecdef) ORDER BY oid)
   FROM pg_proc WHERE oid IN ('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,'public.preview_sales_invoice_command(uuid,uuid,jsonb)'::regprocedure,'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)'::regprocedure);`);
  check('all original patched function OIDs/ABI/ACL/owner/searchpath/definer preserved',sourceAfter===nativeBefore);
  const state=JSON.stringify(observe());run(manualForward);
  check('forward replay preserves exact original allocation state',JSON.stringify(observe())===state);
  for(const [sql,label] of [
   ['GRANT EXECUTE ON FUNCTION public._sales_invoice_manual_receipt_allocations(public.paige_invoices,public.paige_invoice_payments) TO authenticated;','forward guard refuses a widened private receipt helper'],
   ['GRANT EXECUTE ON FUNCTION public.read_sales_invoice_manual_allocations(uuid,uuid,bigint,uuid) TO anon;','forward guard refuses anonymous receipt inspection'],
   ['ALTER FUNCTION public._sales_invoice_actor(uuid,uuid) SECURITY INVOKER;','forward guard refuses changed original authority'],
  ])deniedSql('BEGIN;'+sql+manualForward,/reconcile before applying/,label);
  const guardedHistory=inspectReceipt(first,version());
  check('failed hostile guard attempts leave original owner history and source state exact',JSON.stringify(observe())===state&&guardedHistory.state==='assigned'&&guardedHistory.reversal_payment_id===correction&&JSON.stringify(guardedHistory.allocations)===JSON.stringify(firstCommand.allocations));
  log.push('MANUAL BOUNDARY: original tracked actor/governance/executor/replay and actual bounded three-session authority-lock characterization; reduced tables/Test Auth/synthetic result-preview-Rail ports. Full-schema RLS/other races/actual Rail/provider/customer/authenticated UI proof remain owed.');
 }
 log.push('BOUNDARY: minimal-table original-source composition and simulated provider metadata only; full-schema writer/role/concurrency/provider/customer proof owed.');
 console.log(JSON.stringify({passes,scope:'isolated original-source PostgreSQL composition',database,sourceHash:crypto.createHash('sha256').update(migration).digest('hex'),...(manualMode?{manualSourceHash}:{})}));
}catch(e){log.push('FAIL '+e.stack);console.error(e.message);process.exitCode=1;}
finally{
 if(created){activeDatabase='postgres';try{run('DROP DATABASE '+database+';');log.push('Disposable database removed.');}catch(e){log.push('CLEANUP FAILED '+e.message);process.exitCode=1;}}
 console.log(log.join('\n'));
}
