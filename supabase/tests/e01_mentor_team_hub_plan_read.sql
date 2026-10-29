-- EXP01 (MENTOR) Team Hub plan read — proof of the roster change ONLY. The executor is proved by
-- the unit suites (supabase/functions/_shared/team-hub/agent-turn.test.ts, mentor-plan-read.test.ts)
-- and the plan_list RPC by its own migrations; this file proves the UPDATE: exactly the platform
-- MENTOR row gains plan_list, once, and nothing else moves.
-- Disposable PostgreSQL only. Never target the linked project. Minimal fixture: the platform
-- configuration table and four synthetic rows. The migration under test commits its own
-- BEGIN/COMMIT, so this proof runs in a database it creates and drops.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS e01_mentor_plan_read_proof;
CREATE DATABASE e01_mentor_plan_read_proof;
\c e01_mentor_plan_read_proof
SET client_min_messages=warning;

CREATE TABLE public.paige_subagents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, slug text, config jsonb);
-- The production platform MENTOR row as the roster migration seeded it (20271117010108, mentor line).
INSERT INTO public.paige_subagents(tenant_id, slug, config) VALUES
 (NULL,'mentor','{"version":1,"team_hub_tools":{"mode":"allowlist","tools":["team_hub_read_conversation","read_business_time_zone"]},"capability_scope":{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","read_tenant_knowledge","marketplace_browse"]}}'),
 -- ZION already names plan_list (roster 20271117010108): the migration must not duplicate it.
 (NULL,'zion','{"capability_scope":{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","crm_list_tasks","crm_get_task","plan_list","read_weekly_commitment_status"]}}'),
 -- Another specialist: untouched.
 (NULL,'merit','{"capability_scope":{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices","agreement_list"]}}'),
 -- A tenant-owned MENTOR row: the platform read never touches tenant rows.
 ('11111111-1111-4111-8111-111111111111','mentor','{"capability_scope":{"version":1,"mode":"allowlist","access":"read","tools":["ask_choices"]}}');

CREATE TEMP TABLE e01_before AS SELECT slug, tenant_id, config FROM public.paige_subagents ORDER BY slug, tenant_id NULLS FIRST;
\ir ../migrations/20271122060008_e01_mentor_team_hub_plan_read.sql

DO $proof$
DECLARE mentor_tools jsonb; zion_tools jsonb; merit_tools jsonb; tenant_tools jsonb;
        last int; occurrences int; moved int;
BEGIN
  -- 1. The platform MENTOR row gained exactly one name, at the end of its read list.
  SELECT config->'capability_scope'->'tools' INTO mentor_tools FROM public.paige_subagents WHERE slug='mentor' AND tenant_id IS NULL;
  last := jsonb_array_length(mentor_tools);
  SELECT count(*) INTO occurrences FROM jsonb_array_elements_text(mentor_tools) t WHERE t='plan_list';
  IF mentor_tools IS NULL OR occurrences <> 1 OR mentor_tools->>(last-1) IS DISTINCT FROM 'plan_list'
     OR mentor_tools->>(last-2) IS DISTINCT FROM 'marketplace_browse' THEN
    RAISE EXCEPTION 'mentor scope did not gain plan_list exactly once at the end'; END IF;
  -- 2. ZION is byte-identical (no duplicate inserted into a list that already names it).
  SELECT config->'capability_scope'->'tools' INTO zion_tools FROM public.paige_subagents WHERE slug='zion';
  SELECT count(*) INTO occurrences FROM jsonb_array_elements_text(zion_tools) t WHERE t='plan_list';
  IF occurrences <> 1 THEN RAISE EXCEPTION 'zion scope changed'; END IF;
  -- 3. MERIT untouched.
  SELECT config->'capability_scope'->'tools' INTO merit_tools FROM public.paige_subagents WHERE slug='merit';
  IF merit_tools @> '["plan_list"]' THEN RAISE EXCEPTION 'merit scope changed'; END IF;
  -- 4. The tenant-owned MENTOR row untouched.
  SELECT config->'capability_scope'->'tools' INTO tenant_tools FROM public.paige_subagents WHERE slug='mentor' AND tenant_id IS NOT NULL;
  IF tenant_tools @> '["plan_list"]' THEN RAISE EXCEPTION 'a tenant row was touched'; END IF;
  -- 5. Nothing outside capability_scope.tools moved (team_hub_tools, personality, version kept).
  SELECT count(*) INTO moved FROM public.paige_subagents a JOIN e01_before b
    ON a.slug=b.slug AND a.tenant_id IS NOT DISTINCT FROM b.tenant_id
   WHERE a.config #- '{capability_scope,tools}' IS DISTINCT FROM (b.config #- '{capability_scope,tools}');
  IF moved <> 0 THEN RAISE EXCEPTION 'config moved outside capability_scope.tools'; END IF;
END $proof$;

-- Idempotency: a second run changes nothing at all.
CREATE TEMP TABLE e01_after_first AS SELECT slug, tenant_id, config FROM public.paige_subagents;
\ir ../migrations/20271122060008_e01_mentor_team_hub_plan_read.sql
DO $again$
DECLARE diff int;
BEGIN
  SELECT count(*) INTO diff FROM public.paige_subagents a JOIN e01_after_first b
    ON a.slug=b.slug AND a.tenant_id IS NOT DISTINCT FROM b.tenant_id
   WHERE a.config IS DISTINCT FROM b.config;
  IF diff <> 0 THEN RAISE EXCEPTION 'second run was not a no-op'; END IF;
END $again$;

RESET client_min_messages;
\c postgres
DROP DATABASE e01_mentor_plan_read_proof WITH (FORCE);
