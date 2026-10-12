-- INT-298 / INT-342 MBC slice 6a — a form-started process runs only for its form or campaign, and a
-- campaign step's outcome only stands on a proven finish.
--
-- Contract: docs/delivery/process-scope-contract.md and docs/delivery/marketing-action-contract.md.
--
-- 1. form.submitted names the campaigns its form serves. The event payload gains `campaign_brief_ids`: the
--    non-archived campaigns the submitted form is attached to (campaign_brief_asset_links, MBC 3), read at
--    the moment of the event, so a form attached later is covered without rewriting any process.
-- 2. A process that starts when someone fills in a form must say which form or which campaign. Without a
--    scope it would run for every form in the workspace (the gap recorded in MBC 4a). A guard refuses to
--    switch such a process live unless its conditions carry exactly one scope:
--      {field:'payload.form_id', op:'eq', value:<form>} · {field:'payload.form_id', op:'in', value:[<forms>]}
--      · {field:'payload.campaign_brief_ids', op:'contains', value:<campaign>}
--    and every form and campaign it names belongs to the process's own workspace. A draft may stay
--    unscoped while it is being built. Production held no processes when this shipped (2026-10-12).
-- 3. `configure_process_scope` is the governed way to set it: owner/admin of the process's workspace,
--    tenant from auth, audited, idempotent by construction (it sets the scope; it never adds a second).
--    The dispatcher already evaluates `eq`, `in` and `contains` on the payload (decide.ts), so nothing in
--    the engine changes.
-- 4. Marketing Action truth (MBC 5 review carry-forward):
--    * an outcome is accepted only for a step whose finish is proven (a workflow run or an approval) or
--      that failed; a step marked done with neither stays `recorded` and takes no outcome;
--    * the read shows `outcome_observed`/`evaluated` only over a proven finish or a failure, so a recorded
--      step can never read as an evaluated success, however its row was written;
--    * two concurrent links of one action to the same campaign answer `already_linked`;
--    * a refusal by the action bus's own writer (`file_action`) is reported as such, never as a raw error.
--      Marketing admits the caller on the tenant policy (`is_tenant_admin`); `file_action` keeps its own
--      authority unchanged (the bus is not Marketing's).

-- ── 1. form.submitted carries the campaigns its form serves ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_growth_submission_emit_form_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _event_id uuid; _briefs jsonb;
BEGIN
  IF NEW.contact_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.contact_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- The contact must be this tenant's; a mismatched pin is a bug upstream, never an event to deliver.
  IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id) THEN
    RETURN NEW;
  END IF;
  -- A paused or archived workspace runs nothing; keep the submission, start no process.
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND (t.archived_at IS NOT NULL OR t.lifecycle_execution_paused)) THEN
    RETURN NEW;
  END IF;
  -- The campaigns this form is part of, so a process can be limited to one campaign.
  SELECT jsonb_agg(l.brief_id ORDER BY l.brief_id) INTO _briefs
  FROM public.campaign_brief_asset_links l
  JOIN public.campaign_briefs b ON b.id = l.brief_id AND b.tenant_id = NEW.tenant_id AND b.lifecycle_status <> 'archived'
  WHERE l.tenant_id = NEW.tenant_id AND l.asset_kind = 'form' AND l.asset_id = NEW.form_id;
  INSERT INTO public.paige_native_events
    (event_key, tenant_id, subject_table, subject_id, dedup_key, payload)
  VALUES (
    'form.submitted', NEW.tenant_id, 'clients', NEW.contact_id,
    'form.submitted:' || NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'submission_id',     NEW.id,
      'form_id',           NEW.form_id,
      'contact_id',        NEW.contact_id,
      'source',            NEW.source,
      'utm_source',        NEW.utm_json->>'utm_source',
      'utm_campaign',      NEW.utm_json->>'utm_campaign',
      'campaign_brief_ids', coalesce(_briefs, '[]'::jsonb),
      'submitted_at',      NEW.created_at
    ))
  )
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO _event_id;

  IF _event_id IS NOT NULL THEN
    PERFORM public.paige_fire_event_processor(_event_id, NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_growth_submission_emit_form_submitted() FROM PUBLIC, anon, authenticated;

-- ── 2. a form-started process names its form or campaign before it runs ────────────────────────
-- The scope conditions of a process, or NULL when it has none. Raises when they are malformed, name
-- something outside the workspace, or say it twice.
CREATE OR REPLACE FUNCTION public._process_form_scope(_tenant uuid, _conditions jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE _c jsonb; _scope jsonb; _ids uuid[]; _n integer := 0;
BEGIN
  IF _conditions IS NULL OR jsonb_typeof(_conditions) <> 'array' THEN RETURN NULL; END IF;
  FOR _c IN SELECT value FROM jsonb_array_elements(_conditions) LOOP
    IF jsonb_typeof(_c) <> 'object' OR _c->>'field' NOT IN ('payload.form_id','payload.campaign_brief_ids') THEN CONTINUE; END IF;
    _n := _n + 1;
    BEGIN
      IF _c->>'field' = 'payload.form_id' AND _c->>'op' = 'eq' AND jsonb_typeof(_c->'value') = 'string' THEN
        _ids := ARRAY[(_c->>'value')::uuid];
        IF (SELECT count(*) FROM public.growth_forms f WHERE f.id = ANY(_ids) AND f.tenant_id = _tenant) <> 1 THEN
          RAISE EXCEPTION 'PROCESS_SCOPE_NOT_FOUND' USING ERRCODE='22023';
        END IF;
        _scope := jsonb_build_object('kind','form','form_ids',to_jsonb(_ids));
      ELSIF _c->>'field' = 'payload.form_id' AND _c->>'op' = 'in' AND jsonb_typeof(_c->'value') = 'array'
            AND jsonb_array_length(_c->'value') BETWEEN 1 AND 50 THEN
        SELECT array_agg(DISTINCT v::uuid) INTO _ids FROM jsonb_array_elements_text(_c->'value') v;
        IF (SELECT count(*) FROM public.growth_forms f WHERE f.id = ANY(_ids) AND f.tenant_id = _tenant) <> cardinality(_ids) THEN
          RAISE EXCEPTION 'PROCESS_SCOPE_NOT_FOUND' USING ERRCODE='22023';
        END IF;
        _scope := jsonb_build_object('kind','form','form_ids',to_jsonb(_ids));
      ELSIF _c->>'field' = 'payload.campaign_brief_ids' AND _c->>'op' = 'contains' AND jsonb_typeof(_c->'value') = 'string' THEN
        IF NOT EXISTS (SELECT 1 FROM public.campaign_briefs b WHERE b.id = (_c->>'value')::uuid AND b.tenant_id = _tenant) THEN
          RAISE EXCEPTION 'PROCESS_SCOPE_NOT_FOUND' USING ERRCODE='22023';
        END IF;
        _scope := jsonb_build_object('kind','campaign','brief_id',_c->>'value');
      ELSE
        RAISE EXCEPTION 'PROCESS_SCOPE_INVALID' USING ERRCODE='22023';
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'PROCESS_SCOPE_INVALID' USING ERRCODE='22023';
    END;
  END LOOP;
  IF _n > 1 THEN RAISE EXCEPTION 'PROCESS_SCOPE_INVALID' USING ERRCODE='22023'; END IF;
  RETURN _scope;
END $$;
REVOKE ALL ON FUNCTION public._process_form_scope(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Every write, whoever writes it: a live form-started process carries one valid scope, and any scope a
-- process carries names only its own workspace's forms and campaigns.
CREATE OR REPLACE FUNCTION public._automation_form_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _scope jsonb;
BEGIN
  IF NEW.trigger_key <> 'form.submitted' THEN RETURN NEW; END IF;
  _scope := public._process_form_scope(NEW.tenant_id, NEW.conditions);
  IF NEW.state = 'live' AND _scope IS NULL THEN
    RAISE EXCEPTION 'PROCESS_SCOPE_REQUIRED' USING ERRCODE='22023',
      HINT = 'A process that starts when someone fills in a form runs only for the form or campaign it names.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._automation_form_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS automation_form_scope_guard ON public.paige_automations;
CREATE TRIGGER automation_form_scope_guard BEFORE INSERT OR UPDATE OF state, conditions, trigger_key ON public.paige_automations
  FOR EACH ROW EXECUTE FUNCTION public._automation_form_scope_guard();

-- ── 3. the governed seam: set or read a process's form/campaign scope ─────────────────────────
-- _scope: {formId} | {formIds:[...]} | {briefId}. Replaces any earlier scope; every other condition stays.
CREATE OR REPLACE FUNCTION public.configure_process_scope(_automation_id uuid, _scope jsonb, _actor_kind text DEFAULT 'human')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _row public.paige_automations%ROWTYPE;
  _cond jsonb;
  _rest jsonb;
  _ids jsonb;
  _resolved jsonb;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR public.is_tenant_admin(_tenant)) THEN
    RAISE EXCEPTION 'PROCESS_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF _actor_kind IS NULL OR _actor_kind NOT IN ('human','paige') THEN RAISE EXCEPTION 'PROCESS_ACTOR_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO _row FROM public.paige_automations a WHERE a.id = _automation_id AND a.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCESS_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF _row.trigger_key <> 'form.submitted' THEN RAISE EXCEPTION 'PROCESS_NOT_FORM_STARTED' USING ERRCODE='22023'; END IF;
  IF _scope IS NULL OR jsonb_typeof(_scope) <> 'object' THEN RAISE EXCEPTION 'PROCESS_SCOPE_INVALID' USING ERRCODE='22023'; END IF;

  IF _scope ? 'formId' AND NOT (_scope ? 'formIds') AND NOT (_scope ? 'briefId') THEN
    _cond := jsonb_build_object('field','payload.form_id','op','eq','value',_scope->'formId');
  ELSIF _scope ? 'formIds' AND NOT (_scope ? 'formId') AND NOT (_scope ? 'briefId') AND jsonb_typeof(_scope->'formIds') = 'array' THEN
    SELECT jsonb_agg(DISTINCT v ORDER BY v) INTO _ids FROM jsonb_array_elements(_scope->'formIds') v;
    _cond := jsonb_build_object('field','payload.form_id','op','in','value',coalesce(_ids,'[]'::jsonb));
  ELSIF _scope ? 'briefId' AND NOT (_scope ? 'formId') AND NOT (_scope ? 'formIds') THEN
    _cond := jsonb_build_object('field','payload.campaign_brief_ids','op','contains','value',_scope->'briefId');
  ELSE
    RAISE EXCEPTION 'PROCESS_SCOPE_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT coalesce(jsonb_agg(c), '[]'::jsonb) INTO _rest
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_row.conditions) = 'array' THEN _row.conditions ELSE '[]'::jsonb END) c
  WHERE NOT (jsonb_typeof(c) = 'object' AND c->>'field' IN ('payload.form_id','payload.campaign_brief_ids'));
  -- Validates the new scope (workspace, shape) before anything is written.
  _resolved := public._process_form_scope(_tenant, jsonb_build_array(_cond));

  UPDATE public.paige_automations SET conditions = _rest || jsonb_build_array(_cond), updated_at = now() WHERE id = _row.id;

  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (_caller, 'paige_automation', 'process.scope', _row.id,
    jsonb_build_object('tenant_id', _tenant, 'actor_kind', _actor_kind, 'scope', _resolved));
  RETURN jsonb_build_object('ok', true, 'automation_id', _row.id, 'scope', _resolved, 'state', _row.state,
    'message', CASE WHEN _resolved->>'kind' = 'campaign'
      THEN 'It runs only when someone fills in a form that is part of this campaign.'
      ELSE 'It runs only when someone fills in this form.' END);
