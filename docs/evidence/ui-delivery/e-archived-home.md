# UI delivery evidence: the Archived home (E)

Production complaint (2026-10-01): the owner archived PPL-MRBD9 and it disappeared from the
active list with no visible home — no way to see it, restore it, or delete it. The data layer
returned archived pipelines with their lifecycleStatus, but the UI simply filtered them out.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: src/solo/PipelineCommandDesk.tsx and src/solo/solo-campaigns.css changed; a new visually distinct section renders below the pipeline header
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected flow is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the Archived section uses the shell's own surface tokens with reduced opacity and a hairline separator — muted and secondary to the active board, matching the folder organizer's visual scale
IMPECCABLE: PASS: the installed Impeccable skill context ran against the pipeline surface and the craft floor was read before any edit; the section is a scoped addition on the incumbent visual system with existing tokens, existing button scale, and no new visual language
MATERIAL_FLOW_CHANGE: YES: a new visible surface for archived pipelines with Restore and Delete actions
FLOW_PROTOTYPE: WAIVED: owner-decision=the completion-lane assignment 2026-10-01 package E; reason=the assignment specifies the flow verbatim (archive leaves active view, appears in the Archived section, restore and delete are available) and the failing-first suite pins the section's presence, its contents and its actions
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner who archived a pipeline finds it in the Archived section below the pipeline board, restores it with one click, or deletes it through the existing dependency-aware confirmation
VISUAL_DIRECTION: PASS: the shell's existing surface tokens with reduced opacity (.82), a hairline top border, the same small-button scale as the folder organizer, and the same ink hierarchy as the rest of the pipeline desk
AUTOMATED_EVIDENCE: PASS: the suite failed 5 of 8 on unchanged main and passes 8 of 8; the pipeline UI family stays green (29 of 29 across PipelineCommandDesk, PipelineDelete, useSoloCampaigns.delete and this suite)
STATIC_EVIDENCE: PASS: archived pipelines are separated from the active list in PipelineCommandDesk (archivedPipelines derives from lifecycleStatus === "archived"); each renders in a distinct section with its name and shortRef; Restore invokes the existing pipelineAction with type restore-pipeline; Delete uses the existing PipelineDelete component (empty-only, dependency-aware, type-the-reference-to-confirm); the realtime board from PR #1611 refreshes both sections when the server state changes; no local archive/restore state exists — the section renders purely from server data
RENDERED_EVIDENCE: UNVERIFIED: the rendered section across viewports and themes is owed to the authenticated round; the layout is a simple flex list using existing responsive patterns
BEHAVIORAL_EVIDENCE: PASS: the suite pins the archivedPipelines derivation, the section's presence and className, the name+shortRef rendering, the restore-pipeline action, the PipelineDelete usage, the muted CSS, the active-list exclusion, and the absence of local state
AUTHENTICATED_RUNTIME: UNVERIFIED: a live archive → the pipeline appears in the Archived section → restore returns it to active, owed after merge
KEYBOARD_FOCUS: PASS: the Restore button is a native button element with the existing btn btn-s classes; PipelineDelete's focus behavior is unchanged from its own suite
ZOOM_REFLOW: PASS: the section is a standard flex list with ellipsis overflow on names; no fixed widths or absolute positioning
REDUCED_MOTION: PASS: the section has no transitions or animations; the prefers-reduced-motion rule in the CSS explicitly disables any inherited pipeline-row transitions
STATE_COVERAGE: PASS: covered states are archived-pipeline-visible, restore-clicked (disabled during pending), delete-confirmation (PipelineDelete's own states), read-only (canManage false disables actions), and the section hidden when there are no archived pipelines
TRUTHFUL_STATE_LABELS: PASS: the section's copy states the count and the consequence honestly; no success state is shown before the server confirms
UNVERIFIED: the deployed frontend and one authenticated archive → restore round remain unverified until post-merge acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: the pipeline desk is a workspace surface not the shell home
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: the pipeline desk is a workspace surface
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: the pipeline desk is a workspace surface
OWNER_INTENT: archived pipelines have a visible home with restore and delete, per the completion-lane assignment package E
MUST_NOT_HAPPEN: no second archive store; no local-only status; no hard-delete without the dependency check; no success shown before server truth
MUST_PRESERVE: the existing pipeline board, folder organizer, PipelineDelete behavior and the realtime board
ACCEPTANCE_CRITERIA: an archived pipeline appears in the Archived section; Restore returns it to the active list; Delete refuses when dependencies exist; the section updates live from server truth
MOTION_PURPOSE: NONE: no motion was added
PROTECTED_SEAMS: affected and tested = PipelineCommandDesk's archived section and the solo-campaigns CSS; explicitly unaffected = the pipeline executor, the board, the folder organizer, PipelineDelete's own confirmation flow
RELEASE_NOTE_REQUIRED: NO: bounded UI addition on the existing pipeline desk
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the wiring pins and the pipeline family are proven offline; the authenticated archive → restore round and deployed frontend are not yet proven
RELEASE_RECOVERY: position=revert this bounded addition if the pipeline desk misrenders, restoring the pre-E file from the merge parent; reference=PACKAGE-E

INTERNAL_BUILD_IDENTITY: product=77ef346634381d2924b58199989c879c6609d1cf; current-main-sync=77ef346634381d2924b58199989c879c6609d1cf; base=75d119947; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=failing-first-wiring-pins
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: UI addition of the Archived section on the existing pipeline desk
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned
