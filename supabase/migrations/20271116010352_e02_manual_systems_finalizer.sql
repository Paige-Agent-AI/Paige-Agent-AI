-- Bound the existing server-only finalizer to verified manual Systems records.
-- E05 source window ANT-161/3b5f49aa. No new callable, privilege or activation.
-- Forward order: after E09 20271116010309, subject to fresh frontier disposition.
BEGIN;
DO $migration$
DECLARE
  original record;
  expected CONSTANT text := $body$
declare
  _row public.paige_durable_work%rowtype;
  _allowed boolean := false;

  _manual_identity public.paige_durable_work%rowtype;
  _manual_now timestamptz;
  _manual_budget timestamptz;
  _manual_run public.paige_systems_check_run%rowtype;
  _manual_total bigint;
  _manual_unique bigint;
  _manual_pass bigint;
  _manual_fail bigint;
  _manual_bad bigint;
  _manual_result jsonb;
  _manual_detail jsonb;
begin
  if _new_status not in ('claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown') then
    raise exception 'DURABLE_WORK_STATUS_INVALID' using errcode = '22023';
  end if;
  if _lease_seconds not between 30 and 3600 then
    raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode = '22023';
  end if;
  if _safe_summary is not null and char_length(_safe_summary) not between 1 and 2000 then
    raise exception 'DURABLE_WORK_SUMMARY_INVALID' using errcode = '22023';
  end if;
  if _error_code is not null and (
    char_length(_error_code) not between 1 and 100 or _error_code !~ '^[a-z0-9_]+$'
  ) then
    raise exception 'DURABLE_WORK_ERROR_CODE_INVALID' using errcode = '22023';
  end if;

  -- E02 manual finalizer: current authority before original Work.
  select * into _manual_identity from public.paige_durable_work where id=_work_id;
  if _manual_identity.work_kind='systems_check' or _manual_identity.capability_key='systems.check' then
    if _lease_seconds is null then
      raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode='22023';
    end if;
    perform 1 from auth.users where id=_manual_identity.initiating_user_id for share;
    if not found then raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';end if;
    perform 1 from public.profiles where user_id=_manual_identity.initiating_user_id
      and active_tenant_id=_manual_identity.tenant_id for share;
    if not found then raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';end if;
    perform 1 from public.tenants where id=_manual_identity.tenant_id and account_type::text='standalone'
      and parent_tenant_id is null and status::text='active' for share;
    if not found then raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';end if;
    perform 1 from public.tenant_members where user_id=_manual_identity.initiating_user_id
      and tenant_id=_manual_identity.tenant_id and status::text='active' and role::text in('owner','admin') for share;
    if not found or public._analytics_metric_actor_authorized(_manual_identity.initiating_user_id,_manual_identity.tenant_id) is distinct from true then
      raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';
    end if;
    if _manual_identity.thread_id is not null then
      perform 1 from public.paige_chat_threads where id=_manual_identity.thread_id
        and tenant_id=_manual_identity.tenant_id and caller_user_id=_manual_identity.initiating_user_id
        and audience='workspace' and not is_archived for share;
      if not found then raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';end if;
    end if;
    select * into _row from public.paige_durable_work where id=_work_id for update;
    if not found or _row.idempotency_key is distinct from _server_idempotency_key
      or _row.tenant_id is distinct from _manual_identity.tenant_id
      or _row.initiating_user_id is distinct from _manual_identity.initiating_user_id
      or _row.thread_id is distinct from _manual_identity.thread_id
      or _row.work_kind is distinct from 'systems_check' or _row.capability_key is distinct from 'systems.check'
      or _row.request_payload is distinct from '{"version":1,"scope":"tenant","scan_flavor":"manual","action_filing":"none"}'::jsonb
      or _row.scope_epoch is distinct from 'tenant:'||_row.tenant_id::text||':systems-check:manual:v1'
      or _row.authority_context is distinct from jsonb_build_object('tenant_id',_row.tenant_id::text,
        'actor_user_id',_row.initiating_user_id::text,'authority_source','server_resolved',
        'role_gate','owner_or_admin','approval_reusable',false)
      or _row.max_attempts is distinct from 1 or _row.attempt_count is distinct from 1
      or _row.dispatch_started_attempt is distinct from 1 then
      raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';
    end if;

    _manual_now:=clock_timestamp();
    _manual_budget:=_row.claimed_at+interval '5 minutes';
    if _row.claimed_at is null or _row.claimed_at>_manual_now then
      raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';
    end if;
    if _new_status='claimed' then
      raise exception 'DURABLE_WORK_ATTEMPT_CEILING' using errcode='55000';
    end if;
    if _row.status in ('expired','outcome_unknown') and _reconciled is distinct from true then
      raise exception 'DURABLE_WORK_RECONCILIATION_REQUIRED' using errcode='55000';
    end if;
    if _new_status='succeeded' then
      if _row.status in ('failed','cancelled') then
        raise exception 'DURABLE_WORK_TERMINAL_IMMUTABLE' using errcode='55000';
      end if;
      if _row.status not in ('claimed','expired','outcome_unknown','succeeded') then
        raise exception 'DURABLE_WORK_TRANSITION_INVALID' using errcode='55000';
      end if;
      if _terminal_outcome is null or jsonb_typeof(_terminal_outcome)<>'object'
        or pg_column_size(_terminal_outcome)>16384 then
        raise exception 'DURABLE_WORK_TERMINAL_OUTCOME_REQUIRED' using errcode='22023';
      end if;
      if (_safe_summary is not null and _safe_summary<>'Systems Check completed. Review the recorded findings.')
        or _error_code is not null then
        raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
      end if;
      if _row.status='succeeded' then
        -- Replay observes the immutable completion, even after later authorized
        -- corrections to the original findings. It never creates a lost receipt.
        _manual_result:=_row.terminal_outcome;
        if _manual_result is null or _manual_result->>'verified_readback' is distinct from 'true'
          or _manual_result->>'run_id' is distinct from _row.id::text
          or not (_manual_result ?& ARRAY['check_count','pass_count','fail_count'])
          or _row.settled_at is null then
          raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
        end if;
      else
        if _row.status='claimed' and (_row.lease_until is null
          or _row.lease_until<=_manual_now or _manual_budget<=_manual_now) then
          raise exception 'SYSTEMS_WORK_RECONCILIATION_REQUIRED' using errcode='55000';
        end if;
        -- This original run lock also excludes new FK-linked findings.
        select * into _manual_run from public.paige_systems_check_run
          where id=_row.id for update;
        if not found or _manual_run.work_id is distinct from _row.id
          or _manual_run.tenant_id is distinct from _row.tenant_id
          or _manual_run.scan_flavor is distinct from 'manual'
          or _manual_run.selected_runner_keys is not null
          or _manual_run.triggered_by->>'scope' is distinct from 'tenant'
          or _manual_run.triggered_by->>'action_filing' is distinct from 'none'
          or _manual_run.started_at is null or _manual_run.started_at<_row.claimed_at
          or _manual_run.completed_at is null or _manual_run.completed_at<_manual_run.started_at
          or _manual_run.completed_at>_manual_budget
          or _manual_run.check_count is null or _manual_run.check_count<0
          or _manual_run.pass_count is null or _manual_run.pass_count<0
          or _manual_run.fail_count is null or _manual_run.fail_count<0
          or exists(select 1 from public.paige_systems_check_run
            where work_id=_row.id and id<>_row.id) then
          raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
        end if;
        perform id from public.paige_systems_check_finding where run_id=_row.id for share;
        _manual_now:=clock_timestamp();
        if _row.status='claimed' and (_row.lease_until is null
          or _row.lease_until<=_manual_now or _manual_budget<=_manual_now) then
          raise exception 'SYSTEMS_WORK_RECONCILIATION_REQUIRED' using errcode='55000';
        end if;
        if _manual_run.completed_at>_manual_now then
          raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
        end if;
        select count(*),count(distinct check_id),count(*)filter(where status='pass'),
          count(*)filter(where status='fail'),count(*)filter(where
            tenant_id is distinct from _row.tenant_id or status not in('pass','fail','skip','error')
            or paige_drafted_fix is not null or resolution_action_id is not null)
          into _manual_total,_manual_unique,_manual_pass,_manual_fail,_manual_bad
          from public.paige_systems_check_finding where run_id=_row.id;
        if _manual_total<>_manual_run.check_count or _manual_unique<>_manual_total
          or _manual_pass<>_manual_run.pass_count or _manual_fail<>_manual_run.fail_count
          or _manual_bad<>0 then
          raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
        end if;
        _manual_result:=jsonb_build_object('verified_readback',true,'run_id',_row.id,
          'check_count',_manual_total,'pass_count',_manual_pass,'fail_count',_manual_fail);
      end if;
      -- A caller flag is only a request; original source establishes success.
      if _terminal_outcome is distinct from '{"verified_readback":true}'::jsonb
        and _terminal_outcome is distinct from _manual_result then
        raise exception 'SYSTEMS_WORK_READBACK_UNCONFIRMED' using errcode='55000';
      end if;
      _manual_detail:=jsonb_build_object('version',1,'work_id',_row.id,'run_id',_row.id,
        'scope','tenant','scan_flavor','manual','action_filing','none',
        'check_count',_manual_result->'check_count','pass_count',_manual_result->'pass_count',
        'fail_count',_manual_result->'fail_count');
      if _row.status<>'succeeded' then
        perform public._record_workspace_rail_event(_row.tenant_id,_row.initiating_user_id,
          'system_check',_row.id,0,'check_completed',NULL,NULL,NULL,NULL,NULL,_manual_detail);
      end if;
      perform 1 from public.paige_workspace_events where tenant_id=_row.tenant_id
        and actor_id=_row.initiating_user_id and source_kind='system_check'
        and source_id=_row.id and source_revision=0 and outcome='check_completed'
        and capability_key is null and detail=_manual_detail for share;
      if not found then
        raise exception 'SYSTEMS_WORK_RECEIPT_UNCONFIRMED' using errcode='55000';
      end if;
      -- Receipt insertion/dedup and readback can wait too. No active success
      -- may outlive its original lease or budget after ANY of these waits.
      _manual_now:=clock_timestamp();
      if _row.status='claimed' and (_row.lease_until is null
        or _row.lease_until<=_manual_now or _manual_budget<=_manual_now) then
        raise exception 'SYSTEMS_WORK_RECONCILIATION_REQUIRED' using errcode='55000';
      end if;
      if _row.status='succeeded' then
        return query select _row.status,_row.version,_row.attempt_count,_row.lease_until,_row.settled_at;
        return;
      end if;
      -- One original Work update, atomically with the original Rail writer.
      -- Actual final time, not the transaction's pre-lock starting timestamp.
      update public.paige_durable_work set status='succeeded',lease_until=null,
        blocked_reason=null,error_code=null,
        safe_summary='Systems Check completed. Review the recorded findings.',
        terminal_outcome=_manual_result,settled_at=_manual_now,updated_at=_manual_now,
        version=version+1 where id=_work_id returning * into _row;
      return query select _row.status,_row.version,_row.attempt_count,_row.lease_until,_row.settled_at;
      return;
    end if;
    -- Other canonical states retain their original semantics below. Failed or
    -- cancelled does not assert rollback or absence of partially written data.
  end if;
  -- E02 manual finalizer end; incumbent other-kind path follows unchanged.
  select * into _row from public.paige_durable_work where id = _work_id for update;
  if not found or _row.idempotency_key is distinct from _server_idempotency_key then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;

  if _row.status in ('succeeded','failed','cancelled') then
    if _row.status = _new_status
       and _row.terminal_outcome is not distinct from _terminal_outcome
       and _row.safe_summary is not distinct from _safe_summary
       and _row.error_code is not distinct from _error_code then
      return query select _row.status, _row.version, _row.attempt_count,
                          _row.lease_until, _row.settled_at;
      return;
    end if;
    raise exception 'DURABLE_WORK_TERMINAL_IMMUTABLE' using errcode = '55000';
  end if;

  if _row.status in ('expired','outcome_unknown') and not _reconciled then
    raise exception 'DURABLE_WORK_RECONCILIATION_REQUIRED' using errcode = '55000';
  end if;

  _allowed :=
    (_row.status = 'claimed' and _new_status in ('blocked','succeeded','failed','cancelled','expired','outcome_unknown'))
    or (_row.status = 'blocked' and _new_status in ('claimed','failed','cancelled'))
    or (_row.status in ('expired','outcome_unknown') and _new_status in ('claimed','succeeded','failed','cancelled'));
  if not _allowed then
    raise exception 'DURABLE_WORK_TRANSITION_INVALID' using errcode = '55000';
  end if;
  if _new_status = 'expired' and _row.lease_until > now() then
    raise exception 'DURABLE_WORK_LEASE_STILL_ACTIVE' using errcode = '55000';
  end if;
  if _new_status = 'claimed' and _row.attempt_count >= _row.max_attempts then
    raise exception 'DURABLE_WORK_ATTEMPT_CEILING' using errcode = '55000';
  end if;
  if _new_status = 'blocked' and (
    _blocked_reason is null or char_length(_blocked_reason) not between 1 and 500
  ) then
    raise exception 'DURABLE_WORK_BLOCKED_REASON_REQUIRED' using errcode = '22023';
  end if;
  if _new_status in ('succeeded','failed','cancelled') and (
    _terminal_outcome is null or jsonb_typeof(_terminal_outcome) <> 'object'
    or pg_column_size(_terminal_outcome) > 16384
  ) then
    raise exception 'DURABLE_WORK_TERMINAL_OUTCOME_REQUIRED' using errcode = '22023';
  end if;
  if _new_status = 'succeeded'
     and _terminal_outcome->>'verified_readback' is distinct from 'true' then
    raise exception 'DURABLE_WORK_SUCCESS_REQUIRES_READBACK' using errcode = '22023';
  end if;

  update public.paige_durable_work
     set status = _new_status,
         attempt_count = case when _new_status = 'claimed' then attempt_count + 1 else attempt_count end,
         claimed_at = case when _new_status = 'claimed' then now() else claimed_at end,
         heartbeat_at = case when _new_status = 'claimed' then now() else heartbeat_at end,
         lease_until = case when _new_status = 'claimed'
           then now() + pg_catalog.make_interval(secs => _lease_seconds) else null end,
         blocked_reason = case when _new_status = 'blocked' then _blocked_reason else null end,
         error_code = _error_code,
         safe_summary = _safe_summary,
         terminal_outcome = case
           when _new_status in ('succeeded','failed','cancelled') then _terminal_outcome else null end,
         settled_at = case
           when _new_status in ('succeeded','failed','cancelled') then now() else null end,
         updated_at = now(),
         version = version + 1
   where id = _work_id
   returning * into _row;

  return query select _row.status, _row.version, _row.attempt_count,
                      _row.lease_until, _row.settled_at;
