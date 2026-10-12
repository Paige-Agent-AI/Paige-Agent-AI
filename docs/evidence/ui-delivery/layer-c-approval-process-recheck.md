# UI delivery evidence: Layer-C approval re-reads the process, and refusals say what happened

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow traced from an owner approving a held Layer-C act (ApprovalRow, useSoloProposals, useCommandCenter, useAgencyCommandCenter, DraftsAwaitingPanel → execute-approval → approve-executor governedGate → resolve_automation_autonomy) to the two observable outcomes: the act runs, or it does not and the row remains open for a later yes with an owner sentence; caller inventory in the Scope section of this record
PAIGE_UI_DESIGN: PASS: no visual pattern introduced — every approval surface already renders the response's `error` string in its existing toast or inline error; only the text of that string changes for orchestration refusals
MATERIAL_FLOW_CHANGE: YES: an approval of a held Layer-C act no longer runs it when its process has since been paused, turned off, or the platform dropped to observe only; the owner sees a plain sentence instead of the generic "Couldn't complete that action."
FLOW_PROTOTYPE: WAIVED: owner-decision=INT-179 reactivation directive 2026-10-12 and §68 owner ruling 2026-08-24; reason=the assignment requires changed-authorization cases to fail closed and §68 rules no authority is permanent, so the lifecycle is fixed; there is no new control, layout or interaction, only a refusal sentence in the existing toast
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace owner or admin approves a step PAIGE held for them; the primary outcome is that the step runs only if the automation it belongs to still allows it, and the owner is told plainly when it does not
VISUAL_DIRECTION: PASS: unchanged — same toast and inline error components, same tokens, same placement
AUTOMATED_EVIDENCE: PASS: vitest 129/129 across src/__tests__/paige-orchestration-*.test.ts, including the new process-recheck block (paused, off, ceiling 0, deleted, read failure, auto still runs, own process read, resume path gated) and the message mapper; with the recheck removed, 7 of those tests fail
STATIC_EVIDENCE: PASS: deno check exits 0 on execute-approval and paige-native-event-dispatch; eslint reports the same 18 pre-existing errors on the touched directories before and after this diff (none introduced)
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI source changed — the edge response's `error` text changed and the existing approval toasts render it unchanged; there is no new rendered state or component
BEHAVIORAL_EVIDENCE: PASS: scripts/proof/layer-c-native-vertical.mjs runs the production execute-approval file against a rebuilt database; case E (paused, off, ceiling 0) shows the yes refused with the named reason and a readable `error`, the act left unexecuted with no effect and nothing redeemed, and the same yes executing once the process is restored — 16/16 locally on the merged base
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in drive of an approval refusal on the deployed surfaces — production holds 0 automations and 0 Layer-C acts, and creating one needs separate safe-tenant authority; the protected synthetic tenant (QA #1832) does not exist yet. The affected claim is the refusal sentence seen in a live toast
KEYBOARD_FOCUS: NOT_APPLICABLE: no dialog, focus, keyboard or navigation code changed — edge and test files only
ZOOM_REFLOW: NOT_APPLICABLE: no layout or sizing code changed; the sentences are one to two short lines in the existing toast
REDUCED_MOTION: NOT_APPLICABLE: no motion code changed
STATE_COVERAGE: PASS: every refusal reason maps to a sentence — paused, turned off, observe only, automation deleted, approver not owner or admin, outcome unconfirmed, and a plain default for anything else; each leaves the row open and nothing redeemed (unit-covered in src/__tests__/paige-orchestration-approve-executor.test.ts)
TRUTHFUL_STATE_LABELS: PASS: the sentences say only what is true — PAIGE did not run it, nothing changed, and the approval stays to be approved later; they do not name a control, because the owner-facing resume control is not verified reachable today
SOLO_UI: NO: no Solo UI source changed — the Solo approval hooks render the edge function's `error` unchanged
UNVERIFIED: the live toast on a deployed surface for a real held act (no production automation exists; safe-tenant authority and QA #1832 owed); sub-account, agency and platform-owner approver paths
OWNER_INTENT: a human's yes on a held step must not override what the automation and the platform say now (§68), and when PAIGE does not run it the owner is told why in plain words, with the approval kept so nothing is lost
MUST_NOT_HAPPEN: a held act running after its automation was paused, turned off or capped to observe only; an approval consumed or redeemed by a refusal; a snake_case code shown to the owner; a refusal that names a control the owner cannot reach
MUST_PRESERVE: the readback-confirm path recording a landed effect regardless of current posture; the existing door checks and governed gate; the approval surfaces' existing `error` rendering; non-orchestration (comms) approvals unchanged
ACCEPTANCE_CRITERIA: on the real platform, approving a held step whose automation is paused shows "This automation is paused, so PAIGE didn't run it…", the row stays, nothing changes; after the automation runs again, approving the same row runs the step once
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: resolve_automation_autonomy (the one posture resolver the engine uses), the governed gate, the monotonic act ledger and paige_approve_act_execution redemption — reused, none duplicated
INTERNAL_BUILD_IDENTITY: branch claude/charming-rubin-lbxd4o on main 308e435cc3168d3291359312d7abbee3993578b8; deployment=PR-branch; environment=preview; migrations=NOT_APPLICABLE; edge=PROOF_OWED(execute-approval production deploy via deploy-edge-functions on merge); evidence=vitest-129-and-layer-c-proof-16-of-16
RELEASE_CHANNEL: preview: built and verified on the branch; production follows green CI and merge via deploy-edge-functions (pre-launch §4)
RELEASE_CLASSIFICATION: internal-only: a fail-closed authority recheck and refusal wording on a path production has never exercised
CUSTOMER_RELEASE_IDENTITY: none: no customer-facing capability added; production holds no automations
RELEASE_NOTE_REQUIRED: NO: no customer-visible capability change; the path is unexercised in production
RELEASE_TRUTH_BOUNDARY: UNAVAILABLE: Layer-C approvals do not occur in production today (0 automations); the behaviour is proven against the real database headlessly, and the live drive is owed
RELEASE_RECOVERY: position=revert the Slice 2a commit, which restores the gate without the process re-read and the generic refusal text; reference=the Slice 2a commit on this branch

## Scope and collisions

- Classification: edge/shared-module authority fix with owner-visible refusal wording; no UI source in the diff.
- Callers of `execute-approval` inventoried (all read `error` on `ok:false`): `src/components/paige/ApprovalRow.tsx`, `src/solo/data/useSoloProposals.ts`, `src/solo/data/useCommandCenter.ts`, `src/agency/data/useAgencyCommandCenter.ts`, `src/components/dashboard/DraftsAwaitingPanel.tsx`. `error` is added only on the orchestration not-attempted branch; comms approvals are untouched.
- Branch restarted from main `308e435c` after #2019 merged.
- Exclusions: dormant Gate-3 hardening (Slice 2b), the automation arming/resume seam (owner decision), the comms door's global-role trap (Communications lane).

## User job and state map

An owner approves a step PAIGE held. If the automation is still live and allows it, the step runs as before. If the automation was paused, turned off, or PAIGE was set to observe only after the step was held, PAIGE does not run it, nothing is redeemed, the row stays, and the toast says why. Once the automation runs again, the same approval runs the step once.

## Evidence index

- `npx vitest run src/__tests__/paige-orchestration` → 129/129; the recheck removed → 7 failures in the new block.
- `deno check supabase/functions/execute-approval/index.ts supabase/functions/paige-native-event-dispatch/index.ts` → exit 0.
- `LAYER_C_E2E_DISPOSABLE=1 node scripts/proof/layer-c-native-vertical.mjs` → 16/16 (CI runs it in `database-contract` on production's reproduced grants).

## Review and limitations

Independent non-author review is run on the pushed diff before merge and recorded on the PR. The live toast on a deployed surface is PROOF OWED: no production automation exists and none may be created without separate safe-tenant authority.
