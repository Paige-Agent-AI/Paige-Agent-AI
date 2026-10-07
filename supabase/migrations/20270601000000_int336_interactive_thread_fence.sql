-- INT-336: serialize interactive execution on the existing canonical conversation.
alter table public.paige_chat_threads add column interactive_latest_intent uuid,
  add column interactive_executor_intent uuid;
create function public.paige_chat_interactive_columns_guard() returns trigger
language plpgsql set search_path=public as $$
begin
 if tg_op='INSERT' then
  if current_user <> 'postgres' and (new.interactive_latest_intent is not null or new.interactive_executor_intent is not null) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
  end if; return new;
 end if;
 if current_user <> 'postgres' and (new.interactive_latest_intent is distinct from old.interactive_latest_intent
   or new.interactive_executor_intent is distinct from old.interactive_executor_intent) then
   raise exception 'interactive authority is server-owned' using errcode='42501';
 end if; return new;
end $$;
create trigger paige_chat_interactive_columns_guard before insert or update on public.paige_chat_threads
for each row execute function public.paige_chat_interactive_columns_guard();
revoke all on function public.paige_chat_interactive_columns_guard() from public;

create function public.paige_chat_interactive_begin(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; turn_id uuid;
begin
 if auth.uid() is null then raise exception 'auth required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from auth.uid() or not (
  (t.tenant_id is not null and t.tenant_id is not distinct from public.current_user_tenant_id())
  or (t.tenant_id is null and public.is_platform_owner() is true)) then raise exception 'thread scope mismatch' using errcode='42501'; end if;
 if p_stop then
  if p_supersedes is null then raise exception 'stop intent required'; end if;
  perform public.paige_chat_turn_append(p_thread,'system','',null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('supersedes_intent_id',p_supersedes,'stopped',true)),null);
  if t.interactive_latest_intent=p_supersedes then
   update public.paige_chat_threads set interactive_latest_intent=null where id=p_thread;
  end if;
  return jsonb_build_object('status','stopped');
 end if;
 if p_intent is null then raise exception 'intent required'; end if;
 if t.interactive_latest_intent=p_intent or exists(select 1 from public.paige_chat_turns
   where thread_id=p_thread and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text) then
  -- A transport retry may resume only a pending, unexecuted canonical instruction.
  -- A running or terminal intent never starts another loop and never appends again.
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null and not exists(
   select 1 from public.paige_chat_turns where thread_id=p_thread and role='assistant'
   and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text
   and bundle_ref->'turn_state'->>'state'<>'WORKING') then
   select id into turn_id from public.paige_chat_turns where thread_id=p_thread and role='user'
    and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text limit 1;
   return jsonb_build_object('status','accepted','turn_id',turn_id);
  end if;
  return jsonb_build_object('status','duplicate');
 end if;
 if exists(select 1 from public.paige_chat_turns where thread_id=p_thread
  and bundle_ref->'interactive'->>'supersedes_intent_id'=p_intent::text) then
  return jsonb_build_object('status','superseded');
 end if;
 if not p_bound_answer then
  turn_id:=public.paige_chat_turn_append(p_thread,'user',p_content,null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('request_intent_id',p_intent,
    'supersedes_intent_id',p_supersedes)),null);
 end if;
 update public.paige_chat_threads set interactive_latest_intent=p_intent where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',turn_id);
end $$;
revoke all on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) to authenticated;

create function public.paige_chat_interactive_executor(p_thread uuid,p_actor uuid,p_tenant uuid,
 p_intent uuid,p_operation text) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; acquired boolean:=false;
begin
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 if p_operation='acquire' then
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null then
   update public.paige_chat_threads set interactive_executor_intent=p_intent where id=p_thread;
   t.interactive_executor_intent:=p_intent; acquired:=true;
  end if;
 elsif p_operation='release' then
  -- Isolated PostgreSQL proof uses the real canonical turn append: missing receipt
  -- refuses release; readback followed by canonical INTERRUPTED receipt permits it.
  if t.interactive_executor_intent=p_intent and not exists(select 1 from public.paige_chat_turns
   where thread_id=p_thread and role='assistant'
   and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text
   and bundle_ref->'turn_state'->>'state' in ('FINAL','WAIT_APPROVAL','WAIT_WORK','ASK_USER','LIMIT_REACHED','INTERRUPTED','WITHHELD','REFUSED')) then
   raise exception 'INTERACTIVE_RECONCILIATION_REQUIRED';
  end if;
  update public.paige_chat_threads set interactive_executor_intent=null
   where id=p_thread and interactive_executor_intent=p_intent;
 elsif p_operation<>'state' then raise exception 'invalid operation'; end if;
 return jsonb_build_object('latest',t.interactive_latest_intent,'executor',t.interactive_executor_intent,'acquired',acquired);
end $$;
revoke all on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) to service_role;
