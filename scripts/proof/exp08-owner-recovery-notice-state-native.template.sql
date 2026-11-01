-- Original personal notice read-state installation on the actual replayed schema.
-- Rollback-only; no Auth users, customer rows, provider or business effects.
BEGIN;
SELECT plan(67);
CREATE TEMP TABLE exp08_notice_original_private AS
SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public._exp08_read_my_recovery_notice(uuid)'),to_regprocedure('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)'),to_regprocedure('public._exp08_require_recovery_audit()'));
SELECT is((SELECT count(*)::integer FROM exp08_notice_original_private),3,'all three original released personal eligibility dependencies exist');
SELECT lives_ok($install$
-- EXP08_NOTICE_STATE_PATCH
$install$,'original read-state preparation installs against the actual full schema');
SELECT ok(EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict AND NOT proleakproof AND proparallel='u' AND NOT proretset AND prorettype='jsonb'::regtype AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_function_arguments(oid)='_notice uuid, _is_read boolean'),'read-state native ABI and security metadata are exact');
SELECT ok(has_function_privilege('authenticated','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE') AND NOT has_function_privilege('service_role','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE'),'only authenticated callers receive the new native execute grant');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_notice_original_private o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE to_jsonb(p) IS DISTINCT FROM o.metadata),'original private eligibility bodies and every catalog attribute stay exact');
CREATE TEMP TABLE exp08_notice_installed AS SELECT to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure;
SELECT lives_ok($replay$
-- EXP08_NOTICE_STATE_PATCH
$replay$,'unchanged original read-state preparation replays');
SELECT is((SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),(SELECT metadata FROM exp08_notice_installed),'read-state replay preserves actual native body and complete metadata');
GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO anon;
SELECT throws_ok($acl$
-- EXP08_NOTICE_STATE_PATCH
$acl$,'P0001','EXP08 notice-state existing door drift','unexpected own execute permission is refused rather than normalized');
SELECT ok(has_function_privilege('anon','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE'),'refusal preserves the observed drift for diagnosis');
REVOKE EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM anon;
ALTER FUNCTION public._exp08_read_my_recovery_notice(uuid) STRICT;
SELECT throws_ok($dependency$
-- EXP08_NOTICE_STATE_PATCH
$dependency$,'P0001','EXP08 notice-state original eligibility drift: public._exp08_read_my_recovery_notice(uuid)','changed original private eligibility blocks installation');
SELECT is((SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),(SELECT metadata FROM exp08_notice_installed),'dependency refusal preserves the entire installed native door');
ALTER FUNCTION public._exp08_read_my_recovery_notice(uuid) CALLED ON NULL INPUT;
ALTER FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) STRICT;
SELECT throws_ok($metadata$
-- EXP08_NOTICE_STATE_PATCH
$metadata$,'P0001','EXP08 notice-state existing door drift','changed own metadata blocks replay');
SELECT ok((SELECT proisstrict FROM pg_catalog.pg_proc WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),'metadata refusal does not normalize the observed drift');
ALTER FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) CALLED ON NULL INPUT;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','permission denied for function set_my_owner_recovery_notice_read','anonymous native execute is actually denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','permission denied for function set_my_owner_recovery_notice_read','service role cannot impersonate a personal notice recipient');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','an authenticated SQL role without actual Auth identity is refused');
RESET ROLE;
CREATE TEMP TABLE exp08_notice_read_state_probe(kind text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON exp08_notice_read_state_probe TO authenticated;
-- EXP08_ORIGINAL_RECOVERY_NATIVE
SELECT * FROM finish();
ROLLBACK;
