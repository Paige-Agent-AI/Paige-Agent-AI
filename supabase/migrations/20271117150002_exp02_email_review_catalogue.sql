-- Existing CAP013 presentation only. No activation, permission or execution change.
UPDATE public.paige_skills
SET description = 'Reviews original campaign email send counts and tracked open/click signals when permitted. Tracking excludes own-mail sends; image loads are not read receipts. Rates, retention, content and audience performance remain unavailable here. Customer verification is still owed.',
    metadata = jsonb_set(metadata, '{catalogue_coverage,state}', '"unverified"'::jsonb)
WHERE slug = 'engagement_read' AND name = 'Engagement Read'
  AND category = 'analytics_interpretation' AND scoping = 'platform' AND created_by = 'system'
  AND description = 'Interprets authorized email, content and audience measurements when their sources provide them. Source-backed channel engagement is not available in Business Review yet. A contact count or listed connection is not evidence of engagement.'
  AND jsonb_typeof(metadata) = 'object'
  AND metadata->'catalogue_coverage' = '{"version":1,"state":"coming_soon"}'::jsonb;
