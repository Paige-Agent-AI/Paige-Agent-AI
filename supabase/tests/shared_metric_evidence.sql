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
-- EXP02 delayed work must reuse the original Metric actor predicate, never
-- broaden it to generic document roles. All mutations below are rolled back.
SELECT pg_temp.require_true(NOT EXISTS (
 SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
 WHERE has_function_privilege(name,'public._analytics_metric_actor_authorized(uuid,uuid)','EXECUTE')
),'Metric actor predicate is private to native callers');
SELECT pg_temp.require_true(NOT EXISTS (
 SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public._analytics_metric_actor_authorized(uuid,uuid)'::regprocedure AND a.grantee=0
),'Metric actor predicate has no PUBLIC grant');
DO $metric_actor$ DECLARE
 actor uuid := 'a3450000-0000-4000-8000-000000000001';
 workspace uuid := 'a3450000-0000-4000-8000-000000000011';
 other_workspace uuid := 'a3450000-0000-4000-8000-000000000012';
 seat_role text;
 denied_constraint text;
BEGIN
 PERFORM pg_temp.require_true(public._analytics_metric_actor_authorized(actor,workspace),'original admin with current profile');
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(actor,other_workspace),'even a real seat in another active workspace is insufficient');
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(NULL,workspace)
  AND NOT public._analytics_metric_actor_authorized(actor,NULL),'missing stored work context');
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized('a3450000-0000-4000-8000-000000000003',workspace),'platform role alone is not Metric authority');
 -- Current provisioning forbids retired title roles. Prove that real constraint
 -- instead of weakening it to manufacture a coach seat for this fixture.
 BEGIN
  UPDATE public.tenant_members SET role='coach' WHERE user_id=actor AND tenant_id=workspace;
  RAISE EXCEPTION 'FAIL: retired title role fixture must be refused';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS denied_constraint = CONSTRAINT_NAME;
  PERFORM pg_temp.require_true(denied_constraint='tenant_members_role_not_retired_title_role','original retired-role guard remains enforced');
 END;
 FOREACH seat_role IN ARRAY ARRAY['member','admin'] LOOP
  UPDATE public.tenant_members SET role=seat_role::public.tenant_role WHERE user_id=actor AND tenant_id=workspace;
  PERFORM pg_temp.require_true(public._analytics_metric_actor_authorized(actor,workspace) IS NOT DISTINCT FROM (seat_role='admin'),'original exact Metric seat role');
 END LOOP;
 UPDATE public.tenant_members SET status='suspended' WHERE user_id=actor AND tenant_id=workspace;
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(actor,workspace),'suspended initiating seat');
 UPDATE public.tenant_members SET status='active' WHERE user_id=actor AND tenant_id=workspace;
 UPDATE public.profiles SET active_tenant_id=other_workspace WHERE user_id=actor;
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(actor,workspace),'initiating actor switched active workspace');
 UPDATE public.profiles SET active_tenant_id=workspace WHERE user_id=actor;
 UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=actor;
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(actor,workspace),'currently banned initiating identity');
 UPDATE auth.users SET banned_until=now()-interval '1 day' WHERE id=actor;
 PERFORM pg_temp.require_true(public._analytics_metric_actor_authorized(actor,workspace),'expired ban does not become permanent denial');
 UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=actor;
 PERFORM pg_temp.require_true(NOT public._analytics_metric_actor_authorized(actor,workspace),'deleted initiating identity');
 UPDATE auth.users SET deleted_at=NULL WHERE id=actor;
 PERFORM pg_temp.require_true(public._analytics_metric_actor_authorized(actor,workspace),'restored original fixture remains eligible');
