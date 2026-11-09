# UI delivery evidence: exp07-social-door-public-base-fallback

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Social connect door (paige-social) and consent return (paige-social-callback) stop refusing when PUBLIC_SITE_URL is unset; the canonical origin https://paigeagent.ai is used per the platform-wide canonical-app-url contract (mcp-oauth-callback, tenant-signup, send-transactional-email, public-booking all carry the same fallback).
PAIGE_UI_DESIGN: PASS: No visual change; this repairs the Integrations Social drawer flow that was permanently stuck on "Social connection setup is not configured for this environment" while the drawer copy promised a connect action.
MATERIAL_FLOW_CHANGE: YES: With the provider key present and PUBLIC_SITE_URL absent, Connect moves from guaranteed refusal (503 capability_unavailable) to the governed approval card and platform consent; the consent return redirect gains the canonical fallback origin.
FLOW_PROTOTYPE: UNVERIFIED: Edge-only availability repair behind an unchanged drawer; no browser prototype exists for the unconfigured-to-approval-card transition, and the first live governed Connect click after deploy is the prototype-grade proof owed by this record.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A workspace owner clicking Connect in Settings -> Integrations reaches the "Confirm this Social change" approval card and then the platform consent screen, exactly as the existing drawer copy states.
VISUAL_DIRECTION: PASS: No UI file changed; existing tokens and components untouched.
AUTOMATED_EVIDENCE: PASS: Updated social-connection-security-contract.test.ts pins the fallback literal in both functions AND the unchanged origin validation (https only, no credentials; callback also rejects query/hash); the PR verify job runs the full suite on the exact head.
STATIC_EVIDENCE: PASS: Source-contract test reads the two deployed files directly; typecheck and lint run in the verify job on the exact head.
RENDERED_EVIDENCE: NOT_APPLICABLE: No visual or layout change; drawer rendering is covered by existing render tests.
BEHAVIORAL_EVIDENCE: UNVERIFIED: The first real governed Connect click after deploy is the live behavioral proof; expected transition is 202 approval card instead of the 503 refusal observed ten times on 2026-11-04 (13:43Z through 20:24Z).
AUTHENTICATED_RUNTIME: UNVERIFIED: The owner's first authenticated Connect click against the redeployed functions is the runtime proof; edge logs and the paige_social_connections row will show it.
KEYBOARD_FOCUS: NOT_APPLICABLE: No controls, semantics, focus, or tab order changed.
ZOOM_REFLOW: NOT_APPLICABLE: No layout or geometry changed.
REDUCED_MOTION: NOT_APPLICABLE: No animation or motion changed.
STATE_COVERAGE: PASS: PUBLIC_SITE_URL unset (canonical fallback), configured valid (origin used), configured malformed (still rejected, fail closed) — all three pinned by the updated contract test.
TRUTHFUL_STATE_LABELS: PASS: Before this fix the drawer's refusal copy implied provider-key absence while the actual missing setting was the return origin; after this fix a capability_unavailable refusal can only mean the provider key itself.
SOLO_UI: NO: Edge-only repair behind the existing Solo Integrations drawer; no Solo shell file changed.
UNVERIFIED: Production redeploy of both functions and the owner's first successful Connect click remain open; no connect has ever completed (paige_social_connections is empty as of 2026-11-04 20:40Z).
INTERNAL_BUILD_IDENTITY: 0f4859408d73f570193722680500aa78ef96ea42; deployment=UNVERIFIED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-social and paige-social-callback redeploy owed via deploy-edge-functions dispatch); evidence=this record plus ANT-162 Linear records ef8cdb01 and aec24ae2
RELEASE_CHANNEL: development: Owner-directed incident repair of a fully broken door (2026-11-04 "give me a REAL solution"); exact-head checks and authorized deploy remain required.
RELEASE_CLASSIFICATION: PATCH: Restores the already-advertised connect flow; no capability, schema, or copy added.
CUSTOMER_RELEASE_IDENTITY: none: Internal incident repair without an owner-approved customer version.
RELEASE_NOTE_REQUIRED: no: Repairs an existing advertised capability rather than introducing one.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Source fix and contract tests are done; production edge redeploy and the first live Connect are not yet proven and are not inferred.
RELEASE_RECOVERY: position=revert both function files to the hard-required PUBLIC_SITE_URL read and the contract test to its prior assertion (a single revert restores the pre-fix behavior with no migration and no data change); reference=this record and the revert commit
