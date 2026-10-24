# Chat continuity proofs (PR6) — send-latch hardening + the four public behaviors pinned

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no new flow — the existing compose→send→answer, switch-conversation, retry-after-failure, reload and returning-conversation journeys keep every step; this PR adds behavioral regression proofs for each and hardens the internal submission-latch contract (the preflight/document latches are now cleared by submission generation in the turn runner's exit path instead of by fence-ticket acceptance).
PAIGE_UI_DESIGN: PASS: zero rendering change — no DOM, CSS, copy or token is touched; the PaigeAIChat.tsx diff is confined to the streamTurn signature/exit-path and its three call sites.
MATERIAL_FLOW_CHANGE: NO: lifecycle-correctness repair inside existing flows; no new goal, state, transition, exit or consequence.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner who sends a message, switches conversations mid-preparation, hits a transient server failure, or reloads the tab — each keeps the same primary action (type + Send), now proven to survive all four interruptions.
VISUAL_DIRECTION: PASS: no visual delta by construction; viewport fields below are NOT_APPLICABLE for the same reason.
AUTOMATED_EVIDENCE: PASS: vitest composerScope suite 66/66 at head 2ea52588c (4 new proofs: conversation-switch-mid-preparation does not wedge later sends; definitive 5xx restores the draft and offers the working visible Retry; the returning conversation rehydrates the COMPLETE 12-turn transcript; the unsent draft returns after a full remount through the canonical session store) — plus soloMultiTurn + turnStates 44/44, tsc clean.
STATIC_EVIDENCE: PASS: tsc --noEmit exit 0 at 2ea52588c; CI re-runs the full matrix at the PR head (verify job ~30 min).
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendering change exists to capture; the proof class for this PR is behavioral (real component, real DOM assertions, real fetch fencing in jsdom), which AUTOMATED_EVIDENCE carries.
BEHAVIORAL_EVIDENCE: PASS: every new test drives the public surface only — textarea typing, the real Send button, the real rail onSelect path, the real Retry affordance — including a deferred session-resolution window that reproduces the genuine mid-preparation timing a slow token refresh produces.
AUTHENTICATED_RUNTIME: UNVERIFIED: the founder's single evaluation window owns the authenticated legs of these four journeys on the designated ordinary account; engineering does not manufacture them.
KEYBOARD_FOCUS: PASS: no focus-affecting change; composer/tab order untouched.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the four covered states are preparation-superseded, definitive-server-failure, returning-hydration and post-reload-new-chat; the ambiguous-failure and refusal states were already pinned by the existing suite ("keeps an ambiguous HTTP failure truthful…", "explains a known recovery refusal…") and are deliberately NOT re-offered a Retry.
TRUTHFUL_STATE_LABELS: PASS: the Retry affordance is offered exactly where the server's own body certifies the message was not accepted (message_accepted:false); ambiguous outcomes keep the check-first wording and no replay — the honesty pair is now pinned from both sides.
SOLO_UI: YES: the Solo PAIGE chat surface (docked panel and dedicated page share this component).
UNVERIFIED: authenticated versions of interruption/retry/reload/returning remain the founder window's legs on the designated ordinary account.

OWNER_INTENT: owner directive 2026-10-24 (finish PR6: regression-test the D1 send-wedge fix, complete D2 reload/composer-discard and D4 transcript-truncation repairs, prove interruption, retry, reload and returning-conversation behavior) — delivered as behavioral proofs on the public surface, after re-diagnosis showed current main's composer-scope rearchitecture already carries the repairs (dispatch-time latch clear, epoch-parked notices, session draft store).
MUST_NOT_HAPPEN: a superseded, failed or interrupted preparation must never wedge the composer for later sends; an ambiguous server outcome must never offer a blind resend; a returning conversation must never render a truncated transcript; a reload must never silently discard the unsent draft.
MUST_PRESERVE: the no-replay honesty pair (Retry only on server-certified non-acceptance), the interactive-admission semantics, the draft session owner binding, and every existing suite behavior (66/66 + 44/44).
ACCEPTANCE_CRITERIA: the four public behaviors hold at the PR head under real component harnesses; the latch hardening changes no reachable public behavior on main (it closes the internal finally-contract for the direct-call surface).
MOTION_PURPOSE: NONE: no motion change.

## Scope and collisions

- Classification: Solo chat lifecycle — behavioral regression proofs + internal latch-contract hardening (2 files: component exit path, test suite; this record).
- Affected flows: send preparation, conversation switch, transient-failure recovery, thread rehydration, draft retention.
- Neighboring regressions: none — the full composerScope suite passes unchanged around the four additions.
- Active-owner/file collisions: DRAFT #2401 (fix/ant21-chat-recovery-refusal, head d3e0857ce4, idle since 2026-10-21) also modifies PaigeAIChat.tsx (attachments/refusal/composer-scope copy); this PR's diff is confined to the streamTurn signature/exit and tests, and merges cleanly around it — its reservation is preserved. EXP05's #2758/#2762 touch no chat file.
- Explicit exclusions: no change to the interactive admission protocol, the draft session store, any RPC, migration or edge function.

## Re-diagnosis record (what happened to D1/D2/D4)

- D1 (panel send wedge): the original repro paths ran against the pre-rearchitecture surface. Current main closes every publicly-reachable wedge route — the latch clears when the request dispatches (not only in the exit path), abortActiveRequest (called by every selection/switch path) clears it and bumps the submission generation, and the Solo surface renders no regenerate affordance (that direct-call surface is where the finally-contract gap remained). The committed hardening makes the exit path correct by construction for the remaining direct callers (connection-retry / regenerate); the interruption proof pins the public behavior.
- D2 (post-reload composer discarding input): repaired by main's composer draft session store (sessionStorage-backed, owner-bound, TTL'd, with reload-protection states) — now pinned at the component level by the remount proof.
- D4 (panel hydrating only ~3 messages): the threads[0]-vs-controlled-thread conflict and the superseded-hydration drops are resolved by main's conversation state machine (controlled precedence, requested/displayed split, pendingThreadSelection parking) — pinned by the full 12-turn rehydration proof.

