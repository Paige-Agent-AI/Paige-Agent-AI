-- EXP10 NEXUS Team Hub connection read (20271122070008): the ONE additive roster registration.
-- Disposable database only. No synthetic tenant data is needed — the migration touches exactly one
-- platform row, so the proof pins that row and its blast radius:
--   (A) the nexus platform row's capability_scope.tools now carries "integrations_list", appended
--       AFTER the seven seeded names; original v1/read or reviewed EXP08 v2/card with ONLY
--       growth_page_publish appended after those eight reads. No broader action set is accepted;
--   (B) every OTHER agent's platform row is untouched by the read registration (no
--       integrations_list anywhere else);
--   (C) replay-safety: the migration's own predicate (absent-guard) matches ZERO rows now, so a
--       second apply changes nothing — and it structurally cannot match any tenant-scoped row;
--   (D) the append preserved every seeded tool name (nothing dropped, nothing reordered before them).
--
-- The row's `version` is deliberately NOT pinned: it is a change-counter other forward roster
-- registrations may legitimately bump; the load-bearing fact this test owns is the tools array.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/exp10_nexus_team_hub_connection_read.sql "$DB_URL"

BEGIN;
\set ON_ERROR_STOP on

-- (A) + (D) both exact published compositions retain the original eight-name read prefix.
-- This is test-only receiving compatibility for EXP08 A2b, not a provider/credential grant.
CREATE FUNCTION pg_temp.exp10_assert_nexus_scope(got jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  expected jsonb:='["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","growth_list","campaign_brief_list","read_campaign_leads","integrations_list"]'::jsonb;
BEGIN
  IF got IS NULL THEN RAISE EXCEPTION 'A1: nexus platform row lost its capability_scope'; END IF;
  IF got->>'mode' IS DISTINCT FROM 'allowlist' THEN RAISE EXCEPTION 'A2: scope mode changed: %', got->>'mode'; END IF;
  IF got->'version'='2'::jsonb AND got->>'access'='card' THEN
    expected:=expected||'["growth_page_publish"]'::jsonb;
  ELSIF got->'version' IS DISTINCT FROM '1'::jsonb OR got->>'access' IS DISTINCT FROM 'read' THEN
    RAISE EXCEPTION 'A3: scope version/access is not an exact supported composition: %', got;
  END IF;
  IF NOT (got->'tools') ? 'integrations_list' THEN RAISE EXCEPTION 'A4: integrations_list not registered'; END IF;
  IF jsonb_array_length(got->'tools') IS DISTINCT FROM jsonb_array_length(expected) THEN
    RAISE EXCEPTION 'D1: tools length %, expected exactly %', jsonb_array_length(got->'tools'),jsonb_array_length(expected); END IF;
  IF (got->'tools') IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'D2: seeded names dropped or reordered: %', got->'tools';
  END IF;
END $$;
DO $$ BEGIN
 PERFORM pg_temp.exp10_assert_nexus_scope((SELECT config->'capability_scope' FROM public.paige_subagents
  WHERE slug='nexus' AND tenant_id IS NULL));
END $$;

-- The new compatibility branch must not accept an arbitrary card scope or lose any read guard.
DO $$ DECLARE base jsonb; card jsonb; candidate jsonb; refused boolean; BEGIN
 base:='{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","growth_list","campaign_brief_list","read_campaign_leads","integrations_list"]}'::jsonb;
 card:=jsonb_set(jsonb_set(jsonb_set(base,'{version}','2'),'{access}','"card"'),'{tools}',(base->'tools')||'["growth_page_publish"]'::jsonb);
 PERFORM pg_temp.exp10_assert_nexus_scope(base);
 PERFORM pg_temp.exp10_assert_nexus_scope(card);
 FOR candidate IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  NULL,jsonb_set(base,'{mode}','"all"'),jsonb_set(base,'{access}','"auto"'),
  jsonb_set(base,'{access}','"card"'),jsonb_set(card,'{access}','"read"'),
  jsonb_set(card,'{version}','3'),jsonb_set(card,'{version}','"2"'),
  jsonb_set(card,'{tools}',(card->'tools')-'integrations_list'),
  jsonb_set(card,'{tools}',(card->'tools')||'["comms_send_email"]'::jsonb),
  jsonb_set(card,'{tools}','["integrations_list","ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","growth_list","campaign_brief_list","read_campaign_leads","growth_page_publish"]'),
  jsonb_set(card,'{tools}','null'))) LOOP
  refused:=false;
  BEGIN PERFORM pg_temp.exp10_assert_nexus_scope(candidate); EXCEPTION WHEN OTHERS THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'A/D negative control accepted an unsupported scope: %',candidate; END IF;
 END LOOP;
END $$;

-- (B) no other agent's platform row carries the read.
DO $$
DECLARE
  other text;
BEGIN
  FOR other IN SELECT slug FROM public.paige_subagents
                WHERE tenant_id IS NULL AND slug <> 'nexus'
                  AND config->'capability_scope'->'tools' ? 'integrations_list'
  LOOP RAISE EXCEPTION 'B1: integrations_list leaked into %''s scope', other; END LOOP;
END $$;

-- (C) replay-safety: the migration's exact predicate matches nothing now (and never any tenant row:
-- tenant_id IS NULL is part of the predicate).
DO $$
DECLARE
  touched int;
BEGIN
  UPDATE public.paige_subagents a SET
    config = jsonb_set(a.config, '{capability_scope,tools}',
      (a.config->'capability_scope'->'tools') || '["integrations_list"]'::jsonb),
    version = a.version + 1,
    updated_at = statement_timestamp()
  WHERE a.slug = 'nexus'
    AND a.tenant_id IS NULL
    AND a.config->'capability_scope'->>'mode' = 'allowlist'
    AND jsonb_typeof(a.config->'capability_scope'->'tools') = 'array'
    AND NOT (a.config->'capability_scope'->'tools') ? 'integrations_list';
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN RAISE EXCEPTION 'C1: replay matched % rows; the append is not idempotent', touched; END IF;
END $$;

ROLLBACK;
