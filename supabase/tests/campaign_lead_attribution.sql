-- ISOLATED full production-schema-only clone only; never execute on production.
-- Experience 03 (Grow My Business) S1: a lead carries the campaign it came from, and the campaign reads
-- its leads back. Real auth users, JWT identity, membership triggers, the real asset-link writer and the
-- real default-pipeline intake writer. Rolled back.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_denied(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.attach(brief text,asset text,key text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_campaign_brief_assets(NULL,jsonb_build_object('type','attach_asset','briefId',brief,'assetKind','form','assetId',asset),key,'human') $$;
-- One submission as the public writer saves it (no contact yet), with the link's tags.
CREATE FUNCTION pg_temp.submit(p_sub text,p_tenant text,p_form text,p_utm jsonb) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,payload_json,utm_json,source)
 VALUES(p_sub::uuid,p_tenant::uuid,p_form::uuid,'{"name":"Synthetic Prospect"}',p_utm,'paige_form') $$;
-- Parameters are never named like a column: `WHERE id = id` would match every row.
CREATE FUNCTION pg_temp.stamp(p_sub text) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(s.campaign_attribution,'<null>')||':'||coalesce(s.campaign_brief_id::text,'-')
 FROM public.growth_form_submissions s WHERE s.id=p_sub::uuid $$;

INSERT INTO auth.users(id,email) VALUES
 ('a3e30100-0000-4000-8000-000000000001','exp03-admin@example.invalid'),
 ('a3e30100-0000-4000-8000-000000000002','exp03-member@example.invalid'),
 ('a3e30100-0000-4000-8000-000000000003','exp03-other@example.invalid'),
 ('a3e30100-0000-4000-8000-000000000005','exp03-agency-owner@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a3e30100-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'exp03-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
-- Workspace A is a sub-account of an agency, so the agency's owner can act inside it without being one of its members.
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a3e30100-0000-4000-8000-000000000013','exp03-proof-agency','Exp03 proof agency','active','agency','XPG','{"system_workspace":true}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features,parent_tenant_id) VALUES
 ('a3e30100-0000-4000-8000-000000000011','exp03-proof-a','Exp03 proof A','active','standalone','XPA','{"system_workspace":true}','a3e30100-0000-4000-8000-000000000013');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a3e30100-0000-4000-8000-000000000012','exp03-proof-b','Exp03 proof B','active','standalone','XPB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-000000000001','admin','active',false),
 ('a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-000000000002','member','active',false),
 ('a3e30100-0000-4000-8000-000000000012','a3e30100-0000-4000-8000-000000000003','admin','active',false),
 ('a3e30100-0000-4000-8000-000000000013','a3e30100-0000-4000-8000-000000000005','owner','active',true);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a3e30100-0000-4000-8000-000000000001','a3e30100-0000-4000-8000-000000000011'),
 ('a3e30100-0000-4000-8000-000000000002','a3e30100-0000-4000-8000-000000000011'),
 ('a3e30100-0000-4000-8000-000000000003','a3e30100-0000-4000-8000-000000000012'),
 ('a3e30100-0000-4000-8000-000000000005','a3e30100-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

SELECT pg_temp.as_service();
-- Workspace A: a default pipeline with an open stage (where an unrouted form files its leads today).
CREATE TEMP TABLE fixtures(name text PRIMARY KEY, id uuid NOT NULL);
-- Pipeline ids are server-generated (assign_pipeline_identity), so the fixture keeps the one it was given.
SELECT set_config('app.pipeline_requested_by','a3e30100-0000-4000-8000-000000000001',true);
WITH created AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by)
  VALUES ('a3e30100-0000-4000-8000-000000000011','Sales Pipeline',true,'a3e30100-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO fixtures SELECT 'pipeline',id FROM created;
SELECT pg_temp.require_true((SELECT count(*) FROM public.pipelines WHERE tenant_id='a3e30100-0000-4000-8000-000000000011' AND is_default AND lifecycle_status<>'archived')=1,
  'FIXTURE: the workspace has exactly one default pipeline, so the intake writer''s pick is this one');
INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,stage_type,order_index) VALUES
 ('a3e30100-0000-4000-8000-0000000000d2',(SELECT id FROM fixtures WHERE name='pipeline'),'a3e30100-0000-4000-8000-000000000011','New lead','open',0),
 ('a3e30100-0000-4000-8000-0000000000d3',(SELECT id FROM fixtures WHERE name='pipeline'),'a3e30100-0000-4000-8000-000000000011','Won','won',9);
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status,created_by) VALUES
 ('a3e30100-0000-4000-8000-0000000000f1','a3e30100-0000-4000-8000-000000000011','exp03-spring','Spring consult request','active','a3e30100-0000-4000-8000-000000000001'),
 ('a3e30100-0000-4000-8000-0000000000f2','a3e30100-0000-4000-8000-000000000011','exp03-shared','Shared newsletter form','active','a3e30100-0000-4000-8000-000000000001'),
 ('a3e30100-0000-4000-8000-0000000000f3','a3e30100-0000-4000-8000-000000000011','exp03-loose','Contact us','active','a3e30100-0000-4000-8000-000000000001'),
 ('a3e30100-0000-4000-8000-0000000000f4','a3e30100-0000-4000-8000-000000000011','exp03-old','Old offer form','active','a3e30100-0000-4000-8000-000000000001'),
 ('a3e30100-0000-4000-8000-0000000000f9','a3e30100-0000-4000-8000-000000000012','exp03-b','Other workspace form','active','a3e30100-0000-4000-8000-000000000003');
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status,desired_outcome,success_definition) VALUES
 ('a3e30100-0000-4000-8000-0000000000c1','a3e30100-0000-4000-8000-000000000011','CB-SPRING','Spring consults','approved','10 new consult clients','10 booked consults by 31 March'),
 ('a3e30100-0000-4000-8000-0000000000c2','a3e30100-0000-4000-8000-000000000011','CB-FALL','Fall workshop','draft',NULL,NULL),
 ('a3e30100-0000-4000-8000-0000000000c3','a3e30100-0000-4000-8000-000000000011','CB-OLD','Last year','draft',NULL,NULL),
 -- Workspace B uses the SAME reference: a tag must never cross workspaces.
 ('a3e30100-0000-4000-8000-0000000000c9','a3e30100-0000-4000-8000-000000000012','CB-SPRING','Other workspace spring','draft',NULL,NULL);

