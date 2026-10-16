-- Bounded contact.created -> reviewed owner.task, through the existing CRM writer.
-- No scheduler/store/grant/activation. Semantic equality, not edit-away-and-back detection.
begin;

-- Preserve the installed canonical reader's scope/role/hash/record checks in ONE
-- owner-only core. The public ABI, JWT boundary, owner and ACL remain unchanged.
do $migration$
declare definition text; rewritten text; reader_owner text; guard text := $guard$if coalesce(auth.jwt()->>'role','')<>'service_role' or auth.uid() is not null then raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode='42501'; end if;$guard$;
begin
  definition := pg_catalog.pg_get_functiondef('public.read_crm_command_result(uuid,uuid,jsonb,text)'::regprocedure);
  if (length(definition)-length(replace(definition,guard,'')))/length(guard) <> 1
    or position('CREATE OR REPLACE FUNCTION public.read_crm_command_result(' in definition) <> 1
    or position('_read_crm_command_result_scoped' in definition) <> 0
    or pg_catalog.to_regprocedure('public._read_crm_command_result_scoped(uuid,uuid,jsonb,text)') is not null then
    raise exception 'OWNER_TASK_READER_SOURCE_DRIFT';
  end if;
  rewritten := replace(definition,'CREATE OR REPLACE FUNCTION public.read_crm_command_result(',
    'CREATE OR REPLACE FUNCTION public._read_crm_command_result_scoped(');
  rewritten := replace(rewritten,guard,$guard$if auth.uid() is not null then raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode='42501'; end if;$guard$);
  execute rewritten;
  select pg_catalog.pg_get_userbyid(proowner) into reader_owner from pg_catalog.pg_proc
    where oid='public.read_crm_command_result(uuid,uuid,jsonb,text)'::regprocedure;
  execute pg_catalog.format('alter function public._read_crm_command_result_scoped(uuid,uuid,jsonb,text) owner to %I',reader_owner);
