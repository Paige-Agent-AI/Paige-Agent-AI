-- ============================================================================
-- Migration F (Vibe Studio V2b) — repeatable proof for
--   20270548000001_growth_placeholder_check_per_string.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The previous bodies of _growth_page_go_live and
-- _growth_form_go_live are carried here verbatim from 20270537000000 (the live definitions), and
-- section 0 proves they are byte-identical to production's (pg_get_functiondef md5, read 2026-10-04),
-- so "before" means what prod runs. The two tables carry production's column shapes.
--
-- What it proves:
--   0. The previous bodies are production's.
--   1. The defect, measured on the previous body: ordinary copy ("Get your weekends back") and a
--      bracket split across two strings are refused as placeholders.
--   2. After the migration: ordinary copy publishes; every real placeholder (token or word prompt,
--      at any depth, in the blocks or in the SEO, a scalar SEO string) is still refused with the same
--      errcode and message; every other guard (not found, archived, nothing saved, signup with no
--      form, missing form) answers exactly as before; a page publishes its forms as before.
--   3. Every other function in the database is byte-identical (md5 of pg_get_functiondef, before vs
--      after); _growth_page_go_live keeps its signature, return type, SECURITY DEFINER, search_path,
--      owner and ACL; only the placeholder test changed in its body.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'migration_f_growth_placeholder_check_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated migration_f_growth_placeholder_check_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── Production column shapes (information_schema, 2026-10-04) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.growth_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug text NOT NULL,
  title text NOT NULL, status text NOT NULL DEFAULT 'draft', template_key text,
  theme_json jsonb NOT NULL DEFAULT '{}'::jsonb, blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_json jsonb NOT NULL DEFAULT '{}'::jsonb, og_image_url text, published_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  draft_blocks_json jsonb, draft_theme_json jsonb, draft_seo_json jsonb);
CREATE TABLE IF NOT EXISTS public.growth_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug text NOT NULL,
  name text NOT NULL, status text NOT NULL DEFAULT 'draft', template_key text,
  schema_json jsonb NOT NULL DEFAULT '{"sections": []}'::jsonb,
  success_action_json jsonb NOT NULL DEFAULT '{"type": "thank_you"}'::jsonb,
  notify_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], auto_create_contact boolean NOT NULL DEFAULT true,
  auto_create_deal boolean NOT NULL DEFAULT false, pipeline_id uuid, stage_id uuid, workflow_slug text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  notify_email text, draft_schema_json jsonb, draft_success_action_json jsonb, published_at timestamptz);

-- ── The PREVIOUS bodies, verbatim from 20270537000000 (the live definitions) ─────────────────────
CREATE OR REPLACE FUNCTION public._growth_form_go_live(_tenant uuid, _form_id uuid)
RETURNS public.growth_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.growth_forms;
BEGIN
  UPDATE public.growth_forms SET
    status = 'active',
    schema_json = COALESCE(draft_schema_json, schema_json),
    success_action_json = COALESCE(draft_success_action_json, success_action_json),
    published_at = now()
  WHERE id = _form_id AND tenant_id = _tenant AND status <> 'archived'
  RETURNING * INTO _row;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FORM_MISSING: a form this needs is missing or archived' USING ERRCODE = '22023';
  END IF;
  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_form_go_live(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._growth_page_go_live(_tenant uuid, _id uuid)
RETURNS public.growth_pages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.growth_pages;
  _blocks jsonb;
  _form_id uuid;
  _form_slug text;
BEGIN
  SELECT * INTO _row FROM public.growth_pages WHERE id = _id AND tenant_id = _tenant;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'GROWTH_NOT_FOUND: page not found in this tenant' USING ERRCODE = 'P0002'; END IF;
  IF _row.status = 'archived' THEN RAISE EXCEPTION 'GROWTH_ARCHIVED: this page is archived' USING ERRCODE = '22023'; END IF;
  _blocks := CASE WHEN jsonb_typeof(_row.draft_blocks_json) = 'array' THEN _row.draft_blocks_json
                  WHEN _row.status = 'published' AND jsonb_typeof(_row.blocks_json) = 'array' THEN _row.blocks_json END;
  IF _blocks IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NO_DRAFT: nothing to publish — save the page first' USING ERRCODE = '22023';
  END IF;
  IF _blocks::text ~ '\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]'
     OR _blocks::text ~* '\[[^\]]*\y(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\y[^\]]*\]'
     OR COALESCE(_row.draft_seo_json::text, '') ~ '\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]'
     OR COALESCE(_row.draft_seo_json::text, '') ~* '\[[^\]]*\y(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\y[^\]]*\]' THEN
    RAISE EXCEPTION 'GROWTH_UNRESOLVED_PLACEHOLDER: page has unresolved editable placeholders (e.g. [ADD_WEBINAR_DATE]) — fill them before publishing' USING ERRCODE = '22023';
  END IF;

  -- A signup section with no form behind it would publish as an empty box.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_blocks) b
              WHERE b->>'type' = 'embedded_form' AND NULLIF(btrim(COALESCE(b->>'form_slug', '')), '') IS NULL) THEN
    RAISE EXCEPTION 'GROWTH_FORM_MISSING: a signup section on this page has no form — ask Paige to add one before publishing' USING ERRCODE = '22023';
  END IF;

  -- Publishing a page publishes the forms on it (owner ruling 2026-09-30).
  FOR _form_slug IN
    SELECT DISTINCT btrim(b->>'form_slug') FROM jsonb_array_elements(_blocks) b
     WHERE b->>'type' = 'embedded_form' AND NULLIF(btrim(COALESCE(b->>'form_slug', '')), '') IS NOT NULL
  LOOP
    SELECT id INTO _form_id FROM public.growth_forms
     WHERE tenant_id = _tenant AND slug = _form_slug AND status <> 'archived';
    IF _form_id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_FORM_MISSING: a signup form on this page does not exist yet — re-save the page to author it before publishing' USING ERRCODE = '22023';
    END IF;
    PERFORM public._growth_form_go_live(_tenant, _form_id);
  END LOOP;

  UPDATE public.growth_pages SET
    blocks_json = _blocks,
    theme_json  = COALESCE(draft_theme_json, theme_json),
    seo_json    = COALESCE(draft_seo_json, seo_json),
    status = 'published', published_at = now()
  WHERE id = _row.id AND tenant_id = _tenant RETURNING * INTO _row;
  RETURN _row;
