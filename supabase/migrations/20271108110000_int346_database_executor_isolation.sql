-- INT-346: explicit database-isolation alternative for the legacy interactive
-- ownership/handoff defect. No automatic activation or provider-cessation claim.
-- Existing native domain authorization, receipts and unknown-effect brakes remain.
begin;

alter table public.paige_chat_threads add column if not exists interactive_admitted_intent uuid;
alter table public.paige_chat_interactive_rollout
 add column if not exists legacy_admission_closed_at timestamptz,
 add column if not exists retirement_method text check (retirement_method in ('provider_cessation','database_executor_isolation'));

create or replace function public.paige_chat_interactive_columns_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if current_user <> 'postgres' and (new.interactive_latest_intent is not null or new.interactive_executor_intent is not null
    or new.interactive_admission is not null or new.interactive_admitted_intent is not null) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
  end if; return new;
 end if;
 if current_user <> 'postgres' and (new.interactive_latest_intent is distinct from old.interactive_latest_intent
   or new.interactive_executor_intent is distinct from old.interactive_executor_intent
   or new.interactive_admission is distinct from old.interactive_admission
   or new.interactive_admitted_intent is distinct from old.interactive_admitted_intent) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
 end if; return new;
end $$;
revoke all on function public.paige_chat_interactive_columns_guard() from public;

-- Backfill only matching server-issued ordinary pending admissions.
-- Unissued legacy JSON and unknown bound answers confer no lineage.
update public.paige_chat_threads t set interactive_admitted_intent=t.interactive_latest_intent
where t.interactive_admitted_intent is null and t.interactive_latest_intent is not null
 and exists(select 1 from public.paige_chat_turns u where u.thread_id=t.id and u.role='user'
  and u.interactive_intent_id=t.interactive_latest_intent and u.interactive_actor_id=t.caller_user_id
  and u.interactive_tenant_id is not distinct from t.tenant_id);

create or replace function public.paige_chat_interactive_begin_v2(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false,p_effectful boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; turn_id uuid; evidence jsonb;
begin
 if p_effectful is null then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 perform 1 from public.paige_chat_interactive_rollout where singleton for share;
 -- Admission class is fixed by rollout state: while staged only non-effectful
 -- conversation may be admitted; once active only protected effectful work.
 if p_stop is not true and coalesce((select active from public.paige_chat_interactive_rollout where singleton),false)
   and not p_effectful then raise exception 'INTERACTIVE_PROTOCOL_REQUIRED'; end if;
 if p_stop is not true and not coalesce((select active from public.paige_chat_interactive_rollout where singleton),false)
   and p_effectful then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if auth.uid() is null then raise exception 'auth required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from auth.uid() or not (
  (t.tenant_id is not null and t.tenant_id is not distinct from public.current_user_tenant_id())
  or (t.tenant_id is null and public.is_platform_owner() is true)) then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 if p_stop then
  if p_supersedes is null then raise exception 'stop intent required'; end if;
  turn_id:=public.paige_chat_turn_append(p_thread,'system','',null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('supersedes_intent_id',p_supersedes,'stopped',true)),null);
  update public.paige_chat_turns set interactive_actor_id=auth.uid(),interactive_tenant_id=t.tenant_id,
   interactive_supersedes_id=p_supersedes where id=turn_id;
  if t.interactive_latest_intent=p_supersedes then
   update public.paige_chat_threads set interactive_latest_intent=null,interactive_admission=null,interactive_admitted_intent=null where id=p_thread;
  end if;
  return jsonb_build_object('status','stopped');
 end if;
 if p_intent is null then raise exception 'intent required'; end if;
 evidence:=public.paige_chat_interactive_evidence(p_thread,auth.uid(),t.tenant_id,p_intent);
 if (evidence->>'stopped')::boolean then return jsonb_build_object('status','superseded'); end if;
 -- Pre-rollout Stop/supersession must still deny delayed replay. Legacy JSON is
 -- conservative denial only: it never establishes settlement, release or status.
 if exists(select 1 from public.paige_chat_turns where thread_id=p_thread
 and bundle_ref->'interactive'->>'supersedes_intent_id'=p_intent::text) then
  return jsonb_build_object('status','superseded');
 end if;
 if t.interactive_latest_intent=p_intent or exists(select 1 from public.paige_chat_turns
 where thread_id=p_thread and (interactive_intent_id=p_intent
  or bundle_ref->'interactive'->>'request_intent_id'=p_intent::text)) then
  -- Only a matching server-issued admission and class can resume.
  -- Historical JSON is conservative denial, never proof of non-execution.
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null
   and t.interactive_admitted_intent=p_intent
   and t.interactive_admission is not distinct from (case when p_effectful then null::text else 'conversational' end)
   and not (evidence->>'terminal')::boolean then
   select id into turn_id from public.paige_chat_turns where thread_id=p_thread and role='user'
    and interactive_intent_id=p_intent and interactive_actor_id=auth.uid()
    and interactive_tenant_id is not distinct from t.tenant_id limit 1;
   return jsonb_build_object('status','accepted','turn_id',turn_id);
  end if;
  return jsonb_build_object('status','duplicate');
 end if;
 if not p_bound_answer then
  turn_id:=public.paige_chat_turn_append(p_thread,'user',p_content,null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('request_intent_id',p_intent,
    'supersedes_intent_id',p_supersedes)),null);
  update public.paige_chat_turns set interactive_intent_id=p_intent,interactive_actor_id=auth.uid(),
   interactive_tenant_id=t.tenant_id,interactive_supersedes_id=p_supersedes where id=turn_id;
 elsif p_supersedes is not null then
  -- A bound answer's user claim is appended later under its existing unique key;
  -- preserve its canonical supersession without inventing another user message.
  turn_id:=public.paige_chat_turn_append(p_thread,'system','',null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('supersedes_intent_id',p_supersedes)),null);
  update public.paige_chat_turns set interactive_actor_id=auth.uid(),interactive_tenant_id=t.tenant_id,
   interactive_supersedes_id=p_supersedes where id=turn_id;
 end if;
 update public.paige_chat_threads set interactive_latest_intent=p_intent,
  interactive_admission=case when p_effectful then null else 'conversational' end,
  interactive_admitted_intent=p_intent where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',case when p_bound_answer then null else turn_id end);
