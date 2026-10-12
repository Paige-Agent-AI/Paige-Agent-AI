-- INT-298 / INT-342 MBC slice 5 — the Marketing Action contract.
--
-- Strategy → Campaign → Tactic → Marketing Action → Execution → Outcome → Learning.
-- The canonical action already exists: a `paige_actions` row on the action bus (20260711140000) carries
-- the kind, departments, title, autonomy lane, approval, owner (department / specialist / person), due
-- date, result, error and workflow run, and moves only through `file_action` / `advance_action` and the
-- approval and run triggers. What it cannot say is which campaign and tactic it serves, what result was
-- expected, what was observed afterwards, and how that was judged. This adds one Marketing-owned link for
-- exactly that, and one read that projects the honest lifecycle. No second job engine, approval queue or
-- scheduler: execution, approval and Trust stay with the bus and its owners.
--
-- Contract: docs/delivery/marketing-action-contract.md.
--   * Writes go only through `configure_campaign_brief_actions`, modelled on the brief's other writers:
--     tenant re-resolved from auth (§9/§59), owner/admin seat (§53), idempotent through the brief's own
--     command ledger, audited.
--   * `plan_action` files a new `marketing.campaign_action` through the existing `file_action` at
--     `confirm`. The kind needs approval, is record-only and has no drafting specialist, so planning
--     drafts, sends and publishes nothing; the step moves only through the bus's own `advance_action`
--     and the approval trigger. `file_action` keeps its own checks on the caller: it also requires the
--     global admin/coach role, which the membership sync gives every active tenant owner and admin
--     (`map_tenant_role_to_app_role`: owner and admin → admin; on production 2026-10-12, 9 of 9).
--   * `link_action` attaches an action that already exists in the workspace (for example a workflow run
--     Paige filed), so its real execution lifecycle shows under the campaign.
--   * An outcome may be recorded only once the action has finished (done or failed), and judged only once
--     an outcome is recorded. Both say who recorded them; neither is a metric.
--   * The lifecycle is derived on read from the action's own status, never stored here, so it cannot
--     drift from what the bus did.

INSERT INTO public.paige_action_kinds(slug, tenant_id, label, description, default_from_department, default_to_department,
  executor, requires_approval, approval_type, draft_subagent_slug, default_autonomy_lane, default_priority, enabled)
VALUES ('marketing.campaign_action', NULL, 'Carry out a campaign step',
  'A planned step in a campaign. Once prepared it goes to the owner for approval; approving it records the step, it does not send or publish anything.',
  'marketing', 'marketing', 'record_only', true, 'cs_draft', NULL, 'confirm', 'normal', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.campaign_brief_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  brief_id uuid NOT NULL REFERENCES public.campaign_briefs(id) ON DELETE CASCADE,
  -- One campaign per action: an action serves one plan.
  action_id uuid NOT NULL UNIQUE REFERENCES public.paige_actions(id) ON DELETE CASCADE,
  tactic text NOT NULL CHECK (char_length(btrim(tactic)) BETWEEN 1 AND 120),
  family text NOT NULL CHECK (family IN ('email','social','page','form','funnel','content','ads','event','outreach','sales_handoff','other')),
  -- The repeatable process this tactic runs as, when there is one (§67).
  automation_id uuid REFERENCES public.paige_automations(id) ON DELETE SET NULL,
  -- Another action of the same campaign that must finish first.
  depends_on_action_id uuid REFERENCES public.paige_actions(id) ON DELETE SET NULL,
  expected_result jsonb,
  observed_result jsonb,
  observed_at timestamptz,
  observed_through text CHECK (observed_through IN ('human','paige')),
  evaluation jsonb,
  evaluated_at timestamptz,
  evaluated_through text CHECK (evaluated_through IN ('human','paige')),
  created_through text NOT NULL CHECK (created_through IN ('human','paige')),
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((observed_at IS NULL) = (observed_result IS NULL)),
  CHECK (evaluated_at IS NULL OR observed_at IS NOT NULL),
  CHECK (depends_on_action_id IS DISTINCT FROM action_id)
);
CREATE INDEX IF NOT EXISTS campaign_brief_actions_brief ON public.campaign_brief_actions (tenant_id, brief_id, created_at);
-- Every foreign key leads an index, so deletes and account retirement never scan the table (ANT-47).
CREATE INDEX IF NOT EXISTS campaign_brief_actions_brief_fk ON public.campaign_brief_actions (brief_id);
CREATE INDEX IF NOT EXISTS campaign_brief_actions_automation_fk ON public.campaign_brief_actions (automation_id) WHERE automation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_brief_actions_depends_fk ON public.campaign_brief_actions (depends_on_action_id) WHERE depends_on_action_id IS NOT NULL;