END $$;
REVOKE ALL ON FUNCTION public.configure_process_scope(uuid,jsonb,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.configure_process_scope(uuid,jsonb,text) TO authenticated;

-- What a form-started process is limited to, with names, for the screen and for PAIGE.
CREATE OR REPLACE FUNCTION public.get_process_scope(_automation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE _tenant uuid := public.current_user_tenant_id(); _row public.paige_automations%ROWTYPE; _scope jsonb;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'PROCESS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO _row FROM public.paige_automations a WHERE a.id = _automation_id AND a.tenant_id = _tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROCESS_NOT_FOUND' USING ERRCODE='22023'; END IF;
  IF _row.trigger_key <> 'form.submitted' THEN
    RETURN jsonb_build_object('automation_id', _row.id, 'applies', false);
  END IF;
  BEGIN
    _scope := public._process_form_scope(_tenant, _row.conditions);
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('automation_id', _row.id, 'applies', true, 'scope', NULL, 'scope_valid', false, 'can_go_live', false);
  END;
  IF _scope->>'kind' = 'form' THEN
    _scope := _scope || jsonb_build_object('forms', (SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) ORDER BY f.name)
      FROM public.growth_forms f WHERE f.tenant_id = _tenant AND f.id IN (SELECT (jsonb_array_elements_text(_scope->'form_ids'))::uuid)));
  ELSIF _scope->>'kind' = 'campaign' THEN
    _scope := _scope || jsonb_build_object('campaign', (SELECT jsonb_build_object('id', b.id, 'name', b.name)
      FROM public.campaign_briefs b WHERE b.tenant_id = _tenant AND b.id = (_scope->>'brief_id')::uuid));
  END IF;
  RETURN jsonb_build_object('automation_id', _row.id, 'applies', true, 'scope', _scope, 'scope_valid', true,
    'can_go_live', _scope IS NOT NULL, 'state', _row.state);
