-- Migration F (Vibe Studio V2b) — the page placeholder check reads each piece of copy, not the JSON.
-- Owner authorized 2026-10-04, to ship in the V2b PR.
--
-- DEFECT. _growth_page_go_live (20270537000000) ran its two placeholder patterns over
-- `_blocks::text` and `draft_seo_json::text` — the whole serialized JSON. A block array starts with
-- its own "[", so the word pattern `\[[^\]]*\y(add|…|your)\y[^\]]*\]` matched from that bracket to
-- the first "]" and refused any page whose copy said "your", "add", "enter", "example", "fill" or
-- "replace" before it: `[{"type":"hero","headline":"Get your weekends back"}]` was
-- GROWTH_UNRESOLVED_PLACEHOLDER. Production has never published a page.
--
-- FIX. Only the placeholder test changes: both patterns now run against each JSON string value on
-- its own (jsonb_path_query 'strict $.**', strings only), over the blocks AND draft_seo_json. A real
-- prompt — [ADD_WEBINAR_DATE], [Add your webinar date] — sits inside one string and is still
-- refused, with the same message and errcode. Every other guard, message, errcode, the signature,
-- return type, SECURITY DEFINER, search_path, owner and grants are unchanged; no other function is
-- touched. The publish door's readiness mirror (_shared/growth-publish-command/contract.ts
-- hasPlaceholder) walks string leaves the same way, so the card and the server agree.
--
-- Scope check (prod, read-only, 2026-10-04): _growth_page_go_live is the ONLY live public function
-- carrying either pattern. The two matches in 20260713090000/20260713140004 are earlier bodies of
-- growth_page_publish, replaced by 20270537000000 (which delegates to this function).
--
-- Reversibility: one function body is replaced. Reverting means restoring it from 20270537000000
-- (prod pg_get_functiondef md5 504216c36946f725b551b0394973020f before this migration).
--
-- Proof: supabase/tests/migration_f_growth_placeholder_check.sql
--        (.github/workflows/migration-f-growth-placeholder-check.yml).

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
  -- Migration F: each STRING VALUE is tested on its own (blocks and SEO, at any depth). Testing the
  -- serialized JSON let the word pattern run from the array's own "[" to the first "]", so ordinary
  -- copy ("Get your weekends back") was refused. Object keys are structure, not copy.
  IF EXISTS (SELECT 1
               FROM (SELECT v FROM jsonb_path_query(_blocks, 'strict $.**') AS q(v)
                     UNION ALL
                     SELECT v FROM jsonb_path_query(_row.draft_seo_json, 'strict $.**') AS q(v)) s
              WHERE jsonb_typeof(s.v) = 'string'
                AND ((s.v #>> '{}') ~ '\[[A-Za-z0-9]*_[A-Za-z0-9_]*\]'
                     OR (s.v #>> '{}') ~* '\[[^\]]*\y(add|paste|insert|enter|fill|tbd|placeholder|replace|example|your)\y[^\]]*\]')) THEN
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
