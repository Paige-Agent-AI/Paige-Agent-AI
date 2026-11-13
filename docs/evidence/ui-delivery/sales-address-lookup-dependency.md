# UI delivery evidence: unused human US address lookup dependency

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: human explicit Search to normalized candidate selection; authorization, refusal and stale-result recovery contracts described below
PAIGE_UI_DESIGN: PASS: project delivery references read; no rendered consumer or established Sales surface changed
MATERIAL_FLOW_CHANGE: NO: unused helper and isolated edge dependency only; no user-facing action is wired in this change
FLOW_PROTOTYPE: NOT_REQUIRED: owner-approved structured-address prototype remains controlling for subsequent UI integration; this dependency changes no current screen or transition
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a later tenant-admin invoice consumer can explicitly search an entered US address and choose a candidate
VISUAL_DIRECTION: PASS: preserve approved structured-address invoice design; no markup, CSS, navigation or product copy changed
AUTOMATED_EVIDENCE: PASS: six handler and two client tests; node node_modules/vitest/vitest.mjs run --config vitest.address-lookup.config.ts; admin and limiter negative-control mutations caused two failures, restored source passed eight
STATIC_EVIDENCE: PASS: focused ESLint over five helper files and tracked test config; explicit handler/client TypeScript check; workflow YAML grammar and exact additive CI step verified
RENDERED_EVIDENCE: NOT_APPLICABLE: helper has no rendered UI consumer; prototype screenshots are not proof of this server dependency
BEHAVIORAL_EVIDENCE: PASS: local handler with real safeFetch queried only the official Census public sample and returned one normalized candidate; authentication and limiter in that transport proof were injected test ports
AUTHENTICATED_RUNTIME: UNVERIFIED: hosted signed-JWT tenant/admin and durable limiter authorization have not been driven; local injected ports are not authenticated production evidence
KEYBOARD_FOCUS: NOT_APPLICABLE: no rendered UI consumer or focus behavior changed
ZOOM_REFLOW: NOT_APPLICABLE: no rendered UI consumer or layout changed
REDUCED_MOTION: NOT_APPLICABLE: no motion introduced or changed
STATE_COVERAGE: PASS: unauthenticated, anonymous, missing tenant, tenant mismatch, viewer, malformed or failed limiter, invalid country/input, malformed provider data, body/response bounds, no results, timeout/failure and stale/cancelled publication tested
TRUTHFUL_STATE_LABELS: PASS: Census response is a geocoding suggestion, not postal validation; helper is not a connected merchant, agent tool, delivery capability or LIVE UI outcome
SOLO_UI: YES: recognized src/solo/sales address adapter path; unused dependency has no rendered Solo consumer
UNVERIFIED: hosted edge runtime, signed-JWT authorization, limiter runtime, Deno entry check/deployment and eventual authenticated UI integration remain unproven
OWNER_INTENT: support explicit public address search where possible while retaining separate invoice address fields, manual fallback, unknown country and Apt/Suite
MUST_NOT_HAPPEN: expose raw customer address/error logs, dispatch before tenant-admin authorization, imply postal deliverability or fabricate PAIGE/provider authority
MUST_PRESERVE: current Sales editor, manual address data, tenant ownership, existing safeFetch contract and all existing CI gates
ACCEPTANCE_CRITERIA: helper accepts an explicit US-only request after canonical authorization, normalizes bounded candidates and permits application only in the original tenant/client/query context
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: auth and expected-tenant checks exercised through dependency ports; existing safeFetch reused unchanged; UI, CRM, billing records, Integrations, agent registry, Rails and scheduler unchanged
INTERNAL_BUILD_IDENTITY: 48468902c15de56c238bf7bcafb01bc3ce6d81be; deployment=none; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(lookup-us-address has not been deployed or exercised as a hosted caller); evidence=PR #1657 and this record
RELEASE_CHANNEL: development: isolated unconsumed helper; no customer-reachable rollout
RELEASE_CLASSIFICATION: internal-only: address lookup dependency for a later reviewed UI consumer
CUSTOMER_RELEASE_IDENTITY: none: no complete owner-visible address capability delivered
RELEASE_NOTE_REQUIRED: NO: unconsumed development dependency, no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: source, tests and public sample transport proven; PROOF OWED: hosted authorization, deployed edge and authenticated UI; no LIVE claim
RELEASE_RECOVERY: position=revert additive helper before consumption without business-record changes; reference=PR #1657
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: unused helper has no rendered consumer
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: unused helper has no rendered consumer

