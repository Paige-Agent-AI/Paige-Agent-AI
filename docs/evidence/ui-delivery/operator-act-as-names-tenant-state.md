# UI delivery evidence: the act-as names the tenant's account state

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read for this milestone; flow is a platform operator entering a tenant from the Fleet directory and working inside it until Exit
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and routed references read, plus Impeccable SKILL, operate and craft-floor, for the state pill beside Exit and the arrival notice wording
MATERIAL_FLOW_CHANGE: NO: no state, transition or exit changes; entering and exiting work as before, and the header gains a read-only label naming the account state
FLOW_PROTOTYPE: PASS: rendered frames of the real shell header (1366 and 390, light and dark, canceled and trial, plus the arrival notice) sent to the owner and held for approval before merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a super_admin or platform_admin acting as a tenant in any account state; the primary action is knowing, for as long as they stand in it, that the account is canceled, suspended, past due or on trial
VISUAL_DIRECTION: PASS: one StatePill beside Exit using the Fleet directory's own tone for the state (critical to error, warn to warning, notice to pending, neutral to off); no gold; nothing shown for an active account
AUTOMATED_EVIDENCE: PASS: WorkspaceExitControl.test.tsx (active shows no label; canceled reads "This workspace is Canceled" beside Exit; trial reads "This workspace is Trial") and FleetConsoleEnter.test.tsx (the arrival notice names Canceled) fail on main and pass here; src/components/auth and src/operator/surfaces 195 passed
STATIC_EVIDENCE: PASS: ci:tsc 12/12 baseline; eslint clean on the changed files
RENDERED_EVIDENCE: PASS: harness frames of the real tenant shell header; sha256 prefixes shell-light-1366-canceled 4d494a851afe, shell-dark-1366-canceled be3ae202d8c9, shell-light-1366-trial 65acd8868f9b, shell-dark-1366-trial 1fca92414b5b, shell-light-1366-notice 6eae07a5c611, shell-dark-1366-notice 39c5f4c09fc3, shell-light-390-canceled 974b570b8d18, shell-dark-390-canceled f912d9e7a089, shell-light-390-trial 24101d3db94f, shell-dark-390-trial 1e990f1a2c62; no page errors and no horizontal overflow in any frame
BEHAVIORAL_EVIDENCE: UNVERIFIED: the label and notice are proven in unit tests and rendered frames; a live operator session inside a canceled tenant has not been driven
AUTHENTICATED_RUNTIME: UNVERIFIED: requires a human operator session on production after deploy
KEYBOARD_FOCUS: PASS: measured in the real shell at 1366: the label contains no focusable element, Tab reaches Exit, and the label's text for assistive technology is "This workspace is Canceled"; the label is not focusable; Exit keeps its place and its accessible name "Stop acting as {tenant} and return to the platform", which never shortens
ZOOM_REFLOW: PASS: 200% zoom equivalent (1366x768 at device scale 2, a 683x384 CSS viewport) in the real Solo shell: the label and a shortened Exit sit without overlap or horizontal overflow (frame b5856cb8ae16); with PAIGE open at this width the header is under PAIGE's overlay, as at 1024 and 900
REDUCED_MOTION: NOT_APPLICABLE: no motion added
STATE_COVERAGE: PASS: active shows nothing; trial, past due, suspended and canceled each show their Fleet label; unknown status shows nothing; the arrival notice reads "Acting as {tenant} · {state}." for a non-active account and "Acting as {tenant}." otherwise
TRUTHFUL_STATE_LABELS: PASS: the words and tone come from tenantStatusNote and STATUS_META in src/lib/platform/tenantLifecycle.ts, the same source the Fleet directory rows now read, and the status comes from the tenant already loaded by useTenantContext; no second lookup
SOLO_UI: YES: src/components/tenant-shell/tenant-command-center-shell.css and the exit control in the shared tenant shell header that Solo renders while an operator acts as a tenant
SOLO_1536X770_PAIGE_CLOSED: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 493867d74c68 and a different tenant on trial (dark) frame be4eb6991102; PAIGE folded; the state label and Exit tenant are the top elements at their centres (uncovered), do not overlap, stay inside the viewport; no horizontal overflow
SOLO_1536X770_PAIGE_OPEN: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 4d40f62f9aa0 and a different tenant on trial (dark) frame 7941086872e4; PAIGE docked beside the workspace; the state label and Exit tenant are uncovered, do not overlap, stay inside the viewport; the command field keeps 180px or more; no horizontal overflow
SOLO_1366X768_PAIGE_CLOSED: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 7966a3ae460e and a different tenant on trial (dark) frame 77db629132d2; PAIGE folded; the state label and Exit tenant are the top elements at their centres (uncovered), do not overlap, stay inside the viewport; no horizontal overflow
SOLO_1366X768_PAIGE_OPEN: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 7e99734bb5d6 and a different tenant on trial (dark) frame 33117cc270ad; PAIGE docked beside the workspace; the state label and Exit tenant are uncovered, do not overlap, stay inside the viewport; the command field keeps 180px or more; no horizontal overflow
SOLO_1024X768_PAIGE_CLOSED: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 23989bdd93ab and a different tenant on trial (dark) frame 994560d4e71a; PAIGE folded; the state label and Exit tenant are the top elements at their centres (uncovered), do not overlap, stay inside the viewport; no horizontal overflow
SOLO_1024X768_PAIGE_OPEN: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame b534765b5b53 and a different tenant on trial (dark) frame 39ff00838327; at this width PAIGE opens as an overlay over the whole workspace, as it did before this PR, so the header (the state label and Exit tenant with it) sits under PAIGE's backdrop (measured: neither is the top element at its centre) until PAIGE is folded; laid out without overlap or overflow underneath; raised to the owner as a design question, not changed here
SOLO_900X1000_PAIGE_CLOSED: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame b301935c7e55 and a different tenant on trial (dark) frame 8f9e454f4c91; PAIGE folded; the state label and Exit tenant are the top elements at their centres (uncovered), do not overlap, stay inside the viewport; no horizontal overflow
SOLO_900X1000_PAIGE_OPEN: PASS: real Solo shell with the real SoloPaigeWorkspace (harness client, fixed demo data), operator acting; relevant tenant canceled (light) frame 97415564105d and a different tenant on trial (dark) frame 8b7491c0f760; at this width PAIGE opens as an overlay over the whole workspace, as it did before this PR, so the header (the state label and Exit tenant with it) sits under PAIGE's backdrop (measured: neither is the top element at its centre) until PAIGE is folded; laid out without overlap or overflow underneath; raised to the owner as a design question, not changed here
UNVERIFIED: a live operator session inside a canceled tenant after deploy; owed with the remaining live-drive items. OPEN DESIGN QUESTION (owner): at widths where PAIGE overlays the workspace (1024, 900, 200% zoom), the state is hidden while PAIGE is open, because the whole header is under PAIGE's overlay; showing the state inside the PAIGE panel header at those widths is proposed, not built.

