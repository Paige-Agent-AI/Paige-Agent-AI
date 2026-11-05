// Owning disposable Hub fixture only. Actual advisory waits and original begin writer;
// Auth/profile/channel withdrawal ports are synthetic. No Storage API or production effects.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export async function verifyHubFileBeginCurrentness({sql,connection,ids,prepare,file,original,ready,blocked,parsed}) {
 const controls=[];
 const source=readFileSync(new URL('../../supabase/migrations/20271114160008_exp08_team_hub_files.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const helper=source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public._team_hub_file_json('));
 const helperBody=helper.slice(helper.indexOf('AS $$')+5,helper.indexOf('$$;'));
 original('files','_team_hub_file_json','public.team_hub_files',createHash('md5').update(helperBody).digest('hex'));
 const signature='public.team_hub_begin_file(uuid,uuid,text,text,bigint,uuid)';
 original('files','team_hub_begin_file','uuid,uuid,text,text,bigint,uuid','74917c7d31eaab3c7c8c597ea1a61095',true);
 const definition=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`);
 const metadata=()=>sql(`SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='${signature}'::regprocedure`);
 const beforeMetadata=metadata();
 const patch=readFileSync(new URL('../../supabase/migrations/20271130020018_exp08_file_admission_currentness.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const request='e8000000-0000-4000-8000-000000080899';
 for(const candidate of [false,true]) {
  if(candidate) { sql(patch); sql(patch); assert.equal(metadata(),beforeMetadata,'Actual forward apply/replay conserves OID and ALL non-source catalogue fields'); }
  for(const change of ['workspace','suspension','private membership']) for(const commit of [false,true]) {
   prepare();
   const channel=sql(`SELECT channel_id FROM public.team_hub_files WHERE id='${file}'`);
   sql(`DELETE FROM public.team_hub_files WHERE id='${file}'; INSERT INTO public.tenant_members(tenant_id,user_id,status,is_owner,role) VALUES('${ids.other}','${ids.actor}','active',false,'member');`);
   const holder=connection(`BEGIN; SET application_name='exp08_hub_door_first'; SELECT pg_advisory_xact_lock(hashtextextended('team_hub_files:${ids.actor}',0));\n\\echo EXP08_HUB_DOOR_READY`,true);
   let caller;
   try {
    await ready(holder);
    caller=connection(`BEGIN; SET application_name='exp08_hub_door_second'; SET statement_timeout='20s'; SELECT set_config('request.jwt.claim.sub','${ids.actor}',true); SET LOCAL ROLE authenticated; SELECT public.team_hub_begin_file('${ids.tenant}','${channel}','proof.txt','text/plain',1,'${request}'); COMMIT;`);
    assert(await blocked(caller,holder),'The original uploader advisory wait must actually occur');
    const withdrawal=change==='workspace'?`UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}'`:change==='suspension'?`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}'`:`DELETE FROM public.team_hub_channel_members WHERE channel_id='${channel}' AND user_id='${ids.actor}'`;
    sql(`BEGIN; ${withdrawal}; ${commit?'COMMIT':'ROLLBACK'};`);
    holder.p.stdin.end('COMMIT;\n\\q\n');
    const a=await holder.done,b=await caller.done;
    assert.equal(a.code,0,a.err); assert.equal(b.code,0,b.err);
    const response=parsed(b.out),allowed=!candidate||!commit;
    assert.equal(response?.ok,allowed,'Only a current allowed actor/channel may create a pending upload');
    assert.equal(sql(`SELECT count(*) FROM public.team_hub_files WHERE client_request_id='${request}'`),allowed?'1':'0');
    if(!allowed) {
     assert.equal('file' in response,false);
     // The original resolver falls back to the other active seat seeded above, even
     // while profiles.active_tenant_id retains the now-suspended workspace.
     if(change==='suspension')assert.equal(sql(`SELECT set_config('request.jwt.claim.sub','${ids.actor}',false); SELECT public.current_user_tenant_id();`).split('\n').at(-1),ids.other);
     assert.equal(response.code,change==='private membership'?'not_found':'scope_changed');
    }
    controls.push({change,candidate,committed:commit,actualAdvisoryWait:true,pendingRows:allowed?1:0});
   } finally {
    if(holder.p.exitCode===null&&!holder.p.stdin.writableEnded)holder.p.stdin.end('ROLLBACK;\n\\q\n');
    await Promise.allSettled([holder.done,...(caller?[caller.done]:[])]);
   }
  }
 }
 assert.equal(controls.length,12);
 prepare();
 const channel=sql(`SELECT channel_id FROM public.team_hub_files WHERE id='${file}'`);
 const invoke=`BEGIN; SELECT set_config('request.jwt.claim.sub','${ids.actor}',true); SET LOCAL ROLE authenticated; SELECT public.team_hub_begin_file('${ids.tenant}','${channel}','proof.txt','text/plain',1,'${request}'); COMMIT;`;
 const created=parsed(sql(invoke)),retried=parsed(sql(invoke));
 assert.equal(created.ok,true); assert.equal(retried.ok,true); assert.equal(retried.duplicate,true);
 assert.deepEqual(retried.file,created.file,'The original request keeps ONE original upload record');
 controls.push({change:'current original upload and retry',oneOriginalFile:true});
 const candidateDefinition=sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`);
 for(const [name,mutation] of [
  ['source',definition.replace('DECLARE','DECLARE\n-- unreviewed source\n')],
  ['anonymous grant',`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`],
  ['service grant',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`],
  ['grant option',`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated WITH GRANT OPTION;`],
  ['path',`ALTER FUNCTION ${signature} SET search_path=public;`],
  ['security',`ALTER FUNCTION ${signature} SECURITY INVOKER;`],
  ['strictness',`ALTER FUNCTION ${signature} STRICT;`],
  ['partial repair',candidateDefinition.replace('IF ch.visibility=\'private\' THEN',"IF false THEN")],
 ]) {
  // Strip only this candidate's transaction framing; the enclosing rollback covers mutation + patch.
  const inner=patch.slice(patch.indexOf('\nBEGIN;')+8,patch.lastIndexOf('\nCOMMIT;'));
  assert.throws(()=>sql(`BEGIN; ${mutation}; ${inner} COMMIT;`),/EXP08 file begin currentness/,'Source/authority drift must refuse atomically');
  assert.equal(metadata(),beforeMetadata); assert.equal(sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`),candidateDefinition);
  controls.push({change:'original upload guard drift',name,refusedAndRolledBack:true});
 }
 assert.equal(controls.length,21);
 // Actual unchanged retirement exclusion primitive, with explicit membership/profile
 // withdrawal ports. This is not a complete archive operation or customer Auth proof.
 const retirementSource=readFileSync(new URL('../../supabase/migrations/20270602000203_operator_account_archive.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const retirementStart=retirementSource.indexOf('CREATE OR REPLACE FUNCTION public.operator_lock_retirement_scope()');
 const retirementEnd=retirementSource.indexOf('$$;',retirementStart);
 assert(retirementStart>=0&&retirementEnd>retirementStart);
 sql(retirementSource.slice(retirementStart,retirementEnd+3));
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.operator_lock_retirement_scope()'::regprocedure"),'b47322af22aaba58ebe989a3d2d6c878');
 const gate=' LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;';
 assert.equal(candidateDefinition.split(gate).length,2);
 for(const mode of ['gate removed causal cycle','retirement commit','retirement rollback','admission first']) {
  prepare();
  const channel=sql(`SELECT channel_id FROM public.team_hub_files WHERE id='${file}'`);
  sql(`DELETE FROM public.team_hub_files WHERE id='${file}';`);
  const causal=mode==='gate removed causal cycle',admissionFirst=mode==='admission first';
  if(causal)sql(candidateDefinition.replace(gate,''));
  const begin=`SELECT set_config('request.jwt.claim.sub','${ids.actor}',true); SET LOCAL ROLE authenticated; SELECT public.team_hub_begin_file('${ids.tenant}','${channel}','proof.txt','text/plain',1,'${request}');`;
  const retirement="SELECT public.operator_lock_retirement_scope(); SET LOCAL lock_timeout='12s';";
  const withdrawal=`UPDATE public.tenant_members SET status='archived' WHERE tenant_id='${ids.tenant}' AND user_id='${ids.actor}';`;
  const first=connection(`BEGIN; SET application_name='exp08_hub_door_first'; SET statement_timeout='20s'; SET deadlock_timeout='100ms'; ${admissionFirst?begin:retirement}\n\\echo EXP08_HUB_DOOR_READY`,true);
  let second;
  try {
   await ready(first);
   second=connection(`BEGIN; SET application_name='exp08_hub_door_second'; SET statement_timeout='20s'; SET deadlock_timeout='100ms'; ${admissionFirst?retirement+withdrawal:begin} COMMIT;`);
   assert(await blocked(second,first),'Original retirement gate and admission must observe the actual blocking pair');
   if(!causal&&!admissionFirst)assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='exp08_hub_door_second' AND a.datname=current_database() AND l.relation='public.tenants'::regclass AND l.mode='RowExclusiveLock' AND NOT l.granted)"),'t','Admission must wait at the original tenant catalog gate before row locks');
   // Without the gate, admission holds the profile while waiting to INSERT into
   // the retirement-locked file table. Complete the opposite original lock edge.
   const effect=causal?`UPDATE public.profiles SET active_tenant_id='${ids.other}' WHERE user_id='${ids.actor}';`:admissionFirst?'':withdrawal;
   first.p.stdin.end(effect+(mode==='retirement rollback'?'ROLLBACK;':'COMMIT;')+'\n\\q\n');
   const a=await first.done,b=await second.done;
   if(causal)assert([a,b].some(r=>r.code!==0&&/40P01|deadlock detected/.test(r.err)),'Removing the original tenant gate must reproduce the actual deadlock');
   else {
    assert.equal(a.code,0,a.err); assert.equal(b.code,0,b.err);
    assert(!/40P01|deadlock detected|55P03|57014/.test(a.err+b.err),'A timeout is not successful retirement composition');
    const pending=sql(`SELECT count(*) FROM public.team_hub_files WHERE client_request_id='${request}'`);
    assert.equal(pending,mode==='retirement commit'?'0':'1');
    const response=parsed(admissionFirst?a.out:b.out);
    assert.equal(response?.ok,mode!=='retirement commit');
    if(mode==='retirement commit')assert.equal('file' in response,false);
   }
   controls.push({change:'original retirement gate composition',mode,actualBlockingPair:true,causalDeadlock:causal,fullArchiveAndCustomerAuth:false});
  } finally {
   if(first.p.exitCode===null&&!first.p.stdin.writableEnded)first.p.stdin.end('ROLLBACK;\n\\q\n');
   await Promise.allSettled([first.done,...(second?[second.done]:[])]);
   if(causal)sql(candidateDefinition);
  }
 }
 assert.equal(controls.length,25);
 console.log(JSON.stringify({phase:'original-file-begin-currentness',controls,scope:'disposable fixture; no real file bytes or customer authority'}));
 return controls;
}
