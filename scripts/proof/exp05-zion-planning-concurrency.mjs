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
