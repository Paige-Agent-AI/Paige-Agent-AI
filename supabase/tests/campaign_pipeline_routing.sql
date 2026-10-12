-- ISOLATED full production-schema-only clone only; never execute on production.
-- Experience 03 (Grow My Business) S1b: a form with no route of its own files its leads into its campaign's
-- pipeline; otherwise the default pipeline exactly as before. Real auth users, JWT identity, membership
-- triggers, the real asset-link writer, the real intake writer, the real metric producer and the read the
-- screens use. Rolled back.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.attach(brief text,asset text,key text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_campaign_brief_assets(NULL,jsonb_build_object('type','attach_asset','briefId',brief,'assetKind','form','assetId',asset),key,'human') $$;
CREATE TEMP TABLE fixtures(name text PRIMARY KEY, id uuid NOT NULL);
-- A lead as the processor holds it when it files the deal: a contact, claimed, on its first attempt.
CREATE FUNCTION pg_temp.file(p_sub text,p_tenant text,p_form text,p_client text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,payload_json,utm_json,source)
 VALUES(p_sub::uuid,p_tenant::uuid,p_form::uuid,'{"name":"Synthetic Prospect"}','{}','paige_form');
 UPDATE public.growth_form_submissions SET contact_id=p_client::uuid,processing_state='claimed',attempts=1 WHERE id=p_sub::uuid;
 RETURN public.growth_attach_submission_default_deal(p_sub::uuid,1);
END $$;
CREATE FUNCTION pg_temp.fx(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fixtures WHERE name=p_name $$;

INSERT INTO auth.users(id,email) VALUES
 ('a3e30200-0000-4000-8000-000000000001','exp03b-admin@example.invalid'),
 ('a3e30200-0000-4000-8000-000000000002','exp03b-member@example.invalid'),
 ('a3e30200-0000-4000-8000-000000000003','exp03b-other@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a3e30200-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'exp03b-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a3e30200-0000-4000-8000-000000000011','exp03b-proof-a','Exp03 S1b proof A','active','standalone','XQA','{"system_workspace":true}'),
 ('a3e30200-0000-4000-8000-000000000012','exp03b-proof-b','Exp03 S1b proof B','active','standalone','XQB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-000000000001','admin','active',false),
 ('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-000000000002','member','active',false),
 ('a3e30200-0000-4000-8000-000000000012','a3e30200-0000-4000-8000-000000000003','admin','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a3e30200-0000-4000-8000-000000000001','a3e30200-0000-4000-8000-000000000011'),
 ('a3e30200-0000-4000-8000-000000000002','a3e30200-0000-4000-8000-000000000011'),
 ('a3e30200-0000-4000-8000-000000000003','a3e30200-0000-4000-8000-000000000012')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

SELECT pg_temp.as_service();
-- Pipeline ids are server-generated (assign_pipeline_identity), so the fixture keeps the ones it was given.
SELECT set_config('app.pipeline_requested_by','a3e30200-0000-4000-8000-000000000001',true);
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES
  ('a3e30200-0000-4000-8000-000000000011','Sales Pipeline',true,'a3e30200-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO fixtures SELECT 'default',id FROM c;
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES
  ('a3e30200-0000-4000-8000-000000000011','Consult pipeline',false,'a3e30200-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO fixtures SELECT 'campaign',id FROM c;
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES
  ('a3e30200-0000-4000-8000-000000000011','Retired pipeline',false,'a3e30200-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO fixtures SELECT 'retired',id FROM c;
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES
  ('a3e30200-0000-4000-8000-000000000011','Closed-only pipeline',false,'a3e30200-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO fixtures SELECT 'closed_only',id FROM c;
SELECT set_config('app.pipeline_requested_by','a3e30200-0000-4000-8000-000000000003',true);
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES
  ('a3e30200-0000-4000-8000-000000000012','B campaign pipeline',false,'a3e30200-0000-4000-8000-000000000003') RETURNING id)
INSERT INTO fixtures SELECT 'b_campaign',id FROM c;
INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,stage_type,order_index,archived_at) VALUES
 ('a3e30200-0000-4000-8000-0000000000d1',pg_temp.fx('default'),'a3e30200-0000-4000-8000-000000000011','New lead','open',0,NULL),
 -- The campaign pipeline's first stage by order is archived, so the first OPEN non-archived one is "Discovery".
 ('a3e30200-0000-4000-8000-0000000000d2',pg_temp.fx('campaign'),'a3e30200-0000-4000-8000-000000000011','Old intake','open',0,now()),
 ('a3e30200-0000-4000-8000-0000000000d3',pg_temp.fx('campaign'),'a3e30200-0000-4000-8000-000000000011','Discovery','open',1,NULL),
 ('a3e30200-0000-4000-8000-0000000000d4',pg_temp.fx('campaign'),'a3e30200-0000-4000-8000-000000000011','Signed','won',9,NULL),
 ('a3e30200-0000-4000-8000-0000000000d5',pg_temp.fx('retired'),'a3e30200-0000-4000-8000-000000000011','Retired open','open',0,NULL),
 ('a3e30200-0000-4000-8000-0000000000d6',pg_temp.fx('closed_only'),'a3e30200-0000-4000-8000-000000000011','Done','won',0,NULL),
 ('a3e30200-0000-4000-8000-0000000000d9',pg_temp.fx('b_campaign'),'a3e30200-0000-4000-8000-000000000012','B open','open',0,NULL);
UPDATE public.pipelines SET lifecycle_status='archived' WHERE id=pg_temp.fx('retired');

INSERT INTO public.growth_forms(id,tenant_id,slug,name,status,created_by,auto_create_deal,pipeline_id) VALUES
 ('a3e30200-0000-4000-8000-0000000000f1','a3e30200-0000-4000-8000-000000000011','x3b-consult','Consult request','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f2','a3e30200-0000-4000-8000-000000000011','x3b-shared','Shared form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f3','a3e30200-0000-4000-8000-000000000011','x3b-retired','Retired-pipeline form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f4','a3e30200-0000-4000-8000-000000000011','x3b-closed','Closed-only form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f5','a3e30200-0000-4000-8000-000000000011','x3b-archived','Archived-campaign form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f6','a3e30200-0000-4000-8000-000000000011','x3b-own','Own-route form','active','a3e30200-0000-4000-8000-000000000001',true,NULL),
 ('a3e30200-0000-4000-8000-0000000000f7','a3e30200-0000-4000-8000-000000000011','x3b-foreign','Foreign-pipeline form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000f8','a3e30200-0000-4000-8000-000000000011','x3b-one-live','One live campaign form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000fa','a3e30200-0000-4000-8000-000000000011','x3b-none','Unattached form','active','a3e30200-0000-4000-8000-000000000001',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000fb','a3e30200-0000-4000-8000-000000000012','x3b-b1','B campaign form','active','a3e30200-0000-4000-8000-000000000003',false,NULL),
 ('a3e30200-0000-4000-8000-0000000000fc','a3e30200-0000-4000-8000-000000000012','x3b-b2','B loose form','active','a3e30200-0000-4000-8000-000000000003',false,NULL);
-- f6 routes its own deals: auto_create_deal on the default pipeline, and no automation at all.
UPDATE public.growth_forms SET pipeline_id=pg_temp.fx('default') WHERE id='a3e30200-0000-4000-8000-0000000000f6';
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status,pipeline_id) VALUES
 ('a3e30200-0000-4000-8000-0000000000c1','a3e30200-0000-4000-8000-000000000011','CB-CONSULT','Consult push','approved',pg_temp.fx('campaign')),
 ('a3e30200-0000-4000-8000-0000000000c2','a3e30200-0000-4000-8000-000000000011','CB-OTHER','Other push','draft',pg_temp.fx('campaign')),
 ('a3e30200-0000-4000-8000-0000000000c3','a3e30200-0000-4000-8000-000000000011','CB-RETIRED','Retired push','draft',pg_temp.fx('retired')),
 ('a3e30200-0000-4000-8000-0000000000c4','a3e30200-0000-4000-8000-000000000011','CB-CLOSED','Closed push','draft',pg_temp.fx('closed_only')),
 ('a3e30200-0000-4000-8000-0000000000c5','a3e30200-0000-4000-8000-000000000011','CB-GONE','Gone push','draft',pg_temp.fx('campaign')),
 -- A brief naming ANOTHER workspace's pipeline (no writer allows it; the rule must still never follow it).
 ('a3e30200-0000-4000-8000-0000000000c6','a3e30200-0000-4000-8000-000000000011','CB-FOREIGN','Foreign push','draft',pg_temp.fx('b_campaign')),
 ('a3e30200-0000-4000-8000-0000000000c9','a3e30200-0000-4000-8000-000000000012','CB-B','B push','draft',pg_temp.fx('b_campaign'));

-- The owners attach forms through the real writer.
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000001');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c1','a3e30200-0000-4000-8000-0000000000f1','x3b-1')->>'ok'='true','attach f1 → Consult');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c1','a3e30200-0000-4000-8000-0000000000f2','x3b-2')->>'ok'='true','attach f2 → Consult');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c2','a3e30200-0000-4000-8000-0000000000f2','x3b-3')->>'ok'='true','attach f2 → Other');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c3','a3e30200-0000-4000-8000-0000000000f3','x3b-4')->>'ok'='true','attach f3 → Retired');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c4','a3e30200-0000-4000-8000-0000000000f4','x3b-5')->>'ok'='true','attach f4 → Closed');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c5','a3e30200-0000-4000-8000-0000000000f5','x3b-6')->>'ok'='true','attach f5 → Gone');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c1','a3e30200-0000-4000-8000-0000000000f6','x3b-7')->>'ok'='true','attach f6 → Consult');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c6','a3e30200-0000-4000-8000-0000000000f7','x3b-8')->>'ok'='true','attach f7 → Foreign');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c1','a3e30200-0000-4000-8000-0000000000f8','x3b-9')->>'ok'='true','attach f8 → Consult');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c5','a3e30200-0000-4000-8000-0000000000f8','x3b-10')->>'ok'='true','attach f8 → Gone');
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000003');
SELECT pg_temp.require_true(pg_temp.attach('a3e30200-0000-4000-8000-0000000000c9','a3e30200-0000-4000-8000-0000000000fb','x3b-11')->>'ok'='true','attach fb → B push');
SELECT pg_temp.as_service();
UPDATE public.campaign_briefs SET lifecycle_status='archived' WHERE id='a3e30200-0000-4000-8000-0000000000c5';

