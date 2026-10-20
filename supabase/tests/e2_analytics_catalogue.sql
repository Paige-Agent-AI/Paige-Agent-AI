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
ROLLBACK;
