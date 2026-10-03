# UI delivery evidence: versioned invoice snapshot contract

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: canonical customer contacts and ordered Catalog/custom items -> invoice-only snapshot -> CAS edit -> exact-operation replay; backend slice only
PAIGE_UI_DESIGN: PASS: existing Sales ownership preserved; no visual implementation in this slice
MATERIAL_FLOW_CHANGE: YES: draft persistence contracts prepare the approved billing workflow; no enabled UI caller yet
FLOW_PROTOTYPE: PASS: owner approved reconciliation prototype and final control polish on 2026-10-02; prototype is illustrative
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace administrator persists a client billing draft
VISUAL_DIRECTION: PASS: approved reconciliation direction remains controlling; no visual change here
AUTOMATED_EVIDENCE: PASS: 169 focused tests; local SQL legacy plus 27 negative cases, maximum items, actual SQL-to-client create/edit/replay/mixed list and two-session CAS/concurrent create proof
STATIC_EVIDENCE: PASS: focused ESLint and definer/ACL lint; TypeScript ratchet and independent exact-head review pending
RENDERED_EVIDENCE: UNVERIFIED: production UI caller not enabled; prototype screenshots do not prove this slice
BEHAVIORAL_EVIDENCE: UNVERIFIED: source/mock lifecycle and local SQL proof only; authenticated UI traversal not enabled
AUTHENTICATED_RUNTIME: UNVERIFIED: local PostgreSQL role tests stub auth helpers; hosted workspace/auth integration pending
KEYBOARD_FOCUS: NOT_APPLICABLE: no UI component changed
ZOOM_REFLOW: NOT_APPLICABLE: no UI component changed
REDUCED_MOTION: NOT_APPLICABLE: no motion changed
STATE_COVERAGE: PASS: local legacy/v2, unknown schema refusal, wrong tenant/client/contact/agreement, aggregate money/cadence, replay-before-mutable-validation and concurrent CAS; hosted lifecycle UNVERIFIED
TRUTHFUL_STATE_LABELS: PASS: no issuing, sending, payment, revenue or connected-provider success inferred
SOLO_UI: YES: future Campaigns Sales consumer; existing six-tab outer navigation unchanged
UNVERIFIED: signed-JWT hosted tenant lifecycle, authenticated UI, provider eligibility, issuance/delivery, Rail/Mind/Memory ingestion; new UI writer not enabled
OWNER_INTENT: both invoice/deposit and recurring, Stripe and PayPal together at launch; this is a dependency slice, not a reduced release
MUST_NOT_HAPPEN: cross-tenant draft writes or reads; duplicate operation effects; legacy provider dispatch; fabricated revenue
MUST_PRESERVE: existing agreements, catalog and declaration records; platform subscription billing stays separate
ACCEPTANCE_CRITERIA: server scopes all item/contact/agreement IDs; checked aggregate integer money; legacy and v2 readers; retry exact original request before mutable validations; CAS and concurrent create proven locally
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tenant/RLS/CAS guarded; no shared Harness, Rail, Chat, Analytics or Memory write added
INTERNAL_BUILD_IDENTITY: development: sales/invoice-snapshot-contract based on d6a6927fc74031de70877aaae5d4328f8d770582; deployment=none; environment=development; migrations=PENDING(20270536000001_sales_invoice_snapshot_v2); edge=NOT_APPLICABLE
RELEASE_CHANNEL: development: backend compatibility dependency, production anticipated after independent review and exact-head CI
RELEASE_CLASSIFICATION: internal-only: versioned draft contract without enabled new UI writer
CUSTOMER_RELEASE_IDENTITY: none: no customer update publication
RELEASE_NOTE_REQUIRED: no: internal dependency only
RELEASE_TRUTH_BOUNDARY: PARTIAL: local source/SQL proof only; hosted auth and production identity PROOF OWED; provider issue/send UNAVAILABLE
RELEASE_RECOVERY: position=unapplied forward migration; preserve historical snapshots, managed dispatch refusal and restrictive constraint; reference=20270536000001_sales_invoice_snapshot_v2.sql
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: backend slice has no enabled UI consumer
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: backend slice has no enabled UI consumer


## Local executable proof

The disposable PostgreSQL 16 cluster is loopback port 56219, initialized explicitly as postgres with trust authentication. Drivers verify its data directory before fixture changes. Auth/tenant helper stubs are local test fixtures, not signed-JWT or hosted account proof. Transactions roll back; concurrency uses and drops a disposable database. No provider or CRM mutation occurs.

Commands: `node scripts/sql/sales-invoice-snapshot-proof.mjs <psql.exe> 56219 postgres <work/sales-invoice-proof-db>` and the same arguments to `sales-invoice-snapshot-concurrency.mjs`. The schema_version payload format is separate from billing_draft_version CAS revision. Original v1 request replay remains byte/JSON-equivalent; normalization does not rewrite historical rows.

## Portfolio and protected authority

1. Outcome: administrator creates and reopens multi-offer invoice drafts with invoice-only contact snapshots.
2. Owning family: CRM/Sales family 4; platform billing remains separate.
3. Human canonical RPC is the only write path; shared Harness/Rail authority is not extended.
4. No new Spine billing-draft capability: UNAVAILABLE.
5. Processor and payment method selections are intent only; verified eligibility and external actions remain unavailable.
6. Internal draft save is reversible human intent; no PAIGE mutation verb or second approval system added.
7. No new durable job or scheduler; future governed delivery must reuse proven transport.
8. Canonical row, operation and CAS/list readback supply local provenance; Rail/Mind/Memory ingestion is not claimed.
9. Existing campaigns.sales availability is unchanged; complete billing launch remains partial.
10. Authenticated current/second-tenant, provider and native browser proof remain owed; Windows browser ACL blocker is not success evidence.
