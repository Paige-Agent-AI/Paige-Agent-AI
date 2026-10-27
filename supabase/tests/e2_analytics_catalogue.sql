-- Disposable empty PostgreSQL only. Every fixture and test role rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.paige_skills (
  id uuid DEFAULT gen_random_uuid(), metadata jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT '2000-01-01T00:00:00Z',
  slug text PRIMARY KEY, name text, description text, category text,
  trigger_phrases text[], steps jsonb, allowed_tools text[], risk_level text,
  autonomy_lane text, methodology_anchor text, tier_availability jsonb,
  scoping text, created_by text CHECK (created_by IN ('system','paige','admin')),
  status text CHECK (status IN ('active','draft','disabled')), require_admin_confirm_first_n integer
);
-- The real catalogue has an ordinary updated_at trigger. It is not an authority field.
CREATE FUNCTION public.test_e2_catalogue_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER test_e2_catalogue_touch BEFORE UPDATE ON public.paige_skills
  FOR EACH ROW EXECUTE FUNCTION public.test_e2_catalogue_touch();
\ir ../migrations/20260903000000_skills_s2_cat6_analytics_interpretation.sql
CREATE TEMP TABLE catalogue_before AS SELECT * FROM public.paige_skills;
CREATE ROLE test_e2_catalogue_reader NOLOGIN;
GRANT SELECT ON public.paige_skills TO test_e2_catalogue_reader;
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
  BEGIN
    UPDATE public.paige_skills SET description = 'unauthorized';
    RAISE EXCEPTION 'Reader gained catalogue update permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\ir ../migrations/20271113010000_e2_analytics_catalogue_descriptions.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills s JOIN catalogue_before b USING (slug)
      WHERE s.description IS DISTINCT FROM b.description) <> 9 THEN
    RAISE EXCEPTION 'Expected all nine seeded descriptions to be corrected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN catalogue_before b USING (slug)
      WHERE (to_jsonb(s) - 'description' - 'updated_at') IS DISTINCT FROM (to_jsonb(b) - 'description' - 'updated_at')) THEN
    RAISE EXCEPTION 'Metadata correction changed identity, tools, tier, lane or activation';
  END IF;
  IF (SELECT count(*) FROM public.paige_skills) <> 9 THEN
    RAISE EXCEPTION 'Correction inserted or deleted a catalogue row';
  END IF;
END $$;
\echo 'PASS: nine descriptions corrected; identity, metadata and execution fields preserved'
CREATE TEMP TABLE catalogue_after AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271113010000_e2_analytics_catalogue_descriptions.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN catalogue_after b USING (slug)
      WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Replay changed the already-corrected catalogue';
  END IF;
END $$;
\echo 'PASS: forward metadata replay is idempotent'
-- Reset fixtures only, then challenge every custom/source-boundary guard.
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills SELECT * FROM catalogue_before;
UPDATE public.paige_skills SET scoping = 'tenant' WHERE slug = 'ad_spend_efficiency';
UPDATE public.paige_skills SET created_by = 'admin' WHERE slug = 'churn_signal_detection';
UPDATE public.paige_skills SET description = 'Custom description' WHERE slug = 'cohort_analysis';
UPDATE public.paige_skills SET category = 'marketing_content' WHERE slug = 'conversion_funnel_diagnosis';
UPDATE public.paige_skills SET name = 'Custom name' WHERE slug = 'engagement_read';
UPDATE public.paige_skills SET status = 'disabled' WHERE slug = 'monthly_qbr_draft';
INSERT INTO public.paige_skills (slug,name,description,category,trigger_phrases,steps,
  allowed_tools,risk_level,autonomy_lane,methodology_anchor,tier_availability,
  scoping,created_by,status,require_admin_confirm_first_n)
SELECT 'test-unrelated-skill', name, description, category,
  trigger_phrases, steps, allowed_tools, risk_level, autonomy_lane, methodology_anchor,
  tier_availability, scoping, created_by, status, require_admin_confirm_first_n
  FROM catalogue_before WHERE slug = 'weekly_business_review';
CREATE TEMP TABLE guarded_before AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271113010000_e2_analytics_catalogue_descriptions.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN guarded_before b USING (slug)
      WHERE s.slug IN ('ad_spend_efficiency','churn_signal_detection','cohort_analysis',
        'conversion_funnel_diagnosis','engagement_read','test-unrelated-skill')
        AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Tenant, custom, reclassified, renamed or unrelated row was overwritten';
  END IF;
  IF (SELECT status FROM public.paige_skills WHERE slug = 'monthly_qbr_draft') <> 'disabled'
      OR (SELECT description FROM public.paige_skills WHERE slug = 'monthly_qbr_draft') =
         (SELECT description FROM catalogue_before WHERE slug = 'monthly_qbr_draft') THEN
    RAISE EXCEPTION 'Inactive row was reactivated or its eligible copy was not corrected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN guarded_before b USING (slug)
      WHERE (to_jsonb(s) - 'description' - 'updated_at') IS DISTINCT FROM (to_jsonb(b) - 'description' - 'updated_at')) THEN
    RAISE EXCEPTION 'Correction widened activation, tools or entitlements';
  END IF;
