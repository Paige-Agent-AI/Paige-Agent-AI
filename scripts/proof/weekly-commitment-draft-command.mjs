import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';

/** Additive cases in the existing disposable native PostgreSQL proof, never a QA account.
 * Runs actual canonical proposal schema/integrity, native draft and stable Rail functions.
 * Auth/current-tenant/Trust fixture boundary is inherited from the existing proof.
 */
export async function weeklyDraftCommandProof({run,json,literal,source,check,refuses,concurrent,owner,tenant,otherOwner,foreign,member,admin}) {
  const ctx={actor:owner,tenant,role:'authenticated'};
  const migration='supabase/migrations/20271102090000_experience05_confirmed_weekly_draft.sql';
  const eventsBefore=run('SELECT count(*) FROM paige_native_events;');
  const flagBefore=run("SELECT is_live FROM paige_automation_triggers WHERE key='schedule.weekly_commitment_check';");
  run(source('supabase/migrations/20261023000000_confirmations_bind_the_approval_to_the_call.sql'));
  run(source('supabase/migrations/20261026000000_a_token_cannot_be_redeemed_by_the_turn_that_minted_it.sql'));
  run(source('supabase/migrations/20261201000400_canonical_proposal_integrity.sql'));
  // Supabase's ordinary trusted service grants; no browser write grant. Profiles is
  // the incumbent fixture table, extended only to represent its real user_id key.
  run(`GRANT ALL ON paige_pending_confirmations TO service_role;
    ALTER TABLE profiles ADD COLUMN user_id uuid;
    INSERT INTO profiles(id,user_id,active_tenant_id) VALUES(${literal(owner)},${literal(owner)},${literal(tenant)}),
      (${literal(otherOwner)},${literal(otherOwner)},${literal(foreign)}),(${literal(member)},${literal(member)},${literal(tenant)}),
      (${literal(admin)},${literal(admin)},${literal(tenant)});`);
  check('weekly draft seam is absent before its forward migration',()=>
    assert.equal(run("SELECT to_regprocedure('public.commit_weekly_commitment_draft(uuid,uuid,jsonb)') IS NULL;"),'t'));
  const catalogueBefore=json(`SELECT jsonb_agg(to_jsonb(t) ORDER BY tool_key) FROM list_tool_autonomy(${literal(tenant)}) t;`,ctx);
  run(source(migration));run(source(migration));
  check('draft catalogue preserves every incumbent permission and adds only default-confirm metadata',()=>{
    const after=json(`SELECT jsonb_agg(to_jsonb(t) ORDER BY tool_key) FROM list_tool_autonomy(${literal(tenant)}) t;`,ctx);
    assert.deepEqual(after.filter(v=>v.tool_key!=='weekly_commitment_draft'),catalogueBefore);
    assert.equal(after.find(v=>v.tool_key==='weekly_commitment_draft').mode,'confirm');
    assert.equal(run("SELECT count(*) FROM tenant_tool_autonomy WHERE tool_key='weekly_commitment_draft';"),'0');
  });
  const proposal=(patch={})=>{
    const id=randomUUID(),request=randomUUID(),issued=randomUUID(),fingerprint=randomUUID().replaceAll('-','').slice(0,16);
    const args={_request_id:request,_name:`Weekly commitment check ${id.slice(0,8)}`,_weekday:1,_local_time:'09:00',_timezone:'America/New_York',...patch.args};
    run(`INSERT INTO paige_pending_confirmations(id,user_id,tenant_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at,expires_at)
      VALUES(${literal(id)},${literal(patch.actor??owner)},${literal(patch.tenant??tenant)},${literal(patch.tool??'weekly_commitment_draft')},
        ${literal(fingerprint)},${literal(JSON.stringify(args))}::jsonb,'Save an unapproved draft',${literal(patch.legacy?null:issued)},
        ${patch.legacy?'NULL':'clock_timestamp()'},clock_timestamp()+interval '10 minutes');`);
    return {id,request,issued,args,token:`${fingerprint}:${issued}`};
  };
  const inspect=(p,c=ctx)=>json(`SELECT read_weekly_commitment_draft(${literal(p.id)});`,c);
  const claim=(p,nonce=randomUUID(),c=ctx,token=p.token)=>({nonce,result:json(`SELECT claim_weekly_commitment_draft(${literal(p.id)},${literal(token)},${literal(nonce)});`,c)});
  const commitSQL=(p,nonce,args=p.args)=>`SELECT commit_weekly_commitment_draft(${literal(p.id)},${literal(nonce)},${literal(JSON.stringify(args))}::jsonb);`;
  const processes=p=>run(`SELECT count(*) FROM paige_automations WHERE trigger_key='schedule.weekly_commitment_check' AND trigger_config->>'request_id'=${literal(p.request)};`);
  const receipts=p=>run(`SELECT count(*) FROM paige_workspace_events WHERE source_kind='capability_run' AND source_id=${literal(p.request)} AND capability_key='weekly_commitment_draft';`);
  const p=proposal();let claimed,saved;
  check('trusted canonical pending review creates no native definition',()=>{
    const state=inspect(p);assert.equal(state.phase,'awaiting_approval');assert.equal(state.confirmation_token,p.token);
    assert.equal(state.recurrence_authorized,false);assert.equal(processes(p),'0');
  });
  check('owner cannot directly issue or rewrite canonical approval rows',()=>{
    refuses(`UPDATE paige_pending_confirmations SET args='{}' WHERE id=${literal(p.id)};`,ctx);
    refuses(`INSERT INTO paige_pending_confirmations(user_id,tool_name,fingerprint,args,summary) VALUES(${literal(owner)},'weekly_commitment_draft','0000000000000000','{}','forged');`,ctx);
  });
  check('confirmation ID alone, wrong token and same issuing request cannot claim',()=>{
    for(const token of [null,'0000000000000000:'+p.issued])refuses(`SELECT claim_weekly_commitment_draft(${literal(p.id)},${literal(token)},gen_random_uuid());`,ctx);
    refuses(`SELECT claim_weekly_commitment_draft(${literal(p.id)},${literal(p.token)},${literal(p.issued)});`,ctx);
    assert.equal(inspect(p).phase,'awaiting_approval');
  });
  check('unclaimed proposal cannot invoke native save directly',()=>refuses(commitSQL(p,randomUUID()),ctx));
  check('claim returns only the exact stored call and keeps its canonical nonce',()=>{
    claimed=claim(p);assert.equal(claimed.result.claimed,true);assert.deepEqual(claimed.result.args,p.args);
    assert.equal(claimed.result.actor_id,owner);assert.equal(claimed.result.tenant_id,tenant);
    assert.equal(inspect(p).phase,'unknown');assert.equal(processes(p),'0');
  });
  check('a different execution request or changed claimed args cannot write',()=>{
    refuses(commitSQL(p,randomUUID()),ctx);refuses(commitSQL(p,claimed.nonce,{...p.args,_local_time:'10:00'}),ctx);
    assert.equal(processes(p),'0');
  });
  check('actual native definition and matching stable Rail receipt commit together',()=>{
    saved=json(commitSQL(p,claimed.nonce),ctx);assert.equal(saved.phase,'saved');assert(saved.receipt_id);assert(saved.automation_id);
    assert.equal(saved.process_state,'draft');assert.equal(saved.revision,1);assert.equal(saved.recurrence_authorized,false);
    const row=json(`SELECT to_jsonb(a) FROM paige_automations a WHERE id=${literal(saved.automation_id)};`);
    assert.equal(row.state,'draft');assert.equal(row.granted_lane,'confirm');assert.equal(row.trigger_config.next_run_at,undefined);
    assert.equal(row.trigger_config.request_id,p.request);assert.equal(processes(p),'1');assert.equal(receipts(p),'1');
  });
  check('lost response and a subsequent conversation adopt the same process and receipt without writes',()=>{
    const before=run('SELECT count(*) FROM audit_logs;');const state=inspect(p);
    assert.equal(state.automation_id,saved.automation_id);assert.equal(state.receipt_id,saved.receipt_id);assert.equal(state.confirmation_token,null);
    assert.equal(run('SELECT count(*) FROM audit_logs;'),before);assert.equal(processes(p),'1');assert.equal(receipts(p),'1');
  });
  check('repeat commit returns recorded result without another definition or receipt',()=>{
    assert.equal(json(commitSQL(p,claimed.nonce),ctx).receipt_id,saved.receipt_id);assert.equal(claim(p).result.claimed,false);
    assert.equal(processes(p),'1');assert.equal(receipts(p),'1');
  });
  check('member admin foreign owner anonymous and service credentials cannot inspect or claim',()=>{
    for(const c of [{actor:member,tenant,role:'authenticated'},{actor:admin,tenant,role:'authenticated'},
      {actor:otherOwner,tenant:foreign,role:'authenticated'},{role:'anon'},{role:'service_role'}]) {
      refuses(`SELECT read_weekly_commitment_draft(${literal(p.id)});`,c);
      refuses(`SELECT claim_weekly_commitment_draft(${literal(p.id)},${literal(p.token)},gen_random_uuid());`,c);
      if(c.actor===otherOwner)assert.equal(json('SELECT list_weekly_commitment_drafts(NULL);',c).requests.length,0);
      else refuses(`SELECT list_weekly_commitment_drafts(NULL);`,c);
    }
  });
  check('same owner in a different active workspace cannot spend the old proposal',()=>{
    run(`INSERT INTO tenant_members VALUES(${literal(foreign)},${literal(owner)},'owner','active');`);
    refuses(`SELECT read_weekly_commitment_draft(${literal(p.id)});`,{...ctx,tenant:foreign});
    run(`DELETE FROM tenant_members WHERE tenant_id=${literal(foreign)} AND user_id=${literal(owner)};`);
  });
  check('expired and legacy proposals remain non-executable',()=>{
    const expired=proposal();run(`UPDATE paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${literal(expired.id)};`);
    assert.equal(inspect(expired).phase,'expired');refuses(`SELECT claim_weekly_commitment_draft(${literal(expired.id)},${literal(expired.token)},gen_random_uuid());`,ctx);
    const legacy=proposal({legacy:true});refuses(`SELECT read_weekly_commitment_draft(${literal(legacy.id)});`,ctx);
  });
  check('off Trust refuses before consuming the pending proposal',()=>{
    const held=proposal();run("SELECT set_tool_autonomy('weekly_commitment_draft','off');",ctx);
    refuses(`SELECT claim_weekly_commitment_draft(${literal(held.id)},${literal(held.token)},gen_random_uuid());`,ctx);
    assert.equal(inspect(held).phase,'awaiting_approval');run("DELETE FROM tenant_tool_autonomy WHERE tool_key='weekly_commitment_draft';");
  });
  check('current role revocation after claim prevents native write',()=>{
    const revoked=proposal(),c=claim(revoked);run(`UPDATE tenant_members SET status='inactive' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);
    try{refuses(commitSQL(revoked,c.nonce),ctx);}finally{run(`UPDATE tenant_members SET status='active' WHERE tenant_id=${literal(tenant)} AND user_id=${literal(owner)};`);}
    assert.equal(processes(revoked),'0');assert.equal(inspect(revoked).phase,'unknown');
  });
  const declined=proposal();
  check('decline is durable on the same store and cannot later be executed',()=>{
    assert.equal(json(`SELECT decline_weekly_commitment_draft(${literal(declined.id)},${literal(declined.token)});`,ctx).phase,'declined');
    assert.equal(claim(declined).result.claimed,false);assert.equal(processes(declined),'0');
  });
  let declinePlan;
  check('actual decline reconciliation uses its natural point index with ten thousand unrelated audit rows',()=>{
    const lookup=source(migration).match(/SELECT EXISTS\(SELECT 1 FROM public\.audit_logs[\s\S]+?INTO _declined;/)?.[0];
    assert(lookup,'actual canonical decline lookup is extracted, not reimplemented');
    const query=lookup.replace(' INTO _declined','').replaceAll('_p.user_id',literal(owner)).replaceAll('_p.id',literal(declined.id))
      .replaceAll('_p.tenant_id',literal(tenant)+'::uuid');
    declinePlan=json(`BEGIN;
      INSERT INTO audit_logs(user_id,entity,action,entity_id,data)
        SELECT ${literal(owner)},'unrelated_fixture','unrelated_fixture',gen_random_uuid(),'{}'::jsonb FROM generate_series(1,10000);
      ANALYZE audit_logs; EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query} ROLLBACK;`);
    assert(JSON.stringify(declinePlan).includes('weekly_draft_decline_audit_idx'));
    assert.equal(inspect(declined).phase,'declined');
  });
  check('decline cannot retroactively terminate a claimed draft save',()=>{
    const inFlight=proposal(),c=claim(inFlight);assert.equal(json(`SELECT decline_weekly_commitment_draft(${literal(inFlight.id)},${literal(inFlight.token)});`,ctx).phase,'unknown');
    assert.equal(json(commitSQL(inFlight,c.nonce),ctx).phase,'saved');
  });
  const racing=proposal();
  const claims=await concurrent(`SELECT claim_weekly_commitment_draft(${literal(racing.id)},${literal(racing.token)},gen_random_uuid());`,ctx,6);
  check('six real concurrent claims have exactly one winner',()=>assert.equal(claims.map(v=>JSON.parse(v)).filter(v=>v.claimed).length,1));
  const raceNonce=run(`SELECT claimed_in_request FROM paige_pending_confirmations WHERE id=${literal(racing.id)};`);
  const commits=await concurrent(commitSQL(racing,raceNonce),ctx,6);
  check('six native duplicate commit deliveries preserve one definition audit and receipt',()=>{
    const results=commits.map(v=>JSON.parse(v));assert.equal(new Set(results.map(v=>v.automation_id)).size,1);
    assert.equal(new Set(results.map(v=>v.receipt_id)).size,1);assert.equal(processes(racing),'1');assert.equal(receipts(racing),'1');
    assert.equal(run(`SELECT count(*) FROM audit_logs WHERE entity='paige_automation' AND action='weekly_check.draft' AND entity_id=${literal(results[0].automation_id)};`),'1');
  });
  check('canonical receipt failure rolls back native save while keeping uncertainty visible',()=>{
    const broken=proposal(),c=claim(broken);
    run(`CREATE FUNCTION fixture_fail_draft_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.capability_key='weekly_commitment_draft' THEN RAISE EXCEPTION 'fixture_receipt_unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_fail_draft_receipt BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION fixture_fail_draft_receipt();`);
    try{refuses(commitSQL(broken,c.nonce),ctx,'fixture_receipt_unavailable');}finally{run('DROP TRIGGER fixture_fail_draft_receipt ON paige_workspace_events; DROP FUNCTION fixture_fail_draft_receipt();');}
    assert.equal(processes(broken),'0');assert.equal(receipts(broken),'0');assert.equal(inspect(broken).phase,'unknown');
  });
  check('draft feature preserves trigger posture and publishes no native occurrence',()=>{
    assert.equal(run('SELECT count(*) FROM paige_native_events;'),eventsBefore);
    assert.equal(run("SELECT is_live FROM paige_automation_triggers WHERE key='schedule.weekly_commitment_check';"),flagBefore);
  });
  let proposalHistory;
  check('consumed proposal history and fingerprint recovery use actual indexed owner queries at ten thousand rows',()=>{
    run(`INSERT INTO paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at,expires_at,consumed_at)
      SELECT ${literal(owner)},${literal(tenant)},'weekly_commitment_draft',substr(md5(n::text),1,16),
        jsonb_build_object('_request_id',gen_random_uuid(),'_name','History fixture '||n,'_weekday',1,'_local_time','09:00','_timezone','UTC'),
        'Synthetic historical unapproved draft',gen_random_uuid(),clock_timestamp()-n*interval '1 minute',clock_timestamp()+interval '1 minute',clock_timestamp()
      FROM generate_series(1,10000) n; ANALYZE paige_pending_confirmations;`);
    const sql=source(migration),fingerprint=run("SELECT substr(md5('10000'),1,16);");
    const history=sql.match(/FOR _id IN (SELECT p\.id FROM public\.paige_pending_confirmations[\s\S]+?LIMIT 11)/)?.[1];
    const point=sql.match(/SELECT p\.id INTO _id FROM public\.paige_pending_confirmations[\s\S]+?LIMIT 1;/)?.[0].replace(' INTO _id','');
    assert(history&&point,'extract both actual canonical list branches');
    const bind=q=>q.replaceAll('_uid',literal(owner)).replaceAll('_tid',literal(tenant)).replaceAll('_fingerprint',literal(fingerprint));
    const listPlan=json(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${bind(history)};`);
    const pointPlan=json(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${bind(point)}`);
    assert(JSON.stringify(listPlan).includes('weekly_draft_proposal_history_idx'));
    assert(JSON.stringify(pointPlan).includes('weekly_draft_proposal_fingerprint_idx'));
    const before=run('SELECT count(*) FROM audit_logs;');
    const all=json('SELECT list_weekly_commitment_drafts(NULL);',ctx);
    assert.equal(all.requests.length,10);assert.equal(all.has_more,true);
    assert(all.requests.every(r=>r.actor_id===owner&&r.tenant_id===tenant));
    const exact=json(`SELECT list_weekly_commitment_drafts(${literal(fingerprint)});`,ctx);
    assert.equal(exact.requests.length,1);assert.equal(exact.requests[0].draft.name,'History fixture 10000');
    assert.equal(json(`SELECT list_weekly_commitment_drafts(${literal(fingerprint)});`,{actor:otherOwner,tenant:foreign,role:'authenticated'}).requests.length,0);
    assert.equal(run('SELECT count(*) FROM audit_logs;'),before);
    proposalHistory={rows:10000,list: listPlan,point:pointPlan,actual_owner_rpc:true,read_writes:0};
  });
  return {status:'PASS',source:migration,migration_sha256:createHash('sha256').update(source(migration)).digest('hex'),
    decline_history:{rows:10000,actual_extracted_query:true,plan:declinePlan},proposal_history:proposalHistory,actual_native_drafts:true,actual_rail:true,concurrent_claims:6,concurrent_commits:6,
    additional_occurrences:0,provider_effects:0,authenticated_customer_acceptance:'NOT_RUN'};
}
