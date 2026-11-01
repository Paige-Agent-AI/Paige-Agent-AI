// Additional real two-session probes on the ORIGINAL E08 disposable fixture.
// No schema, fake executor, provider or production connection is introduced.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function provePlanningConcurrency(psql,connection,context){
 assert(connection.includes('exp08_team_hub_a2b_proof'),'Original disposable database only');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 for(const key of ['actor','tenant','channel','plan','item'])assert(uuid.test(context[key]),key);
 assert(context.cases.length===4);
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1',...connection];
 const sql=q=>execFileSync(psql,args,{input:q,encoding:'utf8',windowsHide:true,timeout:15000}).trim();
 assert.equal(sql('SELECT current_database();'),'exp08_team_hub_a2b_proof');
 const prefix=`e5plan_${randomUUID().slice(0,8)}`;
 const sessions=new Set();
 function session(tag){
  const name=`${prefix}_${tag}`,child=spawn(psql,['-X','-q','-A','-t','-v','ON_ERROR_STOP=0',...connection],
   {stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
  sessions.add(child);
  child.stdin.write(`SET application_name='${name}'; SET lock_timeout='8s'; SET statement_timeout='12s'; SET idle_in_transaction_session_timeout='15s';\n`);
  return {name,child,send:q=>child.stdin.write(q+'\n'),output:()=>out,error:()=>err,
   end:async()=>{child.stdin.end();const r=await done;sessions.delete(child);return r;}};
 }
 async function until(predicate,label){
  const start=Date.now();while(Date.now()-start<6500){if(predicate())return;await new Promise(r=>setTimeout(r,40));}
  throw Error('Timeout: '+label);
 }
 const auth=`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${context.actor}',true); SELECT set_config('request.jwt.claim.role','authenticated',true);`;
 const post=c=>`SELECT public.team_hub_post_agent_message(p_expected_tenant=>'${context.tenant}'::uuid,p_channel_id=>'${context.channel}'::uuid,p_agent_key=>'zion',p_body=>'Original concurrent Planning answer.',p_client_request_id=>'${c.request}'::uuid,p_parent_message_id=>NULL::uuid,p_asked_in_message_id=>'${c.question}'::uuid,p_intent=>'dm',p_turn_token=>'${c.token}');`;
 const count=c=>Number(sql(`SELECT count(*) FROM public.team_hub_messages WHERE asked_in_message_id='${c.question}' AND author_kind='agent';`));
 const sourceChange=`UPDATE public.plan_items SET updated_at='2026-11-01T00:00:00.123457Z',title='Changed original work' WHERE id='${context.item}';`;
 const roleChange=`UPDATE public.tenant_members SET role='member' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`;
 const results=[];
 try{
  for(let i=0;i<4;i++){
   const c=context.cases[i];for(const key of ['turn','question','request'])assert(uuid.test(c[key]));
   assert(/^turn-token-E5-concurrent-[0-3]-k{32}$/.test(c.token),'Exact incumbent synthetic opaque token, never a credential');
   sql(`UPDATE public.plan_items SET updated_at='2026-11-01T00:00:00.123456Z',title='Original concurrent work' WHERE id='${context.item}';
    UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`);
   const publicationFirst=i%2===0,change=i<2?'source':'role',mutation=change==='source'?sourceChange:roleChange;
   const a=session(`${i}_a`),b=session(`${i}_b`);
   try{
    a.send(`BEGIN; ${publicationFirst?auth+post(c):mutation} SELECT 'E5_HELD';`);
    await until(()=>{if(a.error())throw Error(a.error());return a.output().includes('E5_HELD');},'first transaction acquired original locks');
    b.send(publicationFirst?mutation:`BEGIN; ${auth} ${post(c)} COMMIT;`);
    // Observe the actual blocking pair, not a delay or a lucky result order.
    await until(()=>sql(`SELECT count(*) FROM pg_stat_activity blocked JOIN pg_stat_activity holder
     ON holder.pid=ANY(pg_blocking_pids(blocked.pid)) WHERE blocked.application_name='${b.name}'
      AND holder.application_name='${a.name}' AND blocked.wait_event_type='Lock';`)==='1','second transaction waits on first');
    a.send('COMMIT;');const [first,second]=await Promise.all([a.end(),b.end()]);
    assert.equal(first.err,'',JSON.stringify(first));
    if(publicationFirst){
     assert.equal(second.err,'',JSON.stringify(second));assert.equal(count(c),1,'One committed original reply');
     if(change==='source'){
      const retry=sql(`BEGIN; ${auth} ${post(c)} COMMIT;`);
      assert(retry.includes('"ok": true'),'Original retry still resolves the consumed authorized message');
      assert.equal(count(c),1,'No second reply after lost acknowledgement');
     }else{
      const history=sql(`BEGIN; ${auth} SELECT public.team_hub_list_messages('${context.tenant}','${context.channel}'); COMMIT;`);
      const message=JSON.parse(history.split(/\r?\n/).find(line=>line.startsWith('{'))).messages.find(m=>m.id===
       JSON.parse(first.out.split(/\r?\n/).find(line=>line.startsWith('{'))).message.id);
      assert.equal(message.source_unavailable,true,'Later demotion masks the earlier legitimate reply');
      assert(!message.body.includes('Original concurrent Planning answer'));
     }
    }else{
     assert.match(second.err,change==='source'?/Original Planning source changed/:/Invoice workspace or authority unavailable/);
     assert.equal(count(c),0,'Prior source/role change prevents private publication');
     assert.equal(sql(`SELECT consumed_at IS NULL FROM public.team_hub_agent_turns WHERE id='${c.turn}';`),'t');
    }
    results.push({change,order:publicationFirst?'publication-first':'change-first',actualBlockingPair:true,
     originalMessages:publicationFirst?1:0});
   }finally{
    for(const s of [a,b]){if(s.child.exitCode===null)s.child.kill();sessions.delete(s.child);}
   }
  }
 }finally{for(const child of sessions)child.kill();}
 return results;
}

// Exercise the actual STABLE history/Search API transaction mode. Synthetic
// fixture changes are committed before each independent read, then restored.
export function provePlanningReadOnlyHistory(psql,connection,context){
 assert(connection.includes('exp08_team_hub_a2b_proof'),'Original disposable database only');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 for(const key of ['actor','tenant','channel','plan','item','member','foreign_tenant'])assert(uuid.test(context[key]),key);
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1',...connection];
 const sql=q=>execFileSync(psql,args,{input:q,encoding:'utf8',windowsHide:true,timeout:15000}).trim();
 const literal=value=>value===null||value===undefined?'NULL':"'"+String(value).replaceAll("'","''")+"'";
 const json=q=>JSON.parse(sql(q).split(/\r?\n/).find(line=>line.startsWith('{')||line.startsWith('[')));
 sql(`UPDATE public.tenant_members SET role='admin',status='active' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`);
 const snapshot=json(`SELECT jsonb_build_object(
  'auth',(SELECT to_jsonb(u) FROM auth.users u WHERE id='${context.actor}'),
  'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE user_id='${context.actor}'),
  'seat',(SELECT to_jsonb(m) FROM public.tenant_members m WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}'),
  'tenant',(SELECT to_jsonb(n) FROM public.tenants n WHERE id='${context.tenant}'),
  'plan',(SELECT to_jsonb(p) FROM public.plans p WHERE id='${context.plan}'),
  'item',(SELECT to_jsonb(i) FROM public.plan_items i WHERE id='${context.item}'),
  'roster',(SELECT to_jsonb(s) FROM public.paige_subagents s WHERE tenant_id IS NULL AND slug='zion'),
  'actor_definition',pg_get_functiondef('public._sales_invoice_actor(uuid,uuid)'::regprocedure),
  'turns',(SELECT jsonb_agg(jsonb_build_object('id',id,'read_context',read_context)) FROM public.team_hub_agent_turns
   WHERE id=ANY(ARRAY[${context.cases.map(c=>literal(c.turn)).join(',')}]::uuid[])));`);
 const targets=JSON.parse(sql(`SELECT jsonb_agg(id ORDER BY id) FROM public.team_hub_messages WHERE author_kind='agent'
  AND channel_id='${context.channel}' AND body='Original concurrent Planning answer.';`));
 assert.equal(targets.length,2,'Original concurrent proof must first publish two real native answers');
 const originalMessageCount=Number(sql(`SELECT count(*) FROM public.team_hub_messages WHERE author_kind='agent' AND channel_id='${context.channel}';`));
 const restore=()=>{
  sql(`${snapshot.actor_definition};
   UPDATE auth.users SET deleted_at=${literal(snapshot.auth.deleted_at)}::timestamptz,banned_until=${literal(snapshot.auth.banned_until)}::timestamptz WHERE id='${context.actor}';
   UPDATE public.profiles SET active_tenant_id=${literal(snapshot.profile.active_tenant_id)}::uuid WHERE user_id='${context.actor}';
   UPDATE public.tenant_members SET role=${literal(snapshot.seat.role)},status=${literal(snapshot.seat.status)} WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';
   UPDATE public.tenants SET status=${literal(snapshot.tenant.status)} WHERE id='${context.tenant}';
   UPDATE public.plans SET owner_user_id=${literal(snapshot.plan.owner_user_id)}::uuid,created_by=${literal(snapshot.plan.created_by)}::uuid,
    scope=${literal(snapshot.plan.scope)} WHERE id='${context.plan}';
   INSERT INTO public.plan_items SELECT (jsonb_populate_record(NULL::public.plan_items,${literal(JSON.stringify(snapshot.item))}::jsonb)).* ON CONFLICT(id) DO NOTHING;
   UPDATE public.plan_items SET created_by=${literal(snapshot.item.created_by)}::uuid,assigned_to_user_id=${literal(snapshot.item.assigned_to_user_id)}::uuid,
    status=${literal(snapshot.item.status)},updated_at=${literal(snapshot.item.updated_at)}::timestamptz WHERE id='${context.item}';
   UPDATE public.paige_subagents SET config=${literal(JSON.stringify(snapshot.roster.config))}::jsonb WHERE tenant_id IS NULL AND slug='zion';
   ${snapshot.turns.map(t=>`UPDATE public.team_hub_agent_turns SET read_context=${literal(JSON.stringify(t.read_context))}::jsonb WHERE id=${literal(t.id)}::uuid;`).join('\n')}`);
 };
 const read=(kind,mode='READ ONLY',actor=context.actor,tenant=context.tenant)=>json(`BEGIN ${mode}; SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','${actor}',true); SELECT set_config('request.jwt.claim.role','authenticated',true);
  SELECT ${kind==='history'?`public.team_hub_list_messages('${tenant}','${context.channel}')`:`public.team_hub_search('${tenant}','concurrent')`}; COMMIT;`);
 const inspect=(kind,result,expected)=>{
  if(expected)assert.equal(result.ok,true,'Original public '+kind+' succeeds: '+JSON.stringify(result));
  const rows=kind==='history'?result.messages??[]:result.results??[];
  const found=rows.filter(r=>targets.includes(kind==='history'?r.id:r.message_id));
  if(expected){
   assert.equal(found.length,targets.length,'Original '+kind+' returns the SAME saved message IDs');
   if(kind==='history')for(const row of found){assert(row.body.includes('Original concurrent Planning answer.'));assert.notEqual(row.source_unavailable,true);}
  }else{
   if(kind==='search')assert.equal(found.length,0,'Revoked originals must not remain in Search');
   else for(const row of found){assert(!row.body.includes('Original concurrent Planning answer.'));assert.equal(row.source_unavailable,true);}
  }
 };
 const results=[];
 const check=(name,expected,change,actor=context.actor,tenant=context.tenant)=>{
  try{if(change)sql(change);for(const kind of ['history','search'])inspect(kind,read(kind,'READ ONLY',actor,tenant),expected);
   results.push({name,readOnly:true,history:true,search:true,expected});}
  finally{
   restore();const restored=read('history');
   assert.equal(restored.ok,true,name+': fixture authority restored: '+JSON.stringify({result:restored,
    state:json(`SELECT jsonb_build_object('seat',(SELECT to_jsonb(m) FROM public.tenant_members m WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}'),
     'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE user_id='${context.actor}'),
     'tenant',(SELECT to_jsonb(t) FROM public.tenants t WHERE id='${context.tenant}'))`)}));
  }
 };
 try{
  inspect('history',read('history','READ WRITE'),true);
  check('same original saved answers through read-only API doors',true);
  check('legitimate later completion retains historical answers',true,
   `UPDATE public.plan_items SET status='done',updated_at=clock_timestamp() WHERE id='${context.item}';`);
  check('consumed historical observation does not expire like an unconsumed stage',true,
   `UPDATE public.team_hub_agent_turns SET read_context=jsonb_set(read_context,'{expires_at}','"2000-01-01T00:00:00Z"')
    WHERE id=ANY(ARRAY[${context.cases.map(c=>literal(c.turn)).join(',')}]::uuid[]);`);
  check('deleted original source hides historical private content',false,`DELETE FROM public.plan_items WHERE id='${context.item}';`);
  check('current role demotion hides original private content',false,
   `UPDATE public.tenant_members SET role='member' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`);
  check('suspended original business cannot recover private content',false,
   `UPDATE public.tenants SET status='suspended' WHERE id='${context.tenant}';`);
  check('current original plan access is required',false,
   `UPDATE public.plans SET owner_user_id='${context.member}',created_by='${context.member}',scope='personal' WHERE id='${context.plan}';`);
  check('current original item access is required',false,
   `UPDATE public.plan_items SET created_by='${context.member}',assigned_to_user_id='${context.member}' WHERE id='${context.item}';`);
  check('current active-workspace change refuses old private content',false,
   `UPDATE public.profiles SET active_tenant_id='${context.foreign_tenant}' WHERE user_id='${context.actor}';`);
  check('banned original actor cannot recover private content',false,`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='${context.actor}';`);
  check('soft-deleted original actor cannot recover private content',false,`UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='${context.actor}';`);
  check('current roster revocation hides original private content',false,
   `UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',(config#>'{capability_scope,tools}')-'plan_list') WHERE tenant_id IS NULL AND slug='zion';`);
  check('another member cannot read the original private DM',false,null,context.member);
  check('foreign expected business cannot recover the original private content',false,null,context.actor,context.foreign_tenant);
  const drift=snapshot.actor_definition.replace('\nBEGIN\n','\nBEGIN\n -- unknown policy source\n');
  assert.notEqual(drift,snapshot.actor_definition,'Causal policy mutation must change actual original source');
  check('unknown canonical policy drift refuses historical content',false,drift);
  check('original access restored without recreating messages',true);
  assert.equal(Number(sql(`SELECT count(*) FROM public.team_hub_messages WHERE author_kind='agent' AND channel_id='${context.channel}';`)),originalMessageCount);
  // The incumbent seat-ended trigger deliberately removes the private DM and
  // its original turns. Run that destructive fixture control last; restoring a
  // seat must not recreate the conversation or bypass its original cleanup.
  sql(`UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='${context.tenant}' AND user_id='${context.actor}';`);
  for(const kind of ['history','search'])inspect(kind,read(kind),false);
  results.push({name:'ended original seat denies private history through canonical cleanup',readOnly:true,history:true,search:true,expected:false});
 }finally{restore();}
 return results;
}