-- The owner attaches forms through the real writer: f1 → Spring; f2 → Spring AND Fall; f4 → Old (then archived).
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000001');
SELECT pg_temp.require_true(pg_temp.attach('a3e30100-0000-4000-8000-0000000000c1','a3e30100-0000-4000-8000-0000000000f1','exp03-a1')->>'ok'='true','attach f1 to Spring');
SELECT pg_temp.require_true(pg_temp.attach('a3e30100-0000-4000-8000-0000000000c1','a3e30100-0000-4000-8000-0000000000f2','exp03-a2')->>'ok'='true','attach f2 to Spring');
SELECT pg_temp.require_true(pg_temp.attach('a3e30100-0000-4000-8000-0000000000c2','a3e30100-0000-4000-8000-0000000000f2','exp03-a3')->>'ok'='true','attach f2 to Fall');
SELECT pg_temp.require_true(pg_temp.attach('a3e30100-0000-4000-8000-0000000000c3','a3e30100-0000-4000-8000-0000000000f4','exp03-a4')->>'ok'='true','attach f4 to Old');
SELECT pg_temp.require_true((SELECT count(*) FROM public.campaign_brief_asset_links WHERE tenant_id='a3e30100-0000-4000-8000-000000000011' AND asset_kind='form')=4,'four form links exist');
SELECT pg_temp.as_service();
UPDATE public.campaign_briefs SET lifecycle_status='archived' WHERE id='a3e30100-0000-4000-8000-0000000000c3';