END;
$$;
REVOKE ALL ON FUNCTION public._growth_page_go_live(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── Harness ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial, ok boolean, what text);
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

-- TA owns the pages. A live form 'intake' exists for the signup cases; 'ghost' does not.
INSERT INTO public.growth_forms (id, tenant_id, slug, name, status, draft_schema_json) VALUES
  ('00000000-0000-4000-8000-0000000f0f01', '00000000-0000-4000-8000-00000000d0a1', 'intake', 'Intake', 'draft',
   '{"sections": [{"fields": [{"key": "email"}]}]}')
ON CONFLICT DO NOTHING;

-- Publish one fresh page through the go-live step and report what happened:
--   'ok:<status>' or 'err:<SQLSTATE>:<message>'. Each call runs in its own subtransaction, so a refusal
-- leaves nothing behind.
CREATE FUNCTION pg_temp.go(_blocks jsonb, _seo jsonb, _status text DEFAULT 'draft', _live_blocks jsonb DEFAULT '[]'::jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _id uuid := gen_random_uuid(); _r public.growth_pages;
BEGIN
  INSERT INTO public.growth_pages (id, tenant_id, slug, title, status, blocks_json, draft_blocks_json, draft_seo_json)
  VALUES (_id, '00000000-0000-4000-8000-00000000d0a1', 'p-' || _id, 'Probe', _status, _live_blocks, _blocks, _seo);
  BEGIN
    _r := public._growth_page_go_live('00000000-0000-4000-8000-00000000d0a1', _id);
    RETURN 'ok:' || _r.status;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

CREATE TEMP TABLE _cases (label text PRIMARY KEY, kind text, blocks jsonb, seo jsonb, status text DEFAULT 'draft');
-- kind: copy (ordinary copy that was always fine), defect (ordinary copy the old check refused),
--       placeholder (a real prompt: refused before and after), guard (another check; same answer).
INSERT INTO _cases (label, kind, blocks, seo) VALUES
  ('plain copy',                 'copy',        '[{"type":"hero","headline":"Get the weekends back"}]', NULL),
  ('a bracketed tag',            'copy',        '[{"type":"hero","headline":"[Free] Download the guide"}]', '{"title":"Free guide"}'),
  ('your in the headline',       'defect',      '[{"type":"hero","headline":"Get your weekends back"}]', NULL),
  ('add in the copy',            'defect',      '[{"type":"hero","headline":"Add more clients without adding hours"}]', NULL),
  ('enter and example',          'defect',      '[{"type":"text","body":"Enter the season with a plan, see the example below"}]', NULL),
  ('fill and replace',           'defect',      '[{"type":"hero","headline":"Fill your calendar"},{"type":"cta","label":"Replace the guesswork","items":["a"]}]', NULL),
  ('your in the SEO',            'defect',      '[{"type":"hero","headline":"Spring offer"}]', '{"title":"Spring offer","keywords":["your spring guide","coaching"]}'),
  ('brackets split over strings','defect',      '[{"type":"hero","headline":"[ your","subtitle":"add ]"}]', NULL),
  ('a token-shaped object key',  'defect',      '[{"type":"hero","[your_key]":"Get the weekends back"}]', NULL),
  ('token in a headline',        'placeholder', '[{"type":"hero","headline":"Join us on [ADD_WEBINAR_DATE]"}]', NULL),
  ('word prompt in a headline',  'placeholder', '[{"type":"hero","headline":"Join us on [Add your webinar date]"}]', NULL),
  ('your name prompt',           'placeholder', '[{"type":"text","body":"Signed, [Your name]"}]', NULL),
  ('tbd prompt',                 'placeholder', '[{"type":"text","body":"Starts [TBD]"}]', NULL),
  ('lowercase token',            'placeholder', '[{"type":"text","body":"Call [phone_number]"}]', NULL),
  ('deeply nested prompt',       'placeholder', '[{"type":"faq","items":[{"q":"When?","a":["soon","[Add the date]"]}]}]', NULL),
  ('token in the SEO title',     'placeholder', '[{"type":"hero","headline":"Get your weekends back"}]', '{"title":"[ADD_PAGE_TITLE]"}'),
  ('word in the SEO, nested',    'placeholder', '[{"type":"hero","headline":"Get your weekends back"}]', '{"og":{"description":"[Your description here]"}}'),
  ('a scalar SEO prompt',        'placeholder', '[{"type":"hero","headline":"Spring offer"}]', '"[ADD_SEO]"'),
  ('signup with no form',        'guard',       '[{"type":"embedded_form"}]', NULL),
  ('signup form missing',        'guard',       '[{"type":"embedded_form","form_slug":"ghost"}]', NULL),
  ('nothing saved',              'guard',       NULL, NULL),
  ('a signup form publishes',    'guard',       '[{"type":"hero","headline":"Join"},{"type":"embedded_form","form_slug":"intake"}]', NULL);
INSERT INTO _cases (label, kind, blocks, seo, status) VALUES
  ('an archived page',           'guard',       '[{"type":"hero","headline":"Spring offer"}]', NULL, 'archived');

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 0. The previous bodies are production's
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.chk(md5(pg_get_functiondef('public._growth_page_go_live(uuid,uuid)'::regprocedure)) = '504216c36946f725b551b0394973020f',
    'previous _growth_page_go_live = production (md5 504216c3..., 2026-10-04)');
  PERFORM pg_temp.chk(md5(pg_get_functiondef('public._growth_form_go_live(uuid,uuid)'::regprocedure)) = '4183c4f3fc90f0ed58d751482f896620',
    'previous _growth_form_go_live = production (md5 4183c4f3..., 2026-10-04)');
END $$;

-- ── Snapshots: every function, and the previous verdict for every case ───────────────────────────
CREATE TEMP TABLE _fn_before AS
SELECT p.oid::regprocedure::text AS fn, md5(pg_get_functiondef(p.oid)) AS def, p.proacl::text AS acl,
       p.prosecdef, p.provolatile, p.proconfig::text AS cfg, p.proowner, p.prorettype, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
CREATE TEMP TABLE _before AS SELECT c.label, pg_temp.go(c.blocks, c.seo, c.status) AS verdict FROM _cases c;
UPDATE public.growth_forms SET status = 'draft', published_at = NULL;  -- the signup case published it
CREATE TEMP TABLE _src_before AS SELECT prosrc FROM pg_proc WHERE oid = 'public._growth_page_go_live(uuid,uuid)'::regprocedure;

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270548000001_growth_placeholder_check_per_string.sql
\ir ../migrations/20270548000001_growth_placeholder_check_per_string.sql

CREATE TEMP TABLE _after AS SELECT c.label, pg_temp.go(c.blocks, c.seo, c.status) AS verdict FROM _cases c;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1 + 2. Verdicts before and after
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE rec record;
  _refused constant text := 'err:22023:GROWTH_UNRESOLVED_PLACEHOLDER: page has unresolved editable placeholders (e.g. [ADD_WEBINAR_DATE]) — fill them before publishing';
BEGIN
  PERFORM pg_temp.chk((SELECT count(*) FROM _cases) = 23 AND (SELECT count(*) FROM _after) = 23, 'every case ran');
  FOR rec IN SELECT c.label, c.kind, b.verdict AS before, a.verdict AS after
               FROM _cases c JOIN _before b USING (label) JOIN _after a USING (label) LOOP
    CASE rec.kind
      WHEN 'copy' THEN
        PERFORM pg_temp.chk(rec.before = 'ok:published' AND rec.after = 'ok:published', format('copy publishes before and after: %s (%s / %s)', rec.label, rec.before, rec.after));
      WHEN 'defect' THEN
        PERFORM pg_temp.chk(rec.before = _refused, format('the defect, measured on the previous body: %s was refused (%s)', rec.label, rec.before));
        PERFORM pg_temp.chk(rec.after = 'ok:published', format('ordinary copy now publishes: %s (%s)', rec.label, rec.after));
      WHEN 'placeholder' THEN
        PERFORM pg_temp.chk(rec.before = _refused AND rec.after = _refused, format('a real placeholder is refused before and after, same errcode and message: %s (%s)', rec.label, rec.after));
      WHEN 'guard' THEN
        PERFORM pg_temp.chk(rec.before = rec.after, format('another guard answers exactly as before: %s (%s / %s)', rec.label, rec.before, rec.after));
    END CASE;
  END LOOP;
  -- The guard answers are the expected ones, not merely equal.
  PERFORM pg_temp.chk((SELECT verdict FROM _after WHERE label = 'signup with no form') LIKE 'err:22023:GROWTH_FORM_MISSING: a signup section on this page has no form%', 'signup with no form is refused');
  PERFORM pg_temp.chk((SELECT verdict FROM _after WHERE label = 'signup form missing') LIKE 'err:22023:GROWTH_FORM_MISSING: a signup form on this page does not exist yet%', 'a missing signup form is refused');
  PERFORM pg_temp.chk((SELECT verdict FROM _after WHERE label = 'nothing saved') LIKE 'err:22023:GROWTH_NO_DRAFT:%', 'nothing saved is refused');
  PERFORM pg_temp.chk((SELECT verdict FROM _after WHERE label = 'an archived page') LIKE 'err:22023:GROWTH_ARCHIVED:%', 'an archived page is refused');
  PERFORM pg_temp.chk((SELECT verdict FROM _after WHERE label = 'a signup form publishes') = 'ok:published'
      AND (SELECT status FROM public.growth_forms WHERE slug = 'intake') = 'active', 'a page still publishes the form on it');
END $$;
DO $$ BEGIN
  PERFORM public._growth_page_go_live('00000000-0000-4000-8000-00000000d0a1', gen_random_uuid());
  PERFORM pg_temp.chk(false, 'a page that does not exist was not refused');
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  PERFORM pg_temp.chk(SQLERRM LIKE 'GROWTH_NOT_FOUND:%', 'a page that does not exist is refused P0002');
END $$;
DO $$ BEGIN
  -- A page in another workspace is not found from this one.
  INSERT INTO public.growth_pages (id, tenant_id, slug, title, draft_blocks_json)
  VALUES ('00000000-0000-4000-8000-0000000fb001', '00000000-0000-4000-8000-00000000d0b1', 'tb', 'TB', '[{"type":"hero","headline":"x"}]');
  PERFORM public._growth_page_go_live('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-0000000fb001');
  PERFORM pg_temp.chk(false, 'another workspace''s page was not refused');
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  PERFORM pg_temp.chk(SQLERRM LIKE 'GROWTH_NOT_FOUND:%', 'another workspace''s page is not found from this one');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Nothing else changed
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT fn, def FROM _fn_before WHERE fn <> '_growth_page_go_live(uuid,uuid)'
      EXCEPT
      SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'every other function is byte-identical');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) = (SELECT count(*) FROM _fn_before),
    'no function added or removed');
  PERFORM pg_temp.chk(NOT EXISTS (
      SELECT fn, acl, prosecdef, provolatile, cfg, proowner, prorettype, args FROM _fn_before
      EXCEPT
      SELECT p.oid::regprocedure::text, p.proacl::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.prorettype,
             pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
    'signature, return type, SECURITY DEFINER, volatility, search_path, owner and ACL of every function unchanged');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public._growth_page_go_live(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public._growth_page_go_live(uuid,uuid)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public._growth_page_go_live(uuid,uuid)', 'EXECUTE'),
    'the go-live step stays callable by its owner only');
  -- Only the placeholder test changed: remove both versions of it and the bodies are identical.
  PERFORM pg_temp.chk(
      regexp_replace((SELECT prosrc FROM _src_before), '  IF _blocks::text ~ .*?fill them before publishing''', '<check>', 's')
    = regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'public._growth_page_go_live(uuid,uuid)'::regprocedure),
                     '  -- Migration F: .*?fill them before publishing''', '<check>', 's'),
    'outside the placeholder test, the body is unchanged');
  PERFORM pg_temp.chk((SELECT prosrc FROM pg_proc WHERE oid = 'public._growth_page_go_live(uuid,uuid)'::regprocedure) !~ '::text ~',
    'no pattern runs over serialized JSON any more');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 200), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 30) f;
  IF _total < 40 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'migration_f_growth_placeholder_check: % checks passed', _total;
END $$;
