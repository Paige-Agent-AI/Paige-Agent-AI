-- E5: save an UNAPPROVED definition through the existing confirmation/native draft/Rail.
-- No recurrence activation, permission override, cron, booking or new persistent store.
-- Forward migration: all previously applied weekly functions keep their identities/bodies.

-- Extend the ONE proposal's single-use claim with its consuming server request.
-- Existing issuers/claims/declines stay NULL; no backfill, role or RLS change.
ALTER TABLE public.paige_pending_confirmations ADD COLUMN IF NOT EXISTS claimed_in_request uuid;
-- Exact-point decline reconciliation must stay bounded as shared audit history grows.
CREATE INDEX IF NOT EXISTS weekly_draft_decline_audit_idx ON public.audit_logs(user_id,entity_id)
  WHERE entity='paige_pending_confirmation' AND action='weekly_draft.declined';
CREATE INDEX IF NOT EXISTS weekly_draft_proposal_history_idx
  ON public.paige_pending_confirmations(tenant_id,user_id,server_issued_at DESC,id DESC)
  WHERE tool_name='weekly_commitment_draft' AND thread_id IS NULL AND scoped_client_id IS NULL
    AND server_issued_at IS NOT NULL AND issued_in_request IS NOT NULL;
CREATE INDEX IF NOT EXISTS weekly_draft_proposal_fingerprint_idx
  ON public.paige_pending_confirmations(tenant_id,user_id,fingerprint,server_issued_at DESC,id DESC)
  WHERE tool_name='weekly_commitment_draft' AND thread_id IS NULL AND scoped_client_id IS NULL
    AND server_issued_at IS NOT NULL AND issued_in_request IS NOT NULL;