-- 1. The stamp, case by case.
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e1','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f1','{"utm_source":"newsletter","utm_campaign":" cb-spring "}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e1')='form_and_tag:a3e30100-0000-4000-8000-0000000000c1','form attached to Spring + Spring tag (case/space-insensitive) → form_and_tag');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e2','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f1','{}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e2')='form_link:a3e30100-0000-4000-8000-0000000000c1','form attached to one campaign, no tag → form_link');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e3','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f3','{"utm_campaign":"CB-FALL"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e3')='campaign_tag:a3e30100-0000-4000-8000-0000000000c2','unattached form, Fall tag → campaign_tag');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e4','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f2','{}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e4')='ambiguous:-','form in two campaigns, no tag → ambiguous, no campaign chosen');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e5','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f2','{"utm_campaign":"CB-FALL"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e5')='form_and_tag:a3e30100-0000-4000-8000-0000000000c2','form in two campaigns, tag picks one of them → form_and_tag');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e6','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f1','{"utm_campaign":"CB-FALL"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e6')='ambiguous:-','form says Spring, tag says Fall → ambiguous, never guessed');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e7','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f4','{}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e7')='none:-','a form attached only to an archived campaign is not credited by its link → none');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e8','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f3','{"utm_campaign":"nobody"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e8')='none:-','unknown tag, unattached form → none');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000e9','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f3','{"utm_campaign":["CB-FALL"]}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e9')='none:-','a non-string tag is never matched (as the metric)');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000ea','a3e30100-0000-4000-8000-000000000012','a3e30100-0000-4000-8000-0000000000f9','{"utm_campaign":"CB-SPRING"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000ea')='campaign_tag:a3e30100-0000-4000-8000-0000000000c9','workspace B''s CB-SPRING is its own; A''s is never chosen');
-- A writer cannot pre-set the stamp: the trigger replaces it.
INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,payload_json,utm_json,campaign_brief_id,campaign_attribution)
VALUES('a3e30100-0000-4000-8000-0000000000eb','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f3','{}','{}','a3e30100-0000-4000-8000-0000000000c9','form_link');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000eb')='none:-','a supplied campaign (even another workspace''s) is replaced by the decision');
-- A reference two campaigns share names neither, as the metric excludes it (campaign_tag_matches_several_briefs).
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status) VALUES
 ('a3e30100-0000-4000-8000-0000000000c4','a3e30100-0000-4000-8000-000000000011','cb-spring','A copy with the same reference','draft');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000ec','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f1','{"utm_campaign":"CB-SPRING"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000ec')='form_link:a3e30100-0000-4000-8000-0000000000c1','a tag shared by two campaigns names neither; the form''s one link still credits Spring');
SELECT pg_temp.submit('a3e30100-0000-4000-8000-0000000000ed','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000f3','{"utm_campaign":"CB-SPRING"}');
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000ed')='none:-','a shared tag on an unattached form credits no campaign');
DELETE FROM public.campaign_briefs WHERE id='a3e30100-0000-4000-8000-0000000000c4';

-- 2. The stamp is fixed after capture.
DO $immutable$ BEGIN
 BEGIN UPDATE public.growth_form_submissions SET campaign_brief_id='a3e30100-0000-4000-8000-0000000000c2' WHERE id='a3e30100-0000-4000-8000-0000000000e2';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'SUBMISSION_ATTRIBUTION_IMMUTABLE' THEN RAISE; END IF; RETURN; END;
 RAISE EXCEPTION 'FAIL: the campaign cannot be changed after capture';
END $immutable$;
DO $immutable2$ BEGIN
 BEGIN UPDATE public.growth_form_submissions SET campaign_attribution='none' WHERE id='a3e30100-0000-4000-8000-0000000000e2';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'SUBMISSION_ATTRIBUTION_IMMUTABLE' THEN RAISE; END IF; RETURN; END;
 RAISE EXCEPTION 'FAIL: the attribution method cannot be changed after capture';
END $immutable2$;
-- The same holds for a workspace member through the browser role and the table's own update policy, which
-- does not check role: clearing the campaign to nothing is refused, not only changing it.
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $member_clear$ DECLARE n int; BEGIN
 BEGIN UPDATE public.growth_form_submissions SET campaign_brief_id=NULL WHERE id='a3e30100-0000-4000-8000-0000000000e2';
   GET DIAGNOSTICS n = ROW_COUNT;
   IF n=0 THEN RAISE EXCEPTION 'FAIL: FIXTURE: the member''s update reached no row, so nothing was tested'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'SUBMISSION_ATTRIBUTION_IMMUTABLE' THEN RAISE; END IF; RETURN; END;
 RAISE EXCEPTION 'FAIL: a member cannot clear a lead''s campaign';
END $member_clear$;
DO $member_method$ BEGIN
 BEGIN UPDATE public.growth_form_submissions SET campaign_attribution='ambiguous',campaign_brief_id=NULL WHERE id='a3e30100-0000-4000-8000-0000000000e2';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'SUBMISSION_ATTRIBUTION_IMMUTABLE' THEN RAISE; END IF; RETURN; END;
 RAISE EXCEPTION 'FAIL: a member cannot rewrite how a lead was credited';
END $member_method$;
RESET ROLE;
SELECT pg_temp.as_service();
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e2')='form_link:a3e30100-0000-4000-8000-0000000000c1','after both refusals the lead is still Spring''s');
-- Ordinary processing updates still work.
UPDATE public.growth_form_submissions SET processing_state='done' WHERE id='a3e30100-0000-4000-8000-0000000000e8';
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e8')='none:-','processing updates leave the stamp as it was');

-- 3. The lead becomes a contact and an opportunity through the REAL intake writer, then reads back.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number,lifecycle_stage,source) VALUES
 ('a3e30100-0000-4000-8000-0000000000b1','a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-000000000001','Synthetic','Prospect','XPA-1','new_lead','paige_form');
