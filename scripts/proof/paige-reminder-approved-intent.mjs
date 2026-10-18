// Disposable loopback proof only. No remote URL, credentials, providers or real JWT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const port=Number(process.env.REMINDER_APPROVAL_PROOF_PORT);
assert(Number.isInteger(port)&&port>=1024&&port<=65535&&(port!==5432||process.env.CI==='true'),
 'Owned disposable loopback port required; port5432 is CI-only');
const db=new OperatorPostgresFixture(port);db.prefix=()=>'';
const baseline=process.argv.includes('--baseline');
const policyNegativeControl=process.argv.includes('--policy-negative-control');
const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
const strip=text=>text.replace(/^begin;\r?$/gmi,'').replace(/^commit;\r?$/gmi,'');
function definition(sql,name,schema='public'){
 const start=sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\s*\\(`,'i'));
 assert(start>=0,name);const tail=sql.slice(start),tag=/\bas\s+(\$\w*\$)/i.exec(tail);assert(tag,name);
 const end=tail.indexOf(tag[1],tag.index+tag[0].length);assert(end>=0);return tail.slice(0,end+tag[1].length)+';';
}
const run=sql=>db.run(sql);
try{
 const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],
  {encoding:'utf8',env:{...process.env,INT336_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/int336_test_emitter`}});
 assert.equal(emitted.status,0,emitted.stderr);
 const prefix=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
 run(prefix+strip(read('20270601000008_int346_server_issued_interactive_receipts.sql'))+
  strip(read('20270602000301_int346_conversational_admission.sql'))+
  strip(read('20271108110000_int346_database_executor_isolation.sql'))+'COMMIT;');
 run(`CREATE EXTENSION IF NOT EXISTS pgcrypto;CREATE SCHEMA private;
 REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated;GRANT USAGE ON SCHEMA private TO service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text);
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.actor',true),''))::uuid$$;
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,account_type text DEFAULT 'standalone',parent_tenant_id uuid,
  slug text,name text DEFAULT 'Neutral retired workspace',account_number_prefix text,features jsonb DEFAULT '{}');
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text,role text,is_owner boolean DEFAULT false,joined_at timestamptz DEFAULT now(),PRIMARY KEY(tenant_id,user_id));
 CREATE TABLE public.user_roles(user_id uuid,role text);
 CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid);
 CREATE TABLE public.internal_bookings(id uuid PRIMARY KEY);
 CREATE TABLE public.paige_actions(id uuid PRIMARY KEY);
 CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,entity text,action text,entity_id uuid,data jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE public.marketing_content(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,created_by uuid,kind text,title text,body text,brief text,status text,meta jsonb,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE public.paige_subagents(slug text,tenant_id uuid,rail_display_name text);
 CREATE TABLE public.paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,actor_id uuid,
 source_kind text,source_id uuid,source_revision bigint,outcome text,actor_agent_slug text,actor_agent_label text,capability_key text,
 job_attempt_id text,llm_trace_id uuid,release_id text,detail jsonb,occurred_at timestamptz DEFAULT now(),
 UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 ALTER TABLE public.paige_chat_threads ADD COLUMN audience text NOT NULL DEFAULT 'workspace' CHECK(audience IN('workspace','customer_private')),
 ADD COLUMN is_archived boolean NOT NULL DEFAULT false,ADD COLUMN contact_id uuid,ADD COLUMN lens text,ADD COLUMN title text;
 ALTER TABLE public.paige_chat_turns ADD PRIMARY KEY(id);
 ALTER TABLE public.paige_chat_turns ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
 ALTER TABLE public.paige_chat_turns ADD CONSTRAINT fixture_thread_fk FOREIGN KEY(thread_id) REFERENCES public.paige_chat_threads(id) ON DELETE CASCADE;
 CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION public.has_any_role(u uuid,r text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role=ANY(r)) $$;
 CREATE FUNCTION public.is_platform_owner(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.has_any_role(u,ARRAY['super_admin']) $$;
 CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_platform_owner(auth.uid()) $$;
 CREATE FUNCTION public.is_platform_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.has_any_role(u,ARRAY['super_admin','platform_admin']) $$;
 CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.tenants WHERE id=t AND account_type='company') $$;
 CREATE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_platform_admin(auth.uid()) $$;
 CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
 CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
 CREATE FUNCTION public.knowledge_actor_authorized(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
 GRANT ALL ON public.paige_chat_threads,public.paige_chat_turns TO service_role;
 UPDATE public.paige_chat_interactive_rollout SET active=true;
 ${['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'].map(t=>`CREATE TABLE public.${t}(id uuid PRIMARY KEY);`).join('\n')}`);
 run(definition(read('20260714144656_tier_rail_phaseB_agency_standing.sql'),'current_user_tenant_id'));
 run(definition(read('20270521000000_operator_authority_in_company_workspaces.sql'),'is_tenant_member'));
 const planning=read('20260711340000_paige_planning.sql');
 for(const table of ['plans','plan_items']){const at=planning.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);run(planning.slice(at,planning.indexOf('\n);',at)+3));}
 for(const name of ['plan_create','plan_add_milestone','plan_assign_task','plan_remove_item'])run(definition(planning,name));
 for(const name of ['plan_set_reminder','plan_update_item'])run(definition(read('20260712010000_planning_audit_fixes.sql'),name));
 run(definition(read('20260712040000_plan_list_contact_and_calendar.sql'),'plan_list'));
 run(definition(read('20271020000020_operations_versioned_work_update.sql'),'plan_list_operations_scoped'));
 const retired=read('20270504000000_retire_title_role_from_functions.sql');
 run(retired.slice(retired.indexOf('CREATE FUNCTION pg_temp.reads_retired_role('),retired.indexOf('-- Lists and separate branches'))+
  `SELECT pg_temp.retire_role(oid::regprocedure) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('plan_create','plan_add_milestone','plan_assign_task','plan_remove_item','plan_set_reminder','plan_update_item','plan_list');`);
 run(definition(read('20261220000000_an_act_that_landed_but_was_not_recorded.sql'),'_workspace_event_display'));
 run('ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_native_planning');
 run(definition(read('20271108191000_planning_native_receipts_history.sql'),'_workspace_event_display'));
 run(read('20270107000000_receipt_correlation_and_detail.sql'));
 run(`REVOKE ALL ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) TO service_role;
 CREATE FUNCTION public.is_tenant_admin(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=auth.uid() AND tenant_id=t AND status='active' AND role IN('owner','admin')) $$;`);
 run(read('20271108191000_planning_native_receipts_history.sql'));
 run(read('20270417000000_paige_durable_work_envelope.sql'));
 run(read('20270418000000_paige_durable_document_work.sql'));
 run(definition(read('20271108201000_e09_customer_private_chat.sql'),'create_paige_durable_work'));
 // Actual proposal DDL and issuance fields, with the established trusted issuance boundary.
 const proposal=read('20261023000000_confirmations_bind_the_approval_to_the_call.sql');
 const at=proposal.indexOf('CREATE TABLE IF NOT EXISTS public.paige_pending_confirmations');
 run(proposal.slice(at));
 run(`ALTER TABLE public.paige_pending_confirmations ADD COLUMN issued_in_request uuid,ADD COLUMN server_issued_at timestamptz;
 REVOKE ALL ON FUNCTION public.plan_set_reminder(text,timestamptz,text,uuid,text,uuid,text,uuid,uuid) FROM PUBLIC,anon;
 GRANT EXECUTE ON FUNCTION public.plan_set_reminder(text,timestamptz,text,uuid,text,uuid,text,uuid,uuid) TO authenticated,service_role;`);
 run(read('20261201000400_canonical_proposal_integrity.sql'));
 run(read('20271110021000_chat_runtime_recovery.sql'));
 const autonomy=read('20260711200000_paige_tool_autonomy.sql');
 const policyAt=autonomy.indexOf('CREATE TABLE IF NOT EXISTS public.tenant_tool_autonomy (');
 run(autonomy.slice(policyAt,autonomy.indexOf('\n);',policyAt)+3));
 run(definition(autonomy,'set_tool_autonomy'));
 run(`CREATE TABLE public.admin_app_settings(key text PRIMARY KEY,value jsonb);
  CREATE TABLE public.paige_systems_check_registry(check_id text PRIMARY KEY,scope text);
  CREATE TABLE public.paige_systems_check_finding(check_id text,status text,created_at timestamptz DEFAULT clock_timestamp(),evidence jsonb,tenant_id uuid);`);
 for(const name of ['trust_attestation_window','trust_required_proof'])run(definition(read('20261001000000_trust_authority_expires.sql'),name));
 for(const name of ['platform_safety_proof_internal','trust_effective_rung','resolve_tool_autonomy'])run(definition(read('20261039000000_autonomy_respects_the_trust_ceiling.sql'),name));
 const writer="SELECT oid::text||':'||md5(prosrc)||':'||proowner::regrole::text||':'||proacl::text||':'||proconfig::text FROM pg_proc WHERE oid='public.plan_set_reminder(text,timestamptz,text,uuid,text,uuid,text,uuid,uuid)'::regprocedure";
 const existingContract=()=>JSON.parse(run(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',proname,'args',proargtypes::text,'owner',proowner,
  'acl',proacl::text,'config',proconfig,'definer',prosecdef,'body_md5',md5(prosrc)) ORDER BY oid) FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND (proname LIKE '%paige_durable_work%' OR proname LIKE '%paige_document_work%'
   OR proname LIKE 'paige_chat_interactive_%' OR proname IN('plan_set_reminder','resolve_tool_autonomy','set_tool_autonomy',
    'trust_effective_rung','platform_safety_proof_internal','trust_required_proof','trust_attestation_window'))`));
 const before=run(writer),beforeContract=existingContract();
 if(!baseline){
  let migration=read('20271110023000_reminder_approved_intent.sql');
  if(policyNegativeControl){
   const calls=migration.match(/perform private\.paige_reminder_policy\([^;]+\);/g);assert.equal(calls?.length,3);
   migration=migration.replace(/perform private\.paige_reminder_policy\([^;]+\);/g,'/* Deliberate missing-policy negative control. */');
   console.log('NEGATIVE CONTROL: only the native policy consult calls omitted; expected OFF refusal assertion must fail.');
  }
  run(migration);run(migration);
  assert.equal(run(writer),before,'Incumbent writer identity/source/ABI/ACL/config unchanged');
  assert.deepEqual(existingContract(),beforeContract,'Every incumbent durable/Document/runtime/native-reminder ABI/body/ACL/config is preserved');
  fs.mkdirSync(path.join(root,'work/reminder-approved-intent'),{recursive:true});
  fs.writeFileSync(path.join(root,'work/reminder-approved-intent/incumbent-contract-preservation.json'),JSON.stringify({before:beforeContract,after:existingContract()},null,2));
  run(fs.readFileSync(path.join(root,'supabase/tests/paige_durable_work_envelope.sql'),'utf8'));
  console.log('PASS unchanged incumbent rolled-back durable envelope regression and native contract catalog equality');
 }
 const controls=run(fs.readFileSync(path.join(root,'supabase/tests/paige_reminder_approved_intent.sql'),'utf8').replaceAll('PROOF_BASELINE',baseline?'true':'false'));
 console.log(controls.match(/REMINDER_APPROVED_INTENT_PASS=\d+/)?.[0]??controls);
 if(!baseline){
  const id=n=>`a2330000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const actor=id(1),tenant=id(10),thread=id(20),proposal=id(30),issued=id(40),request=id(41),intent=id(50),nonce=id(60);
  const q=v=>`'${String(v).replaceAll("'","''")}'`;
  const auth=sql=>`SET test.actor=${q(actor)};SET ROLE authenticated;${sql};RESET ROLE;`;
  const service=sql=>`SET test.actor=${q(actor)};SET ROLE service_role;${sql};RESET ROLE;`;
  const adopt=`SELECT public.adopt_paige_reminder_approval(${[proposal,actor,tenant,thread].map(q).join(',')},NULL,'0123456789abcdef',${[issued,request,intent,nonce].map(q).join(',')})`;
  const parse=out=>JSON.parse(out.split(/\r?\n/).findLast(l=>l.startsWith('{')));
  run(`INSERT INTO auth.users(id) VALUES(${q(actor)});INSERT INTO public.tenants(id,status)VALUES(${q(tenant)},'active');
   INSERT INTO public.profiles VALUES(${q(actor)},${q(tenant)});INSERT INTO public.tenant_members(tenant_id,user_id,status,role)VALUES(${q(tenant)},${q(actor)},'active','member');
   INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id)VALUES(${q(thread)},${q(actor)},${q(tenant)});
   INSERT INTO public.paige_pending_confirmations(id,user_id,tenant_id,thread_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
   VALUES(${q(proposal)},${q(actor)},${q(tenant)},${q(thread)},'plan_set_reminder','0123456789abcdef',
    '{"title":"Verify one serialized reminder","remind_at":"2030-01-02T10:00:00Z"}','Neutral concurrency reminder',${q(issued)},clock_timestamp()-interval '1 minute')`);
  run(auth(`SELECT public.paige_chat_interactive_begin_v2(${q(thread)},${q(intent)},NULL,'Approve exact native reminder',false,false,true)`));
  run(service(`SELECT public.paige_chat_interactive_acquire_bound(${[thread,actor,tenant,intent,nonce,id(70)].map(q).join(',')},'abcdefghijklmnopqrst_${id(80)}_445')`));
  async function serialized(label,sql,secondSql=sql,{delayMs=0,errorCode}={}){
   const held=await db.holdArchive(sql);
   if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
   const child=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let output='',error='';
   child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);
   const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0||errorCode&&error.includes(` ${errorCode}:`)?resolve():reject(Error(error)));});
   child.stdin.end(`\\set VERBOSITY verbose\nSET application_name='reminder_${label}';${secondSql};`);
   let waited=false;
   for(let i=0;i<8;i++){
    const state=run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='reminder_${label}' AND wait_event_type='Lock')`);
    if(state==='t'){waited=true;break;}
    await new Promise(r=>setTimeout(r,30));
   }
   await Promise.all([done,held.completed]);assert(waited,`${label}: actual second connection must wait on first native transaction`);
   console.log(`PASS actual two-connection ${label}: second call observed waiting on native transaction lock`);
   if(errorCode){assert.match(error,new RegExp(` ${errorCode}:`));return {sqlstate:errorCode};}
   return parse(output);
  }
  const adopted=await serialized('adoption',service(adopt));assert.equal(adopted.status,'existing');
  const work=adopted.work_id;
  assert.equal(run(`SELECT count(*) FROM public.paige_durable_work WHERE intent_id=${q(proposal)}`),'1');
  const execute=auth(`SELECT public.execute_paige_approved_reminder(${q(work)},${q(tenant)},${q(thread)},NULL,${q(intent)},${q(nonce)})`);
  const result=await serialized('execution',execute);assert.equal(result.replayed,true);
  assert.equal(run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`),'1');
  assert.equal(run(`SELECT count(*) FROM public.audit_logs WHERE user_id=${q(actor)} AND action='plan_set_reminder'`),'1');
  assert.equal(run(`SELECT count(*) FROM public.paige_workspace_events WHERE tenant_id=${q(tenant)} AND capability_key='plan_set_reminder'`),'1');
  assert.equal(run(`SELECT count(*) FROM public.paige_durable_work WHERE intent_id=${q(proposal)} AND status='succeeded'`),'1');
  console.log('PASS concurrent ACK-loss readback: same work/reminder/audit/native Rail/terminal, zero second writer');
  function nextWork(n){
   const p=id(n),fp=n.toString(16).padStart(16,'0');
   run(`INSERT INTO public.paige_pending_confirmations(id,user_id,tenant_id,thread_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
    VALUES(${q(p)},${q(actor)},${q(tenant)},${q(thread)},'plan_set_reminder',${q(fp)},
     '{"title":"Review one policy-bounded reminder","remind_at":"2030-01-03T10:00:00Z"}','Neutral policy race',${q(issued)},
     (SELECT created_at-interval '1 second' FROM public.paige_chat_turns WHERE thread_id=${q(thread)} AND role='user'))`);
   return parse(run(service(`SELECT public.adopt_paige_reminder_approval(${[p,actor,tenant,thread].map(q).join(',')},NULL,${q(fp)},${[issued,request,intent,nonce].map(q).join(',')})`))).work_id;
  }
  const executeWork=w=>auth(`SELECT public.execute_paige_approved_reminder(${q(w)},${q(tenant)},${q(thread)},NULL,${q(intent)},${q(nonce)})`);
  const modeSetter=mode=>`SET test.actor='';SET ROLE service_role;SELECT to_jsonb(public.set_tool_autonomy('plan_set_reminder',${q(mode)},${q(tenant)}));RESET ROLE`;
  async function writerWins(label,write,w){
   const count=run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`);
   const held=await db.holdArchive(write);assert.throws(()=>run(executeWork(w)),e=>e.code==='55P03',`${label}: policy write contention must refuse NOWAIT`);
   await held.completed;
   assert.equal(run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`),count);
   assert.equal(run(`SELECT status||':'||dispatch_started_attempt FROM public.paige_durable_work WHERE id=${q(w)}`),'claimed:0');
   console.log(`PASS actual two-connection ${label}: policy write wins, native dispatch refuses before effect`);
  }
  let policyWork=nextWork(31);
  await writerWins('absent_OFF_insert',modeSetter('off'),policyWork);
  assert.throws(()=>run(executeWork(policyWork)),e=>e.code==='42501');
  run(modeSetter('confirm'));policyWork=nextWork(32);
  await writerWins('existing_OFF_update',modeSetter('off'),policyWork);
  assert.throws(()=>run(executeWork(policyWork)),e=>e.code==='42501');
  run(modeSetter('confirm'));policyWork=nextWork(33);
  const brake=await serialized('effect_before_OFF',executeWork(policyWork),modeSetter('off'));
  assert.equal(brake.mode,'off');assert.equal(run(`SELECT status FROM public.paige_durable_work WHERE id=${q(policyWork)}`),'succeeded');
  run(modeSetter('confirm'));policyWork=nextWork(34);
  await writerWins('compass_OFF_insert',"INSERT INTO public.admin_app_settings VALUES('paige_trust_compass','{\"ceiling\":0}')",policyWork);
  assert.throws(()=>run(executeWork(policyWork)),e=>e.code==='42501');
  run('DELETE FROM public.admin_app_settings');
  run(`INSERT INTO public.admin_app_settings VALUES('paige_trust_compass',jsonb_build_object('ceiling',2,'attested_at',clock_timestamp()));
   INSERT INTO public.paige_systems_check_registry VALUES('operator_cross_tenant_canary','operator');
   INSERT INTO public.paige_systems_check_finding(check_id,status,evidence)VALUES('operator_cross_tenant_canary','pass','{}')`);
  run(modeSetter('auto'));policyWork=nextWork(35);
  await writerWins('safety_finding_change',"INSERT INTO public.paige_systems_check_finding(check_id,status,evidence)VALUES('operator_cross_tenant_canary','fail','{}')",policyWork);
  assert.deepEqual(run(auth(`SELECT public.resolve_tool_autonomy(${q(tenant)},'plan_set_reminder')`)).split(/\r?\n/).filter(l=>!['SET','RESET'].includes(l)),['confirm']);
  assert.equal(parse(run(executeWork(policyWork))).status,'succeeded','Canonical safety fallback remains explicit CONFIRM, no AUTO inference');
  // Quiesce the intentionally refused no-effect test work before the existing
  // canonical retirement preflight. This is not an effect retry or reconciliation.
  run(`SELECT public.transition_paige_durable_work(id,idempotency_key,'cancelled','{"reason":"Local no-effect fixture finished"}',
   'Local fixture ended without dispatch') FROM public.paige_durable_work WHERE tenant_id=${q(tenant)} AND status='claimed' AND dispatch_started_attempt=0`);
  console.log('PASS committed OFF/Trust gates and canonical safety demotion; historical terminal remains separate');
  const adoptWork=n=>service(`SELECT public.adopt_paige_reminder_approval(${[id(n),actor,tenant,thread].map(q).join(',')},NULL,${q(n.toString(16).padStart(16,'0'))},${[issued,request,intent,nonce].map(q).join(',')})`);
  const expiresFirst=nextWork(36),countBeforeExpiry=run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`);
  run(`UPDATE public.paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${q(expiresFirst)}`);
  await serialized('expiry_before_execution',adoptWork(36),executeWork(expiresFirst),{errorCode:'55000'});
  assert.equal(run(`SELECT status FROM public.paige_durable_work WHERE id=${q(expiresFirst)}`),'expired');
  assert.equal(run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`),countBeforeExpiry);
  const executesFirst=nextWork(37);
  run(`UPDATE public.paige_durable_work SET lease_until=clock_timestamp()+interval '400 milliseconds' WHERE id=${q(executesFirst)}`);
  const observed=await serialized('execution_before_expiry',executeWork(executesFirst),adoptWork(37),{delayMs:600});
  assert.equal(observed.work_status,'succeeded');
  assert.equal(run(`SELECT status FROM public.paige_durable_work WHERE id=${q(executesFirst)}`),'succeeded');
  assert.equal(run(`SELECT count(*) FROM public.plan_items WHERE tenant_id=${q(tenant)}`),String(Number(countBeforeExpiry)+1));
  console.log('PASS actual execute-versus-expiry races: terminal success OR expired/no-effect; never expiry plus effect');
  // Reuse the canonical Operator proof's native functions and R0 registry. Empty
  // provider relations are explicit local infrastructure, not provider retirement.
  run(`CREATE TYPE public.tenant_status AS ENUM('trial','active','past_due','suspended','canceled');
   ALTER TABLE public.tenants ALTER COLUMN status TYPE public.tenant_status USING status::public.tenant_status;
   ALTER TABLE public.tenants ADD COLUMN stripe_customer_id text,ADD COLUMN stripe_subscription_id text;
   ALTER TABLE public.tenant_members ADD COLUMN id uuid DEFAULT gen_random_uuid();
   ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb;
   CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT public.is_platform_admin(auth.uid())$$;
   CREATE SCHEMA vault;CREATE TABLE vault.secrets(name text);
   CREATE TABLE public.tenant_twilio_subaccounts(id uuid PRIMARY KEY,tenant_id uuid,twilio_subaccount_sid text,auth_token_vault_ref text);
   CREATE TABLE public.tenant_phone_numbers(id uuid PRIMARY KEY,tenant_id uuid,subaccount_id uuid);
   CREATE TABLE public.tenant_n8n_connections(tenant_id uuid,base_url_ct text,api_key_ct text,api_key_last4 text,status text,last_error text,workflow_count integer,updated_by uuid,updated_at timestamptz);
   CREATE TABLE public.mcp_connections(connection_id uuid,tenant_id uuid,legacy_source text,provider_key text,enabled boolean,server_url_ct text,
    auth_token_ct text,auth_token_last4 text,refresh_token_ct text,oauth_client_secret_ct text,inbound_contact_secret_hash text,inbound_contact_actor uuid,
    granted_scopes text[],provider_state jsonb,status text,health text,last_error_code text,last_checked_at timestamptz,updated_by uuid,updated_at timestamptz);
   CREATE TABLE public.mcp_connection_approvals(connection_id uuid);CREATE TABLE public.mcp_connection_tools(connection_id uuid);
   CREATE TABLE public.platform_subscriptions(tenant_id uuid,stripe_subscription_id text,stripe_customer_id text,status text);
   CREATE TABLE public.paige_voice_cost_reservations(tenant_id uuid,state text);
   CREATE FUNCTION public.operator_resource_ready(text,uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
   ALTER TABLE public.paige_actions ADD COLUMN tenant_id uuid,ADD COLUMN status text;
   ALTER TABLE public.paige_workflow_runs ADD COLUMN tenant_id uuid,ADD COLUMN status text;
   ALTER TABLE public.paige_media_jobs ADD COLUMN tenant_id uuid,ADD COLUMN status text;
   ALTER TABLE public.paige_social_jobs ADD COLUMN tenant_id uuid,ADD COLUMN status text;`);
  const r0=read('20270510000000_operator_standing_one_answer.sql');
  for(const table of ['platform_operator_roles','platform_operator_capabilities','platform_operator_role_capabilities']){
   const at=r0.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);assert(at>=0);run(r0.slice(at,r0.indexOf('\n);',at)+3));
  }
  run(definition(r0,'operator_may'));
  run(`INSERT INTO public.platform_operator_roles(role,rank,holds_unlisted,description,ruling)VALUES('super_admin',100,true,'Neutral local operator','Existing R0 contract');
   INSERT INTO public.platform_operator_capabilities(capability,description,ruling)VALUES('fleet.account.archive','Archive','Existing R0'),('fleet.account.permanent_delete','Delete','Existing R0');
   INSERT INTO public.platform_operator_role_capabilities(role,capability,ruling,in_force)VALUES('super_admin','fleet.account.archive','Existing R0',true),('super_admin','fleet.account.permanent_delete','Existing R0',true);`);
  run(read('20270602000203_operator_account_archive.sql'));
  run(`ALTER TABLE public.operator_account_archives ADD COLUMN resource_mode text,ADD COLUMN resource_claim uuid,ADD COLUMN resource_started_at timestamptz,
   ADD COLUMN resource_plan jsonb DEFAULT '[]',ADD COLUMN resource_results jsonb DEFAULT '{}',ADD COLUMN external_cleanup jsonb DEFAULT '[]';`);
  const independent=read('20270602000504_operator_provider_independent_retirement.sql');
  for(const name of ['operator_external_retirement_inventory','operator_external_retirement_warnings','operator_detach_pending_provider_preparation','operator_retirement_disposition'])run(definition(independent,name));
  const split=read('20271020000100_operator_archive_delete_authority.sql');
  for(const name of ['operator_can_archive_accounts','operator_can_permanently_delete_accounts','operator_read_archive_receipt','operator_preview_account_archive',
   'operator_archive_account','guard_operator_account_archive','operator_preview_account_deletion','operator_remove_retired_credentials','operator_delete_archived_account'])run(definition(split,name));
  run(definition(read('20271020000420_operator_deletion_plan_catalog.sql'),'operator_account_deletion_plan'));
  const operator=id(100),survivor=id(110),operation=id(120);
  run(`INSERT INTO auth.users(id)VALUES(${q(operator)});INSERT INTO public.user_roles VALUES(${q(operator)},'super_admin');
   INSERT INTO public.tenants(id,status,name)VALUES(${q(survivor)},'active','Neutral surviving workspace');
   INSERT INTO public.tenant_members(tenant_id,user_id,status,role)VALUES(${q(survivor)},${q(actor)},'active','member');`);
  const operatorSQL=sql=>`SET test.actor=${q(operator)};${sql}`;
  const expiryForArchive=nextWork(38);
  const heldPreview=parse(run(operatorSQL(`SELECT public.operator_preview_account_archive(${q(tenant)})`)));
  assert.equal(heldPreview.execution_available,false);assert(heldPreview.blockers.some(b=>b.includes('paige_durable_work')));
  run(`UPDATE public.paige_durable_work SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${q(expiryForArchive)}`);
  assert.equal(parse(run(adoptWork(38))).work_status,'expired');
  assert.throws(()=>run(`DELETE FROM auth.users WHERE id=${q(actor)}`),e=>e.code==='23503','Actor-only erasure remains the existing FK restriction');
  const preview=parse(run(operatorSQL(`SELECT public.operator_preview_account_archive(${q(tenant)})`)));
  assert.equal(preview.execution_available,true,JSON.stringify(preview.blockers));
  console.log('PASS canonical archive consequence: claimed no-effect work holds; bounded expired normalization permits current preflight; actor-only FK limit remains');
  // Real mandatory archive audit failure rolls the whole operation back.
  run(`CREATE FUNCTION public.reminder_retirement_refusal()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='tenant.archive' THEN RAISE EXCEPTION 'Injected native retirement audit refusal';END IF;RETURN NEW;END$$;
   CREATE TRIGGER reminder_retirement_refusal BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reminder_retirement_refusal()`);
  assert.throws(()=>run(operatorSQL(`SELECT public.operator_archive_account(${q(tenant)},${q(preview.version)},'Neutral retired workspace',${q(operation)})`)),/retirement audit refusal/);
  assert.equal(run(`SELECT status FROM public.tenants WHERE id=${q(tenant)}`),'active');
  assert.equal(run(`SELECT count(*) FROM public.paige_durable_work WHERE id=${q(work)}`),'1');
  run('DROP TRIGGER reminder_retirement_refusal ON public.audit_logs');
  run(operatorSQL(`SELECT public.operator_archive_account(${q(tenant)},${q(preview.version)},'Neutral retired workspace',${q(operation)})`));
  const deletion=parse(run(operatorSQL(`SELECT public.operator_preview_account_deletion(${q(tenant)})`)));
  assert.equal(deletion.execution_available,true,JSON.stringify(deletion.blockers));
  for(const relation of ['paige_durable_work','plan_items','paige_pending_confirmations','paige_chat_threads','paige_chat_turns'])
   assert(deletion.dependencies.some(x=>x.relation===relation&&x.count>0),`Canonical current deletion plan includes ${relation}`);
  const authCount=run('SELECT count(*) FROM auth.users');
  const deleted=parse(run(operatorSQL(`SELECT public.operator_delete_archived_account(${q(tenant)},${q(deletion.version)},'Neutral retired workspace',${q(operation)})`)));
  assert.equal(deleted.state,'deleted');
  for(const relation of ['paige_durable_work','plan_items','paige_pending_confirmations','paige_chat_threads'])
   assert.equal(run(`SELECT count(*) FROM public.${relation} WHERE tenant_id=${q(tenant)}`),'0',relation);
  assert.equal(run(`SELECT count(*) FROM public.paige_chat_turns WHERE thread_id=${q(thread)}`),'0');
  assert.equal(run(`SELECT count(*) FROM public.tenants WHERE id=${q(tenant)}`),'0');
  assert.equal(run('SELECT count(*) FROM auth.users'),authCount,'Canonical retirement preserves shared Auth identities');
  assert.equal(run(`SELECT count(*) FROM public.tenant_members WHERE tenant_id=${q(survivor)} AND user_id=${q(actor)} AND status='active'`),'1');
  console.log('PASS actual canonical current archive/preflight/child-first purge: settled reminder+approval+work+thread removed, shared Auth/survivor membership retained; audit-refusal rollback preserved');
 }
 console.log('PASS native reminder approved-intent SQL controls; unchanged nine-argument writer and migration reapply');
}finally{await db.close();}
