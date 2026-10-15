-- Experience 05: one owner-authorized weekly PERSONAL Planning commitment check.
-- Extends §67 processes, the native event bus and canonical act evidence; no new ledger/job.
-- SHIP DARK. A separate authorized release changes the catalogue's is_live, never this migration.
INSERT INTO public.paige_automation_triggers(key,label,category,description,is_live,dark_reason)
VALUES ('schedule.weekly_commitment_check','Weekly internal commitment check','planning',
  'Read the authorizing owner''s open Planning commitments and preserve an internal observation.',false,
  'Weekly occurrence publication is awaiting released and authenticated acceptance.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.paige_action_kinds(slug,label,description,default_from_department,
  default_to_department,executor,requires_approval,approval_type,default_autonomy_lane)
VALUES ('planning.weekly_commitment_check','Check internal commitments',
  'Read-only personal Planning check; no task changes, provider calls or customer messages.',
  'owner_ops','owner_ops','record_only',false,'other','auto')
ON CONFLICT (slug) DO NOTHING;

-- Metadata-only addition to the incumbent Settings permission catalogue. Missing override stays confirm.
-- Schedule authorization does not write tenant_tool_autonomy or widen any other authority.
DO $$ BEGIN
  IF to_regprocedure('public._list_tool_autonomy_before_weekly_commitment(uuid)') IS NULL THEN
    ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_weekly_commitment;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_weekly_commitment(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_weekly_commitment(uuid) FROM service_role;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
  RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_weekly_commitment(_tenant_id);
  IF auth.uid() IS NOT NULL THEN
    _tenant:=public.current_user_tenant_id();
    IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
  ELSE _tenant:=_tenant_id; END IF;
  RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
    ('planning_weekly_commitment_check','Weekly internal commitment check','Planning')
  ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
    FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
      ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- Preserve the incumbent activity display and add meaningful, content-free owner wording.
DO $$ BEGIN
  IF to_regprocedure('public._workspace_event_display_before_weekly_commitment(text,text,text)') IS NULL THEN
    ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_weekly_commitment;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_weekly_commitment(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE _result jsonb;
BEGIN
  _result:=public._workspace_event_display_before_weekly_commitment(_source_kind,_outcome,_capability);
  IF _source_kind='capability_run' AND _outcome='capability_succeeded'
    AND _capability='planning_weekly_commitment_check' THEN
    _result:=_result||jsonb_build_object('title','Weekly commitment check completed',
      'summary','PAIGE recorded the owner''s internal commitment check. The owner can inspect its result.');
  END IF;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.weekly_commitment_owner(_tenant uuid,_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT _tenant IS NOT NULL AND _actor IS NOT NULL
    AND (auth.uid() IS NULL OR (auth.uid()=_actor AND public.current_user_tenant_id()=_tenant)) AND EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=_tenant AND m.user_id=_actor AND m.role::text='owner'
      AND m.status='active' AND t.archived_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.weekly_commitment_owner(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.weekly_commitment_owner(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.weekly_commitment_schedule(_weekday integer,_local_time text,_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF _weekday IS NULL OR _weekday NOT BETWEEN 1 AND 7 OR _local_time IS NULL
     OR _local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR _timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=_timezone)
     OR _timezone ~ '^(posix|right)/' THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_SCHEDULE' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('weekday',_weekday,'local_time',_local_time,'timezone',_timezone);
END $$;
REVOKE ALL ON FUNCTION public.weekly_commitment_schedule(integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_commitment_schedule(integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_commitment_next(_config jsonb,_after timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE _day date; _local timestamp; _next timestamptz;
BEGIN
  PERFORM public.weekly_commitment_schedule((_config->>'weekday')::integer,_config->>'local_time',_config->>'timezone');
  _day := (_after AT TIME ZONE (_config->>'timezone'))::date;
  _day := _day + (((_config->>'weekday')::integer-extract(isodow FROM _day)::integer+7)%7);
  _local := _day + (_config->>'local_time')::time;
  _next := _local AT TIME ZONE (_config->>'timezone');
  IF _next <= _after THEN _next := (_local+interval '7 days') AT TIME ZONE (_config->>'timezone'); END IF;
  -- One local occurrence. PostgreSQL resolves skipped times forward and repeated times to standard time.
  RETURN _next;
END $$;
REVOKE ALL ON FUNCTION public.weekly_commitment_next(jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_commitment_next(jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_commitment_conditions(_id uuid,_revision integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('field','payload.automation_id','op','eq','value',_id::text),
    jsonb_build_object('field','payload.schedule_revision','op','eq','value',_revision));
$$;
REVOKE ALL ON FUNCTION public.weekly_commitment_conditions(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_commitment_conditions(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_commitment_retirement_allowed(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.operator_can_retire_accounts() AND EXISTS(
    SELECT 1 FROM public.operator_account_archives r WHERE r.state='deleting' AND _tenant=ANY(r.scope_ids));
$$;
REVOKE ALL ON FUNCTION public.weekly_commitment_retirement_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- INVOKER is deliberate: direct authenticated/service table writes retain their role and are refused;
-- canonical SECURITY DEFINER RPCs run as this trigger function's database owner. No client-set GUC/token.
CREATE OR REPLACE FUNCTION public.guard_weekly_commitment_process()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE _is_weekly boolean; _owner text;
BEGIN
  _is_weekly := CASE WHEN TG_OP='INSERT' THEN NEW.trigger_key='schedule.weekly_commitment_check'
    WHEN TG_OP='DELETE' THEN OLD.trigger_key='schedule.weekly_commitment_check'
    ELSE NEW.trigger_key='schedule.weekly_commitment_check' OR OLD.trigger_key='schedule.weekly_commitment_check' END;
  IF NOT _is_weekly THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO _owner FROM pg_catalog.pg_proc p
    WHERE p.oid='public.guard_weekly_commitment_process()'::regprocedure;
  IF current_user <> _owner THEN RAISE EXCEPTION 'WEEKLY_CHECK_RPC_REQUIRED' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN
    -- Canonical tenant retirement has already removed the owning tenant before its FK cascade fires.
    IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=OLD.tenant_id)
      OR public.weekly_commitment_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'WEEKLY_CHECK_PRESERVE_HISTORY' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.trigger_key<>OLD.trigger_key) THEN RAISE EXCEPTION 'WEEKLY_CHECK_IDENTITY_IMMUTABLE' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND pg_catalog.pg_trigger_depth()=2
     AND public.weekly_commitment_retirement_allowed(OLD.tenant_id)
     AND (to_jsonb(NEW)-ARRAY['granted_lane','acts_fingerprint','updated_at'])=
       (to_jsonb(OLD)-ARRAY['granted_lane','acts_fingerprint','updated_at'])
     AND NOT EXISTS(SELECT 1 FROM public.paige_automation_acts ac WHERE ac.automation_id=OLD.id)
     AND public.autonomy_lane_rank(NEW.granted_lane)<=public.autonomy_lane_rank(OLD.granted_lane) THEN
    -- The canonical retirement plan identifies this soon-deleted parent by ctid. Act deletion's obsolete
    -- fingerprint bookkeeping must not replace that row version before child-before-parent cleanup.
    RETURN NULL;
  END IF;
  PERFORM public.weekly_commitment_schedule((NEW.trigger_config->>'weekday')::integer,
    NEW.trigger_config->>'local_time',NEW.trigger_config->>'timezone');
  IF NEW.created_by IS NULL OR NEW.trigger_config->>'revision' IS NULL OR (NEW.trigger_config->>'revision')::integer < 1
     OR NEW.conditions <> public.weekly_commitment_conditions(NEW.id,(NEW.trigger_config->>'revision')::integer)
     OR NEW.trigger_config->>'scope' IS DISTINCT FROM 'personal_planning_commitments'
     OR NEW.trigger_config->>'request_id' IS NULL THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_CONTRACT' USING ERRCODE='22023';
  END IF;
  IF NEW.state='live' AND (NOT public.weekly_commitment_owner(NEW.tenant_id,NEW.created_by)
    OR NEW.trigger_config->>'authorized_by' IS DISTINCT FROM NEW.created_by::text
    OR NEW.trigger_config->>'authorized_revision' IS DISTINCT FROM NEW.trigger_config->>'revision'
    OR NEW.trigger_config->>'authorized_at' IS NULL OR NEW.trigger_config->>'cancelled_at' IS NOT NULL
    OR NEW.trigger_config->>'next_run_at' IS NULL OR NEW.granted_lane<>'auto') THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_AUTHORIZATION_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_weekly_commitment_process() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS weekly_commitment_process_guard ON public.paige_automations;
CREATE TRIGGER weekly_commitment_process_guard BEFORE INSERT OR UPDATE OR DELETE ON public.paige_automations
  FOR EACH ROW EXECUTE FUNCTION public.guard_weekly_commitment_process();

CREATE OR REPLACE FUNCTION public.guard_weekly_commitment_act()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE _a public.paige_automations; _owner text;
BEGIN
  SELECT * INTO _a FROM public.paige_automations WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.automation_id ELSE NEW.automation_id END;
  IF TG_OP='UPDATE' AND OLD.automation_id IS DISTINCT FROM NEW.automation_id AND EXISTS(
    SELECT 1 FROM public.paige_automations WHERE id=OLD.automation_id AND trigger_key='schedule.weekly_commitment_check') THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_ACT_IMMUTABLE' USING ERRCODE='42501';
  END IF;
  IF _a.trigger_key IS DISTINCT FROM 'schedule.weekly_commitment_check' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO _owner FROM pg_catalog.pg_proc p
    WHERE p.oid='public.guard_weekly_commitment_act()'::regprocedure;
  IF current_user=_owner AND TG_OP='DELETE' AND public.weekly_commitment_retirement_allowed(_a.tenant_id) THEN RETURN OLD; END IF;
  IF current_user<>_owner OR TG_OP<>'INSERT' OR _a.state<>'draft' OR _a.granted_lane<>'confirm'
     OR NEW.position<>1 OR NEW.action_kind IS DISTINCT FROM 'planning.weekly_commitment_check'
     OR NEW.tool_key IS NOT NULL OR NEW.config<>'{}'::jsonb THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_FIXED_ACT_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_weekly_commitment_act() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS weekly_commitment_act_guard ON public.paige_automation_acts;
CREATE TRIGGER weekly_commitment_act_guard BEFORE INSERT OR UPDATE OR DELETE ON public.paige_automation_acts
  FOR EACH ROW EXECUTE FUNCTION public.guard_weekly_commitment_act();

CREATE UNIQUE INDEX IF NOT EXISTS weekly_commitment_request_once
  ON public.paige_automations(tenant_id,created_by,(trigger_config->>'request_id'))
  WHERE trigger_key='schedule.weekly_commitment_check';

-- Private Planning observations are not an expansion of tenant-wide execution/automation visibility.
DROP POLICY IF EXISTS weekly_commitment_process_owner ON public.paige_automations;
CREATE POLICY weekly_commitment_process_owner ON public.paige_automations AS RESTRICTIVE FOR SELECT TO authenticated
  USING(trigger_key<>'schedule.weekly_commitment_check' OR
    (created_by=auth.uid() AND tenant_id=public.current_user_tenant_id() AND public.weekly_commitment_owner(tenant_id,auth.uid())));
DROP POLICY IF EXISTS weekly_commitment_observation_owner ON public.paige_act_executions;
CREATE POLICY weekly_commitment_observation_owner ON public.paige_act_executions AS RESTRICTIVE FOR SELECT TO authenticated
  USING(capability_key IS DISTINCT FROM 'planning.weekly_commitment_check' OR EXISTS(
    SELECT 1 FROM public.paige_automations a WHERE a.id=automation_id AND a.created_by=auth.uid()
      AND a.tenant_id=public.current_user_tenant_id() AND public.weekly_commitment_owner(a.tenant_id,auth.uid())));

CREATE OR REPLACE FUNCTION public.draft_weekly_commitment_check(
  _request_id uuid,_name text,_weekday integer,_local_time text,_timezone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _a public.paige_automations;
  _id uuid:=gen_random_uuid(); _config jsonb;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _request_id IS NULL OR _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_REQUEST' USING ERRCODE='22023'; END IF;
  _config:=public.weekly_commitment_schedule(_weekday,_local_time,_timezone)||jsonb_build_object(
    'revision',1,'request_id',_request_id,'scope','personal_planning_commitments');
  -- Serializes duplicate intents without a new request ledger. A retry reuses precisely the canonical process.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(_tid::text||':'||_uid::text||':'||_request_id::text,0));
  SELECT * INTO _a FROM public.paige_automations WHERE tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' AND trigger_config->>'request_id'=_request_id::text;
  IF FOUND THEN
    IF _a.name<>btrim(_name) OR _a.trigger_config->>'weekday'<>_weekday::text
      OR _a.trigger_config->>'local_time'<>_local_time OR _a.trigger_config->>'timezone'<>_timezone THEN
      RAISE EXCEPTION 'WEEKLY_CHECK_REQUEST_CONFLICT' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('ok',true,'automation_id',_a.id,'state',_a.state,'revision',(_a.trigger_config->>'revision')::integer,'reused',true);
  END IF;
  INSERT INTO public.paige_automations(id,tenant_id,name,category,trigger_key,trigger_config,conditions,granted_lane,state,created_by)
    VALUES(_id,_tid,btrim(_name),'planning','schedule.weekly_commitment_check',_config,
      public.weekly_commitment_conditions(_id,1),'confirm','draft',_uid);
  INSERT INTO public.paige_automation_acts(automation_id,position,action_kind,config)
    VALUES(_id,1,'planning.weekly_commitment_check','{}'::jsonb);
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
    VALUES(_uid,'paige_automation','weekly_check.draft',_id,jsonb_build_object('tenant_id',_tid,'revision',1));
  RETURN jsonb_build_object('ok',true,'automation_id',_id,'state','draft','revision',1,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.draft_weekly_commitment_check(uuid,text,integer,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.draft_weekly_commitment_check(uuid,text,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.weekly_commitment_stop_occurrences(_id uuid,_tenant uuid,_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- This is a control boundary on the existing occurrence, not a termination or outcome update.
  -- Its FIRST cutoff survives repeated pause/edit/resume calls; a later call cannot bless a late claim.
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND coalesce(lifecycle_execution_paused,false)) THEN RETURN; END IF;
  UPDATE public.paige_native_events SET payload=payload||jsonb_build_object('future_control_at',_at)
    WHERE subject_table='paige_automations' AND subject_id=_id AND tenant_id=_tenant
      AND event_key='schedule.weekly_commitment_check' AND payload->>'future_control_at' IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.weekly_commitment_stop_occurrences(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.configure_weekly_commitment_check(
  _automation_id uuid,_weekday integer,_local_time text,_timezone text,_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _a public.paige_automations; _rev integer; _cfg jsonb;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO _a FROM public.paige_automations WHERE id=_automation_id AND tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _a.trigger_config->>'cancelled_at' IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_CANCELLED' USING ERRCODE='22023'; END IF;
  IF _expected_revision IS DISTINCT FROM (_a.trigger_config->>'revision')::integer THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  _cfg:=public.weekly_commitment_schedule(_weekday,_local_time,_timezone);
  IF _a.trigger_config @> _cfg THEN
    RETURN jsonb_build_object('ok',true,'automation_id',_a.id,'state',_a.state,'revision',_expected_revision,'unchanged',true);
  END IF;
  _rev:=_expected_revision+1;
  _cfg:=_cfg||jsonb_build_object('revision',_rev,'request_id',_a.trigger_config->>'request_id','scope','personal_planning_commitments',
    'future_control_at',clock_timestamp());
  PERFORM public.weekly_commitment_stop_occurrences(_a.id,_tid,(_cfg->>'future_control_at')::timestamptz);
  UPDATE public.paige_automations SET trigger_config=_cfg,conditions=public.weekly_commitment_conditions(_a.id,_rev),
    state='draft',granted_lane='confirm',updated_at=now() WHERE id=_a.id;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
    VALUES(_uid,'paige_automation','weekly_check.configure',_a.id,jsonb_build_object('tenant_id',_tid,'revision',_rev));
  RETURN jsonb_build_object('ok',true,'automation_id',_a.id,'state','draft','revision',_rev,'requires_authorization',true);
END $$;
REVOKE ALL ON FUNCTION public.configure_weekly_commitment_check(uuid,integer,text,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.configure_weekly_commitment_check(uuid,integer,text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.control_weekly_commitment_check(_automation_id uuid,_action text,_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _a public.paige_automations;
  _cfg jsonb; _state text; _lane text; _posture jsonb;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _action IS NULL OR _action NOT IN ('authorize','pause','resume','cancel') THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_INVALID_CONTROL' USING ERRCODE='22023'; END IF;
  SELECT * INTO _a FROM public.paige_automations WHERE id=_automation_id AND tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF _expected_revision IS DISTINCT FROM (_a.trigger_config->>'revision')::integer THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  _cfg:=_a.trigger_config; _state:=_a.state; _lane:=_a.granted_lane;
  IF _cfg->>'cancelled_at' IS NOT NULL THEN
    IF _action='cancel' THEN RETURN jsonb_build_object('ok',true,'automation_id',_a.id,'state','cancelled','revision',_expected_revision); END IF;
    RAISE EXCEPTION 'WEEKLY_CHECK_CANCELLED' USING ERRCODE='22023';
  END IF;
  IF _action IN ('authorize','resume') THEN
    IF _action='resume' AND (_cfg->>'authorized_revision' IS DISTINCT FROM _cfg->>'revision'
      OR _cfg->>'authorized_by' IS DISTINCT FROM _uid::text) THEN
      RAISE EXCEPTION 'WEEKLY_CHECK_AUTHORIZATION_REQUIRED' USING ERRCODE='42501'; END IF;
    IF (SELECT count(*) FROM public.paige_automation_acts WHERE automation_id=_a.id AND position=1
       AND action_kind='planning.weekly_commitment_check' AND tool_key IS NULL AND config='{}'::jsonb)<>1
       OR (SELECT count(*) FROM public.paige_automation_acts WHERE automation_id=_a.id)<>1 THEN
      RAISE EXCEPTION 'WEEKLY_CHECK_FIXED_ACT_REQUIRED' USING ERRCODE='42501'; END IF;
    -- An exact repeated authorization/resume is idempotent and never moves an existing due occurrence.
    IF _a.state<>'live' THEN
      _cfg:=_cfg||jsonb_build_object('authorized_by',_uid,'authorized_at',clock_timestamp(),'future_control_at',clock_timestamp(),
        'authorized_revision',_expected_revision,'next_run_at',public.weekly_commitment_next(_cfg,now()));
    END IF;
    _state:='live'; _lane:='auto';
  ELSIF _action='pause' THEN
    _state:='paused'; _cfg:=(_cfg-'next_run_at')||jsonb_build_object('future_control_at',clock_timestamp());
  ELSE
    _state:='paused'; _lane:='off'; _cfg:=(_cfg-'next_run_at')||jsonb_build_object('cancelled_at',clock_timestamp(),'future_control_at',clock_timestamp());
  END IF;
  IF _cfg IS DISTINCT FROM _a.trigger_config OR _state<>_a.state OR _lane<>_a.granted_lane THEN
    IF _action IN ('pause','cancel') THEN
      PERFORM public.weekly_commitment_stop_occurrences(_a.id,_tid,(_cfg->>'future_control_at')::timestamptz);
    END IF;
    UPDATE public.paige_automations SET trigger_config=_cfg,state=_state,granted_lane=_lane,updated_at=now() WHERE id=_a.id;
    INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data) VALUES(_uid,'paige_automation','weekly_check.'||_action,
      _a.id,jsonb_build_object('tenant_id',_tid,'revision',_expected_revision,'future_runs_only',true));
  END IF;
  _posture:=public.resolve_automation_autonomy(_a.id);
  RETURN jsonb_build_object('ok',true,'automation_id',_a.id,'state',CASE WHEN _action='cancel' THEN 'cancelled' ELSE _state END,
    'revision',_expected_revision,'next_run_at',_cfg->'next_run_at','posture',_posture,'future_runs_only',true);
END $$;
REVOKE ALL ON FUNCTION public.control_weekly_commitment_check(uuid,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.control_weekly_commitment_check(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_due_weekly_commitment_checks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _a public.paige_automations; _due timestamptz; _event uuid; _n integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_SERVICE_ONLY' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_automation_triggers WHERE key='schedule.weekly_commitment_check' AND is_live) THEN RETURN 0; END IF;
  FOR _a IN SELECT a.* FROM public.paige_automations a JOIN public.tenants t ON t.id=a.tenant_id
    WHERE a.trigger_key='schedule.weekly_commitment_check' AND a.state='live' AND a.granted_lane='auto'
      AND a.trigger_config->>'cancelled_at' IS NULL AND a.trigger_config->>'next_run_at' IS NOT NULL
      AND (a.trigger_config->>'next_run_at')::timestamptz<=now()
      AND t.archived_at IS NULL AND NOT coalesce(t.lifecycle_execution_paused,false)
    ORDER BY (a.trigger_config->>'next_run_at')::timestamptz,a.id LIMIT 100 FOR UPDATE OF a SKIP LOCKED
  LOOP
    IF NOT public.weekly_commitment_owner(_a.tenant_id,_a.created_by)
       OR _a.trigger_config->>'authorized_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
       OR _a.trigger_config->>'authorized_by' IS DISTINCT FROM _a.created_by::text
       OR public.resolve_tool_autonomy(_a.tenant_id,'planning_weekly_commitment_check') IS DISTINCT FROM 'auto'
       OR public.resolve_automation_autonomy(_a.id)->>'effective' IS DISTINCT FROM 'auto' THEN CONTINUE; END IF;
    _due:=(_a.trigger_config->>'next_run_at')::timestamptz;
    INSERT INTO public.paige_native_events(event_key,tenant_id,subject_table,subject_id,dedup_key,payload,occurred_at)
      VALUES('schedule.weekly_commitment_check',_a.tenant_id,'paige_automations',_a.id,
        'weekly-commitment:'||_a.tenant_id::text||':'||_a.id::text||':'||(_a.trigger_config->>'revision')||':'||extract(epoch FROM _due)::text,
        jsonb_build_object('automation_id',_a.id::text,'schedule_revision',(_a.trigger_config->>'revision')::integer,
          'scheduled_for',_due,'authorized_by',_a.created_by::text,'authorized_at',_a.trigger_config->>'authorized_at',
          'authorized_revision',(_a.trigger_config->>'authorized_revision')::integer,
          'scope','personal_planning_commitments','schedule',jsonb_build_object('weekday',_a.trigger_config->'weekday',
            'local_time',_a.trigger_config->'local_time','timezone',_a.trigger_config->'timezone')),_due)
      ON CONFLICT(dedup_key) DO NOTHING RETURNING id INTO _event;
    UPDATE public.paige_automations SET trigger_config=trigger_config||jsonb_build_object(
      'next_run_at',public.weekly_commitment_next(_a.trigger_config,greatest(now(),_due))),updated_at=now() WHERE id=_a.id;
    IF _event IS NOT NULL THEN
      _n:=_n+1;
      -- Existing durable outbox + existing best-effort enqueue; wakeup failure cannot discard the occurrence.
      PERFORM public.paige_fire_event_processor(_event,_a.tenant_id);
    END IF;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.publish_due_weekly_commitment_checks() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_due_weekly_commitment_checks() TO service_role;

-- Preserve the incumbent sweeper body; publication joins that existing job, never adds another cron.
DO $$ BEGIN
  IF to_regprocedure('public.paige_sweep_stuck_events_before_weekly()') IS NULL THEN
    ALTER FUNCTION public.paige_sweep_stuck_events() RENAME TO paige_sweep_stuck_events_before_weekly;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.paige_sweep_stuck_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _published integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'EVENT_SWEEP_FORBIDDEN' USING ERRCODE='42501'; END IF;
  _published:=public.publish_due_weekly_commitment_checks();
  RETURN _published+public.paige_sweep_stuck_events_before_weekly();
END $$;
REVOKE ALL ON FUNCTION public.paige_sweep_stuck_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paige_sweep_stuck_events() TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_commitment_claim_live(_detail jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN _detail->>'dispatch_claim' IS NULL THEN false
    WHEN coalesce(_detail->>'dispatch_claimed_at','') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}' THEN false
    WHEN NOT pg_catalog.pg_input_is_valid(_detail->>'dispatch_claimed_at','timestamptz') THEN false
    WHEN (_detail->>'dispatch_claimed_at')::timestamptz > clock_timestamp()+interval '1 minute' THEN false
    ELSE (_detail->>'dispatch_claimed_at')::timestamptz>=now()-interval '10 minutes' END;
$$;
REVOKE ALL ON FUNCTION public.weekly_commitment_claim_live(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_commitment_claim_live(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_weekly_commitment_check(
  _automation_id uuid,_event_id uuid,_act_id uuid,_correlation text,_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _a public.paige_automations; _ev public.paige_native_events; _row public.paige_act_executions;
  _posture jsonb; _obs jsonb; _at timestamptz:=clock_timestamp(); _due timestamptz; _minimal jsonb; _error text;
  _started_before_control boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_SERVICE_ONLY' USING ERRCODE='42501'; END IF;
  -- Same order as human controls, publisher and recovery: process first, act second.
  SELECT * INTO _a FROM public.paige_automations WHERE id=_automation_id FOR UPDATE;
  SELECT * INTO _row FROM public.paige_act_executions WHERE event_id=_event_id AND act_id=_act_id FOR UPDATE;
  SELECT * INTO _ev FROM public.paige_native_events WHERE id=_event_id;
  IF _a.id IS NULL OR _row.id IS NULL OR _ev.id IS NULL OR _receipt_id IS NULL OR nullif(_correlation,'') IS NULL
    OR _row.automation_id<>_a.id OR _row.tenant_id<>_a.tenant_id OR _ev.tenant_id<>_a.tenant_id
    OR _a.trigger_key<>'schedule.weekly_commitment_check' OR _ev.event_key<>'schedule.weekly_commitment_check'
    OR _ev.subject_table<>'paige_automations' OR _ev.subject_id<>_a.id
    OR _row.capability_key IS DISTINCT FROM 'planning.weekly_commitment_check'
    OR _row.adapter_kind<>'native' OR _row.correlation_ref IS DISTINCT FROM _correlation
    OR NOT EXISTS(SELECT 1 FROM public.paige_automation_acts ac WHERE ac.id=_act_id AND ac.automation_id=_a.id
      AND ac.action_kind='planning.weekly_commitment_check' AND ac.tool_key IS NULL AND ac.position=1 AND ac.config='{}'::jsonb) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_binding_refused');
  END IF;
  _obs:=_row.detail->'weekly_commitment_observation';
  IF _obs IS NOT NULL THEN
    IF _obs->>'correlation_ref'=_correlation AND _obs->>'event_id'=_event_id::text AND _obs->>'act_id'=_act_id::text
       AND _obs->>'receipt_id' IS NOT NULL AND _row.outcome::text='executed' AND EXISTS(
         SELECT 1 FROM public.paige_workspace_events r WHERE r.tenant_id=_row.tenant_id
           AND r.source_kind='capability_run' AND r.source_id::text=_obs->>'receipt_id'
           AND r.capability_key='planning_weekly_commitment_check' AND r.outcome='capability_succeeded'
           AND r.detail->>'event_id'=_event_id::text AND r.detail->>'act_id'=_act_id::text) THEN
      RETURN jsonb_build_object('outcome','executed','receipt_id',_obs->'receipt_id','detail',jsonb_build_object(
        'confirmed_via','weekly_commitment_observation','receipt_id',_obs->'receipt_id','automation_id',_a.id,
        'event_id',_event_id,'act_id',_act_id),'error',NULL);
    END IF;
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_observation_mismatch');
  END IF;
  IF _row.outcome::text='ambiguous' THEN
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_requires_reconciliation');
  END IF;
  IF _row.outcome::text NOT IN ('accepted_for_execution','retrying') OR NOT public.weekly_commitment_claim_live(_row.detail) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_dispatch_claim_required');
  END IF;
  _due:=(_ev.payload->>'scheduled_for')::timestamptz;
  _started_before_control:=_ev.payload->>'future_control_at' IS NOT NULL
    AND (_row.detail->>'dispatch_claimed_at')::timestamptz<(_ev.payload->>'future_control_at')::timestamptz;
  IF _ev.payload->>'automation_id' IS DISTINCT FROM _a.id::text
    OR _ev.payload->>'schedule_revision' IS DISTINCT FROM _ev.payload->>'authorized_revision'
    OR _ev.payload->>'authorized_by' IS DISTINCT FROM _a.created_by::text
    OR _ev.payload->>'scope' IS DISTINCT FROM 'personal_planning_commitments'
    OR _due IS NULL OR _due>(_at+interval '1 minute')
    OR _ev.payload->>'authorized_at' IS NULL OR _due<(_ev.payload->>'authorized_at')::timestamptz
    OR (NOT _started_before_control AND (
      _ev.payload->>'schedule_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
      OR _a.trigger_config->>'authorized_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
      OR _a.trigger_config->>'authorized_by' IS DISTINCT FROM _a.created_by::text
      OR _due<(_a.trigger_config->>'authorized_at')::timestamptz
      OR _a.state<>'live' OR _a.granted_lane<>'auto' OR _a.trigger_config->>'cancelled_at' IS NOT NULL))
    OR NOT public.weekly_commitment_owner(_a.tenant_id,_a.created_by)
    OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_a.tenant_id AND t.archived_at IS NULL
      AND NOT coalesce(t.lifecycle_execution_paused,false)) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_authority_changed');
  END IF;
  _posture:=public.resolve_automation_autonomy(_a.id);
  IF NOT EXISTS(SELECT 1 FROM public.paige_automation_triggers tr WHERE tr.key=_a.trigger_key AND tr.is_live)
     OR _row.effective_lane IS DISTINCT FROM 'auto' OR _posture->>'ceiling' IS DISTINCT FROM 'auto'
     OR public.resolve_tool_autonomy(_a.tenant_id,'planning_weekly_commitment_check') IS DISTINCT FROM 'auto'
     OR (_posture->>'effective' IS DISTINCT FROM 'auto' AND NOT _started_before_control) THEN
    RETURN jsonb_build_object('outcome','failed','detail','{}'::jsonb,'error','weekly_check_effective_authority_refused');
  END IF;
  -- A single canonical query: personal scope mirrors paige_operating_memory, never service plan_list's staff scope.
  WITH eligible AS MATERIALIZED (
    SELECT pi.id,pi.item_type,pi.title,pi.status,pi.priority,pi.due_at
      FROM public.plan_items pi WHERE pi.tenant_id=_a.tenant_id
        AND pi.status IN ('open','in_progress','blocked')
        AND (pi.assigned_to_user_id=_a.created_by OR pi.created_by=_a.created_by)
  ), bounded AS (
    SELECT * FROM eligible ORDER BY due_at NULLS LAST,id LIMIT 50
  )
  SELECT jsonb_build_object('version',1,'scope','personal_planning_commitments','tenant_id',_a.tenant_id,
    'authorized_by',_a.created_by,'automation_id',_a.id,'event_id',_event_id,'act_id',_act_id,
    'schedule_revision',(_ev.payload->>'schedule_revision')::integer,'scheduled_for',_due,'observed_at',_at,
    'correlation_ref',_correlation,'receipt_id',_receipt_id,'source','public.plan_items',
    'open_count',(SELECT count(*) FROM eligible),
    'blocked_count',(SELECT count(*) FROM eligible WHERE status='blocked'),
    'overdue_count',(SELECT count(*) FROM eligible WHERE due_at<_at),
    'due_next_week_count',(SELECT count(*) FROM eligible WHERE due_at>=_at AND due_at<_at+interval '7 days'),
    'undated_count',(SELECT count(*) FROM eligible WHERE due_at IS NULL),
    'truncated',(SELECT count(*)>50 FROM eligible),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'kind',item_type,'title',left(title,160),
      'status',status,'priority',priority,'due_at',due_at) ORDER BY due_at NULLS LAST,id) FROM bounded),'[]'::jsonb)) INTO _obs;
  _row:=public.paige_record_act_execution(_row.event_id,_row.automation_id,_row.act_id,_row.act_position,_row.tenant_id,
    _row.adapter_kind,_row.capability_key,_row.effective_lane,'executed'::public.paige_act_outcome,NULL,
    _row.idempotency_key,_row.correlation_ref,NULL,jsonb_build_object('weekly_commitment_observation',_obs),NULL,_at,_at);
  IF _row.outcome::text<>'executed' OR _row.detail->'weekly_commitment_observation' IS DISTINCT FROM _obs THEN
    RAISE EXCEPTION 'WEEKLY_CHECK_EVIDENCE_NOT_RECORDED' USING ERRCODE='40001'; END IF;
  -- Literal allowlist of references only; private titles, counts and source contents never enter shared Rail.
  _minimal:=jsonb_build_object('confirmed_via','weekly_commitment_observation','receipt_id',_receipt_id,
    'automation_id',_a.id,'event_id',_event_id,'act_id',_act_id,'observed_at',_at);
  PERFORM public.record_capability_run(_a.tenant_id,_a.created_by,'planning_weekly_commitment_check',
    'capability_succeeded',_receipt_id,NULL,NULL,NULL,NULL,_minimal);
  -- Observation + terminal outcome + receipt commit together. A lost HTTP response is reconciled by this same row.
  RETURN jsonb_build_object('outcome','executed','receipt_id',_receipt_id,'detail',_minimal,'error',NULL);
END $$;
REVOKE ALL ON FUNCTION public.execute_weekly_commitment_check(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_weekly_commitment_check(uuid,uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.read_weekly_commitment_check(_automation_id uuid,_event_id uuid,_act_id uuid,_correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _row public.paige_act_executions; _obs jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_SERVICE_ONLY' USING ERRCODE='42501'; END IF;
  SELECT * INTO _row FROM public.paige_act_executions WHERE event_id=_event_id AND act_id=_act_id FOR UPDATE;
  IF _row.id IS NULL OR _row.automation_id IS DISTINCT FROM _automation_id
     OR _row.correlation_ref IS DISTINCT FROM _correlation OR nullif(_correlation,'') IS NULL
     OR _row.capability_key IS DISTINCT FROM 'planning.weekly_commitment_check'
     OR _row.adapter_kind<>'native' OR NOT EXISTS(
       SELECT 1 FROM public.paige_native_events ev JOIN public.paige_automations a ON a.id=ev.subject_id
       WHERE ev.id=_event_id AND ev.event_key='schedule.weekly_commitment_check' AND ev.subject_table='paige_automations'
         AND a.id=_automation_id AND a.tenant_id=_row.tenant_id AND ev.tenant_id=_row.tenant_id) THEN
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_binding_unverified');
  END IF;
  _obs:=_row.detail->'weekly_commitment_observation';
  IF _obs IS NOT NULL AND _obs->>'correlation_ref'=_correlation AND _obs->>'event_id'=_event_id::text
    AND _obs->>'act_id'=_act_id::text AND _obs->>'receipt_id' IS NOT NULL
    AND _row.outcome::text IN ('executed','accepted_for_execution','retrying','ambiguous') AND EXISTS(
      SELECT 1 FROM public.paige_workspace_events r WHERE r.tenant_id=_row.tenant_id
        AND r.source_kind='capability_run' AND r.source_id::text=_obs->>'receipt_id'
        AND r.capability_key='planning_weekly_commitment_check' AND r.outcome='capability_succeeded'
        AND r.detail->>'event_id'=_event_id::text AND r.detail->>'act_id'=_act_id::text) THEN
    IF _row.outcome::text<>'executed' THEN
      _row:=public.paige_record_act_execution(_row.event_id,_row.automation_id,_row.act_id,_row.act_position,_row.tenant_id,
        _row.adapter_kind,_row.capability_key,_row.effective_lane,'executed'::public.paige_act_outcome,NULL,
        _row.idempotency_key,_row.correlation_ref,NULL,jsonb_build_object('reconciled_via','weekly_commitment_observation'),
        NULL,NULL,(_obs->>'observed_at')::timestamptz);
    END IF;
    RETURN jsonb_build_object('outcome','executed','receipt_id',_obs->'receipt_id','detail',jsonb_build_object(
      'confirmed_via','weekly_commitment_observation','receipt_id',_obs->'receipt_id','automation_id',_automation_id,
      'event_id',_event_id,'act_id',_act_id),'error',NULL);
  END IF;
  IF _obs IS NOT NULL OR _row.outcome::text='ambiguous' THEN
    RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',false),'error','weekly_check_reconciliation_required');
  END IF;
  IF _row.outcome::text IN ('failed','cancelled') THEN
    RETURN jsonb_build_object('outcome','failed','detail',jsonb_build_object('proven_absent',true),'error',_row.error);
  END IF;
  RETURN jsonb_build_object('outcome','ambiguous','detail',jsonb_build_object('proven_absent',
    _row.outcome::text IN ('accepted_for_execution','retrying') AND NOT public.weekly_commitment_claim_live(_row.detail)),
    'error',CASE WHEN public.weekly_commitment_claim_live(_row.detail) THEN 'weekly_check_dispatch_in_progress' ELSE 'weekly_check_not_observed' END);
END $$;
REVOKE ALL ON FUNCTION public.read_weekly_commitment_check(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_weekly_commitment_check(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_weekly_commitment_checks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE _tid uuid:=public.current_user_tenant_id(); _uid uuid:=auth.uid(); _result jsonb;
BEGIN
  IF NOT public.weekly_commitment_owner(_tid,_uid) THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('automation_id',a.id,'name',a.name,
    'state',CASE WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled' ELSE a.state END,
    'schedule_status',CASE WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled'
      WHEN a.state='draft' THEN 'requested' WHEN a.state='paused' THEN 'paused' ELSE 'scheduled' END,
    'revision',(a.trigger_config->>'revision')::integer,'schedule',a.trigger_config,
    'posture',posture.value,'tool_lane',posture.tool_lane,'intended_next_run_at',a.trigger_config->'next_run_at',
    'execution_availability',CASE WHEN posture.value->>'would_run'='true' AND posture.value->>'effective'='auto'
      AND posture.tool_lane='auto' AND a.state='live' AND a.trigger_config->>'cancelled_at' IS NULL THEN 'ready' ELSE 'held' END,
    'execution_hold_reason',CASE WHEN jsonb_array_length(coalesce(posture.value->'dark','[]'::jsonb))>0
      THEN posture.value#>>'{dark,0,reason}' WHEN a.trigger_config->>'cancelled_at' IS NOT NULL THEN 'cancelled'
      WHEN a.state<>'live' THEN a.state WHEN posture.tool_lane<>'auto' THEN 'tool_lane_'||coalesce(posture.tool_lane,'unavailable')
      WHEN posture.value->>'effective'<>'auto' THEN coalesce(posture.value->>'capped_by','effective_lane') ELSE NULL END,
    'next_run_at',CASE WHEN a.state='live' AND a.trigger_config->>'cancelled_at' IS NULL
      AND posture.value->>'would_run'='true' AND posture.value->>'effective'='auto' AND posture.tool_lane='auto'
      THEN a.trigger_config->'next_run_at' ELSE NULL END,
    'last_run',CASE WHEN ev.id IS NULL THEN NULL ELSE jsonb_build_object('event_id',ev.id,'scheduled_for',ev.occurred_at,
      'event_state',ev.processing_state,'act_id',ae.act_id,'outcome',ae.outcome,
      'status',CASE WHEN ae.outcome::text='executed'
        AND ae.detail#>>'{weekly_commitment_observation,correlation_ref}'=ae.correlation_ref
        AND ae.detail#>>'{weekly_commitment_observation,event_id}'=ev.id::text
        AND ae.detail#>>'{weekly_commitment_observation,act_id}'=ae.act_id::text
        AND EXISTS(SELECT 1 FROM public.paige_workspace_events receipt WHERE receipt.tenant_id=_tid
          AND receipt.source_kind='capability_run' AND receipt.source_id::text=ae.detail#>>'{weekly_commitment_observation,receipt_id}'
          AND receipt.capability_key='planning_weekly_commitment_check' AND receipt.outcome='capability_succeeded'
          AND receipt.detail->>'event_id'=ev.id::text AND receipt.detail->>'act_id'=ae.act_id::text) THEN 'completed'
        WHEN ae.outcome::text='executed' THEN 'unknown' WHEN ae.outcome::text='failed' THEN 'failed'
        WHEN ae.outcome::text='cancelled' THEN 'cancelled' WHEN ae.outcome::text='ambiguous' THEN 'unknown'
        WHEN ae.outcome::text='approval_pending' THEN 'needs_approval' WHEN ae.outcome::text='held_by_lane' THEN 'held'
        WHEN ae.outcome::text LIKE 'refused_%' THEN 'refused' WHEN ae.outcome::text='condition_not_matched' THEN 'skipped'
        WHEN ae.outcome::text IN ('accepted_for_execution','retrying') AND public.weekly_commitment_claim_live(ae.detail) THEN 'running'
        WHEN ae.detail ? 'dispatch_claim' THEN 'unknown' ELSE 'scheduled' END,
      'observation',ae.detail->'weekly_commitment_observation','error',ae.error,'refusal_code',ae.refusal_code,'settled_at',ae.settled_at) END
    ) ORDER BY a.updated_at DESC),'[]'::jsonb) INTO _result
  FROM (SELECT * FROM public.paige_automations WHERE tenant_id=_tid AND created_by=_uid
    AND trigger_key='schedule.weekly_commitment_check' ORDER BY updated_at DESC LIMIT 50) a
  CROSS JOIN LATERAL(SELECT public.resolve_automation_autonomy(a.id) AS value,
    public.resolve_tool_autonomy(a.tenant_id,'planning_weekly_commitment_check') AS tool_lane) posture
  LEFT JOIN LATERAL(SELECT * FROM public.paige_native_events e WHERE e.subject_table='paige_automations'
    AND e.subject_id=a.id AND e.tenant_id=_tid AND e.event_key='schedule.weekly_commitment_check'
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) ev ON true
  LEFT JOIN LATERAL(SELECT * FROM public.paige_act_executions x WHERE x.event_id=ev.id AND x.automation_id=a.id
    AND x.tenant_id=_tid AND x.capability_key='planning.weekly_commitment_check' ORDER BY x.act_position LIMIT 1) ae ON true;
  RETURN jsonb_build_object('ok',true,'tenant_id',_tid,'checks',_result,'scope','personal_planning_commitments');
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_commitment_checks() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_commitment_checks() TO authenticated;

CREATE OR REPLACE FUNCTION public.paige_reconcile_weekly_commitment_acts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _cand record; _a public.paige_automations; _row public.paige_act_executions; _ev public.paige_native_events;
  _read jsonb; _recoveries integer; _n integer:=0; _outcome text; _error text;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_SERVICE_ONLY' USING ERRCODE='42501'; END IF;
  FOR _cand IN SELECT ae.id,ae.automation_id FROM public.paige_act_executions ae JOIN public.tenants t ON t.id=ae.tenant_id
    WHERE ae.capability_key='planning.weekly_commitment_check' AND ae.adapter_kind='native'
      AND ae.outcome::text IN ('accepted_for_execution','retrying','ambiguous')
      AND ae.updated_at<now()-interval '10 minutes' AND t.archived_at IS NULL AND NOT coalesce(t.lifecycle_execution_paused,false)
    ORDER BY ae.updated_at LIMIT 50
  LOOP
    BEGIN
      SELECT * INTO _a FROM public.paige_automations WHERE id=_cand.automation_id FOR UPDATE SKIP LOCKED;
      IF _a.id IS NULL THEN CONTINUE; END IF;
      SELECT * INTO _row FROM public.paige_act_executions WHERE id=_cand.id FOR UPDATE SKIP LOCKED;
      IF _row.id IS NULL OR _row.outcome::text NOT IN ('accepted_for_execution','retrying','ambiguous')
         OR _row.updated_at>=now()-interval '10 minutes' THEN CONTINUE; END IF;
      _read:=public.read_weekly_commitment_check(_row.automation_id,_row.event_id,_row.act_id,_row.correlation_ref);
      -- Atomic execution already committed both observation and terminal outcome; no partial success is fabricated.
      IF _read->>'outcome'='executed' THEN _n:=_n+1; CONTINUE; END IF;
      IF _row.outcome::text='ambiguous' OR _read#>>'{detail,proven_absent}' IS DISTINCT FROM 'true' THEN
        UPDATE public.paige_act_executions SET detail=detail||jsonb_build_object('recovery_checked_at',now()) WHERE id=_row.id;
        CONTINUE; -- unknown is never replayed, even though this act has no external effects
      END IF;
      SELECT * INTO _ev FROM public.paige_native_events WHERE id=_row.event_id;
      _outcome:=NULL; _error:=NULL;
      IF _a.state<>'live' OR _a.trigger_config->>'cancelled_at' IS NOT NULL
        OR _ev.payload->>'schedule_revision' IS DISTINCT FROM _a.trigger_config->>'revision'
        OR NOT public.weekly_commitment_owner(_a.tenant_id,_a.created_by)
        OR public.resolve_tool_autonomy(_a.tenant_id,'planning_weekly_commitment_check') IS DISTINCT FROM 'auto'
        OR public.resolve_automation_autonomy(_a.id)->>'effective' IS DISTINCT FROM 'auto'
        OR NOT EXISTS(SELECT 1 FROM public.paige_automation_triggers tr WHERE tr.key=_a.trigger_key AND tr.is_live)
        OR (_ev.payload->>'scheduled_for')::timestamptz<(_a.trigger_config->>'authorized_at')::timestamptz THEN
        _outcome:='failed'; _error:='weekly_check_interrupted_before_observation';
      ELSE
        _recoveries:=CASE WHEN coalesce(_row.detail->>'dispatch_recoveries','') ~ '^\d{1,3}$'
          THEN (_row.detail->>'dispatch_recoveries')::integer ELSE 0 END;
        IF _recoveries>=3 OR coalesce(_row.dispatched_at,_row.created_at)<now()-interval '24 hours' THEN
          _outcome:='failed'; _error:='weekly_check_dispatch_not_started';
        ELSIF _ev.id IS NOT NULL AND (_ev.processing_state IN ('done','error') OR _ev.attempts>=5) THEN
          UPDATE public.paige_native_events SET processing_state='pending',attempts=4,last_error='weekly_check_dispatch_recovery',
            recovery_scope=ARRAY[_a.id] WHERE id=_ev.id;
          UPDATE public.paige_event_dispatches SET status='error',error='weekly_check_dispatch_recovery'
            WHERE event_id=_ev.id AND automation_id=_a.id AND status='done';
          UPDATE public.paige_act_executions SET detail=detail||jsonb_build_object('dispatch_recoveries',_recoveries+1,
            'recovery_checked_at',now()) WHERE id=_row.id;
          PERFORM public.paige_fire_event_processor(_ev.id,_a.tenant_id); _n:=_n+1; CONTINUE;
        END IF;
      END IF;
      IF _outcome IS NOT NULL THEN
        PERFORM public.paige_record_act_execution(_row.event_id,_row.automation_id,_row.act_id,_row.act_position,_row.tenant_id,
          _row.adapter_kind,_row.capability_key,_row.effective_lane,_outcome::public.paige_act_outcome,_error,
          _row.idempotency_key,_row.correlation_ref,NULL,jsonb_build_object('reconciled_via','weekly_commitment_observation'),
          _error,NULL,now()); _n:=_n+1;
      ELSE
        UPDATE public.paige_act_executions SET detail=detail||jsonb_build_object('recovery_checked_at',now()) WHERE id=_row.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'weekly commitment reconciliation skipped one act (%)',SQLSTATE;
    END;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.paige_reconcile_weekly_commitment_acts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paige_reconcile_weekly_commitment_acts() TO service_role;

-- Preserve all incumbent M2 paths; this bounded branch joins the ONE existing reconcile cron.
create or replace function public.paige_reconcile_orchestration_acts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cand       record;
  _cur        public.paige_act_executions;
  _ev         public.paige_native_events;
  _readable   boolean;
  _landed_id  uuid;
  _claim_live boolean;
  _claim_at   text;
  _epoch      timestamptz;
  _recoveries integer;
  _released   integer;
  _new        text;
  _code       text;
  _err        text;
  _row        public.paige_act_executions;
  _actual     text;
  _advanced   integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'RECONCILE_FORBIDDEN: service role / cron only' using errcode = '42501';
  end if;

  -- (a) An orchestration approval locked longer than 10 minutes belongs to an executor that died: the edge
  --     wall-clock cap is far below that. Release it so the owner can approve again. Safe whatever the act's state:
  --     before redeem nothing ran; after it the resume path re-reads, re-checks authority and dispatches only under
  --     the act's own dispatch claim; a settled act is just re-stamped. One statement for every stale lock, so a
  --     crash BEFORE redeem (the act still approval_pending, which the scan below never visits) is covered too.
  update public.paige_pending_approvals
     set claimed_at = null,
         metadata   = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('dispatch_interrupted_at', now())
   where source = 'paige_orchestration'
     and status = 'pending'
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes';
  get diagnostics _released = row_count;
  _advanced := _advanced + _released + public.paige_reconcile_weekly_commitment_acts();

  -- (b) Acts this pass can act on, oldest first. Every row it looks at and leaves alone is stamped below, which
  --     moves its updated_at, so rows waiting on something else rotate to the back instead of filling every pass.
  --     Excluded up front, because no branch could ever move them:
  --       * an act on an archived or execution-paused tenant (the lifecycle guard refuses its event writes);
  --       * a non-native act that is ambiguous, or carries a provider reference (its adapter's own readback owns it),
  --         or was never claimed (it never dispatched, and a row from before the claim protocol cannot be judged).
  for _cand in
    select ae.id
      from public.paige_act_executions ae
      join public.tenants t on t.id = ae.tenant_id
      left join public.paige_native_events ev on ev.id = ae.event_id
     where ae.capability_key is distinct from 'planning.weekly_commitment_check'
       and ae.outcome::text in ('ambiguous', 'accepted_for_execution', 'retrying')
       and ae.updated_at < now() - interval '10 minutes'
       and t.archived_at is null
       and not coalesce(t.lifecycle_execution_paused, false)
       and (
             -- native: an unconfirmed (ambiguous) act only where the readback can settle it
             (ae.adapter_kind = 'native'
              and (ae.outcome::text <> 'ambiguous' or (ev.subject_table = 'clients' and ae.correlation_ref is not null)))
             or (ae.adapter_kind <> 'native'
                 and ae.outcome::text <> 'ambiguous' and ae.provider_ref is null and ae.detail ? 'dispatch_claim')
           )
     order by ae.updated_at asc
     limit 50
  loop
    -- One row's failure never aborts the pass: its writes roll back, it is stamped so it rotates, and it is logged.
    begin
      -- Re-read under the row lock. The claim RPC and every ledger write take the same lock, so a runner that claims
      -- between the scan and here is seen, and nothing below can race a dispatch it decides is dead.
      select * into _cur from public.paige_act_executions where id = _cand.id for update skip locked;
      if _cur.id is null
         or _cur.outcome::text not in ('ambiguous', 'accepted_for_execution', 'retrying')
         or _cur.updated_at >= now() - interval '10 minutes' then
        continue;
      end if;

      select * into _ev from public.paige_native_events ev where ev.id = _cur.event_id;

      -- Only the native journey-stage readback can PROVE whether the effect landed: a transition stamped with the
      -- act's correlation reference exists, or it does not.
      _readable := _cur.adapter_kind = 'native' and _ev.subject_table = 'clients' and _cur.correlation_ref is not null;
      _epoch    := coalesce(_cur.dispatched_at, _cur.created_at);
      _new := null; _code := null; _err := null;

      if _readable then
        select t.id into _landed_id
          from public.paige_journey_stage_transitions t
         where t.contact_id = _ev.subject_id and t.source_event = _cur.correlation_ref
         limit 1;
        if _landed_id is not null then
          _new := 'executed';
        end if;
      end if;

      if _new is null and _cur.outcome::text = 'ambiguous' then
        -- unchanged rule for an unconfirmed dispatch: never re-driven; failed once its window has passed.
        if _readable and _epoch < now() - interval '24 hours' then
          _new := 'failed'; _code := 'reconcile_exhausted'; _err := 'ambiguous_never_confirmed_by_correlation';
        end if;
      elsif _new is null then
        -- accepted_for_execution / retrying, nothing landed (or not readable). A claim the claim RPC would still
        -- refuse to re-take belongs to a runner that may be alive — leave it. The SAME rule as the RPC's CASE in
        -- section 1, and the same window as DISPATCH_CLAIM_STALE in dispatch-claim.ts (a drift test pins it).
        _claim_at := _cur.detail->>'dispatch_claimed_at';
        -- CASE, not AND: evaluated in order, so the cast only ever sees a value that parses.
        _claim_live := case
          when (_cur.detail->>'dispatch_claim') is null then false
          when coalesce(_claim_at, '') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}' then false
          when not pg_input_is_valid(_claim_at, 'timestamptz') then false
          when _claim_at::timestamptz > clock_timestamp() + interval '1 minute' then false
          else _claim_at::timestamptz >= now() - interval '10 minutes'
        end;

        if _claim_live then
          null; -- a runner may still be dispatching
        elsif not _readable then
          -- The scan admits a non-readable act only when it was CLAIMED and carries no provider reference: either a
          -- dispatcher took it and died, or its dispatch returned without one. Nothing can prove the effect absent or
          -- present, so it is recorded as unknown — never replayed.
          if _cur.provider_ref is null and _cur.detail ? 'dispatch_claim' then
            _new := 'ambiguous'; _code := 'dispatch_outcome_unknown'; _err := 'claimed_without_provider_ref';
          end if;
        elsif _cur.detail ? 'approved_by' then
          -- An approved act. The human's approval is the authority to run it, so recovery hands it back to them:
          -- step (a) released the approval's stale lock, and approving again resumes it. No retry within 24 hours
          -- of the approval → failed; the readback proves it never ran.
          if _epoch < now() - interval '24 hours' then
            _new := 'failed'; _code := 'dispatch_not_started'; _err := 'approved_act_never_dispatched';
          end if;
        else
          -- An automatic act: re-drive it through the one engine path, a bounded number of times.
          _recoveries := case when coalesce(_cur.detail->>'dispatch_recoveries', '') ~ '^\d{1,3}$'
                              then (_cur.detail->>'dispatch_recoveries')::int else 0 end;
          if _recoveries >= 3 or _epoch < now() - interval '24 hours' then
            _new := 'failed'; _code := 'dispatch_not_started'; _err := 'dispatch_recovery_exhausted';
          elsif _ev.id is not null
                and (_ev.processing_state in ('error', 'done')
                     -- 5 = the sweeper's attempts cap (paige_claim_event / paige_sweep_stuck_events): past it nothing
                     -- drains the event again. Below it the normal lifecycle still owns the event, and its next drain
                     -- re-takes the stale claim and dispatches — nothing to do here.
                     or (_ev.processing_state = 'pending' and _ev.attempts >= 5)
                     -- a claimed event is being drained unless its claim is older than the sweeper's 5 minutes
                     or (_ev.processing_state = 'claimed' and _ev.attempts >= 5
                         and _ev.claimed_at < now() - interval '5 minutes')) then
            -- Re-open the exhausted event for exactly one more drain (attempts 4 of the cap's 5), scoped to this
            -- automation and to acts that existed when the event happened (see recovery_scope).
            update public.paige_native_events
               set processing_state = 'pending',
                   attempts         = 4,
                   last_error       = 'dispatch_recovery: act ' || _cur.act_id::text,
                   recovery_scope   = (select array_agg(distinct a)
                                         from unnest(coalesce(recovery_scope, '{}'::uuid[]) || _cur.automation_id) a)
             where id = _ev.id;
            -- a delivery recorded done would be skipped by the drainer; this one still owes a dispatch
            update public.paige_event_dispatches
               set status = 'error', error = 'dispatch_recovery'
             where event_id = _cur.event_id and automation_id = _cur.automation_id and status = 'done';
            update public.paige_act_executions
               set detail = coalesce(detail, '{}'::jsonb)
                            || jsonb_build_object('dispatch_recoveries', _recoveries + 1, 'dispatch_recovered_at', now())
             where id = _cur.id;
            begin
              perform public.paige_fire_event_processor(_cur.event_id, _cur.tenant_id);
            exception when others then
              -- the native-event sweeper picks a pending event up within 5 minutes anyway
              raise warning 'paige_reconcile_orchestration_acts: fire for event % failed: %', _cur.event_id, sqlerrm;
            end;
            _advanced := _advanced + 1;
            continue;
          end if;
        end if;
      end if;

      if _new is null then
        -- Looked at, nothing to do yet. Stamp it so updated_at moves and the next pass reaches other rows first.
        update public.paige_act_executions
           set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('recovery_checked_at', now())
         where id = _cur.id;
        continue;
      end if;

      -- Advance through the sanctioned monotonic RPC and stamp the companion from what ACTUALLY persisted (a
      -- concurrent resume may have settled it first; §13 — the inbox never reports an outcome the ledger did not
      -- record).
      _row := public.paige_record_act_execution(
        _cur.event_id, _cur.automation_id, _cur.act_id, _cur.act_position, _cur.tenant_id,
        _cur.adapter_kind, _cur.capability_key, _cur.effective_lane, _new::public.paige_act_outcome,
        _code, _cur.idempotency_key, _cur.correlation_ref, null,
        jsonb_build_object('reconciled_via', 'durable_orchestration_sweep', 'prior_outcome', _cur.outcome::text),
        _err, null, case when _new in ('executed', 'failed') then now() else null end
      );
      _actual := coalesce(_row.outcome::text, _new);
      _advanced := _advanced + 1;

      if _actual in ('executed', 'failed') then
        update public.paige_pending_approvals
           set status      = 'approved',
               reviewed_at = now(),
               claimed_at  = null,
               metadata    = coalesce(metadata, '{}'::jsonb)
                             || jsonb_build_object('act_outcome', _actual, 'executed', _actual = 'executed',
                                                   'execute_note', 'resolved by durable reconciler')
         where source = 'paige_orchestration'
           and tenant_id = _cur.tenant_id
           and metadata->>'event_id' = _cur.event_id::text
           and metadata->>'act_id'   = _cur.act_id::text
           and status = 'pending';
      end if;
    exception when others then
      raise warning 'paige_reconcile_orchestration_acts: act % skipped: % (%)', _cand.id, sqlerrm, sqlstate;
      begin
        update public.paige_act_executions
           set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('recovery_checked_at', now(),
                                                                            'recovery_error', left(sqlerrm, 200))
         where id = _cand.id;
      exception when others then
        null; -- the row stays where it is; the warning above already names it
      end;
    end;
  end loop;

  return _advanced;
end $$;

revoke all on function public.paige_reconcile_orchestration_acts() from public, anon, authenticated;
grant execute on function public.paige_reconcile_orchestration_acts() to service_role;
