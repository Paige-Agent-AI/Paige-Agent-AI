-- Runs only inside the incumbent disposable catalogue transaction/reader role.
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills SELECT * FROM catalogue_after;
\ir ../migrations/20271113030000_e2_analytics_catalogue_coverage.sql
\ir ../migrations/20271113170000_e2_intake_catalogue_copy.sql
INSERT INTO public.paige_skills (slug,name,description,category,scoping,created_by,risk_level,metadata,status)
SELECT 'test-unrelated-weekly-source',name,description,category,scoping,created_by,risk_level,metadata,status
FROM public.paige_skills WHERE slug='weekly_business_review';
CREATE TEMP TABLE weekly_source_before AS TABLE public.paige_skills;
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.paige_skills s JOIN weekly_source_before b USING(slug)
     WHERE s.description IS DISTINCT FROM b.description) <> 1
   OR (SELECT count(*) FROM public.paige_skills) <> 10
 THEN RAISE EXCEPTION 'Weekly source copy must change exactly one existing description'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN weekly_source_before b USING(slug)
     WHERE (to_jsonb(s)-'description'-'updated_at') IS DISTINCT FROM (to_jsonb(b)-'description'-'updated_at'))
 THEN RAISE EXCEPTION 'Weekly source copy changed identity, coverage, tools, tiers, lane or activation'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN weekly_source_before b USING(slug)
     WHERE s.slug <> 'weekly_business_review' AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b))
 THEN RAISE EXCEPTION 'Weekly copy changed another analytics or unrelated row'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paige_skills WHERE slug='weekly_business_review'
     AND description LIKE '%saved appointments%' AND description LIKE '%recorded activity%'
     AND description LIKE '%not verify%' AND description LIKE '%read-only%'
     AND metadata->'catalogue_coverage'='{"version":1,"state":"limited"}'::jsonb)
 THEN RAISE EXCEPTION 'Weekly copy lost source limits or Limited status'; END IF;
END $$;
\echo 'PASS: one weekly description; other eight, unrelated row and every authority field preserved'
CREATE TEMP TABLE weekly_source_after AS TABLE public.paige_skills;
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN weekly_source_after b USING(slug)
     WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b))
 THEN RAISE EXCEPTION 'Weekly source copy replay touched registry or timestamps'; END IF;
END $$;
\echo 'PASS: weekly source copy replay is fully idempotent'

CREATE TEMP TABLE weekly_source_guarded AS TABLE weekly_source_before WITH NO DATA;
CREATE FUNCTION pg_temp.reset_weekly_source_case() RETURNS void LANGUAGE plpgsql AS $$
BEGIN TRUNCATE public.paige_skills; INSERT INTO public.paige_skills SELECT * FROM weekly_source_before; END $$;
CREATE FUNCTION pg_temp.snapshot_weekly_source_case() RETURNS void LANGUAGE plpgsql AS $$
BEGIN TRUNCATE weekly_source_guarded; INSERT INTO weekly_source_guarded SELECT * FROM public.paige_skills; END $$;
CREATE FUNCTION pg_temp.assert_weekly_source_unchanged() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN weekly_source_guarded b USING(slug)
     WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b))
 THEN RAISE EXCEPTION 'Weekly source copy overwrote custom/noncanonical/malformed registry state'; END IF;
END $$;

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET description='Custom weekly description' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET name='Custom weekly name' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET scoping='tenant' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET created_by='admin' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET category='marketing_content' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET risk_level='high' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":2,"state":"limited"}}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"live"}}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"limited","providerReady":true}}' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET metadata='[]' WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET metadata=NULL WHERE slug='weekly_business_review';
SELECT pg_temp.snapshot_weekly_source_case();
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
SELECT pg_temp.assert_weekly_source_unchanged();
\echo 'PASS: weekly custom/name/tenant/author/category/risk/version/state/extra/malformed/null guards'

SELECT pg_temp.reset_weekly_source_case();
UPDATE public.paige_skills SET status='disabled' WHERE slug='weekly_business_review';
\ir ../migrations/20271120101002_e2_weekly_review_source_copy.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.paige_skills WHERE slug='weekly_business_review' AND status='disabled'
     AND description LIKE '%saved appointments%' AND metadata->'catalogue_coverage'='{"version":1,"state":"limited"}'::jsonb)
 THEN RAISE EXCEPTION 'Weekly copy activated disabled capability or lost its source/status limits'; END IF;
END $$;
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
 BEGIN
  UPDATE public.paige_skills SET description='unauthorized weekly correction';
  RAISE EXCEPTION 'Weekly copy granted reader catalogue write access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'PASS: disabled weekly skill remains disabled; reader gains no write access'
