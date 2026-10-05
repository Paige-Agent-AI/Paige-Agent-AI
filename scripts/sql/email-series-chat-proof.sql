-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Email series from chat (E3c) — rollback proof for 20270595000000.
--
-- HOW TO RUN: on a preview branch with migrations through 20270595000000, seeded by
-- scripts/sql/email-series-preview-seed.sql, run the whole file as one statement batch (one transaction).
-- It ends with RAISE EXCEPTION 'PROOF …' carrying every result, so nothing persists. Proves the SQL runs and
-- the properties hold on that database; proves nothing about production (that is the post-merge
-- persisted-apply check, §32.a). Not run by CI.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SET LOCAL statement_timeout = '120s';
-- The preview branch lacks some grants production has; these are rolled back with everything else.
DO $g$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('is_tenant_admin','is_platform_owner','is_tenant_member','current_user_tenant_id') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP; END $g$;
-- The proof's own diagnostic reads of approvals go through a policy that reads clients; production grants this.
GRANT SELECT ON public.clients TO authenticated;

UPDATE public.profiles SET active_tenant_id = '22222222-2222-4222-8222-222222222222' WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.clients (tenant_id, created_by, first_name, last_name, email, tags, created_at) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','ChatProof','Tagged','chat.tagged@example.invalid', ARRAY['series-chat-proof'], now() - interval '1 day');
CREATE TEMP TABLE pf (n serial, k text, v text);
GRANT ALL ON pf TO authenticated; GRANT ALL ON SEQUENCE pf_n_seq TO authenticated;

SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $p1$
DECLARE
  t uuid := '22222222-2222-4222-8222-222222222222'; k uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  steps3 jsonb := '[{"delay_minutes":0,"subject":"Welcome","preheader":"Hi","body_html":"<p>1</p>"},
                    {"delay_minutes":2880,"subject":"Second","preheader":"","body_html":"<p>2</p>"},
                    {"delay_minutes":7200,"subject":"Third","body_html":"<p>3</p>"}]';
  r jsonb; sid uuid; vid uuid; v2 uuid; cp uuid;
BEGIN
r := public.read_email_series_links(t);
INSERT INTO pf(k,v) VALUES ('links', r::text);

