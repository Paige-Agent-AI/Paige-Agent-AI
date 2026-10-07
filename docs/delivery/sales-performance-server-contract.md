# INT-341 bounded server contract

SHELL: SOLO. Parent INT-311. Development base `761192caef730ff615d6e29c78a1e2abd92149d3`.

## Scope and shared-owner coordination

Authoritative Sales calculations are private database producers. No Performance UI, Chat tool, provider action, reference store or measurement cache is added. Existing funnel v1 is unchanged.

On 2026-10-07 the INT-340 owner confirmed Sales-private producers/tests and the envelope below; shared dispatcher, registry constraints, issuer/resolver generalization and frontend validator remain INT-340-owned and not delivered. This slice does not modify those seams. Platform Reach owns eventual shared Spine/Chat/Live access. Domain computation alone does not close the owner-facing metric flow.

Migration `20270601000002_sales_performance_contract.sql` was created by the installed Supabase migration CLI and renumbered after inspecting current main and open PR migration claims. Recheck at push/merge. No historical migration is rewritten.

## Private entry and authority

`_sales_performance_metric_bundle(tenant, key, version, start, end, as_of, dimensions)` is STABLE, SECURITY DEFINER, pinned empty search path/UTC, and has no EXECUTE grants to PUBLIC, anon, authenticated or service_role. The shared issuer's database owner is the intended caller.

Defense in depth rechecks auth.uid, current workspace, profile active workspace, active owner/admin membership, non-deleted/non-banned user and eligible tenant lifecycle. Platform-owner standing alone grants no finance read. No tenant authority is taken from URLs or record labels.

Only version 1.0.0 and the eleven keys below are admitted. Finite ordered half-open ranges are bounded to ten years, with end <= as_of. Pipeline/stage dimensions are UUIDs, validated within the tenant and against each other. Unknown dimensions, invoice/payment IDs and provider filters refuse. Non-opportunity metrics admit no dimensions in this first version.

## Exact metric definitions — version 1.0.0

| Key | Cohort / formula | Unit |
|---|---|---|
| `sales.opportunities.created` | Count tenant deals with created_at in [start,end); optional validated pipeline/stage | count |
| `sales.opportunities.open_current` | Count currently open tenant deals; ignores period for membership, explicit current_snapshot | count |
| `sales.opportunities.won_current_close_date` | Currently won deals with actual_close_date in UTC date cohort; undated current wins excluded/disclosed | count |
| `sales.opportunities.lost_current_close_date` | Same for currently lost deals; no stage-label outcome inference | count |
| `sales.pipeline.open_value` | Sum nonnegative eligible open values by currency; same-tenant pipeline/stage relationship required | currency minor units |
| `sales.invoices.issued_count` | Canonically issued in timestamp range, currently non-void, frozen issue evidence present; exclude drafts and undated legacy issue claims | count |
| `sales.invoices.issued_amount` | Sum face amount of that exact issuance cohort by currency | currency minor units |
| `sales.receivables.outstanding_current` | Sum canonical remaining balance for collectible issued/recorded invoices by currency; current snapshot | currency minor units |
| `sales.receivables.overdue_current` | Same balance, positive outstanding and due_date before UTC as_of date; missing due dates/negative balances excluded | currency minor units |
| `sales.cash.recorded_received` | Signed canonical receipts/reversals by received_at range; separate human-recorded/imported/LIVE provider-verified sources | currency minor units |
| `sales.payments.posted_net_allocations` | Same signed ledger using immutable posting created_at range | currency minor units |

Money totals serialize exact integer amounts as decimal strings, preserving arbitrary aggregate precision. Currencies are separate; no FX/scaling/rounding or combined monetary scalar. Zero-valued deals contribute but force partial value coverage because zero is a schema default. Closed-date counts explicitly describe mutable current cohorts, not immutable historical conversion. Issuance is **non-void issuance**, not gross issuance; later voids restate this cohort. This settles the earlier proposed gross-vs-net alternative before version 1 is delivered.