ALTER TABLE public.campaign_brief_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_brief_actions_tenant_read ON public.campaign_brief_actions;
CREATE POLICY campaign_brief_actions_tenant_read ON public.campaign_brief_actions FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR tenant_id = public.current_user_tenant_id());
REVOKE ALL ON public.campaign_brief_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.campaign_brief_actions TO authenticated;
GRANT ALL ON public.campaign_brief_actions TO service_role;

-- Integrity on every write, whoever writes: brief, action, process and dependency all belong to the link's
-- tenant; the brief is not archived; a dependency is part of the same campaign; the campaign never moves.
CREATE OR REPLACE FUNCTION public._campaign_brief_action_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.brief_id IS DISTINCT FROM OLD.brief_id
        OR NEW.action_id IS DISTINCT FROM OLD.action_id THEN
      RAISE EXCEPTION 'CAMPAIGN_ACTION_LINK_IMMUTABLE' USING ERRCODE='42501';
    END IF;
    -- The campaign and action were checked when linked. An update re-checks only a new process or
    -- dependency, so deleting a process or an action (ON DELETE SET NULL) is never refused because
    -- the campaign was archived since.
    IF NEW.automation_id IS NOT NULL AND NEW.automation_id IS DISTINCT FROM OLD.automation_id
       AND NOT EXISTS(SELECT 1 FROM public.paige_automations p WHERE p.id=NEW.automation_id AND p.tenant_id=NEW.tenant_id) THEN
      RAISE EXCEPTION 'CAMPAIGN_ACTION_PROCESS_NOT_FOUND' USING ERRCODE='22023';
    END IF;
    IF NEW.depends_on_action_id IS NOT NULL AND NEW.depends_on_action_id IS DISTINCT FROM OLD.depends_on_action_id
       AND NOT EXISTS(SELECT 1 FROM public.campaign_brief_actions d
         WHERE d.action_id=NEW.depends_on_action_id AND d.brief_id=NEW.brief_id AND d.tenant_id=NEW.tenant_id) THEN
      RAISE EXCEPTION 'CAMPAIGN_ACTION_DEPENDENCY_INVALID' USING ERRCODE='22023';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaign_briefs b WHERE b.id=NEW.brief_id AND b.tenant_id=NEW.tenant_id AND b.lifecycle_status<>'archived') THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_actions a WHERE a.id=NEW.action_id AND a.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  IF NEW.automation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_automations p WHERE p.id=NEW.automation_id AND p.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_PROCESS_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  IF NEW.depends_on_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.campaign_brief_actions d
      WHERE d.action_id=NEW.depends_on_action_id AND d.brief_id=NEW.brief_id AND d.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_DEPENDENCY_INVALID' USING ERRCODE='22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._campaign_brief_action_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS campaign_brief_action_guard ON public.campaign_brief_actions;
CREATE TRIGGER campaign_brief_action_guard BEFORE INSERT OR UPDATE ON public.campaign_brief_actions
  FOR EACH ROW EXECUTE FUNCTION public._campaign_brief_action_guard();