end $$;
revoke all on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) to authenticated;

create or replace function public.paige_chat_interactive_executor_v2(p_thread uuid,p_actor uuid,p_tenant uuid,
 p_intent uuid,p_operation text) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; acquired boolean:=false; evidence jsonb;
begin
 perform 1 from public.paige_chat_interactive_rollout where singleton for share;
 if p_operation='acquire' and not coalesce((select active from public.paige_chat_interactive_rollout where singleton),false) then
  raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if p_actor is null or p_intent is null then raise exception 'interactive identity required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 evidence:=public.paige_chat_interactive_evidence(p_thread,p_actor,p_tenant,p_intent);
 if p_operation='acquire' then
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null
   and t.interactive_admitted_intent=p_intent and t.interactive_admission is null
   and not (evidence->>'terminal')::boolean and not (evidence->>'stopped')::boolean then
   update public.paige_chat_threads set interactive_executor_intent=p_intent where id=p_thread;
   t.interactive_executor_intent:=p_intent; acquired:=true;
  end if;
 elsif p_operation='release' then
  if t.interactive_executor_intent=p_intent and not (evidence->>'terminal')::boolean then
   raise exception 'INTERACTIVE_RECONCILIATION_REQUIRED'; end if;
  update public.paige_chat_threads set interactive_executor_intent=null
   where id=p_thread and interactive_executor_intent=p_intent;
  if t.interactive_executor_intent=p_intent then t.interactive_executor_intent:=null; end if;
 elsif p_operation<>'state' then raise exception 'invalid operation'; end if;
 return jsonb_build_object('latest',t.interactive_latest_intent,'executor',t.interactive_executor_intent,
  'acquired',acquired,'terminal',(evidence->>'terminal')::boolean,'stopped',(evidence->>'stopped')::boolean);
end $$;
revoke all on function public.paige_chat_interactive_executor_v2(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_executor_v2(uuid,uuid,uuid,uuid,text) to service_role;

-- Exact, previously committed legacy rejectors from 008. Integrity pins never
-- come from a caller. An extra overload, changed body or broadened ACL fails.
create or replace function public.paige_chat_interactive_legacy_admission_closed()
returns boolean language sql stable security definer set search_path=public as $$
 select count(*)=2 and coalesce(bool_and(
  p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
  and p.proconfig=array['search_path=public']::text[]
  and encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=e.source_sha
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee<>p.proowner and (a.grantee<>to_regrole(e.allowed_role)::oid or a.privilege_type<>'EXECUTE' or a.is_grantable))
 ),false)
 and (select count(*) from pg_proc x join pg_namespace n on n.oid=x.pronamespace
  where n.nspname='public' and x.proname in ('paige_chat_interactive_begin','paige_chat_interactive_executor'))=2
 from (values
 ('public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean)','c5b53c0273fa4ca49da35ed1353d7419615ef8fb6cad4352e7a494514d6d9180','authenticated'),
 ('public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text)','8bf30996db2d22dcaa2bc8425d8098e92e456cd31637348c61823111924047c0','service_role')
 ) e(signature,source_sha,allowed_role) join pg_proc p on p.oid=to_regprocedure(e.signature)
$$;
revoke all on function public.paige_chat_interactive_legacy_admission_closed() from public,anon,authenticated,service_role;

