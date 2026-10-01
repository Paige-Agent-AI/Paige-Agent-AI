# UI delivery evidence: the archive that actually archives (Package B)

Production grounding (2026-10-01): the owner typed "yes" twice to archive PPL-MRBD9; the model
consumed the typed approval as authority, narrated "Done — archived", and the database showed
the pipeline still active — no card was minted, nothing executed. The governed pipeline lane
still depended on the model re-emitting the action after approval, the exact stranding class
#1600 removed for the CRM lane. This PR ports the stored-proposal invariant to the pipeline lane
entirely in the client: the shared chat handler is untouched (Knowledge #1615 owns that seam).

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: the recognized UI component src/components/dashboard/PaigeAIChat.tsx changed (the approve path grows the pipeline execution lane); no layout, token or copy system changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected flow is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the existing approval card, outcome row and chat presentation are reused unchanged — the only interface change is which lane executes behind the existing Approve control
IMPECCABLE: PASS: the installed Impeccable skill and its craft floor were read; no visual artifact is in scope — the change is execution wiring behind an unchanged surface
MATERIAL_FLOW_CHANGE: NO: the approved action executes the same governed pipeline mutation through the same executor; what changes is that execution now follows the card click deterministically instead of depending on model re-emission
FLOW_PROTOTYPE: NOT_REQUIRED: bounded execution-path port of the proven #1600 pattern onto the existing pipeline approval flow
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner presses Approve on a pipeline card; the stored proposal executes exactly once through the human door under the owner's own session, and the card reports ran, did not run, or could not confirm from the executor's answer
VISUAL_DIRECTION: PASS: existing card and outcome presentation unchanged
AUTOMATED_EVIDENCE: PASS: the suite failed 6 of 7 on unchanged main and passes 7 of 7; both critical pins are mutation-proven load-bearing (hard-coding the expiry guard false turns one red; substituting re-emitted arguments for the stored row's turns the other red); the CRM stored-proposal suite stays green alongside (21 of 21 across the two)
STATIC_EVIDENCE: PASS: the approve path reads the stored proposal row by fingerprint from paige_pending_confirmations (row-level security scopes it to the clicking user; the select carries args, tenant, expiry and tool); an expired or unreadable row refuses honestly with a line naming the remedy; execution goes through configure_tenant_pipeline — the same authenticated-granted RPC the pipeline board calls — with the stored command and the stored idempotency key and actor kind human, because the human clicking Approve is the executing authority; the executor's own idempotency cache makes a double click a replay that returns the recorded result (the action runs once); executed pipeline fingerprints are stripped from the model echo exactly as the CRM lane strips its own, so the model is never asked to re-emit; a typed yes cannot reach the executor because the collector reads only the approved card fingerprints; the chat handler is byte-untouched
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changed; the existing card presents the outcome
BEHAVIORAL_EVIDENCE: PASS: source-level wiring pins, each naming the exact load-bearing line, with two reproduce-and-restore mutation proofs
AUTHENTICATED_RUNTIME: UNVERIFIED: a live archive card whose click archives the pipeline and reports the readback is owed on a real workspace after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: no control or focus path changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout, content geometry or responsive behavior changed
REDUCED_MOTION: NOT_APPLICABLE: no motion or reduced-motion behavior changed
STATE_COVERAGE: PASS: covered states are ran with the executor's answer, refused with the executor's message (version conflict, authority, validation), not_run with an honest line for an unreadable or expired proposal, unconfirmed for a transport failure, and the echo stripped of everything executed so the model cannot re-emit or strand
TRUTHFUL_STATE_LABELS: PASS: the three outcome words follow the executor's own answer classes; the card never claims an archive the readback did not return
UNVERIFIED: the deployed frontend and one authenticated archive round on a real workspace remain unverified until post-merge acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing card presents the outcome
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed
OWNER_INTENT: an approved pipeline card executes the stored proposal itself, per the completion-lane assignment package B
MUST_NOT_HAPPEN: no second approval system or executor; no model re-emission as execution authority; no execution from prose; no cross-tenant execution; no customer content in committed evidence
MUST_PRESERVE: the general gate's minting and expiry; the human door's authority checks and idempotency cache; the CRM lane's stored-proposal execution byte-for-byte; the existing card presentation
ACCEPTANCE_CRITERIA: a pipeline card is minted; the owner approves; the stored proposal executes regardless of any model rewording or silence; the action runs once with retries as replays; the executor's readback reports the outcome; an expired or unreadable proposal refuses honestly; a typed yes never executes
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the client approve path's pipeline lane; explicitly unaffected = the shared chat handler (Knowledge seam), the general gate's minting, the pipeline executor and its core, the CRM door
RELEASE_NOTE_REQUIRED: NO: bounded execution-path port on the existing approval flow
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the wiring pins, mutation proofs and paired suites are proven offline; the authenticated archive round and deployed frontend are not yet proven
RELEASE_RECOVERY: position=revert this bounded port if a pipeline approval misexecutes or misreports, restoring the model-echo path from the merge parent before any forward fix; reference=PACKAGE-B

INTERNAL_BUILD_IDENTITY: product=bd91dc0de40a3cf968495f81609e63efc7fda727; current-main-sync=bd91dc0de40a3cf968495f81609e63efc7fda727; base=a1c4a6fae; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE(client only; the human door RPC is already deployed); evidence=failing-first-mutation-proven-wiring-pins
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: execution-path port of the stored-proposal invariant onto the existing pipeline approval flow
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
