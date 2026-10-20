import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';

// Extends the existing isolated native proof. No remote connection, scheduler or executor.
export function weeklyDeadlineProof({run,json,literal,source,check,occurrence,owner,tenant,member,
  otherOwner,foreign,original,baseline=false}) {
  const migration='supabase/migrations/20271112150000_experience05_weekly_deadline_semantics.sql';
  const before=json(`SELECT jsonb_build_object('detail',detail,'receipt',
    (SELECT to_jsonb(r) FROM paige_workspace_events r WHERE r.source_id=${literal(original.receipt)}))
    FROM paige_act_executions WHERE event_id=${literal(original.event)};`);
  const posture=()=>json(`SELECT jsonb_build_object('trigger',
    (SELECT to_jsonb(t) FROM paige_automation_triggers t WHERE key='schedule.weekly_commitment_check'),
    'tools',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tenant_id,tool_key) FROM tenant_tool_autonomy t));`);
  const originalPosture=posture();
  if(!baseline) {
    run(source(migration)); run(source(migration));
    check('deadline migration replays without changing execution activation or autonomy',()=>assert.deepEqual(posture(),originalPosture));
  }
  const fixtures=[];
  function item(kind,title,due,remind,{status='open',actor=owner,scope=tenant}={}) {
    const id=randomUUID();fixtures.push(id);
    run(`INSERT INTO plan_items(id,tenant_id,item_type,title,status,created_by,assigned_to_user_id,due_at,remind_at)
      VALUES(${literal(id)},${literal(scope)},${literal(kind)},${literal(title)},${literal(status)},
        ${literal(actor)},${literal(actor)},${due??'NULL'},${remind??'NULL'});`);
    return id;
  }
  const at=offset=>`now()+interval '${offset}'`;
  const overdue=item('task','Overdue work',at('-1 day'),null,{status:'blocked'});
  item('milestone','Upcoming milestone',at('1 day'));
  item('task','Undated work');item('task','Future work',at('30 days'));
  const futureReminder=item('reminder','Future reminder with old deadline',at('-1 day'),at('30 days'));
  item('reminder','Reminder with near legacy deadline',at('1 day'),at('30 days'));
  item('reminder','Reminder without legacy deadline',null,at('2 days'));
  item('reminder','Past reminder is not overdue work',at('30 days'),at('-1 day'));
  item('task','Completed work',at('-1 day'),null,{status:'done'});
  item('task','Cancelled work',at('-1 day'),null,{status:'cancelled'});
  item('task','Other assignee work',at('-1 day'),null,{actor:member});
  item('task','Foreign tenant work',at('-1 day'),null,{actor:otherOwner,scope:foreign});
  const current=occurrence('Deadline semantics proof');run(current.claim);
  assert.equal(json(current.execute).outcome,'executed');
  const readObservation=sample=>json(`SELECT detail->'weekly_commitment_observation'
    FROM paige_act_executions WHERE event_id=${literal(sample.eventId)} AND act_id=${literal(sample.actId)};`);
  const observation=readObservation(current);
  // --baseline-weekly-deadlines fails HERE against the real incumbent function.
  check('reminders never inflate overdue upcoming or undated work totals',()=>{
    assert.equal(observation.overdue_count,1);
    assert.equal(observation.due_next_week_count,1);
    assert.equal(observation.undated_count,1);
    assert.equal(observation.open_count,8);assert.equal(observation.blocked_count,1);
    assert.equal(observation.version,2);
    const reminder=observation.items.find(i=>i.id===futureReminder);
    assert.equal(reminder.due_at,null);assert(Number.isFinite(Date.parse(reminder.remind_at)));
    assert.equal(observation.items.filter(i=>i.kind==='reminder').length,4);
    assert(observation.items.some(i=>i.id===overdue));assert.equal(observation.items.length,8);
  });
  check('stored original v1 observation and original Rail survive migration and replay unchanged',()=>{
    assert.equal(json(original.read).outcome,'executed');assert.equal(json(original.execute).outcome,'executed');
    const after=json(`SELECT jsonb_build_object('detail',detail,'receipt',
      (SELECT to_jsonb(r) FROM paige_workspace_events r WHERE r.source_id=${literal(original.receipt)}))
      FROM paige_act_executions WHERE event_id=${literal(original.event)};`);
    assert.deepEqual(after,before);
  });
  check('fresh corrected observation is immutable after source changes lost acknowledgment and duplicate call',()=>{
    run(`UPDATE plan_items SET status='done',due_at=NULL WHERE id=ANY(ARRAY[${fixtures.map(literal).join(',')}]::uuid[]);`);
    assert.equal(json(current.read).outcome,'executed');assert.equal(json(current.execute).outcome,'executed');
    assert.deepEqual(readObservation(current),observation);
    assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE source_id=${literal(current.receiptId)};`),'1');
    const detail=json(`SELECT detail FROM paige_workspace_events WHERE source_id=${literal(current.receiptId)};`);
    assert(!JSON.stringify(detail).includes('Overdue work'));assert(!JSON.stringify(detail).includes('count'));
  });
  run(`DELETE FROM plan_items WHERE id=ANY(ARRAY[${fixtures.map(literal).join(',')}]::uuid[]);`);
  fixtures.length=0;
  const ordered=[];
  // Same genuine deadline: canonical UUID tie-breaking must survive the 50-row cap.
  const sameInstant=literal(run("SELECT now()+interval '1 day';"))+'::timestamptz';
  for(let n=0;n<51;n++)ordered.push(item('task','Bounded deadline '+n,sameInstant));
  const excludedReminder=item('reminder','Legacy date cannot displace genuine deadline',at('-100 days'),at('30 days'));
  const bounded=occurrence('Bounded deadline ordering proof');run(bounded.claim);
  assert.equal(json(bounded.execute).outcome,'executed');
  check('bounded source order uses real reminder time and deterministic original IDs',()=>{
    const result=readObservation(bounded);
    assert.equal(result.truncated,true);assert.equal(result.open_count,52);assert.equal(result.due_next_week_count,51);
    assert.equal(result.overdue_count,0);assert.equal(result.undated_count,0);
    assert.deepEqual(result.items.map(i=>i.id),ordered.sort().slice(0,50));
    assert(!result.items.some(i=>i.id===excludedReminder));
    assert.equal(json(bounded.read).receipt_id,bounded.receiptId);
  });
  check('replacement retains service-only execution and empty security-definer search path',()=>{
    const acl=json(`SELECT jsonb_build_object('definer',p.prosecdef,'settings',p.proconfig,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_proc p
      WHERE p.oid='execute_weekly_commitment_check(uuid,uuid,uuid,text,uuid)'::regprocedure;`);
    assert.deepEqual(acl,{definer:true,settings:['search_path=""'],anon:false,authenticated:false,service:true});
  });
  run(`DELETE FROM plan_items WHERE id=ANY(ARRAY[${fixtures.map(literal).join(',')}]::uuid[]);`);
  return {status:'PASS',migration,sha256:createHash('sha256').update(source(migration)).digest('hex'),
    historical_receipts_unchanged:true,external_effects:0};
}
