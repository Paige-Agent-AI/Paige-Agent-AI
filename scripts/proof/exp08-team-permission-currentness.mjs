import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Owning child of the ORIGINAL entity-owner release proof. Synthetic dependencies only.
assert.equal(process.env.EXP08_DISPOSABLE,'1','Explicit disposable proof opt-in required');
const host=process.env.PGHOST;
assert.ok(['127.0.0.1','localhost','::1'].includes(host),'Loopback database only');
assert.match(process.env.PGPORT??'',/^\d+$/,'Explicit local port required');
assert.ok(process.argv.slice(2).every(x=>['--baseline','--candidate'].includes(x))&&process.argv.length<=3,'Select one original permission proof phase');
if(process.argv.length===2){
 for(const phase of ['--baseline','--candidate']){
  const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),phase],{env:process.env,stdio:'inherit',windowsHide:true,timeout:150000});
  assert.ifError(child.error);assert.equal(child.status,0,`Original permission ${phase} must pass`);
 }
 console.log('Original permission baseline/candidate/authority/drift/wait controls PASS; NOT native/customer proof.');
 process.exit(0);
}
const repaired=process.argv.includes('--candidate');
const root=fileURLToPath(new URL('../../',import.meta.url)),psql=process.env.PSQL||'psql';
const db=`exp08_permission_probe_${Date.now()}`;
const args=d=>['-X','-q','-A','-t','-h',host,'-p',process.env.PGPORT,'-U',process.env.PGUSER||'postgres','-d',d,'-v','ON_ERROR_STOP=1'];
function sql(q,d=db){const r=spawnSync(psql,args(d),{input:q,encoding:'utf8',timeout:30000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function original(source,name){const a=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);const b=source.indexOf('$function$;',a);assert.ok(a>=0&&b>a);return source.slice(a,b+11);}
const actor='e8000000-0000-4000-8000-000000060300',target='e8000000-0000-4000-8000-000000060200',tenant='e8000000-0000-4000-8000-000000060010',other='e8000000-0000-4000-8000-000000060020';
let created=false;
try{
 sql(`CREATE DATABASE ${db};`,'postgres');created=true;
 sql(readFileSync(root+'/supabase/tests/exp08_entity_owner_seat_ended.sql','utf8'));
 sql(`ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz; CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid); CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
 GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
 sql(original(readFileSync(root+'/supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql','utf8'),'is_tenant_owner'));
 sql(original(readFileSync(root+'/supabase/migrations/20260901001520_solo_team_workspace.sql','utf8'),'set_solo_team_member_permission'));
 sql('REVOKE ALL ON FUNCTION public.set_solo_team_member_permission(uuid,text) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text) TO authenticated;');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure"),'aab67c9a70880f160de550e4361a6142');
 if(repaired){const metadata=sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure");const patch=readFileSync(new URL('./exp08-team-permission-patch.sql',import.meta.url),'utf8');sql(patch);sql(patch);assert.equal(sql("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure"),metadata);}

 if(repaired){
  const setup=()=>sql(`SELECT proof.reset_rows();TRUNCATE public.profiles,public.audit_logs;
   INSERT INTO public.profiles VALUES('${actor}','${tenant}');
   INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES('e8000000-0000-4000-8000-000000061003','${tenant}','${actor}',true,'owner','active'),('e8000000-0000-4000-8000-000000061004','${tenant}','${target}',false,'member','active');`);
  for(const [name,change,value,needle] of [
   ['owner promotes member','',' AdMiN ',null],
   ['owner demotes admin',`UPDATE public.tenant_members SET role='admin' WHERE tenant_id='${tenant}' AND user_id='${target}';`,'member',null],
   ['Admin is not owner',`UPDATE public.tenant_members SET role='admin',is_owner=false WHERE user_id='${actor}';`,'admin','only the tenant owner'],
   ['Member is not owner',`UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='${actor}';`,'admin','only the tenant owner'],
   ['paused actor',`UPDATE public.tenant_members SET status='suspended' WHERE user_id='${actor}';`,'admin','only the tenant owner'],
   ['banned actor',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${actor}';`,'admin','TEAM_MEMBER_IDENTITY_UNAVAILABLE'],
   ['deleted actor',`UPDATE auth.users SET deleted_at=now() WHERE id='${actor}';`,'admin','TEAM_MEMBER_IDENTITY_UNAVAILABLE'],
   ['owner target',`UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE tenant_id='${tenant}' AND user_id='${target}';`,'admin','the owner permission cannot be changed here'],
   ['role-only owner target',`UPDATE public.tenant_members SET role='owner' WHERE tenant_id='${tenant}' AND user_id='${target}';`,'admin','the owner permission cannot be changed here'],
   ['suspended target retained',`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${tenant}' AND user_id='${target}';`,'admin',null],
   ['archived target retained',`UPDATE public.tenant_members SET status='archived' WHERE tenant_id='${tenant}' AND user_id='${target}';`,'admin',null],
   ['invalid owner input','','owner','permission must be Admin or Member'],
   ['missing target',`DELETE FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${target}';`,'admin','team member not found in this workspace'],
   ['foreign target only',`DELETE FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${target}';`,'member','team member not found in this workspace'],
  ]){
   setup();if(change)sql(change);
   const result=spawnSync(psql,args(db),{input:`SELECT set_config('request.jwt.claim.sub','${actor}',false);SET ROLE authenticated;SELECT public.set_solo_team_member_permission('${target}','${value}');`,encoding:'utf8',timeout:30000});
   assert.ifError(result.error);assert.equal(result.status,needle?3:0,result.stderr);if(needle)assert.ok(result.stderr.includes(needle),result.stderr);
   assert.equal(sql('SELECT count(*) FROM public.audit_logs;'),needle?'0':'1');
   if(!needle)assert.equal(sql(`SELECT role FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${target}';`),value.trim().toLowerCase());
   console.log(JSON.stringify({phase:'permission-authority-matrix',name,refused:Boolean(needle),original_audits:needle?0:1}));
  }
  const patch=readFileSync(new URL('./exp08-team-permission-patch.sql',import.meta.url),'utf8');
  const metadata=()=>sql("SELECT to_jsonb(p)::text FROM pg_proc p WHERE oid='public.set_solo_team_member_permission(uuid,text)'::regprocedure");
  const saved=metadata();const definition=sql("SELECT pg_get_functiondef('public.set_solo_team_member_permission(uuid,text)'::regprocedure)");
  for(const [name,change] of [
   ['source',definition.replace('DECLARE','DECLARE\n-- unreviewed source\n')],
   ['anonymous grant','GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text) TO anon;'],
   ['service grant','GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text) TO service_role;'],
   ['grant option','GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text) TO authenticated WITH GRANT OPTION;'],
   ['path','ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) SET search_path=public;'],
   ['security','ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) SECURITY INVOKER;'],
   ['strictness','ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) STRICT;'],
  ]){
   const result=spawnSync(psql,args(db),{input:`BEGIN;${change};${patch}`,encoding:'utf8',timeout:30000});assert.ifError(result.error);assert.equal(result.status,3,result.stderr);assert.match(result.stderr,/EXP08 permission original (source|metadata) drift/);assert.equal(metadata(),saved);
   console.log(JSON.stringify({phase:'permission-source-drift',name,refused:true,original_full_metadata_restored:true}));
  }
 }
 for(const name of ['owner revoked','workspace changed','actor suspended','permitted wait']){
  sql(`SELECT proof.reset_rows();TRUNCATE public.profiles,public.audit_logs;
 INSERT INTO public.profiles VALUES('${actor}','${tenant}');
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role,status) VALUES('e8000000-0000-4000-8000-000000061003','${tenant}','${actor}',true,'owner','active'),('e8000000-0000-4000-8000-000000061004','${tenant}','${target}',false,'member','active');`);
  const first=spawn(psql,args(db),{windowsHide:true,stdio:['pipe','pipe','pipe']});let firstErr='',out='';first.stderr.on('data',x=>firstErr+=x);
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});let second,secondDone,secondErr='';
  let timer;try{
   const ready=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('own target lock not observed')),10000);first.stdout.on('data',x=>{out+=x;if(out.includes('PERMISSION_LOCKED'))resolve();});});
   first.stdin.write(`SET statement_timeout='15s';BEGIN;SELECT 1 FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${target}' FOR UPDATE;\n\\echo PERMISSION_LOCKED\n`.replaceAll('\\n','\n').replaceAll('\\\\echo','\\echo'));
   await ready;clearTimeout(timer);
   const app=`exp08_permission_${name.replaceAll(' ','_')}`;
   second=spawn(psql,args(db),{windowsHide:true,env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});second.stdout.resume();second.stderr.on('data',x=>secondErr+=x);secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
   second.stdin.end(`SET statement_timeout='15s';SET lock_timeout='10s';SELECT set_config('request.jwt.claim.sub','${actor}',false);SET ROLE authenticated;SELECT public.set_solo_team_member_permission('${target}','admin');`);
   let waited=false;for(let i=0;i<80;i++){waited=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='${db}' AND application_name='${app}' AND wait_event_type='Lock');`)==='t';if(waited)break;await new Promise(r=>setTimeout(r,50));}assert.ok(waited,'actual database lock wait required');
   const change=name==='owner revoked'?`UPDATE public.tenant_members SET is_owner=false,role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`:name==='workspace changed'?`UPDATE public.profiles SET active_tenant_id='${other}' WHERE user_id='${actor}';`:name==='actor suspended'?`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${tenant}' AND user_id='${actor}';`:'';
   first.stdin.end(`${change}COMMIT;\n`);assert.equal(await firstDone,0,firstErr);const allowed=!repaired||name==='permitted wait';assert.equal(await secondDone,allowed?0:3,secondErr);if(!allowed)assert.match(secondErr,name==='workspace changed'?/active workspace changed/:/only the tenant owner/);
   const state=JSON.parse(sql(`SELECT json_build_object('target_role',(SELECT role FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${target}'),'audits',(SELECT count(*) FROM public.audit_logs),'actor_owner',public.is_tenant_owner('${actor}','${tenant}'),'actor_workspace',(SELECT active_tenant_id FROM public.profiles WHERE user_id='${actor}'));`));
   assert.equal(state.target_role,allowed?'admin':'member');assert.equal(state.audits,allowed?1:0);
   console.log(JSON.stringify({case:name,repaired,original_body_md5:'aab67c9a70880f160de550e4361a6142',actual_lock_wait:waited,state,classification:name==='permitted wait'?'legitimate control':repaired?'guarded original writer refused without effect':'modeled original writer stale-currentness effect reproduced'}));
  }finally{clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n');if(second&&second.exitCode===null)second.kill();await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);}
 }
}finally{if(created)sql(`DROP DATABASE ${db};`,'postgres');}
