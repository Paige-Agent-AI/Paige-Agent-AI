# UI delivery evidence: Experience 03 S4a — preparing a campaign step for approval

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §110 item 6
and the S4 slice row (convergence §N3.5: "Campaign steps … PARTIAL: planned step cannot reach approval").
The shipped plan copy already told the owner a step "goes to you for approval once it is prepared" — but nothing
in the product prepared it. This closes that gap the governed way: a `prepare_action` command in the EXISTING
`configure_campaign_brief_actions` writer that delegates to the action bus's own `advance_action(_,'drafted')`,
so the step reaches the incumbent approvals queue through the same authority, audit and approval machinery as
every drafted action — no second channel, no new engine or table. The screen gains the matching control and
three copy repairs (the plan-form hint, the empty state, the remove warning no longer claim a planned step
already waits for approval).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: WAIVED: owner-decision=AGENTS.md mandatory routing with the #1280 waiver grammar; reason=the Flow-by-Flow skill is not installed in this agent environment, and the journey record §6/§9 plus the incumbent steps-row flow reading below carries the flow trace instead
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read this session — Operate mode, refinement-preserves: one incumbent `btn btn-s` control joining the existing `ca-acts` row, controls name their action ("Prepare for approval") and the title names the consequence ("Draft it and open its approval; nothing is sent or published"), no layout, chrome, motion or token change, no craft-floor ban touched
MATERIAL_FLOW_CHANGE: YES: a planned campaign step gains its governed transition to the incumbent approvals queue — the transition the shipped plan copy already described and the journey §N3.5/S4 row pre-scoped ("step prepare-for-approval; DB tests; rendered design")
FLOW_PROTOTYPE: PASS: the design reference is the owner-approved incumbent steps row itself (the ca-acts control row shipped with the approved campaign dossier surface) joined to the incumbent approvals queue — the button adds no new screen, pattern or world, and the journey slice table (accepted with the journey) names this exact deliverable; the transition it triggers is the action bus's own drafted-to-approvals path, already rendered by the approval queue's incumbent tests
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the Solo owner who planned a step and now wants it done presses "Prepare for approval" on that step and finds it waiting in Approvals; planning and everything else keep their actions
VISUAL_DIRECTION: PASS: the incumbent button class and row — no new identity, color, spacing or type decision
AUTOMATED_EVIDENCE: PASS: src/solo/useCampaignActions.test.tsx 18/18 — two new hook cases (prepare sends {type:prepare_action,briefId,actionId} with a fresh idempotency key and counts only when the readback shows the step waiting in Approvals; a read that still shows it planned reports not confirmed), the UI case gains the button on a planned step and its absence on a finished one, and the token suite now reads the new migration so every CAMPAIGN_* refusal keeps a person-readable sentence — mutation-checked: removing the planned branch from the button gate fails the dossier case, and the removeWarning and NOT_PLANNED message assertions pin the repaired copy; supabase/tests/campaign_brief_actions.sql block 4b (corrected after review round 1): one prepare of the owner-planned step whose own result must say outcome prepared and lifecycle approval_required, the approvals row the bus opened exists with the bus source and the acting submitter and the step's own name as its subject (the approvals row refuses a null draft, so the branch states plainly what approving does), the read derives approval_required, a second prepare under a fresh key is refused CAMPAIGN_ACTION_NOT_PLANNED, a member is denied, and the audited/ledgered totals rise 20 to 21
STATIC_EVIDENCE: PASS: tsc reports nothing in the changed files; the migration is mechanically derived from the live incumbent (20271022100000) with a proven two-line delta — vocabulary plus the prepare branch — so the action-truth and bus-refused behavior cannot silently regress
RENDERED_EVIDENCE: UNVERIFIED: no browser session in this environment — the control is the incumbent button rendering in the incumbent row, behaviorally pinned by the suite, with the rendered matrix owed below
BEHAVIORAL_EVIDENCE: PASS: the suite mounts the real CampaignActions in the router and asserts the button on a planned step, its absence for a member, and the confirmed/unconfirmed write paths; the pgTAP block drives the real writer, the real action bus and the real read
AUTHENTICATED_RUNTIME: UNVERIFIED: a signed-in owner pressing Prepare and finding the row in their approvals is owed at the next authenticated pass
KEYBOARD_FOCUS: PASS: the button is a real native button in the row's tab order like its siblings, disabled while a write is in flight
ZOOM_REFLOW: NOT_APPLICABLE: no layout change — one control in an existing row that already wraps
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: planned (button offered), prepared, approval_required (the row's existing "It's waiting in your approvals." meta line), refusal paths (NOT_PLANNED and NOT_LINKED/NOT_FOUND sentences), member (no control), unconfirmed readback, and the remove-warning truth for planned/prepared
TRUTHFUL_STATE_LABELS: PASS: this IS the truth repair — the plan hint, empty state and remove warning no longer claim a planned step waits for approval when it does not, and the prepare outcome says plainly what happened ("It's waiting in your approvals now.")
SOLO_UI: YES: Campaigns › dossier › Steps and results (src/solo/campaign-actions.tsx, useCampaignActions.ts, solo-campaigns.css untouched)
UNVERIFIED: the rendered/browser matrix including the four Solo viewports, the authenticated owner press of Prepare, production migration readback, and founder acceptance — none claimed complete by this record

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta

OWNER_INTENT: the journey §110 item 6 acceptance: a planned campaign step must reach its approval through a governed path or the copy must say the truth — this ships the governed path and repairs the copy
MUST_NOT_HAPPEN: no second approval channel or writer beside the action bus — no send or publish effect from preparing (the kind is record-only and still requires the owner's approval) — no state change to any step that is not still planned — no member gaining the control — the shipped plan copy left claiming a wait that does not exist
MUST_PRESERVE: every incumbent command, refusal, audit and ledger behavior of the writer (proven by the two-line mechanical delta against the live incumbent) — the dossier's existing rows, buttons and copy outside the three repaired sentences — the approval queue's own behavior
ACCEPTANCE_CRITERIA: an owner plans a step, presses "Prepare for approval", and that step stands in Approvals with its record-only contract; approving it records the step and sends nothing; pressing prepare on a step not still planned is refused in words; a member never sees the control; the plan hint and remove warning say what is actually true
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: the action bus's advance/approval machinery (consumed, never duplicated) — get_campaign_brief_actions and its admin-gated approval_id — the writer's idempotency ledger and audit — the dossier's incumbent tests

INTERNAL_BUILD_IDENTITY: 1bd8f916afb8c33243af1bfcff3b6895aa132291; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271115010000_exp03_campaign_step_prepare awaits review CI and the normal production pipeline); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp03-s4a-campaign-step-prepare.md
RELEASE_CHANNEL: development: source release, production on merge (pre-launch, §4)
RELEASE_CLASSIFICATION: internal-only: the governed bridge inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release at this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source, behavioral and database proof complete — the rendered matrix, authenticated runtime, production migration readback and founder acceptance remain separately owed
RELEASE_RECOVERY: position=reviewed forward release on green CI with the normal deploy-migrations persisted-apply readback; reference=docs/doctrine/release-governance-and-customer-update-policy.md
