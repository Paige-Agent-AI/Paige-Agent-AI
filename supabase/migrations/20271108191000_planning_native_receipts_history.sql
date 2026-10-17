BEGIN;

-- Extend the native executors where they stand. In particular, do not restore
-- pre-retirement role checks by copying an old Planning definition.
CREATE OR REPLACE FUNCTION pg_temp.planning_replace_once(source text, before text, after text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF before = '' OR (length(source)-length(replace(source,before,'')))/length(before) <> 1 THEN
    RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: required source anchor is not unique';
  END IF;
  RETURN replace(source,before,after);
END $$;

DO $planning_receipts$
DECLARE
  spec record; original text; patched text; audit_at integer; audit_end integer;
  audit_statement text; return_at integer; return_end integer; return_statement text;
  receipt_block text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('plan_create','public.plan_create(text,text,date,date,text,uuid,text,jsonb,uuid)','plans','_id','_tenant'),
    ('plan_add_milestone','public.plan_add_milestone(uuid,text,text,timestamptz,uuid,text,uuid)','plan_items','_id','_tenant'),
    ('plan_assign_task','public.plan_assign_task(text,uuid,uuid,uuid,timestamptz,text,text,uuid,jsonb,boolean,uuid)','plan_items','_id','_tenant'),
    ('plan_set_reminder','public.plan_set_reminder(text,timestamptz,text,uuid,text,uuid,text,uuid,uuid)','plan_items','_id','_tenant'),
    ('plan_update_item','public.plan_update_item(uuid,text,text,text,timestamptz,timestamptz,text,uuid,uuid)','plan_items','p_item_id','_row.tenant_id'),
    ('plan_remove_item','public.plan_remove_item(uuid,uuid)','plan_items','p_item_id','_row.tenant_id')
  ) AS s(tool,signature,record_table,record_id,record_tenant)
  LOOP
    original := pg_get_functiondef(spec.signature::regprocedure);
    IF position('planning_native_receipt_v1' IN original)>0 THEN
      IF position('_planning_receipt_audit uuid' IN original)=0
        OR strpos(original,format('%L',spec.tool)||',''capability_succeeded''')=0 THEN
        RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: incomplete installed receipt';
      END IF;
      CONTINUE;
    END IF;
    IF position('record_capability_run' IN original)>0 THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: executor already records a receipt';
    END IF;
    patched := pg_temp.planning_replace_once(original,'DECLARE ',
      'DECLARE _planning_receipt_audit uuid; _planning_receipt_version timestamptz; _planning_receipt_recorded boolean := false; _planning_receipt_status text := ''actor_unavailable''; ');
    audit_at := position('INSERT INTO public.audit_logs' IN patched);
    IF audit_at=0 THEN RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: native audit missing'; END IF;
    audit_end := position(';' IN substring(patched FROM audit_at));
    audit_statement := substring(patched FROM audit_at FOR audit_end);
    patched := pg_temp.planning_replace_once(patched,audit_statement,
      left(audit_statement,length(audit_statement)-1)||' RETURNING id INTO _planning_receipt_audit;');
    return_at := position('RETURN jsonb_build_object(' IN patched);
    IF return_at=0 THEN RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: native acknowledgement missing'; END IF;
    return_end := position(';' IN substring(patched FROM return_at));
    return_statement := substring(patched FROM return_at FOR return_end);
    receipt_block := format($receipt$
  -- planning_native_receipt_v1: one native audit UUID identifies this commit.
  -- No request idempotency is inferred. An explicit new call can change again.
  IF _caller IS NOT NULL THEN
    -- Preserve the existing platform-owner cross-workspace exception without
    -- inventing active membership for the service-only receipt contract.
    IF public.is_platform_owner() AND NOT EXISTS (
      SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=%s
        AND m.user_id=_caller AND m.status='active'
    ) THEN
      _planning_receipt_status := 'actor_not_workspace_member';
    ELSE
      SELECT updated_at INTO _planning_receipt_version FROM public.%I
        WHERE id=%s AND tenant_id=%s;
      IF NOT FOUND OR _planning_receipt_version IS NULL THEN
        RAISE EXCEPTION 'PLAN_RECEIPT_SOURCE_UNVERIFIED' USING ERRCODE='P0001';
      END IF;
      -- All detail fields are fixed references/enums/version, never user prose.
      -- No exception handler: ordinary mutation, audit and receipt are atomic.
      PERFORM public.record_capability_run(%s,_caller,%L,'capability_succeeded',_planning_receipt_audit,
        NULL::text,NULL::text,NULL::uuid,NULL::text,
        jsonb_build_object('record_table',%L,'record_id',%s,'operation',%L,
          'audit_id',_planning_receipt_audit,'source_version',_planning_receipt_version));
      _planning_receipt_recorded := true;
      _planning_receipt_status := 'recorded';
    END IF;
  END IF;
  %s || jsonb_build_object('railRecorded',_planning_receipt_recorded,
    'receipt_status',_planning_receipt_status,
    'receipt_run_id',CASE WHEN _planning_receipt_recorded THEN _planning_receipt_audit ELSE NULL END);
$receipt$,spec.record_tenant,spec.record_table,spec.record_id,spec.record_tenant,
      spec.record_tenant,spec.tool,spec.record_table,spec.record_id,spec.tool,
      left(return_statement,length(return_statement)-1));
    patched := pg_temp.planning_replace_once(patched,return_statement,receipt_block);
    EXECUTE patched; -- Same signature/owner/ACL; all incumbent authority stays.
  END LOOP;
