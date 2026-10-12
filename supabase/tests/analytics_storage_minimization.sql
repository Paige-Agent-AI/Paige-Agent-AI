-- Synthetic fixtures only. Run after migrations in an isolated proof database.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;

-- Historical proof setup seeds these synthetic IDs BEFORE applying migration 03.
-- Normal suite runs need no historical fixture; the dedicated proof run must seed both.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.analytics_events WHERE id='20000000-0000-0000-0000-000000000001') THEN
    PERFORM pg_temp.assert_true((SELECT user_id='20000000-0000-0000-0000-000000000002' AND session_id='20000000-0000-0000-0000-000000000003' AND event_name='page_view' AND event_category='engagement' AND created_at='2026-01-01T00:00:00Z' AND page_path='/new/<redacted>/done' AND NOT properties ? 'query' AND properties @> '{"lender_name":"Test Lender","amount_cents":12345,"currency":"USD","tier":"solo"}' AND properties#>>'{nested,value}'='/join/<redacted>' FROM public.analytics_events WHERE id='20000000-0000-0000-0000-000000000001'), 'historical analytics minimized, identity/time/metrics preserved');
    PERFORM pg_temp.assert_true((SELECT affiliate_id='20000000-0000-0000-0000-000000000002' AND clicked_at='2026-01-02T00:00:00Z' AND referral_code='test-referral' AND ip_hash=repeat('ab',32) AND landing_path='/join/<redacted>' AND utm_campaign='black_friday_2026_launch' FROM public.referral_clicks WHERE id=900001), 'historical referral minimized, identity/time/hash/attribution preserved');
  END IF;
END $$;

-- Repeat the migration's historical assignments: already minimized rows must be
-- byte-for-byte unchanged, and no rows may be deleted or newly counted.
CREATE TEMP TABLE privacy_replay_events AS SELECT id,to_jsonb(e) AS row_value FROM public.analytics_events e;
CREATE TEMP TABLE privacy_replay_clicks AS SELECT id,to_jsonb(c) AS row_value FROM public.referral_clicks c;
UPDATE public.analytics_events SET properties=properties;
UPDATE public.referral_clicks SET landing_path=landing_path;
SELECT pg_temp.assert_true(NOT EXISTS ((SELECT id,row_value FROM privacy_replay_events EXCEPT SELECT id,to_jsonb(e) FROM public.analytics_events e) UNION ALL (SELECT id,to_jsonb(e) FROM public.analytics_events e EXCEPT SELECT id,row_value FROM privacy_replay_events)), 'historical analytics replay preserves complete rows/count');
SELECT pg_temp.assert_true(NOT EXISTS ((SELECT id,row_value FROM privacy_replay_clicks EXCEPT SELECT id,to_jsonb(c) FROM public.referral_clicks c) UNION ALL (SELECT id,to_jsonb(c) FROM public.referral_clicks c EXCEPT SELECT id,row_value FROM privacy_replay_clicks)), 'historical referral replay preserves complete rows/count');

SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','analytics_privacy.minimize_text(text,boolean)','EXECUTE'), 'no public sanitizer API');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role','analytics_privacy.minimize_row()','EXECUTE'), 'service role has no helper authority');

