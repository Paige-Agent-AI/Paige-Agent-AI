-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Email series (E3) — rollback proof of every series path, for 20270570000000.
--
-- HOW TO RUN: on a preview branch seeded by scripts/sql/email-series-preview-seed.sql, run the whole
-- file as one statement batch (it is one transaction). It ends with RAISE EXCEPTION 'PROOF …' carrying
-- every result, so nothing persists. Proves the SQL runs and the properties hold on that database;
-- proves nothing about production (that is the post-merge persisted-apply check, §32.a).
-- If the preview lacks grants production has, the failure names the function; grant it inside the
-- transaction (see the isolation proof), never outside it.
-- Not run by CI: the email stack has no bare-Postgres harness (the calendar seam's pattern) yet.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SET LOCAL statement_timeout = '120s';
-- The preview branch lacks some grants production has; these are rolled back with everything else.
DO $g$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('is_tenant_admin','is_platform_owner','is_tenant_member','current_user_tenant_id') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP; END $g$;

-- ════════════ PROOF (everything below and above is rolled back by the final RAISE) ════════════
UPDATE public.profiles SET active_tenant_id = '22222222-2222-4222-8222-222222222222' WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.clients (tenant_id, created_by, first_name, last_name, email, created_at) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','SeriesProof','Alpha','series.alpha@example.invalid', now() - interval '1 day'),
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','SeriesProof','Beta','series.beta@example.invalid', now() - interval '1 day');
CREATE TEMP TABLE pf (n serial, k text, v text);
GRANT ALL ON pf TO authenticated; GRANT ALL ON SEQUENCE pf_n_seq TO authenticated;

SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $p1$
DECLARE r jsonb; sid uuid; vid uuid; err text; n int; stepcamp uuid;
BEGIN
r := public.email_sequence_create('nurture', 'Proof nurture'); sid := r->>'sequence_id'; vid := r->>'version_id';
INSERT INTO pf(k,v) VALUES ('create', r::text), ('starter_steps', (SELECT string_agg(position||':'||delay_minutes, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid));
BEGIN PERFORM public.email_sequence_request_approval(sid); EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('file_empty_refused', SQLERRM||' / '||COALESCE(NULLIF(PG_EXCEPTION_DETAIL,''),'')); END;
FOR i IN 1..4 LOOP PERFORM public.email_sequence_step_save(sid, i, NULL, 'Proof email '||i, 'Preview '||i, '<p>Hello '||i||'</p>'); END LOOP;
PERFORM public.email_sequence_step_save(sid, NULL, 60, 'Fifth', '', '<p>5</p>');
INSERT INTO pf(k,v) VALUES ('after_append', (SELECT string_agg(position||':'||subject, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid));
PERFORM public.email_sequence_step_move(sid, 5, 1);
INSERT INTO pf(k,v) VALUES ('after_move_5_to_1', (SELECT string_agg(position||':'||subject, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid));
PERFORM public.email_sequence_step_delete(sid, 1);
PERFORM public.email_sequence_step_delete(sid, 4);
INSERT INTO pf(k,v) VALUES ('after_deletes', (SELECT string_agg(position||':'||subject||'@'||delay_minutes, ',' ORDER BY position) FROM email_sequence_steps WHERE version_id = vid));
PERFORM public.email_sequence_update_draft(sid, NULL, 'matching', '{"tags":["series-proof"]}'::jsonb, NULL, false, 'booking', true, NULL);
-- 0 match now (no contact has that tag yet)
r := public.email_sequence_request_approval(sid);
INSERT INTO pf(k,v) VALUES ('filed', r::text);
BEGIN PERFORM public.email_sequence_step_save(sid, 1, NULL, 'Changed'); EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('edit_locked_refused', SQLERRM); END;
BEGIN UPDATE public.paige_pending_approvals SET status='approved' WHERE id = (r->>'approval_id')::uuid;
GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO pf(k,v) VALUES ('generic_approve_rows', n::text);
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('generic_approve_refused', SQLERRM); END;
r := public.email_sequence_approve(vid);
INSERT INTO pf(k,v) VALUES ('approved', r::text);
SELECT id INTO stepcamp FROM public.email_campaigns WHERE sequence_id = sid AND sequence_position = 1;
INSERT INTO pf(k,v) VALUES ('rls_hides_step_campaigns', (SELECT count(*)::text FROM public.email_campaigns WHERE sequence_id IS NOT NULL));
INSERT INTO pf(k,v) VALUES ('sid', sid::text), ('vid', vid::text);
BEGIN PERFORM public.email_campaign_cancel((SELECT c.id FROM public.email_campaigns c WHERE false)); EXCEPTION WHEN OTHERS THEN NULL; END;
END $p1$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $p2$
DECLARE sid uuid := (SELECT v FROM pf WHERE k='sid')::uuid; r jsonb; camp uuid; a uuid; b uuid; ra uuid;
BEGIN
-- the guard, as a signed-in caller on a series' own campaign
camp := (SELECT id FROM public.email_campaigns WHERE sequence_id = sid AND sequence_position = 1);
INSERT INTO pf(k,v) VALUES ('step_campaigns', (SELECT string_agg(sequence_position||':'||status||':'||kind||':'||name, ' | ' ORDER BY sequence_position) FROM public.email_campaigns WHERE sequence_id = sid));
INSERT INTO pf(k,v) VALUES ('step_versions', (SELECT string_agg(c.sequence_position||':'||v.state||':'||v.subject||':'||(v.sender_snapshot->>'from_address'), ' | ' ORDER BY c.sequence_position) FROM public.email_campaigns c JOIN public.email_campaign_versions v ON v.id = c.current_version_id WHERE c.sequence_id = sid));
-- tag the two proof contacts so they match
UPDATE public.clients SET tags = ARRAY['series-proof'] WHERE email IN ('series.alpha@example.invalid','series.beta@example.invalid') AND tenant_id = '22222222-2222-4222-8222-222222222222';
r := public.email_sequence_tick(200); INSERT INTO pf(k,v) VALUES ('tick1', r::text);
INSERT INTO pf(k,v) VALUES ('enrolled', (SELECT string_agg(email||':'||status||':'||position, ', ' ORDER BY email) FROM public.email_sequence_enrollments WHERE sequence_id = sid));
INSERT INTO pf(k,v) VALUES ('planned', (SELECT string_agg(r.email||':'||r.status||':nb='||COALESCE(r.not_before::text,'null'), ', ' ORDER BY r.email) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id WHERE c.sequence_id = sid));
-- the dispatcher claims a series email like any campaign
r := public.email_campaign_dispatch_claim(5);
INSERT INTO pf(k,v) VALUES ('claim', jsonb_build_object('campaign', r->'campaign'->>'name', 'subject', r->'content'->>'subject', 'recipients', jsonb_array_length(COALESCE(r->'recipients','[]')), 'blocked', r->>'blocked', 'waiting', r->>'waiting')::text);
-- simulate: Alpha's first email sent 3 days ago; Beta's skipped (opted out)
UPDATE public.email_campaign_recipients SET status='sent', sent_at = now() - interval '3 days', lease_until = NULL
WHERE email='series.alpha@example.invalid' AND campaign_id = camp;
UPDATE public.email_campaign_recipients SET status='skipped', skip_reason='opted_out', lease_until = NULL
WHERE email='series.beta@example.invalid' AND campaign_id = camp;
r := public.email_campaign_dispatch_settle(camp); INSERT INTO pf(k,v) VALUES ('settle_series_step', r::text);
r := public.email_sequence_tick(200); INSERT INTO pf(k,v) VALUES ('tick2', r::text);
INSERT INTO pf(k,v) VALUES ('after_tick2', (SELECT string_agg(e.email||':'||e.status||':'||COALESCE(e.exit_reason,'-')||':pos'||e.position, ', ' ORDER BY e.email) FROM public.email_sequence_enrollments e WHERE e.sequence_id = sid AND e.email LIKE 'series.%'));
INSERT INTO pf(k,v) VALUES ('alpha_step2', (SELECT string_agg(c.sequence_position||':'||r.status||':nb='||COALESCE(r.not_before::text,'null'), ', ') FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id WHERE c.sequence_id = sid AND r.email='series.alpha@example.invalid' AND c.sequence_position=2));
-- Alpha's 2nd sent now → 3rd waits its delay (step 3 delay)
UPDATE public.email_campaign_recipients r SET status='sent', sent_at = now() FROM public.email_campaigns c
WHERE c.id = r.campaign_id AND c.sequence_id = sid AND c.sequence_position = 2 AND r.email='series.alpha@example.invalid';
r := public.email_sequence_tick(200);
INSERT INTO pf(k,v) VALUES ('alpha_step3', (SELECT string_agg(c.sequence_position||':'||r.status||':waits_h='||round(extract(epoch from (r.not_before-now()))/3600)::text, ', ') FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id WHERE c.sequence_id = sid AND r.email='series.alpha@example.invalid' AND c.sequence_position=3));
END $p2$;
SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $p3$
DECLARE sid uuid := (SELECT v FROM pf WHERE k='sid')::uuid; r jsonb; nv uuid; camp uuid; x jsonb;
BEGIN
BEGIN PERFORM public.email_campaign_cancel((SELECT c.id FROM public.email_campaigns c WHERE false)); EXCEPTION WHEN OTHERS THEN NULL; END;
BEGIN PERFORM public.read_email_campaign('00000000-0000-0000-0000-000000000000'); EXCEPTION WHEN OTHERS THEN NULL; END;
-- edit while running: new draft, running version keeps sending
nv := public.email_sequence_edit(sid);
PERFORM public.email_sequence_step_save(sid, 3, 120, 'Proof email 3 (new)');
r := public.email_sequence_request_approval(sid); INSERT INTO pf(k,v) VALUES ('edit_filed', r::text);
INSERT INTO pf(k,v) VALUES ('status_while_edit_waits', (SELECT status FROM public.email_sequences WHERE id = sid));
r := public.email_sequence_approve(nv); INSERT INTO pf(k,v) VALUES ('edit_approved', r::text);
x := public.read_email_sequence(sid);
INSERT INTO pf(k,v) VALUES ('read_one', jsonb_build_object('status', x->'sequence'->>'status', 'version_state', x->'version'->>'state',
'steps', jsonb_array_length(x->'version'->'steps'), 'entry_preview', x->'entry_preview', 'people', x->'people'->'in_now',
'left_because', x->'people'->'left_because', 'emails', x->'emails')::text);
INSERT INTO pf(k,v) VALUES ('read_list', (public.read_email_sequences())::text);
INSERT INTO pf(k,v) VALUES ('dashboard_campaign_count_excludes_steps', (public.read_email_marketing_dashboard(30,'UTC')->>'campaign_count'));
END $p3$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $p4$
DECLARE sid uuid := (SELECT v FROM pf WHERE k='sid')::uuid; r jsonb;
BEGIN
INSERT INTO pf(k,v) VALUES ('alpha_step3_after_edit_before_tick', (SELECT string_agg(r.status||':'||v.subject, ', ' ORDER BY r.created_at) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id JOIN public.email_campaign_versions v ON v.id = r.version_id WHERE c.sequence_id = sid AND r.email='series.alpha@example.invalid' AND c.sequence_position=3));
r := public.email_sequence_tick(200);
INSERT INTO pf(k,v) VALUES ('alpha_step3_after_tick', (SELECT string_agg(r.status||':'||v.subject||':waits_h='||COALESCE(round(extract(epoch from (r.not_before-now()))/3600)::text,'now'), ', ' ORDER BY r.created_at) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id JOIN public.email_campaign_versions v ON v.id = r.version_id WHERE c.sequence_id = sid AND r.email='series.alpha@example.invalid' AND c.sequence_position=3));
END $p4$;
SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $p5$
DECLARE sid uuid := (SELECT v FROM pf WHERE k='sid')::uuid; r jsonb; s2 uuid; v2 uuid; camp uuid;
BEGIN
camp := (SELECT id FROM public.email_campaigns c WHERE false);
-- the guard: campaign functions refuse a series' own campaign
BEGIN
PERFORM set_config('paige.email_sequence_write', '', true);
UPDATE public.email_campaigns SET name = 'x' WHERE sequence_id = sid; -- RLS hides them: 0 rows
INSERT INTO pf(k,v) VALUES ('direct_update_rows', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('direct_update', SQLERRM); END;
r := public.email_sequence_pause(sid); INSERT INTO pf(k,v) VALUES ('pause', r::text);
INSERT INTO pf(k,v) VALUES ('paused_steps', (SELECT v FROM pf WHERE false));
r := public.email_sequence_resume(sid); INSERT INTO pf(k,v) VALUES ('resume', r::text);
r := public.email_sequence_stop(sid); INSERT INTO pf(k,v) VALUES ('stop', r::text);
BEGIN PERFORM public.email_sequence_resume(sid); EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('resume_stopped_refused', SQLERRM); END;
-- decline path + delete a never-started series
r := public.email_sequence_create('welcome', 'Proof welcome'); s2 := r->>'sequence_id'; v2 := r->>'version_id';
INSERT INTO pf(k,v) VALUES ('welcome_defaults', (SELECT entry_mode||':'||audience::text||':unmatched='||exit_when_unmatched FROM email_sequence_versions WHERE id = v2));
FOR i IN 1..3 LOOP PERFORM public.email_sequence_step_save(s2, i, NULL, 'Welcome '||i, '', '<p>W'||i||'</p>'); END LOOP;
r := public.email_sequence_request_approval(s2); INSERT INTO pf(k,v) VALUES ('welcome_filed', r::text);
PERFORM public.email_sequence_decline(v2, 'Not yet');
INSERT INTO pf(k,v) VALUES ('after_decline', (SELECT s.status||':current_v'||v.version_no||':'||v.state||':steps='||(SELECT count(*) FROM email_sequence_steps st WHERE st.version_id=v.id) FROM email_sequences s JOIN email_sequence_versions v ON v.id = s.current_version_id WHERE s.id = s2));
r := public.email_sequence_request_approval(s2);
PERFORM public.email_sequence_approve((r->>'version_id')::uuid);
INSERT INTO pf(k,v) VALUES ('s2', s2::text);
r := public.email_sequence_create('custom', 'Proof throwaway');
PERFORM public.email_sequence_delete((r->>'sequence_id')::uuid);
INSERT INTO pf(k,v) VALUES ('deleted_never_started', (SELECT count(*)::text FROM email_sequences WHERE id = (r->>'sequence_id')::uuid));
BEGIN PERFORM public.email_sequence_delete(sid); EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('delete_ran_refused', SQLERRM); END;
END $p5$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $p6$
DECLARE sid uuid := (SELECT v FROM pf WHERE k='sid')::uuid; s2 uuid := (SELECT v FROM pf WHERE k='s2')::uuid; r jsonb; out text;
BEGIN
INSERT INTO pf(k,v) VALUES ('stopped_state', (SELECT string_agg(e.email||':'||e.status||':'||COALESCE(e.exit_reason,'-'), ', ' ORDER BY e.email) FROM public.email_sequence_enrollments e WHERE e.sequence_id = sid AND e.email LIKE 'series.%'));
INSERT INTO pf(k,v) VALUES ('stopped_campaigns', (SELECT string_agg(c.sequence_position||':'||c.status||':'||v.state, ' | ' ORDER BY c.sequence_position) FROM public.email_campaigns c JOIN public.email_campaign_versions v ON v.id=c.current_version_id WHERE c.sequence_id = sid));
INSERT INTO pf(k,v) VALUES ('stopped_planned_left', (SELECT count(*)::text FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id=r.campaign_id WHERE c.sequence_id = sid AND r.status='planned'));
-- welcome (new contacts only): existing contacts do not enter; one created after it started does
r := public.email_sequence_tick(200);
INSERT INTO pf(k,v) VALUES ('welcome_before_new', (SELECT count(*)::text FROM public.email_sequence_enrollments WHERE sequence_id = s2));
INSERT INTO public.clients (tenant_id, created_by, first_name, last_name, email) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','SeriesProof','Gamma','series.gamma@example.invalid');
UPDATE public.email_sequences SET checked_at = NULL, activated_at = now() - interval '1 second' WHERE id = s2;
r := public.email_sequence_tick(200);
INSERT INTO pf(k,v) VALUES ('welcome_after_new', (SELECT string_agg(email||':'||status||':pos'||position, ', ') FROM public.email_sequence_enrollments WHERE sequence_id = s2));
SELECT string_agg(n||' '||k||' = '||COALESCE(v,'∅'), E'\n' ORDER BY n) INTO out FROM pf;
RAISE EXCEPTION 'PROOF%', E'\n' || out;
END $p6$;
