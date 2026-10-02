# UI delivery evidence: the truthful working lifecycle (C2)

Production complaint (2026-10-01): "when you make a short statement you don't 1. Show that you
are still working and 2. Actually bring up the card in the chat box like I requested." The
owner had to send another message to see a card that had been minted mid-stream.

Root cause: the approval-card render gate carried `!isLoading`, hiding every card until the
stream ended. With C1's continuation loop (merged as #1626) keeping the stream alive through
the task lifecycle, this gate hid cards for the entire duration of a multi-round task.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: the recognized UI component src/components/dashboard/PaigeAIChat.tsx changed (the card render gate and the finally-block safety net); no layout, token or copy system changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected flow is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the existing card, outcome row and chat presentation are reused unchanged — the change removes a visibility gate, it adds no visual element
IMPECCABLE: PASS: the installed Impeccable skill context ran against the chat surface and the craft floor was read before any edit; the change is a scoped gate removal and a finally-block addition — no visual artifact is in scope
MATERIAL_FLOW_CHANGE: YES: an approval card now renders mid-stream instead of after [DONE]; the working indicator carries a no-stuck safety net
FLOW_PROTOTYPE: WAIVED: owner-decision=the completion-lane assignment 2026-10-01 package C2; reason=the assignment fixes the flow verbatim (the card appears immediately when minted; the working state represents the task; no fake animation after server stops) and the failing-first suite pins the gate removal and the safety net
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner watching the chat sees an approval card the moment it is minted; the working indicator stays truthful through the task and always clears
VISUAL_DIRECTION: PASS: existing card and outcome presentation unchanged
AUTOMATED_EVIDENCE: PASS: the suite failed 1 of 6 on unchanged main (the finally pin; the card-gate pin passed for the wrong reason — the lazy regex matched an inner paren, now fixed to match the full gate line) and passes 6 of 6; the approval and archive stored-proposal suites stay green alongside (29 of 29 across the three)
STATIC_EVIDENCE: PASS: the !isLoading gate is removed from the card render condition (the card appears the instant the server mints it, mid-stream; clicking Approve mid-stream supersedes the model's turn via the existing request-fence machinery); the card's disabled prop uses composerSendBlocked (composer writability + dictation), NOT isLoading, so the Approve button is already clickable mid-stream; the streamTurn finally block now carries releaseRequestBusy as an idempotent safety net (the fence checks the ticket first), catching any exit path that missed it — the no-stuck-working guarantee; the working label shows the task's latest step from the steps trace, not a generic indicator
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changed; the existing card presents the outcome with a visibility gate removed
BEHAVIORAL_EVIDENCE: PASS: the gate-line pin matches the full render condition and checks for the absence of !isLoading; the finally pin finds the LAST finally block (streamTurn's) and checks for the release call within 600 chars; the canary proves the disabled prop and the working label remain unchanged
AUTHENTICATED_RUNTIME: UNVERIFIED: a live approval card appearing mid-stream on a real workspace, and the working indicator clearing on every exit path, owed after merge
KEYBOARD_FOCUS: PASS: the card's keyboard interaction is unchanged — the Approve button gains no new disabled condition; the card's tabIndex and focus behavior are the existing card's
ZOOM_REFLOW: NOT_APPLICABLE: no layout, content geometry or responsive behavior changed
REDUCED_MOTION: NOT_APPLICABLE: no motion was added or changed
STATE_COVERAGE: PASS: covered states are card-visible-mid-stream, card-visible-after-stream, card-clickable-mid-stream (Approve supersedes), working-indicator-on-through-continuations (C1 keeps the stream alive), working-indicator-clears-on-completion, clears-on-approval, clears-on-blockage, clears-on-cancel, clears-on-error, and the finally safety net catching unexpected exits
TRUTHFUL_STATE_LABELS: PASS: the working indicator never fabricates activity — it is tied to the actual stream lifecycle (which, post-C1, IS the task lifecycle), and the finally safety net guarantees it cannot stick after the server stops
UNVERIFIED: the deployed frontend and one authenticated mid-stream card appearance remain unverified until post-merge acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the card appears in the existing message position
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_1536X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
OWNER_INTENT: the card appears immediately and the working state is truthful, per the completion-lane assignment package C2
MUST_NOT_HAPPEN: no fake working animation after server stops; no card hidden by the stream it was minted in; no new visual system
MUST_PRESERVE: the card's existing presentation and keyboard behavior; the working label's step-driven copy; the request-fence machinery
ACCEPTANCE_CRITERIA: an approval card minted mid-stream renders immediately; its Approve is clickable mid-stream; the working indicator clears on every exit path; no stuck working state exists
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the card render gate and the finally safety net; explicitly unaffected = the card's visual system, the request fence, the step trace, the continuation loop
RELEASE_NOTE_REQUIRED: NO: bounded gate removal and safety-net addition
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the gate pins and the safety-net pin are proven offline; the authenticated mid-stream card appearance and deployed frontend are not yet proven
RELEASE_RECOVERY: position=revert this bounded change if a card misrenders mid-stream or the working indicator sticks, restoring the isLoading gate from the merge parent; reference=PACKAGE-C2

INTERNAL_BUILD_IDENTITY: PENDING; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE client only; evidence=failing-first-gate-pins
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: gate removal and safety-net addition on the existing card and working indicator
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
