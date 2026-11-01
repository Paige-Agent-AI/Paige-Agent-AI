-- Original Team details atomic catalog composition. Schema-only, rollback-only;
-- no customer identity, effect execution, provider, role grant or account creation.
BEGIN;
SELECT plan(14);
CREATE TEMP TABLE exp08_details_original_catalog AS
SELECT p.oid,(to_jsonb(p)-'prosrc') AS metadata FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text)'),to_regprocedure('public.set_solo_team_member_permission(uuid,text)'));
SELECT is((SELECT count(*)::integer FROM exp08_details_original_catalog),2,'both ORIGINAL Team details doors are present');
SELECT lives_ok($install$
-- EXP08_ATOMIC_BUNDLE
$install$,'the single original atomic composition installs or validates a complete existing package');
SELECT ok(to_regprocedure('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)') IS NOT NULL AND to_regprocedure('public.set_solo_team_member_permission(uuid,text,uuid,uuid)') IS NOT NULL,'both original scoped overloads exist together');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_details_original_catalog o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE o.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc'),'both original ABIs/nonbody metadata remain exact');
SELECT ok(NOT EXISTS(SELECT 1 FROM (VALUES ('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'),('public.set_solo_team_member_permission(uuid,text,uuid,uuid)')) f(signature) WHERE NOT has_function_privilege('authenticated',signature,'EXECUTE') OR has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('service_role',signature,'EXECUTE')),'both scoped overloads remain authenticated-only');
CREATE TEMP TABLE exp08_details_installed_catalog AS
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS snapshot FROM pg_catalog.pg_proc p
WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission');
SELECT lives_ok($replay$
-- EXP08_ATOMIC_BUNDLE
$replay$,'the whole original atomic composition replays');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission')),(SELECT snapshot FROM exp08_details_installed_catalog),'whole package replay is exact in the actual function catalog');
ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) STRICT;
CREATE TEMP TABLE exp08_details_drift_catalog AS
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) AS snapshot FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission');
SELECT throws_ok($metadata_drift$
-- EXP08_ATOMIC_BUNDLE
$metadata_drift$,'P0001','EXP08 permission original metadata drift','a late original permission metadata refusal aborts the whole package');
SELECT is((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('set_solo_team_member_work_profile','set_solo_team_member_permission')),(SELECT snapshot FROM exp08_details_drift_catalog),'late refusal preserves every original catalog object');
ALTER FUNCTION public.set_solo_team_member_permission(uuid,text) CALLED ON NULL INPUT;
GRANT EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) TO anon;
SELECT throws_ok($acl_drift$
-- EXP08_ATOMIC_BUNDLE
$acl_drift$,'P0001','EXP08 scoped permission original door drift','an unexpected scoped ACL is refused rather than normalized');
SELECT ok(has_function_privilege('anon','public.set_solo_team_member_permission(uuid,text,uuid,uuid)','EXECUTE'),'refused replay does not silently erase the pre-existing drift');
REVOKE EXECUTE ON FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid) FROM anon;
DROP FUNCTION public.set_solo_team_member_permission(uuid,text,uuid,uuid);
SELECT throws_ok($partial$
-- EXP08_ATOMIC_BUNDLE
$partial$,'P0001','EXP08 Team details partial installation','partial original scoped installation is refused');
SELECT is((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid='public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure),(SELECT entry->>'prosrc' FROM exp08_details_installed_catalog, jsonb_array_elements(snapshot) entry WHERE entry->>'oid'=('public.set_solo_team_member_work_profile(uuid,text,text,uuid,uuid)'::regprocedure::oid)::text),'partial refusal preserves the surviving scoped profile body');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_details_original_catalog o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE o.metadata IS DISTINCT FROM to_jsonb(p)-'prosrc'),'all original metadata is retained after refusal controls');
SELECT * FROM finish();
ROLLBACK;
