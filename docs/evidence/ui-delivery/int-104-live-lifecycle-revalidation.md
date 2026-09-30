# INT-104: Hold continuity and live provider-approval revalidation

## Pre-edit discovery / attachment map — 2026-09-23

Flow-by-Flow 2.0.2, Existing Project, R3 Deep; Supabase Postgres guidance used
for the same scoped, service-only transition RPC and short row lock. This is
a repair of late review findings on our S4 join, not a replacement Live system.

Reuse the existing Live screen Hold/Resume control, shared output pause/resume,
`paige_live_session_transition_internal`, `paige_live_sessions`, and relay's
`checkCurrentAdmission` monitor. Resume currently maps to unavailable in the
old RPC, so the new relay's admission correctly rejects it but breaks Hold.
Correct only held/LIVE resume to listening; unavailable and terminal states must
never be promoted. Preserve restore/retry's current ticket-renewal behavior.

Reuse the candidate profile, readiness and provider-verification records as
the single provider-approval authority. Move their existing check into one
local reader called by both initial and recurring admission, rather than
creating a parallel flag or accepting a once-per-socket proof. Revocation must
close adapters and refuse later mouth requests. In-flight authenticated runtime
proof remains valid during Hold: the microphone is muted and playback paused,
not a new conversation or an authority revocation.

Identity remains the verified ticket's actor/tenant/thread/epoch and the existing
canonical runtime challenge. Spine, Rail, Mind, Memory, tenant Knowledge and
Harness remain in paige-ai-chat; no invocation or approval path changes. Spoken
assent never approves. No UI layout, provider activation, secret, price or budget
change. Expected redeploy set: paige-live-relay and paige-ai-chat; no shared module
edit. One additive migration replaces the existing RPC without changing its API,
grants or RLS. Existing deterministic relay smoke plus pgTAP receive regression
coverage; network/provider calls remain zero. No activation before real account
privacy proof and the actual human conversation check.

Review P2 repair: initial provider refusal must reach the browser as the existing
structured unavailable WebSocket frame, not an unreadable HTTP handshake body.
Initial identity/standing validation still precedes upgrade; only its duplicate
provider check is deferred to the immediately following existing unavailable
frame branch. Every recurring check and pre-mouth check includes provider proof.
The production-prefix test failed first (82 passed, 1 failed), then passed
(83 passed, 0 failed; network/provider calls=0). Deno relay check exited 0.
The ten transition pgTAP assertions passed in isolated CI run 35932532737,
job 107422176882. No production audio or account approval is claimed by that run.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2 Existing Project R3 Deep; Hold/Resume and revocation traced through existing UI, RPC, relay and runtime; independent review required
PAIGE_UI_DESIGN: PASS: Existing approved Solo stage, Presence and controls retained; project UI references read, no layout or new control
VISIBLE_FLOW_IMPACT: YES: Hold/Resume no longer disconnects; withdrawn provider approval closes audio honestly
MATERIAL_FLOW_CHANGE: NO: Repairs existing promised controls and fail-closed transitions; no new interaction or layout
FLOW_PROTOTYPE: NOT_REQUIRED: Existing approved Hold and unavailable flows are corrected without design changes
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Authorized users pause and resume the same live conversation; revoked provider access stops safely
VISUAL_DIRECTION: PASS: Existing Solo tokens, stage and controls unchanged
AUTOMATED_EVIDENCE: PASS: Current relay smoke 83 passed, zero network/provider calls; initial failing-first 63 pass/19 fail; removed revocation guard mutation 65 pass/17 fail, restored guard passes; ten pgTAP transition assertions passed in CI run 35932532737 job 107422176882
STATIC_EVIDENCE: PASS: Deno check of paige-live-relay exits 0; git diff --check passes; same RPC signature, service-role guard, row lock and grants retained
RENDERED_EVIDENCE: UNVERIFIED: No authenticated production audio render while account readiness remains unverified
BEHAVIORAL_EVIDENCE: UNVERIFIED: Human Hold/Resume, live revocation and spoken reply require verified provider configuration
AUTHENTICATED_RUNTIME: UNVERIFIED: Real audio remains off; no privacy verification or owner listening proof invented
KEYBOARD_FOCUS: PASS: Existing keyboard and focus routes unchanged; no browser source edit
ZOOM_REFLOW: UNVERIFIED: No fresh rendered geometry; no layout change
REDUCED_MOTION: PASS: No motion or preference code changes
STATE_COVERAGE: PASS: Smoke covers approval present/revoked, proof mismatch, query error, held in-flight proof, master off and Minimize ordering; pgTAP asserts scoped Hold/Resume and terminal End
TRUTHFUL_STATE_LABELS: PASS: Resume requires held plus existing LIVE availability; no unavailable session promoted, provider revocation marks unavailable
SOLO_UI: YES: Existing Solo Live Conversation stage only
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: No authenticated render; no browser changes
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Real audio requires account readiness
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: No authenticated render; no browser changes
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Real audio requires account readiness
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: No authenticated render; no browser changes
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Real audio requires account readiness
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: No authenticated render; no browser changes
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Real audio requires account readiness
UNVERIFIED: Actual provider privacy, human speech, latency and owner acceptance not claimed; pgTAP execution is proven in the isolated CI database, not by production synthetic traffic