UPDATE public.growth_form_submissions SET contact_id='a3e30100-0000-4000-8000-0000000000b1',processing_state='claimed',attempts=1
 WHERE id='a3e30100-0000-4000-8000-0000000000e1';
DO $deal$ DECLARE r jsonb; BEGIN
 r := public.growth_attach_submission_default_deal('a3e30100-0000-4000-8000-0000000000e1',1);
 IF r->>'deal_id' IS NULL OR r->>'stage_id' IS DISTINCT FROM 'a3e30100-0000-4000-8000-0000000000d2' THEN
   RAISE EXCEPTION 'FAIL: the unrouted form files its lead into the default pipeline''s first open stage, got %',r; END IF;
END $deal$;
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e1')='form_and_tag:a3e30100-0000-4000-8000-0000000000c1','filing the deal leaves the campaign on the lead');

-- 3a. The owner/admin reads the campaign's leads with names, opportunity, pipeline and stage.
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000001');
DO $read_admin$ DECLARE r jsonb; l jsonb; BEGIN
 r := public.get_campaign_brief_leads(NULL,'a3e30100-0000-4000-8000-0000000000c1');
 IF (r->>'can_manage')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: admin can manage, got %',r; END IF;
 IF (r->'counts'->>'leads')::int<>3 OR (r->'counts'->>'with_opportunity')::int<>1 OR (r->'counts'->>'open')::int<>1 OR (r->'counts'->>'with_contact')::int<>1 THEN
   RAISE EXCEPTION 'FAIL: Spring has 3 leads (e1, e2, ec), 1 contact, 1 open opportunity; got %',r->'counts'; END IF;
 IF (r->>'ambiguous_on_campaign_forms')::int<>2 THEN RAISE EXCEPTION 'FAIL: e4 and e6 on Spring''s forms could not be credited, got %',r->>'ambiguous_on_campaign_forms'; END IF;
 IF jsonb_array_length(r->'capture_forms')<>2 THEN RAISE EXCEPTION 'FAIL: Spring captures through f1 and f2, got %',r->'capture_forms'; END IF;
 SELECT x INTO l FROM jsonb_array_elements(r->'leads') x WHERE x->>'submission_id'='a3e30100-0000-4000-8000-0000000000e1';
 IF l->>'contact_name' IS DISTINCT FROM 'Synthetic Prospect' OR l->>'pipeline_name' IS DISTINCT FROM 'Sales Pipeline'
    OR l->>'stage_label' IS DISTINCT FROM 'New lead' OR l->>'deal_status' IS DISTINCT FROM 'open' OR l->>'attribution' IS DISTINCT FROM 'form_and_tag'
    OR l->>'deal_id' IS NULL OR l->>'form_name' IS DISTINCT FROM 'Spring consult request' THEN
   RAISE EXCEPTION 'FAIL: the verified lead reads back with its contact, opportunity and attribution, got %',l; END IF;
 IF (r->>'truncated')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL: not truncated'; END IF;
END $read_admin$;

