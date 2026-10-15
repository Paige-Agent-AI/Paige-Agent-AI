# INT-341 — Sales Performance initial grounding

SHELL: SOLO. Parent INT-311; shared evidence architecture INT-340. Grounded 2026-10-07 at main `761192caef730ff615d6e29c78a1e2abd92149d3` on isolated branch `feat/sales-performance-int341`.

FLOW-BY-FLOW: APPLIED — canonical producer → tenant-authorized server metric → evidence issuance → revalidation → Performance presentation → canonical drilldown. IMPECCABLE: APPLIED to interaction planning; rendered/finish review remains owed. Independent non-author source grounding completed; independent review of this packet required before treating it as reviewed. No product implementation or deployment claimed.

## A. Current state and pre-edit routing

1. Owner outcome: understand real commercial results, inspect their evidence, and reach the records needing action.
2. Sales owns commercial formulas and source correctness; INT-340 owns generalized evidence machinery, Platform Reach owns shared metric capability registration, Marketing owns acquisition metrics.
3. Reuse shared tenant/actor authority and evidence lifecycle. No new Harness, gateway, scheduler, orchestration or context assembly. Harness completion map is historical and does not establish current metric reach.
4. Metric Spine capability: UNAVAILABLE in grounded registry. Existing `sales_collections.read` is domain context, not a generic KPI capability. Platform Reach supplies the shared read seam.
5. No external connection needed for canonical record metrics. Provider allocations are read-only evidence; no merchant setup/payment operation authorized by this work. Provider registry states do not establish payment acceptance.
6. Read-only calculations: no mutation verb, consequential approval or budget spend. Finance lens must preserve active owner/admin authority; a future shared reader rechecks its allowed lens. No approval bypass.
7. On-demand server reads require no new jobs/events. Later historical producer improvements belong at existing governed domain mutations.
8. Opaque evidence identity, source revision, range, coverage and revalidation prove a read. They are not transaction execution receipts. Existing payment Rail remains unchanged.
9. Existing `sales.department` and `analytics` Binding Ledger rows cover the current surface. Performance remains inside `SalesWorkspace`; no navigation/ledger availability upgrade in this packet.
10. Required proof: real two-workspace authenticated metrics, role/foreign-ID/account-switch negatives, source reconciliation, expiry/revalidation and rendered UI. All new metric runtime proof is UNVERIFIED.

Sales ancestry includes #1792 canonical Collections balances, #1793 PayPal readback only, #1795 package RPC, #1797 Chat package read, and #1808 unrelated interaction closeout at this main. #1806 remains held; INT-339 clearance not established. No merchant/payment acceptance inferred.

## B/C. Catalogue and formula proposals

All new keys below propose version `1.0.0`, owner Sales. PARTIAL means grounded canonical source support exists but the authoritative aggregate/evidence delivery is not implemented or authenticated. It is not a shipped claim. Existing funnel computes its own LIVE/PARTIAL/UNAVAILABLE state per request; authenticated current-runtime status remains UNVERIFIED.

Ranges are server-resolved half-open `[start,end)` UTC instants. DATE cohorts use explicit UTC date bounds initially, disclosed to the owner; no guessed tenant timezone. Current snapshots use server `as_of`, never pretend to be period-end history. Currency metrics return separate currency/minor-unit totals; no FX. Filters must be tenant-validated, bounded and included in revision identity.

