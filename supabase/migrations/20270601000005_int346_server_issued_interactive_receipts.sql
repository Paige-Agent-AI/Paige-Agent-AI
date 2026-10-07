-- INT-346: issuance on the existing transcript, never another receipt system.
-- CLI-created migration renumbered after the repository's future-version tail:
-- plain production db push refuses historical timestamps (no --include-all).
-- Historical JSON is intentionally not promoted to authoritative evidence.
begin;
alter table public.paige_chat_turns
 add column if not exists interactive_intent_id uuid,
 add column if not exists interactive_actor_id uuid,
 add column if not exists interactive_tenant_id uuid,
 add column if not exists interactive_terminal_state text,
 add column if not exists interactive_supersedes_id uuid;

create or replace function public.paige_chat_turn_authority_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if current_user <> 'postgres' then
  if new.interactive_intent_id is not null or new.interactive_actor_id is not null
    or new.interactive_tenant_id is not null or new.interactive_terminal_state is not null
    or new.interactive_supersedes_id is not null then
   raise exception 'interactive receipt authority is server-owned' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (old.interactive_intent_id is not null or old.interactive_supersedes_id is not null) then
   raise exception 'issued interactive receipt is immutable' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.paige_chat_turn_authority_guard() from public,anon,authenticated,service_role;
drop trigger if exists paige_chat_turn_authority_guard on public.paige_chat_turns;
create trigger paige_chat_turn_authority_guard before insert or update on public.paige_chat_turns
for each row execute function public.paige_chat_turn_authority_guard();

create unique index if not exists paige_chat_turns_interactive_terminal_uk
 on public.paige_chat_turns(thread_id,interactive_intent_id)
 where interactive_terminal_state is not null;

-- The only interactive terminal writer. Scope and executor binding are locked
-- together with persistence; a superseded executor may still finish its receipt.
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
  raise exception 'interactive executor mismatch' using errcode='42501'; end if;
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

-- One scope-bound predicate for handoff, status, and lost-response recovery.
create or replace function public.paige_chat_interactive_evidence(p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('terminal',exists(select 1 from public.paige_chat_turns
  where thread_id=p_thread and role='assistant' and interactive_intent_id=p_intent
   and interactive_actor_id=p_actor and interactive_tenant_id is not distinct from p_tenant
   and interactive_terminal_state in ('FINAL','WAIT_APPROVAL','WAIT_WORK','ASK_USER','LIMIT_REACHED','INTERRUPTED','WITHHELD','REFUSED')),
 'stopped',exists(select 1 from public.paige_chat_turns where thread_id=p_thread
  and interactive_actor_id=p_actor and interactive_tenant_id is not distinct from p_tenant
  and interactive_supersedes_id=p_intent))
$$;
revoke all on function public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_evidence(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.paige_chat_interactive_executor(p_thread uuid,p_actor uuid,p_tenant uuid,
 p_intent uuid,p_operation text) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; acquired boolean:=false; evidence jsonb;
begin
 if p_actor is null or p_intent is null then raise exception 'interactive identity required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 evidence:=public.paige_chat_interactive_evidence(p_thread,p_actor,p_tenant,p_intent);
 if p_operation='acquire' then
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null
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
revoke all on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.paige_chat_interactive_begin(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; turn_id uuid; evidence jsonb;
begin
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
   update public.paige_chat_threads set interactive_latest_intent=null where id=p_thread;
  end if;
  return jsonb_build_object('status','stopped');
 end if;
 if p_intent is null then raise exception 'intent required'; end if;
 evidence:=public.paige_chat_interactive_evidence(p_thread,auth.uid(),t.tenant_id,p_intent);
 if (evidence->>'stopped')::boolean then return jsonb_build_object('status','superseded'); end if;
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
 update public.paige_chat_threads set interactive_latest_intent=p_intent where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',case when p_bound_answer then null else turn_id end);
end $$;
revoke all on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) to authenticated;
commit;
