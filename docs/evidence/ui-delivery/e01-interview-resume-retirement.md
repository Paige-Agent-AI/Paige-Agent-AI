# Reliable interview resume + completion retirement (EXP01 PR4)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: owner-directed resume/retirement flows (2026-10-22 continuation §2A/§2F: PAIGE recognizes first-time vs unfinished vs completed onboarding; the customer must not repeatedly encounter first-time interview controls). Two legs. RESUME: a new owner-only RPC `latest_solo_business_interview_thread()` (migration 20271113400000) returns the caller's own most recent UNFINISHED private interview thread as a navigation hint only — {threadId, phase, checkpointUpdatedAt}, no transcript, no facts; the client performs one lookup per tenant on first-run entry (only with no deep link and no active thread) and a hit adopts the SAME verified deep-link path (checkpoint/authority verification unchanged); a failed or empty lookup never blocks a fresh interview. RETIREMENT: first-run presentation is now gated on the canonical completion marker (features.solo_setup_complete, written by the first successful Setup save; tenant context refreshes in-session after that save), so interview chrome retires even through a stale ?onboarding=1 link — and the stale parameter itself is stripped from the address.
PAIGE_UI_DESIGN: PASS: no new surfaces; the returning owner simply lands in their existing conversation with the existing first-run presentation, and the completed owner sees ordinary chat with a clean URL.
MATERIAL_FLOW_CHANGE: YES: re-entering an unfinished onboarding now navigates into the caller's existing interview thread instead of a blank conversation, and completed workspaces retire first-run presentation from stale links.
FLOW_PROTOTYPE: PASS: owner approval on record — 2026-10-22 continuation directive §2A ("PAIGE recognizes whether this is a first-time encounter, an unfinished interview or an already-completed onboarding") and §2F ("The customer should not repeatedly encounter first-time interview controls"), recorded on ANT-50; implemented entirely on the existing verified deep-link and completion-marker contracts.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a returning Solo owner with an unfinished interview opens PAIGE and continues their own conversation; a completed owner opening a stale first-run link lands in normal chat with no interview chrome and an honest URL.
VISUAL_DIRECTION: PASS: existing design language; no new visual elements.
AUTOMATED_EVIDENCE: PASS: scripts/e01-interview-resume-check.mjs 8/8 SQL proofs against the REAL checkpoint migration + the REAL new migration on a local PostgreSQL (newest unfinished wins; completed retires; forged newest checkpoint skipped fail-closed to the next valid; foreign-tenant and other-caller threads excluded; each caller sees their own newest; unauthenticated refused 42501; execute authenticated-only; eight sibling-rejected archived shapes ahead of a valid thread cannot burn the candidate window — case 8 verified to fail under mutation) — wired into CI; vitest 29/29 across SoloPaigeWorkspace.onboarding 17/17 (new: re-entry adopts the own thread through the verified path; completed setup retires chrome and strips ?onboarding=1), SoloOnboardingStage.integration 3/3, solo-interview-navigation 9/9; eslint clean.
STATIC_EVIDENCE: PASS: exactly one dispatcher (the first-run lookup effect, guarded by no-deep-link + no-active-thread + once-per-resolved-tenant) and one server home (the new RPC); the RPC reuses the sibling checkpoint's own validation — anything the sibling refuses is skipped, never trusted; revokes match the sibling (public/anon/service_role revoked, authenticated granted).
RENDERED_EVIDENCE: UNVERIFIED: production screenshot owed post-deploy (browser capture unavailable this session).
BEHAVIORAL_EVIDENCE: PASS: suites prove the lookup→deep-link→verified-thread chain end-to-end in the harness, the stale-link retirement including URL strip, and the SQL authority/exposure matrix on real migrations.
AUTHENTICATED_RUNTIME: UNVERIFIED: the authenticated returning-owner pass on the QA account is owed to the single founder-evaluation drive.
KEYBOARD_FOCUS: PASS: no focus changes; the resumed conversation is the existing chat surface.
ZOOM_REFLOW: PASS: no layout changes.
REDUCED_MOTION: PASS: no motion changes.
STATE_COVERAGE: PASS: fresh owner (no lookup hit → fresh interview), returning owner (lookup hit → own thread via verified path), completed owner with stale link (chrome retired + URL stripped), deep-link entry (lookup skipped), foreign/forged/other-caller threads (excluded server-side), unauthenticated (refused).
TRUTHFUL_STATE_LABELS: PASS: the RPC returns a navigation hint only and its comment states consumers must re-read canonical Setup; the client never claims resume when the checkpoint verification fails (existing honest failure UI).
SOLO_UI: YES: one Solo shell for every tenant; the lookup is the caller's own threads in their canonical workspace.
UNVERIFIED: post-deploy rendered screenshot; authenticated returning-owner resume pass on the QA account; founder-drive completion retirement observed live.

INTERNAL_BUILD_IDENTITY: exact-head=2e75fb06104b1b95bd1e11c17ec9cfa6c1f5a34c; squash-merge=4e339bc9e47c0040f50f6ddefeb3cb955675340b; deployment=prod-migration-recorded-20271113400000; environment=production; migrations=APPLIED(20271113400000_latest_solo_business_interview_thread);edge=NOT_APPLICABLE; evidence=scripts/e01-interview-resume-check.mjs
RELEASE_CHANNEL: development: local/development build environment; production release follows the standing small-PR merge/deploy/readback gate.
RELEASE_CLASSIFICATION: internal-only: onboarding resume/retirement correction ahead of the single EXP01 founder evaluation.
CUSTOMER_RELEASE_IDENTITY: none: fix branch only; founder evaluation precedes any release identity.
RELEASE_NOTE_REQUIRED: no: internal-only correction ahead of the single EXP01 evaluation.
RELEASE_TRUTH_BOUNDARY: PARTIAL: SQL and component behavior proven by the check script and suites; PROOF OWED: post-deploy migration readback, rendered evidence, and the authenticated resume/retirement pass.
RELEASE_RECOVERY: position=forward-fix; reference=this record and scripts/e01-interview-resume-check.mjs
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no layout change; the resumed surface is the existing chat.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no layout change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no layout change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no layout change.

## Release identity addendum (2026-10-23 identity repair)

The original INTERNAL_BUILD_IDENTITY cited the branch's first commit hash
(`061ee344b…`), which became unreachable after squash merge — stale identity
(coordinator finding). Corrected above: exact reviewed head `2e75fb061` (all
checks green), squash merge `4e339bc9e`.

Production readback (completed 2026-10-23, recorded on ANT-50): the migration
`20271113400000_latest_solo_business_interview_thread` is RECORDED in
production `supabase_migrations.schema_migrations`; the RPC is live with the
exact reviewed body (candidate window + thread-shape predicates) and grants
exactly authenticated-EXECUTE-only — both verified on the read-only seam. The
deploy-migrations refusal race and its resolution (reconciliation applied the
original version out-of-band; renumber PR #2649 closed unmerged to avoid a
duplicate) are dispositioned on #2649 and issue #1548. The served bundle
`SoloEntry-DosxqvBq.js` carries `latest_solo_business_interview_thread`,
the interviewThread deep-link usage, and PR3's voice-entry markers. The gate
is green on current main (deploy-migrations run 39888217187 SUCCESS).

Rendered-evidence limitation, stated plainly: no production screenshot of the
returning-owner resume or the retired stale link exists; browser-capture
tooling was unavailable and the founder's evaluation window has not occurred.
RENDERED_EVIDENCE and AUTHENTICATED_RUNTIME above remain UNVERIFIED and are
owed to that window.
