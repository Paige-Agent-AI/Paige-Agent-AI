-- EXP03 S4a: prepare_action — the governed bridge from a planned campaign step to its approval.
-- The shipped plan copy says a step "goes to you for approval once it is prepared"; until this
-- migration nothing in the product prepared it (convergence matrix N3 item 5). This adds the
-- prepare command to the EXISTING writer; the action bus's advance_action does the drafting and
-- opens the approval, exactly as for any other drafted action. No new engine, channel or table.
-- Generated from the incumbent writer as it stands in 20271022100000_int298_process_scope_and_action_truth.sql
-- (the live definition, including its action-truth and bus-refused behavior), with two additions:
-- the command vocabulary gains 'prepare_action', and the branch below. Commands:
--   {type:'plan_action', ...} {type:'link_action', ...} {type:'unlink_action', briefId, actionId}
--   {type:'prepare_action', briefId, actionId}
--   {type:'record_outcome', ...} {type:'evaluate_outcome', ...}
CREATE OR REPLACE FUNCTION public.configure_campaign_brief_actions(
  _tenant_id uuid,
  _command jsonb,
  _idempotency_key text,
  _actor_kind text DEFAULT 'human'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
  _action text := replace(coalesce(_command->>'type',''),'-','_');
  _hash text := md5('campaign_brief_actions:'||coalesce(_command,'{}'::jsonb)::text);
  _cached public.campaign_brief_command_results%ROWTYPE;
  _brief uuid;
  _action_id uuid;
  _automation uuid;
  _depends uuid;
  _due timestamptz;
  _tactic text := btrim(coalesce(_command->>'tactic',''));
  _family text := btrim(coalesce(_command->>'family',''));
  _title text := btrim(coalesce(_command->>'title',''));
  _summary text := nullif(btrim(coalesce(_command->>'summary','')),'');
  _expected jsonb;
  _observed jsonb;
  _verdict text := btrim(coalesce(_command->>'verdict',''));
  _note text := nullif(btrim(coalesce(_command->>'note','')),'');
  _status text;
  _proven boolean;
  _link public.campaign_brief_actions%ROWTYPE;
  _filed jsonb;
  _result jsonb;
  _removed integer;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_tenant)) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF _actor_kind IS NULL OR _actor_kind NOT IN ('human','paige') THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_ACTOR_INVALID' USING ERRCODE='22023'; END IF;
  IF coalesce(btrim(_idempotency_key),'')='' THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _action NOT IN ('plan_action','link_action','unlink_action','prepare_action','record_outcome','evaluate_outcome') THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_ACTION_INVALID' USING ERRCODE='22023';
  END IF;
  BEGIN
    _brief := nullif(btrim(coalesce(_command->>'briefId','')),'')::uuid;
    _action_id := nullif(btrim(coalesce(_command->>'actionId','')),'')::uuid;
    _automation := nullif(btrim(coalesce(_command->>'automationId','')),'')::uuid;
    _depends := nullif(btrim(coalesce(_command->>'dependsOnActionId','')),'')::uuid;
    _due := nullif(btrim(coalesce(_command->>'dueAt','')),'')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_ARGUMENTS_INVALID' USING ERRCODE='22023';
  END;
  -- A due time is an ISO date or timestamp, never a word such as 'tomorrow' that Postgres would also accept.
  IF _due IS NOT NULL AND (btrim(_command->>'dueAt') !~ '^\d{4}-\d{2}-\d{2}' OR _due IN ('infinity'::timestamptz,'-infinity'::timestamptz)) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_ARGUMENTS_INVALID' USING ERRCODE='22023';
  END IF;
  IF _brief IS NULL OR (_action<>'plan_action' AND _action_id IS NULL) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_ARGUMENTS_INVALID' USING ERRCODE='22023';
  END IF;
  IF _action IN ('plan_action','link_action') THEN
    IF char_length(_tactic) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_TACTIC_INVALID' USING ERRCODE='22023'; END IF;
    IF _family NOT IN ('email','social','page','form','funnel','content','ads','event','outreach','sales_handoff','other') THEN
      RAISE EXCEPTION 'CAMPAIGN_ACTION_FAMILY_INVALID' USING ERRCODE='22023';
    END IF;
    IF _command ? 'expectedResult' AND _command->'expectedResult'<>'null'::jsonb THEN
      _expected := public._campaign_action_result(_command->'expectedResult','summary','target');
    END IF;
  END IF;
  IF _action='plan_action' AND (char_length(_title) NOT BETWEEN 1 AND 200 OR char_length(coalesce(_summary,''))>2000) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_TITLE_INVALID' USING ERRCODE='22023';
  END IF;
  IF _action='record_outcome' THEN _observed := public._campaign_action_result(_command->'observed','summary','value'); END IF;
  IF _action='evaluate_outcome' AND (_verdict NOT IN ('met','partly_met','not_met') OR char_length(coalesce(_note,''))>500) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_VERDICT_INVALID' USING ERRCODE='22023';
  END IF;

  -- The brief's own ledger: the hash is namespaced, so a key reused across the brief's writers conflicts.
  PERFORM pg_advisory_xact_lock(hashtextextended('campaign_brief_command:'||_tenant::text||':'||_idempotency_key, 0));
  SELECT * INTO _cached FROM public.campaign_brief_command_results WHERE tenant_id=_tenant AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF _cached.command_hash <> _hash THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN _cached.result;
  END IF;

  PERFORM 1 FROM public.campaign_briefs b WHERE b.id=_brief AND b.tenant_id=_tenant AND b.lifecycle_status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_NOT_FOUND' USING ERRCODE='22023'; END IF;

  IF _action='plan_action' THEN
    -- The bus's own writer: the kind, the lane, the caller's role, the archived-workspace guard and its
    -- audit are its. Asked at `confirm`, whatever the kind's default.
    BEGIN
      _filed := public.file_action('marketing.campaign_action', _title, _summary, NULL,
        jsonb_build_object('campaign_brief_id', _brief, 'tactic', _tactic, 'family', _family),
        NULL, NULL, NULL, _due, NULL, NULL, CASE WHEN _actor_kind='paige' THEN 'paige' ELSE 'owner' END, _tenant, 'confirm');
    EXCEPTION WHEN insufficient_privilege THEN
      -- Marketing admitted this caller on the tenant policy; the action bus keeps its own authority and
      -- refused. Say so, rather than surfacing the bus's raw error or pretending the step was planned.
      RAISE EXCEPTION 'CAMPAIGN_ACTION_BUS_REFUSED' USING ERRCODE='42501',
        HINT = 'The action bus did not accept this step from this account.';
    END;
    _action_id := (_filed->>'action_id')::uuid;
    INSERT INTO public.campaign_brief_actions(tenant_id, brief_id, action_id, tactic, family, automation_id, depends_on_action_id,
      expected_result, created_through, linked_by)
    VALUES (_tenant, _brief, _action_id, _tactic, _family, _automation, _depends, _expected, _actor_kind, _caller);
    _result := jsonb_build_object('ok',true,'outcome','planned','brief_id',_brief,'action_id',_action_id,'lifecycle','planned',
      'message','Planned. Nothing is drafted, sent or published; once prepared, it goes to you for approval.');

  ELSIF _action='link_action' THEN
    SELECT * INTO _link FROM public.campaign_brief_actions l WHERE l.action_id=_action_id AND l.tenant_id=_tenant;
    IF FOUND THEN
      IF _link.brief_id<>_brief THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN' USING ERRCODE='22023'; END IF;
      _result := jsonb_build_object('ok',true,'outcome','already_linked','brief_id',_brief,'action_id',_action_id,
        'message','Already part of this campaign.');
    ELSE
      IF NOT EXISTS(SELECT 1 FROM public.paige_actions a WHERE a.id=_action_id AND a.tenant_id=_tenant) THEN
        RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FOUND' USING ERRCODE='22023';
      END IF;
      BEGIN
        INSERT INTO public.campaign_brief_actions(tenant_id, brief_id, action_id, tactic, family, automation_id, depends_on_action_id,
          expected_result, created_through, linked_by)
        VALUES (_tenant, _brief, _action_id, _tactic, _family, _automation, _depends, _expected, _actor_kind, _caller);
        _result := jsonb_build_object('ok',true,'outcome','linked','brief_id',_brief,'action_id',_action_id,
          'message','Added to the campaign. The action itself is unchanged.');
      EXCEPTION WHEN unique_violation THEN
        -- Linked meanwhile by a concurrent command under another key: the same campaign is a no-op.
        IF EXISTS(SELECT 1 FROM public.campaign_brief_actions l WHERE l.action_id=_action_id AND l.brief_id=_brief AND l.tenant_id=_tenant) THEN
          _result := jsonb_build_object('ok',true,'outcome','already_linked','brief_id',_brief,'action_id',_action_id,
            'message','Already part of this campaign.');
        ELSE
          RAISE EXCEPTION 'CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN' USING ERRCODE='22023';
        END IF;
      END;
    END IF;

  ELSE
    SELECT * INTO _link FROM public.campaign_brief_actions l WHERE l.action_id=_action_id AND l.brief_id=_brief AND l.tenant_id=_tenant FOR UPDATE;
    IF _action='unlink_action' THEN
      IF FOUND THEN
        -- A step another step waits on keeps that wait honest: the dependant loses the dependency, not silently its order.
        UPDATE public.campaign_brief_actions SET depends_on_action_id=NULL WHERE brief_id=_brief AND depends_on_action_id=_action_id;
        DELETE FROM public.campaign_brief_actions l WHERE l.id=_link.id;
        GET DIAGNOSTICS _removed = ROW_COUNT;
      END IF;
      _result := jsonb_build_object('ok',true,'outcome',CASE WHEN coalesce(_removed,0)>0 THEN 'unlinked' ELSE 'not_linked' END,
        'brief_id',_brief,'action_id',_action_id,
        'message',CASE WHEN coalesce(_removed,0)>0 THEN 'Removed from the campaign. The action itself is unchanged.' ELSE 'It was not part of this campaign.' END);
    ELSE
      IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_LINKED' USING ERRCODE='22023'; END IF;
      SELECT a.status, (a.workflow_run_id IS NOT NULL OR coalesce(a.result ? 'approval_status', false))
        INTO _status, _proven FROM public.paige_actions a WHERE a.id=_action_id AND a.tenant_id=_tenant;
      IF _action='prepare_action' THEN
        -- S4a: the governed bridge the plan copy promised. A planned (filed) step reaches approval
        -- only through the bus's own writer — advance_action drafts it and, because the
        -- marketing.campaign_action kind requires approval, opens the pending approval row here.
        -- Same authority check, same audit, same approval machinery as every drafted action; this
        -- writer adds no second channel. Refused unless the step is still planned and this brief's.
        -- Command: {type:'prepare_action', briefId, actionId}
        IF _status IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FOUND' USING ERRCODE='22023'; END IF;
        IF _status <> 'filed' THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_PLANNED' USING ERRCODE='22023'; END IF;
        PERFORM public.advance_action(_action_id, 'drafted', NULL, NULL, NULL, NULL, NULL, NULL, NULL, _tenant);
        SELECT a.status INTO _status FROM public.paige_actions a WHERE a.id=_action_id AND a.tenant_id=_tenant;
        _result := jsonb_build_object('ok',true,'outcome','prepared','brief_id',_brief,'action_id',_action_id,
          'lifecycle', CASE WHEN _status='pending_approval' THEN 'approval_required' ELSE 'prepared' END,
          'message', CASE WHEN _status='pending_approval' THEN 'Prepared. It''s waiting in your approvals now.'
            ELSE 'Prepared. Nothing is sent; approving it records the step.' END);
      ELSIF _action='record_outcome' THEN
        -- Only what has finished has an outcome to observe.
        IF _status IS NULL OR _status NOT IN ('done','failed') THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FINISHED' USING ERRCODE='22023'; END IF;
        -- A step marked done with neither a run nor an approval behind it is only recorded: nothing shows it
        -- was carried out, so it takes no outcome that would read as a result of it.
        IF _status = 'done' AND NOT _proven THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_PROVEN' USING ERRCODE='22023'; END IF;
        IF _link.evaluated_at IS NOT NULL THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_ALREADY_EVALUATED' USING ERRCODE='22023'; END IF;
        UPDATE public.campaign_brief_actions SET observed_result=_observed, observed_at=now(), observed_through=_actor_kind WHERE id=_link.id;
        _result := jsonb_build_object('ok',true,'outcome','outcome_recorded','brief_id',_brief,'action_id',_action_id,'lifecycle','outcome_observed',
          'message','Outcome recorded, as stated. It is not counted as a measured figure.');
      ELSE
        IF _link.observed_at IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NO_OUTCOME' USING ERRCODE='22023'; END IF;
        IF _status IS NULL OR (_status = 'done' AND NOT _proven) OR _status NOT IN ('done','failed') THEN
          RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_PROVEN' USING ERRCODE='22023';
        END IF;
        UPDATE public.campaign_brief_actions
           SET evaluation=jsonb_strip_nulls(jsonb_build_object('verdict',_verdict,'note',_note)), evaluated_at=now(), evaluated_through=_actor_kind
         WHERE id=_link.id;
        _result := jsonb_build_object('ok',true,'outcome','evaluated','brief_id',_brief,'action_id',_action_id,'lifecycle','evaluated','verdict',_verdict,
          'message','Evaluation recorded.');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (_caller, 'campaign_brief', 'campaign_brief.actions', _brief,
    jsonb_build_object('tenant_id',_tenant,'actor_kind',_actor_kind,'command',_action,'action_id',_action_id,
      'idempotency_key',_idempotency_key,'outcome',_result->>'outcome'));
  INSERT INTO public.campaign_brief_command_results(tenant_id, idempotency_key, command_hash, actor_user_id, actor_kind, result)
  VALUES (_tenant, _idempotency_key, _hash, _caller, _actor_kind, _result);
  RETURN _result;
END $$;

REVOKE ALL ON FUNCTION public.configure_campaign_brief_actions(uuid,jsonb,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.configure_campaign_brief_actions(uuid,jsonb,text,text) TO authenticated;
