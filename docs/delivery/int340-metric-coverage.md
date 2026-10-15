# INT340 Settings Analytics metric coverage

Source inventory for #1836, grounded in migrations `20270601000005_int340_settings_metric_producers.sql` (private producer) and `20270601000006_int340_shared_metric_evidence.sql` (shared dispatcher/issuer/resolver), plus `src/solo/data/useSettingsAnalytics.ts`. This documents source behavior, not a fresh production acceptance result. Chat/Live binding under #1837 is **PROOF OWED**; no Chat/Live capability is claimed LIVE here.

## Reading contract

Solo Settings → Analytics owns six views: Overview, Business Health, Operations, Team, AI & Usage, Data Health (`src/solo/settings-analytics.tsx`). All 22 keys below are explicitly allowlisted by migration06 and produced by migration05 at version `1.0.0`, dimensions `{}`. They reuse `analytics_evidence_reference`; there is no separate metric warehouse. Sales uses its separate private producer through the same seam and is outside this inventory.

The seven-argument `issue_analytics_evidence_bundle` accepts metric key/version/dimensions/range key/start/end/account epoch. The active profile, live auth actor, explicit active owner/admin tenant seat and eligible tenant lifecycle (active/trial/past_due) authorize reads server-side. A supplied account epoch is an equality check, not authority; platform roles without that seat do not authorize the new seam. The opaque reference expires after 15 minutes. `resolve_analytics_evidence_reference(text)` rechecks actor, tenant, epoch, membership, lifecycle, expiry/revocation and recomputes the source digest at the original as-of. Changed returned or excluded facts invalidate the reference. The legacy three-argument issuer remains separate compatibility behavior.

UI ranges are rolling 7/30/90 UTC days (week/month/quarter). The shared seam also accepts year as a key; actual explicit `[start,end)` bounds govern the cohort, not the key label. End cannot exceed server as-of; bounds must be finite, ordered and within ten years. **Snapshot** metrics report current state at query time with eligible versions no later than as-of; choosing a range does not reconstruct a historical snapshot or trend. **Interval** metrics use the indicated event timestamp. Freshness is source-updated-through and query as-of, never an implied provider synchronization guarantee.

`LIVE` means complete for the producer's narrow recorded cohort, not complete business instrumentation. Excluded candidates make an otherwise LIVE reading `PARTIAL`. Missing required source, unsupported formula or absent eligible known quantity yields `UNAVAILABLE`: values null, contributing count zero, excluded count equals candidates. Read/authorization failure is a failed read, not zero and not a successful unavailable measurement. The readiness column below describes producer rules; the actual response determines account-specific truth.

## Exact inventory

Owner column is the producer's canonical department, responsible for missing instrumentation rather than a claim of an assigned implementation ticket. Nonmonetary units carry no currency conversion. Only estimated model cost uses `estimated_usd`; it is not actual billing.

