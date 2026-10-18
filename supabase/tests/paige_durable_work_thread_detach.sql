-- Run only in a disposable local fixture using scripts/proof/paige-durable-thread-detach.mjs.
-- All rows, temporary grants/policies and extra trigger bindings below roll back.
begin;
create temp table proof_assertions(label text primary key);
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if;
  insert into proof_assertions values(label);
end $$;
create function pg_temp.refuses(statement text,expected_state text,expected_message text,label text)
returns void language plpgsql as $$
declare refused boolean:=false;
begin
  begin execute statement;
  exception when others then
    if sqlstate<>expected_state or (expected_message is not null and sqlerrm<>expected_message) then raise; end if;
    refused:=true;
  end;
  perform pg_temp.ok(refused,label);
end $$;

insert into auth.users(id,aud,role,email) values
 ('d7b00000-0000-4000-8000-000000000001','authenticated','authenticated','test-tenant-a@tests.invalid'),
 ('d7b00000-0000-4000-8000-000000000002','authenticated','authenticated','test-tenant-b@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,features) values
 ('d7b00000-0000-4000-8000-000000000010','test-tenant-a','Test tenant A','active','standalone','TTA','{}'),
 ('d7b00000-0000-4000-8000-000000000011','test-tenant-b','Test tenant B','active','agency','TTB','{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('d7b00000-0000-4000-8000-000000000011','d7b00000-0000-4000-8000-000000000002','admin','active',false,now());
insert into public.paige_chat_threads(id,caller_user_id,tenant_id,lens,title,audience) values
 ('d7b00000-0000-4000-8000-000000000020','d7b00000-0000-4000-8000-000000000001','d7b00000-0000-4000-8000-000000000010','coach','Document fixture','workspace'),
 ('d7b00000-0000-4000-8000-000000000021','d7b00000-0000-4000-8000-000000000001','d7b00000-0000-4000-8000-000000000010','coach','Research fixture','workspace'),
 ('d7b00000-0000-4000-8000-000000000022','d7b00000-0000-4000-8000-000000000002','d7b00000-0000-4000-8000-000000000011','coach','Other workspace','workspace'),
 ('d7b00000-0000-4000-8000-000000000023','d7b00000-0000-4000-8000-000000000001','d7b00000-0000-4000-8000-000000000010','coach','Private fixture','customer_portal');
create function pg_temp.make_work(parent uuid,tenant uuid,actor uuid,kind text,capability text)
returns uuid language plpgsql as $$
declare work uuid;
begin
 select work_id into work from public.create_paige_durable_work(tenant,actor,gen_random_uuid(),parent,
   capability,kind,jsonb_build_object('tenant_id',tenant,'actor_user_id',actor),'test-scope',300,3);
 return work;
end $$;
create temp table proof_work(name text primary key,id uuid,before_row jsonb);
insert into proof_work(name,id) values
 ('document',pg_temp.make_work('d7b00000-0000-4000-8000-000000000020','d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000001','document_authoring','documents.author')),
 ('research',pg_temp.make_work('d7b00000-0000-4000-8000-000000000021','d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000001','research','research.deep')),
 ('other',pg_temp.make_work('d7b00000-0000-4000-8000-000000000022','d7b00000-0000-4000-8000-000000000011','d7b00000-0000-4000-8000-000000000002','document_authoring','documents.author'));
update public.paige_durable_work set request_payload='{"brief":"Neutral bounded input"}'
 where id in(select id from proof_work where name in('document','research'));
insert into public.marketing_content(work_id) select id from proof_work where name='document';
insert into public.paige_chat_turns(thread_id,work_id)
 select 'd7b00000-0000-4000-8000-000000000020',id from proof_work where name='document';
insert into public.research_runs(work_id) select id from proof_work where name='research';
update proof_work p set before_row=to_jsonb(w) from public.paige_durable_work w where w.id=p.id;

-- Intentionally first: the identical proof fails here against the incumbent trigger (22023).
delete from public.paige_chat_threads where id='d7b00000-0000-4000-8000-000000000020';
select pg_temp.ok(not exists(select 1 from public.paige_chat_threads where id='d7b00000-0000-4000-8000-000000000020'),'actual parent DELETE completes');
select pg_temp.ok((select w.thread_id is null and to_jsonb(w)-'thread_id'=p.before_row-'thread_id'
 from proof_work p join public.paige_durable_work w using(id) where p.name='document'),'FK SET NULL preserves every other durable column');
select pg_temp.ok((select count(*)=1 from public.marketing_content where work_id=(select id from proof_work where name='document')),
 'document artifact work correlation retained');
select pg_temp.ok(not exists(select 1 from public.paige_chat_turns where work_id=(select id from proof_work where name='document')),
 'existing transcript parent-delete CASCADE preserved');

-- A transaction rollback restores the parent and reference together.
savepoint parent_rollback;
delete from public.paige_chat_threads where id='d7b00000-0000-4000-8000-000000000021';
select pg_temp.ok((select thread_id is null from public.paige_durable_work where id=(select id from proof_work where name='research')),'temporary research detach');
rollback to parent_rollback;
select pg_temp.ok((select thread_id='d7b00000-0000-4000-8000-000000000021' from public.paige_durable_work where id=(select id from proof_work where name='research'))
 and exists(select 1 from public.paige_chat_threads where id='d7b00000-0000-4000-8000-000000000021'),'rollback restores parent and child reference');

do $$ declare work uuid:=(select id from proof_work where name='research'); mutation text; begin
 foreach mutation in array array[
   'thread_id=NULL',
   'thread_id=''d7b00000-0000-4000-8000-000000000022''',
   'thread_id=''d7b00000-0000-4000-8000-000000000099''',
   'id=gen_random_uuid()',
   'tenant_id=''d7b00000-0000-4000-8000-000000000011''',
   'initiating_user_id=''d7b00000-0000-4000-8000-000000000002''',
   'intent_id=gen_random_uuid()',
   'capability_key=''documents.author''',
   'work_kind=''document_authoring''',
   'authority_context=''{}''::jsonb',
   'scope_epoch=''another-scope''',
   'idempotency_key=''another-key''',
   'created_at=created_at+interval ''1 second''',
   'request_payload=''{}''::jsonb',
   'request_payload=NULL'
 ] loop
   perform pg_temp.refuses(format('update public.paige_durable_work set %s where id=%L',mutation,work),
     '22023','DURABLE_WORK_IDENTITY_IMMUTABLE','immutable live-parent '||mutation);
 end loop;
 perform pg_temp.refuses(format('update public.paige_durable_work set thread_id=%L where id=%L',
   'd7b00000-0000-4000-8000-000000000021',(select id from proof_work where name='document')),
   '22023','DURABLE_WORK_IDENTITY_IMMUTABLE','detached NULL cannot reparent');
end $$;

-- This fixture-only role can update child rows but cannot see ANY parent row. These grants
-- roll back and are not migration grants. A live hidden parent must still prevent detachment.
alter table public.paige_chat_threads enable row level security;
alter table public.paige_chat_threads force row level security;
grant usage on schema public to durable_hidden_parent_probe;
grant select on public.paige_chat_threads to durable_hidden_parent_probe;
grant select,update on public.paige_durable_work to durable_hidden_parent_probe;
create policy fixture_child_read on public.paige_durable_work for select to durable_hidden_parent_probe using(true);
create policy fixture_child_update on public.paige_durable_work for update to durable_hidden_parent_probe using(true) with check(true);
do $$ declare hidden_count integer; refused boolean:=false; begin
 set local role durable_hidden_parent_probe;
 select count(*) into hidden_count from public.paige_chat_threads;
 begin
   update public.paige_durable_work set thread_id=null
    where thread_id='d7b00000-0000-4000-8000-000000000021';
 exception when sqlstate '22023' then
   if sqlerrm<>'DURABLE_WORK_IDENTITY_IMMUTABLE' then raise; end if;
   refused:=true;
 end;
 reset role;
 perform pg_temp.ok(hidden_count=0 and refused,'RLS-hidden existing parent cannot authorize NULL detach');
end $$;

-- Even a future non-BYPASS owner must fail closed rather than read an RLS-filtered absence.
alter function public._paige_durable_work_protect_identity() owner to durable_hidden_parent_probe;
select pg_temp.refuses($q$update public.paige_durable_work set thread_id=null
 where thread_id='d7b00000-0000-4000-8000-000000000021'$q$,
 '42501','DURABLE_WORK_PARENT_VISIBILITY_REQUIRED','RLS-active definer owner fails closed');
alter function public._paige_durable_work_protect_identity() owner to postgres;

-- Extra bindings must never use the definer read as a reusable privileged trigger.
create temp table wrong_binding(id integer);
create trigger fixture_wrong_relation before update on wrong_binding for each row
 execute function public._paige_durable_work_protect_identity();
insert into wrong_binding values(1);
select pg_temp.refuses('update wrong_binding set id=2','22023','DURABLE_WORK_TRIGGER_BINDING_INVALID','wrong relation binding refused');
create trigger fixture_wrong_operation before insert on public.paige_durable_work for each row
 execute function public._paige_durable_work_protect_identity();
select pg_temp.refuses('insert into public.paige_durable_work default values','22023','DURABLE_WORK_TRIGGER_BINDING_INVALID','wrong operation binding refused');
drop trigger fixture_wrong_operation on public.paige_durable_work;
create trigger fixture_wrong_timing after update on public.paige_durable_work for each row
 execute function public._paige_durable_work_protect_identity();
select pg_temp.refuses('update public.paige_durable_work set safe_summary=''Safe fixture summary''','22023','DURABLE_WORK_TRIGGER_BINDING_INVALID','wrong timing binding refused');
drop trigger fixture_wrong_timing on public.paige_durable_work;
create function pg_temp.nested_detach() returns trigger language plpgsql as $$
begin
 update public.paige_durable_work set thread_id=null
  where thread_id='d7b00000-0000-4000-8000-000000000021';
 return new;
end $$;
create temp table nested_detach(id integer);
insert into nested_detach values(1);
create trigger fixture_nested before update on nested_detach for each row execute function pg_temp.nested_detach();
select pg_temp.refuses('update nested_detach set id=2','22023','DURABLE_WORK_IDENTITY_IMMUTABLE','nested trigger depth does not authorize detach');

-- Unrelated changes and the existing one-time NULL payload attachment still work.
update public.paige_durable_work set safe_summary='Safe fixture summary',version=version+1
 where id=(select id from proof_work where name='research');
select pg_temp.ok((select safe_summary='Safe fixture summary' and version=2 from public.paige_durable_work
 where id=(select id from proof_work where name='research')),'unrelated update retained');
update public.paige_durable_work set request_payload='{"brief":"First attachment"}' where id=(select id from proof_work where name='other');
select pg_temp.ok((select request_payload->>'brief'='First attachment' from public.paige_durable_work
 where id=(select id from proof_work where name='other')),'first bounded payload attachment allowed');
select pg_temp.refuses(format('update public.paige_durable_work set request_payload=null where id=%L',(select id from proof_work where name='other')),
 '22023','DURABLE_WORK_IDENTITY_IMMUTABLE','first attachment then immutable');

-- Existing creator authority: own two cohorts succeed above; foreign actor/tenant/thread/private
-- audience cannot be adopted. The new trigger is not an authorization source.
select pg_temp.refuses($q$select pg_temp.make_work('d7b00000-0000-4000-8000-000000000022','d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000001','research','research.deep')$q$,
 '42501','DURABLE_WORK_THREAD_FORBIDDEN','foreign thread refused by unchanged creator');
select pg_temp.refuses($q$select pg_temp.make_work(null,'d7b00000-0000-4000-8000-000000000011','d7b00000-0000-4000-8000-000000000001','research','research.deep')$q$,
 '42501','DURABLE_WORK_INITIATOR_FORBIDDEN','foreign tenant membership refused');
select pg_temp.refuses($q$select pg_temp.make_work(null,'d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000002','research','research.deep')$q$,
 '42501','DURABLE_WORK_INITIATOR_FORBIDDEN','foreign actor refused');
select pg_temp.refuses($q$select pg_temp.make_work('d7b00000-0000-4000-8000-000000000023','d7b00000-0000-4000-8000-000000000010','d7b00000-0000-4000-8000-000000000001','research','research.deep')$q$,
 '42501','DURABLE_WORK_THREAD_FORBIDDEN','private customer audience refused');

-- Real role entrypoints keep their existing ACLs, including service-only adoption.
do $$ declare r text; table_denied boolean; trigger_denied boolean; begin
 foreach r in array array['anon','authenticated','service_role'] loop
  table_denied:=false; trigger_denied:=false;
  execute format('set local role %I',r);
  begin perform 1 from public.paige_durable_work; exception when insufficient_privilege then table_denied:=true; end;
  begin perform public._paige_durable_work_protect_identity(); exception when insufficient_privilege then trigger_denied:=true; end;
  reset role;
  perform pg_temp.ok(table_denied,r||' actual raw read denied');
  perform pg_temp.ok(trigger_denied,r||' actual direct trigger call denied');
 end loop;
end $$;
do $$ declare adopted uuid; denied boolean:=false; begin
 set local role authenticated;
 begin perform public.create_paige_durable_work(null,null,null,null,null,null,null,null);
 exception when insufficient_privilege then denied:=true; end;
 reset role;
 perform pg_temp.ok(denied,'authenticated cannot directly adopt durable work');
 set local role service_role;
 select work_id into adopted from public.create_paige_durable_work(
  'd7b00000-0000-4000-8000-000000000011','d7b00000-0000-4000-8000-000000000002',gen_random_uuid(),
  'd7b00000-0000-4000-8000-000000000022','research.deep','research',
  '{"tenant_id":"d7b00000-0000-4000-8000-000000000011","actor_user_id":"d7b00000-0000-4000-8000-000000000002"}',
  'test-service-scope',300,3);
 reset role;
 perform pg_temp.ok(adopted is not null,'existing service creator accepts legitimate second cohort');
end $$;

select work_status from public.transition_paige_durable_work(
 (select id from proof_work where name='research'),
 (select w.idempotency_key from public.paige_durable_work w join proof_work p using(id) where p.name='research'),
 'succeeded','{"verified_readback":true,"fixture_result":"bounded"}', 'Verified fixture result');
update proof_work p set before_row=to_jsonb(w) from public.paige_durable_work w where p.id=w.id and p.name='research';
select pg_temp.ok((select status='succeeded' and terminal_outcome->>'verified_readback'='true'
 from public.paige_durable_work where id=(select id from proof_work where name='research')),'existing verified terminal transition works');

-- Both remaining workspace parents can be deleted in one statement. Domain rows survive.
delete from public.paige_chat_threads where id in('d7b00000-0000-4000-8000-000000000021','d7b00000-0000-4000-8000-000000000022');
select pg_temp.ok((select bool_and(thread_id is null) from public.paige_durable_work where id in(select id from proof_work)),'multi-parent FK detach completes');
select pg_temp.ok((select count(*)=1 from public.research_runs where work_id=(select id from proof_work where name='research')),'research correlation survives deletion');
select pg_temp.ok((select authority_context=p.before_row->'authority_context' and intent_id=(p.before_row->>'intent_id')::uuid
 and idempotency_key=p.before_row->>'idempotency_key' and request_payload=p.before_row->'request_payload'
 from proof_work p join public.paige_durable_work w using(id) where p.name='research'),'research immutable context and payload retained');
select pg_temp.ok((select to_jsonb(w)-'thread_id'=p.before_row-'thread_id'
 from proof_work p join public.paige_durable_work w using(id) where p.name='research'),'verified terminal result unchanged by parent deletion');

-- Lifecycle policy is intentionally unchanged: actor and tenant RESTRICT are not solved here.
select pg_temp.refuses($q$delete from auth.users where id='d7b00000-0000-4000-8000-000000000001'$q$,
 '23503',null,'existing actor deletion restriction retained');
select pg_temp.refuses($q$delete from public.tenants where id='d7b00000-0000-4000-8000-000000000010'$q$,
 '23503',null,'existing tenant deletion restriction retained');

do $$ declare actor_role text; privilege text; begin
 foreach actor_role in array array['anon','authenticated','service_role'] loop
   perform pg_temp.ok(not has_function_privilege(actor_role,'public._paige_durable_work_protect_identity()','execute'),
     actor_role||' has no direct identity-trigger execute grant');
   foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
     perform pg_temp.ok(not has_table_privilege(actor_role,'public.paige_durable_work',privilege),
       actor_role||' retains no raw '||privilege||' grant');
   end loop;
 end loop;
end $$;
select 'DURABLE_THREAD_DETACH_PASS='||count(*) from proof_assertions;
rollback;
