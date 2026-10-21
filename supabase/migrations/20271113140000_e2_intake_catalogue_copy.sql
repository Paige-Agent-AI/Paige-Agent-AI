-- EXP02 CAP012/CAP017: describe the released, partial first-party intake read.
-- One canonical registry; no activation, permission, provider or coverage change.
-- Preserve custom copy, classification and noncanonical/malformed coverage.
UPDATE public.paige_skills AS skill
SET description = copy.description
FROM (VALUES
  ($intake$conversion_funnel_diagnosis$intake$, $intake$Conversion Funnel Diagnosis$intake$,
   $intake$PAIGE can review available opportunity counts and current pipeline evidence. Historical stage-to-stage conversion and drop-off diagnosis are not available in Business Review yet; stage names and current counts do not prove conversion or its cause.$intake$,
   $intake$PAIGE can review recorded form intake, submissions linked to an opportunity, and current pipeline evidence when permitted. Visitor conversion, causal attribution and historical stage-to-stage drop-off diagnosis are not available in Business Review yet.$intake$),
  ($intake$weekly_business_review$intake$, $intake$Weekly Business Review$intake$,
   $intake$Ask PAIGE for a sourced weekly review of available sales, collections, client, operations and Strategic Play evidence. Missing information stays explicit and recommendations need supporting evidence. This is a read-only review; automatic scheduling, sends and business actions are not included.$intake$,
   $intake$Ask PAIGE for a sourced weekly review of available sales, collections, client, operations, recorded form intake and Strategic Play evidence. Missing information stays explicit and recommendations need supporting evidence. This is a read-only review; automatic scheduling, sends and business actions are not included.$intake$)
) AS copy(slug, canonical_name, previous_description, description)
WHERE skill.slug = copy.slug
  AND skill.name = copy.canonical_name
  AND skill.description = copy.previous_description
  AND skill.category = 'analytics_interpretation'
  AND skill.scoping = 'platform'
  AND skill.created_by = 'system'
  AND skill.risk_level = 'read_only'
  AND jsonb_typeof(skill.metadata) = 'object'
  AND skill.metadata->'catalogue_coverage' = '{"version":1,"state":"limited"}'::jsonb;
