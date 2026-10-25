-- Private original Work request preparation only: no scan or public admission.
BEGIN;
CREATE FUNCTION public._create_manual_systems_check_work(
 p_actor uuid,p_tenant uuid,p_intent uuid,p_thread uuid DEFAULT NULL)
RETURNS TABLE(work_id uuid,work_status text,work_version bigint,resumed_existing boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
 created record; original public.paige_durable_work%ROWTYPE;
 payload CONSTANT jsonb := '{"version":1,"scope":"tenant","scan_flavor":"manual","action_filing":"none"}'::jsonb;
 authority jsonb; epoch text;
BEGIN
 IF p_actor IS NULL OR p_tenant IS NULL OR p_intent IS NULL THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_IDENTITY_REQUIRED' USING ERRCODE='22023';
 END IF;
 -- Pin the original rows through this bounded transaction. Existing current
 -- actor authority remains the gate; the stored snapshot never grants access.
 PERFORM 1 FROM auth.users WHERE id=p_actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=p_actor AND active_tenant_id=p_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND account_type::text='standalone'
  AND parent_tenant_id IS NULL AND status::text='active' FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.tenant_members WHERE user_id=p_actor AND tenant_id=p_tenant
  AND status::text='active' AND role::text IN('owner','admin') FOR SHARE;
 IF NOT FOUND OR public._analytics_metric_actor_authorized(p_actor,p_tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF p_thread IS NOT NULL THEN
  PERFORM 1 FROM public.paige_chat_threads WHERE id=p_thread AND tenant_id=p_tenant
   AND caller_user_id=p_actor AND audience='workspace' AND NOT is_archived FOR SHARE;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'SYSTEMS_WORK_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
 END IF;
 authority:=jsonb_build_object('tenant_id',p_tenant::text,'actor_user_id',p_actor::text,
  'authority_source','server_resolved','role_gate','owner_or_admin','approval_reusable',false);
 epoch:='tenant:'||p_tenant::text||':systems-check:manual:v1';
 SELECT * INTO created FROM public.create_paige_durable_work(p_tenant,p_actor,p_intent,p_thread,
  'systems.check','systems_check',authority,epoch,60,1);
 SELECT * INTO original FROM public.paige_durable_work WHERE id=created.work_id FOR UPDATE;
 -- Generic replay does not compare the requested attempt ceiling. Verify the
 -- actual immutable tuple/ceiling, not a caller's expected configuration.
 IF original.tenant_id IS DISTINCT FROM p_tenant OR original.initiating_user_id IS DISTINCT FROM p_actor
  OR original.intent_id IS DISTINCT FROM p_intent OR original.thread_id IS DISTINCT FROM p_thread
  OR original.capability_key IS DISTINCT FROM 'systems.check' OR original.work_kind IS DISTINCT FROM 'systems_check'
  OR original.authority_context IS DISTINCT FROM authority OR original.scope_epoch IS DISTINCT FROM epoch
  OR original.max_attempts IS DISTINCT FROM 1 OR original.attempt_count IS DISTINCT FROM 1
  OR (created.resumed_existing AND original.request_payload IS DISTINCT FROM payload) THEN
  RAISE EXCEPTION 'SYSTEMS_WORK_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 IF NOT created.resumed_existing THEN
  UPDATE public.paige_durable_work w SET request_payload=payload,
   safe_summary='Your Systems Check request is prepared.',updated_at=clock_timestamp(),version=w.version+1
   WHERE w.id=original.id RETURNING w.* INTO original;
 END IF;
 RETURN QUERY SELECT original.id,original.status,original.version,created.resumed_existing;
END $$;
REVOKE ALL ON FUNCTION public._create_manual_systems_check_work(uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._create_manual_systems_check_work(uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public._create_manual_systems_check_work(uuid,uuid,uuid,uuid) IS
 'Private original manual Systems request only. Fixed tenant/none payload, one attempt, current actor and original Work replay. No scan, claim, wake-up, approval or customer admission.';
COMMIT;