END $planning_receipts$;

-- One public signature: old named/default/positional callers keep their prefix.
-- p_by_item_date retains its current meaning; history is a distinct option.
-- DROP has no CASCADE: an unexpected static dependent is a migration refusal.
DO $planning_history$
DECLARE original text; patched text; old_signature regprocedure;
BEGIN
  old_signature:=to_regprocedure('public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean)');
  IF old_signature IS NULL THEN
    IF to_regprocedure('public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)') IS NULL
      OR position('planning_cancelled_history_v1' IN pg_get_functiondef('public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)'::regprocedure))=0 THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: native reader unavailable';
    END IF;
  ELSE
    IF to_regprocedure('public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)') IS NOT NULL THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: overlapping reader signatures';
    END IF;
    original:=pg_get_functiondef(old_signature);
    patched:=pg_temp.planning_replace_once(original,'p_by_item_date boolean DEFAULT false)',
      'p_by_item_date boolean DEFAULT false, p_include_cancelled boolean DEFAULT false)');
    patched:=pg_temp.planning_replace_once(patched,'BEGIN',E'BEGIN\n  -- planning_cancelled_history_v1');
    patched:=pg_temp.planning_replace_once(patched,'_tenant := public.current_user_tenant_id();',
      '_tenant := public.current_user_tenant_id();
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION ''PLAN_FORBIDDEN: tenant mismatch'' USING ERRCODE=''42501'';
    END IF;');
    patched:=pg_temp.planning_replace_once(patched,'AND (p_status IS NULL OR status=p_status)',
      'AND (p_status IS NULL OR status=p_status OR (p_include_cancelled AND p_status IN (''open'',''in_progress'',''blocked'',''done'',''cancelled'')))');
    patched:=pg_temp.planning_replace_once(patched,'WHERE i.plan_id = p.id',
      'WHERE i.plan_id = p.id AND i.tenant_id=_tenant
       AND (NOT p_include_cancelled OR p_status IS NULL OR p_status NOT IN (''open'',''in_progress'',''blocked'',''done'',''cancelled'') OR i.status=p_status)');
    IF (length(patched)-length(replace(patched,'i.status <> ''cancelled''','')))/length('i.status <> ''cancelled''')<>2 THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: native cancellation filters changed';
    END IF;
    patched:=replace(patched,'i.status <> ''cancelled''','(p_include_cancelled OR i.status <> ''cancelled'')');
    EXECUTE 'DROP FUNCTION public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean)';
    EXECUTE patched;
    REVOKE ALL ON FUNCTION public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
    GRANT EXECUTE ON FUNCTION public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean) TO authenticated,service_role;
  END IF;

  old_signature:=to_regprocedure('public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid)');
  IF old_signature IS NULL THEN
    IF to_regprocedure('public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean)') IS NULL
      OR position('planning_operations_cancelled_history_v1' IN pg_get_functiondef('public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean)'::regprocedure))=0 THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: Operations reader unavailable';
    END IF;
  ELSE
    IF to_regprocedure('public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean)') IS NOT NULL THEN
      RAISE EXCEPTION 'PLANNING_SOURCE_CHANGED: overlapping Operations readers';
    END IF;
    original:=pg_get_functiondef(old_signature);
    patched:=pg_temp.planning_replace_once(original,'p_assigned_to_user_id uuid DEFAULT NULL::uuid)',
      'p_assigned_to_user_id uuid DEFAULT NULL::uuid, p_include_cancelled boolean DEFAULT false)');
    patched:=pg_temp.planning_replace_once(patched,'begin',E'begin\n  -- planning_operations_cancelled_history_v1');
    patched:=pg_temp.planning_replace_once(patched,'p_by_item_date:=p_by_item_date,p_assigned_to_user_id:=p_assigned_to_user_id)',
      'p_by_item_date:=p_by_item_date,p_assigned_to_user_id:=p_assigned_to_user_id,p_include_cancelled:=p_include_cancelled)');
    EXECUTE 'DROP FUNCTION public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid)';
    EXECUTE patched;
    REVOKE ALL ON FUNCTION public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean) FROM PUBLIC,anon,service_role;
    GRANT EXECUTE ON FUNCTION public.plan_list_operations_scoped(uuid,uuid,date,date,text,integer,uuid,boolean,uuid,boolean) TO authenticated;
  END IF;