-- Exercise direct SQL and service-role writers against the actual table triggers.
DO $$
DECLARE writer text; row_id uuid; click_id bigint; event_row public.analytics_events; click_row public.referral_clicks; probe text;
BEGIN
  FOREACH writer IN ARRAY ARRAY['postgres','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',writer);
    FOREACH probe IN ARRAY ARRAY[
      '/brand-new-flow/AAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBB',
      '/brand-new-flow/AAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBB/done',
      '/brand-new-flow/aaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb/done',
      '/brand-new-flow/AAAAAAAAAAAAAAA%2FBBBBBBBBBBBBBBBB/done',
      '/new/aaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb',
      '/new/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
      '/new/abcdefabcdefabcdefabcdefabcdefab',
      '/%6aoin/short-secret',
      'https://short-secret@example.test/join/short-secret',
      '/return?next=https%3A%2F%2Fexample.test%2Fjoin%2Fshort-secret',
      'prose token=short-secret',
      'prose ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef suffix'
    ] LOOP
      INSERT INTO public.analytics_events(event_name,event_category,page_path,referrer,utm_source,utm_medium,utm_campaign,referral_code,device_type,properties)
      VALUES ('test_privacy_event','system',probe,probe,probe,probe,probe,probe,probe,
        jsonb_build_object('nested',jsonb_build_array(jsonb_build_object('value',probe)), 'query','private prose','question','private prose','top_titles',jsonb_build_array('private prose'), 'lender_name','Test Lender','amount_cents',12345,'currency','USD','tier','solo'))
      RETURNING id INTO row_id;
      -- Verify the stored result as the direct proof actor (service role may not read).
      RESET ROLE;
      SELECT * INTO event_row FROM public.analytics_events WHERE id=row_id;
      PERFORM pg_temp.assert_true(event_row.page_path <> probe,writer || ' INSERT removes credential class');
      PERFORM pg_temp.assert_true(event_row::text !~ '(AAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBB|aaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef|abcdefabcdefabcdefabcdefabcdefab|short-secret)',writer || ' no credential or split fragment survives');
      PERFORM pg_temp.assert_true(event_row.referrer=event_row.page_path AND event_row.utm_campaign=event_row.page_path AND event_row.device_type=event_row.page_path,writer || ' covers textual sinks');
      PERFORM pg_temp.assert_true(event_row.properties #>> '{nested,0,value}' = event_row.page_path,writer || ' covers nested properties');
      PERFORM pg_temp.assert_true(NOT event_row.properties ?| ARRAY['query','question','top_titles'],writer || ' drops raw prose fields');
      PERFORM pg_temp.assert_true(event_row.properties @> '{"lender_name":"Test Lender","amount_cents":12345,"currency":"USD","tier":"solo"}'::jsonb,writer || ' preserves metrics/categories/lender name');
      EXECUTE format('SET LOCAL ROLE %I',writer);
      UPDATE public.analytics_events SET page_path=probe,referrer=probe,properties=jsonb_build_object('nested',jsonb_build_array(probe)) WHERE id=row_id;
      RESET ROLE;
      SELECT * INTO event_row FROM public.analytics_events WHERE id=row_id;
      PERFORM pg_temp.assert_true(event_row::text !~ '(AAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBB|aaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef|abcdefabcdefabcdefabcdefabcdefab|short-secret)',writer || ' UPDATE has no credential or split fragment');
      EXECUTE format('SET LOCAL ROLE %I',writer);
      UPDATE public.analytics_events SET page_path='/join/update-secret',properties='{"question":"private prose","value":"/join/update-secret"}' WHERE id=row_id;
      INSERT INTO public.referral_clicks(referral_code,user_agent,landing_path,utm_source,utm_medium,utm_campaign,country)
      VALUES ('test-referral',probe,probe,probe,probe,probe,probe) RETURNING id INTO click_id;
      RESET ROLE;
      SELECT * INTO event_row FROM public.analytics_events WHERE id=row_id;
      PERFORM pg_temp.assert_true(event_row.page_path='/join/<redacted>' AND event_row.properties->>'value'='/join/<redacted>',writer || ' UPDATE analytics enforced');
      SELECT * INTO click_row FROM public.referral_clicks WHERE id=click_id;
      PERFORM pg_temp.assert_true(click_row.landing_path <> probe AND click_row.user_agent=click_row.landing_path AND click_row.country=click_row.landing_path,writer || ' referral INSERT enforced');
      PERFORM pg_temp.assert_true(click_row::text !~ '(AAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBB|aaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef|abcdefabcdefabcdefabcdefabcdefab|short-secret)',writer || ' referral INSERT has no credential or split fragment');
      EXECUTE format('SET LOCAL ROLE %I',writer);
      UPDATE public.referral_clicks SET landing_path=probe,user_agent=probe WHERE id=click_id;
      RESET ROLE;
      SELECT * INTO click_row FROM public.referral_clicks WHERE id=click_id;
      PERFORM pg_temp.assert_true(click_row::text !~ '(AAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBB|aaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef|abcdefabcdefabcdefabcdefabcdefab|short-secret)',writer || ' referral UPDATE has no credential or split fragment');
      EXECUTE format('SET LOCAL ROLE %I',writer);
      UPDATE public.referral_clicks SET landing_path='/u/update-secret' WHERE id=click_id;
      RESET ROLE;
      PERFORM pg_temp.assert_true((SELECT landing_path='/u/<redacted>' FROM public.referral_clicks WHERE id=click_id),writer || ' referral UPDATE enforced');
      EXECUTE format('SET LOCAL ROLE %I',writer);
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;

SET LOCAL ROLE authenticated;
INSERT INTO public.analytics_events(id,event_name,event_category,page_path,session_id,properties)
VALUES ('10000000-0000-0000-0000-000000000003','test_privacy_event','system','/join/authenticated-secret','ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef','{"nested":{"value":"/join/authenticated-secret"}}');
RESET ROLE;
SELECT pg_temp.assert_true(page_path='/join/<redacted>' AND session_id='<redacted>' AND properties#>>'{nested,value}'='/join/<redacted>', 'authenticated direct INSERT passes existing own/null-user policy and minimizes') FROM public.analytics_events WHERE id='10000000-0000-0000-0000-000000000003';

DO $$
DECLARE route text;
BEGIN
  FOREACH route IN ARRAY ARRAY['/solo/3855/growth/sales','/solo/3855/settings/connections','/solo/3855/settings/calendar','/clients/people','/broker/app/sessions','/broker/app/commissions','/choose-account','/onboarding/agreement','/solo/3855/growth/performance'] LOOP
    PERFORM pg_temp.assert_true(analytics_privacy.minimize_text(route)=route,'ordinary route preserved: ' || route);
  END LOOP;
END $$;
SELECT pg_temp.assert_true(analytics_privacy.minimize_text('https://example.test/join/short-secret?next=detail')='https://example.test/join/<redacted>', 'URL tail secret does not survive');
SELECT pg_temp.assert_true(analytics_privacy.minimize_text('%252Fjoin%252Fshort-secret')='/join/<redacted>', 'repeated percent decoding');
SELECT pg_temp.assert_true(analytics_privacy.minimize_text('/new/AAAAAAAAAAAAAAA%2FBBBBBBBBBBBBBBBB')='/new/<redacted>', 'encoded split mint');
SELECT pg_temp.assert_true(analytics_privacy.minimize_text(repeat('ab',32),true)=repeat('ab',32) AND analytics_privacy.minimize_text('/join/short-secret',true)='<redacted>', 'ip digest is narrowly preserved, raw input rejected');

INSERT INTO public.analytics_events(id,user_id,session_id,event_name,event_category,page_path,utm_campaign,properties,created_at)
VALUES ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','session-test', 'page_view','engagement','/solo/3855/growth/sales','black_friday_2026_launch',
'{"path":"/clients/10000000-0000-0000-0000-000000000002","lender_name":"Test Lender","numeric":12.5,"boolean":true,"nothing":null}', '2026-01-01T00:00:00Z');
SELECT pg_temp.assert_true(id='10000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002' AND created_at='2026-01-01T00:00:00Z' AND session_id='session-test' AND event_name='page_view' AND event_category='engagement' AND page_path='/solo/3855/growth/sales' AND utm_campaign='black_friday_2026_launch' AND properties->>'path'='/clients/10000000-0000-0000-0000-000000000002' AND properties @> '{"numeric":12.5,"boolean":true,"nothing":null}', 'safe identity route attribution metric timestamp controls') FROM public.analytics_events WHERE id='10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(analytics_privacy.minimize_text(repeat('x',513))='<redacted>', 'oversized string fails closed');
SELECT pg_temp.assert_true(analytics_privacy.minimize_json('{"a":{"b":{"c":{"d":{"token":"private"}}}}}'::jsonb)#>>'{a,b,c,d}'='<redacted>', 'depth bound fails closed');
SELECT pg_temp.assert_true(jsonb_array_length(analytics_privacy.minimize_json((SELECT jsonb_agg(n) FROM generate_series(1,100) n)))=64,'array bound');
ROLLBACK;
