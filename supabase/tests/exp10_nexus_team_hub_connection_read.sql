-- EXP10 NEXUS Team Hub connection read (20271122070008): the ONE additive roster registration.
-- Disposable database only. No synthetic tenant data is needed — the migration touches exactly one
-- platform row, so the proof pins that row and its blast radius:
--   (A) the nexus platform row's capability_scope.tools now carries "integrations_list", appended
--       AFTER the seven seeded names, with the scope's mode still allowlist and access still read;
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

-- (A) + (D) the nexus platform row: the seven seeded names, in order, then the one append.
DO $$
DECLARE
  got jsonb;
BEGIN
  SELECT config->'capability_scope' INTO got FROM public.paige_subagents
   WHERE slug = 'nexus' AND tenant_id IS NULL;
  IF got IS NULL THEN RAISE EXCEPTION 'A1: nexus platform row lost its capability_scope'; END IF;
  IF got->>'mode' <> 'allowlist' THEN RAISE EXCEPTION 'A2: scope mode changed: %', got->>'mode'; END IF;
  IF got->>'access' <> 'read' THEN RAISE EXCEPTION 'A3: scope access changed: %', got->>'access'; END IF;
  IF NOT (got->'tools') ? 'integrations_list' THEN RAISE EXCEPTION 'A4: integrations_list not registered'; END IF;
  IF jsonb_array_length(got->'tools') <> 8 THEN RAISE EXCEPTION 'D1: tools length %, expected exactly the 7 seeded names + 1 append', jsonb_array_length(got->'tools'); END IF;
  IF (got->'tools') <> '["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","growth_list","campaign_brief_list","read_campaign_leads","integrations_list"]'::jsonb THEN
    RAISE EXCEPTION 'D2: seeded names dropped or reordered: %', got->'tools';
  END IF;
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
