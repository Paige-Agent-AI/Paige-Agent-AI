-- EXP10 Team Hub integration, NEXUS connection read (ANT-164, owner directive 385a54eb; contract
-- efa6d22f on ANT-161). The doctrine's adoption-owners line (docs/doctrine/paige-c-suite-roster.md,
-- binding 23-Oct standard) names "EXP10 NEXUS primary with contextual domain support", and NEXUS's
-- approved responsibility includes connected marketing intelligence.
--
-- ONE additive registration: append "integrations_list" (the Spine-declared integrations.list read,
-- executor public.list_integration_surface — the exact read PAIGE chat offers today) to the nexus
-- platform row's capability_scope.tools, so a nexus Team Hub DM turn may offer it to the workspace's
-- owner/admin under the asker's own JWT. Nothing else changes:
--   • only the platform row (tenant_id IS NULL) — no tenant or customised-instance row is touched;
--   • append-only where the name is absent (jsonb_set on the tools path only): every other config
--     key, the scope's mode/access, and every other agent's row are preserved byte-for-byte;
--   • a config write bumps version by one, as the orchestrator's own config writer does
--     (20271117010108 convention), so a reader holding the old version can tell the row changed;
--   • forward-only and replay-safe: a second apply finds the name present and changes nothing.
BEGIN;
SET LOCAL lock_timeout = '2s';

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

COMMIT;
