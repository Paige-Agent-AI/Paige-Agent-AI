-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Email series (E3) — rollback proof of the review fixes, for 20270570000000.
--
-- HOW TO RUN: as scripts/sql/email-series-proof.sql (preview branch seeded by
-- scripts/sql/email-series-preview-seed.sql; one transaction ending in RAISE EXCEPTION 'PROOF …').
-- PREVIEW ONLY: it disables the version freeze trigger inside the transaction to plant a rule the
-- tick cannot run, which is the only way to reach that state now that saving refuses it.
-- Proves: (1) rules the tick could not run are refused when saved; (2) one series whose rule raises
-- is marked series_error and every other series still runs that minute; (3) an email already leased
-- to someone who has since left the series is cancelled before the provider; (4) a segment can be
-- deleted under an approved series, which keeps the rule it was filed with.
-- Result on the PR's preview, 2026-10-05: all four held (5/5 bad rules refused; tick blocked 1 series,
-- planned 4 for the healthy ones; removed person false/cancelled, active person true/sending).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
SET LOCAL statement_timeout = '120s';
-- The preview branch lacks some grants production has; these are rolled back with everything else.
DO $g$ DECLARE f regprocedure; BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('is_tenant_admin','is_platform_owner','is_tenant_member','current_user_tenant_id') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP; END $g$;
UPDATE public.profiles SET active_tenant_id = '22222222-2222-4222-8222-222222222222' WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.clients (tenant_id, created_by, first_name, last_name, email, tags, created_at) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','FixProof','Alpha','fix.alpha@example.invalid', ARRAY['fix-proof'], now() - interval '1 day'),
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','FixProof','Beta','fix.beta@example.invalid', ARRAY['fix-proof'], now() - interval '1 day');
CREATE TEMP TABLE pf (n serial, k text, v text);
GRANT ALL ON pf TO authenticated; GRANT ALL ON SEQUENCE pf_n_seq TO authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $p1$
DECLARE r jsonb; s1 uuid; v1 uuid; s2 uuid; v2 uuid; s3 uuid; v3 uuid; seg uuid; bad text;
BEGIN
  r := public.email_sequence_create('welcome', 'Fix proof broken'); s1 := r->>'sequence_id'; v1 := r->>'version_id';
  FOREACH bad IN ARRAY ARRAY['{"inactive_days":1.5}','{"inactive_days":100000000}','{"stages":"lead"}','{"bogus":[]}','{"tags":[1]}'] LOOP
    BEGIN PERFORM public.email_sequence_update_draft(s1, NULL, NULL, bad::jsonb);
      INSERT INTO pf(k,v) VALUES ('rule_accepted_WRONG', bad);
    EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('rule_refused '||bad, SQLERRM); END;
  END LOOP;
  PERFORM public.email_sequence_update_draft(s1, NULL, 'matching', '{"tags":["fix-proof"],"inactive_days":90}'::jsonb);
  INSERT INTO pf(k,v) VALUES ('valid_rule_saved', (SELECT audience::text FROM email_sequence_versions WHERE id = v1));
  PERFORM public.email_sequence_update_draft(s1, NULL, 'matching', '{"tags":["fix-proof"]}'::jsonb);
  FOR i IN 1..3 LOOP PERFORM public.email_sequence_step_save(s1, i, NULL, 'Broken '||i, 'p', '<p>b'||i||'</p>'); END LOOP;
  PERFORM public.email_sequence_request_approval(s1); PERFORM public.email_sequence_approve(v1);

  r := public.email_sequence_create('custom', 'Fix proof healthy'); s2 := r->>'sequence_id'; v2 := r->>'version_id';
  PERFORM public.email_sequence_update_draft(s2, NULL, 'matching', '{"tags":["fix-proof"]}'::jsonb);
  PERFORM public.email_sequence_step_save(s2, 1, NULL, 'Healthy 1', 'p', '<p>h1</p>');
  PERFORM public.email_sequence_request_approval(s2); PERFORM public.email_sequence_approve(v2);

  seg := public.email_segment_save(NULL, 'Fix proof segment', '{"tags":["fix-proof"]}'::jsonb);
  r := public.email_sequence_create('custom', 'Fix proof segment series'); s3 := r->>'sequence_id'; v3 := r->>'version_id';
  PERFORM public.email_sequence_update_draft(s3, NULL, 'matching', NULL, seg);
  PERFORM public.email_sequence_step_save(s3, 1, NULL, 'Seg 1', 'p', '<p>s1</p>');
  PERFORM public.email_sequence_request_approval(s3); PERFORM public.email_sequence_approve(v3);
  BEGIN PERFORM public.email_segment_delete(seg);
    INSERT INTO pf(k,v) VALUES ('segment_deleted_under_approved_series', (SELECT coalesce(segment_id::text,'segment_id null')||' / audience '||audience::text FROM email_sequence_versions WHERE id = v3));
  EXCEPTION WHEN OTHERS THEN INSERT INTO pf(k,v) VALUES ('segment_delete_refused_WRONG', SQLERRM); END;
  INSERT INTO pf(k,v) VALUES ('s1', s1::text), ('s2', s2::text), ('v1', v1::text);
