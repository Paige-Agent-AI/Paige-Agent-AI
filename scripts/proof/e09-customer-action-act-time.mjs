// Extension of the original fenced Portal proof. Real local PostgreSQL sessions,
// actual writer and observed row waits; not a new runner or production identity.
export async function customerActionActTimeProof({sql,check,assert,spawn,exe,args,transcripts,actionFixture,statement,evidence}) {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const sessions=[];
  function session(label) {
    const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const s={child,out:'',err:'',closed:false,label};sessions.push(s);
    child.stdout.on('data',data=>{s.out+=data;});
    child.stderr.on('data',data=>{s.err+=data;});
    s.done=new Promise((resolve,reject)=>{
      child.on('error',reject);
      child.on('close',code=>{s.closed=true;transcripts.push({command:label,args,exitCode:code,stdout:s.out,stderr:s.err});
        if(code===0)resolve();else reject(new Error(`${label}: ${s.err||code}`));});
    });
    // Attach immediately so a failed native session cannot become an unhandled
    // rejection while another session's lock is being observed.
    s.done.catch(()=>{});
    return s;
  }
  function json(s,stage) {
    return s.out.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.stage===stage);
  }
  async function until(predicate,label) {
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){const value=predicate();if(value)return value;await pause(40);}
    throw new Error(`Missing native witness: ${label}`);
  }
  try {
    for(const type of ['completed','accepted','declined','question']) {
      const f=actionFixture();
      const version=sql(`UPDATE paige_customer_actions SET expires_at=clock_timestamp()+interval '5 seconds' WHERE id='${f.invite}' RETURNING updated_at;`).split(/\r?\n/)[0];
      const before=sql('SELECT proof_action_snapshot()');
      const holder=session('psql-action-expiry-holder');
      holder.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT id FROM paige_customer_actions WHERE id='${f.invite}' FOR UPDATE;
SELECT jsonb_build_object('stage','locked','pid',pg_backend_pid());\n`);
      const held=await until(()=>json(holder,'locked'),'original row locked');
      const responder=session('psql-action-expiry-responder');
      responder.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT set_config('test.actor','${f.actor}',true);SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('stage','before','pid',pg_backend_pid(),'before_expiry',now()<expires_at,'transaction_started',now(),'expires_at',expires_at)
FROM paige_customer_actions WHERE id='${f.invite}';
SELECT jsonb_build_object('stage','response','result',(${statement(f,{type,text:type==='question'?'Which document?':null,version}).replace(/^SELECT /,'')}));
COMMIT;\n`);
      const started=await until(()=>json(responder,'before'),'client transaction began');
      assert.equal(started.before_expiry,true,'Responder must start before expiry; otherwise proof is invalid');
      const wait=await until(()=>JSON.parse(sql(`SELECT jsonb_build_object('wait_type',wait_event_type,'blocked_by_holder',${Number(held.pid)}=ANY(pg_blocking_pids(pid))) FROM pg_stat_activity WHERE pid=${Number(started.pid)}`)),'actual response wait');
      // A session existing is insufficient: prove the actual function call waits
      // on the original action holder before permitting the holder to release.
      await until(()=>{
        const observed=JSON.parse(sql(`SELECT jsonb_build_object('wait_type',wait_event_type,'blocked_by_holder',${Number(held.pid)}=ANY(pg_blocking_pids(pid))) FROM pg_stat_activity WHERE pid=${Number(started.pid)}`));
        return observed.wait_type==='Lock'&&observed.blocked_by_holder?observed:null;
      },'response blocked on original action row');
      holder.child.stdin.end(`DO $$ BEGIN WHILE clock_timestamp()<(SELECT expires_at+interval '50 milliseconds' FROM paige_customer_actions WHERE id='${f.invite}') LOOP PERFORM pg_sleep(0.02);END LOOP;END $$;
SELECT jsonb_build_object('stage','released','expired_at_release',clock_timestamp()>=(SELECT expires_at FROM paige_customer_actions WHERE id='${f.invite}'),'released_at',clock_timestamp());COMMIT;\n`);
      await Promise.all([holder.done,responder.done]);
      const released=json(holder,'released');
      assert.equal(released?.expired_at_release,true,'Original row must remain locked until after expiry');
      const result=json(responder,'response')?.result;
      assert(result,'Actual native response is required');
      const unchanged=sql('SELECT proof_action_snapshot()')===before;
      evidence.waits.push({type,transactionStarted:started.transaction_started,expiresAt:started.expires_at,
        releasedAt:released.released_at,startedBeforeExpiry:true,observedRowWait:true,initialWait:wait,
        releasedAfterExpiry:true,result,durableStateUnchanged:unchanged});
      check(`Native ${type} after observed expiry row wait refuses with zero response/status/audit/notification/linked/Rail effects`,()=>{
        assert.deepEqual(result,{ok:false,error:'ACTION_EXPIRED'});assert.equal(unchanged,true);
      });
    }
  } finally {
    // Close only this proof's child sessions. The parent owns/stops its unique
    // loopback cluster; no shared server or customer session is touched.
    for(const s of sessions){if(!s.closed){if(!s.child.stdin.writableEnded&&!s.child.stdin.destroyed)s.child.stdin.end('ROLLBACK;\n');s.child.kill();}}
    await Promise.allSettled(sessions.map(s=>s.done));
  }
}
