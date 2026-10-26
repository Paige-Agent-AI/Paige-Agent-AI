-- Extend the existing server-only heartbeat for one closed manual purpose.
-- No new callable, grant, worker, scan, receipt, schedule or customer admission.
BEGIN;
DO $migration$
DECLARE
  original record;
  expected CONSTANT text := $body$
declare _row public.paige_durable_work%rowtype;
  _manual_identity public.paige_durable_work%rowtype;
  _manual_now timestamptz;
  _manual_budget timestamptz;

begin
  if _lease_seconds not between 30 and 3600 then
    raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode = '22023';
  end if;
  -- E02 manual heartbeat: authority first, original Work second.
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
    if _row.status is distinct from 'claimed' then
      raise exception 'DURABLE_WORK_NOT_CLAIMED' using errcode='55000';
    end if;
    -- Evaluate time only after all real authority and Work lock waits.
    _manual_now:=clock_timestamp();
    _manual_budget:=_row.claimed_at+interval '5 minutes';
    if _row.claimed_at is null or _row.claimed_at>_manual_now or _row.lease_until is null then
      raise exception 'SYSTEMS_WORK_UNAVAILABLE' using errcode='42501';
    end if;
    if _row.lease_until<=_manual_now or _manual_budget<=_manual_now then
      update public.paige_durable_work set status='expired',lease_until=null,heartbeat_at=_manual_now,
        error_code='lease_expired',updated_at=_manual_now,version=version+1
        where id=_work_id returning * into _row;
    else
      update public.paige_durable_work set heartbeat_at=_manual_now,
        lease_until=least(_manual_now+pg_catalog.make_interval(secs=>_lease_seconds),_manual_budget),
        updated_at=_manual_now,version=version+1 where id=_work_id returning * into _row;
    end if;
    return query select _row.status,_row.version,_row.lease_until;
    return;
  end if;
  -- E02 manual heartbeat end; incumbent other-kind path follows unchanged.
  select * into _row from public.paige_durable_work where id = _work_id for update;
  if not found or _row.idempotency_key is distinct from _server_idempotency_key then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;
  if _row.status <> 'claimed' then
    raise exception 'DURABLE_WORK_NOT_CLAIMED' using errcode = '55000';
  end if;
  if _row.lease_until <= now() then
    update public.paige_durable_work
       set status = 'expired', lease_until = null, heartbeat_at = now(),
           error_code = 'lease_expired', updated_at = now(), version = version + 1
     where id = _work_id returning * into _row;
  else
    update public.paige_durable_work
       set heartbeat_at = now(), lease_until = now() + pg_catalog.make_interval(secs => _lease_seconds),
           updated_at = now(), version = version + 1
     where id = _work_id returning * into _row;
  end if;
  return query select _row.status, _row.version, _row.lease_until;
end
$body$;
  definition text;
BEGIN
  SELECT * INTO STRICT original FROM pg_proc WHERE oid='public.heartbeat_paige_durable_work(uuid,text,integer)'::regprocedure;
  IF md5(original.prosrc) NOT IN ('262a07d9e4d2cacc2d67bc8a26fa346d','f1e7ab28b56b167c50aba50f51d6afee')
    OR pg_get_userbyid(original.proowner)<>'postgres' OR NOT original.prosecdef
    OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR NOT has_function_privilege('service_role',original.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(original.proacl,acldefault('f',original.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN(original.proowner,'service_role'::regrole)) THEN
    RAISE EXCEPTION 'Original Work heartbeat changed; receiving reconciliation required';
  END IF;
  IF original.prosrc IS DISTINCT FROM expected THEN
    definition:=pg_get_functiondef(original.oid);
    IF position(original.prosrc in definition)=0 THEN RAISE EXCEPTION 'Original heartbeat body missing';END IF;
    -- Retain original ABI, attributes, default, ownership and existing ACL.
    EXECUTE replace(definition,original.prosrc,expected);
  END IF;
END
$migration$;
COMMIT;
