# UI delivery evidence: refined canonical invoice drafts

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: client/known contacts -> invoice-only address -> stacked Catalog/custom items -> deposit/monthly guards -> optional agreement -> method/channel intent -> review -> canonical save/edit/recovery
PAIGE_UI_DESIGN: PASS: approved invoice-refinement layout absorbed into actual Sales; five primary tabs and six outer tabs preserved
MATERIAL_FLOW_CHANGE: YES: approved refined multi-item/contact invoice editor replaces the single-item editor; legacy shortcut row removed, legacy routes preserved
FLOW_PROTOTYPE: PASS: owner approved outputs/invoice-refinement.html and address/items/review captures before production implementation
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace owner/admin prepares, reviews, saves and reopens a canonical invoice draft
VISUAL_DIRECTION: PASS: approved Operate reconciliation direction, defined violet group boundaries, raised controls, invoice table and restrained due-now emphasis
AUTOMATED_EVIDENCE: PASS: 200 focused tests and production-verified canonical SQL dependency; local SQL roundtrip/concurrency separately proven
STATIC_EVIDENCE: PASS: focused ESLint; TypeScript ratchet 12 baseline/current; independent exact-head review pending
RENDERED_EVIDENCE: PASS: actual TenantCommandCenterShell/GrowthHub/Sales production components rendered with local auth/network fixtures; 16 normal light/dark open/closed and four equivalent reflow cases; register, all five tabs, edit/review/create
BEHAVIORAL_EVIDENCE: PASS: local component/hook lifecycle, known contact/manual/snapshot, Catalog repricing/search/reference paging, stacked items, dirty exits and frozen original retry; hosted authenticated lifecycle UNVERIFIED
AUTHENTICATED_RUNTIME: UNVERIFIED: Windows browser ACL blocks hosted account drive; fixture tenant and route IDs are not account proof
KEYBOARD_FOCUS: PASS: heading focus and dirty-exit focus trap; actual keyboard Review scrolling traverses all financial/contact/intent content in local shell fixtures
ZOOM_REFLOW: PASS: equivalent CSS viewports 768x385,683x384,512x384,450x500, readable Review region at least127px and reachable controls; native browser zoom UNVERIFIED
REDUCED_MOTION: PASS: scoped button transitions suppressed by prefers-reduced-motion; static rule and existing component tests, no new motion sequence
STATE_COVERAGE: PASS: unavailable/empty/member/error/loading, known/missing/manual/saved contacts, late selected source, cross-tenant refusal, multi-item/invalid money, stale Catalog/agreement, dirty exits, unknown retry and workspace epochs locally; hosted lifecycle UNVERIFIED
TRUTHFUL_STATE_LABELS: PASS: no issuing, sending, payment, revenue or connected-provider success inferred
SOLO_UI: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
UNVERIFIED: authenticated current/second tenant, signed-JWT save/read lifecycle, native zoom, verified merchant eligibility/issue/send/collection, street lookup, Rail/Mind/Memory ingestion
OWNER_INTENT: both invoice/deposit and recurring, Stripe and PayPal together at launch; this is a dependency slice, not a reduced release
MUST_NOT_HAPPEN: cross-tenant draft writes or reads; duplicate operation effects; legacy provider dispatch; fabricated revenue
MUST_PRESERVE: existing agreements, catalog and declaration records; platform subscription billing stays separate
ACCEPTANCE_CRITERIA: real canonical snapshot writer/readers; tenant-safe contact and agreement refs; search/paging retain selected facts; checked item aggregate and cadence; immutable unknown operation; approved form fit and visual boundaries
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tenant/RLS/CAS guarded; no shared Harness, Rail, Chat, Analytics or Memory write added
INTERNAL_BUILD_IDENTITY: 33b32deeacc1a0ca11d1234a58cc9eee4934aca3; deployment=local-render; environment=development; migrations=APPLIED(20270536000001_sales_invoice_snapshot_v2); edge=NOT_APPLICABLE; evidence=scripts/live-drive/sales-refined-invoice-shell-drive.mjs and scripts/live-drive/artifacts/sales-refined-invoice-shell/geometry.json
RELEASE_CHANNEL: development: approved UI writer depends on production-verified backend; production anticipated after exact review and CI
RELEASE_CLASSIFICATION: internal-only: refined canonical draft UI, complete billing remains PARTIAL
CUSTOMER_RELEASE_IDENTITY: none: no customer update publication
RELEASE_NOTE_REQUIRED: no: internal dependency only
RELEASE_TRUTH_BOUNDARY: PARTIAL: production backend identity and local UI/source subset proven; authenticated UI PROOF OWED; issuing/delivery/collection UNAVAILABLE
RELEASE_RECOVERY: position=revert UI routing/component/hooks while retaining applied snapshot migration, records and managed dispatch refusal; reference=SalesBillingWorkspace.tsx and 20270536000001_sales_invoice_snapshot_v2.sql
SOLO_1536X770_PAIGE_CLOSED: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_1536X770_PAIGE_OPEN: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_1366X768_PAIGE_CLOSED: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_1366X768_PAIGE_OPEN: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_1024X768_PAIGE_CLOSED: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_1024X768_PAIGE_OPEN: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_900X1000_PAIGE_CLOSED: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner
SOLO_900X1000_PAIGE_OPEN: PASS: actual production shell local fixtures; no document overflow or checked navigation/action clipping; internal register/editor scroll owner



## Evidence boundary and artifacts

Run `node scripts/live-drive/sales-refined-invoice-shell-drive.mjs` with the sales-mount Vite harness at loopback5231. Screenshots and geometry are local render fixtures, not authenticated owner CRM, provider, native browser zoom or production business data. PAIGE slot is explicitly unavailable fixture content. Four reflow cases measure reading133/143/127/243 CSS pixels and actual keyboard-scroll content traversal. No shared shell file is changed; narrow layout rules apply only active Sales billing.

The refined UI uses the ordinary-session canonical save/list RPC. Invoice contact edits never write CRM. Canonical primary selections and readable secondary methods remain explicit; missing unit/country stay unknown. Customer and Catalog searches/pages plus exact selected client/product/agreement reads prevent bounded lists from asserting older records are absent. Catalog prices re-resolve on explicit save; unknown saves retain the original operation/request and frozen source amounts.

Processor/method/channel values are draft intent only. Merchant setup belongs in Integrations and verified eligibility has no proven read contract here. Email/SMS review does not send; iMessage and street lookup remain unavailable. The full approved issuance/delivery/linked mixed-billing rollout remains outstanding and is not narrowed by this dependency release.
