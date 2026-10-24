-- J19: future, positively runtime-bound claims only. No historical adoption,
-- timeout release, domain replay, new executor, or customer-supplied attestation.
begin;

alter table public.paige_chat_threads
 add column if not exists interactive_runtime_binding jsonb,
 add column if not exists interactive_recovery_hold uuid;
alter table public.paige_chat_turns
 add column if not exists interactive_runtime_binding jsonb,
 add column if not exists interactive_runtime_shutdown jsonb,
 add column if not exists interactive_runtime_recovery_receipt uuid;
create index if not exists paige_chat_turns_runtime_admission_idx on public.paige_chat_turns(thread_id,interactive_intent_id)
 where role='user' and interactive_intent_id is not null;

-- Compose only the new display case into the incumbent PL/pgSQL projector.
-- CREATE OR REPLACE preserves its OID, callers, dependencies and exact ACL.
do $display$
declare fn regprocedure:='public._workspace_event_display(text,text,text)'::regprocedure;
 definition text; original_acl aclitem[]; original_oid oid:=fn::oid; body text;
begin
 select pg_get_functiondef(fn),proacl,prosrc into definition,original_acl,body from pg_catalog.pg_proc where oid=fn;
 if strpos(body,'J19_RUNTIME_RECOVERY_DISPLAY')=0 then
  if body !~* '^\s*DECLARE\s+result jsonb;\s*title text;\s*BEGIN' then
   raise exception 'current Rail display composition requires review'; end if;
  execute regexp_replace(definition,'\mBEGIN\M',$case$BEGIN
  -- J19_RUNTIME_RECOVERY_DISPLAY: only this new recovery outcome.
  IF _source_kind='capability_run' AND _capability='chat_runtime_recovery' AND _outcome='capability_outcome_unknown' THEN
   RETURN jsonb_build_object('event_kind','capability_run.capability_outcome_unknown','surface','command_center',
    'actor_type','paige_agent','audience','owner','visibility','owner_internal','from_department','owner_ops',
    'to_department',NULL,'title','Answer interrupted — business results unconfirmed',
    'summary','The answer was interrupted. Original business operations still need checking and have not been retried.');
  END IF;$case$,'i');
 end if;
 if 'public._workspace_event_display(text,text,text)'::regprocedure::oid<>original_oid
  or (select proacl from pg_catalog.pg_proc where oid=original_oid) is distinct from original_acl then
  raise exception 'Rail display identity or permissions changed'; end if;
end $display$;

-- INVOKER trigger: a raw service_role write must not inherit postgres authority.
create or replace function public.paige_chat_runtime_columns_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user<>'postgres' then
  if tg_table_name='paige_chat_threads' then
   if (tg_op='INSERT' and (new.interactive_runtime_binding is not null or new.interactive_recovery_hold is not null))
    or (tg_op='UPDATE' and (new.interactive_runtime_binding is distinct from old.interactive_runtime_binding
      or new.interactive_recovery_hold is distinct from old.interactive_recovery_hold)) then
    raise exception 'runtime authority is server-owned' using errcode='42501'; end if;
  else
   if (tg_op='INSERT' and (new.interactive_runtime_binding is not null or new.interactive_runtime_shutdown is not null
      or new.interactive_runtime_recovery_receipt is not null))
    or (tg_op='UPDATE' and (new.interactive_runtime_binding is distinct from old.interactive_runtime_binding
      or new.interactive_runtime_shutdown is distinct from old.interactive_runtime_shutdown
      or new.interactive_runtime_recovery_receipt is distinct from old.interactive_runtime_recovery_receipt)) then
    raise exception 'runtime authority is server-owned' using errcode='42501'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.paige_chat_runtime_columns_guard() from public,anon,authenticated,service_role;
drop trigger if exists paige_chat_runtime_columns_guard on public.paige_chat_threads;
create trigger paige_chat_runtime_columns_guard before insert or update on public.paige_chat_threads
 for each row execute function public.paige_chat_runtime_columns_guard();
