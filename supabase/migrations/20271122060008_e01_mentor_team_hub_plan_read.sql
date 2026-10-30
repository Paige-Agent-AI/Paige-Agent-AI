-- EXP01 (MENTOR) Team Hub plan read, slice 1: MENTOR's registered DM scope gains the existing
-- planning read (plan_list, C0b key planning.list) so the agent-turn executor (this PR) can offer
-- it in MENTOR's own DM under the asker's current owner/admin authority. Read-only by shape and by
-- executor: no planning writer is added, in any scope, for any agent (A2c holds them; ruling
-- b379a467 / EXP08 D4). Coordinated in Linear ANT-161 comment 9a4448c8 (one implementing owner
-- per span; EXP08 #3041 and EXP04 #3064 spans untouched).
-- Idempotent and fail-closed: only the platform row (tenant_id IS NULL) whose capability_scope is
-- a read allowlist whose tools do NOT already name plan_list is widened, by exactly that one name.
BEGIN;
UPDATE public.paige_subagents a
SET config = jsonb_set(a.config, '{capability_scope,tools}',
      (a.config->'capability_scope'->'tools') || '["plan_list"]'::jsonb)
WHERE a.slug = 'mentor'
  AND a.tenant_id IS NULL
  AND a.config->'capability_scope'->>'mode' = 'allowlist'
  AND a.config->'capability_scope'->>'access' = 'read'
  AND jsonb_typeof(a.config->'capability_scope'->'tools') = 'array'
  AND NOT (a.config->'capability_scope'->'tools') ? 'plan_list';
COMMIT;