END $$;
\echo 'PASS: tenant/custom/name/category/slug guards; disabled stays disabled'
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills) <> 10 THEN
    RAISE EXCEPTION 'Existing reader lost catalogue access';
  END IF;
  BEGIN
    UPDATE public.paige_skills SET description = 'unauthorized';
    RAISE EXCEPTION 'Reader gained catalogue update permission after migration';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 'PASS: read-only catalogue permission unchanged before and after migration'
-- The separate compatible public-coverage producer preserves registry authority.
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills SELECT * FROM catalogue_after;
UPDATE public.paige_skills SET metadata = '{"unrelated":"preserve","providerReady":false}';
CREATE TEMP TABLE coverage_before AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271113030000_e2_analytics_catalogue_coverage.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills WHERE metadata->'catalogue_coverage' =
      jsonb_build_object('version',1,'state', CASE
        WHEN slug IN ('ad_spend_efficiency','churn_signal_detection','cohort_analysis','engagement_read') THEN 'coming_soon'
        WHEN slug IN ('conversion_funnel_diagnosis','revenue_trend_read','weekly_business_review') THEN 'limited'
        ELSE 'unverified' END)) <> 9 THEN
    RAISE EXCEPTION 'Expected all nine exact declared-coverage states';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN coverage_before b USING (slug)
      WHERE (to_jsonb(s) - 'metadata' - 'updated_at') IS DISTINCT FROM (to_jsonb(b) - 'metadata' - 'updated_at')
         OR s.metadata - 'catalogue_coverage' IS DISTINCT FROM b.metadata) THEN
    RAISE EXCEPTION 'Coverage changed identity, execution, description or unrelated metadata';
  END IF;
END $$;
\echo 'PASS: nine exact public coverage states; unrelated metadata and authority fields preserved'
CREATE TEMP TABLE coverage_after AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271113030000_e2_analytics_catalogue_coverage.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN coverage_after b USING (slug)
      WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Coverage replay changed a declared state or touched its timestamp';
  END IF;
END $$;
\echo 'PASS: coverage replay changes zero rows'
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills SELECT * FROM catalogue_after;
UPDATE public.paige_skills SET scoping='tenant' WHERE slug='ad_spend_efficiency';
UPDATE public.paige_skills SET created_by='admin' WHERE slug='churn_signal_detection';
UPDATE public.paige_skills SET description='Custom review' WHERE slug='cohort_analysis';
UPDATE public.paige_skills SET category='marketing_content' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET name='Custom name' WHERE slug='engagement_read';
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":null}' WHERE slug='monthly_qbr_draft';
UPDATE public.paige_skills SET metadata='[]' WHERE slug='quarterly_narrative';
UPDATE public.paige_skills SET metadata=NULL WHERE slug='revenue_trend_read';
UPDATE public.paige_skills SET status='disabled' WHERE slug='weekly_business_review';
INSERT INTO public.paige_skills (slug,name,description,category,trigger_phrases,steps,
  allowed_tools,risk_level,autonomy_lane,methodology_anchor,tier_availability,
  scoping,created_by,status,require_admin_confirm_first_n)
SELECT 'test-unrelated-coverage',name,description,category,trigger_phrases,steps,
  allowed_tools,risk_level,autonomy_lane,methodology_anchor,tier_availability,
  scoping,created_by,status,require_admin_confirm_first_n
  FROM catalogue_after WHERE slug='weekly_business_review';
CREATE TEMP TABLE coverage_guarded_before AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271113030000_e2_analytics_catalogue_coverage.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN coverage_guarded_before b USING (slug)
      WHERE s.slug NOT IN ('revenue_trend_read','weekly_business_review')
        AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Coverage overwrote custom/scoped/renamed/reclassified/existing/malformed/unrelated data';
  END IF;
  IF (SELECT metadata->'catalogue_coverage' FROM public.paige_skills WHERE slug='revenue_trend_read')
      IS DISTINCT FROM '{"version":1,"state":"limited"}'::jsonb THEN
    RAISE EXCEPTION 'Null metadata did not receive its guarded public field';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.paige_skills WHERE slug='weekly_business_review'
      AND status='disabled' AND metadata->'catalogue_coverage'='{"version":1,"state":"limited"}'::jsonb) THEN
    RAISE EXCEPTION 'Coverage changed disabled authority or lost declared coverage';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN coverage_guarded_before b USING (slug)
      WHERE (to_jsonb(s) - 'metadata' - 'updated_at') IS DISTINCT FROM (to_jsonb(b) - 'metadata' - 'updated_at')) THEN
    RAISE EXCEPTION 'Coverage changed non-metadata fields';
  END IF;
