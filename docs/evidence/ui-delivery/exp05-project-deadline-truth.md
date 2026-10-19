# EXP05 Projects: truthful native deadlines

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: original project list → original milestone/project inspector → Escape and original invoker; saved records remain unchanged
PAIGE_UI_DESIGN: PASS: installed Flow-by-Flow, project PAIGE UI Design, five Experience quality modules and Impeccable guidance applied to this existing native flow
MATERIAL_FLOW_CHANGE: NO: correct two derived display values; no new goal, control, navigation, state, consequence or writer
FLOW_PROTOTYPE: NOT_REQUIRED: existing project/inspection flow, styles and actions are unchanged; a date formatter and overdue predicate are repaired
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible SOLO owners can compare a project's milestone date with its original work and distinguish task deadlines from saved reminders
VISUAL_DIRECTION: PASS: retain the existing PAIGE project surface, tokens, Obsidian/Mineral themes and native inspectors
AUTOMATED_EVIDENCE: PASS: baseline1PASS/3FAIL; corrected Projects and three neighboring native-work suites29PASS/0FAIL; independent reviewer reproduced29PASS/0FAIL/0skip
STATIC_EVIDENCE: PASS: scoped ESLint0; type ratchet6current/10baseline with no new errors; diff-check0; Impeccable detector0.1.5 exit0 with no findings; actual-source/shared-shell esbuild3740 inputs
RENDERED_EVIDENCE: PASS: assets/exp05-project-deadlines/render-manifest.json seals19 distinct original screenshots: sixteen required desktop/theme/context/panel combinations and three phone list/inspection views
BEHAVIORAL_EVIDENCE: PASS: keyboard milestone inspection shows Jan2 matching the project list; original project editor retains2099-01-02/2099-01-09 date-only values; Escape restores the milestone/project invoker; no mutation invoked
AUTHENTICATED_RUNTIME: UNVERIFIED: local actual-source rendering uses neutral tenant fixtures, blocked networking and blocked writers; production deployment and ordinary authenticated correction remain owed
KEYBOARD_FOCUS: PASS: Enter opens the original milestone; Escape restores the exact milestone button, then project inspection/close restores its project button
ZOOM_REFLOW: UNVERIFIED: all four required desktop widths plus390px reflow observed without document horizontal overflow; actual browser magnification is not proven by viewport emulation
REDUCED_MOTION: NOT_APPLICABLE: this change introduces no animation or transition and preserves the original shell/inspector behavior
STATE_COVERAGE: PASS: applicable task-overdue positive, reminder exclusion, completed-task exclusion, both extreme ISO offsets, date-only project windows, native inspection and cancellation tested; other existing loading/refusal/provider states are unchanged
TRUTHFUL_STATE_LABELS: PASS: overdue is derived from task/milestone due_at, never reminder due_at; progress remains recorded work rather than delivery acceptance; missing activity remains unavailable, never a fabricated receipt
SOLO_UI: YES: shared Operations Projects for every equivalently eligible existing and future SOLO tenant, no account allowlist
SOLO_1536X770_PAIGE_CLOSED: PASS: a-dark-1536-closed.jpg and b-light-1536-closed.jpg, local source only
SOLO_1536X770_PAIGE_OPEN: PASS: a-dark-1536-open.jpg and b-light-1536-open.jpg, existing split workspace retained
SOLO_1366X768_PAIGE_CLOSED: PASS: both1366-closed frames, original dates/labels reachable
SOLO_1366X768_PAIGE_OPEN: PASS: both1366-open frames, existing split layout retained
SOLO_1024X768_PAIGE_CLOSED: PASS: both1024-closed frames, original project surface reachable
SOLO_1024X768_PAIGE_OPEN: PASS: both1024-open frames, original PAIGE overlay and close retained
SOLO_900X1000_PAIGE_CLOSED: PASS: both900-closed frames, original project surface reachable
SOLO_900X1000_PAIGE_OPEN: PASS: both900-open frames, original PAIGE overlay retained
UNVERIFIED: final-head required CI, production web identity and authenticated correction; actual magnification; full EXP05 and original18/25/50 acceptance; no owner product acceptance