Impeccable 4.3.1 interaction review (installed `C:/Users/tonig/.agents/skills/impeccable/SKILL.md`): static clarity, feedback, continuity and recovery checks applied. Results: existing Hold/Resume wording matches preserved-session behavior; revoked approval uses the existing unavailable state; no provider jargon, extra screen or action added. Acoustic/rendered audit remains UNVERIFIED rather than inferred from source.

OWNER_INTENT: Finish the existing live experience safely, with interruption, Hold, clean end and the same conversation.
MUST_NOT_HAPPEN: Resume loses admission, revoked voice continues dispatching, invalid scope passes, or a paused utterance loses its authenticated provenance.
MUST_PRESERVE: Existing Solo shell, one canonical brain/thread, governed approvals, active read-aloud, default-off availability and no Voice-owned cost gate.
ACCEPTANCE_CRITERIA: After provider verification, Hold then Resume preserves audio; withdrawing approval stops audio; text chat and same thread remain available.
PROTECTED_SEAMS: AFFECTED: scoped transition RPC and existing recurring admission. PRESERVED: ticket authority, Spine/Rail/Mind/Memory/Knowledge/Harness, provider-neutral contract and permission flow.

INTERNAL_BUILD_IDENTITY: merge_sha=1e592542ede48589349b5445376ec2396e948cc6; pr=1408; reviewed_head=72395be53f5811709748497624d5ae86a6756a1e; deployment=dpl_6vBCkQmHArKHJbtNBc2q37LepRMT; environment=production; migrations=APPLIED(20270411000000_paige_live_resume_admitted_state); edge=APPLIED(paige-live-relay@v8,paige-ai-chat@v268); evidence=scripts/paige-live-relay-bridge-smoke.mts and supabase/tests/paige_live_session_transition.sql; deploy_runs=35935279150,35935279183
RELEASE_CHANNEL: production: regression repair deployed without pilot activation
RELEASE_CLASSIFICATION: internal-only: no real-audio customer capability claimed before provider verification
CUSTOMER_RELEASE_IDENTITY: none: human production conversation not yet proven
RELEASE_NOTE_REQUIRED: NO: no general availability claim
RELEASE_TRUTH_BOUNDARY: PARTIAL: deterministic repair proof only; authenticated production audio remains UNVERIFIED
RELEASE_RECOVERY: position=disable platform Live availability before reverting relay/runtime and use the documented RPC rollback only with audio off; reference=supabase/migrations/20270411000000_paige_live_resume_admitted_state.sql