END $$;
\echo 'PASS: all custom/scoped/malformed/existing-field guards, null metadata and disabled authority'
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
  BEGIN
    UPDATE public.paige_skills SET metadata='{}';
    RAISE EXCEPTION 'Reader gained metadata write authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 'PASS: coverage added no reader write authority'

-- Released intake copy uses the SAME migration/registry and protects every other field.
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills SELECT * FROM catalogue_after;
\ir ../migrations/20271113030000_e2_analytics_catalogue_coverage.sql
CREATE TEMP TABLE intake_copy_before AS TABLE public.paige_skills;
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills s JOIN intake_copy_before b USING (slug)
      WHERE s.description IS DISTINCT FROM b.description) <> 2
      OR (SELECT count(*) FROM public.paige_skills) <> 9 THEN
    RAISE EXCEPTION 'Intake copy did not change exactly the two existing descriptions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN intake_copy_before b USING (slug)
      WHERE s.slug NOT IN ('conversion_funnel_diagnosis','weekly_business_review')
        AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Intake copy changed another capability';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN intake_copy_before b USING (slug)
      WHERE (to_jsonb(s)-'description'-'updated_at') IS DISTINCT FROM (to_jsonb(b)-'description'-'updated_at')) THEN
    RAISE EXCEPTION 'Intake copy changed coverage, identity, tools, tiers, lanes or activation';
  END IF;
  IF (SELECT count(*) FROM public.paige_skills
      WHERE slug IN ('conversion_funnel_diagnosis','weekly_business_review')
        AND description LIKE '%recorded form intake%'
        AND metadata->'catalogue_coverage'='{"version":1,"state":"limited"}'::jsonb) <> 2 THEN
    RAISE EXCEPTION 'Recorded intake is missing or Limited coverage changed';
  END IF;
END $$;
\echo 'PASS: two intake descriptions, seven untouched capabilities and all authority fields preserved'
CREATE TEMP TABLE intake_copy_after AS TABLE public.paige_skills;
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN intake_copy_after b USING (slug)
      WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Intake copy replay changed the corrected registry';
  END IF;
END $$;
\echo 'PASS: intake copy replay is idempotent including update timestamps'

CREATE TEMP TABLE intake_guarded_before AS TABLE intake_copy_before WITH NO DATA;
CREATE FUNCTION pg_temp.reset_intake_copy_case() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.paige_skills;
  INSERT INTO public.paige_skills SELECT * FROM intake_copy_before;
END $$;
CREATE FUNCTION pg_temp.snapshot_intake_copy_case() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE intake_guarded_before;
  INSERT INTO intake_guarded_before SELECT * FROM public.paige_skills;
END $$;
CREATE FUNCTION pg_temp.assert_intake_copy_unchanged() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN intake_guarded_before b USING (slug)
      WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Intake copy overwrote a protected classification or custom row';
  END IF;
END $$;

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET description='Custom intake copy' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET name='Custom weekly review' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET scoping='tenant' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET created_by='admin' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET category='marketing_content' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET risk_level='high' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":2,"state":"limited"}}' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"coming_soon"}}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET metadata='[]' WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"limited","providerReady":true}}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET metadata=NULL WHERE slug='conversion_funnel_diagnosis';
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":null}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_intake_copy_case();
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
SELECT pg_temp.assert_intake_copy_unchanged();
\echo 'PASS: intake custom/name/scope/author/category/risk/version/state/malformed/extra/null guards'

SELECT pg_temp.reset_intake_copy_case();
UPDATE public.paige_skills SET status='disabled' WHERE slug IN ('conversion_funnel_diagnosis','weekly_business_review');
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills WHERE slug IN ('conversion_funnel_diagnosis','weekly_business_review')
      AND status='disabled' AND description LIKE '%recorded form intake%'
      AND metadata->'catalogue_coverage'='{"version":1,"state":"limited"}'::jsonb) <> 2 THEN
    RAISE EXCEPTION 'Intake correction activated a disabled skill or changed its coverage';
  END IF;
END $$;
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
  BEGIN
    UPDATE public.paige_skills SET description='unauthorized intake change';
    RAISE EXCEPTION 'Intake correction granted reader update authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
\echo 'PASS: disabled skills remain disabled and existing reader gains no write authority'
-- Additive current consumer proof; every original catalogue control above remains.
\ir e2_email_review_catalogue.sql
ROLLBACK;
