import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';

/** Extends the EXISTING disposable native PostgreSQL proof. Real process/acts,
 * foreign keys, native writer and Rail; inherited auth/context/provider doubles.
 * This is engineering evidence, never a deployed or authenticated customer claim. */
export async function automationDraftAtomicProof({run,json,literal,source,check,refuses,concurrent}) {
  const file='supabase/migrations/20271133000033_exp05_atomic_automation_draft.sql';
  const before=run('select count(*) from paige_native_events;');
  const owner=randomUUID(),admin=randomUUID(),member=randomUUID(),other=randomUUID();
  const tenant=randomUUID(),foreign=randomUUID(),request=randomUUID();
  const ctx={actor:owner,tenant,role:'authenticated'};
  const draft={name:'Neutral onboarding draft',trigger_key:'manual.run_now',steps:[{tool_key:'crm_create_task',config:{title:'Review original membership',optional:null}}]};
  const sql=(id=request,args=draft,fn='save_automation_draft',tid=tenant)=>
    `select public.${fn}(${literal(id)},${literal(tid)},${literal(JSON.stringify(args))}::jsonb);`;
  // Extend only infrastructure fields missing from this existing selected-schema
  // fixture. No production user, token, role, tenant or provider is created.
  run(`alter table auth.users add column if not exists deleted_at timestamptz,add column if not exists banned_until timestamptz;
    alter table tenants add column if not exists status text default 'active';
    alter table paige_automations add column if not exists owner_task_armed_at timestamptz;
    do $$ begin if to_regprocedure('auth.jwt()') is null then
      execute 'create function auth.jwt() returns jsonb language sql stable as $f$ select jsonb_build_object(''role'',current_setting(''role'')) $f$';
    end if; end $$;
    insert into auth.users(id) values${[owner,admin,member,other].map(x=>`(${literal(x)})`).join(',')};`);
  run(`insert into tenants(id,name,status) values(${literal(tenant)},'test-tenant-draft','active'),(${literal(foreign)},'test-tenant-other-draft','active');
    insert into profiles(id,user_id,active_tenant_id) values${[owner,admin,member].map(x=>`(${literal(x)},${literal(x)},${literal(tenant)})`).join(',')},(${literal(other)},${literal(other)},${literal(foreign)});
    insert into tenant_members values(${literal(tenant)},${literal(owner)},'owner','active'),(${literal(tenant)},${literal(admin)},'admin','active'),
      (${literal(tenant)},${literal(member)},'member','active'),(${literal(foreign)},${literal(other)},'owner','active');`);
  check('atomic draft baseline has no callable writer',()=>refuses(sql(),ctx,'42883'));
  const migration=source(file);run(migration);
  const first=json(sql(),ctx);
  check('atomic draft saves exact original process/acts and one original receipt',()=>{
    assert.equal(first.phase,'saved');assert.equal(first.automation_id,request);assert(first.receipt_id);
    assert.equal(first.state,'draft');assert.equal(first.granted_lane,'confirm');assert.equal(first.execution_started,false);
    assert.equal(run(`select count(*) from paige_automation_acts where automation_id=${literal(request)};`),'1');
  });
  check('lost acknowledgment reads the same record/receipt without creating anything',()=>{
    assert.deepEqual(json(sql(request,draft,'read_automation_draft'),ctx),first);
    assert.deepEqual(json(sql(),ctx),first);
    assert.equal(run(`select count(*) from paige_workspace_events where source_id=${literal(request)} and capability_key='automation_draft';`),'1');
  });
  const race=randomUUID(),raceDraft={...draft,name:'Neutral concurrent onboarding draft'};
  const raced=(await concurrent(sql(race,raceDraft),ctx)).map(JSON.parse);
  check('six concurrent saves yield the same one process and receipt',()=>{
    assert(raced.every(r=>r.phase==='saved'&&r.automation_id===race&&r.receipt_id===raced[0].receipt_id));
    assert.equal(run(`select count(*) from paige_automations where id=${literal(race)};`),'1');
    assert.equal(run(`select count(*) from paige_workspace_events where source_id=${literal(race)};`),'1');
  });
  const heldId=randomUUID(),heldName='exp05-atomic-draft-mutex';
  const held=concurrent(`begin;set application_name='${heldName}';
    select pg_advisory_xact_lock(hashtextextended(${literal(tenant+':'+heldId)},1005));select pg_sleep(6);commit;`,{},1);
  let holderReady=false;
  for(let n=0;n<25;n++){
    holderReady=run(`select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='${heldName}' and wait_event='PgSleep');`)==='t';
    if(holderReady)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert(holderReady,'Original mutex holder reached its finite wait');
  try {check('a held request mutex times out natively and releases the Auth row without a save',()=>{
    assert(run("select proconfig::text from pg_proc where oid='public.save_automation_draft(uuid,uuid,jsonb)'::regprocedure;").includes('lock_timeout=3s'));
    refuses(sql(heldId,{...draft,name:'Bounded held request'}),ctx,'55P03');
    run(`set lock_timeout='500ms';update auth.users set banned_until=null where id=${literal(owner)};`);
    assert.equal(run(`select count(*) from paige_automations where id=${literal(heldId)};`),'0');
  });}finally{await held;}
  check('same request with changed content never overwrites or creates a process',()=>{
    assert.equal(json(sql(request,{...draft,name:'Different unapproved name'}),ctx).phase,'changed');
    assert.equal(json(sql(),ctx).phase,'saved');
  });
  check('name conflict cannot adopt or edit an existing operation',()=>{
    refuses(sql(randomUUID()),ctx,'23505');assert.equal(json(sql(),ctx).receipt_id,first.receipt_id);
  });
  check('ordinary edits cannot relabel the original receipt as proof of different content',()=>{
    run(`update paige_automations set name='Edited after save' where id=${literal(request)};`,ctx);
    const changed={...draft,name:'Edited after save'};
    assert.equal(json(sql(request,changed,'read_automation_draft'),ctx).phase,'saved_unreceipted');
    assert.equal(json(sql(request,changed),ctx).phase,'saved_unreceipted');
    run(`update paige_automations set name=${literal(draft.name)} where id=${literal(request)};`,ctx);
    assert.equal(json(sql(),ctx).receipt_id,first.receipt_id);
  });
  check('a rejected later act atomically rolls back the process and all earlier acts',()=>{
    const id=randomUUID();refuses(sql(id,{...draft,name:'Rejected second act',steps:[...draft.steps,{action_kind:'missing.test.kind'}]}),ctx,'23503');
    assert.equal(run(`select count(*) from paige_automations where id=${literal(id)};`),'0');
    assert.equal(run(`select count(*) from paige_automation_acts where automation_id=${literal(id)};`),'0');
    assert.equal(run(`select count(*) from paige_workspace_events where source_id=${literal(id)};`),'0');
  });
  check('receipt refusal rolls back the entire save, never saved without evidence',()=>{
    const id=randomUUID();run(`create function public.test_draft_receipt_refusal() returns trigger language plpgsql as $$ begin
      if new.source_id=${literal(id)}::uuid then raise exception 'TEST_RAIL_REFUSAL' using errcode='40001'; end if;return new;end $$;
      create trigger test_draft_receipt_refusal before insert on paige_workspace_events for each row execute function public.test_draft_receipt_refusal();`);
    try {refuses(sql(id,{...draft,name:'Receipt failure'}),ctx,'40001');
      assert.equal(run(`select count(*) from paige_automations where id=${literal(id)};`),'0');
    } finally {run('drop trigger test_draft_receipt_refusal on paige_workspace_events;drop function public.test_draft_receipt_refusal();');}
  });
  check('member, foreign context, anonymous and service cannot author this draft',()=>{
    refuses(sql(),{...ctx,actor:member});refuses(sql(),{actor:other,tenant:foreign,role:'authenticated'});
    refuses(sql(),{...ctx,role:'anon'});refuses(sql(),{...ctx,role:'service_role'});
  });
  check('foreign owner cannot read the original process through a guessed operation ID',()=>{
    assert.equal(json(sql(request,draft,'read_automation_draft',foreign),{actor:other,tenant:foreign,role:'authenticated'}).phase,'absent');
  });
  check('workspace switch and role revocation invalidate the original authority',()=>{
    run(`update profiles set active_tenant_id=${literal(foreign)} where user_id=${literal(owner)};`);
    refuses(sql(),ctx);run(`update profiles set active_tenant_id=${literal(tenant)} where user_id=${literal(owner)};`);
    run(`update tenant_members set status='inactive' where tenant_id=${literal(tenant)} and user_id=${literal(owner)};`);
    refuses(sql(),ctx);run(`update tenant_members set status='active' where tenant_id=${literal(tenant)} and user_id=${literal(owner)};`);
  });
  check('ordinary admin can save their own draft, without adopting another actor result',()=>{
    assert.equal(json(sql(randomUUID(),{...draft,name:'Neutral admin draft'}),{...ctx,actor:admin}).phase,'saved');
    assert.equal(json(sql(request,draft,'read_automation_draft'),{...ctx,actor:admin}).phase,'absent');
    refuses(sql(),{...ctx,actor:admin});
  });
  for(const [label,args] of [
    ['no steps',{...draft,steps:[]}],['too many steps',{...draft,steps:Array.from({length:21},()=>draft.steps[0])}],
    ['unknown trigger',{...draft,trigger_key:'missing.trigger'}],['activation fields',{...draft,state:'live'}],
    ['ambiguous step',{...draft,steps:[{tool_key:'crm_create_task',action_kind:'owner.task'}]}],
    ['specialized weekly writer bypass',{...draft,trigger_key:'schedule.weekly_commitment_check'}],
  ]) check(`atomic draft rejects ${label}`,()=>refuses(sql(randomUUID(),args),ctx,'22023'));
  check('no event, provider, recurring activation or duplicate ledger is created',()=>{
    assert.equal(run('select count(*) from paige_native_events;'),before);
    assert.equal(run(`select count(*) from paige_automations where tenant_id=${literal(tenant)} and (state<>'draft' or granted_lane<>'confirm' or owner_task_armed_at is not null);`),'0');
  });
  return {status:'PASS',migration:file,sha256:createHash('sha256').update(migration).digest('hex'),
    boundary:'existing disposable native PostgreSQL proof; actual writer/FKs/Rail, inherited identity/context/display ports; production and two-chat proof owed'};
}
