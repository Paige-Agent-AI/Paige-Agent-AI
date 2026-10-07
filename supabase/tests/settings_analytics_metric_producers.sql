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
-- Company fixtures require the genuine canonical owner context, not service_role.
-- A schema-only clone may have no owner: mint a synthetic one through the actual
-- trusted role grant path. Never alter any existing owner identity or role.
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
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable';END IF;
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
INSERT INTO public.tenant_workflows(tenant_id,n8n_workflow_id,active,present_in_n8n) VALUES
 ('a3450000-0000-4000-8000-000000000011','settings-active',true,true),
 ('a3450000-0000-4000-8000-000000000011','settings-deleted',true,false),
 ('a3450000-0000-4000-8000-000000000012','settings-foreign',true,true);
INSERT INTO public.paige_llm_trace(id,tenant_id,working_context_tenant_id,provider,model,status,tokens_in,tokens_out,cost_estimate_usd,cost_basis,latency_ms,created_at) VALUES
 ('a3450000-0000-4000-8000-000000000021','a3450000-0000-4000-8000-000000000011',NULL,'synthetic','synthetic','success',10,20,0.001,'list price, in+out tokens, excl caching/thinking/tool round-trips, 2026-07',50,now()-interval '1 minute'),
 ('a3450000-0000-4000-8000-000000000022','a3450000-0000-4000-8000-000000000011',NULL,'synthetic','synthetic','error',NULL,NULL,NULL,NULL,NULL,now()-interval '1 minute'),
 ('a3450000-0000-4000-8000-000000000023','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000012','synthetic','synthetic','success',999,999,99,'unsupported',999,now()-interval '1 minute'),
 ('a3450000-0000-4000-8000-000000000024','a3450000-0000-4000-8000-000000000012',NULL,'synthetic','synthetic','success',NULL,NULL,NULL,NULL,NULL,now()-interval '1 minute');
INSERT INTO settings_fixture_clock VALUES(clock_timestamp());
CREATE FUNCTION pg_temp.settings_bundle(metric text,tenant uuid DEFAULT 'a3450000-0000-4000-8000-000000000011',dimensions jsonb DEFAULT '{}')
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public._settings_analytics_metric_bundle(tenant,metric,'1.0.0',c.as_of-interval '30 days',c.as_of,c.as_of,dimensions)
 FROM pg_temp.settings_fixture_clock c $$;
GRANT EXECUTE ON FUNCTION pg_temp.settings_bundle(text,uuid,jsonb) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_denied($q$SELECT public._settings_analytics_metric_bundle('a3450000-0000-4000-8000-000000000011','team.active_members_current','1.0.0',now()-interval '1 day',now(),now(),'{}')$q$,'private producer has no authenticated RPC grant');
INSERT INTO settings_results SELECT metric,pg_temp.settings_bundle(metric) FROM unnest(ARRAY[
 'business.active_clients_current','business.onboarding_current','business.lifecycle_current',
 'team.active_members_current','team.role_distribution_current','operations.workflows_active_current',
 'operations.recorded_workflow_runs','operations.systems_check_latest','operations.unresolved_findings_current',
 'ai.recorded_model_requests','ai.recorded_model_requests_daily','ai.recorded_tokens','ai.estimated_model_cost','ai.recorded_latency','ai.recorded_browser_calls',
 'business.retention','business.profitability','business.nps','team.performance_scorecards','ai.voice_consumption']) metric;
