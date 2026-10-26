-- DEVELOPMENT PROPOSAL: new server-role grant requires explicit owner approval
-- before production release. No worker, wake-up, scan or public admission.
BEGIN;
CREATE FUNCTION public._start_manual_systems_check_work(p_work uuid)
RETURNS TABLE(work_id uuid,work_status text,server_idempotency_key text,
 tenant_id uuid,initiating_user_id uuid,thread_id uuid,attempt_count integer,request_payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE
 identity public.paige_durable_work%ROWTYPE;
 original public.paige_durable_work%ROWTYPE;
 payload CONSTANT jsonb := '{"version":1,"scope":"tenant","scan_flavor":"manual","action_filing":"none"}'::jsonb;
BEGIN
 IF p_work IS NULL THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_IDENTITY_REQUIRED' USING ERRCODE='22023';
 END IF;
 -- Discover immutable identities first; pin current authority in the SAME order
 -- as original preparation before locking Work. The snapshot is not permission.
 SELECT * INTO identity FROM public.paige_durable_work w WHERE w.id=p_work;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM auth.users u WHERE u.id=identity.initiating_user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.profiles p WHERE p.user_id=identity.initiating_user_id
  AND p.active_tenant_id=identity.tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=identity.tenant_id AND t.account_type::text='standalone'
  AND t.parent_tenant_id IS NULL AND t.status::text='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.tenant_members m WHERE m.user_id=identity.initiating_user_id
  AND m.tenant_id=identity.tenant_id AND m.status::text='active' AND m.role::text IN('owner','admin') FOR SHARE;
 IF NOT FOUND OR public._analytics_metric_actor_authorized(identity.initiating_user_id,identity.tenant_id) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF identity.thread_id IS NOT NULL THEN
  PERFORM 1 FROM public.paige_chat_threads c WHERE c.id=identity.thread_id
   AND c.tenant_id=identity.tenant_id AND c.caller_user_id=identity.initiating_user_id
   AND c.audience='workspace' AND NOT c.is_archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 END IF;
 SELECT * INTO original FROM public.paige_durable_work w WHERE w.id=p_work FOR UPDATE;
 IF NOT FOUND OR original.tenant_id IS DISTINCT FROM identity.tenant_id
  OR original.initiating_user_id IS DISTINCT FROM identity.initiating_user_id
  OR original.thread_id IS DISTINCT FROM identity.thread_id
  OR original.work_kind IS DISTINCT FROM 'systems_check' OR original.capability_key IS DISTINCT FROM 'systems.check'
  OR original.request_payload IS DISTINCT FROM payload
  OR original.scope_epoch IS DISTINCT FROM 'tenant:'||original.tenant_id::text||':systems-check:manual:v1'
  OR original.max_attempts IS DISTINCT FROM 1 OR original.attempt_count IS DISTINCT FROM 1
  OR original.authority_context IS DISTINCT FROM jsonb_build_object('tenant_id',original.tenant_id::text,
   'actor_user_id',original.initiating_user_id::text,'authority_source','server_resolved',
   'role_gate','owner_or_admin','approval_reusable',false) THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- Use actual time AFTER a real lock wait, not transaction-start now().
 IF original.status IS DISTINCT FROM 'claimed' OR original.lease_until IS NULL
  OR original.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_NOT_CLAIMABLE' USING ERRCODE='55000';
 END IF;
 IF original.dispatch_started_attempt>=original.attempt_count THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_ALREADY_DISPATCHED' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_systems_check_run r
  WHERE r.id=original.id OR r.work_id=original.id) THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_RECONCILIATION_REQUIRED' USING ERRCODE='55000';
 END IF;
 UPDATE public.paige_durable_work w SET dispatch_started_attempt=w.attempt_count,
  heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes',
  safe_summary='Your Systems Check request is being processed.',updated_at=clock_timestamp(),version=w.version+1
  WHERE w.id=original.id RETURNING w.* INTO original;
 RETURN QUERY SELECT original.id,original.status,original.idempotency_key,original.tenant_id,
  original.initiating_user_id,original.thread_id,original.attempt_count,original.request_payload;
END $$;
REVOKE ALL ON FUNCTION public._start_manual_systems_check_work(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._start_manual_systems_check_work(uuid) TO service_role;
COMMENT ON FUNCTION public._start_manual_systems_check_work(uuid) IS
 'Private original manual Systems dispatch CAS only. Current source authority, closed purpose, one attempt, duplicate refusal. No scan, wake-up, approval, settlement or public admission.';
COMMIT;
