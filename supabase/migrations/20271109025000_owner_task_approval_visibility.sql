-- Restore only the native owner.task companion's ordinary workspace owner/admin
-- read/decline binding. Existing global-role policies and execution stay intact.
-- Read/rejection use the immutable stored hold, not current process readiness:
-- pausing/revising a process must never conceal or prevent rejecting its old hold.
create function public.can_read_owner_task_approval(_approval_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; a public.paige_pending_approvals; l public.paige_act_executions;
begin
  if actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return false; end if;
  tenant:=public.current_user_tenant_id();
  if tenant is null or not exists(select 1 from public.tenant_members m
    where m.tenant_id=tenant and m.user_id=actor and m.status='active' and m.role in('owner','admin'))
    or not exists(select 1 from public.profiles p where p.user_id=actor and p.active_tenant_id=tenant)
    or not exists(select 1 from auth.users u where u.id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())) then return false; end if;
  select * into a from public.paige_pending_approvals where id=_approval_id;
  if a.id is null or a.tenant_id is distinct from tenant or a.source is distinct from 'paige_orchestration'
    or a.category is distinct from 'owner.task' or a.type is distinct from 'other'
    -- The native producer never writes these cross-domain bindings. Even a
    -- null key is not a canonical task; ordinary review/recovery notes survive.
    or a.metadata ?| array['action_id','governed_send']
    or a.metadata->>'source' is distinct from 'paige_orchestration'
    or a.metadata->>'capability_id' is distinct from 'owner.task'
    or not pg_catalog.pg_input_is_valid(coalesce(a.metadata->>'act_execution_id',''),'uuid') then return false; end if;
  -- PK lookup, then indexed occurrence/counterpart checks; no all-tenant reader.
  select * into l from public.paige_act_executions where id=(a.metadata->>'act_execution_id')::uuid;
  if l.id is null or l.tenant_id is distinct from tenant or l.adapter_kind is distinct from 'native'
    or l.capability_key is distinct from 'owner.task' or l.effective_lane is distinct from 'confirm'
    or l.event_id::text is distinct from a.metadata->>'event_id'
    or l.act_id::text is distinct from a.metadata->>'act_id'
    or l.automation_id::text is distinct from a.metadata->>'automation_id'
    or l.detail#>>'{owner_task_source,v}' is distinct from '1'
    or l.detail#>>'{owner_task_source,event,id}' is distinct from l.event_id::text
    or l.detail#>>'{owner_task_source,process,id}' is distinct from l.automation_id::text
    or l.detail#>>'{owner_task_source,process,tenant_id}' is distinct from tenant::text
    or jsonb_typeof(l.detail->'owner_task_approval') is distinct from 'object'
    or public._owner_task_approval_projection(a) is distinct from l.detail->'owner_task_approval'
    or (select count(*) from public.paige_act_executions x where x.event_id=l.event_id and x.act_id=l.act_id)<>1
    or (select count(*) from public.paige_pending_approvals x where x.source='paige_orchestration'
      and x.metadata->>'event_id'=l.event_id::text and x.metadata->>'act_id'=l.act_id::text)<>1 then return false; end if;
  return true;
