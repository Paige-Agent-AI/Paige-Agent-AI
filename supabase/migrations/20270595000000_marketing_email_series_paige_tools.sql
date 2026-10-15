-- Marketing email E3c: PAIGE writes email series from chat.
--
-- Owner assignment (2026-10-05): Chat is the primary command layer; the Automations UI stays the observable,
-- editable record. Reuse E3 whole: the same series, versions, steps, enrollment, series-owned step campaigns,
-- minute tick, worker, sender rules, unsubscribe and suppressions, postal address, 500-a-day limit and the one
-- approval per version. No chat-side store, scheduler, worker or approval ledger is added here.
--
-- What this adds:
--   * email_sequences.request_key — one chat request makes at most one series, however often it is retried.
--   * email_series_draft — PAIGE writes a whole series in one call (who enters, every email and its wait, the
--     exits), through the same owner functions the series view calls, so a series PAIGE writes reopens in the
--     view as editable emails. A series waiting for approval is refused rather than changed (changing it
--     would withdraw the owner's pending decision; the owner does that with Make changes). A running series
--     gets a new draft; its approved version keeps sending until the change is approved.
--   * email_series_submit_for_approval — files the draft through email_sequence_request_approval with source
--     'paige'. A repeat of PAIGE's own filing returns the approval it made. PAIGE never approves:
--     email_sequence_approve stays human-only behind its guard trigger.
--   * read_email_series — the series list or one series, for chat, naming the business the chat is in.
--   * read_email_series_links — the business's own public links (published pages, funnels and forms, booking
--     pages that can take a meeting, the website the owner confirmed in Setup) and its recorded prices, so the
--     chat can refuse a link or price nobody gave. Links and amounts only.
--   * read_email_sequence gains waiting_to_enter: people who qualify for a series that has started but have
--     not entered yet. While a series is paused they wait; they enter when it resumes (owner ruling 2026-10-05).
--   * email_sequence_duplicate — "Start a copy" of a series. Stop is final (owner ruling 2026-10-05): a stopped
--     series is replaced by a copy, never restarted.
--
-- Every chat function names the business (p_expected_tenant_id) and checks it through _email_paige_tenant, so a
-- business switch mid-conversation is refused, not written to the wrong business (§9). Writes reach the same
-- owner/admin check as the series view (_email_caller_tenant).

SET lock_timeout = '10s';

ALTER TABLE public.email_sequences ADD COLUMN IF NOT EXISTS request_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS email_sequences_tenant_request_key
  ON public.email_sequences (tenant_id, request_key) WHERE request_key IS NOT NULL;

