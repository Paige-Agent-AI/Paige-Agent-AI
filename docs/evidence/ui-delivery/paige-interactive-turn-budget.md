# UI delivery evidence: Paige interactive turn budget relief

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: affected flow is owner sends a normal Paige request, watches continuous in-flight status, receives a response within 360 seconds, or receives an honest survival-unknown timeout
PAIGE_UI_DESIGN: PASS: project skill and all routed accessibility, quality-gate, review, upstream, doctrine, and release references were read before the Phase 1a change
MATERIAL_FLOW_CHANGE: NO: the existing send, progress, response, cancel, and retry flow is unchanged; only the symmetric time fence and timeout truth wording changed
FLOW_PROTOTYPE: NOT_REQUIRED: no new container, navigation, control, state transition, or visual direction was introduced
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a tenant owner sends Paige work and can tell continuously whether she is thinking or writing until the response or six-minute boundary
VISUAL_DIRECTION: PASS: existing PaigeThinkingIndicator, alert, button, tokens, spacing, and motion behavior are preserved byte-for-byte
AUTOMATED_EVIDENCE: PASS: npx vitest run src/components/dashboard/PaigeAIChat.turnBudget.contract.test.ts src/__tests__/durable-job-seam.test.ts src/__tests__/paige-durable-work-envelope.test.ts passed 3 files and 18 tests; the turn-budget test proves client/server symmetry, progress wiring, and timeout wording
STATIC_EVIDENCE: PASS: npx tsc --noEmit -p tsconfig.app.json reports the exact same 12 errors at rebased base 1e592542ede48589349b5445376ec2396e948cc6 and candidate; no changed file appears in the error set
RENDERED_EVIDENCE: UNVERIFIED: the shared paige-scroll-stability-react drive fails at openTenant line 112 before the interaction; the 2026-09-23 coordinator ruling accepts the contract test plus owner post-deploy verification for Phase 1a only and routes the harness defect to Platform Health
BEHAVIORAL_EVIDENCE: UNVERIFIED: owner post-deploy proof is required by running a request past 45 seconds and confirming the session remains active; no deployment was authorized or performed here
AUTHENTICATED_RUNTIME: UNVERIFIED: no candidate deployment or authenticated tenant mutation was performed; the raised runtime boundary remains proof owed
KEYBOARD_FOCUS: NOT_APPLICABLE: no focus order, keyboard control, or interactive element changed
ZOOM_REFLOW: UNVERIFIED: the accepted Phase 1a exception replaces rendered viewport proof only for this two-constant timing change and copy clarification; no geometry changed
REDUCED_MOTION: PASS: the unchanged shared indicator uses useReducedMotion and keeps a static phase label while disabling the per-second tick and pulse
STATE_COVERAGE: PASS: automated/static inspection covers thinking, still-thinking, writing, timeout, offline, server failure, retry, cancel, and the accepted-request fence; deployed duration remains separately unverified
TRUTHFUL_STATE_LABELS: PASS: timeout now says Paige was working or writing, the chat stopped listening, completion/save survival is unknown, and Retry may start the work again
SOLO_UI: YES: canonical Solo Paige chat status and timeout alert
UNVERIFIED: deployed behavior beyond 45 seconds, authenticated owner verification, rendered viewports, zoom/reflow, and the shared drive repair remain outstanding for the reasons above

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no geometry changed; shared drive failed before capture and the Phase 1a evidence exception is recorded above

OWNER_INTENT: give ordinary Paige conversations immediate relief without presenting a six-minute silence or pretending a timed-out request definitely failed or survived
MUST_NOT_HAPPEN: the client must not stop before the server; Retry must not be described as safe from duplication before the durable envelope is adopted by chat
MUST_PRESERVE: existing streaming, shared progress indicator, cancel behavior, request-scope fence, retry control, and Solo presentation
ACCEPTANCE_CRITERIA: on the deployed candidate, an authenticated owner starts work lasting longer than 45 seconds, sees continuous thinking or writing status, receives no 45-second timeout, and sees the honest six-minute message only if the full window expires
MOTION_PURPOSE: NONE: no motion change; the existing indicator communicates active work and keeps its reduced-motion fallback
PROTECTED_SEAMS: client and paige-ai-chat budgets remain equal at 360000 milliseconds; request acceptance, cancellation, thread persistence, Spine, Rail, Memory, and Knowledge logic are unchanged

INTERNAL_BUILD_IDENTITY: c8fd5da2891f43fd3ec4e8846de951a953157086; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat candidate not deployed); evidence=PaigeAIChat.turnBudget.contract.test.ts plus exact-base typecheck comparison
RELEASE_CHANNEL: development: local candidate only; no preview or production deployment was authorized
RELEASE_CLASSIFICATION: patch: owner-visible timeout relief and truthful recovery wording without a new capability or customer release identity
CUSTOMER_RELEASE_IDENTITY: none: owner has not assigned a customer release identity and runtime proof is owed
RELEASE_NOTE_REQUIRED: NO: the candidate is not deployed and the durable envelope remains the actual INT-180 fix
RELEASE_TRUTH_BOUNDARY: PARTIAL: symmetry, continuous progress wiring, and honest timeout copy are source/test proven; deployed duration and all durable recovery claims are proof owed
RELEASE_RECOVERY: position=revert commits c8fd5da2 and a5238389 before deployment if the extended interactive fence regresses chat; reference=git history plus this evidence record

## Scope and collisions

- Classification: Phase 1a temporary relief, not the durable-work fix.
- Affected flow: authenticated Solo owner sends a Paige request and waits for its streamed response.
- Neighboring regressions: cancellation, retry, scope switching, thread persistence, server streaming, and reduced-motion status.
- Active-owner/file collisions: Platform Reach registries were not touched; Platform Health owns PH-EVIDENCE-18.
- Explicit exclusions: no durable resume, retry deduplication, worker cancellation, deployment, production write, or capability promotion.

## User job and state map

The owner sends once. While the request is accepted, the shared status line remains visible and advances from Thinking to Still thinking or Writing. A completed response removes the indicator. Local cancellation keeps its existing warning. If the 360-second boundary expires, the alert names the activity and states that completion and persistence are unknown; Retry is explicitly described as potentially starting the work again.

## Evidence index

- Candidate UI commit: `c8fd5da2891f43fd3ec4e8846de951a953157086`.
- Budget commit: `a523838930ec2cae1dc2ad18706f24a2d3d5b89d`.
- Base: `1e592542ede48589349b5445376ec2396e948cc6`.
- Automated: focused Vitest, 18/18 passing.
- Static: required app typecheck, 12 base errors and the identical 12 candidate errors.
- Routed failure: `docs/assessments/CONSOLIDATED_PLATFORM_AUDIT.md` PH-EVIDENCE-18.

## Review and limitations

Self-reviewed, lower assurance. The coordinator explicitly accepted the Phase 1a evidence substitution. Owner post-deploy verification remains required; the exception does not carry into the durable-work or capability phases.