END $planning_history$;

-- The existing Operations versioned-update contract, delegating removal to its
-- own native writer so linked actions are dismissed in the same transaction.
CREATE OR REPLACE FUNCTION public.plan_remove_item_versioned(
  p_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_row public.plan_items%ROWTYPE; v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  v_tenant:=public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_tenant AND t.account_type::text='standalone' AND t.parent_tenant_id IS NULL) THEN
    RAISE EXCEPTION 'PLAN_FORBIDDEN: Solo Operations unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.plan_items WHERE id=p_item_id AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.is_tenant_admin(v_tenant) OR v_row.created_by=v_actor,false) THEN
    RAISE EXCEPTION 'PLAN_ITEM_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'PLAN_WORK_CHANGED' USING ERRCODE='40001';
  END IF;
  v_result:=public.plan_remove_item(p_item_id:=p_item_id,p_tenant_id:=v_tenant);
  IF (v_result->>'ok') IS DISTINCT FROM 'true' OR (v_result->>'item_id') IS DISTINCT FROM p_item_id::text
    OR (v_result->>'status') IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'PLAN_REMOVE_UNCONFIRMED' USING ERRCODE='P0001';
  END IF;
  RETURN v_result||jsonb_build_object('actor_id',v_actor,'tenant_id',v_tenant);
