-- EXP02 CAP009..017: public released coverage in the EXISTING registry metadata.
-- Requires the compatible shared presenter; coverage never grants runtime access.
-- Preserve custom copy/coverage, malformed metadata, scopes and every execution field.
UPDATE public.paige_skills AS skill
SET metadata = coalesce(skill.metadata, '{}'::jsonb) || jsonb_build_object(
  'catalogue_coverage', jsonb_build_object('version', 1, 'state', coverage.state))
FROM (VALUES
  ($coverage$ad_spend_efficiency$coverage$, $coverage$Ad Spend Efficiency Read$coverage$, $coverage$Reviews source-backed ad spend, leads and returns when those measurements are available. Automatic ROAS, cost-per-lead and attribution analysis is not available in Business Review yet; a listed ad provider does not prove a connection or a return.$coverage$, $coverage$coming_soon$coverage$),
  ($coverage$churn_signal_detection$coverage$, $coverage$Churn Signal Detection$coverage$, $coverage$Flags client risk only when permitted activity or service-delivery evidence supports it. Current client and lifecycle totals do not establish churn risk. Source-backed client churn detection is not available in Business Review yet.$coverage$, $coverage$coming_soon$coverage$),
  ($coverage$cohort_analysis$coverage$, $coverage$Cohort Analysis Read$coverage$, $coverage$Compares retention and expansion only from authoritative acquisition-cohort evidence. Current client totals cannot reconstruct cohort history. Cohort comparisons are not available in Business Review yet.$coverage$, $coverage$coming_soon$coverage$),
  ($coverage$conversion_funnel_diagnosis$coverage$, $coverage$Conversion Funnel Diagnosis$coverage$, $coverage$PAIGE can review available opportunity counts and current pipeline evidence. Historical stage-to-stage conversion and drop-off diagnosis are not available in Business Review yet; stage names and current counts do not prove conversion or its cause.$coverage$, $coverage$limited$coverage$),
  ($coverage$engagement_read$coverage$, $coverage$Engagement Read$coverage$, $coverage$Interprets authorized email, content and audience measurements when their sources provide them. Source-backed channel engagement is not available in Business Review yet. A contact count or listed connection is not evidence of engagement.$coverage$, $coverage$coming_soon$coverage$),
  ($coverage$monthly_qbr_draft$coverage$, $coverage$Monthly Business Review Draft$coverage$, $coverage$PAIGE can explain available business evidence for the last 30 days and identify missing information. Filing a monthly review document for approval and later retrieval remains unverified. A Chat answer is not a filed document or permission to send it.$coverage$, $coverage$unverified$coverage$),
  ($coverage$quarterly_narrative$coverage$, $coverage$Quarterly Narrative Draft$coverage$, $coverage$PAIGE can discuss the current quarter using available business evidence and its limitations. Filing a quarterly narrative for approval and later retrieval remains unverified. No unsupported financial history, forecast or delivery is promised.$coverage$, $coverage$unverified$coverage$),
  ($coverage$revenue_trend_read$coverage$, $coverage$Revenue Trend Read$coverage$, $coverage$PAIGE can compare recorded receipts where complete, compatible source periods exist, with currencies kept separate. Recorded receipts are not recognized revenue, MRR, ARR, profit or bank cash. Full revenue-series analysis requires authoritative revenue evidence.$coverage$, $coverage$limited$coverage$),
  ($coverage$weekly_business_review$coverage$, $coverage$Weekly Business Review$coverage$, $coverage$Ask PAIGE for a sourced weekly review of available sales, collections, client, operations and Strategic Play evidence. Missing information stays explicit and recommendations need supporting evidence. This is a read-only review; automatic scheduling, sends and business actions are not included.$coverage$, $coverage$limited$coverage$)
) AS coverage(slug, canonical_name, corrected_description, state)
WHERE skill.slug = coverage.slug
  AND skill.name = coverage.canonical_name
  AND skill.description = coverage.corrected_description
  AND skill.category = 'analytics_interpretation'
  AND skill.scoping = 'platform'
  AND skill.created_by = 'system'
  AND (skill.metadata IS NULL OR jsonb_typeof(skill.metadata) = 'object')
  AND NOT coalesce(skill.metadata ? 'catalogue_coverage', false);
