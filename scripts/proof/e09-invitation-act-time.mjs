// Current invitation body inside the original fenced consumer runner. No new
// cluster/identity/executor; all actors and tokens are synthetic loopback data.
export async function invitationActTimeProof({sql,check,assert,spawn,exe,args,transcripts,fixture,call,evidence}) {
  check('Current native recipient joins once without a staff seat or workspace pointer',()=>{
    const f=fixture();call(f);
    assert.equal(sql(`SELECT linked_user_id FROM clients WHERE id='${f.contact}'`),f.actor);
    assert.equal(sql(`SELECT uses FROM tenant_invite_tokens WHERE id='${f.invite}'`),'1');
    assert.equal(sql(`SELECT count(*) FROM tenant_members WHERE user_id='${f.actor}'`),'0');
    assert.equal(sql(`SELECT coalesce(active_tenant_id::text,'NONE') FROM profiles WHERE user_id='${f.actor}'`),'NONE');
    assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${f.invite}' AND user_id='${f.actor}'`),'1');
    const before=sql('SELECT proof_snapshot()');assert.throws(()=>call(f));assert.equal(sql('SELECT proof_snapshot()'),before);
  });
  for(const [name,options]of [['wrong verified recipient',{wrong:true}],['already expired',{expired:true}],['revoked',{revoked:true}]]){
    check('Current native invitation refuses '+name+' without effects',()=>{const f=fixture(options),before=sql('SELECT proof_snapshot()');assert.throws(()=>call(f));assert.equal(sql('SELECT proof_snapshot()'),before);});
  }
  // Local transport wrapper catches the ORIGINAL exception in a subtransaction:
  // every native effect still rolls back, just as a refused PostgREST statement.
  sql(`CREATE FUNCTION proof_invite_timed_result(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
  DECLARE resolved uuid;BEGIN resolved:=public.accept_tenant_invite(p_token);RETURN jsonb_build_object('ok',true,'tenant',resolved);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'error',SQLERRM);END $$;
  REVOKE ALL ON FUNCTION proof_invite_timed_result(text) FROM PUBLIC,anon,service_role;
  GRANT EXECUTE ON FUNCTION proof_invite_timed_result(text) TO authenticated;`);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sessions=[];
  function session(label){
    const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']}),s={child,out:'',err:'',closed:false};sessions.push(s);
    child.stdout.on('data',data=>{s.out+=data;});child.stderr.on('data',data=>{s.err+=data;});
    s.done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{s.closed=true;transcripts.push({command:label,args,exitCode:code,stdout:s.out,stderr:s.err});if(code===0)resolve();else reject(new Error(s.err||`${label}: ${code}`));});});s.done.catch(()=>{});return s;
  }
  const json=(s,stage)=>s.out.split(/\r?\n/).filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).find(r=>r.stage===stage);
  async function until(predicate,label){const deadline=Date.now()+7000;while(Date.now()<deadline){const value=predicate();if(value)return value;await pause(40);}throw new Error('Missing native invitation witness: '+label);}
  try{
    for(const target of ['token','contact','business']){
      const f=fixture(),table=target==='token'?'tenant_invite_tokens':target==='contact'?'clients':'tenants';
      const id=target==='token'?f.invite:target==='contact'?f.contact:f.tenant;
      sql(`UPDATE tenant_invite_tokens SET expires_at=clock_timestamp()+interval '5 seconds' WHERE id='${f.invite}'`);
      const before=sql('SELECT proof_snapshot()'),holder=session('psql-invite-expiry-holder');
      holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT id FROM ${table} WHERE id='${id}' FOR UPDATE;SELECT jsonb_build_object('stage','locked','pid',pg_backend_pid());\n`);
      const locked=await until(()=>json(holder,'locked'),'original '+target+' lock');
      const recipient=session('psql-invite-expiry-recipient');
      recipient.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT jsonb_build_object('stage','before','pid',pg_backend_pid(),'before_expiry',now()<expires_at,'transaction_started',now(),'expires_at',expires_at) FROM tenant_invite_tokens WHERE id='${f.invite}';
SELECT set_config('test.actor','${f.actor}',true);SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('stage','result','role',current_user,'result',public.proof_invite_timed_result('${f.token}'));COMMIT;\n`);
      const started=await until(()=>json(recipient,'before'),'transaction before expiry');
      assert.equal(started.before_expiry,true,'Late setup is invalid proof, not a source refusal');
      await until(()=>{const row=JSON.parse(sql(`SELECT jsonb_build_object('wait_type',wait_event_type,'holder',${Number(locked.pid)}=ANY(pg_blocking_pids(pid))) FROM pg_stat_activity WHERE pid=${Number(started.pid)}`));return row?.wait_type==='Lock'&&row.holder?row:null;},'actual native invitation '+target+' wait');
      holder.child.stdin.end(`DO $$ BEGIN WHILE clock_timestamp()<(SELECT expires_at+interval '50 milliseconds' FROM tenant_invite_tokens WHERE id='${f.invite}') LOOP PERFORM pg_sleep(0.02);END LOOP;END $$;
SELECT jsonb_build_object('stage','released','expired',clock_timestamp()>=(SELECT expires_at FROM tenant_invite_tokens WHERE id='${f.invite}'),'released_at',clock_timestamp());COMMIT;\n`);
      await Promise.all([holder.done,recipient.done]);
      const released=json(holder,'released'),answered=json(recipient,'result');
      assert.equal(released?.expired,true);assert.equal(answered?.role,'authenticated');
      const unchanged=sql('SELECT proof_snapshot()')===before;
      evidence.waits.push({target,transactionStarted:started.transaction_started,expiresAt:started.expires_at,releasedAt:released.released_at,
        startedBeforeExpiry:true,observedNativeWait:true,releasedAfterExpiry:true,actualCallerRole:answered.role,result:answered.result,durableStateUnchanged:unchanged});
      check('Current consumer invitation after observed '+target+' wait refuses expiry with zero link/role/token/audit/pointer effects',()=>{
        assert.deepEqual(answered.result,{ok:false,sqlstate:'P0001',error:'invite has expired'});assert.equal(unchanged,true);
      });
    }
  }finally{for(const s of sessions)if(!s.closed){if(!s.child.stdin.writableEnded&&!s.child.stdin.destroyed)s.child.stdin.end('ROLLBACK;\n');s.child.kill();}await Promise.allSettled(sessions.map(s=>s.done));}
}
