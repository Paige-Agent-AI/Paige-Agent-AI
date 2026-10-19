/** Native publication read proof. Empty disposable loopback int336_test* databases only.
 * Reuses the INT-336 canonical fixture and exact installed helper/migration bodies.
 * Identity GUCs/fixture activation are synthetic; no JWT cryptography or hosted-schema claim.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const url=process.env.INT336_DATABASE_URL;
const parsed=new URL(url);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&/^\/int336_test[a-z0-9_]*$/i.test(parsed.pathname),'Empty disposable loopback int336_test* database required');
const root=path.resolve(import.meta.dirname,'..'),psql=process.env.PSQL_BIN??'psql';
const args=['-X','-qAt','-v','ON_ERROR_STOP=1',url];
const raw=sql=>spawnSync(psql,args,{input:sql,encoding:'utf8',timeout:30000,windowsHide:true});
const run=sql=>{const r=raw(sql);assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
assert.equal(run("select to_regclass('public.paige_chat_threads') is null"),'t','Use a fresh empty fixture DB');
const migration=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replace(/^begin;\r?$/img,'').replace(/^commit;\r?$/img,'');
const definition=(file,signature)=>{
 const source=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
 const start=source.toLowerCase().indexOf(`create or replace function public.${signature}`.toLowerCase());
 assert.ok(start>=0,signature);const tail=source.slice(start),as=/\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);assert.ok(as,signature);
 const end=tail.indexOf(as[1],as.index+as[0].length);assert.ok(end>=0,signature);
 const ddl=tail.slice(0,end+as[1].length)+';';assert.match(ddl,/\bstable\b/i);return ddl;
};
const emitted=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],{encoding:'utf8',env:process.env,windowsHide:true});
assert.equal(emitted.status,0,emitted.stderr);
const baseline=emitted.stdout.slice(0,emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
assert.ok(baseline.startsWith('begin;'));
const helperDefinitions=[
 ['20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_super_admin()'],
 ['20260714142258_tier_rail_phaseB.sql','is_platform_admin(_actor uuid)'],
 ['20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c.sql','is_platform_owner()'],
 ['20260816130000_operator_role_tiers_and_grant_lockdown.sql','is_platform_operator()'],
 ['20260714051416_fix_agency_team_enforcement.sql','agency_team_role(_agency uuid, _actor uuid)'],
 ['20260714051416_fix_agency_team_enforcement.sql','agency_can_manage_child(_child uuid, _actor uuid)'],
 ['20270521000000_operator_authority_in_company_workspaces.sql','is_company_workspace(_tenant uuid)'],
 ['20270521000000_operator_authority_in_company_workspaces.sql','is_tenant_member(_tenant uuid)'],
 ['20260714144656_tier_rail_phaseB_agency_standing.sql','current_user_tenant_id()'],
].map(([file,signature])=>definition(file,signature)).join('\n');
run(baseline+`\ncreate type public.app_role as enum('super_admin','platform_admin','owner','admin','member');
create table public.profiles(user_id uuid primary key,active_tenant_id uuid);
create table public.tenants(id uuid primary key,parent_tenant_id uuid,account_type text,features jsonb default '{}');
create table public.tenant_members(tenant_id uuid,user_id uuid,status text,role text,joined_at timestamptz,primary key(tenant_id,user_id));
create table public.agency_team_members(agency_tenant_id uuid,user_id uuid,status text,agency_role text,scoped_subaccounts uuid[]);
create table public.user_roles(user_id uuid,role public.app_role);
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
`+helperDefinitions+'\n'+migration('20270601000008_int346_server_issued_interactive_receipts.sql')+'\n'
 +migration('20270602000301_int346_conversational_admission.sql')+'\n'+migration('20271108110000_int346_database_executor_isolation.sql')+`\ncommit;
-- Fixture-only rollout state, not native activation/retirement proof.
update public.paige_chat_interactive_rollout set active=true,edge_head=repeat('a',40),drain_evidence_sha256=repeat('b',64);`);
const candidate=fs.readFileSync(path.join(root,'supabase/migrations/20271108170000_int336_publication_context_v2.sql'),'utf8');
const authorityDefinitions=()=>run("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\\n' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname<>'paige_chat_interactive_publication_context_v2';");
const authorityBefore=authorityDefinitions();
run(candidate);run(candidate); // additive/replayable function installation
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(2),tenant=id(3),other=id(13),foreign=id(9),owner=id(11),operator=id(12),company=id(14),member=id(15);
const q=v=>v===null?'null':`'${String(v).replaceAll("'","''")}'`;
const auth=(who=actor)=>`reset role;set test.actor=${q(who??'')};set role authenticated;`;
const service='reset role;set role service_role;';
const call=(thread,intent,who=actor)=>run(`${auth(who)}select public.paige_chat_interactive_publication_context_v2(${q(thread)},${q(intent)});`);
let serial=100,checks=0;
const check=(actual,expected,label)=>{assert.equal(actual,expected,label);checks++;};
check(authorityDefinitions(),authorityBefore,'all existing public native/helper definitions and ACLs preserved after replay');
run(`insert into public.tenants(id,account_type,features) values('${tenant}','standalone','{}'),('${other}','standalone','{}'),('${company}','standalone','{"system_workspace":true}');
insert into public.profiles(user_id,active_tenant_id) values('${actor}','${tenant}'),('${foreign}','${tenant}'),('${owner}',null),('${operator}','${company}'),('${member}','${tenant}');
insert into public.tenant_members values('${tenant}','${actor}','active','owner',now()),('${other}','${actor}','active','owner',now()),('${other}','${owner}','active','member',now()),('${tenant}','${member}','active','member',now()),('${tenant}','${foreign}','active','member',now());
insert into public.user_roles values('${owner}','super_admin'),('${operator}','platform_admin');`);
run(`update public.tenant_members set joined_at='2020-01-01T00:00:00Z'where tenant_id='${tenant}'and user_id='${actor}';update public.tenant_members set joined_at='2020-01-02T00:00:00Z'where tenant_id='${other}'and user_id='${actor}';`);
const prepare=(who=actor,workspace=tenant,{settle=true,release=true,state='WAIT_APPROVAL'}={})=>{
 const thread=id(serial++),intent=id(serial++);
 run(`insert into public.paige_chat_threads(id,caller_user_id,tenant_id)values(${q(thread)},${q(who)},${q(workspace)});
 ${auth(who)}select public.paige_chat_interactive_begin_v2('${thread}','${intent}',null,'Fixture instruction',false,false,true);
 ${service}select public.paige_chat_interactive_executor_v2('${thread}',${q(who)},${q(workspace)},'${intent}','acquire');
 ${settle?`select public.paige_chat_interactive_settle('${thread}',${q(who)},${q(workspace)},'${intent}','Fixture terminal',null,null,
 '{"interactive":{"request_intent_id":"${intent}"},"turn_state":{"v":1,"state":"${state}"}}'::jsonb,null);`:''}
 ${settle&&release?`select public.paige_chat_interactive_executor_v2('${thread}',${q(who)},${q(workspace)},'${intent}','release');`:''}`);
 return {thread,intent,who,workspace};
};
const good=prepare();
check(call(good.thread,good.intent),'t','native canonical terminal + released executor + current owned scope');
const signature='public.paige_chat_interactive_publication_context_v2(uuid,uuid)';
const meta=JSON.parse(run(`select jsonb_build_object('stable',p.provolatile='s','sql',l.lanname='sql','definer',p.prosecdef,'boolean',p.prorettype='bool'::regtype,'args',p.pronargs,'config',p.proconfig) from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='${signature}'::regprocedure;`));
check(meta.stable&&meta.sql&&meta.definer&&meta.boolean&&meta.args===2&&meta.config.includes('search_path=""'),true,'read-only stable SQL boolean with fixed empty search path');
for(const role of ['authenticated','anon','service_role']){
 check(run(`select has_function_privilege('${role}','${signature}','execute');`),role==='authenticated'?'t':'f',`${role} exact ACL`);
 if(role!=='authenticated'){const denied=raw(`set test.actor='${actor}';set role ${role};select public.paige_chat_interactive_publication_context_v2('${good.thread}','${good.intent}');`);assert.notEqual(denied.status,0);assert.match(denied.stderr,/permission denied/);checks++;}
}
check(run(`select not exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='${signature}'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE');`),'t','PUBLIC cannot execute');
const snapshot=()=>run("select md5(jsonb_build_array((select jsonb_agg(t order by id) from paige_chat_threads t),(select jsonb_agg(t order by id) from paige_chat_turns t),(select jsonb_agg(p order by user_id) from profiles p),(select jsonb_agg(m order by tenant_id,user_id) from tenant_members m))::text);");
const before=snapshot();
for(const [thread,intent,who]of [[good.thread,good.intent,foreign],[id(999),good.intent,actor],[good.thread,id(998),actor],[good.thread,null,actor],[null,good.intent,actor],[good.thread,good.intent,null]])check(call(thread,intent,who),'f','foreign/missing/null identity returns only false');
check(snapshot(),before,'publication reads do not change protected/application rows');
run(`update public.profiles set active_tenant_id='${other}'where user_id='${actor}';`);
check(call(good.thread,good.intent),'f','workspace switch refuses despite membership in both');
const otherTerminal=prepare(actor,other);check(call(otherTerminal.thread,otherTerminal.intent),'t','second ordinary SOLO workspace uses the same native publication contract');
run(`update public.profiles set active_tenant_id=null where user_id='${actor}';`);
check(run(`${auth()}select public.current_user_tenant_id();`),tenant,'incumbent first-membership fallback still exists');
check(call(good.thread,good.intent),'f','publication does not adopt first-membership fallback');
run(`update public.profiles set active_tenant_id='${tenant}'where user_id='${actor}';update public.tenant_members set status='removed'where user_id='${actor}'and tenant_id='${tenant}';`);
check(call(good.thread,good.intent),'f','revoked active membership');
run(`update public.tenant_members set status='active'where user_id='${actor}'and tenant_id='${tenant}';`);
run(`delete from public.profiles where user_id='${actor}';`);check(call(good.thread,good.intent),'f','ordinary publication needs an explicit active profile');
run(`insert into public.profiles values('${actor}','${tenant}');`);
const missing=prepare(actor,tenant,{settle:false});
check(call(missing.thread,missing.intent),'f','held executor and no terminal');
run(`${auth()}select public.paige_chat_turn_append('${missing.thread}','assistant','JSON-only finish',null,null,null,null,null,'{"interactive":{"request_intent_id":"${missing.intent}"},"turn_state":{"state":"FINAL"}}',null);`);
check(call(missing.thread,missing.intent),'f','browser JSON cannot establish terminal authority');
const jsonThread=id(serial++),jsonIntent=id(serial++);
run(`insert into public.paige_chat_threads(id,caller_user_id,tenant_id)values('${jsonThread}','${actor}','${tenant}');${auth()}
 select public.paige_chat_interactive_begin_v2('${jsonThread}','${jsonIntent}',null,'Pending without executor',false,false,true);
 select public.paige_chat_turn_append('${jsonThread}','assistant','JSON-only finish',null,null,null,null,null,'{"interactive":{"request_intent_id":"${jsonIntent}"},"turn_state":{"state":"FINAL"}}',null);`);
check(call(jsonThread,jsonIntent),'f','JSON-only terminal also refuses when executor is NULL');
const held=prepare(actor,tenant,{release:false});check(call(held.thread,held.intent),'f','canonical terminal does not substitute for native release');
const stopped=prepare();run(`${auth()}select public.paige_chat_interactive_begin_v2('${stopped.thread}','${id(serial++)}','${stopped.intent}','',false,true,true);`);check(call(stopped.thread,stopped.intent),'f','native Stop tombstone/latest clearing');
const superseded=prepare();run(`${auth()}select public.paige_chat_interactive_begin_v2('${superseded.thread}','${id(serial++)}','${superseded.intent}','New instruction',false,false,true);`);check(call(superseded.thread,superseded.intent),'f','new ordinary native request supersedes old terminal');
const memberTerminal=prepare(member);check(call(memberTerminal.thread,memberTerminal.intent,member),'t','common read preserves incumbent active member semantics');
const ownerTerminal=prepare(owner,null);check(call(ownerTerminal.thread,ownerTerminal.intent,owner),'t','tenantless platform owner with explicit NULL active profile');
run(`update public.profiles set active_tenant_id='${other}'where user_id='${owner}';`);check(call(ownerTerminal.thread,ownerTerminal.intent,owner),'t','incumbent tenantless owner remains allowed after entering a workspace');
run(`delete from public.profiles where user_id='${owner}';`);check(call(ownerTerminal.thread,ownerTerminal.intent,owner),'t','incumbent tenantless owner does not acquire a new profile requirement');
run(`delete from public.user_roles where user_id='${owner}';`);check(call(ownerTerminal.thread,ownerTerminal.intent,owner),'f','tenantless native owner authority revocation');
check(call(ownerTerminal.thread,ownerTerminal.intent,operator),'f','platform admin is not the platform owner or thread owner');
const operatorTerminal=prepare(operator,company);check(call(operatorTerminal.thread,operatorTerminal.intent,operator),'t','native operator standing in explicitly selected company workspace');
run(`update public.profiles set active_tenant_id='${tenant}'where user_id='${operator}';`);
const customerOperator=prepare(operator,tenant);check(call(customerOperator.thread,customerOperator.intent,operator),'t','preserve native admission for an operator who entered a customer workspace');
check(run(`${auth(operator)}select public.is_tenant_member('${tenant}');`),'f','publication does not grant the operator customer membership or native CRM execution');
const agencyActor=id(16),agency=id(17),child=id(18),teamActor=id(19);
run(`insert into public.tenants(id,parent_tenant_id,account_type)values('${agency}',null,'agency'),('${child}','${agency}','subaccount');
 insert into public.profiles values('${agencyActor}','${child}'),('${teamActor}','${child}');
 insert into public.tenant_members values('${agency}','${agencyActor}','active','owner',now());
 insert into public.agency_team_members values('${agency}','${teamActor}','active','agency_manager',null);`);
for(const who of [agencyActor,teamActor]){
 const managed=prepare(who,child);check(call(managed.thread,managed.intent,who),'t','incumbent authorized agency child standing without direct child seat');
 check(run(`${auth(who)}select public.is_tenant_member('${child}');`),'f','no new agency membership grant or stricter membership AND');
 if(who===teamActor){run(`update public.agency_team_members set status='removed'where user_id='${who}';`);check(call(managed.thread,managed.intent,who),'f','native agency standing revocation');}
}
for(const state of ['FINAL','WAIT_WORK','ASK_USER','LIMIT_REACHED','INTERRUPTED','WITHHELD','REFUSED']){
 const terminal=prepare(actor,tenant,{state});check(call(terminal.thread,terminal.intent),'t',`${state} establishes context only, never outcome or approval authority`);
}

// Two real connections reproduce the split-read gap; the replacement reads both
// bindings under one query snapshot. A snapshot is not a lease on future changes.
const raceThread=id(serial++),prior=id(serial++),target=id(serial++);
run(`insert into public.paige_chat_threads(id,caller_user_id,tenant_id)values('${raceThread}','${actor}','${tenant}');${auth()}select public.paige_chat_interactive_begin_v2('${raceThread}','${prior}',null,'Prior instruction',false,false,true);`);
const oldScope=run(`${auth()}select public.current_user_tenant_id()='${tenant}' and public.is_tenant_member('${tenant}');`);
const writer=`begin;${auth()}select public.paige_chat_interactive_begin_v2('${raceThread}','${target}','${prior}','New target',false,false,true);
 ${service}select public.paige_chat_interactive_executor_v2('${raceThread}','${actor}','${tenant}','${target}','acquire');
 select public.paige_chat_interactive_settle('${raceThread}','${actor}','${tenant}','${target}','Canonical target',null,null,'{"interactive":{"request_intent_id":"${target}"},"turn_state":{"state":"WAIT_APPROVAL"}}',null);
 select public.paige_chat_interactive_executor_v2('${raceThread}','${actor}','${tenant}','${target}','release');reset role;
 update public.profiles set active_tenant_id='${other}'where user_id='${actor}';commit;`;
const start=sql=>{const child=spawn(psql,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)))});child.stdin.write(sql);return {child,done,output:()=>out};};
const waitFor=async(predicate)=>{const deadline=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<deadline,'native race coordination timeout');await new Promise(resolve=>setTimeout(resolve,20));}};
const lockKey=65453001;
const holder=start(`begin;select pg_advisory_xact_lock(${lockKey});select 'PUBLICATION_HOLDER_READY';\n`);
await waitFor(()=>holder.output().includes('PUBLICATION_HOLDER_READY'));
let observer;
try{
 // The argument depends on the lock call: invoke the real gate only after the
 // concurrent commit, while retaining the calling SELECT's earlier snapshot.
 observer=start(`${auth()}set application_name='int336_publication_snapshot';select public.paige_chat_interactive_publication_context_v2('${raceThread}',('${target}'||pg_advisory_xact_lock(${lockKey})::text)::uuid);\n`);observer.child.stdin.end();
 await waitFor(()=>run("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='int336_publication_snapshot' and wait_event='advisory');")==='t');
 run(writer);holder.child.stdin.end('rollback;\n');await holder.done;
 check(await observer.done,'f','one snapshot cannot mix old workspace with new native terminal/latest');
 const latest=JSON.parse(run(`${service}select public.paige_chat_interactive_executor_v2('${raceThread}','${actor}','${tenant}','${target}','state');`));
 check(oldScope==='t'&&latest.latest===target&&latest.executor===null&&latest.terminal,true,'counterfactual split reads would wrongly accept');
 check(call(raceThread,target),'f','fresh snapshot observes switched workspace');
}finally{if(!holder.child.stdin.writableEnded)holder.child.stdin.end('rollback;\n');await holder.done;}
console.log(`PASS ${checks} native publication-context assertions: canonical/ACL/actor/workspace/member/platform/latest/Stop/release/JSON/read-only/replay and coordinated snapshot race; full hosted schema remains unverified`);
