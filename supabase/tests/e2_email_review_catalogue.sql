-- Runs inside the ORIGINAL rollback-only e2_analytics_catalogue.sql fixture.
TRUNCATE public.paige_skills;
INSERT INTO public.paige_skills TABLE coverage_after;
CREATE TEMP TABLE email_copy_before AS TABLE public.paige_skills;
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.paige_skills WHERE slug='engagement_read'
     AND description LIKE 'Reviews original campaign email send counts%'
     AND metadata->'catalogue_coverage'='{"version":1,"state":"unverified"}'::jsonb)<>1
 THEN RAISE EXCEPTION 'Expected one truthful unverified email consumer entry'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN email_copy_before b USING(slug)
    WHERE (s.slug<>'engagement_read' AND to_jsonb(s) IS DISTINCT FROM to_jsonb(b))
       OR (to_jsonb(s)-'description'-'metadata'-'updated_at') IS DISTINCT FROM (to_jsonb(b)-'description'-'metadata'-'updated_at')
       OR s.metadata-'catalogue_coverage' IS DISTINCT FROM b.metadata-'catalogue_coverage')
 THEN RAISE EXCEPTION 'Email copy changed unrelated data, identity, permission or execution'; END IF;
 IF (SELECT count(*) FROM public.paige_skills)<>(SELECT count(*) FROM email_copy_before)
 THEN RAISE EXCEPTION 'Email correction inserted or removed a registry row'; END IF;
END $$;
\echo 'PASS: original email copy/Unverified only; every other field and row retained'
CREATE TEMP TABLE email_copy_after AS TABLE public.paige_skills;
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_skills s JOIN email_copy_after b USING(slug) WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b))
 THEN RAISE EXCEPTION 'Email replay changed data or timestamp'; END IF;
END $$;
\echo 'PASS: email copy replay touches zero rows'

CREATE TEMP TABLE email_guard_before AS TABLE email_copy_before WITH NO DATA;
CREATE FUNCTION pg_temp.reset_email_copy() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 TRUNCATE public.paige_skills; INSERT INTO public.paige_skills TABLE email_copy_before;
END $$;
CREATE FUNCTION pg_temp.snapshot_email_copy() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 TRUNCATE email_guard_before; INSERT INTO email_guard_before TABLE public.paige_skills;
END $$;
CREATE FUNCTION pg_temp.assert_email_unchanged() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_skills s FULL JOIN email_guard_before b USING(slug)
     WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'Custom or changed email contract overwritten'; END IF;
END $$;

SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET name='Custom name' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET description='Custom description' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET scoping='tenant' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET created_by='admin' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET category='marketing_content' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET metadata='[]' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":2,"state":"coming_soon"}}' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"live"}}' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"coming_soon","custom":true}}' WHERE slug='engagement_read';
SELECT pg_temp.snapshot_email_copy();
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
SELECT pg_temp.assert_email_unchanged();
\echo 'PASS: custom identity/copy/scope/author/category and changed metadata stay untouched'

SELECT pg_temp.reset_email_copy();
UPDATE public.paige_skills SET status='disabled' WHERE slug='engagement_read';
\ir ../migrations/20271117150002_exp02_email_review_catalogue.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.paige_skills WHERE slug='engagement_read' AND status='disabled'
     AND metadata->'catalogue_coverage'='{"version":1,"state":"unverified"}'::jsonb)
 THEN RAISE EXCEPTION 'Email copy activated a disabled capability'; END IF;
END $$;
SET LOCAL ROLE test_e2_catalogue_reader;
DO $$ BEGIN
 BEGIN
  UPDATE public.paige_skills SET description='unauthorized email correction';
  RAISE EXCEPTION 'Email copy granted a reader registry write access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'PASS: disabled remains disabled; existing reader gains no write access'
