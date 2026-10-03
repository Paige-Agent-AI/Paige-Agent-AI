# UI delivery evidence: Sales reader receiver crash repair

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: client/known contacts -> invoice-only address -> stacked Catalog/custom items -> deposit/monthly guards -> optional agreement -> method/channel intent -> review -> canonical save/edit/recovery
PAIGE_UI_DESIGN: PASS: approved invoice-refinement layout absorbed into actual Sales; five primary tabs and six outer tabs preserved
MATERIAL_FLOW_CHANGE: NO: approved refined multi-item/contact invoice editor replaces the single-item editor; legacy shortcut row removed, legacy routes preserved
FLOW_PROTOTYPE: NOT_REQUIRED: existing approved flow preserved; owner approved outputs/invoice-refinement.html and address/items/review captures before production implementation
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace owner/admin prepares, reviews, saves and reopens a canonical invoice draft
VISUAL_DIRECTION: PASS: approved Operate reconciliation direction, defined violet group boundaries, raised controls, invoice table and restrained due-now emphasis
AUTOMATED_EVIDENCE: PASS: 41 focused tests; two failing-first real SDK receiver/construction regressions now pass; no SQL changes
STATIC_EVIDENCE: PASS: final TypeScript ratchet baseline12/current12, focused ESLint and diff check; nonauthor source review41170527 and mechanical integration19ba4042 PASS
RENDERED_EVIDENCE: PASS: production-built actual shell with real source hook and real SDK/mock fetch; Overview/Invoices ready and injected construction-error cases render with zero pageerrors; prior unchanged-layout matrix supporting only
BEHAVIORAL_EVIDENCE: PASS: local component/hook lifecycle, known contact/manual/snapshot, Catalog repricing/search/reference paging, stacked items, dirty exits and frozen original retry; hosted authenticated lifecycle UNVERIFIED
AUTHENTICATED_RUNTIME: UNVERIFIED: Windows browser ACL blocks hosted account drive; fixture tenant and route IDs are not account proof
KEYBOARD_FOCUS: PASS: heading focus and dirty-exit focus trap; actual keyboard Review scrolling traverses all financial/contact/intent content in local shell fixtures
ZOOM_REFLOW: PASS: equivalent CSS viewports 768x385,683x384,512x384,450x500, readable Review region at least127px and reachable controls; native browser zoom UNVERIFIED
REDUCED_MOTION: PASS: scoped button transitions suppressed by prefers-reduced-motion; static rule and existing component tests, no new motion sequence
STATE_COVERAGE: PASS: unavailable/empty/member/error/loading, known/missing/manual/saved contacts, late selected source, cross-tenant refusal, multi-item/invalid money, stale Catalog/agreement, dirty exits, unknown retry and workspace epochs locally; hosted lifecycle UNVERIFIED
TRUTHFUL_STATE_LABELS: PASS: no issuing, sending, payment, revenue or connected-provider success inferred
SOLO_UI: YES: actual Campaigns Sales editor, register and source adapters within established shell
UNVERIFIED: authenticated current/second tenant, signed-JWT save/read lifecycle, native zoom, verified merchant eligibility/issue/send/collection, street lookup, Rail/Mind/Memory ingestion
OWNER_INTENT: both invoice/deposit and recurring, Stripe and PayPal together at launch; this is a dependency slice, not a reduced release
MUST_NOT_HAPPEN: cross-tenant draft writes or reads; duplicate operation effects; legacy provider dispatch; fabricated revenue
MUST_PRESERVE: existing agreements, catalog and declaration records; platform subscription billing stays separate
ACCEPTANCE_CRITERIA: real canonical snapshot writer/readers; tenant-safe contact and agreement refs; search/paging retain selected facts; checked item aggregate and cadence; immutable unknown operation; approved form fit and visual boundaries
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tenant/RLS/CAS guarded; no shared Harness, Rail, Chat, Analytics or Memory write added
INTERNAL_BUILD_IDENTITY: a288a3a6c0a4215cf759e1b282d1f86677d2fc24; deployment=dpl_GJ7QPbYeG4RohfpJg6WR7Dr43R21; environment=production; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/sales-receiver-build-drive.mjs and scripts/live-drive/artifacts/sales-receiver-build-proof/result.json
RELEASE_CHANNEL: production: observed READY exact squash and expected aliases; required exact-head checks PASS; owner confirmed default Sales renders after hard reload; broader authenticated lifecycle remains UNVERIFIED
RELEASE_CLASSIFICATION: internal-only: refined canonical draft UI, complete billing remains PARTIAL
CUSTOMER_RELEASE_IDENTITY: none: no customer update publication
RELEASE_NOTE_REQUIRED: no: internal dependency only
RELEASE_TRUTH_BOUNDARY: PARTIAL: production UI/backend identities and local UI/source subset proven; authenticated UI PROOF OWED; issuing/delivery/collection UNAVAILABLE
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

