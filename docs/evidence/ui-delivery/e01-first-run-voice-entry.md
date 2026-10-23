# First-run voice-first onboarding entry through the existing Live Conversation (EXP01 PR3)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: owner-directed first-run flow (2026-10-20 correction + 2026-10-22 continuation §2A/§5) — the first-run Solo onboarding stage now presents a primary "Talk with Paige live" affordance that requests the EXISTING PaigeLiveConversation surface on the current interview thread via the `paige-live-open-request` window event (the shell's established `paige:open` request pattern); the Live component keeps sole ownership of opening, authorization, terms and microphone consent, and a "Minimize Live any time to keep typing" line keeps the text path honest (the immersive Live stage is modal while open — Escape/Minimize returns to the composer). No new runtime, provider, agent identity or onboarding system; the affordance mounts only when the stage mounts (first run, chat tab, solo scope, tier carries live_conversation) and unmounts with it. Suites: SoloPaigeWorkspace.onboarding 14/14 (voice entry present on first run, dispatches exactly one request, gone after real navigation off onboarding, hidden when the tier lacks Live), PaigeLiveConversation (request honored through the same begin() path with one session request and no microphone before readiness; ignored while disabled), SoloParityTruthfulness (capabilities rows).
PAIGE_UI_DESIGN: PASS: the affordance reuses the stage's existing token language (hsl primary/border tokens, 10px radius, focus-visible ring matching the resume link); lucide Volume2 icon consistent with the Live trigger; muted 12px explanatory line under a 13px/600 button; wraps under 360px container width; prefers-reduced-motion honored.
MATERIAL_FLOW_CHANGE: YES: the first-run encounter gains a voice-first entry point into the interview — the owner-ruled flow correction; the underlying conversation, thread, Setup and Live mechanics are unchanged and reused.
FLOW_PROTOTYPE: PASS: owner approval on record — the 2026-10-20 owner correction ("first entry presents welcome + interview through EXISTING first-party Live Conversation with mic consent, sharing existing thread + Setup workflow; text interface remains a fully usable fallback") and the 2026-10-22 continuation directive §2A/§5 are the approved flow design this implements; recorded on ANT-50 and in docs/evidence/ui-delivery/onboarding-ui-correction.md lineage.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a new Solo owner meeting PAIGE for the first time sees one clear way to start talking — press "Talk with Paige live" (browser asks for microphone permission; PAIGE explains speech-provider retention before audio starts) — or minimizes Live at any time to keep typing in the same conversation.
VISUAL_DIRECTION: PASS: existing PAIGE visual identity only; no new design system, no new surfaces; the stage composition (presence, state line, voice entry, progress link) keeps its existing hierarchy with the voice entry as the single new primary affordance.
AUTOMATED_EVIDENCE: PASS: 73/73 across the four affected suites (PaigeLiveConversation, SoloPaigeWorkspace.onboarding, SoloParityTruthfulness, SoloOnboardingStage.integration); eslint clean on all changed sources; new regressions: event honored/ignored-by-disable, one-dispatch click, navigation-off-onboarding unmount, tier gate, busy-state button disable, copy truth (Minimize-to-type line present; the withdrawn "typing works the whole time" claim absent), capabilities row truths (Live Conversation = Consent required / Not activated yet; onboarding = Available / Active with "needs Live Conversation turned on").
STATIC_EVIDENCE: PASS: grep confirms exactly one dispatcher (`SoloPaigeWorkspace` stage mount, gated on liveConversationAvailable) and one listener (`PaigeLiveConversation`, guarded by disabled/open/PAIGE_LIVE_CONVERSATION_ENABLED); no second Live runtime, no Vapi reference, no new onboarding store; the stage still starts nothing itself (comment contract updated to state the voice entry only REQUESTS the Live surface); review P2 fixed — the stage copy no longer promises typing DURING the modal Live stage, and the button disables while PAIGE is preparing a response so the request is never a silent no-op in the visible busy state.
RENDERED_EVIDENCE: UNVERIFIED: production screenshot of the corrected first-run stage (presence, voice entry, typing-fallback line, progress link) is owed after deploy — browser-capture tooling was unavailable in this session.
BEHAVIORAL_EVIDENCE: PASS: suites prove the click→request→begin chain, the disabled-ignore path, the navigation retire path and the tier gate; the Live surface's own consent/terms/permission-denied states are pre-existing and covered by its suite.
AUTHENTICATED_RUNTIME: UNVERIFIED: authenticated first-run voice entry (terms acceptance → live audio) on the QA account remains owed to the single founder-evaluation drive; component behavior is proven by suites only.
KEYBOARD_FOCUS: PASS: the voice entry is a real button with the stage's established :focus-visible treatment and a visible disabled state while PAIGE prepares a response; while the Live stage is closed the composer stays keyboard-reachable, and while it is open the stage's own focus trap owns the dialog (Escape minimizes) — the copy says exactly that.
ZOOM_REFLOW: PASS: container-based wrap already proven by the stage's existing 360px rules; the new entry wraps its explanatory line to full width under 360px and keeps the button on its own line; no fixed heights added.
REDUCED_MOTION: PASS: no animation introduced; the existing prefers-reduced-motion stage rule covers the new subtree.
STATE_COVERAGE: PASS: first run with tier-allowed Live (entry present), first run without tier Live (entry hidden, resume link intact), non-first-run chat (stage absent), disabled Live composer states (request ignored), PAIGE-preparing busy state (button disabled), and the post-navigation retired state — all asserted.
TRUTHFUL_STATE_LABELS: PASS: the entry promises only what the Live surface enforces — browser microphone permission and PAIGE's retention explanation before audio; the capabilities row says Live audio is Not activated until the owner of the voice consents, and dictation stays a separate one-way row.
SOLO_UI: YES: one Solo shell for every tenant; the affordance keys off the shared tier feature and first-run stage, never an account branch.
UNVERIFIED: post-deploy rendered screenshot; authenticated voice-entry pass (terms → live audio) on the QA account; real-voice latency/interruption measurements — all owed to the founder-evaluation drive per the standing single-window rule.