OWNER_INTENT: owner ruling 2026-09-28: an operator may act as a tenant in any account state, and the act-as must name the state ("Acting as {tenant} · canceled"), read from the same source the Fleet directory reads
MUST_NOT_HAPPEN: a second status lookup; a state label on an active account; gold spent on a state; the Exit control's accessible name shortened
MUST_PRESERVE: entering and exiting behaviour; the Fleet directory's row wording (now from the shared helper)
ACCEPTANCE_CRITERIA: inside a canceled or trial tenant the header names the state beside Exit, and the arrival notice names it
MOTION_PURPOSE: NONE: no motion added
PROTECTED_SEAMS: exitOperatorActAsFrom and the exit paths are untouched; Fleet's statusNote moved to tenantLifecycle unchanged in wording

INTERNAL_BUILD_IDENTITY: b31feb43b0563afdf5c32150adcbdcd018cf7d97; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here holds this PR's code and tests
RELEASE_CHANNEL: development: operator act-as clarity, held for the owner's frames approval, then merged on green per CLAUDE.md §4
RELEASE_CLASSIFICATION: internal-only: operator view only; no tenant member sees the label
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: owner frames approval and a live operator session after deploy
RELEASE_RECOVERY: position=revert the merge (frontend only, no migration); reference=this PR

## Scope and collisions

- Classification: operator act-as clarity (owner ruling 2026-09-28).
- Affected flows: entering a tenant from Fleet; standing in it; the Exit control.
- Active-owner/file collisions: #1520 (held) carries its own act-as band and gets the same label once it is rebased; #1554 and #1556 touch none of these files.
- Explicit exclusions: "deleted" and "archived" are not tenant status values in production; their data-retention meaning is recorded as an open question, not investigated.

## Evidence index

- `npx vitest run src/components/auth src/operator/surfaces` → 195 passed (the four new cases red on main).
- `npm run ci:tsc` → 12/12.
