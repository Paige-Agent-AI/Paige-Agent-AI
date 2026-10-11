# INT-298 / INT-342 S2 — Marketing metric server contract

SHELL: SOLO. Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized
2026-10-11; INT-298, INT-342, Linear ANT-15), slice 2 of 6. Plan: `docs/product/int342-marketing-convergence.md` §H.

## Scope and shared-owner coordination

Marketing owns its analytics producers and presentation (`docs/delivery/int340-shared-metric-consumer-contract.md`).
INT-340 owns the shared issuer, resolver, reference registry, dispatcher and frontend validator; Platform Reach owns
Spine/Chat/Live access. This slice follows the Sales precedent (`sales-performance-server-contract.md`):

- **Marketing's own:** the private `_marketing_metric_bundle` producer and its proof `supabase/tests/marketing_metric_producer.sql`.
- **INT-340's dispatcher, touched once:** migration `20270602000503_int298_marketing_metric_producer.sql` re-creates
  `_analytics_metric_produce` with the eleven `marketing.*` keys and one `marketing.%` branch; every other line is as
  `20270601000006` wrote it. Coordination is recorded on Linear ANT-23 (INT-340). Nothing else in the shared seam changes.
- **Not in this slice:** the Chat/Live key list (`supabase/functions/_shared/analytics-metrics/read.ts`, Platform Reach,
  MBC slice 6) and the Analytics surface consuming these keys (slice 2b). No KPI value is stored; the issuer persists only
  an opaque reference that expires after 15 minutes.

## Private entry and authority

`_marketing_metric_bundle(tenant, key, version, start, end, as_of, dimensions)` is STABLE, SECURITY DEFINER, pinned empty
search path and UTC, with no EXECUTE grant to PUBLIC, anon, authenticated or service_role. It rechecks `auth.uid()`, the
current workspace, the profile's active workspace, an active owner/admin seat, a live user and an eligible tenant
lifecycle. Only version 1.0.0 and the keys below are admitted; ranges are finite, ordered, half-open, at most ten years
and end at or before as-of. No dimensions in this version.

## Metric definitions — version 1.0.0

A **lead** is a form submission. Nothing here judges lead quality: "qualified leads" have no definition and no producer.

| Key | Cohort / formula | Value | Exclusions |
|---|---|---|---|
| `marketing.leads.received` | Submissions with `created_at` in [start,end), every form in the workspace | count | none |
| `marketing.leads.daily` | Same, one point per UTC day the range touches (zeros kept); range may touch at most 366 days | series | none |
| `marketing.leads.by_utm_source` | Same, grouped by `lower(btrim(utm_source))` when a string (control characters become spaces), as item `src:<tag>`; no tag → item `_untagged` ("No source tag"); beyond 99 tags → `_other` | distribution | none (untagged is an item, never dropped) |
| `marketing.leads.by_campaign_tag` | Same, `utm_campaign` matched case-insensitively to this workspace's `campaign_briefs.short_ref`: one match → `brief:<id>` labelled with the brief's name; no match → `tag:<tag>`; no tag → `_untagged` | distribution | `campaign_tag_matches_several_briefs` (never guessed) |
| `marketing.leads.converted_to_opportunity` | Same; count those whose `deal_id` resolves to a deal in this workspace. Denominator = contributing leads | count | `opportunity_record_missing` (a `deal_id` with no deal here) |
| `marketing.capture_points.published_current` | Forms with `status = active` now (pages and funnels capture through the forms they embed) | count, snapshot | none |
| `marketing.forms.unrouted_current` | Live forms with no enabled `pipeline_attach` automation and no intake route (`auto_create_deal` with a `pipeline_id`). Denominator = live forms | count, snapshot | none |
| `marketing.submissions.failed_current` | Now, any age: `processing_state = error` (failed) and `pending`/`claimed` more than 15 minutes after arriving (stalled; the processor retries after 5) | distribution, snapshot | none |
| `marketing.email.sent` | Recipients with `sent_at` in range, any route | count | none |
| `marketing.email.opened` / `.clicked` | Of the managed-route sends in range, those opened / clicked since. Denominator = tracked sends | count | `not_tracked_own_mail` (sends through the business's own mail) |

Truth state follows the shared rule: excluded candidates make a reading PARTIAL; candidates with none contributing make
it UNAVAILABLE (the dispatcher then nulls values). A reading with no candidates is a true zero, LIVE.

**Not produced, unavailable at the reader:** visits and page conversion, funnel step-through, social reach, ad spend,
CPL, CAC, ROAS (Ads department), revenue (Sales), qualified leads.

## Proof

- `supabase/tests/marketing_metric_producer.sql`, run in the `database-contract` job on a production-schema clone,
  through the real issuer and resolver. It covers:
  - every key's value against fixtures;
  - tenant isolation, including another workspace's brief, deal and leads;
  - an unknown key, a dimension and an over-long daily range refused;
  - the private producer, a foreign epoch and a member refused;
  - a new lead invalidating an issued reference;
  - other domains still dispatching.
- Unit tests of the shapes against `parseMetricResult` ship with slice 2b, which consumes them.
