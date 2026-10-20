-- Disposable empty PostgreSQL only. Every fixture and test role rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.paige_skills (
  slug text PRIMARY KEY, name text, description text, category text,
  trigger_phrases text[], steps jsonb, allowed_tools text[], risk_level text,
  autonomy_lane text, methodology_anchor text, tier_availability jsonb,
  scoping text, created_by text, status text, require_admin_confirm_first_n integer
);
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
\ir ../migrations/20271112160000_e2_analytics_catalogue_descriptions.sql
DO $$ BEGIN
  IF (SELECT count(*) FROM public.paige_skills s JOIN catalogue_before b USING (slug)
      WHERE s.description IS DISTINCT FROM b.description) <> 9 THEN
    RAISE EXCEPTION 'Expected all nine seeded descriptions to be corrected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN catalogue_before b USING (slug)
      WHERE (to_jsonb(s) - 'description') IS DISTINCT FROM (to_jsonb(b) - 'description')) THEN
    RAISE EXCEPTION 'Metadata correction changed identity, tools, tier, lane or activation';
  END IF;
  IF (SELECT count(*) FROM public.paige_skills) <> 9 THEN
    RAISE EXCEPTION 'Correction inserted or deleted a catalogue row';
  END IF;
END $$;
\echo 'PASS: nine descriptions corrected; every non-description field preserved'
CREATE TEMP TABLE catalogue_after AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271112160000_e2_analytics_catalogue_descriptions.sql
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
UPDATE public.paige_skills SET created_by = 'test-author' WHERE slug = 'churn_signal_detection';
UPDATE public.paige_skills SET description = 'Custom description' WHERE slug = 'cohort_analysis';
UPDATE public.paige_skills SET category = 'custom' WHERE slug = 'conversion_funnel_diagnosis';
UPDATE public.paige_skills SET name = 'Custom name' WHERE slug = 'engagement_read';
UPDATE public.paige_skills SET status = 'inactive' WHERE slug = 'monthly_qbr_draft';
INSERT INTO public.paige_skills SELECT 'test-unrelated-skill', name, description, category,
  trigger_phrases, steps, allowed_tools, risk_level, autonomy_lane, methodology_anchor,
  tier_availability, scoping, created_by, status, require_admin_confirm_first_n
  FROM catalogue_before WHERE slug = 'weekly_business_review';
CREATE TEMP TABLE guarded_before AS SELECT * FROM public.paige_skills;
\ir ../migrations/20271112160000_e2_analytics_catalogue_descriptions.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN guarded_before b USING (slug)
      WHERE s.slug IN ('ad_spend_efficiency','churn_signal_detection','cohort_analysis',
        'conversion_funnel_diagnosis','engagement_read','test-unrelated-skill')
        AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN
    RAISE EXCEPTION 'Tenant, custom, reclassified, renamed or unrelated row was overwritten';
  END IF;
  IF (SELECT status FROM public.paige_skills WHERE slug = 'monthly_qbr_draft') <> 'inactive'
      OR (SELECT description FROM public.paige_skills WHERE slug = 'monthly_qbr_draft') =
         (SELECT description FROM catalogue_before WHERE slug = 'monthly_qbr_draft') THEN
    RAISE EXCEPTION 'Inactive row was reactivated or its eligible copy was not corrected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.paige_skills s JOIN guarded_before b USING (slug)
      WHERE (to_jsonb(s) - 'description') IS DISTINCT FROM (to_jsonb(b) - 'description')) THEN
    RAISE EXCEPTION 'Correction widened activation, tools or entitlements';
  END IF;
END $$;
\echo 'PASS: tenant/custom/name/category/slug guards; inactive stays inactive'
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
ROLLBACK;