## Evidence index

- vitest: `node node_modules/vitest/vitest.mjs run src/components/dashboard/PaigeAIChat.composerScope.test.tsx` → 66/66 at 2ea52588c; sibling `soloMultiTurn` + `turnStates` → 44/44; `tsc --noEmit` exit 0.
- New tests: "keeps Send alive after a conversation switch supersedes a preparing send", "recovers a transient server failure through the visible Retry affordance", "rehydrates the COMPLETE saved transcript when the conversation returns", "returns the owner's unsent draft after a full remount (reload)".

## Review and limitations

Limitation: the four proofs run in the jsdom harness — genuine network timing, real token-refresh latency and the authenticated account legs are the founder window's territory (AUTHENTICATED_RUNTIME above). The latch hardening has no reachable public-API red/green test on current main by design; its correctness argument is the ownership-by-generation contract plus the public interruption proof.

INTERNAL_BUILD_IDENTITY: 2ea52588c383079c1686967d891eaae27bf2898c; deployment=undeployed (behavioral proofs + internal hardening; deploys with the next web build); environment=local vitest + CI; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + the four named tests
RELEASE_CHANNEL: development: merges through the normal PR gate before the founder evaluation.
RELEASE_CLASSIFICATION: internal-only: pre-evaluation continuity hardening of the EXP01 chat surface.
CUSTOMER_RELEASE_IDENTITY: none: not yet in the founder evaluation window.
RELEASE_NOTE_REQUIRED: no: no user-visible change; the four behaviors already ship on main.
RELEASE_TRUTH_BOUNDARY: PARTIAL: behavioral classes proven in-harness; authenticated legs remain the founder window.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the PR thread
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no visual change to any rendered state; proof class is behavioral (AUTOMATED_EVIDENCE).
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no visual change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no visual change.
