-- One explicit manual CONFIRM reminder, on the existing envelope and native writer.
-- This does not adopt AUTO work, historical consumed proposals, or unbound claims.
begin;

-- Internal functions have no API-role grants. The service adopter and original-JWT
-- executor use these checks; their JSON snapshots never substitute for them.
create or replace function private.paige_reminder_scope(
 p_actor uuid,p_tenant uuid,p_thread uuid,p_client uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.paige_chat_threads%rowtype;
begin
 if p_actor is null or p_tenant is null or p_thread is null then
  raise exception 'REMINDER_SCOPE_REQUIRED' using errcode='42501'; end if;
 perform 1 from auth.users where id=p_actor for share;
 if not found then raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=p_actor and active_tenant_id=p_tenant for update;
 if not found then raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 perform 1 from public.tenant_members where user_id=p_actor and tenant_id=p_tenant and status='active' for share;
 if not found then raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 -- Lock all current app-role rows so revocation cannot cross native validation/use.
 perform 1 from public.user_roles where user_id=p_actor for share;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant
  or t.audience is distinct from 'workspace' or t.is_archived
  or t.contact_id is not null or p_client is not null then
  raise exception 'REMINDER_THREAD_UNAVAILABLE' using errcode='42501'; end if;
end $$;
revoke all on function private.paige_reminder_scope(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.paige_reminder_runtime(
 p_actor uuid,p_tenant uuid,p_thread uuid,p_intent uuid,p_runtime_request_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.paige_chat_threads%rowtype; u public.paige_chat_turns%rowtype; e jsonb; b jsonb;
begin
 perform 1 from public.paige_chat_interactive_rollout where singleton and active for share;
 if not found then raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or p_intent is null
  or t.caller_user_id is distinct from p_actor or t.tenant_id is distinct from p_tenant
  or t.interactive_latest_intent is distinct from p_intent
  or t.interactive_executor_intent is distinct from p_intent
  or t.interactive_admitted_intent is distinct from p_intent or t.interactive_admission is not null
  or t.interactive_recovery_hold is not null then
  raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 e:=public.paige_chat_interactive_evidence(p_thread,p_actor,p_tenant,p_intent);
 if e->>'terminal' is distinct from 'false' or e->>'stopped' is distinct from 'false' then
  raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 b:=t.interactive_runtime_binding;
 select * into u from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent for share;
 if not found or (select count(*) from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent)<>1 then
  raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 -- A genuinely incumbent, unbound executor is the sole runtime compatibility
 -- exclusion. A malformed/stale/non-normal binding is an authority refusal.
 if b is null then
  if u.interactive_runtime_binding is not null then raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
  -- A missing nonce is truthful only for the proved incumbent unbound pair.
  -- This returns compatibility before consumption/work; it never permits effect.
  return null;
 end if;
 if p_runtime_request_nonce is null or b->>'v' is distinct from '1' or b->>'intent_id' is distinct from p_intent::text
  or b->>'request_nonce' is distinct from p_runtime_request_nonce::text
  or b->>'function_slug' is distinct from 'paige-ai-chat' or b->>'mode' is distinct from 'normal' then
  raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 if u.id::text is distinct from b->>'admission_turn_id' or u.interactive_runtime_binding is distinct from b then
  raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
 return b;
end $$;
revoke all on function private.paige_reminder_runtime(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.paige_reminder_args(p_args jsonb,p_tenant uuid)
returns jsonb language plpgsql stable set search_path='' set timezone='UTC' as $$
begin
 if jsonb_typeof(p_args) is distinct from 'object' or pg_column_size(p_args)>16384
  or exists(select 1 from jsonb_object_keys(p_args) k where k not in
   ('title','remind_at','target','target_user_id','channel','plan_id','summary','contact_id'))
  or jsonb_typeof(p_args->'title') is distinct from 'string'
  or jsonb_typeof(p_args->'remind_at') is distinct from 'string'
  or exists(select 1 from jsonb_each(p_args) a where a.key not in ('title','remind_at') and jsonb_typeof(a.value) not in ('string','null')) then
  raise exception 'REMINDER_APPROVAL_ARGS_INVALID' using errcode='22023'; end if;
 -- Exact incumbent Chat normalization; SMS/other channels do not gain authority.
 return jsonb_build_object('p_title',p_args->>'title','p_remind_at',(p_args->>'remind_at')::timestamptz,
  'p_target',coalesce(p_args->>'target','user'),'p_target_user_id',(p_args->>'target_user_id')::uuid,
  'p_channel',case when p_args->>'channel'='email' then 'email' else 'in_app' end,
  'p_plan_id',(p_args->>'plan_id')::uuid,'p_summary',p_args->>'summary',
  'p_contact_id',(p_args->>'contact_id')::uuid,'p_tenant_id',p_tenant);
end $$;
revoke all on function private.paige_reminder_args(jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function private.paige_reminder_policy(p_tenant uuid)
returns void language plpgsql security definer set search_path='' as $$
declare mode text;
begin
 -- Exact incumbent resolver inputs, in deterministic name order. NOWAIT bounds
 -- policy-write contention, including missing-row INSERT/UPSERT phantoms. Locks
 -- live only within this short native transaction; no HTTP/model work is held.
 lock table public.admin_app_settings,public.paige_systems_check_finding,
  public.paige_systems_check_registry,public.tenant_tool_autonomy in share mode nowait;
 mode:=public.resolve_tool_autonomy(p_tenant,'plan_set_reminder');
 if mode is null or mode not in ('auto','confirm') then
  raise exception 'REMINDER_AUTONOMY_UNAVAILABLE' using errcode='42501'; end if;
 -- Either allowed lane still spends ONLY the original explicit stored approval.
end $$;
revoke all on function private.paige_reminder_policy(uuid) from public,anon,authenticated,service_role;

create or replace function public.adopt_paige_reminder_approval(
 p_proposal_id uuid,p_actor uuid,p_tenant uuid,p_thread uuid,p_client uuid,
 p_fingerprint text,p_issued_nonce uuid,p_request_nonce uuid,p_intent uuid,p_runtime_request_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare p public.paige_pending_confirmations%rowtype; w public.paige_durable_work%rowtype;
 b jsonb; a jsonb; seal jsonb; made record; issued_before timestamptz;
begin
 if auth.uid() is not null and auth.uid() is distinct from p_actor then
  raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 if p_proposal_id is null or p_actor is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{16}$'
  or p_issued_nonce is null or p_request_nonce is null or p_issued_nonce=p_request_nonce then
  raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 -- Same lock order as execution (scope/thread, proposal, work). Compatibility
 -- classes below never create an envelope or grant permission to their old path.
 if p_tenant is not null and p_thread is not null and p_client is null
  and exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and status='active')
  and not exists(select 1 from public.paige_chat_threads where id=p_thread and contact_id is not null) then
  perform private.paige_reminder_scope(p_actor,p_tenant,p_thread,p_client);
 end if;
 select * into p from public.paige_pending_confirmations where id=p_proposal_id for update;
 if not found or p.user_id is distinct from p_actor or p.tenant_id is distinct from p_tenant
  or p.thread_id is distinct from p_thread or p.scoped_client_id is distinct from p_client
  or p.tool_name is distinct from 'plan_set_reminder' or p.fingerprint is distinct from p_fingerprint
  or p.issued_in_request is distinct from p_issued_nonce or p.server_issued_at is null then
  raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 a:=private.paige_reminder_args(p.args,p_tenant);
 -- Every compatibility response concerns a real, current, unconsumed proposal;
 -- an invalid/declined/expired/error result is never a legacy execution fallback.
 if p_tenant is null or p_thread is null or p_client is not null
  or exists(select 1 from public.paige_chat_threads where id=p_thread and contact_id is not null)
  or not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and status='active') then
  if p.consumed_at is not null or p.expires_at<=clock_timestamp() or not isfinite(p.expires_at)
   or not isfinite(p.server_issued_at) or p.server_issued_at>clock_timestamp() then
   raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
  perform private.paige_reminder_policy(p_tenant);
  if p_tenant is null and public.is_platform_owner(p_actor) then
   return jsonb_build_object('v',1,'status','unsupported','unsupported_reason','tenantless_native_compatibility','proposal_id',p.id); end if;
  if p_tenant is not null and not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and status='active')
   and ((public.is_company_workspace(p_tenant) and public.is_platform_admin(p_actor)) or public.is_platform_owner(p_actor)) then
   return jsonb_build_object('v',1,'status','unsupported','unsupported_reason','nonmember_native_compatibility','proposal_id',p.id); end if;
  if p_thread is null and p_tenant is not null and exists(select 1 from public.profiles where user_id=p_actor and active_tenant_id=p_tenant)
   and exists(select 1 from public.tenants where id=p_tenant and status='active')
   and exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=p_actor and status='active') then
   return jsonb_build_object('v',1,'status','unsupported','unsupported_reason','threadless_native_compatibility','proposal_id',p.id); end if;
 end if;
 -- Ordinary typed focus can lawfully differ from thread.contact_id. Its caller-
 -- RLS read remains on the incumbent path; this v1 adopter does not invent a
 -- replacement permission predicate. The exact proposal scope was checked above.
 if p_client is not null or exists(select 1 from public.paige_chat_threads where id=p_thread and contact_id is not null) then
  if p.consumed_at is not null or p.expires_at<=clock_timestamp()
   or not exists(select 1 from public.profiles where user_id=p_actor and active_tenant_id=p_tenant)
   or not exists(select 1 from public.tenant_members where user_id=p_actor and tenant_id=p_tenant and status='active')
   or not exists(select 1 from public.paige_chat_threads where id=p_thread and caller_user_id=p_actor
    and tenant_id=p_tenant and audience='workspace' and not is_archived) then
   raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
  perform private.paige_reminder_runtime(p_actor,p_tenant,p_thread,p_intent,p_runtime_request_nonce);
  return jsonb_build_object('v',1,'status','unsupported','unsupported_reason','client_focus_compatibility','proposal_id',p.id);
 end if;
 perform private.paige_reminder_scope(p_actor,p_tenant,p_thread,p_client);
 -- A lost adopter acknowledgement finds the exact already sealed envelope even
 -- after expiry; this is not consumed_at-only adoption or a second claim.
 select * into w from public.paige_durable_work where tenant_id=p_tenant and initiating_user_id=p_actor and intent_id=p.id for update;
 if found then
  if w.capability_key is distinct from 'planning.set_reminder' or w.work_kind is distinct from 'approved_reminder'
   or w.thread_id is distinct from p_thread or w.scope_epoch is distinct from p.id::text
   or w.request_payload->>'v' is distinct from '1'
   or w.request_payload->>'proposal_id' is distinct from p.id::text
   or w.request_payload->>'fingerprint' is distinct from p.fingerprint
   or w.request_payload->>'issued_nonce' is distinct from p.issued_in_request::text
   or w.request_payload->'client_id' is distinct from coalesce(to_jsonb(p_client),'null'::jsonb)
   or w.request_payload->>'original_thread_id' is distinct from p_thread::text
   or w.request_payload->'stored_args' is distinct from p.args or w.request_payload->'native_args' is distinct from a
   or w.request_payload->'consumed_at_epoch' is distinct from to_jsonb(extract(epoch from p.consumed_at))
   or p.consumed_at is null then
   raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
  -- No new worker/sweeper or retry: normalize only a positively sealed, never-
  -- dispatched expired claim. The held row serializes this with the one native
  -- execution transaction. Any terminal/correlation is a refusal, not evidence
  -- that a generic unknown result may be reconciled or executed again.
  if w.status='claimed' and w.dispatch_started_attempt=0 and w.lease_until<=now() then
   if w.terminal_outcome is not null or w.settled_at is not null or exists(
    select 1 from public.audit_logs where data->>'approved_reminder_work_id'=w.id::text)
    or exists(select 1 from public.paige_workspace_events where detail->>'work_id'=w.id::text
     or detail->>'approved_reminder_work_id'=w.id::text
     or (source_kind='capability_run' and capability_key='plan_set_reminder' and source_id=w.id)) then
    raise exception 'REMINDER_WORK_UNCONFIRMED' using errcode='55000'; end if;
   perform public.transition_paige_durable_work(w.id,w.idempotency_key,'expired',null,
    'The approved reminder was not recorded before its recovery window ended.',null,'approval_window_expired');
   select * into w from public.paige_durable_work where id=w.id;
  end if;
  return jsonb_build_object('v',1,'status','existing','work_id',w.id,'proposal_id',p.id,'work_status',w.status,'stored_args',p.args);
 end if;
 if p.consumed_at is not null or p.expires_at<=clock_timestamp() or not isfinite(p.expires_at)
  or not isfinite(p.server_issued_at) then
  raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 perform private.paige_reminder_policy(p_tenant);
 b:=private.paige_reminder_runtime(p_actor,p_tenant,p_thread,p_intent,p_runtime_request_nonce);
 select created_at into issued_before from public.paige_chat_turns where thread_id=p_thread and role='user'
  and interactive_actor_id=p_actor and interactive_tenant_id=p_tenant and interactive_intent_id=p_intent;
 if issued_before is null or p.server_issued_at>issued_before then raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 if b is null then
  return jsonb_build_object('v',1,'status','unsupported','unsupported_reason','unbound_runtime_compatibility','proposal_id',p.id); end if;
 update public.paige_pending_confirmations set consumed_at=clock_timestamp() where id=p.id and consumed_at is null returning * into p;
 if not found then raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 seal:=jsonb_build_object('v',1,'proposal_id',p.id,'fingerprint',p.fingerprint,'issued_nonce',p.issued_in_request,
  'consumed_at_epoch',extract(epoch from p.consumed_at),'client_id',p_client,'original_thread_id',p_thread,'stored_args',p.args,'native_args',a);
 select * into made from public.create_paige_durable_work(p_tenant,p_actor,p.id,p_thread,
  'planning.set_reminder','approved_reminder',jsonb_build_object('tenant_id',p_tenant,'actor_user_id',p_actor,
   'proposal_id',p.id,'admission_turn_id',b->>'admission_turn_id'),p.id::text,300,1);
 if made.resumed_existing then raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 update public.paige_durable_work set request_payload=seal where id=made.work_id and request_payload is null;
 if not found then raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 return jsonb_build_object('v',1,'status','adopted','work_id',made.work_id,'proposal_id',p.id,'work_status',made.work_status,'stored_args',p.args);
end $$;
revoke all on function public.adopt_paige_reminder_approval(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.adopt_paige_reminder_approval(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid) to service_role;

-- Opaque lookup only. A proposal UUID is not permission, and finding an envelope
-- never adopts, normalizes expiry, dispatches or establishes a verified terminal.
create or replace function public.resolve_paige_reminder_approval(
 p_proposal_id uuid,p_expected_tenant uuid,p_expected_thread uuid,p_expected_client uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare actor uuid:=auth.uid(); p public.paige_pending_confirmations%rowtype; w public.paige_durable_work%rowtype; a jsonb;
begin
 if actor is null then raise exception 'REMINDER_AUTH_REQUIRED' using errcode='42501'; end if;
 perform private.paige_reminder_scope(actor,p_expected_tenant,p_expected_thread,p_expected_client);
 if public.current_user_tenant_id() is distinct from p_expected_tenant or not public.is_tenant_member(p_expected_tenant) then
  raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 select * into p from public.paige_pending_confirmations where id=p_proposal_id for share;
 if not found or p.user_id is distinct from actor or p.tenant_id is distinct from p_expected_tenant
  or p.thread_id is distinct from p_expected_thread or p.scoped_client_id is distinct from p_expected_client
  or p.tool_name is distinct from 'plan_set_reminder' or p.consumed_at is null or not isfinite(p.consumed_at)
  or p.server_issued_at is null or not isfinite(p.server_issued_at) or p.server_issued_at>p.consumed_at
  or p.issued_in_request is null or p.fingerprint is null or p.fingerprint !~ '^[0-9a-f]{16}$' then
  raise exception 'REMINDER_APPROVAL_UNAVAILABLE' using errcode='42501'; end if;
 a:=private.paige_reminder_args(p.args,p_expected_tenant);
 select * into w from public.paige_durable_work where tenant_id=p_expected_tenant and initiating_user_id=actor and intent_id=p.id for share;
 if not found or (select count(*) from public.paige_durable_work
  where tenant_id=p_expected_tenant and initiating_user_id=actor and intent_id=p.id)<>1
  or w.capability_key is distinct from 'planning.set_reminder' or w.work_kind is distinct from 'approved_reminder'
  or w.thread_id is distinct from p_expected_thread or w.scope_epoch is distinct from p.id::text
  or w.request_payload->>'v' is distinct from '1' or w.request_payload->>'proposal_id' is distinct from p.id::text
  or w.request_payload->>'fingerprint' is distinct from p.fingerprint
  or w.request_payload->>'issued_nonce' is distinct from p.issued_in_request::text
  or w.request_payload->'client_id' is distinct from coalesce(to_jsonb(p_expected_client),'null'::jsonb)
  or w.request_payload->>'original_thread_id' is distinct from p_expected_thread::text
  or w.request_payload->'stored_args' is distinct from p.args or w.request_payload->'native_args' is distinct from a
  or w.request_payload->'consumed_at_epoch' is distinct from to_jsonb(extract(epoch from p.consumed_at)) then
  raise exception 'REMINDER_WORK_UNAVAILABLE' using errcode='42501'; end if;
 return jsonb_build_object('v',1,'proposal_id',p.id,'work_id',w.id,'work_status',w.status);
end $$;
revoke all on function public.resolve_paige_reminder_approval(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_paige_reminder_approval(uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.execute_paige_approved_reminder(
 p_work_id uuid,p_expected_tenant uuid,p_expected_thread uuid,p_expected_client uuid,p_intent uuid,p_runtime_request_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare actor uuid:=auth.uid(); w public.paige_durable_work%rowtype; p public.paige_pending_confirmations%rowtype;
 a jsonb; r jsonb; snap jsonb; terminal jsonb; row_after public.plan_items%rowtype;
 audit_id uuid; item_id uuid; assignee uuid; b jsonb; args_sha256 text;
begin
 if actor is null then raise exception 'REMINDER_AUTH_REQUIRED' using errcode='42501'; end if;
 perform private.paige_reminder_scope(actor,p_expected_tenant,p_expected_thread,p_expected_client);
 if public.current_user_tenant_id() is distinct from p_expected_tenant or not public.is_tenant_member(p_expected_tenant) then
  raise exception 'REMINDER_SCOPE_CHANGED' using errcode='42501'; end if;
 select * into w from public.paige_durable_work where id=p_work_id for update;
 if not found or w.tenant_id is distinct from p_expected_tenant or w.initiating_user_id is distinct from actor
  or w.thread_id is distinct from p_expected_thread or w.capability_key is distinct from 'planning.set_reminder'
  or w.work_kind is distinct from 'approved_reminder' or w.scope_epoch is distinct from w.intent_id::text
  or w.request_payload->>'v' is distinct from '1'
  or w.request_payload->>'proposal_id' is distinct from w.intent_id::text
  or w.request_payload->>'original_thread_id' is distinct from p_expected_thread::text
  or w.request_payload->'client_id' is distinct from coalesce(to_jsonb(p_expected_client),'null'::jsonb) then
  raise exception 'REMINDER_WORK_UNAVAILABLE' using errcode='42501'; end if;
 select * into p from public.paige_pending_confirmations where id=w.intent_id for share;
 if not found or p.user_id is distinct from actor or p.tenant_id is distinct from w.tenant_id
  or p.thread_id is distinct from w.thread_id or p.scoped_client_id is distinct from p_expected_client
  or p.tool_name is distinct from 'plan_set_reminder' or p.consumed_at is null
  or w.request_payload->>'fingerprint' is distinct from p.fingerprint
  or w.request_payload->>'issued_nonce' is distinct from p.issued_in_request::text
  or w.request_payload->'consumed_at_epoch' is distinct from to_jsonb(extract(epoch from p.consumed_at))
  or w.request_payload->'stored_args' is distinct from p.args then
  raise exception 'REMINDER_WORK_UNAVAILABLE' using errcode='42501'; end if;
 a:=private.paige_reminder_args(p.args,w.tenant_id);
 if w.request_payload->'native_args' is distinct from a then raise exception 'REMINDER_WORK_UNAVAILABLE' using errcode='42501'; end if;
 -- Canonical jsonb text from the protected immutable seal, not a retained raw
 -- argument copy. All three functions are built into pg_catalog (no extension).
 args_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((w.request_payload->'native_args')::text,'UTF8')),'hex');
 if w.status='succeeded' then
  terminal:=w.terminal_outcome;
  if terminal->>'verified_readback' is distinct from 'true' or terminal->>'receipt_version' is distinct from '1'
   or terminal->>'work_id' is distinct from w.id::text or terminal->'native_args' is distinct from a then
   raise exception 'REMINDER_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
  r:=terminal->'original_result'; snap:=terminal->'original_readback';
 else
  if w.status is distinct from 'claimed' or w.lease_until<=clock_timestamp() or p.expires_at<=clock_timestamp()
   or w.dispatch_started_attempt<>0 then raise exception 'REMINDER_NOT_DISPATCHABLE' using errcode='55000'; end if;
  b:=private.paige_reminder_runtime(actor,w.tenant_id,w.thread_id,p_intent,p_runtime_request_nonce);
  if b is null then raise exception 'REMINDER_RUNTIME_UNAVAILABLE' using errcode='42501'; end if;
  assignee:=case when a->>'p_target'='team' then null else coalesce((a->>'p_target_user_id')::uuid,actor) end;
  if assignee is not null then
   perform 1 from public.tenant_members where tenant_id=w.tenant_id and user_id=assignee and status='active' for share;
   if not found then raise exception 'PLAN_ASSIGNEE_NOT_IN_TENANT' using errcode='42501'; end if;
  end if;
  if a->>'p_plan_id' is not null then
   perform 1 from public.plans where id=(a->>'p_plan_id')::uuid and tenant_id=w.tenant_id for share;
   if not found then raise exception 'PLAN_NOT_IN_TENANT' using errcode='42501'; end if;
  end if;
  if a->>'p_contact_id' is not null then
   perform 1 from public.clients where id=(a->>'p_contact_id')::uuid and tenant_id=w.tenant_id for share;
   if not found then raise exception 'PLAN_CONTACT_NOT_IN_TENANT' using errcode='42501'; end if;
  end if;
  perform private.paige_reminder_policy(w.tenant_id);
  update public.paige_durable_work set dispatch_started_attempt=attempt_count where id=w.id;
  r:=public.plan_set_reminder(a->>'p_title',(a->>'p_remind_at')::timestamptz,a->>'p_target',
   (a->>'p_target_user_id')::uuid,a->>'p_channel',(a->>'p_plan_id')::uuid,a->>'p_summary',(a->>'p_contact_id')::uuid,w.tenant_id);
  item_id:=(r->>'item_id')::uuid; audit_id:=(r->>'receipt_run_id')::uuid;
  select * into row_after from public.plan_items where id=item_id and tenant_id=w.tenant_id;
  if not found or row_after.item_type is distinct from 'reminder' or row_after.created_by is distinct from actor
   or row_after.title is distinct from btrim(a->>'p_title') or row_after.summary is distinct from a->>'p_summary'
   or row_after.remind_at is distinct from (a->>'p_remind_at')::timestamptz
   or row_after.remind_target is distinct from a->>'p_target' or row_after.remind_channel is distinct from a->>'p_channel'
   or row_after.assigned_to_user_id is distinct from assignee or row_after.plan_id is distinct from (a->>'p_plan_id')::uuid
   or row_after.contact_id is distinct from (a->>'p_contact_id')::uuid or row_after.updated_at is null
   or (r->>'remind_at')::timestamptz is distinct from row_after.remind_at then
   raise exception 'REMINDER_READBACK_UNAVAILABLE' using errcode='55000'; end if;
  snap:=jsonb_build_object('item_id',item_id,'item_type','reminder','title',row_after.title,'summary',row_after.summary,
   'tenant_id',w.tenant_id,'created_by',actor,'remind_at',row_after.remind_at,'remind_target',row_after.remind_target,
   'remind_channel',row_after.remind_channel,'assigned_to_user_id',assignee,'plan_id',row_after.plan_id,
   'contact_id',row_after.contact_id,'source_version',row_after.updated_at);
  -- Correlate the original native audit without replicating private args into
  -- its different retention home. No second audit or second Rail is inserted.
  update public.audit_logs set data=data||jsonb_build_object('approved_reminder_work_id',w.id,'approved_reminder_args_sha256',args_sha256)
   where id=audit_id and entity='plan_item' and action='plan_set_reminder' and entity_id=item_id and user_id=actor
    and data->>'tenant_id'=w.tenant_id::text;
  if not found then raise exception 'REMINDER_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
 end if;
 item_id:=(r->>'item_id')::uuid; audit_id:=(r->>'receipt_run_id')::uuid;
 if r->>'ok' is distinct from 'true' or r->>'item_type' is distinct from 'reminder'
  or r->>'railRecorded' is distinct from 'true' or r->>'receipt_status' is distinct from 'recorded'
  or audit_id is null or item_id is null or snap->>'item_id' is distinct from item_id::text
  or not exists(select 1 from public.audit_logs where id=audit_id and entity='plan_item' and action='plan_set_reminder'
   and entity_id=item_id and user_id=actor and data->>'tenant_id'=w.tenant_id::text
   and data->>'approved_reminder_work_id'=w.id::text and data->>'approved_reminder_args_sha256'=args_sha256)
  or not exists(select 1 from public.paige_workspace_events where tenant_id=w.tenant_id and actor_id=actor
   and source_kind='capability_run' and source_id=audit_id and source_revision=0 and capability_key='plan_set_reminder'
   and outcome='capability_succeeded' and detail->>'audit_id'=audit_id::text and detail->>'record_id'=item_id::text
   and detail->>'record_table'='plan_items' and detail->>'operation'='plan_set_reminder'
   and detail->'source_version'=snap->'source_version') then
  raise exception 'REMINDER_RECEIPT_UNAVAILABLE' using errcode='55000'; end if;
 if w.status<>'succeeded' then
  terminal:=jsonb_build_object('verified_readback',true,'receipt_version',1,'work_id',w.id,'native_args',a,
   'original_result',r,'original_readback',snap);
  perform public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',terminal,'The approved reminder was recorded.');
 end if;
 return jsonb_build_object('v',1,'status','succeeded','receipt_version',1,'work_id',w.id,'proposal_id',w.intent_id,
  'replayed',w.status='succeeded','historical',w.status='succeeded','original_result',r,'original_readback',snap);
end $$;
revoke all on function public.execute_paige_approved_reminder(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.execute_paige_approved_reminder(uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

commit;