## Scope, ownership and routing

Seven reviewed implementation/tooling files at the cited build: new lookup-us-address index/handler/tests, neutral addressLookup adapter/tests, tracked targeted Vitest config and one additive existing ci/verify step. This record is a documentation-only closeout of the missing evidence classification. Recognized Solo TypeScript routing requires it even though the helper has no consumer. No guard is bypassed and no rendered proof is invented. The coordinator owns subsequent integration and release; the Sales UI worker owns editor, hooks and wrapper. No shared settings, schema or transport changes.

Human-only request sequence: POST body with expected tenant, explicit country US and entered address; verified non-anonymous user; server current tenant; workspace match; explicit tenant-admin true; lazy service-role rate counter; fixed public Census request; bounded normalized candidates. It creates no CRM record, tool registry, alternate approval lane, memory entry, Rail success or durable job.

Existing counters enforce tenant 20/minute and actor 10/minute; every verdict must equal true. Existing safeFetch provides HTTPS/public-DNS checks, redirect refusal, 10-second deadline and 64 KiB response limit. Body reading is capped at 4 KiB/five seconds. Cancellation suppresses response/selection; an already started outbound request may continue inside its ten-second bound. No claim of network abort is made.

## Reproducible evidence

- Tests: `node node_modules/vitest/vitest.mjs run --config vitest.address-lookup.config.ts`. Tracked config includes six handler tests otherwise excluded by the frontend src-only glob. Existing frontend test gate is retained.
- ESLint: `node node_modules/eslint/bin/eslint.js vitest.address-lookup.config.ts src/solo/sales/addressLookup.ts src/solo/sales/addressLookup.test.ts supabase/functions/lookup-us-address/handler.ts supabase/functions/lookup-us-address/handler.test.ts supabase/functions/lookup-us-address/index.ts`.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --lib ES2022,DOM supabase/functions/lookup-us-address/handler.ts src/solo/sales/addressLookup.ts`.
- Negative control: disabling admin refusal and weakening strict limiter verdict causes the tracked command to fail its two authorization/no-egress tests; restoring the original source yields eight passes. No live provider call is used by tests.
- Actual public transport, 2026-10-03: official sample `4600 Silver Hill Rd, Washington, DC 20233`, HTTP 200, one outbound request, one candidate with line1 `4600 SILVER HILL RD`. The local handler reused actual safeFetch; local auth/limiter were injected test ports. No tenant/customer address used.
- Authoritative source: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html. No API key is required by the documented request. Browser CORS is unsupported, so this is a server proxy, not JSONP. Scope is geocoding, not deliverability or international typeahead. Candidate street number is read from matchedAddress, never fromAddress/toAddress range endpoints. Unit/manual data remain consumer-owned.

## Review and release limits

Independent source review passed 93206386434eb85c5b37c8a530262c8bb79c01bc; the sole delivery repair added tracked tests and CI at 48468902c15de56c238bf7bcafb01bc3ce6d81be, which passed the independent changed-head review. This documentation correction changes no reviewed helper/tooling blobs. Exact final PR head and CI identity belong to PR #1657; no source review or CI outcome is inferred for an unobserved head. Hosted JWT/edge and eventual real UI proof remain owed. No merge or deployment performed by this lane.

