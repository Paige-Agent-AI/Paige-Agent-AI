# Solo merchant onboarding — INT-311

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: complete affected-flow packet below; current-main base 6b6bef5091507e5b7946984506e75cfb3ebd5401
PAIGE_UI_DESIGN: PASS: project paige-ui-design, Solo shell contract and Impeccable incumbent surface direction read; reuses existing Integrations drawer, tokens, scroll owner and controls
MATERIAL_FLOW_CHANGE: YES: owner can begin/resume tenant merchant setup and refresh provider readiness from canonical Settings Integrations
FLOW_PROTOTYPE: PASS: dev-only actual-component mount scripts/live-drive/harness/integrations-mount; owner explicitly directed canonical merchant entry and continued implementation in COORDINATOR RETURN — SALES INT-311, 2026-10-06; internal prototype evidence is not authenticated acceptance or an additional visual-approval claim
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace owner/admin connects the account their business uses to receive customer payments
VISUAL_DIRECTION: PASS: incumbent Solo Integrations contextual drawer and ig-* styles; no navigation redesign or new visual identity
AUTOMATED_EVIDENCE: PASS: 77 focused UI tests; 256 payment tests including 50 merchant tests; 20 real PostgreSQL assertions in disposable local cluster; uncertain start regression failed first (one failure, nine passes), then repaired
STATIC_EVIDENCE: PASS: TypeScript ratchet zero new diagnostics (baseline/current 10), production build PASS, migration-version and definer-function lint PASS, final candidate diff-check PASS
RENDERED_EVIDENCE: PASS: 29 local actual-component cases; committed sales-merchant-onboarding/results.json and viewport/state PNGs; synthetic transport, not real merchant data
BEHAVIORAL_EVIDENCE: PASS: dev-only drive opens actual drawer, measures bounds/overflow and closes with Escape; unit tests cover explicit start/refresh, permission, safe projection and stale-workspace response refusal
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated owner onboarding or Stripe TEST merchant/payment has been executed
KEYBOARD_FOCUS: PASS: local browser forward/reverse Tab containment, Escape and opener restoration; abandoned pending navigation unit test PASS
ZOOM_REFLOW: PASS: 390px and required viewports rendered; CSS 200% zoom recovery control reachable, zoom200-light.png; native browser zoom and authenticated runtime remain unverified
REDUCED_MOTION: PASS: local geometry drive uses reduced motion and existing drawer styles; no new motion added
STATE_COVERAGE: PASS: not connected, incomplete, restricted, ready, TEST, LIVE, unknown, stale, read failure and non-manager rendered/tested with synthetic transport
TRUTHFUL_STATE_LABELS: PASS: readiness expires after five minutes; return URL is only a navigation hint; no payment/settlement success claim; TEST/LIVE explicit
SOLO_UI: YES: canonical Solo Settings / Integrations, identical code for current and future tenants
UNVERIFIED: authenticated onboarding/provider acceptance, real TEST settlement/allocation and two-tenant authenticated UI remain proof owed; local fixture proof does not establish them
OWNER_INTENT: canonical merchant onboarding now, reuse tenant-stripe-connect and per-tenant binding; no owner-account special case
MUST_NOT_HAPPEN: cross-tenant binding, duplicate account creation after uncertainty, secret exposure, TEST/LIVE confusion, readiness inferred from redirect, package approval bypass
MUST_PRESERVE: Settings Billing separation, legacy reachable setup caller, existing other Integrations flows, existing Sales payment Trust/Spine/Rail
ACCEPTANCE_CRITERIA: owner can inspect environment and last provider check, start/continue hosted setup, return and refresh; wrong tenant/actor/binding/environment refuses; unknown creation reconciles without blind dispatch
MOTION_PURPOSE: NONE: no new animation; existing drawer behavior retained
PROTECTED_SEAMS: active tenant/user context and Settings request gate tested; existing merchant actor/service/Rail SQL exercised; Chat/Turn Route/C4/INT-335 untouched
INTERNAL_BUILD_IDENTITY: branch=feat/sales-merchant-onboarding; base=6b6bef5091507e5b7946984506e75cfb3ebd5401; deployment=not deployed; environment=local; migrations=PROOF_OWED(20270600000000 production persistence); edge=PROOF_OWED(tenant-stripe-connect exact merged deployment); evidence=this record
RELEASE_CHANNEL: development: local implementation candidate; production identity is not observed
RELEASE_CLASSIFICATION: internal-only: merchant entry and recovery foundation without authenticated payment acceptance
CUSTOMER_RELEASE_IDENTITY: none: authenticated merchant/payment acceptance remains proof owed
RELEASE_NOTE_REQUIRED: no: no accepted customer release yet
RELEASE_TRUTH_BOUNDARY: PARTIAL: merchant entry implementation; authenticated/provider execution PROOF OWED; package authority OPEN in INT-335
RELEASE_RECOVERY: position=forward fix retaining canonical reservation identity rather than blind account recreation; reference=docs/delivery/sales-merchant-onboarding.md
SOLO_1536X770_PAIGE_CLOSED: PASS: local synthetic transport, 1536-light-closed.png and 1536-dark-closed.png
SOLO_1536X770_PAIGE_OPEN: PASS: local synthetic transport, 1536-light-open.png and 1536-dark-open.png
SOLO_1366X768_PAIGE_CLOSED: PASS: local synthetic transport, 1366-light-closed.png and 1366-dark-closed.png
SOLO_1366X768_PAIGE_OPEN: PASS: local synthetic transport, 1366-light-open.png and 1366-dark-open.png
SOLO_1024X768_PAIGE_CLOSED: PASS: local synthetic transport, 1024-light-closed.png and 1024-dark-closed.png
SOLO_1024X768_PAIGE_OPEN: PASS: local synthetic transport, 1024-light-open.png and 1024-dark-open.png
SOLO_900X1000_PAIGE_CLOSED: PASS: local synthetic transport, 900-light-closed.png and 900-dark-closed.png
SOLO_900X1000_PAIGE_OPEN: PASS: local synthetic transport, 900-light-open.png and 900-dark-open.png

