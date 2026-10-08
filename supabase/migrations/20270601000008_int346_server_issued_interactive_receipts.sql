-- INT-346: issuance on the existing transcript, never another receipt system.
-- CLI-created migration renumbered after the repository's future-version tail:
-- plain production db push refuses historical timestamps (no --include-all).
-- Historical JSON is intentionally not promoted to authoritative evidence.
begin;

-- Expansion stops new legacy admissions, but activation is a separate release
-- operation after positively verified provider drain. This is release metadata,
-- not a second work/receipt store. No user or service-role direct table access.
create table if not exists public.paige_chat_interactive_rollout (
 singleton boolean primary key default true check(singleton),
 active boolean not null default false,
 edge_head text, drain_evidence_sha256 text, activated_at timestamptz
);
alter table public.paige_chat_interactive_rollout enable row level security;
revoke all on public.paige_chat_interactive_rollout from public,anon,authenticated,service_role;
insert into public.paige_chat_interactive_rollout(singleton) values(true) on conflict do nothing;

create or replace function public.paige_chat_interactive_protocol() returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('version',2,'active',active) from public.paige_chat_interactive_rollout where singleton
$$;
revoke all on function public.paige_chat_interactive_protocol() from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_protocol() to service_role;

-- Trusted release operator attests the private, independently checked provider
-- cessation packet. Neither a timeout, a deployment tag nor empty executor rows
-- constitutes that packet. The RPC also refuses any still-held canonical claim.
create or replace function public.paige_chat_interactive_activate(p_edge_head text,p_drain_evidence_sha256 text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.paige_chat_interactive_rollout%rowtype;
begin
 if p_edge_head !~ '^[0-9a-f]{40}$' or p_drain_evidence_sha256 !~ '^[0-9a-f]{64}$'
   or p_edge_head is null or p_drain_evidence_sha256 is null then raise exception 'verified release evidence required'; end if;
 select * into r from public.paige_chat_interactive_rollout where singleton for update;
 if not found then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if r.active then
  if r.edge_head is distinct from p_edge_head or r.drain_evidence_sha256 is distinct from p_drain_evidence_sha256 then
   raise exception 'activation evidence conflict'; end if;
  return;
 end if;
 lock table public.paige_chat_threads in share row exclusive mode;
 if exists(select 1 from public.paige_chat_threads where interactive_executor_intent is not null) then
  raise exception 'INTERACTIVE_DRAIN_REQUIRED'; end if;
 update public.paige_chat_interactive_rollout set active=true,edge_head=p_edge_head,
  drain_evidence_sha256=p_drain_evidence_sha256,activated_at=now() where singleton;
end $$;
revoke all on function public.paige_chat_interactive_activate(text,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_activate(text,text) to service_role;
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

create or replace function public.paige_chat_interactive_begin_v2(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; turn_id uuid; evidence jsonb;
begin
 perform 1 from public.paige_chat_interactive_rollout where singleton for share;
 if p_stop is not true and not coalesce((select active from public.paige_chat_interactive_rollout where singleton),false) then
  raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
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
 update public.paige_chat_threads set interactive_latest_intent=p_intent where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',case when p_bound_answer then null else turn_id end);
end $$;
revoke all on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean) to authenticated;

-- Legacy handlers cannot accept/acquire new work after expansion. In DRAINING
-- only their already-running completion follows the unchanged legacy contract.
-- This temporary compatibility is explicitly NOT security clearance. No v2 work
-- may start until authoritative old-runtime cessation is verified and activated.
create or replace function public.paige_chat_interactive_begin(p_thread uuid,p_intent uuid,p_supersedes uuid,
 p_content text,p_bound_answer boolean default false,p_stop boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_stop then return public.paige_chat_interactive_begin_v2(p_thread,p_intent,p_supersedes,p_content,p_bound_answer,true); end if;
 raise exception 'INTERACTIVE_PROTOCOL_REQUIRED';
end $$;
revoke all on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.paige_chat_interactive_begin(uuid,uuid,uuid,text,boolean,boolean) to authenticated;

create or replace function public.paige_chat_interactive_executor(p_thread uuid,p_actor uuid,p_tenant uuid,
 p_intent uuid,p_operation text) returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.paige_chat_threads%rowtype; is_active boolean;
begin
 select active into is_active from public.paige_chat_interactive_rollout where singleton for share;
 if not found then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if p_operation='acquire' then raise exception 'INTERACTIVE_PROTOCOL_REQUIRED'; end if;
 if is_active or p_operation='state' then
  return public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,p_operation);
 end if;
 if p_operation<>'release' then raise exception 'invalid operation'; end if;
 if p_actor is null or p_intent is null then raise exception 'interactive identity required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 if t.interactive_executor_intent=p_intent and not exists(select 1 from public.paige_chat_turns
   where thread_id=p_thread and role='assistant'
   and bundle_ref->'interactive'->>'request_intent_id'=p_intent::text
   and bundle_ref->'turn_state'->>'state' in ('FINAL','WAIT_APPROVAL','WAIT_WORK','ASK_USER','LIMIT_REACHED','INTERRUPTED','WITHHELD','REFUSED')) then
  raise exception 'INTERACTIVE_RECONCILIATION_REQUIRED'; end if;
 update public.paige_chat_threads set interactive_executor_intent=null where id=p_thread and interactive_executor_intent=p_intent;
 return jsonb_build_object('latest',t.interactive_latest_intent,'executor',case when t.interactive_executor_intent=p_intent then null else t.interactive_executor_intent end,'acquired',false);
end $$;
revoke all on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_executor(uuid,uuid,uuid,uuid,text) to service_role;

commit;