Cash is recorded ledger truth, not bank reconciliation. Requests/unknown operations are not sources. Provider TEST allocations are excluded from business cash; manual/imported receipts are not provider-confirmed. Receivable balance still includes all canonical allocations, including TEST where present. Test-affected receivable coverage is partial; these populations must never be shown as a reconciled business-money waterfall. A later void does not erase a historical payment; only a canonical reversal changes that allocation history.

Manual reversal received_at retains the original receipt date, so received-period totals can restate; posting-period totals place the correction where it was recorded. Provider reversal lifecycle remains incomplete and is disclosed.

## One balance owner, backward compatibility

`_sales_invoice_balance_rows(tenant, optional invoice)` factors existing signed receipt-allocation arithmetic into a private Sales relational projection. It includes managed and imported obligations. `_sales_invoice_read` and `list_sales_collection_register` reuse it, preserving their existing entry authority, pagination, labels, payment presentation and errors. Single-invoice calls supply the invoice predicate internally; they do not materialize all workspace balances per document.

Performance aggregates that same projection in its server statement. It does not sum UI pages, create a balance table or create an alternate remaining-balance formula. Existing commercial mutations/issued snapshots/payment history are unchanged.

## Envelope and revalidation handoff

Producer returns metric_key/version, owner_department=sales, label, definition, formula, exact range/timezone/semantics, dimensions, tagged values, unit, source_refs, as_of, freshness, coverage/exclusions, truth_state/caveats and source_revision_ref. Every relevant contributing/exclusion fact is deterministically projected and hashed privately; no count-plus-max-timestamp shortcut. Raw IDs/records/names are not returned in metric values.

`evidence_ref=null`, `evidence_state=shared_issuance_required` explicitly mean **not yet issued authoritative user evidence**. No fake reference is generated. INT-340 must admit these producers through the existing opaque actor/tenant/epoch/range/reference/expiry lifecycle and re-read the same fixed version/dimensions/as_of. Source drift must refuse the prior reference. Existing funnel issuance, TTL and semantics remain unchanged.

Computational truth states describe source coverage inside the producer, not delivery availability. No private-producer LIVE payload upgrades the product to LIVE without shared issuance and authenticated acceptance.

## Proof and remaining boundaries

`scripts/sql/sales-performance-proof.mjs` uses a guarded isolated PostgreSQL cluster and generic two-tenant fixtures. It loads actual incumbent invoice reader/Collections register bodies, proves absence before migration, applies migration twice, compares pre/post document and register rows, traverses pages, refuses expired/foreign cursors and reconciles amounts to source rows. Provider rows are synthetic unit fixtures, not provider execution proof.

`scripts/sql/sales-performance-mutation-proof.mjs` deliberately perturbs in-memory migration text in disposable databases: mixed currency, foreign rows, void reason, reversal sign, widened role, unchanged revision and silently changed version. It requires assertion-based failure, not infrastructure/SQL failure. Hosted CI runs both through the existing Sales SQL proof workflow.

Close rate, weighted forecast, attendance, set rate, speed-to-lead, pipeline coverage and collection rate remain withheld as grounded. No comparison or historical conversion is added. No KPI values enter Memory. No UI impact: presentation and existing evidence hook untouched. Impeccable checks apply to truthful labels/state semantics; rendered interface review is not applicable to this no-UI slice.

Release channel: development until observed otherwise. Customer release identity: none. Shared issuance/authenticated UI/Chat/Live metric reach: PROOF OWED. Merge/deployment/production function persistence: not yet established. Independent exact-head review and hosted checks are required before merge. Recovery is a bounded forward fix preserving the private projection and unchanged canonical ledger; no ledger backfill or provider action.

Local executed evidence: 72 real PostgreSQL assertions passed on PostgreSQL 16.14. Function/ACL and migration-version static guards passed. Seven deliberate accounting/authority/revision mutants are required to fail by assertions; normal producer proof remains separately green. Full repository regression/typecheck and hosted exact-head gates are recorded at the PR boundary, not inferred here.
