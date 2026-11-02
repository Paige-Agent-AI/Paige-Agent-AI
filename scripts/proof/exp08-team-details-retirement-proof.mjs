// Original archive and Team writers in disposable PostgreSQL; Auth remains a fixture.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
assert.equal(process.env.EXP08_DISPOSABLE,'1');
assert(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
const port=Number(process.env.PGPORT),ci=process.env.CI==='true';
assert(Number.isSafeInteger(port)&&port>1023&&(ci||port!==5432));
const psql=process.env.OPERATOR_PROOF_PSQL??process.env.PSQL??'psql';
const args=database=>['-X','-q','-A','-t','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'];
function sql(text,database='postgres'){
 const r=spawnSync(psql,args(database),{input:text,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
if(!ci)assert.equal(resolve(sql("SELECT current_setting('data_directory')")),resolve(fileURLToPath(new URL('../../../pg-exp08/native-literal-data',import.meta.url))),'Only this task-owned disposable cluster may be used');
const fixtureArg=process.argv.find(a=>a.startsWith('--fixture='));
assert(process.argv.slice(2).every(a=>a===fixtureArg),'Only an explicitly owned fixture may be selected');
let database=fixtureArg?.slice('--fixture='.length),db;
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
function original(source,name){
 const start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);assert(start>=0,name);
 const body=/\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(source.slice(start));assert(body,name);
 const opening=start+body.index+body[0].length,close=source.indexOf(body[1],opening);assert(close>opening,name);
 return source.slice(start,close+body[1].length)+';';
}
const tenant='e8a00000-0000-4000-8000-000000000010',seat='e8a00000-0000-4000-8000-000000000102';
const actor='00000000-0000-0000-0000-000000000002',operator='00000000-0000-0000-0000-000000000001',target='e8a00000-0000-4000-8000-000000000002';
const catalogue=JSON.parse(read('./exp08-team-details-native-catalog.json'));
const signatures=['set_solo_team_member_work_profile(uuid,text,text)','set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)','set_solo_team_member_permission(uuid,text)','set_solo_team_member_permission(uuid,text,uuid,uuid)'];
let sequence=0,archivedOperation;
const connections=new Set();
function connection(label,who,statement,{hold=false,role=''}={}){
 const application=`exp08_retirement_${process.pid}_${++sequence}_${label}`;
 const child=spawn(psql,args(database),{env:{...process.env,PGAPPNAME:application},stdio:['pipe','pipe','pipe'],windowsHide:true});
 let out='',err='',readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
 child.stdout.on('data',d=>{out+=d;if(out.includes('exp08_retirement_ready'))readyResolve();});
 child.stderr.on('data',d=>{err+=d;});
 const done=new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('close',code=>{connections.delete(child);if(!out.includes('exp08_retirement_ready'))readyReject(new Error(err||'Native operation ended before its barrier'));resolve({code,out,err});});
 });
 connections.add(child);
 const prefix=`\\set VERBOSITY verbose\nBEGIN;SET statement_timeout='20s';SET lock_timeout='15s';SET deadlock_timeout='100ms';SELECT set_config('test.actor','${who}',false);SELECT set_config('request.jwt.claim.sub','${who}',false);SELECT set_config('request.jwt.claim.role','authenticated',false);${role?`SET ROLE ${role};`:''}`;
 const text=prefix+statement+";SELECT 'exp08_retirement_ready';";
 if(hold)child.stdin.write(text+'\n');else child.stdin.end(text+'COMMIT;\n');
 return {application,ready,done,release:()=>child.stdin.end('COMMIT;\n')};
}
async function waiting(connection){
 for(let i=0;i<80;i++){
  if(db.run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${connection.application}' AND wait_event_type='Lock')`).split('\n').at(-1)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.fail('The original native operation did not actually wait on a database lock');
}
function memberRowLock(connection){return db.run(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.application_name='${connection.application}' AND l.relation='public.tenant_members'::regclass AND l.mode='RowShareLock' AND l.granted)`).split('\n').at(-1)==='t';}
const scalar=q=>db.run(q).split('\n').at(-1);
function reset(){
 db.actor=operator;db.role='';
 if(scalar(`SELECT archived_at IS NOT NULL FROM public.tenants WHERE id='${tenant}'`)==='t'){
  assert(archivedOperation);db.run(`SELECT public.operator_restore_archived_account('${tenant}','${archivedOperation}')`);
 }
 archivedOperation=null;
 db.run(`UPDATE public.profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';UPDATE public.tenant_members SET status='active',role=CASE WHEN user_id='${actor}' THEN 'owner'::public.tenant_role ELSE 'member'::public.tenant_role END,job_title=NULL,responsibilities=NULL WHERE tenant_id='${tenant}';DELETE FROM public.audit_logs WHERE user_id='${actor}' OR entity_id='${tenant}';`);
}
const audits=()=>Number(scalar(`SELECT count(*) FROM public.audit_logs WHERE user_id='${actor}'`));
function call(kind){return kind==='profile'?`SELECT public.set_solo_team_member_work_profile('${target}','Retirement proof','Synthetic current work','${tenant}','${seat}')`:`SELECT public.set_solo_team_member_permission('${target}','admin','${tenant}','${seat}')`;}
function archive(operation){
 db.actor=operator;db.role='';const preview=JSON.parse(scalar(`SELECT public.operator_preview_account_archive('${tenant}')`));
 assert.equal(preview.execution_available,true,JSON.stringify(preview.blockers));
 return `SELECT public.operator_archive_account('${tenant}','${preview.version}','Synthetic Team retirement','${operation}')`;
}
async function archiveFirst(kind,repaired){
 reset();const operation=randomUUID(),barrier=connection('barrier',operator,'SELECT pg_advisory_xact_lock(80802802)',{hold:true});await barrier.ready;
 const retire=connection('archive',operator,archive(operation));await waiting(retire);
 const write=connection(kind,actor,call(kind),{role:'authenticated'});await waiting(write);
 assert.equal(memberRowLock(write),!repaired,'The repaired writer must wait before taking any membership row lock');
 barrier.release();assert.equal((await barrier.done).code,0);
 const results=await Promise.all([retire.done,write.done]);
 if(!repaired){
  assert(results.some(r=>r.code!==0&&/40P01/.test(r.err)),JSON.stringify(results));
  console.log(JSON.stringify({case:'archive first',kind,repaired:false,actualDeadlockReproduced:true}));
 }else{
  assert.equal(results[0].code,0,results[0].err);assert.equal(results[1].code,3,results[1].err);
  assert.match(results[1].err,/42501/);assert(!results.some(r=>/40P01|55P03|57014/.test(r.err)));
  assert.equal(audits(),0);assert.equal(scalar(`SELECT status FROM public.tenant_members WHERE id='${seat}'`),'archived');
  console.log(JSON.stringify({case:'archive first',kind,repaired:true,actualGateWait:true,staleWriterRefused:true,teamAudits:0}));
 }
 if(scalar(`SELECT archived_at IS NOT NULL FROM public.tenants WHERE id='${tenant}'`)==='t')archivedOperation=operation;
}
async function writerFirst(kind){
 reset();const operation=randomUUID(),write=connection(kind,actor,call(kind),{hold:true,role:'authenticated'});await write.ready;
 const retire=connection('archive',operator,archive(operation));await waiting(retire);
 write.release();assert.equal((await write.done).code,0);
 const result=await retire.done;
 if(result.code!==0){assert.match(result.err,/40001/);const reconciled=connection('archive_reconciled',operator,archive(operation));const settled=await reconciled.done;assert.equal(settled.code,0,settled.err);}
 assert(!/40P01|55P03|57014/.test(result.err));archivedOperation=operation;assert.equal(audits(),1);
 db.actor=operator;db.run(`SELECT public.operator_archive_account('${tenant}','unused-on-replay','Synthetic Team retirement','${operation}')`);
 assert.equal(Number(scalar(`SELECT count(*) FROM public.audit_logs WHERE action='tenant.archive' AND entity_id='${tenant}'`)),1);
 const stale=connection('stale_repeat',actor,call(kind),{role:'authenticated'});const refused=await stale.done;
 assert.equal(refused.code,3,refused.err);assert.match(refused.err,/42501/);assert.equal(audits(),1);
 console.log(JSON.stringify({case:'writer first',kind,repaired:true,actualArchiveGateWait:true,teamAudits:1,archiveAudits:1,staleRepeatHasNoEffect:true}));
}
try{
 if(!database){
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./operator-account-archive.mjs',import.meta.url)),'--postgres',String(port)],{env:{...process.env,OPERATOR_PROOF_PSQL:psql},encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
  assert.ifError(child.error);
  const names=sql(`SELECT datname FROM pg_database WHERE datname LIKE 'operator_account_lifecycle_proof_${child.pid}_%'`).split('\n').filter(Boolean);
  assert.equal(names.length,1,'Only the database created by the original archive fixture may be selected');database=names[0];
  assert.equal(child.status,0,child.stderr||child.stdout);
 }
 assert.match(database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 db=Object.assign(Object.create(OperatorPostgresFixture.prototype),{database,port,psql,actor:operator,role:''});
 assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.operator_archive_account(uuid,text,text,uuid)'::regprocedure"),'e4579d93e54646f4ff8b8b997046b85d','Use the actual current original archive body');
 assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.operator_lock_retirement_scope()'::regprocedure"),'b47322af22aaba58ebe989a3d2d6c878','Use the actual current original retirement gate');
 db.run(`INSERT INTO public.user_roles(user_id,role) VALUES('${operator}','super_admin');CREATE TYPE public.tenant_role AS ENUM('owner','admin','member','client');ALTER TABLE public.tenant_members ALTER COLUMN role TYPE public.tenant_role USING role::public.tenant_role;ALTER TABLE public.tenant_members ADD COLUMN is_owner boolean DEFAULT false,ADD COLUMN job_title text,ADD COLUMN responsibilities text,ADD COLUMN updated_at timestamptz DEFAULT now();UPDATE public.tenant_members SET is_owner=(role='owner');ALTER TABLE public.profiles ADD COLUMN user_id uuid UNIQUE;UPDATE public.profiles SET user_id=id;ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz;
 CREATE OR REPLACE FUNCTION public.is_platform_admin(_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user AND role IN ('super_admin','platform_admin'))$$;
 CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT public.is_platform_admin()$$;
 CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES('${target}','team-retirement@tests.invalid','{}');
 INSERT INTO public.tenants(id,name,status,account_type,owner_user_id) VALUES('${tenant}','Synthetic Team retirement','active','standalone','${actor}');
 INSERT INTO public.profiles(id,user_id,active_tenant_id) VALUES('${actor}','${actor}','${tenant}') ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,active_tenant_id=EXCLUDED.active_tenant_id;
 INSERT INTO public.tenant_members(id,tenant_id,user_id,role,status,is_owner) VALUES('e8a00000-0000-4000-8000-000000000101','${tenant}','${actor}','owner','active',true),('${seat}','${tenant}','${target}','member','active',false);
 GRANT USAGE ON SCHEMA public,auth TO authenticated;
 CREATE FUNCTION public.exp08_proof_archive_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id='${tenant}' AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN PERFORM set_config('lock_timeout','12s',true);PERFORM pg_advisory_xact_lock(80802802);END IF;RETURN NEW;END$$;
 CREATE TRIGGER exp08_proof_archive_pause AFTER UPDATE OF archived_at ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.exp08_proof_archive_pause();`);
 const authority=read('../../supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql');
 for(const name of ['is_company_workspace','is_tenant_admin','is_tenant_owner'])db.run(original(authority,name));
 db.run(original(read('../../supabase/migrations/20271116020008_exp08_co_owner_authority.sql'),'is_tenant_account_holder'));
 for(const row of catalogue.reviewed.filter(r=>signatures.includes(r.signature))){db.run(row.definition+`;REVOKE ALL ON FUNCTION public.${row.signature} FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.${row.signature} TO authenticated;`);}
 for(const kind of ['profile','permission'])await archiveFirst(kind,false);
 reset();
 for(const signature of signatures.filter(s=>s.split(',').length>3))db.run(`DROP FUNCTION public.${signature}`);
 for(const row of catalogue.before.filter(r=>signatures.includes(r.signature)))db.run(row.definition);
 db.run(read('./exp08-owner-work-profile-patch.sql'));db.run(read('./exp08-team-permission-patch.sql'));
 for(const kind of ['profile','permission']){
  reset();for(let i=0;i<2;i++){const c=connection('same_result',actor,call(kind),{role:'authenticated'});const r=await c.done;assert.equal(r.code,0,r.err);}assert.equal(audits(),1,'Repeated verified current state must not add an audit');
  await archiveFirst(kind,true);await writerFirst(kind);
 }
 console.log('PASS: original production-pinned archive/gate versus both original scoped writers, causal old deadlocks, both repaired orders, actual lock waits, refusal and no-duplicate audits. Disposable fixture only; production Auth/customer acceptance UNVERIFIED.');
}finally{
 for(const child of connections){if(child.exitCode===null)child.stdin.end('ROLLBACK;\n');}
 if(database&&/^operator_account_lifecycle_proof_\d+_\d+$/.test(database)){sql(`DROP DATABASE ${database} WITH (FORCE)`);console.log('Disposed only original archive fixture '+database);}
}
