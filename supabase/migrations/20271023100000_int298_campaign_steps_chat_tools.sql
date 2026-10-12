-- INT-298 / INT-342 MBC slice 6c — PAIGE reads and plans campaign steps, records and judges their results, and
-- reads and sets a form-started process's scope, from chat and Live (the same chat runtime).
--
-- Nothing here is a new store or a new authority. The two reads are thin, caller-session wrappers over the
-- functions the Campaigns dossier and the process-scope seam already use (get_campaign_brief_actions,
-- get_process_scope); they add one thing, the business the chat is in: a call naming any other business is
-- refused, so a turn that started in one business can never read another after a switch. The writes are the
-- existing configure_campaign_brief_actions and configure_process_scope, unchanged.
--
-- The four writes join the Autonomy catalogue (asking first by default; process_scope_set is `high`, so the
-- chat's risk clamp asks first whatever is set) and get activity wording, through the additive wrapper
-- pattern of 20271021210000: rename the incumbent once, forward its rows unchanged, add the new rows. Replay
-- re-asserts the same bodies and grants.

-- ── 1. The reads PAIGE calls ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.read_campaign_steps(p_expected_tenant_id uuid, p_brief_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_expected_tenant_id IS NULL OR p_expected_tenant_id IS DISTINCT FROM public.current_user_tenant_id() THEN
    RAISE EXCEPTION 'active_account_changed' USING ERRCODE = '22023';
  END IF;
  RETURN public.get_campaign_brief_actions(p_expected_tenant_id, p_brief_id);
END $$;
REVOKE ALL ON FUNCTION public.read_campaign_steps(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_campaign_steps(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_process_scope(p_expected_tenant_id uuid, p_process_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PROCESS_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_expected_tenant_id IS NULL OR p_expected_tenant_id IS DISTINCT FROM public.current_user_tenant_id() THEN
    RAISE EXCEPTION 'active_account_changed' USING ERRCODE = '22023';
  END IF;
  RETURN public.get_process_scope(p_process_id);
END $$;
REVOKE ALL ON FUNCTION public.read_process_scope(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_process_scope(uuid, uuid) TO authenticated;

-- ── 2. Autonomy settings: the four writes, asking first by default ──────────────────────────────────
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_campaign_steps_chat(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_campaign_steps_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_campaign_steps_chat(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_campaign_steps_chat(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_campaign_steps_chat(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('campaign_step_plan','Plan a campaign step','Campaigns'),
  ('campaign_step_record_result','Record what came of a campaign step','Campaigns'),
  ('campaign_step_judge','Judge a campaign step against its aim','Campaigns'),
  ('process_scope_set','Choose which form starts a process','Campaigns')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- ── 3. Activity wording for what PAIGE did ──────────────────────────────────────────────────────────
DO $$ BEGIN
 IF to_regprocedure('public._workspace_event_display_before_campaign_steps_chat(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_campaign_steps_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_campaign_steps_chat(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; ok boolean := _outcome='capability_succeeded';
BEGIN
 result:=public._workspace_event_display_before_campaign_steps_chat(_source_kind,_outcome,_capability);
 IF _source_kind<>'capability_run' OR _outcome NOT IN ('capability_succeeded','capability_refused') THEN RETURN result; END IF;
 IF _capability='campaign_step_plan' THEN
  result:=result||jsonb_build_object('title',CASE WHEN ok THEN 'PAIGE planned a campaign step' ELSE 'PAIGE couldn''t plan a campaign step' END,
   'summary',CASE WHEN ok THEN 'It waits for your approval. Nothing was drafted, sent or published.' ELSE 'Nothing was changed.' END);
 ELSIF _capability='campaign_step_record_result' THEN
  result:=result||jsonb_build_object('title',CASE WHEN ok THEN 'PAIGE recorded what came of a campaign step' ELSE 'PAIGE couldn''t record a campaign step''s result' END,
   'summary',CASE WHEN ok THEN 'Recorded as you stated it, not as a measured figure.' ELSE 'Nothing was changed.' END);
 ELSIF _capability='campaign_step_judge' THEN
  result:=result||jsonb_build_object('title',CASE WHEN ok THEN 'PAIGE recorded your judgement of a campaign step' ELSE 'PAIGE couldn''t record a judgement' END,
   'summary',CASE WHEN ok THEN 'Judged against its aim, as you decided.' ELSE 'Nothing was changed.' END);
 ELSIF _capability='process_scope_set' THEN
  result:=result||jsonb_build_object('title',CASE WHEN ok THEN 'PAIGE set which form starts a process' ELSE 'PAIGE couldn''t set which form starts a process' END,
   'summary',CASE WHEN ok THEN 'It runs only for the forms you chose. It was not switched on or off.' ELSE 'Nothing was changed.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