end $$;
alter function public.can_read_owner_task_approval(uuid) owner to postgres;
revoke all on function public.can_read_owner_task_approval(uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_read_owner_task_approval(uuid) to authenticated;
create policy "Native owner task seat read" on public.paige_pending_approvals
for select to authenticated using(public.can_read_owner_task_approval(id));

-- Add the real CAS version LAST. Every incumbent column/order/security_invoker,
-- owner and grant survives CREATE OR REPLACE; no underlying read policy changes.
create or replace view public.paige_approval_queue_v with(security_invoker=true) as
select a.id,a.type,a.category,a.status,a.priority,a.risk_level,a.summary,a.source,a.requires_role,a.tenant_id,
  a.contact_id,a.conversation_id,a.assigned_to_user_id,a.submitted_by_user_id,a.visible_to_roles,a.sla_due_at,
  a.created_at,a.reviewed_at,a.sent_at,a.draft_content,a.metadata,
  c.first_name as contact_first_name,c.last_name as contact_last_name,
  (select m.value from public.client_contact_methods m where m.client_id=c.id and m.kind='email' and m.is_primary
    order by m.position limit 1) as contact_email,c.lifecycle_stage as contact_lifecycle_stage,
  (extract(epoch from(now()-a.created_at)))::integer as age_seconds,
  case when a.status<>'pending' then 'closed' when a.sla_due_at is null then 'unscheduled'
    when a.sla_due_at<now() then 'overdue' when a.sla_due_at<now()+interval '2 hours' then 'due_soon' else 'on_track' end as sla_state,
  a.updated_at
from public.paige_pending_approvals a left join public.clients c on c.id=a.contact_id;

-- The only new write door rejects one exact still-held task. No caller actor,
-- tenant, argument or status parameter; no UPDATE privilege/policy is added.
create function public.decline_owner_task_approval(_approval_id uuid,_expected_updated_at timestamptz,_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; a public.paige_pending_approvals; l public.paige_act_executions;
  initial public.paige_pending_approvals; rail public.paige_workspace_events; reason text:=btrim(_reason); replay boolean:=false;
begin
  if actor is null or not public.can_read_owner_task_approval(_approval_id) then
    raise exception 'OWNER_TASK_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  tenant:=public.current_user_tenant_id();
  select * into initial from public.paige_pending_approvals where id=_approval_id;
  -- Match incumbent CRM/native lock order. NOWAIT prevents deadlocking a claimed
  -- approval/dispatch; recheck current authority and immutable companion afterward.
  perform 1 from public.tenants where id=tenant for update nowait;
  perform 1 from public.profiles where user_id=actor for update nowait;
  perform 1 from public.tenant_members where tenant_id=tenant and user_id=actor for update nowait;
  perform 1 from auth.users where id=actor for share nowait;
  select * into a from public.paige_pending_approvals where id=_approval_id for update nowait;
  select * into l from public.paige_act_executions where id=(initial.metadata->>'act_execution_id')::uuid for update nowait;
  if not public.can_read_owner_task_approval(_approval_id) or a.tenant_id is distinct from tenant
    or l.id::text is distinct from a.metadata->>'act_execution_id' then
    raise exception 'OWNER_TASK_APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if a.status='rejected' and l.outcome='cancelled' and l.refusal_code='approval_rejected' then
    replay:=true; -- Read original decision/receipt; never rewrite reviewer/reason.
  else
    if _expected_updated_at is null or not isfinite(_expected_updated_at) or a.updated_at is distinct from _expected_updated_at
      or a.status is distinct from 'pending' or a.claimed_at is not null or a.sent_at is not null
      or l.outcome is distinct from 'approval_pending' or l.dispatched_at is not null or l.provider_ref is not null
      or l.detail ? 'dispatch_claim' or l.detail ? 'approved_by' then
      raise exception 'OWNER_TASK_APPROVAL_CHANGED' using errcode='40001'; end if;
    if reason is null or length(reason)=0 or length(reason)>2000 then
      raise exception 'OWNER_TASK_DECLINE_REASON_INVALID' using errcode='22023'; end if;
    update public.paige_pending_approvals set status='rejected',decision_rationale=reason,
      reviewed_at=clock_timestamp(),reviewed_by_user_id=actor
      where id=a.id and status='pending' and claimed_at is null and updated_at=_expected_updated_at returning * into a;
    if a.id is null then raise exception 'OWNER_TASK_APPROVAL_CHANGED' using errcode='40001'; end if;
    -- The incumbent AFTER status trigger, not this wrapper, cancels the act.
    select * into l from public.paige_act_executions where id=l.id;
    if l.outcome is distinct from 'cancelled' or l.refusal_code is distinct from 'approval_rejected' then
      raise exception 'OWNER_TASK_DECLINE_UNCONFIRMED' using errcode='23514'; end if;
    -- Decision identity is the existing approval UUID, distinct from the existing
    -- execution receipt seed. Content/rationale never crosses into Rail detail.
    perform public.record_capability_run(tenant,actor,'crm_create_task','capability_refused',a.id,null,null,null,null,
      jsonb_build_object('reason','owner_declined','approval_id',a.id,'event_id',l.event_id,'act_id',l.act_id,
        'act_execution_id',l.id,'correlation_ref',l.correlation_ref));
  end if;
  select * into rail from public.paige_workspace_events where tenant_id=tenant and source_kind='capability_run'
    and source_id=a.id and source_revision=0 and outcome='capability_refused';
  if rail.id is null or rail.capability_key is distinct from 'crm_create_task' or rail.actor_id is distinct from a.reviewed_by_user_id
    or rail.detail is distinct from jsonb_build_object('reason','owner_declined','approval_id',a.id,'event_id',l.event_id,
      'act_id',l.act_id,'act_execution_id',l.id,'correlation_ref',l.correlation_ref) then
    raise exception 'OWNER_TASK_DECLINE_RECEIPT_UNCONFIRMED' using errcode='23514'; end if;
  return jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'status',a.status,'decision_rationale',a.decision_rationale,
    'reviewed_at',a.reviewed_at,'reviewed_by_user_id',a.reviewed_by_user_id,'updated_at',a.updated_at,
    'act_outcome',l.outcome,'receipt_recorded',true,'receipt_id',rail.id,'replayed',replay);
end $$;
alter function public.decline_owner_task_approval(uuid,timestamptz,text) owner to postgres;
revoke all on function public.decline_owner_task_approval(uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.decline_owner_task_approval(uuid,timestamptz,text) to authenticated;