END $metric_actor$;
SET LOCAL ROLE anon;
SELECT pg_temp.require_denied($q$SELECT public._analytics_metric_actor_authorized(NULL,NULL)$q$,'anonymous cannot supply an actor');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.require_denied($q$SELECT public._analytics_metric_actor_authorized(NULL,NULL)$q$,'service role has no actor override RPC');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_denied($q$SELECT public._analytics_metric_actor_authorized(NULL,NULL)$q$,'authenticated cannot supply an actor');
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO seam_result SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011');
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='UNAVAILABLE' AND bundle->'values'='null'::jsonb AND bundle#>>'{range,key}'='week' FROM seam_result),'flat unavailable contract');
SELECT pg_temp.require_true((SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle FROM seam_result),'same asof reference readback');
-- EXP02 private document consumer: the temporary bridge models the existing
-- SECURITY DEFINER native writer. It is rolled back, never an application grant.
RESET ROLE;
CREATE FUNCTION pg_temp.capture_document_metrics(refs jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public._paige_document_capture_metric_evidence(refs)
$$;
SELECT pg_temp.require_true(NOT EXISTS (
 SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(name)
 WHERE has_function_privilege(name,'public._paige_document_capture_metric_evidence(jsonb)','EXECUTE')
),'report capture has no application-role execute grant');
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_denied($q$SELECT public._paige_document_capture_metric_evidence(jsonb_build_array(bundle->>'evidence_ref')) FROM seam_result$q$,'private report capture is not a public RPC');
SELECT pg_temp.require_true((SELECT
 (capture->'measurements'->0)=(bundle-'account_epoch'-'account_epoch_ref')
 AND capture->>'version'='1'
 AND (capture->>'captured_at')::timestamptz >= (bundle->>'as_of')::timestamptz
 FROM seam_result CROSS JOIN LATERAL (SELECT pg_temp.capture_document_metrics(jsonb_build_array(bundle->>'evidence_ref')) capture) proof),
 'report preserves exact unavailable/null, range, asof, definition, coverage and original provenance');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.capture_document_metrics('[]')$q$,'empty report references');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.capture_document_metrics(jsonb_build_array(bundle->>'evidence_ref',bundle->>'evidence_ref')) FROM seam_result$q$,'duplicate report references');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.capture_document_metrics(jsonb_build_array(jsonb_build_object('evidence_ref',bundle->>'evidence_ref','values',9000))) FROM seam_result$q$,'caller values cannot become report evidence');
SELECT pg_temp.require_invalid($q$SELECT public.issue_analytics_evidence_bundle('business.fabricated','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'unknown metric');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')$q$,'epoch mismatch');
SELECT pg_temp.require_denied($q$SELECT public._resolve_legacy_analytics_evidence_reference('aneb_v1_'||repeat('a',64))$q$,'private legacy seam');
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_result$q$,'cross actor reference');
SELECT pg_temp.require_denied($q$SELECT pg_temp.capture_document_metrics(jsonb_build_array(bundle->>'evidence_ref')) FROM seam_result$q$,'cross actor report capture');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'ordinary member denied');
SELECT pg_temp.require_denied(format('SELECT public.issue_analytics_evidence_bundle(%L,%L,%L::jsonb,%L,now()-interval %L,now(),%L::uuid)',
 metric,'1.0.0','{}','week','7 days','a3450000-0000-4000-8000-000000000011'),'ordinary member cannot issue diagnostics')
 FROM (VALUES ('operations.recorded_workflow_activity'),('operations.current_system_exceptions')) approved(metric);
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000003',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('business.retention','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'platform role without seat denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
UPDATE public.analytics_evidence_reference SET expires_at=clock_timestamp()-interval '1 second',issued_at=clock_timestamp()-interval '1 hour' WHERE token_digest=encode(extensions.digest(convert_to((SELECT bundle->>'evidence_ref' FROM seam_result),'UTF8'),'sha256'),'hex');
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_result$q$,'expired reference');
SELECT pg_temp.require_denied($q$SELECT pg_temp.capture_document_metrics(jsonb_build_array(bundle->>'evidence_ref')) FROM seam_result$q$,'expired report capture');
RESET ROLE;
-- Stateful proofs use the same actual actor seated in two real fixture tenants.
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE seam_stateful(label text PRIMARY KEY,bundle jsonb);
GRANT SELECT,INSERT ON seam_stateful TO authenticated;
CREATE TEMP TABLE seam_pipeline_fixture(label text PRIMARY KEY,pipeline_id uuid NOT NULL);
-- The real actor supplies creation provenance; identity remains server-generated.
-- Privileged isolated fixture setup still invokes every production trigger.
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),
 set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
WITH generated AS (
 INSERT INTO public.pipelines(tenant_id,name,is_default) VALUES
 ('a3450000-0000-4000-8000-000000000011','Legacy proof',true) RETURNING id
) INSERT INTO seam_pipeline_fixture(label,pipeline_id) SELECT 'legacy',id FROM generated;
INSERT INTO public.pipeline_stages(pipeline_id,tenant_id,label,order_index,probability,stage_type)
 SELECT pipeline_id,'a3450000-0000-4000-8000-000000000011','Recorded stage',1,10,'open'
 FROM seam_pipeline_fixture WHERE label='legacy';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO seam_stateful SELECT 'a',public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011');
