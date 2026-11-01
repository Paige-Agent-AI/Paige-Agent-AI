// Actual original recovery fixture/native audience, with ported Auth/tables. No customer proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
export async function verifyRecoveryNoticeReadState(db,{reset,tenant,actor,holder,remaining,reason}){
 assert.equal(process.env.EXP08_DISPOSABLE,'1');assert.match(db.database,/^operator_account_lifecycle_proof_\d+_\d+$/);
 const cases=[],patch=readFileSync(new URL('./exp08-owner-recovery-notice-state.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const scalar=q=>db.run(q).split('\n').at(-1),signature='public.set_my_owner_recovery_notice_read(uuid,boolean)';
 const mark=(id,value)=>`SELECT public.set_my_owner_recovery_notice_read('${id}',${value})`;
 const metadata=()=>scalar(`SELECT to_jsonb(p) FROM pg_proc p WHERE oid='${signature}'::regprocedure`);
 let sequence=0;
 function prepare(zeroSeat=false){
  reset();db.role='';db.actor=actor;
  if(zeroSeat){
   const seed='e8000000-0000-4000-8000-'+String(980000+(++sequence)).padStart(12,'0');
   db.role='authenticated';db.run(`SELECT public.platform_owner_recovery('${tenant}','set_account_holder','${holder}','${reason}','${seed}')`);db.role='';
   // Port an already-lost seat; never disable the original protected pointer writer.
   db.run(`DELETE FROM public.tenant_members WHERE tenant_id='${tenant}' AND user_id='${holder}';UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id='${holder}';`);
  }
  const audit='e8000000-0000-4000-8000-'+String(980000+(++sequence)).padStart(12,'0');
  db.role='authenticated';
  const result=JSON.parse(scalar(`SELECT public.platform_owner_recovery('${tenant}','set_account_holder','${remaining}','${reason}','${audit}')`));
  db.role='';db.actor=holder;
  return result.receipt.notices.find(n=>n.user_id===holder).notification_id;
 }
 const business=()=>scalar(`SELECT jsonb_build_object('tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m),'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id) FROM public.profiles p),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a))`);
 let id=prepare();db.role='authenticated';
 await assert.rejects(()=>db.exec(mark(id,'true')),/does not exist/);
 db.role='';cases.push({case:'original released fixture has no read-state RPC; no behavior inferred from absent API',passed:true});
 const beforeInstall=business();db.run(patch);const installed=metadata();db.run(patch);assert.equal(metadata(),installed);assert.equal(business(),beforeInstall);
 cases.push({case:'new scoped native door install/replay preserves existing business/audit data and exact metadata',passed:true});
 db.run(`CREATE SCHEMA IF NOT EXISTS proof;CREATE TABLE proof.notice_read_updates(n integer);INSERT INTO proof.notice_read_updates VALUES(0);
 CREATE FUNCTION proof.count_notice_reads() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE proof.notice_read_updates SET n=n+1;RETURN NEW;END$$;
 CREATE TRIGGER fixture_notice_read_count AFTER UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION proof.count_notice_reads();`);
 const result=value=>{db.role='authenticated';const row=JSON.parse(scalar(mark(id,value)));db.role='';return row;};
 const businessBefore=business();const read=result('true');
 assert.deepEqual(Object.keys(read).sort(),['is_read','notification_id','read_at']);assert.equal(read.notification_id,id);assert.equal(read.is_read,true);assert(Number.isFinite(Date.parse(read.read_at)));
 assert.deepEqual(result('true'),read);assert.equal(scalar('SELECT n FROM proof.notice_read_updates'),'1');
 assert.deepEqual(result('false'),{notification_id:id,is_read:false,read_at:null});assert.deepEqual(result('false'),{notification_id:id,is_read:false,read_at:null});
 assert.equal(scalar('SELECT n FROM proof.notice_read_updates'),'2');assert.equal(business(),businessBefore);
 cases.push({case:'verified read/unread receipts, repeated value no second update/time and no ownership/approval/audit effects',passed:true});
 db.run(`UPDATE public.notifications SET is_read=true,read_at=NULL WHERE id='${id}'`);const repaired=result('true');assert(Number.isFinite(Date.parse(repaired.read_at)));assert.deepEqual(result('true'),repaired);
 db.run(`UPDATE public.notifications SET is_read=false,read_at=now() WHERE id='${id}'`);assert.deepEqual(result('false'),{notification_id:id,is_read:false,read_at:null});
 cases.push({case:'legacy inconsistent read timestamp heals once then reconciles without duplicate writes',passed:true});
 id=prepare();
 db.run(`CREATE FUNCTION proof.notice_after_read_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF pg_trigger_depth()=1 AND NEW.is_read THEN UPDATE public.notifications SET read_at=NEW.read_at+interval '1 minute' WHERE id=NEW.id;END IF;RETURN NEW;END$$;
 CREATE TRIGGER fixture_notice_after_read_timestamp AFTER UPDATE OF is_read ON public.notifications FOR EACH ROW EXECUTE FUNCTION proof.notice_after_read_timestamp();`);
 const triggered=result('true');
 assert.equal(triggered.read_at,JSON.parse(scalar(`SELECT to_json(read_at) FROM public.notifications WHERE id='${id}'`)),'Receipt must read actual stored timestamp after AFTER triggers, not an earlier RETURNING row');
 db.run('DROP TRIGGER fixture_notice_after_read_timestamp ON public.notifications;DROP FUNCTION proof.notice_after_read_timestamp();');
 cases.push({case:'receipt reads the actual stored read timestamp after original notification AFTER-trigger work',passed:true});

 for(const [name,change,who]of [
  ['ban',`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${holder}'`,holder],
  ['soft deletion',`UPDATE auth.users SET deleted_at=now() WHERE id='${holder}'`,holder],
  ['foreign recipient','',remaining],
  ['retirement',`UPDATE public.tenants SET archived_at=now() WHERE id='${tenant}'`,holder],
  ['lost native owner audience',`UPDATE public.tenant_members SET is_owner=false,role='member' WHERE tenant_id='${tenant}' AND user_id='${holder}'`,holder],
  ['forged mutable notification binding',null,holder],
 ]){
  id=prepare();if(change)db.run(change);if(change===null)db.run(`UPDATE public.notifications SET metadata=jsonb_build_object('kind','exp08_owner_recovery','audit_id','e8000000-0000-4000-8000-000000989999') WHERE id='${id}'`);
  const before=scalar(`SELECT to_jsonb(n) FROM public.notifications n WHERE id='${id}'`);db.actor=who;db.role='authenticated';
  await assert.rejects(()=>db.exec(mark(id,'true')),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);db.role='';assert.equal(scalar(`SELECT to_jsonb(n) FROM public.notifications n WHERE id='${id}'`),before);
  cases.push({case:'current personal native eligibility refuses '+name+' without marking a row',passed:true});
 }
 id=prepare(true);const zeroBefore=business();result('true');assert.equal(business(),zeroBefore);
 db.role='authenticated';await assert.rejects(()=>db.exec(`SELECT public.get_owner_recovery_notice('${tenant}','${id}')`),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);db.role='';
 assert.equal(scalar(`SELECT count(*) FROM public.tenant_members WHERE user_id='${holder}'`),'0');assert.equal(scalar(`SELECT active_tenant_id IS NULL FROM public.profiles WHERE user_id='${holder}'`),'t');
 cases.push({case:'original holder-of-record personal notice can be read with zero seats without acquiring business/workspace access',passed:true});
 db.run(`INSERT INTO public.tenant_members(tenant_id,user_id,is_owner,status,role) VALUES('${tenant}','${holder}',false,'active','member')`);db.role='authenticated';
 await assert.rejects(()=>db.exec(mark(id,'false')),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);db.role='';assert.equal(scalar(`SELECT is_read FROM public.notifications WHERE id='${id}'`),'t');
 cases.push({case:'member reentry cannot reuse an old zero-seat notice audience snapshot',passed:true});
 id=prepare();
 for(const role of ['anon','service_role']){db.role=role;await assert.rejects(()=>db.exec(mark(id,'true')),/permission denied/);db.role='';}
 db.actor='';db.role='authenticated';await assert.rejects(()=>db.exec(mark(id,'true')),/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);db.role='';db.actor=holder;
 for(const query of [`SELECT public.set_my_owner_recovery_notice_read(NULL,true)`,`SELECT public.set_my_owner_recovery_notice_read('${id}',NULL)`]){db.role='authenticated';await assert.rejects(()=>db.exec(query),/STATE_INVALID/);db.role='';}
 cases.push({case:'anon/service/unauthenticated/null input refuse; original private predicate never grants a new caller identity',passed:true});
 const definition=JSON.parse(scalar(`SELECT to_json(pg_get_functiondef('${signature}'::regprocedure))`));
 db.run(`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`);const drift=metadata();await assert.rejects(()=>db.exec(patch),/existing door drift/);assert.equal(metadata(),drift);db.run(`REVOKE EXECUTE ON FUNCTION ${signature} FROM anon;`);
 const privateDefinition=JSON.parse(scalar(`SELECT to_json(pg_get_functiondef('public._exp08_read_my_recovery_notice(uuid)'::regprocedure))`));
 db.run(privateDefinition.replace('BEGIN','BEGIN\n PERFORM 1;'));await assert.rejects(()=>db.exec(patch),/original eligibility drift/);db.run(privateDefinition);assert.equal(metadata(),installed);
 cases.push({case:'installer refuses own ACL drift and changed original eligibility before normalization or data effects',passed:true});
 function session(input){const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='',ended=false;p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{ended=true;resolve({code,out,err});});});p.stdin.write(input+'\n');return{p,done,out:()=>out,err:()=>err,ended:()=>ended};}
 async function until(predicate,watch){const end=Date.now()+10000;while(!predicate()){assert(!watch?.ended(),watch?.err());assert(Date.now()<end,'Actual notice-state lock wait required');await new Promise(r=>setTimeout(r,25));}}
 const identity=()=>`SELECT set_config('test.actor','${holder}',false);SET ROLE authenticated;`;
 for(const kind of ['committed first','rolled back first','identity revocation first']){
  id=prepare();db.run('UPDATE proof.notice_read_updates SET n=0');const app='exp08_notice_state_'+Date.now();let first,second;
  try{
   first=session(kind==='identity revocation first'?`BEGIN;UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='${holder}';SELECT 'first_held';`:`BEGIN;${identity()}${mark(id,'true')};SELECT 'first_held';`);
   await until(()=>first.out().includes('first_held'),first);
   second=session(`SET application_name='${app}';SET statement_timeout='15s';${identity()}${mark(id,kind==='committed first'?'false':'true')};`);second.p.stdin.end();
   await until(()=>scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)==='t',second);
   first.p.stdin.end(kind==='rolled back first'?'ROLLBACK;\n':'COMMIT;\n');const a=await first.done,b=await second.done;assert.equal(a.code,0,a.err);
   assert.equal(b.code,kind==='identity revocation first'?3:0,b.err);assert.doesNotMatch(a.err+b.err,/deadlock detected|40P01/);
   if(kind==='identity revocation first'){assert.match(b.err,/OWNER_RECOVERY_NOTICE_UNAVAILABLE/);assert.equal(scalar(`SELECT is_read FROM public.notifications WHERE id='${id}'`),'f');assert.equal(scalar('SELECT n FROM proof.notice_read_updates'),'0');}
   else{assert.equal(scalar(`SELECT is_read FROM public.notifications WHERE id='${id}'`),kind==='committed first'?'f':'t');assert.equal(scalar('SELECT n FROM proof.notice_read_updates'),kind==='committed first'?'2':'1');}
   cases.push({case:'actual same-recipient native wait: '+kind+', no deadlock/duplicate effect',passed:true,observed_lock_wait:true});
  }finally{for(const c of [first,second].filter(Boolean)){if(!c.p.stdin.destroyed)c.p.stdin.end('ROLLBACK;\n');await c.done;}}
 }
 db.actor='';db.role='';db.run('DROP TRIGGER fixture_notice_read_count ON public.notifications;DROP FUNCTION proof.count_notice_reads();DROP TABLE proof.notice_read_updates;');
 assert.equal(metadata(),installed);db.run(patch);assert.equal(metadata(),installed);
 return cases;
}