| Key | Source and period/cohort | Eligibility, exclusions and limit | Unit / readiness | Missing instrumentation owner |
|---|---|---|---|---|
| `business.active_clients_current` | `clients`; snapshot of tenant client lifecycle rows | Unmerged, status active, lifecycle client_active, updated_at ≤ as-of; paused/churned/funded/alumni candidates excluded | count; LIVE/PARTIAL, source missing UNAVAILABLE | client_experience |
| `business.onboarding_current` | `clients`; snapshot distribution by onboarding_stage | Unmerged lifecycle client cohort, recorded nonnull stage plus started/completed/agreement-signed timestamp ≤ as-of, updated_at ≤ as-of. Default pre_invite alone is not activity | distribution/count; LIVE/PARTIAL; existing candidates without eligible instrumentation UNAVAILABLE | client_experience |
| `business.lifecycle_current` | `clients`; snapshot lifecycle distribution | Tenant client_active/client_paused/client_churned/client_funded/client_alumni only; unmerged and version ≤ as-of. Lead/sales stages outside cohort | distribution/count; LIVE/PARTIAL, source missing UNAVAILABLE | client_experience |
| `business.retention` | No supported producer/cohort | No canonical denominator, cohort formula or supported measurement | **UNAVAILABLE**, null; no inferred rate | client_experience |
| `business.profitability` | No supported producer/cohort | No supported canonical cost/revenue formula | **UNAVAILABLE**, null; no currency or margin inference | client_experience |
| `business.nps` | No supported producer/cohort | No supported canonical survey measurement/formula | **UNAVAILABLE**, null | client_experience |
| `operations.systems_check_latest` | `systems_check_snapshot('tenant')`; latest completed full sweep snapshot | Canonical finding status distribution bounded by as-of; targeted/unfinished runs not substituted; missing full run or later completion UNAVAILABLE. Deferred skips/errors remain recorded statuses | distribution/count; LIVE/PARTIAL, missing source/run UNAVAILABLE | operations_pmo |
| `operations.unresolved_findings_current` | Same canonical full sweep snapshot | Only fail findings with resolved_at absent and created_at ≤ as-of; other findings excluded | count; LIVE/PARTIAL, missing source/run UNAVAILABLE | operations_pmo |
| `operations.workflows_active_current` | `tenant_workflows`; registry snapshot | active AND present_in_n8n, updated_at ≤ as-of; last sync is configuration evidence, not execution | count; LIVE/PARTIAL, missing registry UNAVAILABLE | operations_pmo |
| `operations.recorded_workflow_runs` | `paige_workflow_runs`; triggered_at in interval | Tenant-owned, updated_at ≤ as-of; queued/running/succeeded/failed/cancelled; retry null or nonnegative; completion null or finite between trigger and as-of | status distribution/count; LIVE/PARTIAL, missing source UNAVAILABLE; not all provider executions | operations_pmo |
| `operations.recorded_workflow_activity` | Same workflow interval cohort | Same safe eligibility; newest trigger then id, max20. Cap and unsafe records excluded but retained in coverage/digest | diagnostic_events; always PARTIAL when available; missing source UNAVAILABLE | operations_pmo |
| `operations.current_system_exceptions` | Canonical latest completed full sweep snapshot | Unresolved fail/error, safe check_id regex, blocking/high/medium/low severity, finite finding time and completion ≥ finding time, ≤ as-of; max20 newest. Coverage includes skips, unknown/missing findings and cap exclusions | diagnostic_events; LIVE/PARTIAL; missing source/run UNAVAILABLE; empty does not establish comprehensive monitoring | operations_pmo |
| `team.active_members_current` | `tenant_members` + `auth.users`; snapshot | Active explicit tenant seats, auth user exists/not deleted, membership updated_at ≤ as-of; inactive/missing/deleted/version-later excluded. No global role inference | count; LIVE/PARTIAL | people_talent |
| `team.role_distribution_current` | Same seat snapshot | Same eligibility; roles from tenant_members | distribution/count; LIVE/PARTIAL | people_talent |
| `team.performance_scorecards` | No supported producer/cohort | No supported canonical performance formula | **UNAVAILABLE**, null | people_talent |
| `ai.recorded_model_requests` | `paige_llm_trace`; created_at in interval | Tenant traces with working_context_tenant_id null or matching tenant; other contexts excluded. Best-effort writes | count; PARTIAL when available; missing source UNAVAILABLE; zero means no eligible recorded traces | technology_automation |
| `ai.recorded_model_requests_daily` | Same trace cohort, UTC daily buckets intersect interval | Same eligibility; max366 buckets, longer interval UNAVAILABLE; edge days may be partial; zero is recorded-row absence only | series/count; PARTIAL when available | technology_automation |
| `ai.recorded_tokens` | Same trace interval cohort | Matching/null context plus known nonnegative input AND output tokens; unknown quantities excluded; sum both | tokens/count; PARTIAL; no eligible known quantity or missing source UNAVAILABLE | technology_automation |
| `ai.estimated_model_cost` | Same trace interval cohort | Matching/null context, finite nonnegative cost_estimate_usd and exact supported recorded cost_basis; unknown/unsupported estimates excluded | estimated_usd/decimal; PARTIAL; no known quantity UNAVAILABLE; list-price estimate, not bill | technology_automation |
| `ai.recorded_latency` | Same trace interval cohort | Matching/null context and known nonnegative latency_ms; average eligible values; unknown excluded | milliseconds/decimal; PARTIAL; no known quantity UNAVAILABLE | technology_automation |
| `ai.recorded_browser_calls` | `paige_browser_usage`; called_at in interval | Tenant-owned audit rows, created_at ≤ as-of; includes allowed and blocked calls | count; PARTIAL when available; missing source UNAVAILABLE; not successful browsing or spend | technology_automation |
| `ai.voice_consumption` | No supported actual-consumption producer | `tenant_voice_monthly_usage.reserved_usd` is a budget reservation, not actual voice use or bill; never substituted | **UNAVAILABLE**, null | technology_automation |