drop trigger if exists paige_chat_runtime_columns_guard on public.paige_chat_turns;
create trigger paige_chat_runtime_columns_guard before insert or update on public.paige_chat_turns
 for each row execute function public.paige_chat_runtime_columns_guard();

-- Also constrains UPDATEs from an already-entered incumbent executor body.
-- Old/unbound callers keep their ABI; they cannot acquire under this thread hold.
do $$begin
 if not exists(select 1 from pg_catalog.pg_constraint where conrelid='public.paige_chat_threads'::regclass
  and conname='paige_chat_runtime_held_claim') then
  alter table public.paige_chat_threads add constraint paige_chat_runtime_held_claim check(
   interactive_recovery_hold is null or interactive_executor_intent is null or coalesce(
    interactive_runtime_binding->>'intent_id'=interactive_executor_intent::text
    and interactive_runtime_binding->>'mode'='read_only_recovery'
    and interactive_runtime_binding->>'request_nonce' is not null,false)) not valid;
 end if;
end $$;

create or replace function public.paige_chat_interactive_runtime_context(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb; hold uuid;
begin
 state:=public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'state');
 select interactive_recovery_hold into hold from public.paige_chat_threads where id=p_thread;
 return state||jsonb_build_object('recovery_read_only',hold is not null);
end $$;
revoke all on function public.paige_chat_interactive_runtime_context(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_runtime_context(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.paige_chat_interactive_acquire_bound(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid,p_execution_id uuid,p_deployment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare state jsonb; t public.paige_chat_threads%rowtype; admitted public.paige_chat_turns%rowtype;
 binding jsonb; count_rows integer; prior jsonb;
begin
 -- Incumbent native state is the scope authority, not another membership engine.
 state:=public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'state');
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if t.audience is distinct from 'workspace' or p_tenant is null then
  raise exception 'runtime binding requires workspace scope' using errcode='42501'; end if;
 if p_request_nonce is null or p_execution_id is null or p_deployment_id is null
  or p_deployment_id !~ '^[a-z0-9]{10,32}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9]{1,12}$' then
  raise exception 'invalid server runtime identity' using errcode='22023'; end if;
 if state->>'executor' is not null or state->>'latest' is distinct from p_intent::text
  or (state->>'terminal')::boolean or (state->>'stopped')::boolean then
  return state||jsonb_build_object('acquired',false,'recovery_read_only',t.interactive_recovery_hold is not null);
 end if;
 select count(*) into count_rows from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_intent_id=p_intent and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant;
 if count_rows<>1 then raise exception 'runtime admission unavailable' using errcode='42501'; end if;
 select * into admitted from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_intent_id=p_intent and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant for update;
 if admitted.interactive_runtime_binding is not null then
  raise exception 'runtime admission already bound' using errcode='42501'; end if;
 binding:=jsonb_build_object('v',1,'intent_id',p_intent,'admission_turn_id',admitted.id,
  'request_nonce',p_request_nonce,'execution_id',p_execution_id,'deployment_id',p_deployment_id,
  'function_slug','paige-ai-chat','bound_at',clock_timestamp(),
  'mode',case when t.interactive_recovery_hold is not null then 'read_only_recovery' else 'normal' end);
 prior:=t.interactive_runtime_binding;
 -- Private pre-registration and incumbent acquire commit together. The CHECK
 -- fence sees this registration; no old frame/caller can create one itself.
 update public.paige_chat_threads set interactive_runtime_binding=binding where id=p_thread;
 state:=public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'acquire');
 if (state->>'acquired')::boolean then
  update public.paige_chat_turns set interactive_runtime_binding=binding where id=admitted.id;
 else
  update public.paige_chat_threads set interactive_runtime_binding=prior where id=p_thread;
 end if;
 return state||jsonb_build_object('recovery_read_only',t.interactive_recovery_hold is not null);
end $$;
revoke all on function public.paige_chat_interactive_acquire_bound(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_acquire_bound(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- Trusted control-plane SQL operator only: intentionally NOT service_role and
-- NOT an exposed customer/Chat RPC. The operator independently verifies the
-- authenticated provider log packet; a hash/boolean alone is never authority.
create or replace function private.paige_chat_attest_runtime_shutdown(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid,p_evidence jsonb)
returns void language plpgsql set search_path='' as $$
declare t public.paige_chat_threads%rowtype; u public.paige_chat_turns%rowtype;
 b jsonb; event_at timestamptz; query_start timestamptz; query_end timestamptz; proof jsonb;
begin
 if current_user<>'postgres' or session_user<>'postgres' then
  raise exception 'trusted control-plane operator required' using errcode='42501'; end if;
 perform public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'state');
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if (select count(*) from public.paige_chat_turns where thread_id=p_thread and role='user' and interactive_actor_id=p_actor
  and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent)<>1 then
  raise exception 'runtime admission mismatch' using errcode='42501'; end if;
 select * into u from public.paige_chat_turns where thread_id=p_thread and role='user' and interactive_actor_id=p_actor
  and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent for update;
 b:=u.interactive_runtime_binding;
 if b is null or b->>'intent_id' is distinct from p_intent::text or b->>'request_nonce' is distinct from p_request_nonce::text then
  raise exception 'original bound executor required' using errcode='42501'; end if;
 if u.id::text is distinct from b->>'admission_turn_id'
  or (u.interactive_runtime_shutdown is null and (t.interactive_executor_intent is distinct from p_intent
   or t.interactive_runtime_binding is distinct from b)) then
  raise exception 'runtime admission mismatch' using errcode='42501'; end if;
 if jsonb_typeof(p_evidence)<>'object' or pg_column_size(p_evidence)>4096
  or p_evidence->>'source' is distinct from 'supabase_control_plane'
  or p_evidence->>'event_type' is distinct from 'Shutdown' or coalesce(p_evidence->>'reason','') not in ('CPUTime','WallClockTime')
  or p_evidence->>'execution_id' is distinct from b->>'execution_id'
  or p_evidence->>'deployment_id' is distinct from b->>'deployment_id'
  or p_evidence->>'project_ref' is distinct from split_part(b->>'deployment_id','_',1)
  or p_evidence->>'function_id' is distinct from split_part(b->>'deployment_id','_',2)
  or p_evidence->>'function_slug' is distinct from 'paige-ai-chat'
  or coalesce(p_evidence->>'event_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(p_evidence->>'packet_sha256','') !~ '^[0-9a-f]{64}$' then
  raise exception 'exact hard shutdown evidence required' using errcode='22023'; end if;
 event_at:=(p_evidence->>'event_at')::timestamptz;
 query_start:=(p_evidence->>'query_start')::timestamptz;
 query_end:=(p_evidence->>'query_end')::timestamptz;
 if event_at is null or query_start is null or query_end is null or not isfinite(event_at)
  or not isfinite(query_start) or not isfinite(query_end) or event_at<(b->>'bound_at')::timestamptz
  or query_start>(b->>'bound_at')::timestamptz or query_end<event_at or query_end>clock_timestamp()
  or query_end-query_start>interval '24 hours' then
  raise exception 'invalid shutdown evidence window' using errcode='22023'; end if;
 -- Store only allowlisted references, never provider headers/content or a caller
 -- boolean. Attribution is the actual DB operator, not a supplied actor label.
 proof:=jsonb_build_object('v',1,'source','supabase_control_plane','event_type','Shutdown',
  'event_id',p_evidence->>'event_id','reason',p_evidence->>'reason','execution_id',b->>'execution_id',
  'deployment_id',b->>'deployment_id','project_ref',p_evidence->>'project_ref','function_id',p_evidence->>'function_id',
  'function_slug','paige-ai-chat','event_at',event_at,'query_start',query_start,'query_end',query_end,
  'packet_sha256',p_evidence->>'packet_sha256','request_nonce',p_request_nonce);
 if u.interactive_runtime_shutdown is not null then
  if u.interactive_runtime_shutdown->'evidence' is distinct from proof then
   raise exception 'shutdown attestation conflict'; end if;
  return;
 end if;
 update public.paige_chat_turns set interactive_runtime_shutdown=jsonb_build_object('evidence',proof,
  'attested_by',session_user,'attested_at',clock_timestamp()) where id=u.id;
end $$;
revoke all on function private.paige_chat_attest_runtime_shutdown(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.paige_chat_interactive_recover_bound(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.paige_chat_threads%rowtype; u public.paige_chat_turns%rowtype; b jsonb; receipt uuid; payload jsonb;
begin
 perform public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'state');
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if (select count(*) from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent)<>1 then
  raise exception 'original runtime admission unavailable' using errcode='42501'; end if;
 select * into u from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent;
 b:=u.interactive_runtime_binding;
 if b is null or b->>'request_nonce' is distinct from p_request_nonce::text or u.interactive_runtime_shutdown is null
  or u.interactive_runtime_shutdown->>'attested_by' is distinct from 'postgres'
  or u.interactive_runtime_shutdown->'evidence'->>'request_nonce' is distinct from p_request_nonce::text
  or u.interactive_runtime_shutdown->'evidence'->>'execution_id' is distinct from b->>'execution_id'
  or u.interactive_runtime_shutdown->'evidence'->>'deployment_id' is distinct from b->>'deployment_id' then
  raise exception 'verified original runtime shutdown required' using errcode='42501'; end if;
 receipt:=u.interactive_runtime_recovery_receipt;
 if receipt is null then
  if t.interactive_executor_intent is distinct from p_intent or t.interactive_runtime_binding is distinct from b then
   raise exception 'original executor generation required' using errcode='42501'; end if;
  payload:=jsonb_build_object('interactive',jsonb_build_object('request_intent_id',p_intent,
   'recovery',jsonb_build_object('kind','platform_terminated','outcome','outcome_unknown')),
   'turn_state',jsonb_build_object('v',1,'state','INTERRUPTED','mode','pending'));
  receipt:=public.paige_chat_interactive_settle(p_thread,p_actor,p_tenant,p_intent,
   'This answer was interrupted. Any business actions from it still need their original records checked; they have not been retried.',
   null,null,payload,null);
  perform public.record_capability_run(p_tenant,p_actor,'chat_runtime_recovery','capability_outcome_unknown',receipt,
   null,null,null,null,jsonb_build_object('kind','platform_terminated','thread_id',p_thread,
    'intent_id',p_intent,'receipt_id',receipt,'effects_unknown',true));
 end if;
 if not exists(select 1 from public.paige_chat_turns where id=receipt and thread_id=p_thread and role='assistant'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent
  and interactive_terminal_state='INTERRUPTED'
  and bundle_ref->'interactive'->'recovery'=jsonb_build_object('kind','platform_terminated','outcome','outcome_unknown'))
  or not exists(select 1 from public.paige_workspace_events where tenant_id=p_tenant and actor_id=p_actor
   and source_kind='capability_run' and source_id=receipt and source_revision=0
   and capability_key='chat_runtime_recovery' and outcome='capability_outcome_unknown'
   and detail->>'receipt_id'=receipt::text) then
  raise exception 'recovery receipt readback unavailable'; end if;
 if u.interactive_runtime_recovery_receipt is null then
  -- The row lock spans receipt, Rail, release and hold publication. No caller can
  -- observe the intermediate release or use it to acquire an unbound successor.
  perform public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'release');
  if exists(select 1 from public.paige_chat_threads where id=p_thread and interactive_executor_intent=p_intent) then
   raise exception 'recovery executor release unavailable'; end if;
  update public.paige_chat_threads set interactive_recovery_hold=receipt,interactive_runtime_binding=null where id=p_thread;
  update public.paige_chat_turns set interactive_runtime_recovery_receipt=receipt where id=u.id;
 end if;
 return jsonb_build_object('receipt_id',receipt,'state','INTERRUPTED','outcome','outcome_unknown',
  'receipt_recorded',true,'recovery_read_only',true,'replayed',u.interactive_runtime_recovery_receipt is not null);
end $$;
revoke all on function public.paige_chat_interactive_recover_bound(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_recover_bound(uuid,uuid,uuid,uuid,uuid) to service_role;

commit;
