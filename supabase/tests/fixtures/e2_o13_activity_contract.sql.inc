-- ISOLATED FULL-SCHEMA CI ONLY. Included inside the original attribution test's
-- BEGIN/ROLLBACK. No migrations, production grants, providers or real accounts.
-- Reapply the SAME guarded canonical migration inside this transaction.
-- Tests exercise actual installed code and native idempotency; no second definition.
CREATE TEMP TABLE o13_reader_before AS SELECT p.oid, p.proacl, p.proowner,
  p.prosecdef,p.provolatile,p.proconfig,p.prorettype,p.proretset,p.proargtypes,
  p.proallargtypes,p.proargmodes,p.proargnames,
  pg_get_expr(p.proargdefaults,0) AS defaults
  FROM pg_proc p WHERE p.oid='public.get_solo_rail_activity(integer)'::regprocedure;
CREATE TEMP TABLE o13_raw_grants_before AS SELECT r,t,privilege,
  has_table_privilege(r,t,privilege) AS can_act
  FROM unnest(ARRAY['anon','authenticated','service_role']) r
  CROSS JOIN unnest(ARRAY['public.paige_client_events','public.paige_workspace_events',
    'public.business_mission_mutation_receipts','public.business_mission_target_versions']) t
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) privilege;
-- Supabase's pgTAP container mounts tests, not sibling migration files. Replay
-- the actual canonical statement the local migration runner already recorded.
-- Refuse a missing, differently named, split or changed installer; no fallback
-- definition or assertion is substituted for the complete guarded migration.
DO $replay_source$
BEGIN
  IF NOT EXISTS (
    SELECT FROM supabase_migrations.schema_migrations
    WHERE version='20271130020010' AND name='e02_original_activity_result_forward'
      AND cardinality(statements)=1
      AND md5(statements[1])='a1d090aeec534545d74cfeef7097e042'
  ) THEN
    RAISE EXCEPTION 'O13 canonical installer source is missing or changed';
  END IF;
END
$replay_source$;
SELECT statements[1] FROM supabase_migrations.schema_migrations
WHERE version='20271130020010'
\gexec

SELECT ok((SELECT p.oid=b.oid AND p.proacl IS NOT DISTINCT FROM b.proacl
  AND p.proowner=b.proowner AND p.prosecdef=b.prosecdef AND p.provolatile=b.provolatile
  AND p.proconfig IS NOT DISTINCT FROM b.proconfig AND p.prorettype=b.prorettype
  AND p.proretset=b.proretset AND p.proargtypes=b.proargtypes
  AND p.proallargtypes IS NOT DISTINCT FROM b.proallargtypes
  AND p.proargmodes IS NOT DISTINCT FROM b.proargmodes AND p.proargnames IS NOT DISTINCT FROM b.proargnames
  AND pg_get_expr(p.proargdefaults,0) IS NOT DISTINCT FROM b.defaults
  FROM pg_proc p CROSS JOIN o13_reader_before b WHERE p.oid=b.oid),
  'O13 canonical replay preserves original list OID, ABI, defaults, owner, settings and ACL');
SELECT ok((SELECT bool_and(can_act=has_table_privilege(r,t,privilege)) FROM o13_raw_grants_before),
  'O13 canonical replay creates no new raw-table permission');
SELECT ok(NOT has_function_privilege('anon','public.get_solo_rail_activity(integer,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.get_solo_rail_activity(integer,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_solo_rail_activity(integer,uuid)','EXECUTE'),
  'O13 exact signature has only the intended ordinary authenticated grant');
SELECT ok((SELECT bool_and(NOT has_function_privilege(r,f,'EXECUTE'))
  FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY[
    'public._solo_rail_activity_rows(integer,uuid,boolean)',
    'public._solo_rail_activity_evidence(uuid,text,text)']) f),
  'O13 private helpers are not directly executable by API roles');
SELECT ok((SELECT p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=""']
  FROM pg_proc p WHERE p.oid='public.get_solo_rail_activity(integer,uuid)'::regprocedure),
  'O13 new signature retains fixed empty search path and stable definer contract');