end
$body$;
  definition text;
BEGIN
  SELECT * INTO STRICT original FROM pg_proc WHERE oid=
    'public.transition_paige_durable_work(uuid,text,text,jsonb,text,text,text,integer,boolean)'::regprocedure;
  IF md5(original.prosrc) NOT IN ('41b46e22be68b608deede008b7b36f24','48e851ee40eec05738b6ba09b8000f93')
    OR original.pronargs<>9
    OR original.proargnames IS DISTINCT FROM ARRAY['_work_id','_server_idempotency_key','_new_status',
      '_terminal_outcome','_safe_summary','_blocked_reason','_error_code','_lease_seconds','_reconciled',
      'work_status','work_version','work_attempt_count','work_lease_until','work_settled_at']::text[]
    OR pg_get_expr(original.proargdefaults,0) IS DISTINCT FROM 'NULL::jsonb, NULL::text, NULL::text, NULL::text, 300, false'
    OR pg_get_function_result(original.oid) IS DISTINCT FROM
      'TABLE(work_status text, work_version bigint, work_attempt_count integer, work_lease_until timestamp with time zone, work_settled_at timestamp with time zone)'
    OR pg_get_userbyid(original.proowner)<>'postgres' OR NOT original.prosecdef
    OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR NOT has_function_privilege('service_role',original.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(original.proacl,acldefault('f',original.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN(original.proowner,'service_role'::regrole)) THEN
    RAISE EXCEPTION 'Original Work finalizer changed; receiving reconciliation required';
  END IF;
  IF original.prosrc IS DISTINCT FROM expected THEN
    definition:=pg_get_functiondef(original.oid);
    IF position(original.prosrc in definition)=0 THEN RAISE EXCEPTION 'Original finalizer body missing';END IF;
    EXECUTE replace(definition,original.prosrc,expected);
  END IF;
END
$migration$;
COMMIT;