-- 1. The rule, form by form (_growth_form_campaign_route).
CREATE FUNCTION pg_temp.route(p_tenant text,p_form text) RETURNS text LANGUAGE sql AS $$
-- Aggregated, so a rule that returned several campaigns fails its assertion instead of erroring.
 SELECT coalesce((SELECT string_agg(r.brief_id||'/'||r.stage_id,',' ORDER BY r.brief_id) FROM public._growth_form_campaign_route(p_tenant::uuid,p_form::uuid) r),'none') $$;
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f1')='a3e30200-0000-4000-8000-0000000000c1/a3e30200-0000-4000-8000-0000000000d3',
 'one campaign with a pipeline → that pipeline''s first OPEN, non-archived stage (Discovery, not the archived Old intake)');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f2')='none','two campaigns → no campaign route, never guessed');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f3')='none','the campaign''s pipeline is archived → no campaign route');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f4')='none','the campaign''s pipeline has no open stage → no campaign route');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f5')='none','the only campaign is archived → no campaign route');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f7')='none','a pipeline of another workspace is never followed');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f8')='a3e30200-0000-4000-8000-0000000000c1/a3e30200-0000-4000-8000-0000000000d3',
 'one live campaign plus one archived → the live one');
SELECT pg_temp.require_true(pg_temp.route('a3e30200-0000-4000-8000-000000000012','a3e30200-0000-4000-8000-0000000000f1')='none','asked in another workspace, a form has no route');
SELECT pg_temp.require_true(NOT has_function_privilege('authenticated','public._growth_form_campaign_route(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._growth_form_campaign_route(uuid,uuid)','EXECUTE'),'the rule itself has no caller grant');