| Key | Formula and business meaning | Unit / dimensions | Coverage and exclusions | State |
|---|---|---|---|---|
| `sales.opportunities.created` | COUNT tenant deals created in range | count; pipeline/owner | Current canonical record cohort; deleted records cannot reconstruct historical arrivals | PARTIAL |
| `sales.opportunities.open_current` | COUNT presently `status=open` at as_of | count; pipeline/owner | Current state only; no previous-period comparison | PARTIAL |
| `sales.opportunities.won_current_close_date` | COUNT currently won with actual_close_date in date cohort | count; pipeline/owner | Reopened deals leave cohort; missing close dates excluded/disclosed | PARTIAL |
| `sales.opportunities.lost_current_close_date` | Same for lost | count; pipeline/owner/reason | Current status is authoritative, not stage label; reason coverage disclosed | PARTIAL |
| `sales_funnel.created_deals_by_current_stage` | Existing COUNT created cohort grouped by current stage in unique default pipeline | count; existing stage contract | Excludes other pipelines/unsafe stages; not historical conversion | Existing contract; per-request truth |
| `sales.pipeline.open_value` | SUM eligible open value_cents per currency | currency; pipeline/owner | Default zero cannot distinguish deliberately zero from missing value; disclose zero-value records | PARTIAL |
| `sales.pipeline.weighted_value` | SUM eligible open value_cents × stage probability / 100 per currency | currency; stage/pipeline | Editable assumptions, not calibrated prediction; safe same-tenant stage required; round only final aggregate using declared rule | PARTIAL |
| `sales.close_rate.current_closed_date_cohort` | won / (won + lost) in current closed-date cohort | percent; pipeline/owner | Zero denominator → unavailable/null. Not stage conversion or created-cohort conversion | PARTIAL |
| `sales.deal.average_won_value` | SUM eligible won value / COUNT eligible won deals, same date cohort, per currency | currency; pipeline/owner | Average recorded won-deal value, not generic AOV; zero/missing valuation caveat | PARTIAL |
| `sales.invoices.issued_count` | COUNT invoices canonically issued in timestamp range | count; owner/deal where validated | Require issued timestamp + frozen issue evidence; exclude drafts/legacy rows missing evidence | PARTIAL |
| `sales.invoices.issued_amount` | SUM issued face amounts in that cohort by currency | currency | Gross issuance, with subsequently voided amount separately disclosed; not current receivable/cash | PARTIAL |
| `sales.receivables.outstanding_current` | Aggregate existing canonical Collections remaining balance for collectible issued/recorded obligations | currency; provenance | Reuse balance owner, include imported obligations explicitly; exclude void/draft/uncollectible. No paginated UI summation | PARTIAL |
| `sales.receivables.overdue_current` | Same remaining balance where due_date < UTC as_of date | currency; provenance | Missing due dates disclosed; snapshot, not historical overdue | PARTIAL |
| `sales.cash.recorded_received` | SUM signed receipt/reversal allocations with received_at in range | currency; manual/provider/import provenance | Human-recorded ≠ verified. Corrections restate original receipt period. Exclude provider TEST records | PARTIAL |
| `sales.cash.provider_verified` | LIVE provider-verified allocations in received-date cohort | currency; provider | No requests/accepted/unknown operations; provider reversal lifecycle still partial | PARTIAL |
| `sales.cash.manual_recorded` | Signed manual allocations in received-date cohort | currency; owner-recorded/imported | Not independently provider-confirmed | PARTIAL |
| `sales.payments.posted_net_allocations` | Signed ledger amounts with created_at in range | currency; evidence class | Correction posting flow; label net allocations recorded, not bank cash | PARTIAL |
| `sales.schedule.upcoming_obligations` | Validated finite/custom schedule projection by due date | count/currency; term kind | Agreed schedule, not generated receivable or active autopay; open-ended terms not lifetime totals | PARTIAL |
| `sales.contracts.booked_value` | No defensible generic total yet | currency | Active recorded terms ≠ signed commitment; recurring cadence amount ≠ lifetime obligation | UNAVAILABLE |
| `sales.collection.rate` | Candidate collected / eligible due obligations | percent | Period denominator and installment allocation linkage incomplete; no substitution with invoice face value | UNAVAILABLE |
| `sales.appointments.show_rate_resolved` | Proposed done / (done + no_show), by appointment start | percent | Attendance producer exists; Sales eligibility/dedup/resolution coverage contract missing | PARTIAL; withhold value |
| `sales.appointments.no_show_rate_resolved` | Proposed no_show / same denominator | percent | Cancelled/blocked excluded; elapsed scheduled appointments never inferred attended | PARTIAL; withhold value |
| `sales.appointments.set_rate` | Candidate appointments set / eligible lead cohort | percent | Canonical eligible lead/appointment linkage denominator absent | UNAVAILABLE |
| `sales.leads.speed_to_first_contact` | First legitimate verified outreach − canonical arrival | duration | Last-contact/updated timestamps and manual note logs are insufficient | UNAVAILABLE |
| `sales.pipeline.coverage` | Eligible pipeline / canonical same-period same-currency target | ratio | Target/quota denominator not grounded; never invent 3×/4× | UNAVAILABLE |

Historical comparisons are withheld for current snapshots and partial historical cohorts. Flow comparisons require both periods computed under the same complete versioned coverage contract. No stage leak/velocity claim from present stage counts.

## D/E. Source and missing-producer map

- `deals`, `pipelines`, `pipeline_stages`: current status, integer value, currency, close dates, owner, editable probability. Schema `20260627022609_75772202-1c60-4ca8-b0ce-e37db5e024d4.sql`.
- `deal_activities`, `pipeline_deal_outcomes`, stage automation events exist. Governed movement/outcome producer in `20270531000000_restore_pipeline_core_and_same_name_guard.sql`; outcomes in `20261224000001_solo_pipeline_command_desk.sql`. Outcome events omit frozen economics; stage trigger can fail open; cascading deletion/history coverage prevents universal historical conversion claim. Need complete initial-entry/movement/reopen coverage and retained economics before historical rates/value.
- `paige_invoices`: lifecycle `20270543000000_sales_invoice_lifecycle.sql`; publication sets billing_issued_at and frozen facts. Draft and legacy status labels alone prove no issuance/cash.
- `paige_invoice_payments`: append-only receipts/reversals; reversal received_at copies original, created_at is correction posting. Provider evidence extension `20270597000001_sales_invoice_provider_operations.sql` owns verified identities and allocation; provider operations alone are not cash.
- Canonical `_sales_invoice_read` plus `list_sales_collection_register` own remaining balance and manual/provider split. Imported recorded obligations need register semantics; managed-only reader is insufficient. Factor/reuse the balance owner in one consistent server snapshot, do not copy a Performance formula or sum 50-row pages.
- `tenant_client_agreements` owns terms/schedules, `paige_agreements` owns signing state; `20270598000001_sales_commercial_package_read.sql` separates obligation, receivable, allocation, outstanding. No active-terms-to-signed-value inference.
- `internal_bookings`: done/no_show producer and Solo Calendar controls exist (`admin_set_booking_status`, `20260712130000_booking_rpc_isolation_hardening.sql`). Collective/class records require dedup and Sales appointment scope; unresolved outcomes remain explicit.
- `clients` contact arrival and CRM activity logs exist. `activity.log` can log note with external_effect=false and updates last_contacted_at (`20270516000000_crm_commands_speak_contact_methods.sql`). Need a canonical first legitimate outreach event with contact-arrival provenance before speed-to-lead.
- No canonical Sales period target grounded. Add a governed target contract only in its own bounded domain slice, not a metric default.

