# UI delivery evidence: an approved card executes the stored proposal

Production grounding (2026-09-30, owner workspace audit): three deal.create approval cards
were minted in one conversation; the first two approvals stranded unconsumed because the
model re-worded the action between card and re-dispatch, and only the third executed. This
repair removes the model from the execution path entirely: the approve click invokes the CRM
door directly with the proposal's minted command and settled key, the door claims the stored
row atomically and executes the decided arguments, and the outcome card reports the verified
result. Proposal summaries become object-aware human copy — the raw "deal.create for a new
record" class is unreachable.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: the chat surface component src/components/dashboard/PaigeAIChat.tsx changed (approval execution flow and confirm payload passthrough); no layout, token or copy system changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected-flow packet is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the existing approval card, outcome card and chat presentation are reused unchanged; the only interface-code change is the execution path behind the existing Approve control
IMPECCABLE: PASS: the installed Impeccable skill and its craft floor were read; no visual artifact is in scope and every rendered control and wording is unchanged
MATERIAL_FLOW_CHANGE: YES: an approved action now executes the stored proposal directly through the governed door instead of depending on the model re-emitting matching arguments in the following turn; the person still sees one card, one click, and one truthful outcome report
FLOW_PROTOTYPE: WAIVED: owner-decision=CRM/Deal-Enrollment repair-train assignment 2026-10-01; reason=the required lifecycle was fixed verbatim by the assignment (understand, resolve identities, propose, persist, approve, execute that exact stored proposal, verify readback, report) with the invariants stated, and the failing-first reproduction covers the previously stranding path end to end
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner presses Approve on a Needs your OK card; the stored proposal executes exactly once through the governed door and the card reports ran, did not run, or could not confirm from the verified result
VISUAL_DIRECTION: PASS: the existing card, outcome row and chat shell presentation are reused; no new CSS, component or visual system
AUTOMATED_EVIDENCE: PASS: the suite failed 5 of 8 on unchanged main and passes 8 of 8 after the change; removing the door's confirm-command wiring or the client's direct invocation each turns its pin red (2 of 8 fail under either mutation, proven by mutate-run-restore); the six-suite CRM family passes 81 of 81 including adoption, edge-contract, door-wiring, resolution and patch-schema
STATIC_EVIDENCE: PASS: the door's approval_required response now carries the settled idempotency key; summaryFor renders object-aware copy for every create action and composes human sentences for the remainder so a raw internal verb is unreachable; the chat tool result and confirm frame carry the canonical command and settled key; the client executes confirmations that carry them, strips executed ones from the model turn, stamps the verified outcome on the asked card, and appends the card result to the turn text; the prompt forbids re-constructing approved actions and requires identities resolved before proposing; TypeScript reports zero errors in touched files
RENDERED_EVIDENCE: NOT_APPLICABLE: the existing approval card and outcome row render the new state; no new rendered component or visual state was added
BEHAVIORAL_EVIDENCE: PASS: source-level wiring pins prove the direct invocation, the payload passthrough at all three parse sites, the echo-stripping and the outcome stamping; each pin is mutation-proven load-bearing
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated approval round ran pre-merge; the remaining behavior is a live Approve click executing a stored deal proposal once, with the outcome card reporting the verified readback, owed on a real workspace after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: the existing Approve control and its focus behavior are unchanged
ZOOM_REFLOW: NOT_APPLICABLE: no layout, content geometry or responsive behavior changed
REDUCED_MOTION: NOT_APPLICABLE: no motion or reduced-motion behavior changed
STATE_COVERAGE: PASS: covered states are approved-and-executed (ran with readback), approved-and-refused (did not run, with the door's message), transport-failure (could not confirm), stale-or-spent fingerprint (the door re-proposes and the card says what must be reproposed), mixed batches (executed items stripped; non-CRM items keep the existing echo path), and declined (unchanged cancel path)
TRUTHFUL_STATE_LABELS: PASS: the outcome card states ran, did not run, or could not confirm from the door's verified response; the model's prompt bars success words until the verified outcome, and the turn text carries the card result so narration follows the outcome rather than an assumption
UNVERIFIED: the deployed Edge bundle identity and one authenticated stored-proposal approval round on a real workspace remain unverified until post-merge production acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered layout changed; the existing card and outcome row present the new execution state
OWNER_INTENT: an approved card authorizes the stored server-side proposal itself; execution must never depend on the model reconstructing the same arguments, per the repair-train assignment invariant
MUST_NOT_HAPPEN: no second approval, idempotency or fingerprint system; no new event or receipt ledger; no approval bypass or lane change; no tenant-specific branch; no customer content in committed evidence; no production write during pre-merge proof
MUST_PRESERVE: the door's atomic stored-args claim as the sole execution basis; the single approval store; confirm and auto lanes; canonical idempotency; account-switch revalidation; the Rail receipt path; the duplicate-name honesty rule; existing card and outcome visuals
ACCEPTANCE_CRITERIA: a proposal is minted once with resolved identities; the owner approves; the stored proposal executes regardless of any later model re-wording; the action runs exactly once with equivalent retries deduplicated by the existing key; the outcome card reports the verified readback; the Rail receipt exists for consequential execution; approval copy names the business object in owner-readable language
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the door's proposal response and summary copy, the chat's confirm payload wiring and prompt contract, the chat surface's approve path; explicitly unaffected = the governed executor, authority and autonomy resolution, the single approval store, Rail receipts, Mind/Memory, Knowledge and outbound communications
RELEASE_NOTE_REQUIRED: NO: bounded repair of the approved-action execution path with the existing card and outcome presentation
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the failing-first reproduction, mutation proof and six-suite family are proven offline; authenticated production execution and deployed bundle lineage are not yet proven
RELEASE_RECOVERY: position=revert this bounded repair if an approved card fails to execute or duplicates a write, restoring the prior model-mediated echo path from the merge parent before any forward fix; reference=PR-2B-STORED-PROPOSAL

INTERNAL_BUILD_IDENTITY: product=35b365740a867aa24a04afdc72ddd436481a5257; current-main-sync=07c802308dfb8f0e8d2c82ff2e6e09bca9b48ca1; base=07c802308dfb8f0e8d2c82ff2e6e09bca9b48ca1; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(crm-command and paige-ai-chat automated deployment after merge); evidence=failing-first-mutation-and-six-suite-family
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: repair of the approved-action execution path restoring intended behavior without a new workflow or interface
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