-- 2. Filing, through the real intake writer.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number,lifecycle_stage,source) VALUES
 ('a3e30200-0000-4000-8000-0000000000b1','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-000000000001','Synthetic','One','XQA-1','new_lead','paige_form'),
 ('a3e30200-0000-4000-8000-0000000000b2','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-000000000001','Synthetic','Two','XQA-2','new_lead','paige_form'),
 ('a3e30200-0000-4000-8000-0000000000b3','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-000000000001','Synthetic','Three','XQA-3','new_lead','paige_form');
DO $file$ DECLARE r jsonb; d public.deals%ROWTYPE; BEGIN
 -- 2a. The campaign's pipeline takes f1's lead.
 r := pg_temp.file('a3e30200-0000-4000-8000-0000000000e1','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f1','a3e30200-0000-4000-8000-0000000000b1');
 SELECT * INTO d FROM public.deals WHERE id=(r->>'deal_id')::uuid;
 IF d.pipeline_id IS DISTINCT FROM pg_temp.fx('campaign') OR d.stage_id IS DISTINCT FROM 'a3e30200-0000-4000-8000-0000000000d3' THEN
   RAISE EXCEPTION 'FAIL: f1''s lead is filed in the campaign pipeline''s Discovery stage, got % / %',d.pipeline_id,d.stage_id; END IF;
 IF r->>'campaign_brief_id' IS DISTINCT FROM 'a3e30200-0000-4000-8000-0000000000c1' OR (r->>'default_pipeline')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'FAIL: the result names the campaign and says it was not the default pipeline, got %',r; END IF;
 IF d.source<>'paige_form' OR d.status<>'open' OR d.created_by IS DISTINCT FROM 'a3e30200-0000-4000-8000-000000000001' OR d.tenant_id<>'a3e30200-0000-4000-8000-000000000011' THEN
   RAISE EXCEPTION 'FAIL: the deal is made exactly as before (paige_form, open, the form''s creator, this business), got %',row_to_json(d); END IF;
 -- 2b. A second lead from the same contact reuses the open deal in that pipeline; it is not moved.
 r := pg_temp.file('a3e30200-0000-4000-8000-0000000000e2','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f8','a3e30200-0000-4000-8000-0000000000b1');
 IF (r->>'deal_id')::uuid IS DISTINCT FROM d.id THEN RAISE EXCEPTION 'FAIL: the open deal in the campaign pipeline is reused, got %',r; END IF;
 -- 2c. A retry of the first lead replays its bound deal and says it is not in the default pipeline.
 UPDATE public.growth_form_submissions SET processing_state='claimed',attempts=2 WHERE id='a3e30200-0000-4000-8000-0000000000e1';
 r := public.growth_attach_submission_default_deal('a3e30200-0000-4000-8000-0000000000e1',2);
 IF (r->>'replayed')::boolean IS DISTINCT FROM true OR (r->>'deal_id')::uuid IS DISTINCT FROM d.id OR (r->>'default_pipeline')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'FAIL: the replay returns the same deal and reports the pipeline it is in, got %',r; END IF;
 -- 2d. Every form without a campaign route still files to the default pipeline, exactly as before.
 r := pg_temp.file('a3e30200-0000-4000-8000-0000000000e3','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f2','a3e30200-0000-4000-8000-0000000000b2');
 IF r->>'stage_id' IS DISTINCT FROM 'a3e30200-0000-4000-8000-0000000000d1' OR (r->>'default_pipeline')::boolean IS DISTINCT FROM true OR r->>'campaign_brief_id' IS NOT NULL THEN
   RAISE EXCEPTION 'FAIL: two campaigns → the default pipeline, got %',r; END IF;
 FOR r IN SELECT pg_temp.file(x.sub,'a3e30200-0000-4000-8000-000000000011',x.form,'a3e30200-0000-4000-8000-0000000000b3') FROM (VALUES
   ('a3e30200-0000-4000-8000-0000000000e4','a3e30200-0000-4000-8000-0000000000f3'),('a3e30200-0000-4000-8000-0000000000e5','a3e30200-0000-4000-8000-0000000000f4'),
   ('a3e30200-0000-4000-8000-0000000000e6','a3e30200-0000-4000-8000-0000000000f5'),('a3e30200-0000-4000-8000-0000000000e7','a3e30200-0000-4000-8000-0000000000f7'),
   ('a3e30200-0000-4000-8000-0000000000e8','a3e30200-0000-4000-8000-0000000000fa')) x(sub,form) LOOP
   IF r->>'stage_id' IS DISTINCT FROM 'a3e30200-0000-4000-8000-0000000000d1' OR r->>'campaign_brief_id' IS NOT NULL THEN
     RAISE EXCEPTION 'FAIL: no campaign route (archived pipeline, no open stage, archived campaign, foreign pipeline, no campaign) → the default pipeline, got %',r; END IF;
 END LOOP;
 -- 2e. A form that routes its own deals is still refused, campaign or not: its own route is the one route.
 BEGIN
   r := pg_temp.file('a3e30200-0000-4000-8000-0000000000e9','a3e30200-0000-4000-8000-000000000011','a3e30200-0000-4000-8000-0000000000f6','a3e30200-0000-4000-8000-0000000000b2');
   RAISE EXCEPTION 'FAIL: a form with its own route is refused';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'FORM_DEAL_ROUTE_INVALID' THEN RAISE EXCEPTION 'FAIL: refused for its own route, got %',SQLERRM; END IF;
 END;
