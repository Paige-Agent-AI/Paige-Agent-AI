# UI delivery evidence: canonical Sales draft storage

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: catalog/custom offer -> tenant-owned draft -> guarded read -> versioned edit -> exact-operation retry; source slice only
PAIGE_UI_DESIGN: PASS: existing Sales ownership preserved; no visual implementation in this slice
MATERIAL_FLOW_CHANGE: YES: draft persistence contracts prepare the approved billing workflow; no enabled UI caller yet
FLOW_PROTOTYPE: PASS: owner approved reconciliation prototype and final control polish on 2026-10-02; prototype is illustrative
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace administrator persists a client billing draft
VISUAL_DIRECTION: PASS: approved reconciliation direction remains controlling; no visual change here
AUTOMATED_EVIDENCE: PASS: 42 focused tests; 48 disposable PostgreSQL assertions; docs/evidence/sales-billing/local-draft-proof.txt
STATIC_EVIDENCE: PASS: four client files ESLint; independent non-author source review PASS; TypeScript status recorded in PR
RENDERED_EVIDENCE: UNVERIFIED: production UI caller not enabled; prototype screenshots do not prove this slice
BEHAVIORAL_EVIDENCE: UNVERIFIED: source/mock lifecycle and local SQL proof only; real UI traversal pending
AUTHENTICATED_RUNTIME: UNVERIFIED: local PostgreSQL role tests stub auth helpers; hosted workspace/auth integration pending
KEYBOARD_FOCUS: NOT_APPLICABLE: no UI component changed
ZOOM_REFLOW: NOT_APPLICABLE: no UI component changed
REDUCED_MOTION: NOT_APPLICABLE: no motion changed
STATE_COVERAGE: PARTIAL: refusal, unknown outcome, empty/unavailable read, CAS and retry covered; actual concurrent sessions and pending-save lifecycle proof owed
TRUTHFUL_STATE_LABELS: PASS: no issuing, sending, payment, revenue or connected-provider success inferred
SOLO_UI: YES: future Campaigns Sales consumer; existing six-tab outer navigation unchanged
UNVERIFIED: hosted auth, full migration chain, SQL-to-client combined roundtrip, simultaneous SQL races, enabled UI and four-viewport runtime
OWNER_INTENT: both invoice/deposit and recurring, Stripe and PayPal together at launch; this is a dependency slice, not a reduced release
MUST_NOT_HAPPEN: cross-tenant draft writes or reads; duplicate operation effects; legacy provider dispatch; fabricated revenue
MUST_PRESERVE: existing agreements, catalog and declaration records; platform subscription billing stays separate
ACCEPTANCE_CRITERIA: server resolves tenant/client/catalog; wrong access fails; retry retains identity; edit requires current version; source subset proven
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tenant/RLS/CAS guarded; no shared Harness, Rail, Chat, Analytics or Memory write added
INTERNAL_BUILD_IDENTITY: exact SHA recorded in PR; deployment=none; environment=local; migrations=NOT_APPLIED(20270535000000); edge=NOT_APPLICABLE; evidence=docs/evidence/sales-billing/local-draft-proof.txt
RELEASE_CHANNEL: development: local source only
RELEASE_CLASSIFICATION: internal-only dependency
CUSTOMER_RELEASE_IDENTITY: none: no owner-visible hosted capability delivered
RELEASE_NOTE_REQUIRED: no: internal dependency only
RELEASE_TRUTH_BOUNDARY: PARTIAL source implementation; hosted draft flow PROOF OWED; provider issue/send UNAVAILABLE
RELEASE_RECOVERY: position=unapplied migration can be withheld; reference=20270535000000_sales_billing_drafts.sql

Independent review: separate billing_draft_review agent did not author files. Initial nullable response/catalog input findings corrected; sole recheck exposed catalog edit roundtrip; owner explicitly authorized one additional round. Additional source review PASS on 2026-10-02. Reviewed source hashes are recorded in docs/evidence/sales-billing/independent-review.md. Exact committed head and CI remain required before merge.