end $migration$;
revoke all on function public._read_crm_command_result_scoped(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.read_crm_command_result(_tenant_id uuid,_actor_id uuid,_command jsonb,_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or auth.uid() is not null then raise exception 'CRM_INTERNAL_EXECUTOR_REQUIRED' using errcode='42501'; end if;
  return public._read_crm_command_result_scoped(_tenant_id,_actor_id,_command,_idempotency_key);
end $$;

-- Native capture and current validation share this exact minimized projection.
-- Lock ALL acts before parent (including a moved-out act's own row), then event/
-- contact. The immediate parent FK and parent lock serialize new/moved-in acts.
create or replace function public._owner_task_source_snapshot(_event_id uuid,_act_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.paige_automation_acts; p public.paige_automations; e public.paige_native_events;
  c public.clients; chain jsonb; n integer; v jsonb;
begin
  if auth.uid() is not null then raise exception 'OWNER_TASK_INTERNAL_ONLY' using errcode='42501'; end if;
  select * into a from public.paige_automation_acts where id=_act_id;
  if not found then raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023'; end if;
  perform 1 from public.paige_automation_acts where automation_id=a.automation_id order by id for update nowait;
  select * into p from public.paige_automations where id=a.automation_id for update nowait;
  -- Re-read after the complete chain locks: a reparenting cannot certify mixed versions.
  select * into a from public.paige_automation_acts where id=_act_id and automation_id=p.id;
  select count(*),jsonb_agg(jsonb_build_object('id',x.id,'position',x.position,'action_kind',x.action_kind,
    'tool_key',x.tool_key,'config',x.config) order by x.position,x.id) into n,chain
    from public.paige_automation_acts x where x.automation_id=p.id;
  if p.id is null or a.id is null or n<>1 or a.action_kind is distinct from 'owner.task' or a.tool_key is not null
    or p.trigger_key is distinct from 'contact.created' or p.state is distinct from 'live' or p.granted_lane is distinct from 'confirm'
    or jsonb_typeof(a.config) is distinct from 'object' or jsonb_typeof(a.config->'title') is distinct from 'string'
    or coalesce(btrim(a.config->>'title'),'')='' or (a.config ? 'description' and jsonb_typeof(a.config->'description') is distinct from 'string')
    or exists(select 1 from jsonb_object_keys(a.config) k where k not in ('title','description')) then
    raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023';
  end if;
  select * into e from public.paige_native_events where id=_event_id for share nowait;
  if e.id is null or e.tenant_id is distinct from p.tenant_id or e.event_key is distinct from 'contact.created'
    or e.subject_table is distinct from 'clients' or e.dedup_key is distinct from 'contact.created:'||e.subject_id::text
    or e.payload->>'contact_id' is distinct from e.subject_id::text then
    raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023';
  end if;
  select * into c from public.clients where id=e.subject_id and tenant_id=p.tenant_id for update nowait;
  if c.id is null then raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023'; end if;
  v:=jsonb_build_object('v',1,'process',jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'name',p.name,
    'category',p.category,'trigger_key',p.trigger_key,'trigger_config',p.trigger_config,'conditions',p.conditions,
    'created_by',p.created_by,'state',p.state,'granted_lane',p.granted_lane),'acts',chain,
    'event',jsonb_build_object('id',e.id,'tenant_id',e.tenant_id,'event_key',e.event_key,
      'subject_table',e.subject_table,'subject_id',e.subject_id,'dedup_key',e.dedup_key,'contact_id',e.payload->'contact_id'),
    'contact',jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'updated_at',c.updated_at,'status',c.status));
  return v;
end $$;
revoke all on function public._owner_task_source_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

-- Capture only at FIRST held insert, never from JSON authority or a later approval.
-- A pre-existing held row without this evidence stays unsupported; no backfill.
create or replace function public.paige_owner_task_hold_context()
returns trigger language plpgsql security definer set search_path='' as $$
declare snap jsonb;
begin
  if tg_op='INSERT' then
    new.detail:=coalesce(new.detail,'{}'::jsonb)-'owner_task_source';
    if new.capability_key='owner.task' and new.outcome::text='approval_pending' then
      new.detail:=new.detail-'approved_by'-'approved_at';
      if new.adapter_kind is distinct from 'native' or new.effective_lane is distinct from 'confirm' then
        raise exception 'OWNER_TASK_CONFIRM_REQUIRED' using errcode='42501';
      end if;
      snap:=public._owner_task_source_snapshot(new.event_id,new.act_id);
      if snap#>>'{process,id}' is distinct from new.automation_id::text or snap#>>'{process,tenant_id}' is distinct from new.tenant_id::text
        or snap#>>'{acts,0,id}' is distinct from new.act_id::text or snap#>>'{acts,0,position}' is distinct from new.act_position::text
        or snap#>'{acts,0,config}' is distinct from new.detail->'snapshot_args' then
        raise exception 'OWNER_TASK_SOURCE_CHANGED' using errcode='22023';
      end if;
      new.detail:=new.detail||jsonb_build_object('owner_task_source',snap);
    end if;
  elsif old.detail ? 'owner_task_source' then
    if new.detail->'owner_task_source' is distinct from old.detail->'owner_task_source'
      or new.detail->'snapshot_args' is distinct from old.detail->'snapshot_args'
      or (old.detail ? 'approved_by' and (new.detail->'approved_by' is distinct from old.detail->'approved_by'
        or new.detail->'approved_at' is distinct from old.detail->'approved_at'))
      or row(new.event_id,new.act_id,new.automation_id,new.tenant_id,new.capability_key,new.idempotency_key,new.correlation_ref,new.effective_lane,new.adapter_kind,new.act_position)
        is distinct from row(old.event_id,old.act_id,old.automation_id,old.tenant_id,old.capability_key,old.idempotency_key,old.correlation_ref,old.effective_lane,old.adapter_kind,old.act_position) then
      raise exception 'OWNER_TASK_HELD_CONTEXT_IMMUTABLE' using errcode='42501';
    end if;
  elsif new.detail ? 'owner_task_source' then
    raise exception 'OWNER_TASK_LEGACY_CONTEXT_UNAVAILABLE' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.paige_owner_task_hold_context() from public,anon,authenticated,service_role;
create trigger paige_owner_task_hold_context before insert or update on public.paige_act_executions
for each row execute function public.paige_owner_task_hold_context();

-- Owner-only internal reader: called by the existing protected cron reconciler
-- and the service-JWT wrapper below. No invented JWT, no caller actor override.
create or replace function public._read_owner_task_act(_event_id uuid,_act_id uuid,_correlation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.paige_act_executions; actor uuid; args jsonb; r jsonb;
begin
  if auth.uid() is not null then raise exception 'OWNER_TASK_INTERNAL_ONLY' using errcode='42501'; end if;
  select * into l from public.paige_act_executions where event_id=_event_id and act_id=_act_id;
  if l.id is null or l.capability_key is distinct from 'owner.task' or l.effective_lane is distinct from 'confirm'
    or l.correlation_ref is distinct from _correlation or l.idempotency_key is distinct from _correlation
    or l.detail#>>'{owner_task_source,v}' is distinct from '1'
    or l.detail#>>'{owner_task_source,event,id}' is distinct from _event_id::text
    or l.detail#>>'{owner_task_source,process,id}' is distinct from l.automation_id::text
    or l.detail#>>'{owner_task_source,process,tenant_id}' is distinct from l.tenant_id::text
    or l.detail#>'{owner_task_source,acts,0,config}' is distinct from l.detail->'snapshot_args'
    or coalesce(l.detail->>'approved_by','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not(l.detail ? 'approved_at')
    or not exists(select 1 from public.paige_pending_approvals where source='paige_orchestration'
      and tenant_id=l.tenant_id and metadata->>'event_id'=_event_id::text and metadata->>'act_id'=_act_id::text
      and metadata->>'act_execution_id'=l.id::text) then return jsonb_build_object('state','unknown'); end if;
  actor:=(l.detail->>'approved_by')::uuid; args:=l.detail->'snapshot_args';
  r:=public._read_crm_command_result_scoped(l.tenant_id,actor,
    jsonb_build_object('action','task.create','approval_channel','operator_card','patch',args),l.idempotency_key);
  if r is null then return jsonb_build_object('state','absent'); end if;
  if r->>'action' is distinct from 'task.create' or r->>'outcome' is distinct from 'succeeded'
    or r->'ok' is distinct from 'true'::jsonb or r->'receipt_recorded' is distinct from 'true'::jsonb
    or r#>>'{readback,assignee_user_id}' is distinct from actor::text
    or r#>>'{readback,title}' is distinct from btrim(args->>'title')
    or r#>>'{readback,description}' is distinct from nullif(btrim(args->>'description'),'')
    or r#>'{readback,external_effect}' is distinct from 'false'::jsonb
    or r#>'{readback,notification_sent}' is distinct from 'false'::jsonb then return jsonb_build_object('state','unknown'); end if;
  return jsonb_build_object('state','found','result',r,'actor_id',actor);
exception when others then return jsonb_build_object('state','unknown');
end $$;
revoke all on function public._read_owner_task_act(uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.read_owner_task_act(_event_id uuid,_act_id uuid,_correlation text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or auth.uid() is not null then raise exception 'OWNER_TASK_INTERNAL_ONLY' using errcode='42501'; end if;
  return public._read_owner_task_act(_event_id,_act_id,_correlation);
end $$;
revoke all on function public.read_owner_task_act(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_owner_task_act(uuid,uuid,text) to service_role;

create or replace function public.execute_owner_task_act(_event_id uuid,_act_id uuid,_correlation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.paige_act_executions; l public.paige_act_executions; companion public.paige_pending_approvals;
  actor uuid; snap jsonb; prior jsonb; posture jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' or auth.uid() is not null then raise exception 'OWNER_TASK_INTERNAL_ONLY' using errcode='42501'; end if;
  begin
  select * into before_row from public.paige_act_executions where event_id=_event_id and act_id=_act_id;
  if before_row.id is null or before_row.capability_key is distinct from 'owner.task'
    or coalesce(before_row.detail->>'approved_by','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or before_row.detail#>>'{owner_task_source,v}' is distinct from '1' then
    return jsonb_build_object('outcome','failed','reason','native_approval_required');
  end if;
  actor:=(before_row.detail->>'approved_by')::uuid;
  -- Preserve canonical CRM tenant -> profile -> seat order before domain locks.
  perform 1 from public.tenants where id=before_row.tenant_id for update nowait;
  if not exists(select 1 from public.tenants where id=before_row.tenant_id and archived_at is null
    and not coalesce(lifecycle_execution_paused,false)) then
    return jsonb_build_object('outcome','failed','reason','tenant_not_executable');
  end if;
  perform 1 from public.profiles where user_id=actor for update nowait;
  perform 1 from public.tenant_members where tenant_id=before_row.tenant_id and user_id=actor for update nowait;
  select * into companion from public.paige_pending_approvals where source='paige_orchestration'
    and tenant_id=before_row.tenant_id and metadata->>'event_id'=_event_id::text
    and metadata->>'act_id'=_act_id::text and metadata->>'act_execution_id'=before_row.id::text for update nowait;
  select * into l from public.paige_act_executions where id=before_row.id for update nowait;
  if companion.id is null or companion.status is distinct from 'pending'
    or row(l.tenant_id,l.idempotency_key,l.detail->>'approved_by') is distinct from row(before_row.tenant_id,before_row.idempotency_key,actor::text)
    or l.outcome::text not in ('accepted_for_execution','retrying') or l.effective_lane is distinct from 'confirm'
    or l.correlation_ref is distinct from _correlation or l.idempotency_key is distinct from _correlation
    or coalesce(l.detail->>'dispatch_claim','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not pg_catalog.pg_input_is_valid(coalesce(l.detail->>'dispatch_claimed_at',''),'timestamptz') then
    return jsonb_build_object('outcome','failed','reason','native_approval_required');
  end if;
  if (l.detail->>'dispatch_claimed_at')::timestamptz < clock_timestamp()-interval '10 minutes'
    or (l.detail->>'dispatch_claimed_at')::timestamptz > clock_timestamp()+interval '1 minute' then
    return jsonb_build_object('outcome','accepted_for_execution','proven_no_effect',true,'reason','dispatch_claim_required');
  end if;
  prior:=public._read_owner_task_act(_event_id,_act_id,_correlation);
  if prior->>'state'='found' then return prior; end if;
  if prior->>'state' is distinct from 'absent' then return jsonb_build_object('state','unknown'); end if;
  snap:=public._owner_task_source_snapshot(_event_id,_act_id);
  if snap is distinct from l.detail->'owner_task_source' then
    return jsonb_build_object('outcome','failed','reason','reviewed_context_changed');
  end if;
  posture:=public.resolve_automation_autonomy(l.automation_id);
  if posture->'found' is distinct from 'true'::jsonb or posture->>'state' is distinct from 'live'
    or posture->>'effective' is distinct from 'confirm' then
    return jsonb_build_object('outcome','failed','reason','process_not_executable');
  end if;
  perform public.execute_crm_command(l.tenant_id,actor,
    jsonb_build_object('action','task.create','approval_channel','operator_card','patch',l.detail->'snapshot_args'),l.idempotency_key);
  return public._read_owner_task_act(_event_id,_act_id,_correlation);
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    -- This exception subtransaction rolled back every possible effect. Retain the
    -- accepted state so existing C5 can prove absence/gate/claim again on retry.
    return jsonb_build_object('outcome','accepted_for_execution','proven_no_effect',true,'reason','context_locked');
  when invalid_parameter_value or insufficient_privilege then
    return jsonb_build_object('outcome','failed','reason','canonical_rejection');
  when others then return jsonb_build_object('state','unknown');
  end;
end $$;
revoke all on function public.execute_owner_task_act(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.execute_owner_task_act(uuid,uuid,text) to service_role;

-- Extend the incumbent sweep in place. A task's result has THREE states. Neither
-- an error/revocation nor age is task absence; never use a journey transition.
do $migration$
declare definition text; anchor text := $anchor$      select * into _ev from public.paige_native_events ev where ev.id = _cur.event_id;$anchor$;
  arm text := $arm$
      if _cur.capability_key='owner.task' then
        declare task_read jsonb; task_row public.paige_act_executions;
        begin
          task_read:=public._read_owner_task_act(_cur.event_id,_cur.act_id,_cur.correlation_ref);
          if task_read->>'state'='found' then
            task_row:=public.paige_record_act_execution(_cur.event_id,_cur.automation_id,_cur.act_id,_cur.act_position,_cur.tenant_id,
              _cur.adapter_kind,_cur.capability_key,_cur.effective_lane,'executed'::public.paige_act_outcome,null,
              _cur.idempotency_key,_cur.correlation_ref,null,jsonb_build_object('reconciled_via','native_owner_task_result'),null,null,now());
            if task_row.outcome::text='executed' then
              update public.paige_pending_approvals set status='approved',reviewed_at=now(),claimed_at=null,
                metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('act_outcome','executed','executed',true,'execute_note','resolved by durable reconciler')
              where source='paige_orchestration' and tenant_id=_cur.tenant_id and metadata->>'event_id'=_cur.event_id::text
                and metadata->>'act_id'=_cur.act_id::text and status='pending';
              _advanced:=_advanced+1;
            end if;
          else
            update public.paige_act_executions set detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
              'recovery_checked_at',now(),'owner_task_readback',coalesce(task_read->>'state','unknown')) where id=_cur.id;
          end if;
        end;
        continue;
      end if;
$arm$;
begin
  definition:=pg_catalog.pg_get_functiondef('public.paige_reconcile_orchestration_acts()'::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'OWNER_TASK_RECONCILER_SOURCE_DRIFT'; end if;
  execute replace(definition,anchor,anchor||arm);
end $migration$;
commit;