## F/H. Evidence and PAIGE handoff

Reuse `20261004000000_analytics_evidence_bundle.sql`: actor/tenant/account-epoch binding, forced-RLS private reference registry, 15-minute expiry, re-resolution of authority/lifecycle/source revision. Registry stores identities, not KPI results. Existing funnel meaning/version stays intact.

INT-340 extension requirement: metric dispatcher/admission, bounded dimensions, currency/value shapes, source-revision inputs including correction/evidence/probability changes, consistent as_of, and comparison coverage. Current issuer/table/frontend validator admit one funnel metric; do not loosen these privately.

Each Sales producer supplies metric_key/version, department, definition/formula, exact range/as_of, dimensions, values/unit/currency, sources, coverage/exclusions/caveats, freshness and revision input. Shared issuer supplies opaque evidence reference/expiry. Server tenant scope comes from authenticated authority, never URL/account number or client-supplied foreign IDs.

Platform Reach's shared read capability must consume that envelope for typed Chat and Live. It must refuse unknown metric/dimension or unauthorized lens, revalidate evidence, and preserve identical values/range/tenant/reference. No Sales Chat calculator, Voice backend, private registry, aggregate client Rail fabrication or mutable KPI Memory.

Catalog metadata/ACL presence was checked read-only in production for existing issuer/resolver/Collections/package RPCs. This is not authenticated metric/isolation proof.

## G. UI direction — proposal, not approved implementation

Preserve Sales → Performance. Organize the existing home around pipeline, commercial outcomes, invoices, outstanding and recorded/verified payments, with clearly separated currency totals and snapshot/period labels. Evidence inspection remains a drawer; canonical drilldown leads to Opportunities, Invoices, Payments or Collections. Missing metrics explain the missing source without fake values/trends.

No material visual redesign has been implemented. If a new operating layout is chosen, next deliverable is an interactive prototype for owner review before production UI. Existing tokens/incumbent Solo style govern; Impeccable clarity, hierarchy, accessibility, fit and truthful states plus four required viewports/dock states must be reviewed. Source/contract work continues independently of visual approval.

Impeccable reference: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md

## I/J. Collision and bounded implementation sequence

- Separate held merchant work remains excluded. No provider/merchant/shared Chat files touched; cross-lane release work retains its own owner.
- INT-340 owns shared evidence issuance/registry/generalized validator. Sales supplies this explicit extension contract before shared changes.
- Platform Reach owns Spine/Chat registry; INT-334/C4 own routing/continuation; no edits here.
- Operating Fabric #1790 consumes domain snapshots; Sales provides bounded provenance, not cross-domain assembly. Marketing acquisition metrics stay outside Sales.

1. Source/contract packet and non-author review (this boundary).
2. Domain-local opportunity/count/value producers and negative tests; retain current funnel contract. Source-ready does not mean LIVE until evidence and authentication pass.
3. Shared Sales balance-owner reuse plus issued/payment aggregates with currency/provenance/test-mode/reversal controls and real PostgreSQL fixture proof.
4. Coordinate INT-340 envelope/dispatcher integration; expiry, source-change, role and two-tenant tests. No competing evidence store.
5. Interactive Performance prototype → owner approval → production presentation consuming server values only.
6. Platform Reach shared read adoption; Chat/Live parity proof when seam exists.
7. Producer gaps as separate bounded follow-ups; withheld metrics stay honest.
8. Exact-head independent review/CI → merge/deploy → authenticated two-workspace/owner readback; canonical shipped log only after delivery.

## Proof boundary

Independent non-author packet review: PASS; reviewer did not write or edit this packet. This is not product release review. Two non-blocking details are accepted as mandatory S-P2 contract work: choose exact aggregate rounding/eligibility for weighted estimates, and disclose environment/cohort compatibility because canonical balances can include TEST allocations while business cash excludes them. Do not display those populations as one reconciled financial waterfall or create competing balance arithmetic.

Implemented: grounding packet only. Product tests not run; existing tests inspected. New metric computation/UI/Chat reach: UNAVAILABLE pending implementation. Authenticated isolation/runtime: UNVERIFIED. Prototype approval/finish review: owed. Merge/deployment: N/A. #1806 held. No money moved.