SELECT pg_temp.require_true(bundle#>>'{values,count}'='0' AND bundle->>'truth_state'='LIVE','empty current contacts is recorded zero') FROM settings_results WHERE key='business.active_clients_current';
SELECT pg_temp.require_true(bundle#>>'{values,count}'='2','active members are actual seats') FROM settings_results WHERE key='team.active_members_current';
SELECT pg_temp.require_true(bundle#>>'{values,count}'='1','workflow registry excludes absent and foreign workflow') FROM settings_results WHERE key='operations.workflows_active_current';
SELECT pg_temp.require_true(bundle#>>'{values,count}'='2' AND bundle->>'truth_state'='PARTIAL','trace excludes foreign working context and remains partial') FROM settings_results WHERE key='ai.recorded_model_requests';
SELECT pg_temp.require_true(bundle->>'truth_state'='PARTIAL'
 AND (SELECT sum((point->>'value')::integer)=2 AND count(*) BETWEEN 30 AND 31
   AND bool_and((point->>'at')::timestamptz >= (bundle#>>'{range,start}')::timestamptz
     AND (point->>'at')::timestamptz < (bundle#>>'{range,end}')::timestamptz)
   FROM jsonb_array_elements(bundle#>'{values,points}') point),
 'daily series counts only scoped recorded requests in bounded UTC buckets') FROM settings_results WHERE key='ai.recorded_model_requests_daily';
SELECT pg_temp.require_true(bundle#>>'{values,count}'='30' AND bundle->>'truth_state'='PARTIAL','unknown token row is excluded') FROM settings_results WHERE key='ai.recorded_tokens';
SELECT pg_temp.require_true((bundle#>>'{values,value}')::numeric=0.001 AND bundle->>'truth_state'='PARTIAL','cost is known supported estimate only') FROM settings_results WHERE key='ai.estimated_model_cost';
SELECT pg_temp.require_true((bundle#>>'{values,value}')::numeric=50,'recorded latency mean') FROM settings_results WHERE key='ai.recorded_latency';
SELECT pg_temp.require_true(bundle->>'truth_state'='UNAVAILABLE' AND bundle->'values'='null'::jsonb,'unsupported measurements remain null') FROM settings_results WHERE key IN ('business.retention','business.profitability','business.nps','team.performance_scorecards','ai.voice_consumption');
SELECT pg_temp.require_true(bundle#>>'{coverage,contributing_count}'='0'
 AND (bundle#>>'{coverage,excluded_count}')::bigint=(bundle#>>'{coverage,candidate_count}')::bigint,
 'unavailable measurements have no contributing facts') FROM settings_results WHERE bundle->>'truth_state'='UNAVAILABLE';
SELECT pg_temp.require_true(bundle->>'source_revision_ref'=pg_temp.settings_bundle(key)->>'source_revision_ref','stable source digest') FROM settings_results;
SELECT pg_temp.require_denied($q$SELECT pg_temp.settings_bundle('team.active_members_current','a3450000-0000-4000-8000-000000000012')$q$,'same actor foreign active seat cannot broaden active workspace');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_bundle('team.active_members_current','a3450000-0000-4000-8000-000000000011','{"tenant":"foreign"}')$q$,'dimensions cannot broaden scope');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_bundle('unknown')$q$,'unknown metric fails closed');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.paige_systems_check_registry(check_id,check_name,domain,severity,data_source,runner_key,remediation_prompt)
 VALUES('settings-proof-check','Synthetic proof check','infrastructure','high','native_seam','settings-proof','Synthetic only');
INSERT INTO public.paige_systems_check_run(id,tenant_id,scan_flavor,started_at,completed_at,check_count,pass_count,fail_count,selected_runner_keys) VALUES
 ('a3450000-0000-4000-8000-000000000051','a3450000-0000-4000-8000-000000000011','scheduled',now()-interval '2 hours',now()-interval '1 hour',1,0,1,NULL),
 ('a3450000-0000-4000-8000-000000000052','a3450000-0000-4000-8000-000000000011','change_triggered',now()-interval '20 minutes',now()-interval '10 minutes',1,1,0,ARRAY['settings-proof']),
 ('a3450000-0000-4000-8000-000000000053','a3450000-0000-4000-8000-000000000011','scheduled',now()-interval '5 minutes',NULL,0,0,0,NULL);
INSERT INTO public.paige_systems_check_finding(id,run_id,check_id,tenant_id,status,severity_at_finding,evidence,paige_interpretation,created_at)
 VALUES('a3450000-0000-4000-8000-000000000054','a3450000-0000-4000-8000-000000000051','settings-proof-check',
 'a3450000-0000-4000-8000-000000000011','fail','high','{"private":"synthetic-sensitive-evidence"}','synthetic-sensitive-interpretation',now()-interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_true(pg_temp.settings_bundle('operations.unresolved_findings_current')#>>'{values,count}'='1',
 'canonical latest completed full sweep excludes targeted and unfinished scans');
SELECT pg_temp.require_true(pg_temp.settings_bundle('operations.systems_check_latest')::text NOT LIKE '%synthetic-sensitive%',
 'Systems Check metric contains no raw evidence or interpretation');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.paige_systems_check_run SET completed_at=now()+interval '1 minute' WHERE id='a3450000-0000-4000-8000-000000000051';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_true(pg_temp.settings_bundle('operations.systems_check_latest')->>'truth_state'='UNAVAILABLE'
 AND pg_temp.settings_bundle('operations.systems_check_latest')#>>'{coverage,contributing_count}'='0'
 AND pg_temp.settings_bundle('operations.systems_check_latest')#>>'{coverage,excluded_count}'='1',
 'canonical sweep after as_of makes every candidate excluded and values unavailable');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status,lifecycle_stage,onboarding_stage,
 onboarding_started_at,merged_into_contact_id,merged_at) VALUES
 ('a3450000-0000-4000-8000-000000000031','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','Synthetic','Lead','active','new_lead','pre_invite',NULL,NULL,NULL),
 ('a3450000-0000-4000-8000-000000000032','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','Synthetic','Active','active','client_active','completing_intake',now()-interval '1 day',NULL,NULL),
 ('a3450000-0000-4000-8000-000000000033','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','Synthetic','Paused','active','client_paused','pre_invite',NULL,NULL,NULL),
 ('a3450000-0000-4000-8000-000000000034','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','Synthetic','Churned','inactive','client_churned',NULL,NULL,NULL,NULL),
 ('a3450000-0000-4000-8000-000000000035','a3450000-0000-4000-8000-000000000011','a3450000-0000-4000-8000-000000000001','Synthetic','Merged','active','client_active','completed',now()-interval '1 day',NULL,NULL),
 ('a3450000-0000-4000-8000-000000000036','a3450000-0000-4000-8000-000000000012','a3450000-0000-4000-8000-000000000001','Synthetic','Unknown','active','client_active','pre_invite',NULL,NULL,NULL);
SELECT pg_temp.require_denied($q$UPDATE public.clients SET merged_into_contact_id='a3450000-0000-4000-8000-000000000032',merged_at=now()
 WHERE id='a3450000-0000-4000-8000-000000000035'$q$,'direct merge lineage cannot forge a merged fixture');
-- Synthetic lineage setup uses the exact trusted executor context required by the
-- unchanged guard. This is Analytics fixture preparation, not CRM command acceptance.
DO $fixture_merge$ BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FIXTURE: lineage setup requires no actor JWT';END IF;
 PERFORM set_config('app.crm_merge_lineage_write','on',true);
 UPDATE public.clients SET status='archived',merged_into_contact_id='a3450000-0000-4000-8000-000000000032',merged_at=now(),updated_at=now()
 WHERE id='a3450000-0000-4000-8000-000000000035' AND tenant_id='a3450000-0000-4000-8000-000000000011';
 PERFORM set_config('app.crm_merge_lineage_write','',true);
 PERFORM set_config('request.jwt.claims','{}',true);
END $fixture_merge$;
SELECT pg_temp.require_true((SELECT status='archived' AND merged_into_contact_id='a3450000-0000-4000-8000-000000000032'
 FROM public.clients WHERE id='a3450000-0000-4000-8000-000000000035'),'trusted guarded setup produced the synthetic lineage');
-- Take the Business snapshot after fixture versions have been written.
UPDATE settings_fixture_clock SET as_of=clock_timestamp();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
-- Refresh the later digest assertion's baseline to the same as_of, not an old request identity.
UPDATE settings_results SET bundle=pg_temp.settings_bundle(key) WHERE key='ai.recorded_tokens';
SELECT pg_temp.require_true(pg_temp.settings_bundle('business.active_clients_current')#>>'{values,count}'='1',
 'lead paused churned and merged records do not count as active clients');
SELECT pg_temp.require_true((SELECT sum((i->>'count')::integer)=3
 AND bool_and(i->>'key' IN ('client_active','client_paused','client_churned'))
 FROM jsonb_array_elements(pg_temp.settings_bundle('business.lifecycle_current')#>'{values,items}') i),
 'client lifecycle excludes lead sales and merged records while retaining paused and churned clients');
SELECT pg_temp.require_true(pg_temp.settings_bundle('business.onboarding_current')->>'truth_state'='PARTIAL'
 AND (SELECT sum((i->>'count')::integer)=1 FROM jsonb_array_elements(pg_temp.settings_bundle('business.onboarding_current')#>'{values,items}') i),
 'onboarding default and absent instrumentation are unknown excluded coverage');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- Both contributing and excluded quantities bind the deterministic revision; no raw trace is returned.
UPDATE public.paige_llm_trace SET tokens_in=998 WHERE id='a3450000-0000-4000-8000-000000000023';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_true(bundle->>'source_revision_ref'<>pg_temp.settings_bundle(key)->>'source_revision_ref'
 AND pg_temp.settings_bundle(key)#>>'{values,count}'='30','excluded safe source facts change revision without broadening quantity')
 FROM settings_results WHERE key='ai.recorded_tokens';
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- Production source absence is simulated only by transactional rename in this isolated clone.
ALTER TABLE public.paige_llm_trace RENAME TO settings_fixture_hidden_trace;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_true(pg_temp.settings_bundle('ai.recorded_model_requests')->>'truth_state'='UNAVAILABLE',
 'absent canonical source is unavailable');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
ALTER TABLE public.settings_fixture_hidden_trace RENAME TO paige_llm_trace;
-- Definer test bridge preserves caller JWT; it does not bypass the production scope gate.
CREATE FUNCTION pg_temp.settings_invalid(version text,start_at timestamptz,end_at timestamptz,as_of_at timestamptz,dimensions jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public._settings_analytics_metric_bundle('a3450000-0000-4000-8000-000000000011',
 'team.active_members_current',version,start_at,end_at,as_of_at,dimensions) $$;
GRANT EXECUTE ON FUNCTION pg_temp.settings_invalid(text,timestamptz,timestamptz,timestamptz,jsonb) TO authenticated;
CREATE FUNCTION pg_temp.settings_daily(start_at timestamptz,end_at timestamptz,as_of_at timestamptz)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public._settings_analytics_metric_bundle('a3450000-0000-4000-8000-000000000011',
 'ai.recorded_model_requests_daily','1.0.0',start_at,end_at,as_of_at,'{}') $$;
GRANT EXECUTE ON FUNCTION pg_temp.settings_daily(timestamptz,timestamptz,timestamptz) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('2.0.0',now()-interval '1 day',now(),now(),'{}')$q$,'unsupported producer version denied');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('1.0.0',NULL,now(),now(),'{}')$q$,'null timestamp denied');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('1.0.0',now()-interval '11 years',now(),now(),'{}')$q$,'range longer than ten years denied');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('1.0.0',now(),now()-interval '1 day',now(),'{}')$q$,'reversed range denied');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('1.0.0',now()-interval '1 day','infinity',now(),'{}')$q$,'infinite range denied');
SELECT pg_temp.require_invalid($q$SELECT pg_temp.settings_invalid('1.0.0',now()-interval '1 day',now(),now(),NULL)$q$,'null dimensions denied');
SELECT pg_temp.require_true(pg_temp.settings_daily(now()-interval '367 days',now(),now())->>'truth_state'='UNAVAILABLE',
 'daily series never exceeds bounded consumer buckets');
SELECT pg_temp.require_true((SELECT sum((point->>'value')::integer)=0
 FROM jsonb_array_elements(pg_temp.settings_daily(now()-interval '3 days',now()-interval '2 days',now())#>'{values,points}') point)
 AND pg_temp.settings_daily(now()-interval '3 days',now()-interval '2 days',now())->>'truth_state'='PARTIAL',
 'empty daily buckets are zero recorded rows while instrumentation coverage remains partial');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET active_tenant_id='a3450000-0000-4000-8000-000000000012' WHERE user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_true((pg_temp.settings_bundle('ai.estimated_model_cost','a3450000-0000-4000-8000-000000000012'))->>'truth_state'='UNAVAILABLE','all unknown cost is unavailable not zero');
SELECT pg_temp.require_true((pg_temp.settings_bundle('business.onboarding_current','a3450000-0000-4000-8000-000000000012'))->>'truth_state'='UNAVAILABLE',
 'clients with only default pre_invite have unavailable onboarding progress');
SELECT pg_temp.require_denied($q$SELECT pg_temp.settings_bundle('team.active_members_current')$q$,'workspace switch invalidates previous tenant scope');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000002"}',true);
SELECT pg_temp.require_denied($q$SELECT pg_temp.settings_bundle('team.active_members_current')$q$,'ordinary member denied');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000003"}',true);
SELECT pg_temp.require_denied($q$SELECT pg_temp.settings_bundle('team.active_members_current')$q$,'platform role does not replace an explicit admin seat');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DELETE FROM public.tenant_members WHERE tenant_id='a3450000-0000-4000-8000-000000000012' AND user_id='a3450000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a3450000-0000-4000-8000-000000000001"}',true);
SELECT pg_temp.require_denied($q$SELECT pg_temp.settings_bundle('team.active_members_current','a3450000-0000-4000-8000-000000000012')$q$,'removed membership loses visibility immediately');
RESET ROLE;
SELECT 'PASS: isolated Settings producer assertions' AS verdict;
ROLLBACK;