r := public.email_series_draft(t, NULL, k, 'welcome', 'Chat welcome', NULL, NULL, NULL, false, 'booking', NULL, steps3);
sid := r->>'sequence_id'; vid := r->>'version_id';
INSERT INTO pf(k,v) VALUES ('create', r::text),
  ('create_steps', (SELECT string_agg(position||':'||delay_minutes||':'||subject||':'||preheader, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid)),
  ('create_rules', (SELECT entry_mode||' '||audience::text||' goal='||exit_on_goal FROM email_sequence_versions WHERE id = vid)),
  ('create_key', (SELECT (request_key = k)::text FROM email_sequences WHERE id = sid));
r := public.email_series_draft(t, NULL, k, 'welcome', 'Chat welcome', NULL, NULL, NULL, false, 'booking', NULL, steps3);
INSERT INTO pf(k,v) VALUES ('replay', r::text), ('series_count', (SELECT count(*)::text FROM email_sequences WHERE tenant_id = t AND name = 'Chat welcome'));

BEGIN PERFORM public.email_series_draft('33333333-3333-4333-8333-333333333333', NULL, gen_random_uuid(), 'welcome', 'x', NULL, NULL, NULL, false, NULL, NULL, steps3);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('other_business_refused', SQLERRM); END;
BEGIN PERFORM public.read_email_series('33333333-3333-4333-8333-333333333333', NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('other_business_read_refused', SQLERRM); END;
BEGIN PERFORM public.email_series_draft(t, NULL, NULL, 'welcome', 'x', NULL, NULL, NULL, false, NULL, NULL, steps3);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('no_key_refused', SQLERRM); END;
BEGIN PERFORM public.email_series_draft(t, sid, NULL, NULL, NULL, NULL, NULL, NULL, false, 'whenever', NULL, NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('goal_refused', SQLERRM); END;
BEGIN PERFORM public.email_series_draft(t, sid, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL, '[{"delay_minutes":-1,"subject":"a","body_html":"b"}]');
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('bad_wait_refused', SQLERRM); END;

-- Change: two emails (the third goes), anyone tagged, leave when they stop matching.
r := public.email_series_draft(t, sid, NULL, NULL, 'Chat welcome v2', 'matching', '{"tags":["series-chat-proof"]}', NULL, true, NULL, true,
  '[{"delay_minutes":0,"subject":"Welcome again","body_html":"<p>1b</p>"},{"delay_minutes":1440,"subject":"Second again","body_html":"<p>2b</p>"}]');
INSERT INTO pf(k,v) VALUES ('change', r::text),
  ('change_steps', (SELECT string_agg(position||':'||delay_minutes||':'||subject, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid)),
  ('change_rules', (SELECT entry_mode||' '||audience::text||' unmatched='||exit_when_unmatched FROM email_sequence_versions WHERE id = vid)),
  ('change_name', (SELECT name FROM email_sequences WHERE id = sid));

r := public.email_series_submit_for_approval(t, sid);
INSERT INTO pf(k,v) VALUES ('filed', r::text),
  ('filed_state', (SELECT v.state||' approval='||a.status||' source='||a.source FROM email_sequence_versions v JOIN paige_pending_approvals a ON a.id = v.approval_id WHERE v.id = vid));
r := public.email_series_submit_for_approval(t, sid);
INSERT INTO pf(k,v) VALUES ('filed_again', r::text), ('approvals_for_version', (SELECT count(*)::text FROM paige_pending_approvals WHERE metadata->>'email_sequence_version_id' = vid::text));
BEGIN PERFORM public.email_series_draft(t, sid, NULL, NULL, 'x', NULL, NULL, NULL, false, NULL, NULL, NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('change_while_waiting_refused', SQLERRM); END;
INSERT INTO pf(k,v) VALUES ('still_waiting', (SELECT a.status FROM email_sequence_versions v JOIN paige_pending_approvals a ON a.id = v.approval_id WHERE v.id = vid));

r := public.read_email_series(t, sid);
INSERT INTO pf(k,v) VALUES ('read_one', jsonb_build_object('state', r->'version'->>'state', 'emails', jsonb_array_length(r->'version'->'steps'), 'waiting_to_enter', r->'waiting_to_enter')::text);
r := public.read_email_series(t, NULL);
INSERT INTO pf(k,v) VALUES ('read_list', (SELECT count(*)::text FROM jsonb_array_elements(r->'sequences') x WHERE x->>'id' = sid::text));

-- A person approves (PAIGE has no path here); the series runs.
r := public.email_sequence_approve(vid);
INSERT INTO pf(k,v) VALUES ('approved_by_person', (SELECT status FROM email_sequences WHERE id = sid));
r := public.read_email_series(t, sid);
INSERT INTO pf(k,v) VALUES ('running_waiting_to_enter', COALESCE(r->>'waiting_to_enter', 'null'));
PERFORM public.email_sequence_pause(sid);
r := public.read_email_sequence(sid);
INSERT INTO pf(k,v) VALUES ('paused_waiting_to_enter', COALESCE(r->>'waiting_to_enter', 'null'));
PERFORM public.email_sequence_resume(sid);

-- Changing a running series makes a new draft; what runs keeps running.
r := public.email_series_draft(t, sid, NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, NULL,
  '[{"delay_minutes":0,"subject":"Welcome v3","body_html":"<p>1c</p>"},{"delay_minutes":1440,"subject":"Second again","body_html":"<p>2b</p>"}]');
v2 := r->>'version_id';
INSERT INTO pf(k,v) VALUES ('change_running', r::text),
  ('running_after_change', (SELECT s.status||' live='||(s.live_version_id = vid)||' current_is_new='||(s.current_version_id = v2) FROM email_sequences s WHERE s.id = sid)),
  ('live_subject_unchanged', (SELECT subject FROM email_sequence_steps WHERE version_id = vid AND position = 1));

-- Stop is final; a copy replaces it.
PERFORM public.email_sequence_stop(sid);
BEGIN PERFORM public.email_series_draft(t, sid, NULL, NULL, 'x', NULL, NULL, NULL, false, NULL, NULL, NULL);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('stopped_change_refused', SQLERRM); END;
BEGIN PERFORM public.email_series_submit_for_approval(t, sid);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('stopped_file_refused', SQLERRM); END;
r := public.read_email_sequence(sid);
INSERT INTO pf(k,v) VALUES ('stopped_waiting_to_enter', COALESCE(r->>'waiting_to_enter', 'null'));
r := public.email_sequence_duplicate(sid);
cp := r->>'sequence_id';
INSERT INTO pf(k,v) VALUES ('copy', (SELECT s.name||' '||s.status||' kind='||s.kind||' live='||COALESCE(s.live_version_id::text,'none') FROM email_sequences s WHERE s.id = cp)),
  ('copy_steps', (SELECT string_agg(st.position||':'||st.subject, ',' ORDER BY st.position) FROM email_sequence_steps st JOIN email_sequences s ON s.current_version_id = st.version_id WHERE s.id = cp)),
  ('copy_people', (SELECT count(*)::text FROM email_sequence_enrollments WHERE sequence_id = cp));

INSERT INTO pf(k,v) VALUES ('autonomy', (SELECT string_agg(tool_key||'='||mode, ',' ORDER BY tool_key) FROM public.list_tool_autonomy(NULL) WHERE tool_key LIKE 'email_series%' OR tool_key LIKE 'email_campaign%'));
END $p1$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $p2$ DECLARE out text; BEGIN
INSERT INTO pf(k,v) VALUES ('activity_draft', public._workspace_event_display('capability_run','capability_succeeded','email_series_draft')::text),
  ('activity_file', public._workspace_event_display('capability_run','capability_succeeded','email_series_request_approval')->>'title'),
  ('activity_campaign_kept', public._workspace_event_display('capability_run','capability_succeeded','email_campaign_draft')->>'title');
SELECT string_agg(n||' '||k||' = '||COALESCE(v,'∅'), E'\n' ORDER BY n) INTO out FROM pf;
RAISE EXCEPTION 'PROOF%', E'\n' || out;
END $p2$;