END $file$;
-- 2f. No Sales structure was touched: the campaign pipeline still has only its own stages and no new pipeline exists.
SELECT pg_temp.require_true((SELECT count(*) FROM public.pipelines WHERE tenant_id='a3e30200-0000-4000-8000-000000000011')=4,'no pipeline was created');
SELECT pg_temp.require_true((SELECT count(*) FROM public.deals WHERE tenant_id='a3e30200-0000-4000-8000-000000000011')=3,'three deals: one in the campaign pipeline, two in the default (b2, b3)');

-- 3. The metric: a live form with a campaign route counts as routed. Workspace B has no default pipeline,
--    so routing there comes from its own campaign alone.
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000003');
SELECT pg_temp.require_true((SELECT (b#>>'{values,count}')||'|'||(b#>>'{coverage,contributing_count}') FROM (SELECT public._marketing_metric_bundle('a3e30200-0000-4000-8000-000000000012','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x)='1|2',
 'B: 2 live forms, 1 unrouted (the campaign form is routed by its campaign''s pipeline, the loose form is not)');
SELECT pg_temp.as_service();
UPDATE public.campaign_briefs SET pipeline_id=NULL WHERE id='a3e30200-0000-4000-8000-0000000000c9';
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000003');
SELECT pg_temp.require_true((SELECT b#>>'{values,count}' FROM (SELECT public._marketing_metric_bundle('a3e30200-0000-4000-8000-000000000012','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x)='2',
 'B: without the campaign''s pipeline both forms are unrouted again (the metric follows the same rule as the filing)');
SELECT pg_temp.require_true((SELECT b->>'definition' FROM (SELECT public._marketing_metric_bundle('a3e30200-0000-4000-8000-000000000012','marketing.forms.unrouted_current','1.0.0',now()-interval '30 days',now(),now(),'{}') b) x) LIKE '%no single campaign whose pipeline has an open stage%',
 'the metric''s definition says so');

-- 4. The read the screens use.
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000002');
DO $read_member$ DECLARE r jsonb; BEGIN
 r := public.get_form_campaign_routes(NULL);
 IF jsonb_array_length(r->'routes')<>3 THEN RAISE EXCEPTION 'FAIL: A''s routes are f1, f6 and f8 (f6 is listed; its own route wins on screen), got %',r; END IF;
 IF NOT r->'routes' @> jsonb_build_array(jsonb_build_object('form_id','a3e30200-0000-4000-8000-0000000000f1','brief_name','Consult push','pipeline_name','Consult pipeline','stage_label','Discovery','stage_id','a3e30200-0000-4000-8000-0000000000d3')) THEN
   RAISE EXCEPTION 'FAIL: a member reads f1''s campaign, pipeline and stage, got %',r; END IF;
 IF r::text LIKE '%B campaign pipeline%' OR r::text LIKE '%a3e30200-0000-4000-8000-0000000000fb%' THEN RAISE EXCEPTION 'FAIL: nothing of another workspace, got %',r; END IF;
END $read_member$;
SELECT pg_temp.as_user('a3e30200-0000-4000-8000-000000000003');
DO $cross$ BEGIN
 BEGIN PERFORM public.get_form_campaign_routes('a3e30200-0000-4000-8000-000000000011');
 EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL: naming another workspace is refused';
END $cross$;
SELECT pg_temp.require_true(NOT has_function_privilege('anon','public.get_form_campaign_routes(uuid)','EXECUTE'),'anonymous callers cannot read routes');
SELECT pg_temp.require_true(NOT has_function_privilege('authenticated','public.growth_attach_submission_default_deal(uuid,integer)','EXECUTE'),'the filing function stays service-only');

ROLLBACK;
