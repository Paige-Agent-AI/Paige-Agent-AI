-- Marketing email E2b: PAIGE drafts a campaign, sees who it would reach, and files it for the owner's approval.
--
-- Four functions and one column. PAIGE reaches them from chat through the same seams the editor uses, as the
-- signed-in owner or admin of their own business (_email_caller_tenant). Nothing here approves or sends: the
-- only approval is the owner's, on the version email_campaign_request_approval freezes (owner ruling: one
-- bounded approval), and email_campaign_approve stays human-only behind its guard trigger.

-- A chat retry must not make a second campaign. PAIGE's create carries a key the chat derives from the
-- business, the person and the request; the same key returns the campaign it already made.
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS request_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_tenant_request_key
  ON public.email_campaigns (tenant_id, request_key) WHERE request_key IS NOT NULL;

-- The business the chat is talking about must still be the caller's active business. A person who switches
-- business mid-conversation is refused rather than having PAIGE act in the other one. An agency account runs no
-- email book of its own (§60: agencies have no Marketing area); its businesses each do, so PAIGE works there.
CREATE OR REPLACE FUNCTION public._email_paige_tenant(p_expected_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  IF p_expected_tenant_id IS NULL OR t <> p_expected_tenant_id THEN
    RAISE EXCEPTION 'active_account_changed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = t AND account_type = 'agency') THEN
    RAISE EXCEPTION 'not_for_this_account' USING ERRCODE = '42501';
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public._email_paige_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- Create a draft (no campaign id) or change the current draft of one campaign. NULL leaves a field as it is.
-- The sender is not PAIGE's to choose: a new campaign takes the business's connected sender first, exactly as
-- the editor's does, and the owner can change it there. A version that is awaiting approval, sending or sent is
-- refused rather than replaced, because replacing it would withdraw the owner's pending decision; the owner
-- does that in the editor with Make changes, or Edit and send again.
CREATE OR REPLACE FUNCTION public.email_campaign_draft(
  p_expected_tenant_id uuid, p_campaign_id uuid DEFAULT NULL, p_request_key uuid DEFAULT NULL,
  p_name text DEFAULT NULL, p_kind text DEFAULT NULL, p_subject text DEFAULT NULL, p_preheader text DEFAULT NULL,
  p_body_html text DEFAULT NULL, p_audience jsonb DEFAULT NULL, p_segment_id uuid DEFAULT NULL,
  p_clear_segment boolean DEFAULT false, p_scheduled_for timestamptz DEFAULT NULL, p_clear_schedule boolean DEFAULT false,
  p_conversion_goal text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE;
  made jsonb; created boolean := false;
BEGIN
  IF p_campaign_id IS NULL THEN
    IF p_request_key IS NULL THEN RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023'; END IF;
    -- One create per key, and a repeat returns what the first made before anything else is checked: a
    -- retry after its send time has passed must still find the campaign. The lock serialises two retries.
    PERFORM pg_advisory_xact_lock(hashtextextended(t::text || ':' || p_request_key::text, 0));
    SELECT * INTO c FROM public.email_campaigns WHERE tenant_id = t AND request_key = p_request_key;
    IF FOUND THEN
      SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
      RETURN jsonb_build_object('campaign_id', c.id, 'version_id', v.id, 'version_no', v.version_no,
        'state', v.state, 'created', true, 'replayed', true);
    END IF;
  END IF;
  IF p_scheduled_for IS NOT NULL AND p_scheduled_for < now() THEN
    RAISE EXCEPTION 'schedule_in_past' USING ERRCODE = '22023';
  END IF;
  IF p_audience IS NOT NULL AND jsonb_typeof(p_audience) <> 'object' THEN
    RAISE EXCEPTION 'audience_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_campaign_id IS NULL THEN
    made := public.email_campaign_create(COALESCE(p_kind, 'standard'), p_name);
    UPDATE public.email_campaigns SET request_key = p_request_key WHERE id = (made->>'campaign_id')::uuid;
    SELECT * INTO c FROM public.email_campaigns WHERE id = (made->>'campaign_id')::uuid;
    created := true;
  ELSE
    SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  -- The version is locked before the campaign, the order the editor's own saves take, so PAIGE and an
  -- autosave never wait on each other in a circle.
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = c.id FOR UPDATE;
  IF c.current_version_id IS DISTINCT FROM v.id THEN RAISE EXCEPTION 'not_the_current_version' USING ERRCODE = 'P0001'; END IF;
  IF v.state <> 'draft' AND c.status IN ('cancelled', 'blocked') THEN RAISE EXCEPTION 'campaign_stopped' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'locked' THEN RAISE EXCEPTION 'campaign_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'approved' THEN RAISE EXCEPTION 'campaign_approved' USING ERRCODE = 'P0001'; END IF;
  IF v.state <> 'draft' THEN RAISE EXCEPTION 'campaign_already_sent' USING ERRCODE = 'P0001'; END IF;

  PERFORM public.email_campaign_update_draft(v.id,
    CASE WHEN created THEN NULL ELSE p_name END, CASE WHEN created THEN NULL ELSE p_kind END,
    p_subject, p_preheader, p_body_html, NULL, p_audience, p_segment_id, COALESCE(p_clear_segment, false),
    p_scheduled_for, COALESCE(p_clear_schedule, false), p_conversion_goal);
  RETURN jsonb_build_object('campaign_id', c.id, 'version_id', v.id, 'version_no', v.version_no,
    'state', 'draft', 'created', created, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, uuid, boolean, timestamptz, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, uuid, boolean, timestamptz, boolean, text) TO authenticated;

-- The business's campaigns, newest first, or one campaign's current version in full, so PAIGE can find the
-- campaign she is asked about and change the right draft. Recipients' names and addresses are never included.
CREATE OR REPLACE FUNCTION public.read_email_campaigns(p_expected_tenant_id uuid, p_campaign_id uuid DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'status', x.status,
               'version_no', xv.version_no, 'version_state', xv.state, 'subject', xv.subject,
               'scheduled_for', xv.scheduled_for, 'updated_at', x.updated_at) ORDER BY x.updated_at DESC)
        FROM (SELECT * FROM public.email_campaigns WHERE tenant_id = t ORDER BY updated_at DESC
               LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)) x
        LEFT JOIN public.email_campaign_versions xv ON xv.id = x.current_version_id), '[]'::jsonb));
  END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status,
      'blocked_reason', c.blocked_reason, 'updated_at', c.updated_at),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'state', v.state, 'subject', v.subject,
      'preheader', v.preheader, 'body_html', v.body_html, 'audience', v.audience, 'segment_id', v.segment_id,
      'segment_name', (SELECT s.name FROM public.email_segments s WHERE s.id = v.segment_id AND s.tenant_id = t),
      'scheduled_for', v.scheduled_for, 'conversion_goal', v.conversion_goal,
      'expected_recipients', v.expected_recipients, 'cost_bound_usd', v.cost_bound_usd),
    'from', public._email_resolve_sender(t, v.sender)->>'from_address',
    'approval_status', (SELECT a.status FROM public.paige_pending_approvals a WHERE a.id = v.approval_id),
    'last_declined_reason', (SELECT a.decision_rationale FROM public.email_campaign_versions pv
                               JOIN public.paige_pending_approvals a ON a.id = pv.approval_id
                              WHERE pv.campaign_id = c.id AND pv.id <> v.id AND a.status = 'rejected'
                              ORDER BY pv.version_no DESC LIMIT 1),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                            FROM public.email_segments s WHERE s.tenant_id = t), '[]'::jsonb),
    'choices', public._email_rule_choices(t));