-- A short statement of a result: required text, an optional metric key and number. Nothing else is kept.
CREATE OR REPLACE FUNCTION public._campaign_action_result(_value jsonb, _summary_key text, _number_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE _summary text; _metric text; _number numeric;
BEGIN
  IF _value IS NULL OR jsonb_typeof(_value)<>'object' THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_RESULT_INVALID' USING ERRCODE='22023'; END IF;
  _summary := btrim(coalesce(_value->>'summary',''));
  _metric := nullif(btrim(coalesce(_value->>'metricKey','')),'');
  IF _summary='' OR char_length(_summary)>500 THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_RESULT_INVALID' USING ERRCODE='22023'; END IF;
  IF _metric IS NOT NULL AND (_metric !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' OR char_length(_metric)>120) THEN
    RAISE EXCEPTION 'CAMPAIGN_ACTION_RESULT_INVALID' USING ERRCODE='22023';
  END IF;
  IF _value ? _number_key AND _value->_number_key <> 'null'::jsonb THEN
    IF jsonb_typeof(_value->_number_key)<>'number' THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_RESULT_INVALID' USING ERRCODE='22023'; END IF;
    _number := (_value->>_number_key)::numeric;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(_summary_key, _summary, 'metric_key', _metric, _number_key, _number));
END $$;
REVOKE ALL ON FUNCTION public._campaign_action_result(jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;

-- ── governed write seam ──────────────────────────────────────────────────────────────────────
-- Commands:
--   {type:'plan_action', briefId, title, summary?, tactic, family, dueAt?, automationId?, dependsOnActionId?,
--    expectedResult?:{summary, metricKey?, target?}}
--   {type:'link_action', briefId, actionId, tactic, family, automationId?, dependsOnActionId?, expectedResult?}
--   {type:'unlink_action', briefId, actionId}
--   {type:'record_outcome', briefId, actionId, observed:{summary, metricKey?, value?}}
--   {type:'evaluate_outcome', briefId, actionId, verdict:'met'|'partly_met'|'not_met', note?}
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
    _filed := public.file_action('marketing.campaign_action', _title, _summary, NULL,
      jsonb_build_object('campaign_brief_id', _brief, 'tactic', _tactic, 'family', _family),
      NULL, NULL, NULL, _due, NULL, NULL, CASE WHEN _actor_kind='paige' THEN 'paige' ELSE 'owner' END, _tenant, 'confirm');
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
      EXCEPTION WHEN unique_violation THEN
        -- Linked meanwhile by a concurrent command (under another key).
        RAISE EXCEPTION 'CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN' USING ERRCODE='22023';
      END;
      _result := jsonb_build_object('ok',true,'outcome','linked','brief_id',_brief,'action_id',_action_id,
        'message','Added to the campaign. The action itself is unchanged.');
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
      SELECT a.status INTO _status FROM public.paige_actions a WHERE a.id=_action_id AND a.tenant_id=_tenant;
      IF _action='record_outcome' THEN
        -- Only what has finished has an outcome to observe.
        IF _status IS NULL OR _status NOT IN ('done','failed') THEN RAISE EXCEPTION 'CAMPAIGN_ACTION_NOT_FINISHED' USING ERRCODE='22023'; END IF;
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

-- ── read seam ────────────────────────────────────────────────────────────────────────────────
-- Each campaign's actions with their derived lifecycle:
--   filed/assigned → planned · drafting/drafted → prepared · pending_approval → approval_required ·
--   approved → scheduled while its due time is ahead, else approved · executing → unknown when its run's
--   durable work reports outcome_unknown, else executing · done → completed when a run or an approval
--   stands behind it, else recorded (moved to done with neither, which proves nothing was carried out) ·
--   failed → failed · blocked → blocked · dismissed/expired → stopped; then outcome_observed and
--   evaluated once recorded.
-- `evidence.basis` says what a finish rests on: a workflow run, an approval, or a record. Members (who
-- cannot read the action bus) see the plan and lifecycle without titles or errors.
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
      r.status run_status, w.status work_status, dep.status dep_status
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
        WHEN x.evaluated_at IS NOT NULL THEN 'evaluated'
        WHEN x.observed_at IS NOT NULL THEN 'outcome_observed'
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
      'observed_result', x.observed_result, 'observed_at', x.observed_at, 'observed_through', x.observed_through,
      'evaluation', x.evaluation, 'evaluated_at', x.evaluated_at, 'evaluated_through', x.evaluated_through,
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

-- ── account retirement: the links go with the account, like the briefs they belong to ─────────
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('''campaign_brief_asset_links''' IN body)=0 OR position('campaign_brief_actions' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering campaign_brief_actions'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''campaign_brief_actions'','||substr(body,at+length(anchor));
END $$;
