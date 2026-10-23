import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// The original disposable weekly PostgreSQL harness supplies all substrate.
// No remote database, new scheduler, provider, or alternative control writer.
export async function weeklyAuthorizationControlProof({run,json,literal,check,refuses,concurrent,
  ownerCtx,member,admin,tenant,otherOwner,foreign,baseline=false}) {
  const id=json(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},'Synthetic atomic authorization',1,'09:00','UTC');`,ownerCtx).automation_id;
  const snapshot=()=>{
    const row=json('SELECT get_weekly_commitment_checks();',ownerCtx).checks.find(c=>c.automation_id===id);
    return {state:row.schedule_status,future_control_at:row.schedule.future_control_at??null};
  };
  const authorize=(review,revision=1)=>`SELECT control_weekly_commitment_check(${literal(id)},'authorize',${revision}${baseline?'':`,${literal(JSON.stringify(review))}::jsonb`});`;
  const stop=()=>json(`SELECT control_weekly_commitment_check(${literal(id)},'pause',1);`,ownerCtx);
  const held=()=>assert.equal(run(`SELECT state FROM paige_automations WHERE id=${literal(id)};`),'paused');
  {
    const reviewed=snapshot();
    stop(); // A second ordinary owner session acts after the first review/preflight.
    check('later pause atomically refuses the older requested-state authorization',()=>{
      refuses(authorize(reviewed),ownerCtx,'40001'); held();
    });
    const paused=snapshot();
    check('fresh exact paused-state authorization uses the original writer and audit',()=>{
      const result=json(authorize(paused),ownerCtx);
      assert.equal(result.state,'live'); assert.equal(result.revision,1); assert.equal(result.future_runs_only,true);
      assert.equal(run(`SELECT count(*) FROM audit_logs WHERE entity_id=${literal(id)} AND action='weekly_check.authorize';`),'1');
    });
    stop();
    check('paused-live-paused ABA invalidates the original native cutoff',()=>{
      assert.notEqual(snapshot().future_control_at,paused.future_control_at);
      refuses(authorize(paused),ownerCtx,'40001'); held();
    });
    const current=snapshot();
    check('wrong revision malformed control cancelled and forbidden callers remain refused',()=>{
      refuses(authorize(current,99),ownerCtx,'40001');
      for(const value of [null,{}, {...current,extra:true}, {...current,state:'scheduled'}, {...current,future_control_at:42}])
        refuses(authorize(value),ownerCtx,'22023');
      for(const ctx of [{actor:member,tenant,role:'authenticated'},{actor:admin,tenant,role:'authenticated'},
        {role:'anon'},{role:'service_role'}]) refuses(authorize(current),ctx);
      refuses(authorize(current),{actor:otherOwner,tenant:foreign,role:'authenticated'},'P0002'); held();
    });
    const attempts=await concurrent(`DO $proof$ BEGIN
      PERFORM control_weekly_commitment_check(${literal(id)},'authorize',1,${literal(JSON.stringify(paused))}::jsonb);
      RAISE EXCEPTION 'STALE_AUTHORIZATION_EXECUTED';
      EXCEPTION WHEN serialization_failure THEN NULL; END $proof$;`,ownerCtx);
    check('six concurrent stale reviews cannot undo the later pause',()=>{
      assert.equal(attempts.length,6); held();
      assert.equal(run(`SELECT count(*) FROM audit_logs WHERE entity_id=${literal(id)} AND action='weekly_check.authorize';`),'1');
    });
    json(`SELECT control_weekly_commitment_check(${literal(id)},'cancel',1);`,ownerCtx);
    check('original cancellation cannot be undone by the reviewed authorization',()=>{
      refuses(authorize(current),ownerCtx,'40001'); held();
    });
    return {status:'PASS',native_state_and_cutoff:true,concurrent_stale_reviews:6,new_events:0,provider_effects:0};
  }
  // The original guarded retirement proof and disposable database teardown own
  // cleanup. Never bypass the native history-preservation/act guards.
}