## Affected flow and ownership

SHELL: SOLO. FLOW-BY-FLOW: APPLIED. IMPECCABLE: APPLIED.

Settings Integrations → safe tenant-scoped status → explicit owner/admin start → durable reservation on existing tenant_stripe_accounts → one dispatch claim → Stripe-hosted account setup → exact same-workspace return → explicit provider GET/readback → binding/readiness CAS plus existing Rail → safe drawer projection. Navigation alone advances no readiness/payment state.

Actor and active workspace are server resolved. New caller also supplies expected tenant; server rejects disagreement and rechecks identity around awaits. Merchant account, environment, binding version, onboarding UUID and dispatch claim belong to the existing merchant binding. Stripe idempotency metadata is immutable; SDK automatic retries disabled. An uncertain creation remains unknown and subsequent recovery is bounded GET-only; no result is not permission to create another account. Provider/link errors are reduced to safe codes.

Readiness is a separate plane from invoice/payment authority. The existing Sales payment Spine uses merchant binding; no new onboarding Chat tool, package authority, charge approval, balance ledger, scheduler or continuation engine is introduced. INT-335 owns composed authority; shared C4 owns missing-fact/resume. PAIGE Billing remains separate.

Primary exits: close/Escape restores opener and prevents late navigation; workspace change hides old drawer and drops late responses; incomplete/restricted goes to hosted setup; unknown calls refresh/GET-only reconciliation; read error offers status refresh without claiming ready. Existing actor guard requires owner/admin; non-manager server read is refused. The defensive non-manager fixture is not proof of member read support. No automatic navigation/creation on mount or provider return.

## Proof and review

Local checks are automated/rendered/synthetic only. PostgreSQL proof uses real actor/service guards, existing Rail and concurrent reservations, including receipt-failure rollback; it is not production/provider acceptance.

Independent backend review found legacy return-route mismatch and disabled-reason readiness mismatch; both repaired and independently rechecked PASS. Historical Setup caller compatibility is preserved, but current routing does not prove it remains reachable. Impeccable review found uncertain retry, abandonment navigation, stale/malformed facts and permission copy; repaired with tests and final review pending. Detector exit zero with no findings. Final non-author exact-head review pending. No production/acceptance claim yet.

Impeccable upstream: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md
