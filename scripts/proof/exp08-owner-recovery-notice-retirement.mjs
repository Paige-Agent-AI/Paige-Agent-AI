// Actual original retirement lock primitive + unchanged archive UPDATE spans.
// Local ported fixture only; this does NOT execute/claim the full archive API.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
export async function verifyRecoveryNoticeRetirement(db,{lockDefinition,archiveSource,prepare,tenant,holder}){
 assert.equal(process.env.EXP08_DISPOSABLE,'1');assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST));
 assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);assert.match(tenant,/^[0-9a-f-]{36}$/);assert.match(holder,/^[0-9a-f-]{36}$/);
 const lines=archiveSource.replace(/\r\n/g,'\n').split('\n');
 const spans=[
  '  UPDATE public.tenants SET archived_at=now(),archive_operation_id=_operation_id,lifecycle_execution_paused=true WHERE id=ANY(ids);',
  "  UPDATE public.tenant_members SET status='archived' WHERE tenant_id=ANY(ids) AND status='active';",
  '  UPDATE public.profiles SET active_tenant_id=NULL WHERE active_tenant_id=ANY(ids);'
 ];
 for(const s of spans)assert.equal(lines.filter(l=>l===s).length,1,'Exact original archive span required');
 const bound=spans.map(s=>s.replace('=_operation_id',"='e8000000-0000-4000-8000-000000096499'::uuid").replace('ANY(ids)',`ANY(ARRAY['${tenant}']::uuid[])`));
 assert.ok(bound[0].includes("archive_operation_id='e8000000-0000-4000-8000-000000096499'::uuid"));
 db.run(`${lockDefinition};REVOKE ALL ON FUNCTION public.operator_lock_retirement_scope() FROM PUBLIC,anon,authenticated,service_role;
  ALTER TABLE public.tenants ADD COLUMN archive_operation_id uuid,ADD COLUMN lifecycle_execution_paused boolean DEFAULT false;`);
 const scalar=q=>db.run(q).split('\n').at(-1),cases=[];
 function session(input){
  const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='',ended=false;
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{ended=true;resolve({code,out,err});});});
  p.stdin.write(input+'\n');return {p,done,out:()=>out,err:()=>err,ended:()=>ended};
 }
 async function until(predicate,watched){const end=Date.now()+10000;while(!predicate()){assert.ok(!watched?.ended(),watched?.err()||'Original retirement session ended before expected observation');assert.ok(Date.now()<end,'Original retirement lock observation timed out');await new Promise(r=>setTimeout(r,30));}}
 for(const [index,readerFirst,profile]of [[0,false,true],[1,true,true],[2,false,false],[3,true,false]]){
  const request=`e8000000-0000-4000-8000-00000009640${index}`,notice=await prepare(request);
  db.role='';db.actor='';
  const read=profile?`SELECT set_config('test.actor','${holder}',false);SET ROLE authenticated;SELECT public.get_owner_recovery_notice('${tenant}','${notice}')`
   :`SELECT public._exp08_read_recovery_notice_for_recipient('${tenant}','${notice}','${holder}',false)`;
  const retire=`SELECT public.operator_lock_retirement_scope();${bound.join('\n')}`;
  const name='exp08_notice_retirement_'+Date.now();let first,second;
  try{
   first=session(readerFirst?`BEGIN;SET statement_timeout='15s';${read};SELECT 'first_lock_held';`
    :`BEGIN;SET statement_timeout='15s';SELECT public.operator_lock_retirement_scope();${bound[0]}SELECT 'first_lock_held';`);
   await until(()=>first.out().includes('first_lock_held'),first);
   second=session(`SET application_name='${name}';SET statement_timeout='15s';${readerFirst?retire:read};`);second.p.stdin.end();
   await until(()=>scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)==='t',second);
   first.p.stdin.end(readerFirst?'COMMIT;\n':bound.slice(1).join('\n')+'COMMIT;\n');
   const a=await first.done,b=await second.done;
   if(a.code!==0||b.code!==(readerFirst?0:3))console.log(JSON.stringify({phase:'original-retirement-span-notice-race',readerFirst,profile,firstCode:a.code,secondCode:b.code,firstError:a.err,secondError:b.err}));
   assert.equal(a.code,0,a.err);if(readerFirst)assert.equal(b.code,0,b.err);else{assert.notEqual(b.code,0);assert.match(b.err,/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);}
   assert.doesNotMatch(a.err+b.err,/deadlock detected|40P01|lock timeout|55P03/);
   assert.equal(scalar(`SELECT archived_at IS NOT NULL AND lifecycle_execution_paused FROM public.tenants WHERE id='${tenant}'`),'t');
   cases.push({case:'original retirement table gate/archive spans '+(readerFirst?'reader first':'retirement first')+' compose without deadlock with '+(profile?'customer notice':'private native-recipient read'),passed:true});
  }finally{
   if(first){if(!first.p.stdin.destroyed)first.p.stdin.end('ROLLBACK;\n');await first.done;}
   if(second){if(!second.p.stdin.destroyed)second.p.stdin.end();await second.done;}
   db.role='';db.actor='';
  }
 }
 return cases;
}
