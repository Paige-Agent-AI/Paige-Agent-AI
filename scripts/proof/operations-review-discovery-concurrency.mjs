// Real two-session source changes in a disposable loopback database only.
// The fixture barrier wraps the existing reader temporarily, then restores its
// exact body and ACL. No production/client credentials or remote URLs accepted.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { retireSyntheticTenantSQL } from './operator-postgres-fixture.mjs';
const url=new URL(process.env.OPERATIONS_DISCOVERY_TEST_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.ok(url.hostname==='127.0.0.1'&&url.pathname==='/postgres'&&
 ((process.env.CI==='true'&&url.port==='54322')||(process.env.OPERATIONS_DISCOVERY_LOCAL_FIXTURE==='isolated'&&url.port==='54380')),
 'Only disposable loopback CI or explicitly isolated local fixture allowed');
const psql=process.env.PSQL_BIN||'psql', args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',url.toString()];
const run=sql=>execFileSync(psql,args,{input:sql,encoding:'utf8',windowsHide:true,timeout:20000}).trim();
const fixture=readFileSync(new URL('../../supabase/tests/operations_delivery_review_discovery.sql',import.meta.url),'utf8');
const boundary=fixture.indexOf('create temporary table artifact_context');assert.ok(boundary>0);
const lock=830000000+process.pid, processes=new Set();let wrapped=false, active=null;
const original=run("select md5(prosrc)||':'||proacl::text from pg_proc where oid='public.operations_delivery_artifact_scoped(uuid,uuid,uuid)'::regprocedure");
const spawnSession=()=>{const child=spawn(psql,args,{windowsHide:true});processes.add(child);return child;};
const closeResult=child=>new Promise((resolve,reject)=>{
 let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 const timer=setTimeout(()=>child.kill('SIGKILL'),18000);
 child.on('error',reject);child.on('close',code=>{clearTimeout(timer);processes.delete(child);code===0?resolve(out):reject(new Error(err||`fixture process ${code}`));});
});
async function barrier(){
 const child=spawnSession(),done=closeResult(child);
 let output='';const ready=new Promise((resolve,reject)=>{
  child.stdout.on('data',d=>{output+=d;if(output.includes('fixture_barrier_ready'))resolve();});
  child.on('error',reject);child.on('close',()=>{if(!output.includes('fixture_barrier_ready'))reject(new Error('Barrier not acquired'));});
 });
 child.stdin.write(`begin;select pg_advisory_xact_lock(${lock});select 'fixture_barrier_ready';\n`);
 await ready;return{release:async()=>{child.stdin.end('commit;\n');await done;}};
}
async function waitForReader(name){
 for(let n=0;n<50;n++){
  if(run(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock' and wait_event='advisory'`)==='1')return;
  await new Promise(resolve=>setTimeout(resolve,80));
 }throw new Error('Actual delegated-reader barrier wait not observed');
}
function seed(){
 let sql=fixture.slice(0,boundary).replace(/^begin;\s*$/m,'');
 sql=sql.replaceAll("('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid",
  `(case n ${[1,2,3,4,5].map(n=>`when ${n} then 'ef240000-0000-4000-8000-00000000000${n}'::uuid`).join(' ')} end)`);
 const ids=new Map([...sql.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g)].map(m=>[m[0],randomUUID()]));
 const id=key=>{assert.ok(ids.has(key));return ids.get(key);},suffix=randomUUID().slice(0,8);
 sql=sql.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,id)
  .replaceAll('@tests.invalid',`-${suffix}@tests.invalid`).replaceAll('test-ops-review-recovery',`test-ops-review-${suffix}`);
 const tenant=id('ef240000-0000-4000-8000-000000001111'),work=id('ef240000-0000-4000-8000-00000000b001');
 const users=[1,2,3,4,5].map(n=>id(`ef240000-0000-4000-8000-00000000000${n}`));
 // Reviewer also has legitimate general item access. Losing nomination alone
 // therefore does not guarantee the delegated reader will refuse the source.
 run(`begin;${sql} reset role;insert into public.user_roles(user_id,role) values('${users[1]}','admin') on conflict(user_id,role) do nothing;commit;`);
 active={tenant,work,users,suffix,session:id('ef240000-0000-4000-8000-00000000d001'),lineage:id('ef240000-0000-4000-8000-00000000f001')};
 return active;
}
function cleanup(){if(!active)return;const{tenant,users}=active;
 run(`begin;set local lock_timeout='5s';set local statement_timeout='15s';
 delete from public.operations_delivery_submissions where tenant_id='${tenant}';
 delete from public.studio_artifact_versions where tenant_id='${tenant}';delete from public.studio_sessions where tenant_id='${tenant}';
 delete from public.plan_items where tenant_id='${tenant}';delete from public.plans where tenant_id='${tenant}';delete from public.clients where tenant_id='${tenant}';
 delete from public.audit_logs where user_id in(${users.map(u=>`'${u}'`).join(',')});
 delete from public.tenant_members where tenant_id='${tenant}';delete from public.profiles where user_id in(${users.map(u=>`'${u}'`).join(',')});
 ${retireSyntheticTenantSQL(tenant)}delete from public.user_roles where user_id in(${users.map(u=>`'${u}'`).join(',')});
 delete from auth.users where id in(${users.map(u=>`'${u}'`).join(',')});commit;`);
 assert.equal(run(`select count(*) from public.tenants where id='${tenant}'`),'0');active=null;
}
try{
 assert.equal(run("select to_regprocedure('public.operations_delivery_artifact_fixture_original(uuid,uuid,uuid)') is null"),'t');
 run(`begin;alter function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) rename to operations_delivery_artifact_fixture_original;
 create function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) returns jsonb language plpgsql security definer set search_path='' as $barrier$
 begin perform pg_advisory_xact_lock(${lock});return public.operations_delivery_artifact_fixture_original($1,$2,$3);end $barrier$;
 revoke all on function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) from public,anon,authenticated;
 grant execute on function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) to authenticated;commit;`);wrapped=true;
 for(const change of ['reassigned','reviewed','superseded']){
  const s=seed(),submission=JSON.parse(run(`select json_build_object('id',id,'updated_at',updated_at) from public.operations_delivery_submissions where tenant_id='${s.tenant}'`));
  const gate=await barrier(),reader=spawnSession(),result=closeResult(reader),name=`ops-discovery-${s.suffix}`;
  reader.stdin.end(`begin;set local statement_timeout='15s';set local application_name='${name}';set local role authenticated;
   select set_config('request.jwt.claim.sub','${s.users[1]}',true);
   select public.operations_delivery_reviews_scoped('${s.users[1]}','${s.tenant}',40);commit;`);
  await waitForReader(name);
  if(change==='reassigned')run(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${s.users[0]}',true);
   select public.operations_delivery_reassign_reviewer_scoped('${submission.id}','${s.users[0]}','${s.tenant}','${submission.updated_at}','${s.users[3]}','Documented fixture reassignment');commit;`);
  else{
   run(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${s.users[1]}',true);
    select public.operations_delivery_review_scoped('${submission.id}','${s.users[1]}','${s.tenant}','${submission.updated_at}',
     '${change==='reviewed'?'approved':'revision_requested'}',${change==='reviewed'?'null':"'Revise the outcome'"});commit;`);
   if(change==='superseded'){
    const version=randomUUID(),workUpdated=run(`select updated_at from public.plan_items where id='${s.work}'`);run(`begin;insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by)
     values('${version}','${s.tenant}','${s.session}','content','${s.lineage}',2,'{"kind":"text","title":"Revised work","body":"New source outcome"}','${s.users[0]}');
     set local role authenticated;select set_config('request.jwt.claim.sub','${s.users[0]}',true);
     select public.operations_delivery_submit_scoped('${s.work}','${version}','${s.users[1]}','${s.users[0]}','${s.tenant}',
      '${workUpdated}',1);commit;`);
   }
  }
  await gate.release();const output=await result,reply=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.deepEqual(reply.reviews,[],`${change} cannot remain a pending nomination`);assert.equal(reply.unavailable_count,1);
  console.log(`PASS: real concurrent ${change} source change observed after nomination cursor; stale discovery withheld`);cleanup();
 }
}finally{
 for(const child of processes)child.kill('SIGKILL');
 if(wrapped)run(`begin;drop function public.operations_delivery_artifact_scoped(uuid,uuid,uuid);alter function public.operations_delivery_artifact_fixture_original(uuid,uuid,uuid) rename to operations_delivery_artifact_scoped;commit;`);
 assert.equal(run("select md5(prosrc)||':'||proacl::text from pg_proc where oid='public.operations_delivery_artifact_scoped(uuid,uuid,uuid)'::regprocedure"),original,'Original exact reader body and ACL restored');
 cleanup();
}
