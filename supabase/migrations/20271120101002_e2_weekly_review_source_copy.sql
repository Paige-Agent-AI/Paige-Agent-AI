-- EXP02 CAP017: one canonical catalogue description, after original source release.
-- Deployment depends on the Calendar Business Review consumer; coverage stays Limited.
-- No permission, tool, tier, risk, activation, provider or execution-state change.
UPDATE public.paige_skills
SET description = $copy$Ask PAIGE for a sourced weekly review of available Finance, sales, collections, clients, operations, form intake, saved appointments and Strategic Plays. Authorized recorded activity is a limited sample; recorded labels do not verify completed work or original action receipts. Missing sources remain explicit. This read-only review does not schedule, send or execute business actions.$copy$
WHERE slug = 'weekly_business_review'
  AND name = 'Weekly Business Review'
  AND description = $copy$Ask PAIGE for a sourced weekly review of available sales, collections, client, operations, recorded form intake and Strategic Play evidence. Missing information stays explicit and recommendations need supporting evidence. This is a read-only review; automatic scheduling, sends and business actions are not included.$copy$
  AND category = 'analytics_interpretation'
  AND scoping = 'platform'
  AND created_by = 'system'
  AND risk_level = 'read_only'
  AND jsonb_typeof(metadata) = 'object'
  AND metadata->'catalogue_coverage' = '{"version":1,"state":"limited"}'::jsonb;