## Supporting prior UI production closeout — 2026-10-03

PR #1659 reviewed head `3f3cc826880179e59c7573e72536a773f8f7c944` merged as `ee5219d5c04066143b643c7cf4b7a278c36a79a3` after all required exact-head checks passed. Vercel `dpl_5bukxhYByoU9e2zEv2EW4X1oBSUP` is READY for that exact squash; public, app, inbound and main Vercel aliases were observed. Both public/app `/version.json` report `ee5219d5c04066143b643c7cf4b7a278c36a79a3-musm8c9k`, customerUpdate null. No migration or Edge deployment belongs to this UI PR; the applied schema2 dependency is separately recorded at #1656. No customer release identity or publication is assigned.

Independent source/finish review PASS covered 130 rerun tests and 20 local fixture observations; author focused suite passed 200 tests, final TypeScript ratchet 12/12 and evidence grammar. The earlier backend-main CI run `37135622346` initially failed one unchanged Team ordered-email timing assertion under suite load; independent isolated 10/10 passed and the failed-job rerun subsequently passed verify and web-smoke before UI release. This chronology is not a Team product fix or authenticated Sales proof.

Typed proof boundary: scope=authenticated_runtime (current/second Solo tenant contact selection, snapshot save/read/reopen, permissions and recovery); blocker=browser_environment (Windows sandboxhelper startup read ACL); excluded LIVE claim=hosted canonical CRM-to-invoice lifecycle. Native zoom and merchant eligibility/issue/send/collection remain UNVERIFIED or UNAVAILABLE as stated above. Recovery remains UI revert/forward fix preserving applied storage and managed dispatch refusal.

## Sales blank-page receiver repair — 2026-10-03

Observed source defect: the customer reader detached SupabaseClient.from; the actual SDK reads this.rest and throws before the previous Promise.all catch. Two failing-first real-SDK hook tests reproduced receiver loss and uncaught synchronous construction failure. Receiver-preserving invocation and deferred guarded construction now contain failures in the existing source error state, with a bounded visible retry notice. No query authority, data write, approved editor layout, schema or provider behavior changes.

Automated repair proof: 41 focused lifecycle/editor/source tests PASS, including real createClient with mocked fetch and tenant/client predicates. Production-built actual shell proof uses the real source hook/SDK plus synthetic tenant/network fixtures: Overview and Invoices ready/error cases all render without pageerrors; construction failures show the source error notice. Reproduce `vite build --config scripts/live-drive/harness/sales-mount/vite.receiver.config.ts`, preview that config at5247, then `node scripts/live-drive/sales-receiver-build-drive.mjs`; results/screenshots in `scripts/live-drive/artifacts/sales-receiver-build-proof/`. This is production-mode bundling proof, not hosted authenticated account proof. Signed-out live navigation redirected to auth; owner-specific authenticated crash remains unverified by this agent.

Repair PR #1661 merged as `a288a3a6c0a4215cf759e1b282d1f86677d2fc24` after required exact-head checks PASS (eight success conclusions; appropriate Supabase Preview SKIPPED). Independent nonauthor review PASS covers 41 tests and four production-compiled fixture cases; mechanical `19ba40426e363e2d083ec0869a023c6ba93336f7` review preserves all 12 reviewed Sales/Analytics blobs, with combined 121 tests PASS. Migration/Edge NOT_APPLICABLE. Recovery is revert/forward-fix bounded reader/notice, preserving applied snapshots and dispatch refusal. No new customer release identity/publication.

Observed repair production: Vercel `dpl_GJ7QPbYeG4RohfpJg6WR7Dr43R21` READY exact `a288a3a6c0a4215cf759e1b282d1f86677d2fc24`, expected public/app/inbound/main Vercel aliases. Both public/app `/version.json` report `a288a3a6c0a4215cf759e1b282d1f86677d2fc24-musrlele`, customerUpdate null. OWNER_CONFIRMED authenticated default Sales render after Ctrl+Shift+R: owner said “Yes, Sales loads now”. This is human page-load confirmation only, not independent signed-JWT, CRM data, draft save/read, permission, delivery or provider proof. Earlier development shell fixtures replaced the source hook and masked this defect; compiled real-reader proof repairs that test gap but does not establish hosted signed-in behavior.
