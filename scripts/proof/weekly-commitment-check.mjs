#!/usr/bin/env node
// SQL runtime proof only. Actual repository process/event/act/claim/reconcile/receipt functions;
// infrastructure doubles are auth.uid/current tenant, trust rung, pg_cron/pg_net/realtime and the base Rail display.
// The actual tenant_tool_autonomy table, Settings setter and latest canonical batch/single resolution run unchanged.
// Never accepts a remote database, provider credentials, production tenant or outbound wakeup.
// --postgres uses the existing disposable CI PostgreSQL service; default starts an isolated local PG16 cluster.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {catalogueDeclarations,preservesCataloguePredecessor} from '../ci/tool-catalogue-lint.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migration='supabase/migrations/20271028000000_experience05_weekly_commitment_check.sql';
const readMigration='supabase/migrations/20271029000000_experience05_weekly_status_readback.sql';
const baselineRead=process.argv.includes('--baseline-read-preparation');
const ci=process.argv.includes('--postgres');
const simulateCiRole=process.argv.includes('--simulate-ci-role');
if(ci&&process.env.CI!=='true')throw new Error('--postgres is limited to the disposable CI service');
if(ci&&simulateCiRole)throw new Error('Role simulation is limited to a newly created local disposable cluster');
if(ci&&baselineRead)throw new Error('Negative baseline is limited to a newly created local disposable cluster');
if(ci&&process.env.PGHOST&&!['localhost','127.0.0.1'].includes(process.env.PGHOST))throw new Error('Loopback only');
const bin=process.env.WEEKLY_PROOF_PG_BIN??(process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'');
const command=name=>bin?join(bin,`${name}${process.platform==='win32'?'.exe':''}`):name;
const tempBase=process.env.WEEKLY_PROOF_TEMP_DIR??(process.platform==='win32'?resolve(root,'../test-temp'):tmpdir());
mkdirSync(tempBase,{recursive:true});
const scratch=mkdtempSync(join(tempBase,'paige-weekly-proof-'));
const port=ci?5432:56000+process.pid%2000;
const database=`paige_weekly_proof_${process.pid}_${Date.now()}`;
const args=db=>['-X','-q','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',db,'-A','-t','-v','ON_ERROR_STOP=1'];
const literal=v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
const source=path=>readFileSync(join(root,path),'utf8');
const migrationSource=source(migration);
const migrationHash=createHash('sha256').update(migrationSource).digest('hex');
const readMigrationSource=source(readMigration);
const readMigrationHash=createHash('sha256').update(readMigrationSource).digest('hex');
function run(sql,{actor='',tenant='',role='',db=database}={}){
  const prefix=`DO $ctx$ BEGIN PERFORM set_config('test.actor',${literal(actor)},false); PERFORM set_config('test.tenant',${literal(tenant)},false); END $ctx$;${role?`SET ROLE ${role};`:''}`;
  try{return execFileSync(command('psql'),args(db),{input:`\\set VERBOSITY verbose\n${prefix}\n${sql}`,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,timeout:60000,maxBuffer:8*1024*1024}).trim();}
  catch(e){throw new Error(String(e.stderr??e.message));}
}
function json(sql,ctx){return JSON.parse(run(sql,ctx));}
const cases=[];
function check(name,fn){fn();cases.push(name);console.log(`PASS ${name}`);}
function refuses(sql,ctx,code='42501'){assert.throws(()=>run(sql,ctx),new RegExp(code));}
function extractTable(text,name){const m=text.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name} \\([\\s\\S]+?\\n\\);`,'i'));assert(m,`${name} DDL present`);return m[0];}
function catalogueSource(declaration){
  // Selected actual function bodies only: never execute unrelated migrations in this fixture.
  const sql=declaration.sql;
  const fn=sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.list_tool_autonomy\s*\([\s\S]+?\bAS\s+(\$[a-z_0-9]*\$)[\s\S]+?\1\s*;/i);
  assert(fn,`${declaration.file}: actual catalogue function body`);
  let rename='';
  if(preservesCataloguePredecessor(sql)){
    const at=sql.search(/ALTER\s+FUNCTION\s+public\.list_tool_autonomy/i);
    const begin=sql.slice(0,at).lastIndexOf('DO $$'),end=sql.indexOf('END $$;',at);
    assert(begin>=0&&end>=0,`${declaration.file}: exact predecessor rename block`);
    rename=sql.slice(begin,end+'END $$;'.length);
  }
  const privileges=[...sql.matchAll(/(?:REVOKE|GRANT)[^;]*ON\s+FUNCTION\s+public\.(?:list_tool_autonomy|_list_tool_autonomy_[a-z0-9_]+)\(uuid\)[^;]*;/gi)].map(m=>m[0]).join('\n');
  return `${rename}\n${fn[0]}\n${privileges}`;
}
async function concurrent(sql,ctx,n=6){
  return Promise.all(Array.from({length:n},()=>new Promise((resolvePromise,reject)=>{
    const child=spawn(command('psql'),args(database),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);
    child.on('close',code=>code===0?resolvePromise(out.trim()):reject(new Error(err)));
    child.stdin.end(`DO $ctx$ BEGIN PERFORM set_config('test.actor',${literal(ctx?.actor??'')},false); PERFORM set_config('test.tenant',${literal(ctx?.tenant??'')},false); END $ctx$;${ctx?.role?`SET ROLE ${ctx.role};`:''}\n${sql}`);
  })));
}
const owner=randomUUID(),otherOwner=randomUUID(),member=randomUUID(),admin=randomUUID(),tenant=randomUUID(),foreign=randomUUID();
const ownerCtx={actor:owner,tenant,role:'authenticated'};
let started=false,created=false,roleCaptured=false,originalServiceRole=null,evidence=null;
const roleParity={simulated_incumbent_role:simulateCiRole,restoration_verified:false};
try{
  if(!ci){
    execFileSync(command('initdb'),['-D',join(scratch,'data'),'-A','trust','-U','postgres','--encoding=UTF8','--no-locale','--no-sync'],{windowsHide:true,stdio:'ignore',timeout:30000});
    started=true; // startup failures also attempt cleanup; Windows children must not inherit pipe handles.
    execFileSync(command('pg_ctl'),['-D',join(scratch,'data'),'-l',join(scratch,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{windowsHide:true,stdio:'ignore',timeout:30000});
    if(simulateCiRole)run('CREATE ROLE service_role NOBYPASSRLS;',{db:'postgres'});
  }
  run(`CREATE DATABASE ${database};`,{db:'postgres'});created=true;
  originalServiceRole=json("SELECT coalesce((SELECT jsonb_build_object('bypass_rls',rolbypassrls) FROM pg_roles WHERE rolname='service_role'),'null'::jsonb);",{db:'postgres'});
  roleCaptured=true;
  roleParity.original_exists=originalServiceRole!==null;
  roleParity.original_bypass_rls=originalServiceRole?.bypass_rls??null;
  run(`DO $roles$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $roles$;
    CREATE SCHEMA auth; CREATE SCHEMA cron; CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA realtime;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE tenants(id uuid PRIMARY KEY,name text,owner_user_id uuid,parent_tenant_id uuid,archive_operation_id uuid,
      archived_at timestamptz,lifecycle_execution_paused boolean DEFAULT false);
    CREATE TABLE tenant_members(tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,user_id uuid,role text,status text,PRIMARY KEY(tenant_id,user_id));
    CREATE TABLE user_roles(user_id uuid,role text);
    CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.tenant',true),'')::uuid $$;
    CREATE FUNCTION is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='super_admin') $$;
    CREATE FUNCTION is_tenant_member(_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_id AND user_id=auth.uid() AND status='active') $$;
    CREATE FUNCTION is_tenant_admin(_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_id AND user_id=auth.uid() AND status='active' AND role IN ('owner','admin')) $$;
    CREATE FUNCTION trust_effective_rung() RETURNS integer LANGUAGE sql AS $$ SELECT 3 $$;
    CREATE FUNCTION has_any_role(uuid,text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
    CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id));
    CREATE TABLE internal_bookings(id uuid PRIMARY KEY); CREATE TABLE paige_actions(id uuid PRIMARY KEY);
    CREATE TABLE paige_subagents(slug text PRIMARY KEY,rail_display_name text,tenant_id uuid);
    CREATE TABLE paige_departments(slug text PRIMARY KEY); INSERT INTO paige_departments VALUES('owner_ops');
    CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),user_id uuid,entity text,action text,entity_id uuid,data jsonb);
    CREATE FUNCTION is_platform_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('platform_admin','super_admin')) $$;
    CREATE FUNCTION get_actor_access(_actor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT jsonb_build_object('tier',CASE WHEN EXISTS(SELECT 1 FROM auth.users WHERE id=_actor) THEN 'tenant' ELSE 'client' END) $$;
    CREATE FUNCTION is_tenant_admin_as(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin')) $$;
    CREATE FUNCTION agency_can_manage_child(_child uuid,_actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,active_tenant_id uuid);
    ${extractTable(source('supabase/migrations/20270602000203_operator_account_archive.sql'),'operator_account_archives')}
    ALTER TABLE operator_account_archives ADD COLUMN external_cleanup jsonb DEFAULT '[]',ADD COLUMN resource_mode text,ADD COLUMN resource_plan jsonb;
    ${source('supabase/migrations/20270602000203_operator_account_archive.sql').match(/CREATE OR REPLACE FUNCTION public\.operator_can_retire_accounts\(\)[\s\S]+?\$\$;/)[0]}
    CREATE TABLE paige_pending_approvals(id uuid DEFAULT gen_random_uuid(),source text,status text,claimed_at timestamptz,
      metadata jsonb,tenant_id uuid,reviewed_at timestamptz);
    CREATE TABLE paige_journey_stage_transitions(id uuid,contact_id uuid,source_event text);
    CREATE TABLE paige_workspace_events(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,
      source_id uuid,source_revision bigint,outcome text,actor_agent_slug text,actor_agent_label text,capability_key text,
      occurred_at timestamptz DEFAULT now(),UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
    CREATE FUNCTION _workspace_event_display(text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT SELECT ON tenant_members,tenants TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    ${extractTable(source('supabase/migrations/20260711140000_action_bus.sql'),'paige_action_kinds')}
    ${extractTable(source('supabase/migrations/20260711340000_paige_planning.sql'),'plans')}
    ${extractTable(source('supabase/migrations/20260711340000_paige_planning.sql'),'plan_items')}`);
  // Earlier CI fixtures may create the shared role without Supabase's trusted-role BYPASSRLS.
  // Match that real infrastructure posture only in this loopback disposable proof; restore it below.
  if(originalServiceRole?.bypass_rls===false)run('ALTER ROLE service_role BYPASSRLS;',{db:'postgres'});
  assert.equal(run("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';"),'t');
  roleParity.effective_bypass_rls=true;
  run(source('supabase/migrations/20260711200000_paige_tool_autonomy.sql'));
  run(source('supabase/migrations/20270540000000_tool_autonomy_ceiling_fact.sql'));
  run(source('supabase/migrations/20270552000000_resolve_tool_autonomy_many.sql').split('-- paige_improvement_proposals: the tenant question')[0]);
  const declarations=catalogueDeclarations().filter(d=>d.file<migration.split('/').at(-1));
  const lastComplete=declarations.findLastIndex(d=>!preservesCataloguePredecessor(d.sql));
  assert(lastComplete>=0);
  for(const declaration of declarations.slice(lastComplete))run(catalogueSource(declaration));
  const catalogueSQL=target=>`SELECT jsonb_agg(to_jsonb(t) ORDER BY tool_key) FROM list_tool_autonomy(${literal(target)}) t;`;
  const priorCatalogue=json(catalogueSQL(tenant));assert.equal(priorCatalogue.length,declarations.at(-1).keys.size);
  for(const path of [
    'supabase/migrations/20261022000000_automations_the_process_record.sql',
    'supabase/migrations/20261024000000_resolve_automation_autonomy.sql',
    'supabase/migrations/20270119000000_contact_created_native_event.sql',
    'supabase/migrations/20270126000000_paige_act_execution_ledger.sql',
    'supabase/migrations/20271023000000_paige_act_dispatch_claim.sql',
    'supabase/migrations/20271025000100_paige_dispatch_crash_recovery.sql',
    'supabase/migrations/20270107000000_receipt_correlation_and_detail.sql',migration,migration])run(path===migration?migrationSource:source(path));
  run(`INSERT INTO auth.users VALUES(${literal(owner)}),(${literal(otherOwner)}),(${literal(member)}),(${literal(admin)});
    INSERT INTO tenants(id,name,owner_user_id) VALUES(${literal(tenant)},'test-tenant-weekly',${literal(owner)}),(${literal(foreign)},'test-tenant-foreign',${literal(otherOwner)});
    INSERT INTO tenant_members VALUES(${literal(tenant)},${literal(owner)},'owner','active'),(${literal(foreign)},${literal(otherOwner)},'owner','active'),
      (${literal(tenant)},${literal(member)},'member','active'),(${literal(tenant)},${literal(admin)},'admin','active');`);
  const zoneSource=source('supabase/migrations/20271026200000_exp04_client_status_business_time_zone.sql');
  run(extractTable(zoneSource,'tenant_business_time_zones'));
  run(zoneSource.match(/ALTER TABLE public\.tenant_business_time_zones ENABLE ROW LEVEL SECURITY;/)[0]);
  run(zoneSource.match(/REVOKE ALL ON public\.tenant_business_time_zones[^;]+;/)[0]);
  if(!baselineRead){run(readMigrationSource);run(readMigrationSource);}
  check('migration applies twice; catalogue stays dark',()=>assert.equal(run("SELECT is_live FROM paige_automation_triggers WHERE key='schedule.weekly_commitment_check';"),'f'));
  check('owner read supplies source actor clock and explicit bounded coverage',()=>{
    const data=json('SELECT get_weekly_commitment_checks();',ownerCtx);
    assert.equal(data.actor_id,owner);assert.equal(data.tenant_id,tenant);assert.equal(data.limit,50);
    assert.equal(data.has_more,false);assert(Number.isFinite(Date.parse(data.read_at)));
  });
  check('missing business zone is not a calendar staff profile or browser default',()=>{
    assert.deepEqual(json('SELECT get_weekly_commitment_checks();',ownerCtx).business_time_zone,{state:'missing',zone:null});
  });
  run('INSERT INTO tenant_business_time_zones(tenant_id,time_zone,set_by) VALUES('+literal(tenant)+",'America/New_York',"+literal(owner)+'),('+literal(foreign)+",'Europe/London',"+literal(otherOwner)+');');
  check('shared owner business setting is scoped and raw table privileges stay closed',()=>{
    assert.deepEqual(json('SELECT get_weekly_commitment_checks();',ownerCtx).business_time_zone,{state:'configured',zone:'America/New_York'});
    assert.equal(json('SELECT get_weekly_commitment_checks();',{actor:otherOwner,tenant:foreign,role:'authenticated'}).business_time_zone.zone,'Europe/London');
    for(const role of ['anon','authenticated','service_role'])refuses('SELECT * FROM tenant_business_time_zones;',{...ownerCtx,role});
  });
  check('invalid privileged zone degrades without exposing or defaulting the stored value',()=>{
    run('UPDATE tenant_business_time_zones SET time_zone='+literal('America/Not_A_Zone')+' WHERE tenant_id='+literal(tenant)+';');
    assert.deepEqual(json('SELECT get_weekly_commitment_checks();',ownerCtx).business_time_zone,{state:'invalid',zone:null});
    run("UPDATE tenant_business_time_zones SET time_zone='America/New_York' WHERE tenant_id="+literal(tenant)+';');
  });
  check('complete current incumbent catalogue survives replay with identical metadata and defaults',()=>{
    const after=json(catalogueSQL(tenant));assert.equal(after.length,priorCatalogue.length+1);
    assert.deepEqual(after.filter(row=>row.tool_key!=='planning_weekly_commitment_check'),priorCatalogue);
  });
  check('catalogue owner and platform scope preserve canonical predecessor policy',()=>{
    run("SELECT set_tool_autonomy('crm_create_contact','off');",ownerCtx);
    run("SELECT set_tool_autonomy('crm_create_contact','auto');",{actor:otherOwner,tenant:foreign,role:'authenticated'});
    refuses(catalogueSQL(foreign),ownerCtx);
    const own=json(catalogueSQL(tenant),ownerCtx);assert.equal(own.find(row=>row.tool_key==='crm_create_contact').mode,'off');
    run(`INSERT INTO user_roles VALUES(${literal(otherOwner)},'super_admin');`);
    const selected=json(catalogueSQL(tenant),{actor:otherOwner,tenant:foreign,role:'authenticated'});
    assert.deepEqual(selected,own);
    const other=json(catalogueSQL(foreign),{actor:otherOwner,tenant:foreign,role:'authenticated'});
    assert.equal(other.find(row=>row.tool_key==='crm_create_contact').mode,'auto');
    run(`DELETE FROM user_roles WHERE user_id=${literal(otherOwner)} AND role='super_admin';`);
  });
  const request=randomUUID();
  const draftSQL=`SELECT draft_weekly_commitment_check(${literal(request)},'Weekly commitment check',1,'09:00','America/New_York');`;
  check('owner draft intent is durable and idempotent',()=>{
    const first=json(draftSQL,ownerCtx),again=json(draftSQL,ownerCtx);assert.equal(first.automation_id,again.automation_id);assert.equal(again.reused,true);
  });
  const automation=json(draftSQL,ownerCtx).automation_id;
  const act=run(`SELECT id FROM paige_automation_acts WHERE automation_id=${literal(automation)};`);
  check('member/admin/foreign scope/service/anonymous cannot authorize',()=>{
    for(const ctx of [{actor:member,tenant,role:'authenticated'},{actor:admin,tenant,role:'authenticated'},
      {role:'service_role'},{role:'anon'}])
      refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'authorize',1);`,ctx);
    refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'authorize',1);`,{actor:otherOwner,tenant:foreign,role:'authenticated'},'P0002');
  });
  check('same intent cannot change approved input',()=>refuses(draftSQL.replace("'09:00'","'10:00'"),ownerCtx,'23505'));
  check('invalid timezone/time refused',()=>{
    refuses(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},'Invalid zone',1,'09:00','Not/AZone');`,ownerCtx,'22023');
    refuses(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},'Invalid time',1,'29:00','UTC');`,ownerCtx,'22023');
  });
  check('direct owner table activation is refused',()=>refuses(`UPDATE paige_automations SET state='live' WHERE id=${literal(automation)};`,ownerCtx));
  check('fixed act cannot be replaced or deleted',()=>{
    refuses(`UPDATE paige_automation_acts SET config='{"send":true}' WHERE id=${literal(act)};`,ownerCtx);
    refuses(`DELETE FROM paige_automation_acts WHERE id=${literal(act)};`,ownerCtx);
  });
  const authorized=json(`SELECT control_weekly_commitment_check(${literal(automation)},'authorize',1);`,ownerCtx);
  assert.equal(authorized.state,'live');
  check('schedule authorization leaves canonical permission default confirm',()=>{
    const policy=json("SELECT row_to_json(t) FROM list_tool_autonomy() t WHERE tool_key='planning_weekly_commitment_check';",ownerCtx);
    assert.equal(policy.mode,'confirm');assert.equal(policy.is_default,true);
    assert.equal(run(`SELECT count(*) FROM tenant_tool_autonomy WHERE tenant_id=${literal(tenant)} AND tool_key='planning_weekly_commitment_check';`),'0');
    const checkRow=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks[0];
    assert.equal(checkRow.execution_availability,'held');assert.equal(checkRow.next_run_at,null);assert(checkRow.intended_next_run_at);
  });
  check('dark trigger publishes nothing',()=>assert.equal(run('SELECT publish_due_weekly_commitment_checks();'),'0'));
  const makeDue=()=>run(`UPDATE paige_automations SET trigger_config=trigger_config||jsonb_build_object('next_run_at',now()-interval '1 minute',
    'authorized_at',now()-interval '1 hour','future_control_at',now()-interval '1 hour') WHERE id=${literal(automation)};
    UPDATE paige_automation_triggers SET is_live=true,dark_reason=NULL WHERE key='schedule.weekly_commitment_check';`);
  makeDue();
  check('released trigger with default-confirm permission still publishes nothing',()=>assert.equal(run('SELECT publish_due_weekly_commitment_checks();'),'0'));
  check('existing human Settings setter explicitly permits this one tool',()=>{
    refuses("SELECT set_tool_autonomy('planning_weekly_commitment_check','auto');",{actor:member,tenant,role:'authenticated'});
    run("SELECT set_tool_autonomy('planning_weekly_commitment_check','auto');",ownerCtx);
    assert.equal(run(`SELECT resolve_tool_autonomy(${literal(tenant)},'planning_weekly_commitment_check');`),'auto');
    const policy=json("SELECT row_to_json(t) FROM list_tool_autonomy() t WHERE tool_key='planning_weekly_commitment_check';",ownerCtx);
    assert.equal(policy.mode,'auto');assert.equal(policy.is_default,false);
  });
  const published=await concurrent('SELECT publish_due_weekly_commitment_checks();');
  check('concurrent publisher creates one occurrence',()=>assert.equal(published.map(Number).reduce((a,b)=>a+b,0),1));
  const event=run(`SELECT id FROM paige_native_events WHERE subject_id=${literal(automation)} ORDER BY occurred_at DESC LIMIT 1;`);
  const correlation=`proof:${event}:${act}`;const receipt=randomUUID();
  const seedExecution=()=>run(`SELECT paige_record_act_execution(${literal(event)},${literal(automation)},${literal(act)},1,${literal(tenant)},
    'native','planning.weekly_commitment_check','auto','accepted_for_execution',NULL,${literal(correlation)},${literal(correlation)},NULL,'{}',NULL,NULL,NULL);`);
  seedExecution();
  const claims=await concurrent(`SELECT coalesce((paige_claim_act_dispatch(${literal(event)},${literal(act)},gen_random_uuid())).id::text,'');`);
  check('concurrent dispatcher gets one claim',()=>assert.equal(claims.filter(Boolean).length,1));
  run(`INSERT INTO plan_items(tenant_id,item_type,title,status,created_by,assigned_to_user_id,due_at) VALUES
    (${literal(tenant)},'task','PRIVATE OWNER COMMITMENT','blocked',${literal(owner)},${literal(owner)},now()-interval '1 day'),
    (${literal(tenant)},'task','PRIVATE TEAMMATE COMMITMENT','open',${literal(member)},${literal(member)},now()-interval '1 day'),
    (${literal(foreign)},'task','FOREIGN COMMITMENT','open',${literal(otherOwner)},${literal(otherOwner)},now()-interval '1 day');`);
  json(`SELECT control_weekly_commitment_check(${literal(automation)},'pause',1);`,ownerCtx);
  const executeSQL=`SELECT execute_weekly_commitment_check(${literal(automation)},${literal(event)},${literal(act)},${literal(correlation)},${literal(receipt)});`;
  const executionResults=(await concurrent(executeSQL)).map(JSON.parse);
  check('pause after live claim allows one atomic observation',()=>{
    assert(executionResults.every(r=>r.outcome==='executed'));assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=${literal(receipt)};`),'1');
  });
  check('snapshot contains only personal canonical commitments',()=>{
    const observation=json(`SELECT detail->'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(event)};`);
    assert.equal(observation.open_count,1);assert.equal(observation.blocked_count,1);assert.equal(observation.items[0].title,'PRIVATE OWNER COMMITMENT');
  });
  check('private observation is unreadable by teammate/admin',()=>{
    for(const actor of [member,admin])assert.equal(run(`SELECT count(*) FROM paige_act_executions WHERE event_id=${literal(event)};`,{actor,tenant,role:'authenticated'}),'0');
  });
  check('shared receipt contains references without source titles/counts',()=>{
    const detail=json(`SELECT detail FROM paige_workspace_events WHERE source_id=${literal(receipt)};`);
    assert.equal(detail.confirmed_via,'weekly_commitment_observation');assert(!JSON.stringify(detail).includes('PRIVATE'));assert(!JSON.stringify(detail).includes('count'));
  });
  check('response loss reconciles durable result; duplicate does not resnapshot',()=>{
    run(`UPDATE plan_items SET status='done' WHERE created_by=${literal(owner)};`);
    const read=json(`SELECT read_weekly_commitment_check(${literal(automation)},${literal(event)},${literal(act)},${literal(correlation)});`);
    assert.equal(read.outcome,'executed');assert.equal(json(executeSQL).outcome,'executed');
    assert.equal(json(`SELECT detail->'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(event)};`).open_count,1);
  });
  check('matching committed observation and receipt settle an uncertain marker without replay',()=>{
    // Isolated legacy/reconciliation fixture: retain the canonical observation/receipt, alter only its state marker.
    run(`UPDATE paige_act_executions SET outcome='ambiguous' WHERE event_id=${literal(event)};`);
    assert.equal(json(`SELECT read_weekly_commitment_check(${literal(automation)},${literal(event)},${literal(act)},${literal(correlation)});`).outcome,'executed');
    assert.equal(run(`SELECT outcome FROM paige_act_executions WHERE event_id=${literal(event)};`),'executed');
    assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=${literal(receipt)};`),'1');
  });
  check('later conversation getter retains last run while paused',()=>{
    const checks=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks;
    assert.equal(checks[0].state,'paused');assert.equal(checks[0].next_run_at,null);assert.equal(checks[0].last_run.status,'completed');
  });
  check('edit disarms; stale revision and cancelled resume refused',()=>{
    const changed=json(`SELECT configure_weekly_commitment_check(${literal(automation)},2,'10:00','America/New_York',1);`,ownerCtx);
    assert.equal(changed.state,'draft');assert.equal(changed.revision,2);
    refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'authorize',1);`,ownerCtx,'40001');
    refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'resume',2);`,ownerCtx);
    json(`SELECT control_weekly_commitment_check(${literal(automation)},'cancel',2);`,ownerCtx);
    refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'resume',2);`,ownerCtx,'22023');
    refuses(`DELETE FROM paige_automations WHERE id=${literal(automation)};`,ownerCtx);
  });
  check('weekly local schedule preserves wall time across DST',()=>{
    const schedule="jsonb_build_object('weekday',1,'local_time','09:00','timezone','America/New_York')";
    assert.equal(run(`SELECT weekly_commitment_next(${schedule},'2026-03-06T12:00:00Z') AT TIME ZONE 'UTC';`),'2026-03-09 13:00:00');
    assert.equal(run(`SELECT weekly_commitment_next(${schedule},'2026-10-30T12:00:00Z') AT TIME ZONE 'UTC';`),'2026-11-02 14:00:00');
  });
  check('authenticated owner helper cannot probe another actor/workspace',()=>
    assert.equal(run(`SELECT weekly_commitment_owner(${literal(foreign)},${literal(otherOwner)});`,ownerCtx),'f'));
  check('global operator role is not weekly owner authority',()=>{
    run(`INSERT INTO user_roles VALUES(${literal(admin)},'platform_admin');`);
    refuses(`SELECT control_weekly_commitment_check(${literal(automation)},'authorize',2);`,{actor:admin,tenant,role:'authenticated'});
  });
  check('inactive/revoked owner cannot configure or read',()=>{
    run(`UPDATE tenant_members SET status='inactive' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
    refuses('SELECT get_weekly_commitment_checks();',ownerCtx);
    refuses(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},'Revoked draft',1,'09:00','UTC');`,ownerCtx);
    run(`UPDATE tenant_members SET status='active' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
  });
  const concurrentIntent=randomUUID();
  const drafts=(await concurrent(`SELECT draft_weekly_commitment_check(${literal(concurrentIntent)},'Concurrent intent',1,'09:00','UTC');`,ownerCtx)).map(JSON.parse);
  check('concurrent draft retries share one canonical process',()=>{
    assert.equal(new Set(drafts.map(d=>d.automation_id)).size,1);assert.equal(drafts.filter(d=>d.reused===false).length,1);
  });
  const queuedDraft=drafts[0].automation_id;
  run(`UPDATE paige_automations SET trigger_config=trigger_config||jsonb_build_object('next_run_at',now()-interval '1 minute') WHERE id=${literal(queuedDraft)};`);
  check('unapproved due-looking draft never publishes',()=>{
    run('SELECT publish_due_weekly_commitment_checks();');assert.equal(run(`SELECT count(*) FROM paige_native_events WHERE subject_id=${literal(queuedDraft)};`),'0');
  });
  function occurrence(name,{seed=true}={}){
    const id=json(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},${literal(name)},1,'09:00','UTC');`,ownerCtx).automation_id;
    json(`SELECT control_weekly_commitment_check(${literal(id)},'authorize',1);`,ownerCtx);
    run(`UPDATE paige_automations SET trigger_config=trigger_config||jsonb_build_object('next_run_at',now()-interval '1 minute',
      'authorized_at',now()-interval '1 hour','future_control_at',now()-interval '1 hour') WHERE id=${literal(id)}; SELECT publish_due_weekly_commitment_checks();`);
    const eventId=run(`SELECT id FROM paige_native_events WHERE subject_id=${literal(id)} ORDER BY occurred_at DESC LIMIT 1;`);
    const actId=run(`SELECT id FROM paige_automation_acts WHERE automation_id=${literal(id)};`);
    const corr=`proof:${eventId}:${actId}`;const receiptId=randomUUID();
    if(seed)run(`SELECT paige_record_act_execution(${literal(eventId)},${literal(id)},${literal(actId)},1,${literal(tenant)},
      'native','planning.weekly_commitment_check','auto','accepted_for_execution',NULL,${literal(corr)},${literal(corr)},NULL,'{}',NULL,NULL,NULL);`);
    return {id,eventId,actId,corr,receiptId,
      claim:`SELECT paige_claim_act_dispatch(${literal(eventId)},${literal(actId)},gen_random_uuid());`,
      execute:`SELECT execute_weekly_commitment_check(${literal(id)},${literal(eventId)},${literal(actId)},${literal(corr)},${literal(receiptId)});`,
      read:`SELECT read_weekly_commitment_check(${literal(id)},${literal(eventId)},${literal(actId)},${literal(corr)});`};
  }
  function stale(s,outcome='accepted_for_execution'){
    // Explicit isolated crash fixture; preserve the production touch trigger outside this one backdate.
    run(`ALTER TABLE paige_act_executions DISABLE TRIGGER trg_paige_act_executions_touch;
      UPDATE paige_act_executions SET outcome=${literal(outcome)},updated_at=now()-interval '11 minutes',
        detail=detail||jsonb_build_object('dispatch_claim',gen_random_uuid(),'dispatch_claimed_at',now()-interval '11 minutes')
        WHERE event_id=${literal(s.eventId)} AND act_id=${literal(s.actId)};
      ALTER TABLE paige_act_executions ENABLE TRIGGER trg_paige_act_executions_touch;
      UPDATE paige_native_events SET processing_state='error',attempts=5 WHERE id=${literal(s.eventId)};`);
  }
  const darkAfterPublish=occurrence('Released then held');run(darkAfterPublish.claim);
  check('catalogue dark after publication blocks a new observation',()=>{
    run("UPDATE paige_automation_triggers SET is_live=false,dark_reason='Isolated proof hold' WHERE key='schedule.weekly_commitment_check';");
    assert.equal(json(darkAfterPublish.execute).outcome,'failed');
    assert.equal(run(`SELECT detail ? 'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(darkAfterPublish.eventId)};`),'f');
    // Committed evidence remains readable while future/new work is dark.
    assert.equal(json(`SELECT read_weekly_commitment_check(${literal(automation)},${literal(event)},${literal(act)},${literal(correlation)});`).outcome,'executed');
    assert.equal(json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===darkAfterPublish.id).next_run_at,null);
    run("UPDATE paige_automation_triggers SET is_live=true,dark_reason=NULL WHERE key='schedule.weekly_commitment_check';");
  });
  check('weekly Rail display is meaningful and contains no private observation',()=>{
    const display=json("SELECT _workspace_event_display('capability_run','capability_succeeded','planning_weekly_commitment_check');");
    assert.equal(display.title,'Weekly commitment check completed');assert(display.summary.includes('internal commitment check'));
    assert(!JSON.stringify(display).includes('PRIVATE'));assert(!JSON.stringify(display).includes('count'));
  });
  const toolHeld=occurrence('Canonical tool lane hold');run(toolHeld.claim);
  check('off/confirm canonical tool lane blocks publisher execution and actual-next claim',()=>{
    for(const lane of ['off','confirm']){
      run(`SELECT set_tool_autonomy('planning_weekly_commitment_check',${literal(lane)});`,ownerCtx);
      run(`UPDATE paige_automations SET trigger_config=trigger_config||jsonb_build_object('next_run_at',now()-interval '1 minute') WHERE id=${literal(toolHeld.id)};`);
      const before=run(`SELECT count(*) FROM paige_native_events WHERE subject_id=${literal(toolHeld.id)};`);
      run('SELECT publish_due_weekly_commitment_checks();');
      assert.equal(run(`SELECT count(*) FROM paige_native_events WHERE subject_id=${literal(toolHeld.id)};`),before);
      assert.equal(json(toolHeld.execute).outcome,'failed');
      const checkRow=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===toolHeld.id);
      assert.equal(checkRow.execution_availability,'held');assert.equal(checkRow.next_run_at,null);assert(checkRow.intended_next_run_at);
    }
    run("SELECT set_tool_autonomy('planning_weekly_commitment_check','auto');",ownerCtx);
    // Keep this occurrence's following slot future so unrelated later proofs do not publish it again.
    run(`UPDATE paige_automations SET trigger_config=trigger_config||jsonb_build_object('next_run_at',now()+interval '7 days') WHERE id=${literal(toolHeld.id)};`);
  });
  const paused=occurrence('Paused before start');
  json(`SELECT control_weekly_commitment_check(${literal(paused.id)},'pause',1);`,ownerCtx);
  run(paused.claim);
  check('pause before claim refuses old occurrence',()=>{
    assert.equal(json(paused.execute).outcome,'failed');assert.equal(run(`SELECT detail ? 'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(paused.eventId)};`),'f');
  });
  json(`SELECT control_weekly_commitment_check(${literal(paused.id)},'pause',1);`,ownerCtx);
  json(`SELECT control_weekly_commitment_check(${literal(paused.id)},'resume',1);`,ownerCtx);
  check('second pause/resume cannot bless claim acquired after first pause',()=>assert.equal(json(paused.execute).outcome,'failed'));
  const recovery=occurrence('Accepted crash recovery');stale(recovery);
  check('stale accepted claim proves absence and reopens exhausted canonical event',()=>{
    assert.equal(json(recovery.read).detail.proven_absent,true);run('SELECT paige_reconcile_orchestration_acts();');
    assert.equal(run(`SELECT processing_state||':'||attempts FROM paige_native_events WHERE id=${literal(recovery.eventId)};`),'pending:4');
    assert.equal(run(`SELECT detail->>'dispatch_recoveries' FROM paige_act_executions WHERE event_id=${literal(recovery.eventId)};`),'1');
  });
  run(recovery.claim);
  check('recovered accepted occurrence executes once under same identity',()=>{
    assert.equal(json(recovery.execute).outcome,'executed');assert.equal(json(recovery.execute).outcome,'executed');
    assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=${literal(recovery.receiptId)};`),'1');
  });
  const recoveryOff=occurrence('Recovery authority revoked');stale(recoveryOff);
  run("SELECT set_tool_autonomy('planning_weekly_commitment_check','off');",ownerCtx);
  check('canonical tool revocation prevents recovery reopening',()=>{
    run('SELECT paige_reconcile_orchestration_acts();');
    assert.equal(run(`SELECT outcome FROM paige_act_executions WHERE event_id=${literal(recoveryOff.eventId)};`),'failed');
    assert.equal(run(`SELECT processing_state||':'||attempts FROM paige_native_events WHERE id=${literal(recoveryOff.eventId)};`),'error:5');
  });
  run("SELECT set_tool_autonomy('planning_weekly_commitment_check','auto');",ownerCtx);
  const unknown=occurrence('Unknown crash outcome');stale(unknown,'ambiguous');
  check('unknown outcome is never automatically replayed',()=>{
    assert.equal(json(unknown.read).detail.proven_absent,false);run('SELECT paige_reconcile_orchestration_acts();');
    assert.equal(run(`SELECT outcome FROM paige_act_executions WHERE event_id=${literal(unknown.eventId)};`),'ambiguous');
    assert.equal(run(`SELECT processing_state||':'||attempts FROM paige_native_events WHERE id=${literal(unknown.eventId)};`),'error:5');
    assert.equal(json(unknown.execute).outcome,'ambiguous');
  });
  const exhausted=occurrence('Bounded recovery exhausted');stale(exhausted);
  run(`UPDATE paige_act_executions SET detail=detail||'{"dispatch_recoveries":3}' WHERE event_id=${literal(exhausted.eventId)};`);
  stale(exhausted);
  check('proven never-started recovery is bounded',()=>{
    run('SELECT paige_reconcile_orchestration_acts();');
    assert.equal(run(`SELECT outcome FROM paige_act_executions WHERE event_id=${literal(exhausted.eventId)};`),'failed');
  });
  const receiptFailure=occurrence('Receipt transaction failure');run(receiptFailure.claim);
  run(`CREATE FUNCTION proof_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.source_id=${literal(receiptFailure.receiptId)}::uuid THEN RAISE EXCEPTION 'injected_receipt_storage_failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER proof_reject_receipt BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_reject_receipt();`);
  check('actual canonical receipt failure rolls snapshot and terminal outcome back',()=>{
    refuses(receiptFailure.execute,{},'P0001');
    assert.equal(run(`SELECT outcome FROM paige_act_executions WHERE event_id=${literal(receiptFailure.eventId)};`),'accepted_for_execution');
    assert.equal(run(`SELECT detail ? 'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(receiptFailure.eventId)};`),'f');
    assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=${literal(receiptFailure.receiptId)};`),'0');
  });
  run('DROP TRIGGER proof_reject_receipt ON paige_workspace_events; DROP FUNCTION proof_reject_receipt();');
  const revoked=occurrence('Revoked after publication');run(revoked.claim);
  run(`UPDATE tenant_members SET role='member' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
  check('owner role revocation blocks an existing live claim',()=>assert.equal(json(revoked.execute).outcome,'failed'));
  run(`UPDATE tenant_members SET role='owner' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
  const many=occurrence('Bounded observation');run(many.claim);
  run(`INSERT INTO plan_items(tenant_id,item_type,title,status,created_by,assigned_to_user_id)
    SELECT ${literal(tenant)},'task','Synthetic commitment '||n,'open',${literal(owner)},${literal(owner)} FROM generate_series(1,51) n;`);
  check('more than fifty commitments preserves uncapped counts and explicit truncation',()=>{
    assert.equal(json(many.execute).outcome,'executed');
    const observation=json(`SELECT detail->'weekly_commitment_observation' FROM paige_act_executions WHERE event_id=${literal(many.eventId)};`);
    assert.equal(observation.open_count,51);assert.equal(observation.items.length,50);assert.equal(observation.truncated,true);
  });
  run(`UPDATE paige_act_executions SET detail=detail-'weekly_commitment_observation' WHERE event_id=${literal(many.eventId)};`);
  check('executed label without correlated observation is unknown in owner getter',()=>
    assert.equal(json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===many.id).last_run.status,'unknown'));
  for(const [outcome,status] of [['approval_pending','needs_approval'],['held_by_lane','held'],['refused_authority','refused'],['condition_not_matched','skipped']]){
    const sample=occurrence(`Honest ${outcome}`);
    // Fresh canonical decision row, not an illegal transition over a started act.
    run(`DELETE FROM paige_act_executions WHERE event_id=${literal(sample.eventId)};
      SELECT paige_record_act_execution(${literal(sample.eventId)},${literal(sample.id)},${literal(sample.actId)},1,${literal(tenant)},
      'native','planning.weekly_commitment_check','confirm',${literal(outcome)},'fixture_decision',${literal(sample.corr)},${literal(sample.corr)},NULL,'{}',NULL,NULL,NULL);`);
    check(`canonical ${outcome} is reported ${status}`,()=>
      assert.equal(json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===sample.id).last_run.status,status));
  }
  const history=occurrence('Readback history');run(history.claim);assert.equal(json(history.execute).outcome,'executed');
  check('newer unknown attempt preserves separate verified result and historical schedule revision',()=>{
    const newEvent=randomUUID(),newCorrelation='proof-newer:'+newEvent;
    run("INSERT INTO paige_native_events(id,tenant_id,event_key,subject_table,subject_id,dedup_key,payload,occurred_at,processing_state) SELECT "+
      literal(newEvent)+",tenant_id,event_key,subject_table,subject_id,"+literal(newCorrelation)+",payload,occurred_at+interval '1 second','done' FROM paige_native_events WHERE id="+literal(history.eventId)+';');
    run('SELECT paige_record_act_execution('+literal(newEvent)+','+literal(history.id)+','+literal(history.actId)+',1,'+literal(tenant)+
      ",'native','planning.weekly_commitment_check','auto','ambiguous',NULL,"+literal(newCorrelation)+','+literal(newCorrelation)+",NULL,'{}',NULL,NULL,NULL);");
    const read=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===history.id);
    assert.equal(read.last_run.event_id,newEvent);assert.equal(read.last_run.status,'unknown');
    assert.equal(read.last_verified_run.event_id,history.eventId);assert.equal(read.last_verified_run.observation.receipt_id,history.receiptId);
    assert.equal(read.last_verified_run.observation.schedule_revision,1);
    json('SELECT configure_weekly_commitment_check('+literal(history.id)+",1,'10:00','UTC',1);",ownerCtx);
    const revised=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===history.id);
    assert.equal(revised.revision,2);assert.equal(revised.last_verified_run.observation.schedule_revision,1);assert.equal(revised.next_run_at,null);
  });
  check('receipt absence cannot create historical verified completion',()=>{
    run('DELETE FROM paige_workspace_events WHERE source_id='+literal(history.receiptId)+';');
    const read=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===history.id);
    assert.equal(read.last_verified_run,null);assert.equal(read.last_run.status,'unknown');
  });
  check('business setting update does not rewrite approved schedule or future process input',()=>{
    const before=json('SELECT trigger_config FROM paige_automations WHERE id='+literal(history.id)+';');
    run("UPDATE tenant_business_time_zones SET time_zone='Europe/London' WHERE tenant_id="+literal(tenant)+';');
    const read=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===history.id);
    assert.deepEqual(read.schedule,before);assert.equal(read.schedule.timezone,'UTC');
    run("UPDATE tenant_business_time_zones SET time_zone='America/New_York' WHERE tenant_id="+literal(tenant)+';');
  });
  check('both DST changes use canonical ISO Sunday local schedule without client recurrence',()=>{
    for(const zone of ['CET','GMT','EST'])assert.equal(json('SELECT weekly_commitment_schedule(1,\'09:00\','+literal(zone)+');').timezone,zone);
    const cfg=literal(JSON.stringify({weekday:7,local_time:'09:00',timezone:'America/New_York'}))+'::jsonb';
    for(const [after,expected]of[['2026-03-01T13:59:00Z','2026-03-01T14:00:00Z'],['2026-03-08T12:59:00Z','2026-03-08T13:00:00Z'],['2026-10-25T12:59:00Z','2026-10-25T13:00:00Z'],['2026-11-01T13:59:00Z','2026-11-01T14:00:00Z']]){
      assert.equal(Date.parse(run('SELECT weekly_commitment_next('+cfg+','+literal(after)+'::timestamptz);')),Date.parse(expected));
    }
  });
  check('owner getter reads create no process event act or receipt',()=>{
    const counts="SELECT jsonb_build_array((SELECT count(*) FROM paige_automations),(SELECT count(*) FROM paige_native_events),(SELECT count(*) FROM paige_act_executions),(SELECT count(*) FROM paige_workspace_events));";
    const before=json(counts);json('SELECT get_weekly_commitment_checks();',ownerCtx);json('SELECT get_weekly_commitment_checks();',ownerCtx);assert.deepEqual(json(counts),before);
  });
  check('fifty-row owner read exposes has_more instead of pretending complete coverage',()=>{
    for(let n=0;n<51;n++)json('SELECT draft_weekly_commitment_check('+literal(randomUUID())+','+literal('Bounded read '+n)+",1,'09:00','UTC');",ownerCtx);
    const first=json('SELECT get_weekly_commitment_checks();',ownerCtx),second=json('SELECT get_weekly_commitment_checks();',ownerCtx);
    assert.equal(first.checks.length,50);assert.equal(first.has_more,true);assert.deepEqual(first.checks.map(c=>c.automation_id),second.checks.map(c=>c.automation_id));
  });
  const actualEngine=occurrence('Actual governed engine',{seed:false});
  // Supabase's base service-role table privileges are infrastructure; source functions remain unchanged.
  run('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;');
  const eventClaim=json(`SELECT paige_claim_event(${literal(actualEngine.eventId)});`);assert.equal(eventClaim.claimed,true);
  const bridgeConfig=join(scratch,'engine-transport.json');
  writeFileSync(bridgeConfig,JSON.stringify({psql:command('psql'),port,database,eventId:actualEngine.eventId}));
  check('actual governed engine Gateway native adapter SQL observation and redrain',()=>{
    const bridge=()=>execFileSync(process.execPath,['--experimental-transform-types',join(root,'scripts/proof/weekly-commitment-engine.mjs'),bridgeConfig],
      {encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
    if(simulateCiRole){
      run('ALTER ROLE service_role NOBYPASSRLS;',{db:'postgres'});
      try{
        assert.equal(run(`SELECT count(*) FROM paige_native_events WHERE id=${literal(actualEngine.eventId)};`,{role:'service_role'}),'0');
        assert.throws(bridge,error=>String(error.stderr??error.message).includes('canonical claimed event is not visible')
          && String(error.stderr??error.message).includes('"bypass_rls":false'));
        assert.equal(run(`SELECT count(*) FROM paige_act_executions WHERE event_id=${literal(actualEngine.eventId)};`),'0');
        roleParity.non_bypass_failure_reproduced=true;
      }finally{run('ALTER ROLE service_role BYPASSRLS;',{db:'postgres'});}
    }
    const output=bridge();
    const proof=JSON.parse(output.trim());assert.equal(proof.status,'PASS');assert.equal(proof.actual_engine,true);
    assert.equal(proof.executed,1);assert.equal(proof.redrain_adopted,true);
    assert.equal(proof.actual_prepared_owner_reader,true);assert.equal(proof.actual_calendar_projection,true);
    assert.equal(proof.inspection_rows_written,0);assert.equal(proof.outbound_requests,0);console.log(output.trim());
  });
  const retirement=source('supabase/migrations/20270602000504_operator_provider_independent_retirement.sql');
  const archives=source('supabase/migrations/20270602000203_operator_account_archive.sql');
  run(`CREATE FUNCTION operator_preview_account_deletion(uuid) RETURNS jsonb LANGUAGE sql AS $$
      SELECT '{"version":"fixture-v1","execution_available":true}'::jsonb $$;
    CREATE FUNCTION operator_external_retirement_inventory(uuid[]) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
    CREATE FUNCTION operator_detach_pending_provider_preparation(uuid[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION operator_remove_retired_credentials(uuid[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION operator_account_deletion_plan(_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
    DECLARE table_name text; tids jsonb; plan jsonb:='{}'; BEGIN
      FOREACH table_name IN ARRAY ARRAY['tenant_members','tenant_tool_autonomy','tenant_business_time_zones','plan_items','plans','paige_automations','paige_native_events',
        'paige_event_dispatches','paige_act_executions','paige_workspace_events'] LOOP
        EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text),''[]''::jsonb) FROM public.%I WHERE tenant_id=ANY($1)',table_name) INTO tids USING _ids;
        IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object(table_name,jsonb_build_object('disposition','delete','tids',tids)); END IF;
      END LOOP;
      SELECT coalesce(jsonb_agg(ac.ctid::text),'[]'::jsonb) INTO tids FROM paige_automation_acts ac JOIN paige_automations a ON a.id=ac.automation_id WHERE a.tenant_id=ANY(_ids);
      IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object('paige_automation_acts',jsonb_build_object('disposition','delete','tids',tids)); END IF;
      SELECT coalesce(jsonb_agg(ctid::text),'[]'::jsonb) INTO tids FROM tenants WHERE id=ANY(_ids);
      IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object('tenants',jsonb_build_object('disposition','delete','tids',tids)); END IF;
      RETURN jsonb_build_object('tables',plan); END $$;
    ${archives.match(/CREATE OR REPLACE FUNCTION public\.operator_lock_retirement_scope\(\)[\s\S]+?\$\$;/)[0]}
    ${archives.match(/CREATE OR REPLACE FUNCTION public\.operator_retirement_fk_join\(_constraint oid\)[\s\S]+?\$\$;/)[0]}
    ${retirement.match(/CREATE OR REPLACE FUNCTION public\.operator_read_archive_receipt\(_tenant_id uuid,_operation_id uuid\)[\s\S]+?END \$\$;/)[0]}
    ${retirement.match(/CREATE OR REPLACE FUNCTION public\.operator_delete_archived_account\(_tenant_id uuid,_expected_version text,_confirmation_name text,_operation_id uuid\)[\s\S]+?END \$\$;/)[0]}`);
  const operator=randomUUID(),operation=randomUUID();
  run(`INSERT INTO auth.users VALUES(${literal(operator)}); INSERT INTO user_roles VALUES(${literal(operator)},'platform_admin');
    INSERT INTO operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members)
      VALUES(${literal(operation)},${literal(tenant)},${literal(operator)},'test-tenant-weekly','archived',ARRAY[${literal(tenant)}::uuid],'[]','[]');`);
  check('canonical retirement denies ordinary owner',()=>
    refuses(`SELECT operator_delete_archived_account(${literal(tenant)},'fixture-v1','test-tenant-weekly',${literal(operation)});`,ownerCtx));
  check('canonical operator child-before-parent retirement preserves its gate and succeeds',()=>{
    const receipt=json(`SELECT operator_delete_archived_account(${literal(tenant)},'fixture-v1','test-tenant-weekly',${literal(operation)});`,{actor:operator,tenant,role:'authenticated'});
    assert.equal(receipt.state,'deleted');assert.equal(run(`SELECT count(*) FROM paige_automations WHERE tenant_id=${literal(tenant)};`),'0');
  });
  check('canonical tenant FK retirement remains possible',()=>{
    run(`DELETE FROM tenants WHERE id=${literal(foreign)};`);
    assert.equal(run(`SELECT count(*) FROM tenants WHERE id=${literal(foreign)};`),'0');
  });
  const schemaFingerprint=run("SELECT md5(string_agg(pg_get_functiondef(p.oid),E'\\n' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%weekly_commitment%';");
  evidence={status:'PASS',cases:cases.length,checks:cases,source:migration,migration_sha256:migrationHash,
    read_preparation:{source:readMigration,migration_sha256:readMigrationHash,actual_canonical_owner_rpc:true,actual_prepared_owner_reader:true,calendar_records_written:0},
    schema_fingerprint:schemaFingerprint,
    fixture_service_role:roleParity,
    incumbent_catalogue:{source:declarations.at(-1).file,rows:priorCatalogue.length,preserved_metadata_and_defaults:true},
    boundary:'isolated PostgreSQL selected canonical substrate; auth/context/trust/cron/network/display and operator preflight/provider/inventory doubles; actual operator gate/delete loop; no deployed/authenticated browser claim'};
  writeFileSync(join(scratch,'result.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));console.log(`Evidence: ${join(scratch,'result.json')}`);
}finally{
  if(created){try{run(`DROP DATABASE ${database};`,{db:'postgres'});}catch(e){console.error('Cleanup failed',e.message);process.exitCode=1;}}
  if(roleCaptured){try{
    if(originalServiceRole){
      run(`ALTER ROLE service_role ${originalServiceRole.bypass_rls?'BYPASSRLS':'NOBYPASSRLS'};`,{db:'postgres'});
      assert.equal(run("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';",{db:'postgres'}),originalServiceRole.bypass_rls?'t':'f');
    }else{
      run('DROP ROLE IF EXISTS service_role;',{db:'postgres'});
      assert.equal(run("SELECT count(*) FROM pg_roles WHERE rolname='service_role';",{db:'postgres'}),'0');
    }
    roleParity.restoration_verified=true;
    if(evidence)writeFileSync(join(scratch,'result.json'),JSON.stringify(evidence,null,2));
    console.log('Fixture service_role original posture restored and verified');
  }catch(e){console.error('Fixture service_role restoration failed',e.message);process.exitCode=1;}}
    if(started){try{execFileSync(command('pg_ctl'),['-D',join(scratch,'data'),'-m','fast','-w','stop'],{windowsHide:true,stdio:'ignore',timeout:30000});}catch(e){console.error('Local cluster stop failed',e.message);process.exitCode=1;}}
}