-- Actual migrated Auth, tenant context, Mission, target, issuer and receipt code;
-- no replacement owner-context/display/record readers are defined here.
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('11111111-1111-4111-8111-111111111111','authenticated','authenticated','o13-owner-a@tests.invalid'),
 ('44444444-4444-4444-8444-444444444444','authenticated','authenticated','o13-owner-b@tests.invalid'),
 ('55555555-5555-4555-8555-555555555555','authenticated','authenticated','o13-member-a@tests.invalid'),
 ('66666666-6666-4666-8666-666666666666','authenticated','authenticated','o13-admin-a@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand,owner_user_id,parent_tenant_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-tenant-o13-a','Test O13 tenant A','active','standalone','TTA',9383101,'{}','{}','11111111-1111-4111-8111-111111111111',NULL),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test-tenant-o13-b','Test O13 tenant B','active','standalone','TTB',9383102,'{}','{}','44444444-4444-4444-8444-444444444444',NULL);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','owner','active',true),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','member','active',false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','admin','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
CREATE TEMP TABLE o13_mission AS SELECT (public.create_business_mission(
 '10000000-0000-4000-8000-000000000013','Original O13 fixture Play','Review saved work',NULL,'Current state','Approved strategy','{}',
 'Inspect actual original receipt','Owner-authored fixture','{}','{}',NULL,'owner_ui',NULL)->>'mission_id')::uuid AS id;
CREATE TEMP TABLE o13_definition AS SELECT
 '{"title":"Original O13 target","metric":{"key":"business.active_clients_current","version":"1.0.0","unit":"count","value_kind":"count","currency":null,"dimensions":{},"range_key":"quarter","semantics":"current_snapshot","business_time_zone":null},"period":{"start":"2026-10-01T00:00:00Z","end":"2027-01-01T00:00:00Z","time_zone":"America/New_York"},"comparison":"at_least","desired_value":"10","upper_value":null}'::jsonb AS value;
CREATE TEMP TABLE o13_metric(token text);
GRANT SELECT,INSERT ON o13_metric TO authenticated;
GRANT SELECT ON o13_mission,o13_definition TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO o13_metric SELECT public.issue_analytics_evidence_bundle(
 'business.active_clients_current','1.0.0','{}','quarter',now()-interval '10 days',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'evidence_ref';
CREATE TEMP TABLE o13_saved AS SELECT public.save_business_mission_target(
 '20000000-0000-4000-8000-000000000013',(SELECT id FROM o13_mission),1,NULL,NULL,
 (SELECT value FROM o13_definition),(SELECT token FROM o13_metric),'Original target fixture') AS result;
RESET ROLE;
-- Fixture Rail records use actual constraints; the original target/domain write
-- above is genuine isolated native execution, not an invented target receipt.
INSERT INTO public.paige_workspace_events(id,tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key,detail,occurred_at)
 VALUES('80000000-0000-4000-8000-000000000013','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111','capability_run','20000000-0000-4000-8000-000000000013',0,
 'capability_succeeded','owner_mission_target_save','{"sentinel":"DO-NOT-RETURN-PRIVATE"}',clock_timestamp());
INSERT INTO public.paige_workspace_events(tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key,occurred_at)
 SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 'capability_run',md5(('o13-recent-'||i)::text)::uuid,0,'capability_succeeded','read_sales_collections',clock_timestamp()
 FROM generate_series(1,30) i;
INSERT INTO public.paige_workspace_events(id,tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key,occurred_at)
 VALUES('90000000-0000-4000-8000-000000000013','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 '44444444-4444-4444-8444-444444444444','capability_run','20000000-0000-4000-8000-000000000013',0,
 'capability_succeeded','owner_mission_target_save',clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.get_solo_rail_activity(25)),25::bigint,'O13 original caller still gets its bounded sample');
SELECT ok(NOT EXISTS(SELECT FROM public.get_solo_rail_activity(25) WHERE id='80000000-0000-4000-8000-000000000013'),
  'O13 original target event is actually outside the recent sample');
SELECT is((SELECT count(*) FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),1::bigint,
  'O13 exact read reopens the original event beyond that sample');