END $$;
REVOKE ALL ON FUNCTION public.get_process_scope(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_process_scope(uuid) TO authenticated;

-- ── 4. Marketing Action truth: the writer and the read, re-created with the carry-forward fixes ──
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
  IF _action NOT IN ('plan_action','link_action','unlink_action','record_outcome','evaluate_outcome') THEN
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
        DETAIL = SQLERRM, HINT = 'The action bus did not accept this step from this account.';
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
      IF _action='record_outcome' THEN
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

CREATE OR REPLACE FUNCTION public.get_campaign_brief_actions(_tenant_id uuid, _brief_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
  _admin boolean;
  _briefs jsonb;
  _actions jsonb;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  _admin := public.is_platform_owner() OR public.is_tenant_admin(_tenant);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'brief_id', b.id, 'name', b.name, 'objective', b.objective, 'audience', b.audience, 'offer_id', b.offer_id,
      'lifecycle_status', b.lifecycle_status,
      -- The strategy a campaign serves, when its mission exists in this workspace.
      'mission', CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('id', m.id, 'title', m.title, 'state', m.lifecycle_state) END
    ) ORDER BY b.updated_at DESC, b.id), '[]'::jsonb)
  INTO _briefs
  FROM public.campaign_briefs b
  LEFT JOIN public.business_missions m ON m.id=b.mission_id AND m.tenant_id=_tenant
  WHERE b.tenant_id=_tenant AND b.lifecycle_status<>'archived' AND (_brief_id IS NULL OR b.id=_brief_id);

  WITH rows AS (
    SELECT l.*, a.status, a.action_kind, a.title, a.summary, a.autonomy_lane, a.approval_id, a.to_department,
      a.assigned_subagent_slug, a.assigned_to_user_id, a.due_at, a.executed_at, a.resolved_at, a.error,
      a.workflow_run_id, a.result, k.label kind_label, k.executor, k.requires_approval,
      r.status run_status, w.status work_status, dep.status dep_status,
      -- An outcome counts only over a proven finish (a run or an approval) or a failure.
      (a.status='failed' OR (a.status='done' AND (a.workflow_run_id IS NOT NULL OR coalesce(a.result ? 'approval_status', false)))) finish_counts
    FROM public.campaign_brief_actions l
    JOIN public.campaign_briefs b ON b.id=l.brief_id AND b.tenant_id=_tenant AND b.lifecycle_status<>'archived'
    JOIN public.paige_actions a ON a.id=l.action_id AND a.tenant_id=_tenant
    LEFT JOIN public.paige_action_kinds k ON k.slug=a.action_kind AND (k.tenant_id IS NULL OR k.tenant_id=_tenant)
    LEFT JOIN public.paige_workflow_runs r ON r.id=a.workflow_run_id AND r.tenant_id=_tenant
    LEFT JOIN public.paige_durable_work w ON w.id=r.work_id AND w.tenant_id=_tenant
    LEFT JOIN public.paige_actions dep ON dep.id=l.depends_on_action_id AND dep.tenant_id=_tenant
    WHERE l.tenant_id=_tenant AND (_brief_id IS NULL OR l.brief_id=_brief_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'brief_id', x.brief_id, 'action_id', x.action_id, 'tactic', x.tactic, 'family', x.family,
      'lifecycle', CASE
        WHEN x.evaluated_at IS NOT NULL AND x.finish_counts THEN 'evaluated'
        WHEN x.observed_at IS NOT NULL AND x.finish_counts THEN 'outcome_observed'
        WHEN x.status IN ('filed','assigned') THEN 'planned'
        WHEN x.status IN ('drafting','drafted') THEN 'prepared'
        WHEN x.status='pending_approval' THEN 'approval_required'
        WHEN x.status='approved' AND x.due_at > now() THEN 'scheduled'
        WHEN x.status='approved' THEN 'approved'
        WHEN x.status='executing' AND x.work_status='outcome_unknown' THEN 'unknown'
        WHEN x.status='executing' THEN 'executing'
        WHEN x.status='done' AND x.workflow_run_id IS NULL AND NOT coalesce(x.result ? 'approval_status', false) THEN 'recorded'
        WHEN x.status='done' THEN 'completed'
        WHEN x.status='failed' THEN 'failed'
        WHEN x.status='blocked' THEN 'blocked'
        ELSE 'stopped' END,
      'status', x.status, 'action_kind', x.action_kind, 'kind_label', x.kind_label,
      'title', CASE WHEN _admin THEN x.title END,
      'summary', CASE WHEN _admin THEN x.summary END,
      'approval', jsonb_build_object('lane', x.autonomy_lane, 'required', coalesce(x.requires_approval, true),
        'approval_id', CASE WHEN _admin THEN x.approval_id END),
      'owner', jsonb_build_object('department', x.to_department, 'specialist', x.assigned_subagent_slug,
        'person_assigned', x.assigned_to_user_id IS NOT NULL),
      'due_at', x.due_at,
      'depends_on_action_id', x.depends_on_action_id,
      'waiting_on_dependency', x.depends_on_action_id IS NOT NULL AND coalesce(x.dep_status,'') <> 'done',
      'automation_id', x.automation_id,
      'expected_result', x.expected_result,
      'observed_result', CASE WHEN x.finish_counts THEN x.observed_result END,
      'observed_at', CASE WHEN x.finish_counts THEN x.observed_at END,
      'observed_through', CASE WHEN x.finish_counts THEN x.observed_through END,
      'evaluation', CASE WHEN x.finish_counts THEN x.evaluation END,
      'evaluated_at', CASE WHEN x.finish_counts THEN x.evaluated_at END,
      'evaluated_through', CASE WHEN x.finish_counts THEN x.evaluated_through END,
      'evidence', jsonb_strip_nulls(jsonb_build_object(
        'basis', CASE
          WHEN x.status NOT IN ('done','failed') THEN NULL
          WHEN x.workflow_run_id IS NOT NULL THEN 'workflow_run'
          WHEN x.result ? 'approval_status' THEN 'approval'
          ELSE 'recorded' END,
        'workflow_run_status', x.run_status, 'durable_work_status', x.work_status,
        'executed_at', x.executed_at, 'resolved_at', x.resolved_at,
        'error', CASE WHEN _admin THEN x.error END)),
      'created_through', x.created_through, 'linked_at', x.created_at
    ) ORDER BY x.brief_id, x.created_at, x.action_id), '[]'::jsonb)
  INTO _actions FROM rows x;

  RETURN jsonb_build_object('can_manage', _admin, 'briefs', _briefs, 'actions', _actions);
END $$;
REVOKE ALL ON FUNCTION public.get_campaign_brief_actions(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_brief_actions(uuid,uuid) TO authenticated;
