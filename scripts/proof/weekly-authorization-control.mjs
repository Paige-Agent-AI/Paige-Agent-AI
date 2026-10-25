import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareWeeklyControlReview} from '../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-review.ts';
import {readWeeklyCommitmentProjection} from '../../supabase/functions/_shared/paige-orchestration/weekly-commitment-read.ts';

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
    const second=json(`SELECT draft_weekly_commitment_check(${literal(randomUUID())},'Synthetic canonical full review',1,'09:00','UTC');`,ownerCtx).automation_id;
    const envelope=json('SELECT get_weekly_commitment_checks();',ownerCtx);
    const identity={actorId:envelope.actor_id,tenantId:envelope.tenant_id,workspaceId:envelope.tenant_id,
      role:'owner',actAsClientId:null,accountShape:'solo',scopeEpoch:1};
    const calls=[];
    const deps={currentIdentity:()=>identity,caller:{rpc:async(name,args)=>{
      calls.push(name);
      let sql;
      if(name==='current_user_tenant_id')sql='SELECT to_jsonb(current_user_tenant_id());';
      else if(name==='weekly_commitment_owner')sql=`SELECT to_jsonb(weekly_commitment_owner(${literal(args._tenant)},${literal(args._actor)}));`;
      else if(name==='get_weekly_commitment_checks')sql='SELECT get_weekly_commitment_checks();';
      else throw Error('Review attempted a non-read RPC');
      return {data:json(sql,ownerCtx),error:null};
    }}};
    const review=()=>prepareWeeklyControlReview(identity,deps,'authorize',{automation_id:second},randomUUID());
    const statement=binding=>{
      assert.equal(binding.rpc,'control_weekly_commitment_check');
      const args=binding.args;
      return `SELECT control_weekly_commitment_check(${literal(args._automation_id)},${literal(args._action)},${literal(args._expected_revision)},${literal(JSON.stringify(args._expected_control))}::jsonb);`;
    };
    const pauseSecond=()=>json(`SELECT control_weekly_commitment_check(${literal(second)},'pause',1);`,ownerCtx);
    const fresh=await review();
    check('full source review uses original native getter null and original authorization writer',()=>{
      assert.equal(fresh.status,'review_ready',JSON.stringify({status:fresh.status,reason:fresh.reason}));
      assert.deepEqual(fresh.binding.args._expected_control,{state:'requested',future_control_at:null});
      assert.equal(json(statement(fresh.binding),ownerCtx).state,'live');
      assert(calls.every(name=>['current_user_tenant_id','weekly_commitment_owner','get_weekly_commitment_checks'].includes(name)));
    });
    pauseSecond();
    const stale=await review();
    pauseSecond();
    check('a full source review cannot undo a later original native pause',()=>{
      assert.equal(stale.status,'review_ready');
      refuses(statement(stale.binding),ownerCtx,'40001');
      assert.equal(run(`SELECT state FROM paige_automations WHERE id=${literal(second)};`),'paused');
    });
    const legacyDeps={...deps,caller:{rpc:async(name,args)=>{
      const reply=await deps.caller.rpc(name,args);
      if(name!=='get_weekly_commitment_checks')return reply;
      const data=structuredClone(reply.data);
      for(const row of data.checks)if(row.automation_id===second)delete row.schedule.future_control_at;
      return {data,error:null};
    }}};
    const legacyRead=await readWeeklyCommitmentProjection(identity,legacyDeps);
    check('legacy status without cutoff remains readable through the original source consumer',()=>{
      assert.equal(legacyRead.status,'available');
      assert.equal(legacyRead.data.checks.find(row=>row.automation_id===second).future_control_at,undefined);
    });
    const legacyReview=await prepareWeeklyControlReview(identity,legacyDeps,'authorize',{automation_id:second},randomUUID());
    check('missing transport evidence cannot prepare a native authorization',()=>{
      assert.equal(legacyReview.status,'unavailable');
      assert.equal('binding' in legacyReview,false);
      assert.equal(run(`SELECT state FROM paige_automations WHERE id=${literal(second)};`),'paused');
    });
    const latest=await review();
    check('fresh full source review authorizes once with original native audit',()=>{
      assert.equal(latest.status,'review_ready');
      assert.equal(json(statement(latest.binding),ownerCtx).state,'live');
      assert.equal(run(`SELECT count(*) FROM audit_logs WHERE entity_id=${literal(second)} AND action='weekly_check.authorize';`),'2');
    });
    json(`SELECT control_weekly_commitment_check(${literal(second)},'cancel',1);`,ownerCtx);
    return {status:'PASS',native_state_and_cutoff:true,concurrent_stale_reviews:6,full_source_review_cases:5,new_events:0,provider_effects:0};
  }
  // The original guarded retirement proof and disposable database teardown own
  // cleanup. Never bypass the native history-preservation/act guards.
}