END $$;
REVOKE ALL ON FUNCTION public.plan_remove_item_versioned(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.plan_remove_item_versioned(uuid,uuid,uuid,timestamptz) TO authenticated;

-- A distinct API keeps existing date/status callers and their signatures intact.
-- This is a version/scope guard around the installed native reminder field edit.
CREATE OR REPLACE FUNCTION public.plan_reschedule_reminder_versioned(
  p_item_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid,
  p_expected_updated_at timestamptz,p_remind_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_row public.plan_items%ROWTYPE;
  v_after public.plan_items%ROWTYPE; v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  v_tenant:=public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_tenant AND t.account_type::text='standalone' AND t.parent_tenant_id IS NULL) THEN
    RAISE EXCEPTION 'PLAN_FORBIDDEN: Solo Operations unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.plan_items WHERE id=p_item_id AND tenant_id=v_tenant FOR UPDATE;
  -- Target-workspace authority AND the native creator/admin field-edit rule.
  -- An assignee alone or a retired coach title never gains reschedule authority.
  IF NOT FOUND OR NOT coalesce(public.is_tenant_admin(v_tenant) OR v_row.created_by=v_actor,false)
    OR NOT coalesce(public.has_any_role(v_actor,ARRAY['admin','super_admin']) OR v_row.created_by=v_actor,false) THEN
    RAISE EXCEPTION 'PLAN_ITEM_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at) OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'PLAN_WORK_CHANGED' USING ERRCODE='40001';
  END IF;
  IF v_row.item_type IS DISTINCT FROM 'reminder' OR v_row.status NOT IN ('open','in_progress','blocked')
    OR p_remind_at IS NULL OR NOT isfinite(p_remind_at) OR p_remind_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'PLAN_REMINDER_TIME_UNAVAILABLE' USING ERRCODE='22023';
  END IF;
  v_result:=public.plan_update_item(p_item_id:=p_item_id,p_remind_at:=p_remind_at,p_tenant_id:=v_tenant);
  SELECT * INTO v_after FROM public.plan_items WHERE id=p_item_id AND tenant_id=v_tenant;
  IF NOT FOUND OR (v_result->>'ok') IS DISTINCT FROM 'true'
    OR (v_result->>'item_id') IS DISTINCT FROM p_item_id::text
    OR (v_result->>'railRecorded') IS DISTINCT FROM 'true'
    OR v_after.remind_at IS DISTINCT FROM p_remind_at
    OR v_after.reminded_at IS NOT NULL OR v_after.resolved_at IS NOT NULL
    OR (to_jsonb(v_after)-ARRAY['remind_at','reminded_at','resolved_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(v_row)-ARRAY['remind_at','reminded_at','resolved_at','updated_at']) THEN
    RAISE EXCEPTION 'PLAN_RESCHEDULE_UNCONFIRMED' USING ERRCODE='P0001';
  END IF;
  -- Preserve all native receipt fields; add only verified scope/current source.
  RETURN v_result||jsonb_build_object('actor_id',v_actor,'tenant_id',v_tenant,
    'remind_at',v_after.remind_at,'updated_at',v_after.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.plan_reschedule_reminder_versioned(uuid,uuid,uuid,timestamptz,timestamptz) TO authenticated;

-- Keep the existing display chain; native SQL cannot infer Chat versus manual
-- invocation. Credit the authenticated actor and describe only verified records.
DO $$ BEGIN
  IF to_regprocedure('public._workspace_event_display_before_native_planning(text,text,text)') IS NULL THEN
    ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_native_planning;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_native_planning(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; title text;
BEGIN
  result:=public._workspace_event_display_before_native_planning(_source_kind,_outcome,_capability);
  IF _source_kind='capability_run' AND _outcome='capability_succeeded' AND _capability IN
    ('plan_create','plan_add_milestone','plan_assign_task','plan_set_reminder','plan_update_item','plan_remove_item') THEN
    title:=CASE _capability WHEN 'plan_create' THEN 'Plan saved' WHEN 'plan_add_milestone' THEN 'Milestone saved'
      WHEN 'plan_assign_task' THEN 'Planning task saved' WHEN 'plan_set_reminder' THEN 'Reminder saved'
      WHEN 'plan_update_item' THEN 'Planning item changed' ELSE 'Planning item cancelled' END;
    result:=result||jsonb_build_object('actor_type','owner_staff','title',title,
      'summary',CASE WHEN _capability='plan_set_reminder'
        THEN 'The reminder record and its activity receipt were saved. Scheduled does not mean delivered.'
        WHEN _capability='plan_remove_item' THEN 'The planning item was marked cancelled and its activity receipt was saved. This is not a delivery recall.'
        ELSE 'The planning record and its activity receipt were saved. This does not establish execution or delivery of the work.' END);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