END $p1$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $p2$
DECLARE s1 uuid := (SELECT v FROM pf WHERE k='s1')::uuid; s2 uuid := (SELECT v FROM pf WHERE k='s2')::uuid; v1 uuid := (SELECT v FROM pf WHERE k='v1')::uuid;
  r jsonb; ra uuid; rb uuid; out text; ok boolean;
BEGIN
  ALTER TABLE public.email_sequence_versions DISABLE TRIGGER email_sequence_version_frozen;
  UPDATE public.email_sequence_versions SET audience = '{"inactive_days":1.5}'::jsonb WHERE id = v1;
  ALTER TABLE public.email_sequence_versions ENABLE TRIGGER email_sequence_version_frozen;
  r := public.email_sequence_tick(200); INSERT INTO pf(k,v) VALUES ('tick_with_one_broken_series', r::text);
  INSERT INTO pf(k,v) VALUES ('broken_series', (SELECT status||'/'||coalesce(blocked_reason,'') FROM email_sequences WHERE id = s1)),
    ('broken_step_campaigns', (SELECT string_agg(status||'/'||coalesce(blocked_reason,''), ', ') FROM email_campaigns WHERE sequence_id = s1)),
    ('healthy_series', (SELECT status FROM email_sequences WHERE id = s2)),
    ('healthy_enrolled_planned', (SELECT string_agg(en.email||':'||en.status||':'||r.status, ', ' ORDER BY en.email) FROM email_sequence_enrollments en JOIN email_campaign_recipients r ON r.enrollment_id = en.id WHERE en.sequence_id = s2));
  SELECT r.id INTO ra FROM email_campaign_recipients r JOIN email_sequence_enrollments en ON en.id = r.enrollment_id WHERE en.sequence_id = s2 AND en.email = 'fix.alpha@example.invalid';
  SELECT r.id INTO rb FROM email_campaign_recipients r JOIN email_sequence_enrollments en ON en.id = r.enrollment_id WHERE en.sequence_id = s2 AND en.email = 'fix.beta@example.invalid';
  UPDATE email_campaign_recipients SET status = 'sending', lease_until = now() + interval '10 minutes' WHERE id IN (ra, rb);
  UPDATE email_sequence_enrollments SET status = 'exited', exit_reason = 'removed', finished_at = now() WHERE id = (SELECT enrollment_id FROM email_campaign_recipients WHERE id = ra);
  ok := public.email_campaign_dispatch_begin(ra); INSERT INTO pf(k,v) VALUES ('begin_removed_person', ok::text||' / '||(SELECT status FROM email_campaign_recipients WHERE id = ra));
  ok := public.email_campaign_dispatch_begin(rb); INSERT INTO pf(k,v) VALUES ('begin_active_person', ok::text||' / '||(SELECT status FROM email_campaign_recipients WHERE id = rb));
  SELECT string_agg(n||' '||k||' = '||COALESCE(v,'∅'), E'\n' ORDER BY n) INTO out FROM pf;
  RAISE EXCEPTION 'PROOF%', E'\n' || out;
END $p2$;