-- Run separately AFTER this migration commits. The trusted release caller
-- supplies no timestamp/window; already-committed rejectors are verified first.
create or replace function public.paige_chat_interactive_fence_legacy()
returns timestamptz language plpgsql security definer set search_path=public as $$
declare r public.paige_chat_interactive_rollout%rowtype;
begin
 if exists(select 1 from pg_proc where oid in (
  'public.paige_chat_interactive_fence_legacy()'::regprocedure,
  'public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean)'::regprocedure,
  'public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text)'::regprocedure)
  and xmin=pg_current_xact_id()::text::xid) then
  raise exception 'INTERACTIVE_RETIREMENT_INSTALL_NOT_COMMITTED'; end if;
 select * into r from public.paige_chat_interactive_rollout where singleton for update;
 if not found or r.active then raise exception 'INTERACTIVE_RETIREMENT_FENCE_UNAVAILABLE'; end if;
 if not public.paige_chat_interactive_legacy_admission_closed() then
  raise exception 'INTERACTIVE_LEGACY_ADMISSION_NOT_CLOSED'; end if;
 if r.legacy_admission_closed_at is null then
  update public.paige_chat_interactive_rollout set legacy_admission_closed_at=clock_timestamp()
   where singleton returning * into r;
 end if;
 return r.legacy_admission_closed_at;
end $$;
revoke all on function public.paige_chat_interactive_fence_legacy() from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_fence_legacy() to service_role;

-- Worker teardown cannot retire an already-accepted database call. Include idle
-- transactions, old bodies blocked before reaching the thread, and prepared work.
create or replace function public.paige_chat_interactive_retirement_blockers(p_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_transactions bigint; v_prepared bigint; v_unobservable bigint;
begin
 if p_cutoff is null or current_setting('track_activities')<>'on' then
  raise exception 'INTERACTIVE_RETIREMENT_OBSERVATION_UNAVAILABLE'; end if;
 perform pg_stat_clear_snapshot();
 select count(*) filter(where xact_start<=p_cutoff),
        count(*) filter(where state is null or state='disabled')
 into v_transactions,v_unobservable
 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
  and backend_type='client backend';
 select count(*) into v_prepared from pg_prepared_xacts where database=current_database();
 if v_unobservable>0 then raise exception 'INTERACTIVE_RETIREMENT_OBSERVATION_UNAVAILABLE'; end if;
 return jsonb_build_object('older_transactions',v_transactions,'prepared_transactions',v_prepared);
end $$;
revoke all on function public.paige_chat_interactive_retirement_blockers(timestamptz) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_retirement_blockers(timestamptz) to service_role;

-- One activation implementation, two explicitly named proof kinds. Isolation
-- evidence never masquerades as provider cessation. No migration activates it.
create or replace function public.paige_chat_interactive_activate(
 p_edge_head text,p_drain_evidence_sha256 text,p_retirement_method text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.paige_chat_interactive_rollout%rowtype; blockers jsonb;
begin
 if p_edge_head !~ '^[0-9a-f]{40}$' or p_drain_evidence_sha256 !~ '^[0-9a-f]{64}$'
  or p_edge_head is null or p_drain_evidence_sha256 is null then raise exception 'verified release evidence required'; end if;
 if p_retirement_method is null or p_retirement_method not in ('provider_cessation','database_executor_isolation') then
  raise exception 'verified retirement method required'; end if;
 select * into r from public.paige_chat_interactive_rollout where singleton for update;
 if not found then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if r.active then
  if r.edge_head is distinct from p_edge_head or r.drain_evidence_sha256 is distinct from p_drain_evidence_sha256
   or coalesce(r.retirement_method,'provider_cessation') is distinct from p_retirement_method then
   raise exception 'activation evidence conflict'; end if;
  return;
 end if;
 if p_retirement_method='database_executor_isolation' then
  if r.legacy_admission_closed_at is null
   or clock_timestamp()<r.legacy_admission_closed_at+interval '400 seconds' then
   raise exception 'INTERACTIVE_LEGACY_RUNTIME_NOT_RETIRED'; end if;
  if not public.paige_chat_interactive_legacy_admission_closed() then
   raise exception 'INTERACTIVE_LEGACY_ADMISSION_NOT_CLOSED'; end if;
  blockers:=public.paige_chat_interactive_retirement_blockers(r.legacy_admission_closed_at);
  if (blockers->>'older_transactions')::bigint<>0 or (blockers->>'prepared_transactions')::bigint<>0 then
   raise exception 'INTERACTIVE_LEGACY_DATABASE_NOT_RETIRED'; end if;
 end if;
 lock table public.paige_chat_threads in share row exclusive mode;
 if exists(select 1 from public.paige_chat_threads where interactive_executor_intent is not null) then
  raise exception 'INTERACTIVE_DRAIN_REQUIRED'; end if;
 update public.paige_chat_interactive_rollout set active=true,edge_head=p_edge_head,
  drain_evidence_sha256=p_drain_evidence_sha256,retirement_method=p_retirement_method,activated_at=now() where singleton;
end $$;
revoke all on function public.paige_chat_interactive_activate(text,text,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_activate(text,text,text) to service_role;

-- Preserve the original ABI and its original provider-cessation meaning.
create or replace function public.paige_chat_interactive_activate(p_edge_head text,p_drain_evidence_sha256 text)
returns void language sql security definer set search_path=public as $$
 select public.paige_chat_interactive_activate(p_edge_head,p_drain_evidence_sha256,'provider_cessation')
$$;
revoke all on function public.paige_chat_interactive_activate(text,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_activate(text,text) to service_role;

commit;