The supported model cost basis is exactly `list price, in+out tokens, excl caching/thinking/tool round-trips, 2026-07`; recorded estimates exclude those components. No cross-currency conversion, net revenue, profitability or invoice reconciliation is performed.

Diagnostics project exactly source, at, status, severity, retry_count, completed_at, check_key. Workflow items carry null severity/check_key; Systems items carry null retry_count. No names, raw IDs, prompts, URLs or errors are projected. All safe versioned candidate facts, including exclusions, canonical sweep timing/count metadata and bounded output contribute to the source digest.

## Delivery boundary

This source review establishes the inventory/semantics only. Runtime evidence for individual readings, selected tenant and availability belongs to actual authenticated acceptance; synthetic examples do not prove customer measurement coverage. Missing retention, profitability, NPS, scorecard and actual voice instrumentation stays unavailable until its domain owner provides a canonical source and approved formula. The Analytics ledger row remains unavailable for the PAIGE binding until #1837 proves the shared resolver path through both Chat and Live. Definitions/formulas remain visible in the authorized Settings evidence drawer; that does not authorize forwarding unsafe free text/internal references to PAIGE context.

## Bounded COO instrumentation gaps — route to the producer owner

The registry's current owner_department is a metric namespace; it is not permission for Analytics to build the missing source. Priority proposals below require their owning lane's source/formula work; this repair allocates no schema, events or new measurement producer.

| Priority | Gap | Correct instrumentation owner | Required truth before a metric exists |
|---|---|---|---|
| 1 | Retention and churn cohorts | Client Success / client_experience | Recorded lifecycle transitions, eligible cohort and stable time-window denominator; avoid a rate inferred from current snapshots |
| 1 | Profitability | Finance / financial-health producer, coordinating Sales' commercial facts | Canonical costs/cost allocation, revenue recognition and currency basis; Settings never duplicates Sales cash/invoices |
| 2 | NPS | Client Success / survey producer | Timestamped survey responses, scale and response/eligible coverage; KPI registry names alone are insufficient |
| 2 | Team scorecards | Team / people_talent | Verified outcome/activity source, review period and approved score definition; structural empty scoreboard table is not measurement |
| 2 | Voice consumption | Voice / provider telemetry owner with technology_automation | Actual bounded tenant usage and provider receipt/cost basis; reservations do not represent consumption |
| Separate | Cross-domain COO diagnosis and follow-through | Operating/Cognitive Fabric / Orchestration plus owning action domains | Compose authorized versioned evidence; route any proposed action through existing Spine/Harness/Trust/Rail; metrics never grant execution authority |
| Separate | One Chat/Live metric read | Platform Reach #1837 | Authenticated caller RPC, same version/scope/evidence, refused/expired/partial/unavailable handling and modality proof |

No mutable KPI value is persisted to Memory. Business organizational facts remain INT-337-owned; definitions may be durable knowledge, measured state remains records/evidence. Model/provider selection never widens metric access.