-- 3b. A member reads counts, attribution and stages, never names or opportunity titles.
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000002');
DO $read_member$ DECLARE r jsonb; l jsonb; BEGIN
 r := public.get_campaign_brief_leads(NULL,'a3e30100-0000-4000-8000-0000000000c1');
 IF (r->>'can_manage')::boolean IS DISTINCT FROM false OR (r->'counts'->>'leads')::int<>3 THEN RAISE EXCEPTION 'FAIL: member sees counts, got %',r; END IF;
 SELECT x INTO l FROM jsonb_array_elements(r->'leads') x WHERE x->>'submission_id'='a3e30100-0000-4000-8000-0000000000e1';
 IF l->>'contact_name' IS NOT NULL OR l->>'contact_id' IS NOT NULL OR l->>'deal_title' IS NOT NULL OR l->>'deal_id' IS NOT NULL THEN
   RAISE EXCEPTION 'FAIL: a member never sees names or ids, got %',l; END IF;
 IF l->>'stage_label' IS DISTINCT FROM 'New lead' OR (l->>'has_contact')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: member sees the stage, got %',l; END IF;
END $read_member$;

-- 3b2. The agency's owner, working inside the sub-account, reads like a member: counts and stages, no names or ids.
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000005');
SELECT pg_temp.require_true(public.current_user_tenant_id()='a3e30100-0000-4000-8000-000000000011'
  AND NOT public.is_tenant_admin('a3e30100-0000-4000-8000-000000000011'),
  'FIXTURE: the agency owner is acting inside workspace A and is not one of its admins');
DO $read_agency$ DECLARE r jsonb; l jsonb; BEGIN
 r := public.get_campaign_brief_leads(NULL,'a3e30100-0000-4000-8000-0000000000c1');
 IF (r->>'can_manage')::boolean IS DISTINCT FROM false OR (r->'counts'->>'leads')::int<>3 THEN RAISE EXCEPTION 'FAIL: agency manager sees counts only, got %',r; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'leads') x
            WHERE x->>'contact_name' IS NOT NULL OR x->>'contact_id' IS NOT NULL OR x->>'deal_title' IS NOT NULL OR x->>'deal_id' IS NOT NULL) THEN
   RAISE EXCEPTION 'FAIL: an agency manager in a sub-account never sees names or ids, got %',r->'leads'; END IF;
 SELECT x INTO l FROM jsonb_array_elements(r->'leads') x WHERE x->>'submission_id'='a3e30100-0000-4000-8000-0000000000e1';
 IF l->>'stage_label' IS DISTINCT FROM 'New lead' THEN RAISE EXCEPTION 'FAIL: agency manager sees the stage, got %',l; END IF;
END $read_agency$;

-- 3c. Another workspace's admin is refused, whether naming the campaign or the workspace.
SELECT pg_temp.as_user('a3e30100-0000-4000-8000-000000000003');
DO $cross$ BEGIN
 BEGIN PERFORM public.get_campaign_brief_leads(NULL,'a3e30100-0000-4000-8000-0000000000c1');
 EXCEPTION WHEN no_data_found THEN
   BEGIN PERFORM public.get_campaign_brief_leads('a3e30100-0000-4000-8000-000000000011','a3e30100-0000-4000-8000-0000000000c1');
   EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
   RAISE EXCEPTION 'FAIL: naming another workspace is refused';
 END;
 RAISE EXCEPTION 'FAIL: another workspace''s campaign is not found from here';
END $cross$;

-- 3d. Anonymous callers have no path; the trigger function is callable by no API role.
SELECT pg_temp.as_service();
SET LOCAL ROLE anon;
SELECT pg_temp.require_denied($$SELECT public.get_campaign_brief_leads(NULL,'a3e30100-0000-4000-8000-0000000000c1')$$,'anon cannot read a campaign''s leads');
RESET ROLE;
SELECT pg_temp.require_true(NOT has_function_privilege('authenticated','public.growth_submission_stamp_campaign()','EXECUTE')
  AND NOT has_function_privilege('anon','public.growth_submission_stamp_campaign()','EXECUTE'),'no API role can call the stamp function');

-- 4. Deleting a campaign clears its link on the lead but keeps how it was decided.
DELETE FROM public.campaign_briefs WHERE id='a3e30100-0000-4000-8000-0000000000c2';
SELECT pg_temp.require_true(pg_temp.stamp('a3e30100-0000-4000-8000-0000000000e3')='campaign_tag:-','a deleted campaign leaves the method and clears the campaign');

ROLLBACK;