-- ── Chat reads ─────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.read_email_series(p_expected_tenant_id uuid, p_sequence_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._email_paige_tenant(p_expected_tenant_id);
  IF p_sequence_id IS NULL THEN RETURN public.read_email_sequences(); END IF;
  RETURN public.read_email_sequence(p_sequence_id);
END $$;
REVOKE ALL ON FUNCTION public.read_email_series(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_series(uuid, uuid) TO authenticated;

-- The business's own links and recorded prices. A link counts when it is live for the public: a published
-- page, an active funnel or form, a booking page with at least one host, or the website the owner confirmed
-- in Setup (business_identity_readiness, the same answer the outbound facts check licenses).
CREATE OR REPLACE FUNCTION public.read_email_series_links(p_expected_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_paige_tenant(p_expected_tenant_id); tslug text; site text;
BEGIN
  SELECT tn.slug INTO tslug FROM public.tenants tn WHERE tn.id = t;
  SELECT COALESCE(max(CASE WHEN r.fact_key = 'website' AND r.state = 'owner_confirmed' AND r.source = 'setup'
                           THEN lp.website_url END), '')
    INTO site
    FROM public.business_identity_readiness(t) r
    LEFT JOIN public.tenant_legal_profile lp ON lp.tenant_id = t;
  RETURN jsonb_build_object(
    'paths', to_jsonb(ARRAY(
      SELECT '/p/' || tslug || '/' || gp.slug FROM public.growth_pages gp
       WHERE gp.tenant_id = t AND gp.status = 'published' AND tslug IS NOT NULL
      UNION ALL
      SELECT '/f/' || tslug || '/' || gf.slug FROM public.growth_funnels gf
       WHERE gf.tenant_id = t AND gf.status = 'active' AND tslug IS NOT NULL
      UNION ALL
      SELECT '/form/' || fm.id FROM public.growth_forms fm WHERE fm.tenant_id = t AND fm.status = 'active'
      UNION ALL
      SELECT '/book/' || c.slug FROM public.calendars c
       WHERE c.tenant_id = t AND c.enabled IS TRUE
         AND EXISTS (SELECT 1 FROM public.calendar_hosts h WHERE h.calendar_id = c.id))),
    'website', NULLIF(btrim(site), ''),
    'prices', to_jsonb(ARRAY(
      SELECT DISTINCT p.unit_amount FROM public.tenant_prices p WHERE p.tenant_id = t AND p.active)));
END $$;
REVOKE ALL ON FUNCTION public.read_email_series_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_series_links(uuid) TO authenticated;

-- ── Chat writes ────────────────────────────────────────────────────────────────────────────────────

-- Create a series (no id; a request key is required) or change one. NULL leaves a field as it is. p_steps,
-- when given, is the whole list of emails in order: [{delay_minutes, subject, preheader, body_html}], one to
-- ten; it replaces the emails the draft had. The sender stays the business's connected sender first, as the
-- series view sets it; the owner changes it there.
CREATE OR REPLACE FUNCTION public.email_series_draft(
  p_expected_tenant_id uuid, p_sequence_id uuid DEFAULT NULL, p_request_key uuid DEFAULT NULL,
  p_kind text DEFAULT NULL, p_name text DEFAULT NULL, p_entry_mode text DEFAULT NULL, p_audience jsonb DEFAULT NULL,
  p_segment_id uuid DEFAULT NULL, p_clear_segment boolean DEFAULT false, p_exit_on_goal text DEFAULT NULL,
  p_exit_when_unmatched boolean DEFAULT NULL, p_steps jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  s public.email_sequences%ROWTYPE; cur public.email_sequence_versions%ROWTYPE; v public.email_sequence_versions%ROWTYPE;
  made jsonb; sid uuid; created boolean := false; changing boolean := false; n int; have int; i int; st jsonb;
BEGIN
  IF p_exit_on_goal IS NOT NULL AND p_exit_on_goal NOT IN ('none','form_submission','booking','deal_created','invoice_paid') THEN
    RAISE EXCEPTION 'goal_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_steps IS NOT NULL THEN
    IF jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 10 THEN
      RAISE EXCEPTION 'steps_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_steps) x WHERE jsonb_typeof(x) <> 'object'
                OR NOT (x ?& ARRAY['delay_minutes','subject','body_html'])
                OR jsonb_typeof(x->'delay_minutes') <> 'number' OR (x->>'delay_minutes') !~ '^[0-9]{1,6}$'
                OR (x->>'delay_minutes')::int > 129600
                OR jsonb_typeof(x->'subject') <> 'string' OR jsonb_typeof(x->'body_html') <> 'string'
                OR (x ? 'preheader' AND jsonb_typeof(x->'preheader') NOT IN ('string','null'))) THEN
      RAISE EXCEPTION 'steps_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_sequence_id IS NULL THEN
    IF p_request_key IS NULL THEN RAISE EXCEPTION 'request_key_required' USING ERRCODE = '22023'; END IF;
    -- One create per key, and a repeat returns what the first made. The lock serialises two retries.
    PERFORM pg_advisory_xact_lock(hashtextextended(t::text || ':series:' || p_request_key::text, 0));
    SELECT * INTO s FROM public.email_sequences WHERE tenant_id = t AND request_key = p_request_key;
    IF FOUND THEN
      SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.current_version_id;
      RETURN jsonb_build_object('sequence_id', s.id, 'version_id', v.id, 'version_no', v.version_no,
        'created', true, 'replayed', true, 'changing_running', false);
    END IF;
    made := public.email_sequence_create(COALESCE(p_kind, 'custom'), p_name);
    sid := (made->>'sequence_id')::uuid;
    UPDATE public.email_sequences SET request_key = p_request_key WHERE id = sid;
    created := true;
  ELSE
    sid := p_sequence_id;
    SELECT * INTO s FROM public.email_sequences WHERE id = sid AND tenant_id = t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
    IF s.status = 'stopped' THEN RAISE EXCEPTION 'series_stopped' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO cur FROM public.email_sequence_versions WHERE id = s.current_version_id;
    IF cur.state = 'locked' THEN RAISE EXCEPTION 'series_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
    IF cur.state <> 'draft' THEN
      -- A running series: a new draft copied from what is sending. What is sending keeps sending.
      PERFORM public.email_sequence_edit(sid);
      changing := true;
    ELSE
      changing := s.live_version_id IS NOT NULL;
    END IF;
  END IF;

  PERFORM public.email_sequence_update_draft(sid, CASE WHEN created THEN NULL ELSE p_name END, p_entry_mode, p_audience,
    p_segment_id, COALESCE(p_clear_segment, false), p_exit_on_goal, p_exit_when_unmatched, NULL);

  IF p_steps IS NOT NULL THEN
    n := jsonb_array_length(p_steps);
    SELECT count(*) INTO have FROM public.email_sequence_steps st2
      JOIN public.email_sequences s2 ON s2.current_version_id = st2.version_id WHERE s2.id = sid;
    FOR i IN 1..n LOOP
      st := p_steps -> (i - 1);
      PERFORM public.email_sequence_step_save(sid, CASE WHEN i <= have THEN i ELSE NULL END,
        (st->>'delay_minutes')::int, st->>'subject', COALESCE(st->>'preheader', ''), st->>'body_html');
    END LOOP;
    FOR i IN REVERSE have..(n + 1) LOOP
      PERFORM public.email_sequence_step_delete(sid, i);
    END LOOP;
  END IF;

  SELECT * INTO s FROM public.email_sequences WHERE id = sid;
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.current_version_id;
  RETURN jsonb_build_object('sequence_id', sid, 'version_id', v.id, 'version_no', v.version_no,
    'created', created, 'replayed', false, 'changing_running', changing);
END $$;
REVOKE ALL ON FUNCTION public.email_series_draft(uuid, uuid, uuid, text, text, text, jsonb, uuid, boolean, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_series_draft(uuid, uuid, uuid, text, text, text, jsonb, uuid, boolean, text, boolean, jsonb) TO authenticated;

-- File the series' draft for the owner's approval. A repeat of PAIGE's own filing returns the approval it
-- made; one the owner filed is theirs, not hers. Approving stays with a person.
CREATE OR REPLACE FUNCTION public.email_series_submit_for_approval(p_expected_tenant_id uuid, p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE; a public.paige_pending_approvals%ROWTYPE;
BEGIN
  -- No locks here: email_sequence_request_approval takes them in the series view's order.
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'stopped' THEN RAISE EXCEPTION 'series_stopped' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.current_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.state = 'locked' THEN
    SELECT * INTO a FROM public.paige_pending_approvals WHERE id = v.approval_id;
    IF FOUND AND a.status = 'pending' AND a.source = 'paige' THEN
      RETURN jsonb_build_object('approval_id', a.id, 'sequence_id', s.id, 'version_id', v.id,
        'emails', (SELECT count(*) FROM public.email_sequence_steps WHERE version_id = v.id),
        'matching_now', v.expected_entrants, 'from_address', v.sender_snapshot->>'from_address', 'replayed', true);
    END IF;
    RAISE EXCEPTION 'series_awaiting_approval' USING ERRCODE = 'P0001';
  END IF;
  IF v.state <> 'draft' THEN RAISE EXCEPTION 'nothing_to_file' USING ERRCODE = 'P0001'; END IF;
  RETURN public.email_sequence_request_approval(s.id, 'paige') || jsonb_build_object('replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.email_series_submit_for_approval(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_series_submit_for_approval(uuid, uuid) TO authenticated;

-- ── Series view: start a copy ──────────────────────────────────────────────────────────────────────

-- A new draft series with the same entry rule, exits, sender and emails as the one it copies (its running
-- version, or its draft if it never started). It starts from nothing: nobody is in it, and it needs its own
-- approval. This is how a stopped series is replaced.
CREATE OR REPLACE FUNCTION public.email_sequence_duplicate(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  s public.email_sequences%ROWTYPE; f public.email_sequence_versions%ROWTYPE; ns uuid; nv uuid;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO f FROM public.email_sequence_versions WHERE id = COALESCE(s.live_version_id, s.current_version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.email_sequences (tenant_id, kind, name, created_by)
  VALUES (t, s.kind, left('Copy of ' || s.name, 200), auth.uid())
  RETURNING id INTO ns;
  INSERT INTO public.email_sequence_versions (sequence_id, tenant_id, version_no, entry_mode, audience, segment_id,
    exit_on_goal, exit_when_unmatched, sender, created_by)
  VALUES (ns, t, 1, f.entry_mode, f.audience, f.segment_id, f.exit_on_goal, f.exit_when_unmatched, f.sender, auth.uid())
  RETURNING id INTO nv;
  INSERT INTO public.email_sequence_steps (version_id, tenant_id, position, delay_minutes, subject, preheader, body_html)
  SELECT nv, t, st.position, st.delay_minutes, st.subject, st.preheader, st.body_html
    FROM public.email_sequence_steps st WHERE st.version_id = f.id;
  UPDATE public.email_sequences SET current_version_id = nv WHERE id = ns;
  RETURN jsonb_build_object('sequence_id', ns, 'version_id', nv);
END $$;
REVOKE ALL ON FUNCTION public.email_sequence_duplicate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_duplicate(uuid) TO authenticated;

-- ── Series view: who is waiting to enter ───────────────────────────────────────────────────────────

-- read_email_sequence gains waiting_to_enter: people the running version's rule takes in who have not entered
-- yet, counted as the tick would enrol them (eligible today, never in this series, and for "new contacts"
-- created after the series first started). NULL for a series that has not started or was stopped.
DO $$ BEGIN
  IF to_regprocedure('public._read_email_sequence_before_series_chat(uuid)') IS NULL THEN
    ALTER FUNCTION public.read_email_sequence(uuid) RENAME TO _read_email_sequence_before_series_chat;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._read_email_sequence_before_series_chat(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.read_email_sequence(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  s public.email_sequences%ROWTYPE; lv public.email_sequence_versions%ROWTYPE; waiting int;
  result jsonb := public._read_email_sequence_before_series_chat(p_sequence_id);
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t;
  IF FOUND AND s.live_version_id IS NOT NULL AND s.status <> 'stopped' THEN
    SELECT * INTO lv FROM public.email_sequence_versions WHERE id = s.live_version_id;
    SELECT count(*) INTO waiting FROM public._email_audience(t, lv.audience, false) a
      JOIN public.clients cl ON cl.id = a.client_id
     WHERE a.ineligible IS NULL
       AND (lv.entry_mode = 'matching' OR cl.created_at >= s.activated_at)
       AND NOT EXISTS (SELECT 1 FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.client_id = a.client_id);
  END IF;
  RETURN result || jsonb_build_object('waiting_to_enter', waiting);
END $$;
REVOKE ALL ON FUNCTION public.read_email_sequence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_sequence(uuid) TO authenticated;

-- ── Autonomy settings and activity wording ─────────────────────────────────────────────────────────

-- PAIGE's two series writes appear in Autonomy settings beside her campaign writes, asking first by default.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_email_series_chat(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_email_series_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_email_series_chat(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_email_series_chat(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY
 WITH catalog(tool_key,label) AS (VALUES ('email_series_draft','Write or change an email series'),('email_series_request_approval','File an email series for your approval'))
 SELECT c.tool_key,c.label,'Campaigns'::text,coalesce(t.mode,'confirm'),t.mode IS NULL,t.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy t ON t.tenant_id=tenant AND t.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

DO $$ BEGIN
 IF to_regprocedure('public._workspace_event_display_before_email_series_chat(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_email_series_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_email_series_chat(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_display_before_email_series_chat(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='email_series_draft' AND _outcome IN ('capability_succeeded','capability_refused') THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'PAIGE saved an email series draft' ELSE 'PAIGE couldn''t save an email series draft' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'A draft in Marketing › Email › Automations. Nothing was sent.' ELSE 'Nothing was changed and nothing was sent.' END);
 ELSIF _source_kind='capability_run' AND _capability='email_series_request_approval' AND _outcome IN ('capability_succeeded','capability_refused') THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'PAIGE filed an email series for approval' ELSE 'PAIGE could not file an email series for approval' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'It waits for an owner or admin to approve it. Nothing is sent until then.' ELSE 'Nothing was changed and nothing was sent.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
