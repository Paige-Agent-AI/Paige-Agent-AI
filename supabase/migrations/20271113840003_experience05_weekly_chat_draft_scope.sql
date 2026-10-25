-- EXP05 native prerequisite only; Chat tool admission and recurring activation remain OFF.
-- Re-sequenced after deployed840002 and before E04reserved840004/850004 by receiving ACK.
-- Preserve every original weekly UI signature, NULL-thread scope and response.
-- One native implementation per operation, same confirmation/definition/Rail writers.
-- No data backfill, role change, flag, event, cron or shared runtime-helper change.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION public._weekly_draft_proposal(_confirmation_id uuid,_expected_thread_id uuid)
RETURNS public.paige_pending_confirmations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _expected_thread_id IS NOT NULL THEN
    -- Existing shared native scope checker; no copied identity/role engine.
    IF to_regprocedure('private.paige_reminder_scope(uuid,uuid,uuid,uuid)') IS NULL THEN
      RAISE EXCEPTION 'WEEKLY_DRAFT_CHAT_SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
    PERFORM private.paige_reminder_scope(_uid,_tid,_expected_thread_id,NULL::uuid);
  END IF;
  SELECT * INTO _p FROM public.paige_pending_confirmations p
    WHERE p.id=_confirmation_id AND p.user_id=_uid AND p.tenant_id=_tid
      AND p.tool_name='weekly_commitment_draft' AND p.thread_id IS NOT DISTINCT FROM _expected_thread_id AND p.scoped_client_id IS NULL
      AND p.server_issued_at IS NOT NULL AND p.issued_in_request IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_DRAFT_PROPOSAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(_p.args) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_PROPOSAL_INVALID' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(_p.args))<>5
    OR NOT (_p.args ?& ARRAY['_request_id','_name','_weekday','_local_time','_timezone'])
    OR jsonb_typeof(_p.args->'_name')<>'string' OR length(btrim(_p.args->>'_name')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(_p.args->'_weekday')<>'number' OR (_p.args->>'_weekday')!~'^[1-7]$'
    OR jsonb_typeof(_p.args->'_local_time')<>'string' OR jsonb_typeof(_p.args->'_timezone')<>'string'
    OR jsonb_typeof(_p.args->'_request_id')<>'string'
    OR (_p.args->>'_request_id')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR _p.fingerprint!~'^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_PROPOSAL_INVALID' USING ERRCODE='22023'; END IF;
  PERFORM public.weekly_commitment_schedule((_p.args->>'_weekday')::integer,_p.args->>'_local_time',_p.args->>'_timezone');
  RETURN _p;
END $$;

REVOKE ALL ON FUNCTION public._weekly_draft_proposal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._weekly_draft_proposal(_confirmation_id uuid)
RETURNS public.paige_pending_confirmations LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public._weekly_draft_proposal(_confirmation_id,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public._weekly_draft_proposal(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.weekly_draft_read(_confirmation_id uuid,_expected_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _a public.paige_automations; _receipt uuid;
  _request uuid; _phase text; _declined boolean;
BEGIN
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id); _request:=(_p.args->>'_request_id')::uuid;
  -- Uses the existing tenant/owner/request partial unique index. A missing bounded-list
  -- entry is never substituted for this exact request, and no read files a receipt.
  SELECT * INTO _a FROM public.paige_automations a WHERE a.tenant_id=_p.tenant_id AND a.created_by=_p.user_id
    AND a.trigger_key='schedule.weekly_commitment_check' AND a.trigger_config->>'request_id'=_request::text;
  IF FOUND THEN
    SELECT e.id INTO _receipt FROM public.paige_workspace_events e WHERE e.tenant_id=_p.tenant_id
      AND e.actor_id=_p.user_id AND e.source_kind='capability_run' AND e.source_id=_request
      AND e.source_revision=0 AND e.outcome='capability_succeeded' AND e.capability_key='weekly_commitment_draft';
    _phase:=CASE WHEN _a.state='draft' AND _a.granted_lane='confirm' AND (_a.trigger_config->>'revision')::integer=1
      AND _a.name=_p.args->>'_name' AND _a.trigger_config->>'weekday'=_p.args->>'_weekday'
      AND _a.trigger_config->>'local_time'=_p.args->>'_local_time' AND _a.trigger_config->>'timezone'=_p.args->>'_timezone'
      THEN CASE WHEN _receipt IS NOT NULL THEN 'saved' ELSE 'saved_unreceipted' END ELSE 'changed' END;
  ELSIF _p.consumed_at IS NULL THEN
    _phase:=CASE WHEN _p.expires_at>clock_timestamp() THEN 'awaiting_approval' ELSE 'expired' END;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.user_id=_p.user_id
      AND l.entity='paige_pending_confirmation' AND l.entity_id=_p.id
      AND l.action='weekly_draft.declined' AND l.data->>'tenant_id'=_p.tenant_id::text) INTO _declined;
    _phase:=CASE WHEN _declined THEN 'declined' ELSE 'unknown' END;
  END IF;
  RETURN jsonb_build_object('ok',true,'tenant_id',_p.tenant_id,'actor_id',_p.user_id,'phase',_phase,'confirmation_id',_p.id,'request_id',_request,
    'read_at',clock_timestamp(),'summary',_p.summary,'draft',jsonb_build_object('name',_p.args->>'_name',
      'weekday',(_p.args->>'_weekday')::integer,'local_time',_p.args->>'_local_time','timezone',_p.args->>'_timezone'),
    'expires_at',_p.expires_at,'confirmation_token',CASE WHEN _phase='awaiting_approval'
      THEN _p.fingerprint||':'||_p.issued_in_request::text ELSE NULL END,
    'automation_id',_a.id,'revision',CASE WHEN _a.id IS NOT NULL THEN (_a.trigger_config->>'revision')::integer ELSE NULL END,
    'process_state',_a.state,'receipt_id',_receipt,'recurrence_authorized',CASE WHEN _phase='changed' THEN NULL ELSE false END);
END $$;

REVOKE ALL ON FUNCTION private.weekly_draft_read(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.weekly_draft_claim(
  _confirmation_id uuid,_approved_token text,_request_nonce uuid,_expected_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- Freeze the incumbent active-workspace row through claim/save, preventing an approval
  -- prepared in one workspace being spent in another after an in-flight switch.
  PERFORM 1 FROM public.profiles WHERE user_id=_uid FOR SHARE;
  IF NOT FOUND OR public.current_user_tenant_id() IS DISTINCT FROM _tid THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.user_id=_uid AND m.tenant_id=_tid AND m.role::text='owner' AND m.status='active' AND t.archived_at IS NULL
    FOR SHARE OF m,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  IF _p.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('claimed',false,'state',private.weekly_draft_read(_p.id,_expected_thread_id)); END IF;
  IF _request_nonce IS NULL OR _p.issued_in_request::text=_request_nonce::text OR _p.expires_at<=clock_timestamp()
    OR _approved_token IS NULL OR _approved_token IS DISTINCT FROM (_p.fingerprint||':'||_p.issued_in_request::text) THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF coalesce(public.resolve_tool_autonomy(_tid,'weekly_commitment_draft'),'off') NOT IN ('confirm','auto') THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_AUTHORITY_HELD' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp(),claimed_in_request=_request_nonce
    WHERE id=_p.id AND consumed_at IS NULL;
  RETURN jsonb_build_object('claimed',true,'confirmation_id',_p.id,'args',_p.args,'tenant_id',_tid,'actor_id',_uid);
END $$;

REVOKE ALL ON FUNCTION private.weekly_draft_claim(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.weekly_draft_commit(
  _confirmation_id uuid,_request_nonce uuid,_expected_args jsonb,_expected_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
  _saved jsonb; _request uuid; _process uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id=_uid FOR SHARE;
  IF NOT FOUND OR public.current_user_tenant_id() IS DISTINCT FROM _tid THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.user_id=_uid AND m.tenant_id=_tid AND m.role::text='owner' AND m.status='active' AND t.archived_at IS NULL
    FOR SHARE OF m,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  IF _request_nonce IS NULL OR _p.claimed_in_request IS DISTINCT FROM _request_nonce OR _p.consumed_at IS NULL
    OR _p.args IS DISTINCT FROM _expected_args THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_CLAIM_REQUIRED' USING ERRCODE='42501'; END IF;
  _saved:=private.weekly_draft_read(_p.id,_expected_thread_id);
  IF _saved->>'phase' IN ('saved','changed') THEN RETURN _saved; END IF;
  IF _p.expires_at<=clock_timestamp() OR coalesce(public.resolve_tool_autonomy(_tid,'weekly_commitment_draft'),'off') NOT IN ('confirm','auto') THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_AUTHORITY_HELD' USING ERRCODE='42501'; END IF;
  _request:=(_p.args->>'_request_id')::uuid;
  _saved:=public.draft_weekly_commitment_check(_request,_p.args->>'_name',(_p.args->>'_weekday')::integer,
    _p.args->>'_local_time',_p.args->>'_timezone');
  _process:=(_saved->>'automation_id')::uuid;
  IF _saved->>'state' IS DISTINCT FROM 'draft' OR _saved->>'revision' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_ALREADY_CHANGED' USING ERRCODE='40001'; END IF;
  -- Same canonical Rail, stable request identity. Native definition and receipt are
  -- atomic. The earlier claim remains durable if interrupted before this transaction;
  -- readback then says unknown, never safe-to-replay. The caller must pass Kit's
  -- execute decision over the stored claim before invoking this fixed RPC.
  PERFORM public.record_capability_run(_tid,_uid,'weekly_commitment_draft','capability_succeeded',_request,
    NULL::text,NULL::text,NULL::uuid,NULL::text,jsonb_build_object('automation_id',_process,'revision',1,'state','draft'));
  _saved:=private.weekly_draft_read(_p.id,_expected_thread_id);
  IF _saved->>'phase' IS DISTINCT FROM 'saved' THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_READBACK_UNVERIFIED' USING ERRCODE='40001'; END IF;
  RETURN _saved;
END $$;

REVOKE ALL ON FUNCTION private.weekly_draft_commit(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.weekly_draft_decline(_confirmation_id uuid,_declined_token text,_expected_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- Freeze current workspace, membership and tenant before locking the proposal.
  -- A switch/revocation that wins first is revalidated; one that follows waits
  -- until this transaction finishes, just as it does for claim and commit.
  PERFORM 1 FROM public.profiles WHERE user_id=_uid FOR SHARE;
  IF NOT FOUND OR public.current_user_tenant_id() IS DISTINCT FROM _tid THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.user_id=_uid AND m.tenant_id=_tid AND m.role::text='owner' AND m.status='active' AND t.archived_at IS NULL
    FOR SHARE OF m,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id,_expected_thread_id);
  IF _p.consumed_at IS NOT NULL THEN RETURN private.weekly_draft_read(_p.id,_expected_thread_id); END IF;
  IF _declined_token IS NULL OR _declined_token IS DISTINCT FROM (_p.fingerprint||':'||_p.issued_in_request::text) THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=_p.id AND consumed_at IS NULL;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
    VALUES(_p.user_id,'paige_pending_confirmation','weekly_draft.declined',_p.id,jsonb_build_object('tenant_id',_p.tenant_id));
  RETURN private.weekly_draft_read(_p.id,_expected_thread_id);
END $$;

REVOKE ALL ON FUNCTION private.weekly_draft_decline(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_weekly_commitment_draft(_confirmation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT private.weekly_draft_read(_confirmation_id,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.read_weekly_commitment_draft(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_weekly_commitment_draft(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_weekly_commitment_draft(_confirmation_id uuid,_approved_token text,_request_nonce uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT private.weekly_draft_claim(_confirmation_id,_approved_token,_request_nonce,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.claim_weekly_commitment_draft(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_weekly_commitment_draft(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_weekly_commitment_draft(_confirmation_id uuid,_request_nonce uuid,_expected_args jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT private.weekly_draft_commit(_confirmation_id,_request_nonce,_expected_args,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.commit_weekly_commitment_draft(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_weekly_commitment_draft(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_weekly_commitment_draft(_confirmation_id uuid,_declined_token text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT private.weekly_draft_decline(_confirmation_id,_declined_token,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) TO authenticated;

-- Mutations require the current server-bound normal Chat executor. NULL/unbound
-- compatibility never reaches the claim or writer. Readback remains possible after stop.
CREATE OR REPLACE FUNCTION private.weekly_chat_draft_mutation_scope(
  _expected_thread_id uuid,_intent_id uuid,_runtime_request_nonce uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) OR _expected_thread_id IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF to_regprocedure('private.paige_reminder_scope(uuid,uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('private.paige_reminder_runtime(uuid,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_CHAT_RUNTIME_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM private.paige_reminder_scope(_uid,_tid,_expected_thread_id,NULL::uuid);
  IF private.paige_reminder_runtime(_uid,_tid,_expected_thread_id,_intent_id,_runtime_request_nonce) IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_CHAT_RUNTIME_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $$;

REVOKE ALL ON FUNCTION private.weekly_chat_draft_mutation_scope(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_weekly_commitment_chat_draft(_confirmation_id uuid,_expected_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF _expected_thread_id IS NULL THEN RAISE EXCEPTION 'WEEKLY_DRAFT_CHAT_SCOPE_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN private.weekly_draft_read(_confirmation_id,_expected_thread_id)||jsonb_build_object('thread_id',_expected_thread_id);
END $$;

REVOKE ALL ON FUNCTION public.read_weekly_commitment_chat_draft(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_weekly_commitment_chat_draft(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_weekly_commitment_chat_draft(
  _confirmation_id uuid,_approved_token text,_request_nonce uuid,_expected_thread_id uuid,_intent_id uuid,_runtime_request_nonce uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _result jsonb;
BEGIN
  PERFORM private.weekly_chat_draft_mutation_scope(_expected_thread_id,_intent_id,_runtime_request_nonce);
  _result:=private.weekly_draft_claim(_confirmation_id,_approved_token,_request_nonce,_expected_thread_id);
  IF _result ? 'state' THEN
    _result:=jsonb_set(_result,'{state}',(_result->'state')||jsonb_build_object('thread_id',_expected_thread_id));
  END IF;
  RETURN _result||jsonb_build_object('thread_id',_expected_thread_id);
END $$;

REVOKE ALL ON FUNCTION public.claim_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_weekly_commitment_chat_draft(
  _confirmation_id uuid,_request_nonce uuid,_expected_args jsonb,_expected_thread_id uuid,_intent_id uuid,_runtime_request_nonce uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.weekly_chat_draft_mutation_scope(_expected_thread_id,_intent_id,_runtime_request_nonce);
  RETURN private.weekly_draft_commit(_confirmation_id,_request_nonce,_expected_args,_expected_thread_id)
    ||jsonb_build_object('thread_id',_expected_thread_id);
END $$;

REVOKE ALL ON FUNCTION public.commit_weekly_commitment_chat_draft(uuid,uuid,jsonb,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_weekly_commitment_chat_draft(uuid,uuid,jsonb,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_weekly_commitment_chat_draft(
  _confirmation_id uuid,_declined_token text,_expected_thread_id uuid,_intent_id uuid,_runtime_request_nonce uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.weekly_chat_draft_mutation_scope(_expected_thread_id,_intent_id,_runtime_request_nonce);
  RETURN private.weekly_draft_decline(_confirmation_id,_declined_token,_expected_thread_id)
    ||jsonb_build_object('thread_id',_expected_thread_id);
END $$;

REVOKE ALL ON FUNCTION public.decline_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.decline_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid) TO authenticated;

COMMIT;
