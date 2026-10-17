// Cases only, invoked by the incumbent native proof's owned disposable fixture.
// No connection/bootstrap, production access, alternate engine or runtime writer.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

export async function proveOwnerTaskApprovalVisibility(c) {
  const {sql,text,fn,held,control,actor,tenant,other,human,check,refuses,id,literal,json,exe,args,database}=c;
  const old=text('supabase/migrations/20260628013834_d790fe45-ba03-445b-bb94-6373e77f9f0b.sql');
  const policies=old.slice(old.indexOf('CREATE POLICY "Approvals read scoped"'),old.indexOf('-- Notifications:'));
  const tenantPolicy=text('supabase/migrations/20260629180214_a9cbc642-8f6b-455c-be67-fb7f5fb153f4.sql')
    .match(/CREATE POLICY tenant_isolation ON public\.%I[\s\S]*?\n        \)/)[0].replace('%I','paige_pending_approvals');
  const view=text('supabase/migrations/20270519010000_contact_methods_dependents.sql').match(/CREATE OR REPLACE VIEW public\.paige_approval_queue_v[\s\S]*?;/)[0];
  sql(`create table user_roles(user_id uuid,role text);create table client_contact_methods(client_id uuid,value text,kind text,is_primary boolean,position integer);
    create function is_platform_owner(uuid)returns boolean language sql as $$select false$$;
    create function update_updated_at_column()returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create trigger approval_touch before update on paige_pending_approvals for each row execute function update_updated_at_column();`+
    fn('20260628013834_d790fe45-ba03-445b-bb94-6373e77f9f0b.sql','has_any_role',true)+
    fn('20260628013834_d790fe45-ba03-445b-bb94-6373e77f9f0b.sql','current_user_roles',true)+
    fn('20270303000000_paige_orchestration_companion_minting.sql','paige_sync_orchestration_act_on_decision')+
    `create trigger decision_cancel after update of status on paige_pending_approvals for each row execute function paige_sync_orchestration_act_on_decision();
    alter table paige_pending_approvals enable row level security;`+policies+tenantPolicy+';'+view+
    'grant select,insert,update on paige_pending_approvals to authenticated;grant select on clients,client_contact_methods,paige_approval_queue_v to authenticated;');
  let number=60000;
  const fresh=()=>{const f=held(number);number+=20;return{f,id:sql(`select id from paige_pending_approvals where metadata->>'act_execution_id'='${f.row.id}';`)};};
  const x=fresh(),read=(approval=x.id,who=actor,table='paige_approval_queue_v')=>sql(human(who)+`select count(*)from ${table} where id='${approval}';`);
  const {stableRunId}=await import('../../supabase/functions/_shared/capability-record.ts');
  const {actReceiptRunSeed}=await import('../../supabase/functions/_shared/paige-orchestration/outcomes.ts');
  const executionRunId=await stableRunId(actReceiptRunSeed(x.f.event,x.f.act));
  const decision=approval=>JSON.parse(sql(`select to_jsonb(a)from paige_pending_approvals a where id='${approval}';`));
  const statement=(approval=x.id,version=decision(approval).updated_at,reason='Needs correction',who=actor)=>human(who)+
    `select decline_owner_task_approval('${approval}',${literal(version)}::timestamptz,${literal(reason)})::text;`;
  const decline=(...a)=>JSON.parse(sql(statement(...a)));
  const columns=()=>sql("select string_agg(attname,','order by attnum)from pg_attribute where attrelid='paige_approval_queue_v'::regclass and attnum>0 and not attisdropped;");
  const viewMeta=()=>sql("select relowner::text||':'||coalesce(relacl::text,'')||':'||reloptions::text from pg_class where oid='paige_approval_queue_v'::regclass;");
  const existingPolicies=()=>sql("select coalesce(jsonb_agg(to_jsonb(p)order by policyname),'[]')from pg_policies p where tablename='paige_pending_approvals'and policyname<>'Native owner task seat read';");
  const before={columns:columns(),view:viewMeta(),policies:existingPolicies()};
  if(!process.argv.includes('--baseline-owner-task-approval-visibility'))sql(text('supabase/migrations/20271109025000_owner_task_approval_visibility.sql'));
  check('ZERO-global-role ordinary owner reads exact native task through actual RLS and security_invoker queue',()=>{
    assert.equal(sql('select count(*)from user_roles;'),'0');assert.equal(read(),'1');assert.equal(read(x.id,actor,'paige_pending_approvals'),'1');
  });
  check('view appends only real updated_at; every existing column/order/owner/grant/security_invoker/policy survives',()=>{
    assert.equal(columns(),before.columns+',updated_at');assert.equal(viewMeta(),before.view);assert.equal(existingPolicies(),before.policies);
  });
  check('ordinary active admin reads native task without global-role mapping',()=>{assert.equal(read(x.id,other),'1');assert.equal(sql('select count(*)from user_roles;'),'0');});
  check('new ABIs are authenticated-only postgres definers with empty search_path',()=>{
    for(const abi of ['can_read_owner_task_approval(uuid)','decline_owner_task_approval(uuid,timestamptz,text)']){
      assert.equal(sql(`select has_function_privilege('authenticated','public.${abi}','execute');`),'t');
      for(const role of ['anon','service_role'])assert.equal(sql(`select has_function_privilege('${role}','public.${abi}','execute');`),'f');
      const p=JSON.parse(sql(`select json_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig)from pg_proc where oid='public.${abi}'::regprocedure;`));
      assert.equal(p.owner,'postgres');assert.equal(p.definer,true);assert.deepEqual(p.config,['search_path=""']);
    }
  });
  for(const [label,mutation,restore]of[
    ['member',`update tenant_members set role='member'where user_id='${actor}'`,`update tenant_members set role='owner'where user_id='${actor}'`],
    ['coach',`update tenant_members set role='coach'where user_id='${actor}'`,`update tenant_members set role='owner'where user_id='${actor}'`],
    ['inactive',`update tenant_members set status='suspended'where user_id='${actor}'`,`update tenant_members set status='active'where user_id='${actor}'`],
    ['workspace-switch',`update profiles set active_tenant_id='${other}'where user_id='${actor}'`,`update profiles set active_tenant_id='${tenant}'where user_id='${actor}'`],
    ['deleted-identity',`update auth.users set deleted_at=now()where id='${actor}'`,`update auth.users set deleted_at=null where id='${actor}'`],
    ['banned-identity',`update auth.users set banned_until=now()+interval '1 day'where id='${actor}'`,`update auth.users set banned_until=null where id='${actor}'`],
  ])check(label+' cannot read queue/base or decline',()=>{sql(mutation+';');try{
    assert.equal(read(),'0');assert.equal(read(x.id,actor,'paige_pending_approvals'),'0');refuses(statement(),'OWNER_TASK_APPROVAL_FORBIDDEN');
  }finally{sql(restore+';');}assert.equal(decision(x.id).status,'pending');});
  const foreign=id(69000);sql(`insert into auth.users(id)values('${foreign}');insert into tenants(id,status)values('${foreign}','active');
    insert into profiles values('${foreign}','${foreign}');insert into tenant_members(tenant_id,user_id,role,status)values('${foreign}','${foreign}','owner','active');`);
  check('foreign ordinary owner and exact missing ID disclose no held record',()=>{
    assert.equal(read(x.id,foreign),'0');assert.equal(read(id(69999)),'0');refuses(statement(x.id,undefined,'Foreign',foreign),'OWNER_TASK_APPROVAL_FORBIDDEN');
  });
  check('owner has no broad direct UPDATE and no unrelated approval visibility/decline',()=>{
    const a=id(69001);sql(`insert into paige_pending_approvals(id,type,category,tenant_id,source,status,metadata)values('${a}','comms_draft','email','${tenant}','conversation','pending','{}');`);
    assert.equal(read(a),'0');refuses(statement(a),'OWNER_TASK_APPROVAL_FORBIDDEN');
    assert.equal(sql(human(actor)+`with changed as(update paige_pending_approvals set status='rejected'where id='${x.id}'returning id)select count(*)from changed;`),'0');assert.equal(decision(x.id).status,'pending');
  });
  // Explicit superuser fixture corruption bypasses BOTH incumbent coordinate
  // and display guards only locally; production triggers remain unchanged.
  const corrupt=(field,value)=>sql(`alter table paige_pending_approvals disable trigger paige_owner_task_approval_context;
    alter table paige_pending_approvals disable trigger approval_guard;
    update paige_pending_approvals set ${field}=${value} where id='${x.id}';
    alter table paige_pending_approvals enable trigger approval_guard;alter table paige_pending_approvals enable trigger paige_owner_task_approval_context;`);
  for(const [label,field,value]of[
    ['spoofed display','summary',"'Unbound task'"],['missing companion','metadata',"'{}'::jsonb"],
    ['forged capability','metadata',"jsonb_set(metadata,'{capability_id}','\"other.capability\"')"],
    ['foreign companion','metadata',`jsonb_set(metadata,'{act_execution_id}',to_jsonb('${foreign}'::text))`],
  ])check(label+' denied by native RLS despite client hints',()=>{const before=decision(x.id);corrupt(field,value);try{assert.equal(read(),'0');refuses(statement(),'OWNER_TASK_APPROVAL_FORBIDDEN');}
    finally{corrupt(field,field==='summary'?literal(before.summary):json(before.metadata));}});
  check('duplicate companion fails closed under explicitly local unique-index corruption',()=>{
    const a=id(69002);sql(`drop index approval_occurrence;insert into paige_pending_approvals select (jsonb_populate_record(null::paige_pending_approvals,to_jsonb(a)||jsonb_build_object('id','${a}'))).* from paige_pending_approvals a where id='${x.id}';`);
    try{assert.equal(read(),'0');refuses(statement(),'OWNER_TASK_APPROVAL_FORBIDDEN');}finally{sql(`delete from paige_pending_approvals where id='${a}';create unique index approval_occurrence on paige_pending_approvals((metadata->>'event_id'),(metadata->>'act_id'))where source='paige_orchestration';`);}
  });
  check('paused stale hold remains readable/rejectable: one cancellation plus truthful existing Rail, zero tasks',()=>{
    assert.notEqual(x.id,executionRunId);assert.equal(sql(`select count(*)from paige_workspace_events where source_kind='capability_run'and source_id='${executionRunId}';`),'0');
    control(x.f.process,'pause');assert.equal(read(),'1');const tasks=sql('select count(*)from tasks;');const r=decline();
    assert.equal(r.status,'rejected');assert.equal(r.act_outcome,'cancelled');assert.equal(r.receipt_recorded,true);assert.equal(r.replayed,false);assert.equal(r.reviewed_by_user_id,actor);
    const rail=JSON.parse(sql(`select to_jsonb(e)from paige_workspace_events e where id='${r.receipt_id}';`));assert.equal(rail.source_id,x.id);assert.equal(rail.capability_key,'crm_create_task');
    assert.equal(rail.outcome,'capability_refused');assert.equal(rail.detail.reason,'owner_declined');assert.equal(JSON.stringify(rail).includes('Needs correction'),false);assert.equal(sql('select count(*)from tasks;'),tasks);
    assert.equal(sql(`select count(*)from paige_workspace_events where source_kind='capability_run'and source_id='${executionRunId}';`),'0');
  });
  check('repeat by another reviewer returns original actor/reason/receipt/version without mutation or reemit',()=>{
    const before=decision(x.id),rails=sql(`select count(*)from paige_workspace_events where source_id='${x.id}';`),r=decline(x.id,'1900-01-01','Different reason',other);
    assert.equal(r.replayed,true);assert.equal(r.reviewed_by_user_id,actor);assert.equal(r.decision_rationale,'Needs correction');assert.deepEqual(decision(x.id),before);assert.equal(sql(`select count(*)from paige_workspace_events where source_id='${x.id}';`),rails);
  });
  check('stale/null/infinite versions and blank/oversized reasons cannot decide current pending hold',()=>{
    const a=fresh(),before=decision(a.id);for(const v of ['1900-01-01',null,'infinity'])refuses(statement(a.id,v),'OWNER_TASK_APPROVAL_CHANGED');
    for(const reason of ['', ' ', 'x'.repeat(2001)])refuses(statement(a.id,before.updated_at,reason),'OWNER_TASK_DECLINE_REASON_INVALID');assert.deepEqual(decision(a.id),before);
  });
  for(const [label,mutate]of[
    ['claimed',a=>`update paige_pending_approvals set claimed_at=now()where id='${a.id}';`],
    ['accepted',a=>`select paige_approve_act_execution('${a.f.event}','${a.f.act}','${actor}');`],
    ['uncertain',a=>`select paige_approve_act_execution('${a.f.event}','${a.f.act}','${actor}');update paige_act_executions set outcome='ambiguous'where id='${a.f.row.id}';`],
    ['dispatched',a=>`update paige_act_executions set dispatched_at=now()where id='${a.f.row.id}';`],
  ])check(label+' cannot be rejected by retry',()=>{const a=fresh();sql(mutate(a));const before=decision(a.id);refuses(statement(a.id),'OWNER_TASK_APPROVAL_CHANGED');assert.deepEqual(decision(a.id),before);});
  check('receipt insertion failure rolls review and cancellation back atomically',()=>{
    const a=fresh(),before=decision(a.id);sql(`create function decline_fixture_receipt_failure()returns trigger language plpgsql as $$begin raise exception 'fixture decline receipt refused'using errcode='23514';end$$;
      create trigger decline_fixture_receipt_failure before insert on paige_workspace_events for each row execute function decline_fixture_receipt_failure();`);
    try{refuses(statement(a.id),'fixture decline receipt refused');}finally{sql('drop trigger decline_fixture_receipt_failure on paige_workspace_events;drop function decline_fixture_receipt_failure();');}
    assert.deepEqual(decision(a.id),before);assert.equal(sql(`select outcome from paige_act_executions where id='${a.f.row.id}';`),'approval_pending');
  });
  check('colliding wrong Rail identity never yields a false receipt and rolls back cancellation',()=>{
    const a=fresh(),before=decision(a.id);sql(`insert into paige_workspace_events(tenant_id,source_kind,source_id,source_revision,outcome,capability_key)values('${tenant}','capability_run','${a.id}',0,'capability_refused','wrong_key');`);
    refuses(statement(a.id),'OWNER_TASK_DECLINE_RECEIPT_UNCONFIRMED');assert.deepEqual(decision(a.id),before);assert.equal(sql(`select outcome from paige_act_executions where id='${a.f.row.id}';`),'approval_pending');
  });
  for(const label of ['approval','act']){
    const a=fresh(),before=decision(a.id),peer=spawn(exe('psql'),args(database),{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
    peer.stdout.on('data',d=>{out+=d;});peer.stderr.on('data',d=>{err+=d;});const closed=new Promise((yes,no)=>{peer.on('error',no);peer.on('exit',code=>code===0?yes():no(Error(err)));});
    try{peer.stdin.write(`begin;select 1 from ${label==='approval'?'paige_pending_approvals':'paige_act_executions'} where id='${label==='approval'?a.id:a.f.row.id}'for update;select 'DECLINE_LOCKED';\n`);
      for(let n=0;!out.includes('DECLINE_LOCKED')&&n<150;n++)await new Promise(yes=>setTimeout(yes,20));assert.ok(out.includes('DECLINE_LOCKED'),err);
      check('two sessions: '+label+' contention refuses decline with zero partial decision',()=>{refuses(statement(a.id),'could not obtain lock');assert.deepEqual(decision(a.id),before);});
    }finally{peer.stdin.end('rollback;\n');await closed;}
  }
  const race=fresh(),version=decision(race.id).updated_at;
  const results=await Promise.all(Array.from({length:8},(_,i)=>new Promise((yes,no)=>{
    const peer=spawn(exe('psql'),[...args(database),'-c',statement(race.id,version,'Reviewed decline',i%2?actor:other)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>peer.kill(),30000);peer.stdout.on('data',d=>{out+=d;});peer.stderr.on('data',d=>{err+=d;});peer.on('error',no);
    peer.on('exit',code=>{clearTimeout(timer);yes({code,out,err});});
  })));
  check('eight actual concurrent decisions produce one rejection/receipt; others are original-result replay or lock refusal',()=>{
    const success=results.filter(r=>r.code===0).map(r=>JSON.parse(r.out));assert.ok(success.length>=1);assert.equal(success.filter(r=>!r.replayed).length,1);
    for(const failure of results.filter(r=>r.code!==0))assert.match(failure.err,/could not obtain lock/);
    assert.equal(new Set(success.map(r=>r.receipt_id)).size,1);assert.equal(new Set(success.map(r=>r.reviewed_by_user_id)).size,1);
    assert.equal(sql(`select count(*)from paige_workspace_events where source_id='${race.id}'and outcome='capability_refused';`),'1');
    assert.equal(sql(`select outcome from paige_act_executions where id='${race.f.row.id}';`),'cancelled');
  });
}