INTERNAL_BUILD_IDENTITY: exact-head=4e7cf3746f5f3b5f3003792ca57774a47d98357b; squash-merge=b9effc47d47e52fa7b8ca61e1a7e51697c9be8a9; deployment=dpl_8iR9Hmgo6EkE12tcjUKDrEAi2D9y; environment=production; migrations=NOT_APPLICABLE;edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/e01-first-run-voice-entry.md
RELEASE_CHANNEL: development: local/development build environment; production release follows the standing small-PR merge/deploy/readback gate.
RELEASE_CLASSIFICATION: internal-only: first-run entry correction ahead of the single EXP01 founder evaluation; not a release-note-visible feature announcement.
CUSTOMER_RELEASE_IDENTITY: none: fix branch only; founder evaluation precedes any release identity.
RELEASE_NOTE_REQUIRED: no: internal-only correction ahead of the single EXP01 evaluation; existing Chat, dictation and the Live Conversation surface are unchanged.
RELEASE_TRUTH_BOUNDARY: PARTIAL: component behavior and capability honesty proven by suites; PROOF OWED: post-deploy rendered evidence and the authenticated voice-entry pass.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the SoloPaigeWorkspace.onboarding suite
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: rendered frame owed post-deploy (browser capture unavailable this session).
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: rendered frame owed post-deploy.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: rendered frame owed post-deploy.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: rendered frame owed post-deploy.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: rendered frame owed post-deploy.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: rendered frame owed post-deploy.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: rendered frame owed post-deploy.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: rendered frame owed post-deploy.

## Release identity addendum (2026-10-23 identity repair)

The original INTERNAL_BUILD_IDENTITY cited the pre-rebase branch hash
`cdc009e5386…` — after the dompurify rebase and squash merge that hash is no
longer reachable, which made the record's identity stale (coordinator finding).
The corrected identity above cites the exact PR head (`4e7cf3746`, all ten
required checks green), the squash merge (`b9effc47d`), and the verified
production deployment (`dpl_8iR9Hmgo6EkE12tcjUKDrEAi2D9y` — coordinator-
verified 2026-10-22, alongside #2616's `dpl_FL3fqy7v8fNUgr6EoXZcYw2NbvdB`).

Production bundle readback (2026-10-22, EXP01 lead): the served import chain
resolved to `SoloEntry-D3K7QEgW.js` carrying all five required markers
("Talk with Paige live", "paige-live-open-request", "Minimize Live any time to
keep typing", "Not activated yet", "Onboarding & business discovery") with the
withdrawn typing claim and "Meet PAIGE" absent; a later snapshot
(`SoloEntry-DosxqvBq.js`, 2026-10-23) retains them.

Count clarification (the 73/74 discrepancy), corrected after independent review
of this docs PR: the reviewer's delta verdict ran 73/73 at `afe216509` — the
pre-busy-disable head (PaigeLiveConversation 40 + onboarding 14 + parity 16 +
integration 3). The busy-disable regression was then ADDED by `cdc009e53`
itself, so `cdc009e53` and the branch's final head `4e7cf3746` both carry 74
(40 + 15 + 16 + 3). An earlier draft of this paragraph attributed 73 to
`cdc009e53` with a wrong per-file split — inaccurate, and corrected here.

Rendered-evidence limitation, stated plainly: no production screenshot of the
corrected first-run stage exists. Browser-capture tooling was unavailable in
the engineering session, and the founder's single evaluation window has not
yet occurred. RENDERED_EVIDENCE and AUTHENTICATED_RUNTIME above remain
UNVERIFIED and are owed to that window.