-- Extend the incumbent Settings catalogue; missing tenant override stays confirm.
-- This records no grant and never changes the weekly check's execution permission.
DO $$ BEGIN
  IF to_regprocedure('public._list_tool_autonomy_before_weekly_draft(uuid)') IS NULL THEN
    ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_weekly_draft;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_weekly_draft(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_weekly_draft(uuid) FROM service_role;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
  RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_weekly_draft(_tenant_id);
  IF auth.uid() IS NOT NULL THEN
    _tenant:=public.current_user_tenant_id();
    IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
  ELSE _tenant:=_tenant_id; END IF;
  RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
    ('weekly_commitment_draft','Save a weekly responsibility draft','Planning')
  ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
    FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

DO $$ BEGIN
  IF to_regprocedure('public._workspace_event_display_before_weekly_draft(text,text,text)') IS NULL THEN
    ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_weekly_draft;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_weekly_draft(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE _result jsonb;
BEGIN
  _result:=public._workspace_event_display_before_weekly_draft(_source_kind,_outcome,_capability);
  IF _source_kind='capability_run' AND _outcome='capability_succeeded' AND _capability='weekly_commitment_draft' THEN
    _result:=_result||jsonb_build_object('title','Weekly responsibility saved as draft',
      'summary','The proposed schedule was saved. Recurring execution is not authorized.');
  END IF;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._weekly_draft_proposal(_confirmation_id uuid)
RETURNS public.paige_pending_confirmations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO _p FROM public.paige_pending_confirmations p
    WHERE p.id=_confirmation_id AND p.user_id=_uid AND p.tenant_id=_tid
      AND p.tool_name='weekly_commitment_draft' AND p.thread_id IS NULL AND p.scoped_client_id IS NULL
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
REVOKE ALL ON FUNCTION public._weekly_draft_proposal(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_weekly_commitment_draft(_confirmation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _a public.paige_automations; _receipt uuid;
  _request uuid; _phase text; _declined boolean;
BEGIN
  _p:=public._weekly_draft_proposal(_confirmation_id); _request:=(_p.args->>'_request_id')::uuid;
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
REVOKE ALL ON FUNCTION public.read_weekly_commitment_draft(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_weekly_commitment_draft(uuid) TO authenticated;

-- Both history and exact intent lookup use literal domain predicates with matching
-- indexes. No service-role history scan, guessed-empty bounded list or new store.
CREATE OR REPLACE FUNCTION public.list_weekly_commitment_drafts(_fingerprint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id(); _id uuid;
  _requests jsonb:='[]'::jsonb; _more boolean:=false;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _fingerprint IS NULL THEN
    FOR _id IN SELECT p.id FROM public.paige_pending_confirmations p
      WHERE p.user_id=_uid AND p.tenant_id=_tid AND p.tool_name='weekly_commitment_draft'
        AND p.thread_id IS NULL AND p.scoped_client_id IS NULL
        AND p.server_issued_at IS NOT NULL AND p.issued_in_request IS NOT NULL
      ORDER BY p.server_issued_at DESC,p.id DESC LIMIT 11
    LOOP
      IF jsonb_array_length(_requests)=10 THEN _more:=true; EXIT; END IF;
      _requests:=_requests||jsonb_build_array(public.read_weekly_commitment_draft(_id));
    END LOOP;
  ELSE
    IF _fingerprint!~'^[0-9a-f]{16}$' THEN
      RAISE EXCEPTION 'WEEKLY_DRAFT_PROPOSAL_INVALID' USING ERRCODE='22023'; END IF;
    SELECT p.id INTO _id FROM public.paige_pending_confirmations p
      WHERE p.user_id=_uid AND p.tenant_id=_tid AND p.tool_name='weekly_commitment_draft' AND p.fingerprint=_fingerprint
        AND p.thread_id IS NULL AND p.scoped_client_id IS NULL
        AND p.server_issued_at IS NOT NULL AND p.issued_in_request IS NOT NULL
      ORDER BY p.server_issued_at DESC,p.id DESC LIMIT 1;
    IF FOUND THEN _requests:=jsonb_build_array(public.read_weekly_commitment_draft(_id)); END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'requests',_requests,'limit',CASE WHEN _fingerprint IS NULL THEN 10 ELSE 1 END,'has_more',_more);
END $$;
REVOKE ALL ON FUNCTION public.list_weekly_commitment_drafts(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_weekly_commitment_drafts(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_weekly_commitment_draft(
  _confirmation_id uuid,_approved_token text,_request_nonce uuid)
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
  _p:=public._weekly_draft_proposal(_confirmation_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id);
  IF _p.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('claimed',false,'state',public.read_weekly_commitment_draft(_p.id)); END IF;
  IF _request_nonce IS NULL OR _p.issued_in_request::text=_request_nonce::text OR _p.expires_at<=clock_timestamp()
    OR _approved_token IS NULL OR _approved_token IS DISTINCT FROM (_p.fingerprint||':'||_p.issued_in_request::text) THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF coalesce(public.resolve_tool_autonomy(_tid,'weekly_commitment_draft'),'off') NOT IN ('confirm','auto') THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_AUTHORITY_HELD' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp(),claimed_in_request=_request_nonce
    WHERE id=_p.id AND consumed_at IS NULL;
  RETURN jsonb_build_object('claimed',true,'confirmation_id',_p.id,'args',_p.args,'tenant_id',_tid,'actor_id',_uid);
END $$;
REVOKE ALL ON FUNCTION public.claim_weekly_commitment_draft(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_weekly_commitment_draft(uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_weekly_commitment_draft(
  _confirmation_id uuid,_request_nonce uuid,_expected_args jsonb)
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
  _p:=public._weekly_draft_proposal(_confirmation_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id);
  IF _request_nonce IS NULL OR _p.claimed_in_request IS DISTINCT FROM _request_nonce OR _p.consumed_at IS NULL
    OR _p.args IS DISTINCT FROM _expected_args THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_CLAIM_REQUIRED' USING ERRCODE='42501'; END IF;
  _saved:=public.read_weekly_commitment_draft(_p.id);
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
  _saved:=public.read_weekly_commitment_draft(_p.id);
  IF _saved->>'phase' IS DISTINCT FROM 'saved' THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_READBACK_UNVERIFIED' USING ERRCODE='40001'; END IF;
  RETURN _saved;
END $$;
REVOKE ALL ON FUNCTION public.commit_weekly_commitment_draft(uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_weekly_commitment_draft(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_weekly_commitment_draft(_confirmation_id uuid,_declined_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations;
BEGIN
  _p:=public._weekly_draft_proposal(_confirmation_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id);
  IF _p.consumed_at IS NOT NULL THEN RETURN public.read_weekly_commitment_draft(_p.id); END IF;
  IF _declined_token IS NULL OR _declined_token IS DISTINCT FROM (_p.fingerprint||':'||_p.issued_in_request::text) THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=_p.id AND consumed_at IS NULL;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
    VALUES(_p.user_id,'paige_pending_confirmation','weekly_draft.declined',_p.id,jsonb_build_object('tenant_id',_p.tenant_id));
  RETURN public.read_weekly_commitment_draft(_p.id);
END $$;
REVOKE ALL ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) TO authenticated;
