-- ISOLATED full production-schema-only clone only; never execute on production.
-- Real auth users, JWT identity, membership triggers and scope helpers. No auth helper replacement.
-- Temporary privileged bridge models the shared definer issuer's private call, not a public RPC.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_denied(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.require_invalid(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN invalid_parameter_value THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE TEMP TABLE settings_fixture_clock(as_of timestamptz NOT NULL);
CREATE TEMP TABLE settings_results(key text PRIMARY KEY,bundle jsonb NOT NULL);
GRANT SELECT ON settings_fixture_clock TO authenticated;
GRANT SELECT,INSERT,UPDATE ON settings_results TO authenticated;
INSERT INTO auth.users(id,email) VALUES
 ('a3450000-0000-4000-8000-000000000001','settings-admin@example.invalid'),
 ('a3450000-0000-4000-8000-000000000002','settings-member@example.invalid'),
 ('a3450000-0000-4000-8000-000000000003','settings-operator@example.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES ('a3450000-0000-4000-8000-000000000003','platform_admin');
-- Company fixture creation exercises the genuine canonical owner guard.
-- Reuse the sole owner in a hosted preview; bootstrap a synthetic owner only
-- for an empty schema clone. No helper, policy, or existing owner is changed.
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN
   RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous';
 END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a3450000-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'settings-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
-- System-workspace flag suppresses onboarding dispatch; it does not grant these ordinary seats authority.
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a3450000-0000-4000-8000-000000000011','settings-proof-a','Settings proof A','active','standalone','STA','{"system_workspace":true}'),
 ('a3450000-0000-4000-8000-000000000012','settings-proof-b','Settings proof B','active','standalone','STB','{"system_workspace":true}');
-- Canonical company-seat guard permits direct server setup with no caller context.
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','admin','active',false),
 ('a3450000-0000-4000-8000-000000000012','a3450000-0000-4000-8000-000000000001','admin','active',false),
 ('a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000002','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a3450000-0000-4000-8000-000000000001','a3450000-0000-4000-8000-000000000011'),
 ('a3450000-0000-4000-8000-000000000002','a3450000-0000-4000-8000-000000000011'),
 ('a3450000-0000-4000-8000-000000000003','a3450000-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
CREATE TEMP TABLE seam_result(bundle jsonb);
GRANT SELECT,INSERT,UPDATE ON seam_result TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO seam_result SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011');
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='UNAVAILABLE' AND bundle->'values'='null'::jsonb AND bundle#>>'{range,key}'='week' FROM seam_result),'flat unavailable contract');
SELECT pg_temp.require_true((SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle FROM seam_result),'same asof reference readback');
SELECT pg_temp.require_invalid($q$SELECT public.issue_analytics_evidence_bundle('business.fabricated','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'unknown metric');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')$q$,'epoch mismatch');
SELECT pg_temp.require_denied($q$SELECT public._resolve_legacy_analytics_evidence_reference('aneb_v1_'||repeat('a',64))$q$,'private legacy seam');
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_result$q$,'cross actor reference');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'ordinary member denied');
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'platform role without seat denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
UPDATE public.analytics_evidence_reference SET expires_at=clock_timestamp()-interval '1 second',issued_at=clock_timestamp()-interval '1 hour' WHERE token_digest=encode(extensions.digest(convert_to((SELECT bundle->>'evidence_ref' FROM seam_result),'UTF8'),'sha256'),'hex');
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_result$q$,'expired reference');
RESET ROLE;
-- Stateful proofs use the same actual actor seated in two real fixture tenants.
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE seam_stateful(label text PRIMARY KEY,bundle jsonb);
GRANT SELECT,INSERT ON seam_stateful TO authenticated;
INSERT INTO public.pipelines(id,tenant_id,name,is_default) VALUES
 ('a3450000-0000-4000-8000-000000000051','a3450000-0000-4000-8000-000000000011','Legacy proof',true);
INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,order_index,probability,stage_type) VALUES
 ('a3450000-0000-4000-8000-000000000052','a3450000-0000-4000-8000-000000000051','a3450000-0000-4000-8000-000000000011','Recorded stage',1,10,'open');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO seam_stateful SELECT 'a',public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011');
SELECT pg_temp.require_true((SELECT bundle->>'account_epoch'='a3450000-0000-4000-8000-000000000011' AND bundle->'values'->>'count'='2' FROM seam_stateful WHERE label='a'),'actual A positive membership result');
INSERT INTO seam_stateful SELECT 'legacy',public.issue_analytics_evidence_bundle('sales_funnel.created_deals_by_current_stage','last_30_days','a3450000-0000-4000-8000-000000000011');
SELECT pg_temp.require_true((SELECT bundle->'bundle'->'metric'->>'id'='sales_funnel.created_deals_by_current_stage' AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle->'bundle' FROM seam_stateful WHERE label='legacy'),'legacy three arg nested response and resolver unchanged');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='a3450000-0000-4000-8000-000000000011' AND user_id='a3450000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_stateful WHERE label='a'$q$,'actual membership status mutation invalidates digest');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
UPDATE public.profiles SET active_tenant_id='a3450000-0000-4000-8000-000000000012' WHERE user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_stateful WHERE label='a'$q$,'old A reference after actual switch B');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'stale A epoch after switch B');
INSERT INTO seam_stateful SELECT 'b',public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012');
SELECT pg_temp.require_true((SELECT bundle->>'account_epoch'='a3450000-0000-4000-8000-000000000012' AND bundle->'values'->>'count'='1' AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle FROM seam_stateful WHERE label='b'),'same actor actual B positive and readback');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
DELETE FROM public.tenant_members WHERE tenant_id='a3450000-0000-4000-8000-000000000012' AND user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_stateful WHERE label='b'$q$,'removed seat invalidates already issued reference');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')$q$,'removed seat cannot issue');
RESET ROLE;
ROLLBACK;