SELECT is((SELECT evidence->>'kind' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'verified_original_result','O13 actual native receipt and immutable revision match');
SELECT is((SELECT evidence#>>'{business_result,receipt_id}' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  (SELECT result->>'receipt_id' FROM o13_saved),'O13 returns the original domain receipt identity');
SELECT is((SELECT evidence#>>'{record_links,0,record_id}' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  (SELECT id::text FROM o13_mission),'O13 uses the original Play semantic reference');
SELECT ok((SELECT evidence->>'rail_receipt_id'=id::text AND evidence::text NOT LIKE '%DO-NOT-RETURN-PRIVATE%'
  AND evidence::text NOT LIKE '%evidence_ref%' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'O13 binds the original Rail identity and withholds raw detail/bearer evidence');
SELECT ok((SELECT bool_and(evidence->>'kind'='recorded_outcome' AND evidence->'business_result'='null'::jsonb)
  FROM public.get_solo_rail_activity(25,NULL)),'O13 successful read events never become completed business work');
SELECT is((SELECT count(*) FROM public.get_solo_rail_activity(1,'90000000-0000-4000-8000-000000000013')),0::bigint,
  'O13 foreign exact event is not disclosed');
SELECT is((SELECT count(*) FROM public.get_solo_rail_activity(1,'70000000-0000-4000-8000-000000000013')),0::bigint,
  'O13 missing original event never falls back to a recent one');
CREATE TEMP TABLE o13_paused AS SELECT public.transition_business_mission_target(
 '20000000-0000-4000-8000-000000000023',(SELECT id FROM o13_mission),1,
 (SELECT (result->>'target_id')::uuid FROM o13_saved),1,'paused','Reviewed fixture pause') AS result;
SELECT is((SELECT evidence#>>'{business_result,state}' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'active','O13 history verifies the original saved revision, not the current paused state');
SELECT is(public.get_business_mission_target((SELECT (result->>'target_id')::uuid FROM o13_saved))->>'state',
  'paused','O13 fixture genuinely changed through the original lifecycle writer');
RESET ROLE;
UPDATE public.paige_workspace_events SET capability_key='owner_mission_target_transition'
 WHERE id='80000000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT is((SELECT evidence->>'kind' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'recorded_outcome','O13 mismatched original operation withholds verification');
RESET ROLE;
UPDATE public.paige_workspace_events SET capability_key='owner_mission_target_save',actor_id='66666666-6666-4666-8666-666666666666'
 WHERE id='80000000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT is((SELECT evidence->>'kind' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'recorded_outcome','O13 changed recorded actor withholds original verification');
RESET ROLE;
UPDATE public.paige_workspace_events SET actor_id='11111111-1111-4111-8111-111111111111'
 WHERE id='80000000-0000-4000-8000-000000000013';
SELECT set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
SELECT set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT evidence->>'kind' FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')),
  'recorded_outcome','O13 eligible Admin sees recorded history without the private Owner result');
SELECT throws_ok($$SELECT public.get_business_mission_target_receipt('20000000-0000-4000-8000-000000000013')$$,
  '42501','MISSION_OWNER_REQUIRED','O13 original receipt reader still refuses the Admin');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
SELECT set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')$$,
  '42501','RAIL_FORBIDDEN','O13 unassigned member cannot use the history reader');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name) VALUES
 ('c0000000-0000-4000-8000-000000000013','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Original','O13 client');
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-000000000013','email','o13-client@tests.invalid',true,0);
INSERT INTO public.paige_client_events(id,tenant_id,contact_id,event_kind,surface,actor_type,audience,visibility,title,summary,payload)
 SELECT '80000000-0000-4000-8000-000000000013','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c0000000-0000-4000-8000-000000000013',
 slug,'your_paige','owner_staff','owner','owner_internal','Legacy provenance fixture','Original legacy row','{"sentinel":"DO-NOT-RETURN-PRIVATE"}'
 FROM public.paige_event_kinds ORDER BY slug LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT ok((SELECT evidence IS NULL FROM public.get_solo_rail_activity(200,NULL) WHERE title='Legacy provenance fixture'),
  'O13 colliding legacy row cannot inherit workspace result evidence');
SELECT throws_ok($$SELECT * FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')$$,
  '22023','RAIL_EVENT_AMBIGUOUS','O13 colliding exact identities fail closed');
RESET ROLE;
SELECT ok(public._solo_rail_activity_evidence('80000000-0000-4000-8000-000000000013','client','client_visible') IS NULL
  AND public._solo_rail_activity_evidence('80000000-0000-4000-8000-000000000013',NULL,'owner_internal') IS NULL
  AND public._solo_rail_activity_evidence('80000000-0000-4000-8000-000000000013','owner','future_visibility') IS NULL,
  'O13 private evidence refuses unsupported audience/visibility classifications');
-- Revocation is last: no direct reactivation or workaround of the original
-- governed reinstatement contract is needed to manufacture a later positive.
UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 AND user_id='11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_solo_rail_activity(1,'80000000-0000-4000-8000-000000000013')$$,
  '42501','RAIL_FORBIDDEN','O13 same JWT is refused after actual membership revocation');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.get_solo_rail_activity(25,NULL)$$,
  '42501','RAIL_FORBIDDEN','O13 absent caller identity is refused');
RESET ROLE;
