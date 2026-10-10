-- INT-346 conversational admission (#1822 hotfix): while the version-2 interactive
-- rollout is staged but NOT active (DRAINING), an ordinary typed Chat message must be
-- accepted as a NON-EFFECTFUL conversation turn instead of failing the whole product
-- with 503 INTERACTIVE_PROTOCOL_NOT_READY. The admission class is recorded beside the
-- intent it describes and is server-owned exactly like every other interactive column.
-- A conversational admission confers no executor authority: acquire stays refused while
-- staged, settlement is still a server-issued receipt, and once the rollout is ACTIVE
-- the conversational class disappears (activation refuses it). This is the bounded
-- degraded mode the release contract requires; it is not security clearance.
begin;

alter table public.paige_chat_threads
 add column if not exists interactive_admission text;

-- Re-emitted from 20270601000000 with interactive_admission added to the guarded set.
create or replace function public.paige_chat_interactive_columns_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if current_user <> 'postgres' and (new.interactive_latest_intent is not null or new.interactive_executor_intent is not null
    or new.interactive_admission is not null) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
  end if; return new;
 end if;
 if current_user <> 'postgres' and (new.interactive_latest_intent is distinct from old.interactive_latest_intent
   or new.interactive_executor_intent is distinct from old.interactive_executor_intent
   or new.interactive_admission is distinct from old.interactive_admission) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
 end if; return new;
end $$;
revoke all on function public.paige_chat_interactive_columns_guard() from public;

-- Re-emitted from 20270601000008 (body verified live-identical before this change) with
-- the admission-class parameter. New signature: the old 6-argument function is dropped,
-- never left behind as a second live overload.
drop function if exists public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean);
create or replace function public.paige_chat_interactive_begin_v2(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false,p_effectful boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; turn_id uuid; evidence jsonb;
begin
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
   update public.paige_chat_threads set interactive_latest_intent=null,interactive_admission=null where id=p_thread;
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
  -- Legacy JSON may conservatively deny replay, but cannot establish settlement.
  -- An issued pending instruction is unaffected by counterfeit terminal JSON.
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null
   and not (evidence->>'terminal')::boolean and (
    exists(select 1 from public.paige_chat_turns where thread_id=p_thread and role='user'
     and interactive_intent_id=p_intent and interactive_actor_id=auth.uid()
     and interactive_tenant_id is not distinct from t.tenant_id)
    or not exists(select 1 from public.paige_chat_turns where thread_id=p_thread and role='assistant'
     and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text)) then
   select id into turn_id from public.paige_chat_turns where thread_id=p_thread and role='user'
    and (interactive_intent_id=p_intent or bundle_ref->'interactive'->>'request_intent_id'=p_intent::text) limit 1;
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
  interactive_admission=case when p_effectful then null else 'conversational' end where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',case when p_bound_answer then null else turn_id end);
end $$;
revoke all on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) to authenticated;

-- Re-emitted from 20270601000008 (body verified live-identical before this change).
-- Delta: a CONVERSATIONAL admission settles without an executor claim — it never held
-- one — while every other unowned intent is still refused. A stale pre-rollout executor
-- claim on another intent cannot block a conversational receipt, and a conversational
-- receipt never releases or rewrites that claim.
-- Reviewer-verified boundary (non-author review 2026-10-10): the relaxed branch is
-- bounded by "this intent is still the thread's CURRENT conversational admission", not
-- by the rollout row — an activation racing an in-flight conversational turn lets that
-- one turn finish truthfully. Post-activation, no NEW conversational admission exists
-- (begin refuses the class) and this RPC is service-role only, so the branch is
-- reachable only by trusted edge code for a turn that genuinely ran degraded.
create or replace function public.paige_chat_interactive_settle(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_content text,
 p_surfaces_used text[],p_model text,p_bundle_ref jsonb,p_tool_calls jsonb default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; v_id uuid; v_state text; existing public.paige_chat_turns%rowtype;
begin
 if p_actor is null or p_intent is null then raise exception 'interactive identity required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 v_state:=p_bundle_ref->'turn_state'->>'state';
 if v_state is null or v_state not in ('FINAL','WAIT_APPROVAL','WAIT_WORK','ASK_USER','LIMIT_REACHED','INTERRUPTED','WITHHELD','REFUSED')
  or p_bundle_ref->'interactive'->>'request_intent_id' is distinct from p_intent::text then
  raise exception 'invalid interactive terminal'; end if;
 select * into existing from public.paige_chat_turns where thread_id=p_thread and interactive_intent_id=p_intent
  and interactive_actor_id=p_actor and interactive_tenant_id is not distinct from p_tenant
  and interactive_terminal_state is not null;
 if found then
  if existing.content is distinct from p_content or existing.bundle_ref is distinct from p_bundle_ref
   or existing.surfaces_used is distinct from p_surfaces_used or existing.model is distinct from p_model
   or existing.tool_calls is distinct from p_tool_calls then raise exception 'interactive receipt conflict'; end if;
  return existing.id;
 end if;
 if t.interactive_executor_intent is distinct from p_intent then
  if t.interactive_latest_intent is distinct from p_intent or t.interactive_admission is distinct from 'conversational' then
   raise exception 'interactive executor mismatch' using errcode='42501'; end if;
 end if;
 insert into public.paige_chat_turns(thread_id,role,content,surfaces_used,model,bundle_ref,tool_calls,
  interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
 values(p_thread,'assistant',p_content,p_surfaces_used,p_model,p_bundle_ref,p_tool_calls,
  p_intent,p_actor,p_tenant,v_state) returning id into v_id;
 update public.paige_chat_threads set message_count=message_count+1,last_message_at=now(),
  auto_delete_at=now()+interval '90 days',updated_at=now() where id=p_thread;
 return v_id;
end $$;
revoke all on function public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb) to service_role;

commit;