END $$;
REVOKE ALL ON FUNCTION public.read_email_campaigns(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_campaigns(uuid, uuid, integer) TO authenticated;

-- Who one campaign's current version would reach today, and why anyone is left out. Counts only: no names
-- or addresses. A version already frozen for approval also reports the count the owner is deciding on.
CREATE OR REPLACE FUNCTION public.read_email_campaign_audience(p_expected_tenant_id uuid, p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE; seg text;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT name INTO seg FROM public.email_segments WHERE id = v.segment_id AND tenant_id = t;
  RETURN public.email_audience_preview(v.audience, c.kind, v.segment_id) || jsonb_build_object(
    'campaign_id', c.id, 'version_id', v.id, 'version_no', v.version_no, 'state', v.state, 'kind', c.kind,
    'rule', v.audience, 'segment_name', seg,
    'newsletter_subscribers_only', c.kind = 'newsletter',
    'frozen_recipients', CASE WHEN v.state IN ('locked', 'approved') THEN v.expected_recipients END);
END $$;
REVOKE ALL ON FUNCTION public.read_email_campaign_audience(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_campaign_audience(uuid, uuid) TO authenticated;

-- File one campaign's current draft for the owner's approval, as PAIGE (p_source 'paige'): the same freeze,
-- audience snapshot and single approval the editor's Review and send makes. A retry after it was filed
-- returns the approval already waiting instead of filing a second one.
CREATE OR REPLACE FUNCTION public.email_campaign_submit_for_approval(p_expected_tenant_id uuid, p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE; a public.paige_pending_approvals%ROWTYPE;
BEGIN
  -- No locks here: email_campaign_request_approval takes them, version first, the editor's order.
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.state <> 'draft' AND c.status IN ('cancelled', 'blocked') THEN RAISE EXCEPTION 'campaign_stopped' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'locked' THEN
    -- A repeat of PAIGE's own filing returns the approval it made. One the owner filed is theirs, not hers.
    SELECT * INTO a FROM public.paige_pending_approvals WHERE id = v.approval_id;
    IF FOUND AND a.status = 'pending' AND a.source = 'paige' THEN
      RETURN jsonb_build_object('approval_id', a.id, 'version_id', v.id, 'recipients', v.expected_recipients,
        'cost_bound_usd', v.cost_bound_usd, 'from_address', v.sender_snapshot->>'from_address', 'replayed', true);
    END IF;
    RAISE EXCEPTION 'campaign_awaiting_approval' USING ERRCODE = 'P0001';
  END IF;
  IF v.state = 'approved' THEN RAISE EXCEPTION 'campaign_approved' USING ERRCODE = 'P0001'; END IF;
  IF v.state = 'sent' THEN RAISE EXCEPTION 'campaign_already_sent' USING ERRCODE = 'P0001'; END IF;
  RETURN public.email_campaign_request_approval(v.id, 'paige') || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_submit_for_approval(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_submit_for_approval(uuid, uuid) TO authenticated;

-- PAIGE's two email writes appear in Autonomy settings, so the owner can choose whether she asks first.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_email_campaign_chat(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_email_campaign_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_email_campaign_chat(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_email_campaign_chat(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY
 WITH catalog(tool_key,label) AS (VALUES ('email_campaign_draft','Write or change an email campaign draft'),('email_campaign_request_approval','File an email campaign for your approval'))
 SELECT c.tool_key,c.label,'Campaigns'::text,coalesce(t.mode,'confirm'),t.mode IS NULL,t.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy t ON t.tenant_id=tenant AND t.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- How PAIGE's email work reads in the business's activity, in the owner's words.
DO $$ BEGIN
 IF to_regprocedure('public._workspace_event_before_email_campaign_chat(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_before_email_campaign_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_before_email_campaign_chat(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_before_email_campaign_chat(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='email_campaign_draft' AND _outcome IN ('capability_succeeded','capability_refused') THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'PAIGE saved an email campaign draft' ELSE 'PAIGE''s email draft was refused' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'A draft in Marketing › Email. Nothing was sent.' ELSE 'Nothing was changed and nothing was sent.' END);
 ELSIF _source_kind='capability_run' AND _capability='email_campaign_request_approval' AND _outcome IN ('capability_succeeded','capability_refused') THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'PAIGE filed an email campaign for approval' ELSE 'PAIGE could not file an email campaign for approval' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'It waits for an owner or admin to approve it. Nothing is sent until then.' ELSE 'Nothing was changed and nothing was sent.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
