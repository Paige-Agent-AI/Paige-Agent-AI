// Author local, ported-schema proof of the original Communications read seam.
// No network/provider, dispatch, credentials, caller impersonation or receipt store.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
export async function verifyRecoveryDeliveryEvent(db,{reset,tenant,actor,holder,remaining,reason}){
 const cases=[],scalar=q=>db.run(q).split('\n').at(-1);
 const audit='e8000000-0000-4000-8000-000000096001';
 reset();db.role='authenticated';
 const committed=JSON.parse(scalar(`SELECT public.platform_owner_recovery('${tenant}','set_account_holder','${remaining}','${reason}','${audit}')`));
 db.role='';
 const sql=`SELECT public.get_owner_recovery_delivery_event('${tenant}','${audit}')`;
 const state=()=>scalar(`SELECT jsonb_build_object('audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a),
  'notices',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n),
  'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m))`);
 const before=state();db.actor='';db.role='service_role';
 const event=JSON.parse(scalar(sql));
 assert.equal(event.event,'owner_recovery');assert.equal(event.version,1);assert.equal(event.audit_id,audit);
 assert.equal(event.tenant_id,tenant);assert.equal(event.action,committed.action);assert.equal(event.recorded_at,committed.recorded_at);
 assert.deepEqual(Object.keys(event).sort(),['action','audit_id','event','recorded_at','recipients','tenant_id','version'].sort());
 assert.deepEqual(event.recipients.map(x=>({user_id:x.user_id,notification_id:x.notification_id})),
  committed.receipt.notices.map(x=>({user_id:x.user_id,notification_id:x.notification_id})).sort((a,b)=>a.user_id.localeCompare(b.user_id)));
 assert.ok(event.recipients.length===2&&event.recipients.every(x=>x.eligible));
 for(const x of event.recipients)assert.deepEqual(Object.keys(x).sort(),['eligible','notification_id','user_id']);
 assert.deepEqual(JSON.parse(scalar(sql)),event);db.role='';assert.equal(state(),before);
 cases.push({case:'service-only event read/replay derives exact native audience and minimal immutable facts with no writes, reason, address or recovery replay',passed:true});
 db.run(`DELETE FROM public.user_roles WHERE user_id='${actor}';UPDATE public.profiles SET active_tenant_id=NULL`);
 db.role='service_role';assert.deepEqual(JSON.parse(scalar(sql)),event);
 cases.push({case:'committed recovery remains readable after operator role loss, working holder and no recipient workspace; no borrowed auth identity',passed:true});
 for(const [label,query] of [
  ['wrong business',`SELECT public.get_owner_recovery_delivery_event('e8000000-0000-4000-8000-000000096099','${audit}')`],
  ['unknown event',`SELECT public.get_owner_recovery_delivery_event('${tenant}','e8000000-0000-4000-8000-000000096099')`],
  ['null event',`SELECT public.get_owner_recovery_delivery_event('${tenant}',NULL)`],
  ['null business',`SELECT public.get_owner_recovery_delivery_event(NULL,'${audit}')`]]){
  await assert.rejects(()=>db.exec(query),/OWNER_RECOVERY_DELIVERY_UNAVAILABLE/);
  cases.push({case:'service event refuses '+label,passed:true});
 }
 for(const role of ['anon','authenticated']){
  db.role=role;db.actor=actor;await assert.rejects(()=>db.exec(sql),/permission denied/);
  cases.push({case:role+' cannot read native delivery event even with historical operator identity',passed:true});
 }
 db.role='service_role';await assert.rejects(()=>db.exec(`SELECT public._exp08_read_recovery_delivery_event('${tenant}','${audit}')`),/permission denied/);
 cases.push({case:'service role has no private helper EXECUTE',passed:true});
 db.role='';db.actor='';
 async function eligibility(label,change,restore){
  db.run(change);db.role='service_role';const observed=JSON.parse(scalar(sql));db.role='';
  assert.equal(observed.recipients.find(x=>x.user_id===holder).eligible,false);
  assert.equal(observed.recipients.find(x=>x.user_id===remaining).eligible,true);
  db.run(restore);cases.push({case:label+' keeps recorded identity for reconciliation but independently refuses dispatch eligibility',passed:true});
 }
 await eligibility('recipient Auth ban',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${holder}'`,
  `UPDATE auth.users SET banned_until=NULL WHERE id='${holder}'`);
 await eligibility('recipient Auth soft delete',`UPDATE auth.users SET deleted_at=now() WHERE id='${holder}'`,
  `UPDATE auth.users SET deleted_at=NULL WHERE id='${holder}'`);
 await eligibility('revoked original owner role',`UPDATE public.tenant_members SET is_owner=false,role='admin' WHERE tenant_id='${tenant}' AND user_id='${holder}'`,
  `UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE tenant_id='${tenant}' AND user_id='${holder}'`);
 await eligibility('suspended original membership',`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${tenant}' AND user_id='${holder}'`,
  `UPDATE public.tenant_members SET status='active' WHERE tenant_id='${tenant}' AND user_id='${holder}'`);
 const notice=event.recipients.find(x=>x.user_id===holder).notification_id;
 await eligibility('client-edited notification binding',`UPDATE public.notifications SET metadata='{}' WHERE id='${notice}'`,
  `UPDATE public.notifications SET metadata=jsonb_build_object('kind','exp08_owner_recovery','audit_id','${audit}') WHERE id='${notice}'`);
 db.run(`UPDATE public.tenants SET archived_at=now() WHERE id='${tenant}'`);db.role='service_role';
 await assert.rejects(()=>db.exec(sql),/OWNER_RECOVERY_DELIVERY_UNAVAILABLE/);db.role='';
 db.run(`UPDATE public.tenants SET archived_at=NULL WHERE id='${tenant}'`);
 cases.push({case:'archived original business refuses all delivery-event access',passed:true});
 // Actual separate PostgreSQL sessions, not a timed assumption or simulated wait.
 for(const commit of [true,false]){
  const first=await db.holdArchive(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${holder}'`,[],{manualRelease:true});
  const name='exp08_delivery_auth_wait_'+Date.now();
  const second=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',err='';
  second.stdout.on('data',d=>{out+=d;});second.stderr.on('data',d=>{err+=d;});
  const done=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',code=>resolve(code));});
  second.stdin.end(`SET application_name='${name}';SET ROLE service_role;${sql};`);
  try{
   const deadline=Date.now()+10000;
   while(scalar(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0)`)!=='t'){
    assert.ok(Date.now()<deadline,'Service reader must actually wait on the native identity lock');await new Promise(r=>setTimeout(r,30));
   }
   first.release(commit);await first.completed;assert.equal(await done,0,err);
   const line=out.split('\n').find(x=>x.trim().startsWith('{'));assert.ok(line,out);
   assert.equal(JSON.parse(line).recipients.find(x=>x.user_id===holder).eligible,!commit);
   cases.push({case:'service event rechecks Auth eligibility after actual '+(commit?'committed ban':'rolled-back ban')+' lock wait',passed:true});
  }finally{first.release(false);await first.completed;await done;}
  db.run(`UPDATE auth.users SET banned_until=NULL WHERE id='${holder}'`);
 }
 db.role='';db.actor=actor;reset();return cases;
}
