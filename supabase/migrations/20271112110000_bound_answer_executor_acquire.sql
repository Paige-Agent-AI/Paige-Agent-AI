-- Bound-answer executor acquire (2026-10-19 live incident, thread ad0e6231).
--
-- paige_chat_interactive_acquire_bound required EXACTLY ONE admitted user turn
-- carrying the acquiring intent. A TYPED ANSWER to an open question is admitted by
-- begin_v2 as a BOUND ANSWER, which deliberately writes NO user row (its claim is
-- appended at the model call; with supersedes it leaves only the empty system
-- admission marker, without supersedes nothing at all). So every interview answer
-- since the database-executor-isolation activation died with
-- 'runtime admission unavailable' -> INTERACTIVE_AUTHORITY_UNAVAILABLE 409 before
-- the model: the first exchange (a plain message, which does carry its admission
-- user row) worked, and every subsequent answer to PAIGE's question failed — the
-- exact customer-blocking Meet PAIGE defect.
--
-- The fix recognizes the bound-answer admission shape: the intent IS this thread's
-- admitted intent and begin left no user row for it. In that shape the acquire
-- proceeds through the same incumbent executor with the same pre-registration
-- fence; the only difference is that there is no admission turn to bind, so the
-- binding lives on the thread alone (the claim turn, appended at the model call,
-- remains the transcript's record of the answer). Every other guard — workspace
-- scope, runtime identity shape, executor/latest/terminal/stopped state, the
-- pre-registration + acquire atomic pair, and the read-only-recovery mode — is
-- unchanged. A count greater than 1 remains an error, and an intent the thread
-- never admitted still raises 'runtime admission unavailable'.

create or replace function public.paige_chat_interactive_acquire_bound(
 p_thread uuid,p_actor uuid,p_tenant uuid,p_intent uuid,p_request_nonce uuid,p_execution_id uuid,p_deployment_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare state jsonb; t public.paige_chat_threads%rowtype; admitted public.paige_chat_turns%rowtype;
 binding jsonb; count_rows integer; prior jsonb; bound_answer_admission boolean;
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
 if count_rows>1 then raise exception 'runtime admission unavailable' using errcode='42501'; end if;
 -- Bound-answer admission: begin_v2 admitted THIS intent and left no user row for
 -- it (the answer's claim is appended later, at the model call). Only begin sets
 -- interactive_admitted_intent, so this shape cannot be forged by a caller.
 bound_answer_admission := count_rows=0 and t.interactive_admitted_intent is not distinct from p_intent;
 if not bound_answer_admission and count_rows<>1 then
  raise exception 'runtime admission unavailable' using errcode='42501'; end if;
 if count_rows=1 then
  select * into admitted from public.paige_chat_turns where thread_id=p_thread and role='user'
   and interactive_intent_id=p_intent and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant for update;
  if admitted.interactive_runtime_binding is not null then
   raise exception 'runtime admission already bound' using errcode='42501'; end if;
 end if;
 binding:=jsonb_build_object('v',1,'intent_id',p_intent,
  'admission_turn_id',case when count_rows=1 then admitted.id end,
  'request_nonce',p_request_nonce,'execution_id',p_execution_id,'deployment_id',p_deployment_id,
  'function_slug','paige-ai-chat','bound_at',clock_timestamp(),
  'mode',case when t.interactive_recovery_hold is not null then 'read_only_recovery' else 'normal' end)
  ||case when bound_answer_admission then jsonb_build_object('admission','bound_answer') else '{}'::jsonb end;
 prior:=t.interactive_runtime_binding;
 -- Private pre-registration and incumbent acquire commit together. The CHECK
 -- fence sees this registration; no old frame/caller can create one itself.
 update public.paige_chat_threads set interactive_runtime_binding=binding where id=p_thread;
 state:=public.paige_chat_interactive_executor_v2(p_thread,p_actor,p_tenant,p_intent,'acquire');
 if (state->>'acquired')::boolean then
  if count_rows=1 then
   update public.paige_chat_turns set interactive_runtime_binding=binding where id=admitted.id;
  end if;
 else
  update public.paige_chat_threads set interactive_runtime_binding=prior where id=p_thread;
 end if;
 return state||jsonb_build_object('recovery_read_only',t.interactive_recovery_hold is not null);
end $$;
revoke all on function public.paige_chat_interactive_acquire_bound(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.paige_chat_interactive_acquire_bound(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- P1-2 companion: bind the answer's CLAIM turn to the bound-answer runtime.
--
-- A bound answer's acquire leaves a thread-only binding (there is no admission turn
-- yet). The claim user turn is appended by the handler immediately before the model
-- call; this AFTER INSERT trigger stamps that turn in the SAME transaction as the
-- append — intent, actor/tenant (from the locked thread row), and the runtime
-- binding with admission_turn_id back-filled to the claim turn on BOTH the turn
-- and the thread (attest/recover require the turn's binding to name the turn) —
-- so the J19 recovery chain (private.paige_chat_attest_runtime_shutdown and
-- paige_chat_interactive_recover_bound, keyed to exactly one bound user turn)
-- can attest and recover a runtime that dies mid-answer.
--
-- RESIDUAL WINDOW (accepted, documented): a hard runtime death between the bound
-- acquire and the claim append leaves the executor held with no bound user turn;
-- attest/recover still refuse and the thread stays held until an operator
-- intervenes. Closing it means teaching attest/recover the thread-level
-- bound_answer binding when no claim exists (the ask was never claimed); filed
-- as the follow-up, not silently assumed away.
--
-- Shape gates: a user turn carrying an answer claim key, still unstamped, on a
-- thread whose CURRENT binding is this admitted intent's bound-answer binding
-- while the executor still holds it, and no turn already stamped for that intent
-- (exactly-one, matching what attest/recover require). The interactive columns
-- remain server-owned: the trigger is SECURITY DEFINER (postgres), and a caller
-- cannot reach this shape — the thread binding only exists after the service-side
-- bound acquire.

create or replace function public.paige_chat_answer_claim_bind()
returns trigger language plpgsql security definer set search_path='' as $$
declare t public.paige_chat_threads%rowtype; b jsonb;
begin
 if new.role is distinct from 'user' or new.interactive_intent_id is not null
  or new.interactive_runtime_binding is not null
  or coalesce(new.bundle_ref->'paige_resume'->>'key','') !~ '^answer:[0-9a-f-]{36}$' then
  return null; end if;
 select * into t from public.paige_chat_threads where id=new.thread_id for update;
 if t.interactive_admitted_intent is null or t.interactive_runtime_binding is null
  or t.interactive_runtime_binding->>'admission' is distinct from 'bound_answer'
  or t.interactive_runtime_binding->>'intent_id' is distinct from t.interactive_admitted_intent::text
  or t.interactive_executor_intent is distinct from t.interactive_admitted_intent then
  return null; end if;
 if exists(select 1 from public.paige_chat_turns
  where thread_id=new.thread_id and interactive_intent_id=t.interactive_admitted_intent) then
  return null; end if;
 b := t.interactive_runtime_binding || jsonb_build_object('admission_turn_id', new.id);
 update public.paige_chat_turns
    set interactive_intent_id=t.interactive_admitted_intent,
        interactive_actor_id=t.caller_user_id,
        interactive_tenant_id=t.tenant_id,
        interactive_runtime_binding=b
  where id=new.id;
 update public.paige_chat_threads
    set interactive_runtime_binding=b
  where id=new.thread_id;
 return null;
end $$;
revoke all on function public.paige_chat_answer_claim_bind() from public,anon,authenticated,service_role;

create or replace trigger paige_chat_answer_claim_bind
 after insert on public.paige_chat_turns
 for each row execute function public.paige_chat_answer_claim_bind();