-- Diagnostic proof uses actual fixture source availability, without fabricated activity.
INSERT INTO seam_stateful SELECT 'a:'||metric,public.issue_analytics_evidence_bundle(metric,'1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')
 FROM (VALUES ('operations.recorded_workflow_activity'),('operations.current_system_exceptions')) approved(metric);
SELECT pg_temp.require_true(bundle->>'account_epoch'='a3450000-0000-4000-8000-000000000011'
 AND ((bundle->>'truth_state'='UNAVAILABLE' AND bundle->'values'='null'::jsonb)
   OR (bundle->'values'->>'kind'='diagnostic_events' AND jsonb_array_length(bundle#>'{values,items}')<=20))
 AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle,
 'same actor A diagnostic issuance/readback preserves source availability') FROM seam_stateful WHERE label LIKE 'a:%';
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('operations.recorded_workflow_activity','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')$q$,'diagnostic foreign epoch denied');
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
SELECT pg_temp.require_denied(format('SELECT public.resolve_analytics_evidence_reference(%L)',bundle->>'evidence_ref'),
 'old A diagnostic reference after actual switch B') FROM seam_stateful WHERE label LIKE 'a:%';
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000011')$q$,'stale A epoch after switch B');
INSERT INTO seam_stateful SELECT 'b',public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012');
INSERT INTO seam_stateful SELECT 'b:'||metric,public.issue_analytics_evidence_bundle(metric,'1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')
 FROM (VALUES ('operations.recorded_workflow_activity'),('operations.current_system_exceptions')) approved(metric);
SELECT pg_temp.require_true(bundle->>'account_epoch'='a3450000-0000-4000-8000-000000000012'
 AND ((bundle->>'truth_state'='UNAVAILABLE' AND bundle->'values'='null'::jsonb)
   OR (bundle->'values'->>'kind'='diagnostic_events' AND jsonb_array_length(bundle#>'{values,items}')<=20))
 AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle,
 'same actor B diagnostic issuance/readback preserves source availability') FROM seam_stateful WHERE label LIKE 'b:%';
SELECT pg_temp.require_true((SELECT bundle->>'account_epoch'='a3450000-0000-4000-8000-000000000012' AND bundle->'values'->>'count'='1' AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle FROM seam_stateful WHERE label='b'),'same actor actual B positive and readback');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
DELETE FROM public.tenant_members WHERE tenant_id='a3450000-0000-4000-8000-000000000012' AND user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM seam_stateful WHERE label='b'$q$,'removed seat invalidates already issued reference');
SELECT pg_temp.require_denied(format('SELECT public.resolve_analytics_evidence_reference(%L)',bundle->>'evidence_ref'),
 'removed seat invalidates diagnostic reference') FROM seam_stateful WHERE label LIKE 'b:%';
SELECT pg_temp.require_denied(format('SELECT public.issue_analytics_evidence_bundle(%L,%L,%L::jsonb,%L,now()-interval %L,now(),%L::uuid)',
 metric,'1.0.0','{}','week','7 days','a3450000-0000-4000-8000-000000000012'),'removed seat cannot issue diagnostics')
 FROM (VALUES ('operations.recorded_workflow_activity'),('operations.current_system_exceptions')) approved(metric);
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a3450000-0000-4000-8000-000000000012')$q$,'removed seat cannot issue');
RESET ROLE;
-- Reserved report artifact privacy only, not report submission or Harness proof.
-- Reuse this rollback-only fixture's real actors/tenants and original table/RLS.
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a3450000-0000-4000-8000-000000000012','a3450000-0000-4000-8000-000000000001','admin','active',false)
 ON CONFLICT(tenant_id,user_id) DO UPDATE SET role='admin',status='active';
UPDATE public.profiles SET active_tenant_id='a3450000-0000-4000-8000-000000000011' WHERE user_id='a3450000-0000-4000-8000-000000000001';
-- Privileged isolated source fixture: no public report type is admitted yet.
INSERT INTO public.paige_durable_work(id,tenant_id,initiating_user_id,intent_id,capability_key,work_kind,
 authority_context,scope_epoch,idempotency_key,lease_until,request_payload) VALUES
 ('a3450000-0000-4000-8000-000000000071','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001',
  'a3450000-0000-4000-8000-000000000072','document_generate','document_authoring','{}',
  'isolated-report-privacy','isolated-report-privacy-key',now()+interval '5 minutes',
  '{"doc_type":"business_review","report_evidence":{"fixture":true}}');
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$INSERT INTO public.marketing_content(id,tenant_id,created_by,kind,title,body,meta,work_id) VALUES
 ('a3450000-0000-4000-8000-000000000071','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001',
  'document','Isolated report privacy','Fixture only; no business figures','{"document_purpose":"metric_business_review"}',
  'a3450000-0000-4000-8000-000000000071')$q$,'caller cannot manufacture reserved report class through a definer writer');
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
INSERT INTO public.marketing_content(id,tenant_id,created_by,kind,title,body,meta,work_id) VALUES
 ('a3450000-0000-4000-8000-000000000071','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001',
  'document','Isolated report privacy','Fixture only; no business figures','{"document_purpose":"metric_business_review"}',
  'a3450000-0000-4000-8000-000000000071');
INSERT INTO public.marketing_content(id,tenant_id,created_by,kind,title,body) VALUES
 ('a3450000-0000-4000-8000-000000000073','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001',
  'document','Original library fixture','Original library behavior');
SELECT pg_temp.require_true((SELECT NOT polpermissive FROM pg_policy WHERE polname='marketing_content_metric_report_scope'
 AND polrelid='public.marketing_content'::regclass),'report policy is restrictive');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_true((SELECT count(*)=2 FROM public.marketing_content WHERE id IN
 ('a3450000-0000-4000-8000-000000000071','a3450000-0000-4000-8000-000000000073')),'current Metric admin reads report and original library');
RESET ROLE;
SELECT pg_temp.require_invalid($q$UPDATE public.marketing_content SET body='Changed facts' WHERE id='a3450000-0000-4000-8000-000000000071'$q$,'captured report facts immutable even through a definer writer');
SELECT pg_temp.require_invalid($q$UPDATE public.marketing_content SET meta='{}' WHERE id='a3450000-0000-4000-8000-000000000071'$q$,'report cannot be retagged into broader access');
SELECT pg_temp.require_invalid($q$UPDATE public.marketing_content SET work_id=NULL WHERE id='a3450000-0000-4000-8000-000000000071'$q$,'live work identity cannot be caller-retired');
UPDATE public.marketing_content SET status='archived' WHERE id='a3450000-0000-4000-8000-000000000071';
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
UPDATE public.profiles SET active_tenant_id='a3450000-0000-4000-8000-000000000012' WHERE user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.marketing_content WHERE id='a3450000-0000-4000-8000-000000000071'),'other active workspace with a real admin seat cannot read prior report');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.marketing_content WHERE id='a3450000-0000-4000-8000-000000000073'),'original admin library policy is preserved for nonreports');
RESET ROLE;
-- Actual original work FK retirement must not rewrite facts or widen visibility.
DELETE FROM public.paige_durable_work WHERE id='a3450000-0000-4000-8000-000000000071';
SELECT pg_temp.require_true((SELECT work_id IS NULL AND body='Fixture only; no business figures'
 AND meta->>'document_purpose'='metric_business_review' FROM public.marketing_content WHERE id='a3450000-0000-4000-8000-000000000071'),'original FK cleanup retains report facts/privacy');
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
UPDATE public.profiles SET active_tenant_id='a3450000-0000-4000-8000-000000000011' WHERE user_id='a3450000-0000-4000-8000-000000000001';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a3450000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a3450000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.marketing_content WHERE id='a3450000-0000-4000-8000-000000000071'),'banned identity cannot reopen a stored report');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.marketing_content WHERE id='a3450000-0000-4000-8000-000000000071'),'deleted identity cannot reopen a stored report');
RESET ROLE;
SELECT pg_temp.require_true(NOT has_function_privilege('anon','public._paige_metric_report_readable(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public._paige_metric_report_readable(uuid)','EXECUTE')
 AND has_function_privilege('authenticated','public._paige_metric_report_readable(uuid)','EXECUTE'),'caller-bound boolean grants no privileged actor override');
ROLLBACK;
