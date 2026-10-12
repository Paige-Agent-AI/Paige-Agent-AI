# UI delivery evidence: INT-298 MBC slice 6b — a campaign shows its steps and what came of them

Slice 6, item 1 (INT-298 / ANT-76 / ANT-87 / P-ANT-5): "Build the Campaigns screen presentation of canonical Marketing
Actions, preserving the actual lifecycle, approval state, expected outcomes and observed results." Backend: slice 5
(`campaign_brief_actions`, `configure_campaign_brief_actions`, `get_campaign_brief_actions`) and slice 6a (a step's
result and judgement stand only over a proven finish). Surface: the Campaigns dossier's new "Steps and results"
section. Frames: `DRIVE_ONLY=flows node scripts/live-drive/marketing-views-drive.mjs`; key frames in
`assets/int298-mbc6b-campaign-steps/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding by reading the slice-5 and 6a read and writer (lifecycle CASE, finish_counts, the NOT_PROVEN, NOT_FINISHED and BUS_REFUSED refusals), the dossier and its "What this campaign uses" section (the pattern this follows), the desk's state palette (st-* classes) and the approved INT-342 prototype's campaign map. Searched get_campaign_brief_actions, configure_campaign_brief_actions, campaign_brief_actions, marketing.campaign_action across src/: no surface read them. Flows: an owner opens a campaign and reads each step's real state, aim, result and judgement under its tactic; plans a step; records the result of a finished step; judges it; removes a step; a member reads states without names; the read fails
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode inside the existing dossier; steps grouped under their tactic, one card per step, the server's lifecycle as the state chip in the desk's palette, gold only on the submit act. First frames showed a full-weight Remove button on every step and the approval sentence repeated verbatim: Remove became a quiet × on the title row (now with a confirmation) and the sentence was cut to one line. The independent review (BLOCK, two P1) found a failed step drawn green once a result was recorded, a PAIGE planning button the chat cannot back, due dates a day early west of UTC, an unstyled Plan control, one-click removal of a recorded result, and unmapped refusal tokens; all fixed and re-shot
MATERIAL_FLOW_CHANGE: YES: the dossier gains a section to plan, record and judge campaign steps; nothing previously shipped is removed (§58)
FLOW_PROTOTYPE: PASS: the owner-approved INT-342 prototype drew a campaign's tactics and actions in the dossier; pre-launch stance (CLAUDE.md §4, §69 pre-launch override)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin sees how each step of a campaign is going and records what came of it; a member reads the plan
VISUAL_DIRECTION: PASS: Solo tokens only, both themes, hairline cards on surface-2, violet kind chips, no gold outside the submit button, focus rings on every new control
AUTOMATED_EVIDENCE: PASS: useCampaignActions.test.tsx (15): read normalisation (a recorded step carries no result even if one is sent; a judgement only on a judged step), a failed step stays failed in label, tone and basis once a result is recorded or judged, 'nothing was sent' only for the record-only kind, every CAMPAIGN_* token in the two migrations maps to its own sentence (read from the migration files), a picked date sent as local midnight, the remove warning, plan confirmed by re-reading with the form's own idempotency key, an older readback never drawing over a newer one, a write the read doesn't show reported as unconfirmed, a server refusal passed through, the dossier reading only its own campaign, result offered only on a proven finish or a failure, no controls and no names for a member, no PAIGE planning promise. Reinstating each defect (no read-sequence guard, no failed tone, no failed basis, one unmapped token, 'nothing sent' for any kind, a fresh key per retry) fails a test. growth2.render.test.tsx and sales-ops.contract.test.tsx with the hook doubled. Full unit suite before the review fixes: 779 files, 11,831 tests passed
STATIC_EVIDENCE: PASS: tsc reports no error in any changed file; eslint 0 errors and no warnings on changed files; impeccable@4.1.0 detect exit 0
RENDERED_EVIDENCE: PASS: DRIVE_ONLY=flows 96/96, including owner and member step flows in both themes at 1366 docked: seven steps under two tactics; a recorded-only step says nothing shows it ran and shows no result even with one planted in its row; a failed step with a recorded result reads 'Failed · result recorded' and, for an owner, why it failed; a step awaiting approval says so in words that fit the reader; no PAIGE planning promise; Plan a step drawn as the dashed add control; no overflow; frames looked at
BEHAVIORAL_EVIDENCE: PASS: the drive plans a step (filed under its tactic with its aim and the picked day, focus back on Plan), records a result on a step finished on approval (a figure like 1,000 is refused with a reason), judges it, and removes a step after a confirmation that says it stays in Approvals, all through the harness writer (which returns the server's own messages) and read back
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the read and writer are proven on a production-schema clone in database-contract (campaign_brief_actions.sql, process_scope_and_action_truth.sql)
KEYBOARD_FOCUS: PASS: every act is a button; the kind picker is a radiogroup with one tab stop and arrow keys (driven); Escape closes the result form and leaves the dossier open (driven); focus returns to Plan a step after planning or removing and to the step after a form closes; focus rings on the add control, every button and the step
ZOOM_REFLOW: PASS: step names truncate with an ellipsis beside the state chip; result rows and form fields wrap at every drive width
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: drawn in frames and driven: no steps yet, loading, failed read, owner, member, planned, waiting for approval, scheduled, waiting on an earlier step, done on approval, marked done with nothing behind it, failed with a recorded result, result recorded, judged. prepared, approved, running, state not reported, blocked and stopped share the same chip and are checked in the unit tests' tone and label maps; a frame for each is not taken
TRUTHFUL_STATE_LABELS: PASS: the state is the server's lifecycle, never computed on screen; a failed step stays failed after a result or judgement and says why to owners; a step marked done with no run or approval reads "Marked done, nothing shows it ran" and offers no result; 'nothing was sent or published' is said only for the record-only campaign step; a recorded result says it was recorded as stated, not measured; planning says nothing is drafted, sent or published; removing says the action stays in Approvals; a change counts only once the server's read shows it
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/campaigns (the dossier)

SOLO_1536X770_PAIGE_CLOSED: PASS: the dossier is a fixed-width drawer; its layout does not depend on the canvas width (flows run at 1366)
SOLO_1536X770_PAIGE_OPEN: PASS: as above
SOLO_1366X768_PAIGE_CLOSED: PASS: owner and member flows, overflow 0 (DRIVE_ONLY=flows)
SOLO_1366X768_PAIGE_OPEN: PASS: docked content width, overflow 0 (DRIVE_ONLY=flows)
SOLO_1024X768_PAIGE_CLOSED: PASS: the drawer is the same fixed width; names truncate rather than overflow
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: as 1024
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: a campaign shows its steps as they really stand, from the action bus, with the aim and what actually happened
MUST_NOT_HAPPEN: a step marked done with nothing behind it shown as a success or given a result; a planned step shown as sent; a member shown a step's name; a second action ledger or execution path
MUST_PRESERVE: the dossier's brief, what the campaign uses, readiness, evidence links, lifecycle and actions; the `paige_actions` bus and `file_action` authority
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens a campaign's dossier, plans a step, sees it waiting for approval, approves it, records its result, judges it, reloads and still sees all of it; a member sees the states without names or controls
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - configure_campaign_brief_actions and get_campaign_brief_actions unchanged by this slice; growth2 render and sales-ops contract with the new hook doubled; unaffected and named - Overview, Analytics, Audience, Content, Social, Email, Ads

INTERNAL_BUILD_IDENTITY: a60d1ffb1aae7a5331781fa35f4c333771393951; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a dossier section over an existing read and writer
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - the section reads and writes through slice-5 seams only; reference=git revert of this PR merge
UNVERIFIED: authenticated production runtime (§32.c): plan, approve, record and judge against a real Solo account; no tenant login in this session. Not built here: the Chat and Live tools (6c), linking an existing action from the dossier (the writer supports it; PAIGE is its first caller in 6c), setting a step's dependency.