OWNER_INTENT: make Operations an accurate, connected expression of PAIGE as AI COO, preserving real business records and cross-surface consistency
MUST_NOT_HAPPEN: no task/reminder reclassification in storage, schedule rewrite, fabricated delivery, provider activation, hidden mutation or tenant-specific behavior
MUST_PRESERVE: original native IDs, versions, due_at/remind_at, date-only project windows, native inspectors, permissions, writer/approval/readback and recovery contracts
ACCEPTANCE_CRITERIA: a reminder cannot add an overdue task warning; real past-due unfinished tasks still can; milestone display agrees with Work and original inspector in the same local time zone; project civil-date ranges do not shift
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: affected derived native display and overdue predicate are tested; auth, roles/RLS, entitlements/provisioning, Spine/Harness/Trust, native writers, receipts, schedules, providers, Live and Portal authority are unchanged

INTERNAL_BUILD_IDENTITY: cc896de04a21dcf2f41b99f2034d88ca46438320; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp05-project-deadline-truth.md
RELEASE_CHANNEL: development: bounded reviewed universal SOLO correction, normal release after required checks
RELEASE_CLASSIFICATION: internal-only: prelaunch correctness increment, not complete Experience acceptance
CUSTOMER_RELEASE_IDENTITY: none: integrated owner evaluation remains after full Experience delivery
RELEASE_NOTE_REQUIRED: no: bounded existing-source correctness repair
RELEASE_TRUTH_BOUNDARY: PARTIAL: source/local rendering verified, production and authenticated behavior remain PROOF OWED
RELEASE_RECOVERY: position=reviewed bounded frontend revert or forward correction without changing canonical records; reference=original Operations Projects contracts and this evidence

## Grounding, ownership and capability routing

ANT-21/51/52/147, the October19 Operations owner direction, existing EXP05 authority and original E5-CV1–9 remain controlling. Initial base0ebd48030439e72db61bc0552ed80c85bb6be1db; current main264687877f2b547e823dbe4c8ae955558a975691 checked before preparation. E09#2379 adds finance entitlement and workflow/docs tests, with no Operations source overlap. A read-only merge-tree composes cleanly. Migration frontier20271111030000 is preserved, with no new migration.

Owned paths are only `OperationsProjects.tsx` and its existing test plus this delivery evidence. Original EXP05#2163/#2189, Work editors, weekly save, E04 delivery and E08 people authority remain unchanged. Fresh open-file inspection found neither#2161 nor#2153 changes Projects. Full prior-lead/receiving-lead handoff is not claimed. Independent Overview#2383 is a separate release and has no overlapping source file.

REPAIR existing derived output; REUSE `workDateLabel`, native Planning project/milestone reads and native inspection. No new capability registration, provider, job, risk class, approval, store, scheduler, Binding Ledger promotion, Integration Registry or Harness contract change. `planning.list` and native Operations resource authority remain canonical. Existing records and normal future provisioning receive the same shared code; this source test is not a new-account authenticated acceptance claim.

## Root cause and tests

Projects reused its civil-date formatter for milestone instants, taking the ISO date part and constructing local noon. Work/inspector render the actual instant, so offsets near midnight produced inconsistent days. Reuse the existing Work formatter for milestones; leave project starts_on/ends_on civil-date formatting intact.

The overdue aggregate also counted a reminder's legacy due_at. Exclude reminder work from this task/milestone deadline count, matching the established Work/Overview semantics. Never alter the reminder record or confuse scheduled time with execution/delivery.

The original Projects suite now has4 tests, including two parameterized extreme-offset cases. Neighbor suites cover native identity/tenant refusal, ordinary task deadlines, reminders and Work projection. All29 assertions passed under existing isolated unit backend/network guards. No baseline was widened and no business effect was retried.

## Render and review limitations

The build manifest records the actual compiled SoloApp, shared shell, route, Workspace, Projects and original inspectors, all3740 inputs, mocked source hooks and no-effect boundary. Neutral synthetic contexts A/dark and B/light are not real customer accounts. Screenshots retain native pixels; all nineteen hashes are distinct. At390px the unchanged inspector is vertically scrollable; no claim is made that this small logic correction resolves all phone usability. Original missing activity remains visibly unavailable in the fixture, not receipt proof. Viewport override was reset.

Source review receipt9019aacb8f78a3ef8e291c52b6cda2c6552322c62df9d075e0f6429a7301d50e covers cc896de0 and independently repeated29 tests. Final evidence/visual composition review is required before release. Required exact-head CI, actual web readback and authenticated source comparison remain outstanding here. Strict restoration accounting stays1/18 capabilities and2/50 observations, with all18/25/50 entries preserved. No separate Live or owner acceptance is inferred.
