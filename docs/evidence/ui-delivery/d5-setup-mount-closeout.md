# D5 closeout — Setup settings mount verification (test-only regression)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bug-or-repair closeout of EXP01 defect D5 ("settings interface crashes during mounting/initialization"). Re-diagnosed against current main and production on 2026-10-22: (1) the real SoloSettings tree (no ./settings mock) mounts cleanly through the real SoloApp shell — the diagnosis harness ran the authorized QA tenant's verbatim get_solo_business_context payload (pending-proposal banner included), and the committed suite pins the same shape with anonymized values; (2) production get_solo_business_context() executed read-only under the authenticated role with the QA owner's claims returns a complete healthy row (owner_full, Acmey Advisory); (3) the deployed SoloEntry chunk carries current main markers (PR1's sos-progress--link and reworded resume note; zero "Meet PAIGE"/"Start interview" strings). The 2026-10-20 drive's "This page couldn't open" was SoloScreenBoundary catching a render throw on the pre-#2438-era build; the boot-splash unmount was the same wedged automation tab documented on that drive. No product code change is needed; this PR pins the previously untested shell-integration leg so a settings-subtree render break can never again land behind the operations-retention mock.
PAIGE_UI_DESIGN: PASS: no UI changed; the suite asserts the two failure presentations stay distinct and honest (boundary copy never appears on a healthy load; the RPC-failure panel offers Retry and recovers).
MATERIAL_FLOW_CHANGE: NO: test-only closeout; the only new artifact is a regression suite over an already-shipped surface.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change; no customer-facing surface altered.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged product behavior — a Solo owner opens Setup and their business profile loads; the suite proves the deep link canonicalizes to /settings/setup/business-profile, the in-app Setup link client-navigates onto the same surface, and a failed load presents the honest recovery panel rather than a crash.
VISUAL_DIRECTION: PASS: no visual change; existing setup-state and setup-proposal styles asserted structurally.
AUTOMATED_EVIDENCE: PASS: src/solo/SoloApp.settings-mount.test.tsx 3/3 (deep-link canonicalization incl. pending-proposal banner and both failure-string absences; readiness-CTA client-navigation; failed-load panel + Retry reload/recover), independently rerun by review alongside the five named neighbors — operations-retention, SoloPaigeWorkspace.onboarding, SoloBusinessContextSetup, settings.rendered-copy, setup-subtab-route — 135 passing across the six files.
STATIC_EVIDENCE: PASS: the deployed https://app.paigeagent.ai/assets/SoloEntry-CGk2xi75.js (fetched 2026-10-22) contains "Setup could not load safely", get_solo_business_context, sos-progress--link and the PR1 resume-note copy, and zero "Meet PAIGE"/"Start interview" markers; production RPC readback executed with set_config('request.jwt.claims', …) under role authenticated on the read-only seam and rolled back (BEGIN/ROLLBACK, zero residue).
RENDERED_EVIDENCE: PASS: harness-rendered real shell + real settings subtree in jsdom (structural); live pixel rendering unchanged from the already-shipped surface.
BEHAVIORAL_EVIDENCE: PASS: canonicalization navigate, client-navigation mount, failure-panel presentation, Retry-driven reload and recovery all asserted; exact context-load call counts deliberately not over-pinned (the pathname-keyed boundary legitimately remounts settings on index canonicalization).
AUTHENTICATED_RUNTIME: UNVERIFIED: the interactive authenticated Setup journey legs the owner listed (edit, save through the authorized writer, refresh persistence, logout/return) remain owed to the single EXP01 founder-evaluation drive on the QA account; today's authenticated-role RPC readback proves the data path, not the interactive session.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interaction-pattern change; existing focus behavior covered by the component suites.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: healthy deep-link load (with pending proposal), healthy client-navigation load, failed context load, Retry recovery; the boundary-vs-panel distinction asserted in both healthy and failed legs.
TRUTHFUL_STATE_LABELS: PASS: the suite pins that a failed load says "Setup could not load safely" with a working Retry, and that a healthy load never shows either failure string.
SOLO_UI: NO: test-only change; no customer-facing surface altered (the verified surface is the existing Solo Setup workspace).
UNVERIFIED: authenticated interactive Setup journey (edit → authorized save → refresh persistence → safe recovery) on the QA account is owed to the single founder-evaluation drive; the historical throw on the 2026-10-20 build is explained by its pre-#2438-era bundle and cannot be re-forensically pinned without that bundle (moot: current bundle verified healthy at every reachable layer).

INTERNAL_BUILD_IDENTITY: test-commit-was=ead11688c762ef8ac4b82f4213298faaa88ed4de(now unreachable after squash); squash-merge=daa6858bbb7d065436781a9b264766569c67629f; deployment=6f07299a6c2f4878c42f61fe377067f253de8f0a/SoloEntry-CGk2xi75.js; environment=production; migrations=NOT_APPLICABLE;edge=NOT_APPLICABLE; evidence=https://app.paigeagent.ai/assets/SoloEntry-CGk2xi75.js
RELEASE_CHANNEL: production: no channel change; the record documents verification of the already-deployed production bundle plus the new regression suite on main.
RELEASE_CLASSIFICATION: internal-only: test-only regression closeout of an EXP01 defect; no customer-facing change.
CUSTOMER_RELEASE_IDENTITY: none: test-only closeout.
RELEASE_NOTE_REQUIRED: no: internal-only test work.
RELEASE_TRUTH_BOUNDARY: LIVE: the Setup shell-integration leg is pinned green on main and the deployed bundle's health is verified by marker readback and an authenticated-role RPC readback; PROOF OWED: interactive authenticated journey legs remain for the founder-evaluation drive.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the SoloApp.settings-mount suite
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no layout change.

## Release identity addendum (2026-10-23 identity repair)

The build identity cited the branch's test commit `ead11688c…`, unreachable
after squash merge `daa6858bb`. The product-state citations (main `6f07299a6`,
served `SoloEntry-CGk2xi75.js`) were true when written and remain accurate
historical facts of the verification, not branch identities. Later snapshots:
`SoloEntry-D3K7QEgW.js` (2026-10-22) and `SoloEntry-DosxqvBq.js` (2026-10-23,
current) carry the same verified surfaces. INTERACTIVE authenticated Setup
journey legs remain PROOF OWED to the founder window.
