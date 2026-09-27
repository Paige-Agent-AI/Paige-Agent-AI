# UI delivery evidence: operator-act-as-lands-or-not-at-all

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this milestone's session and followed; mode Bug fix on an existing flow, Standard depth (audited authority act, permission-sensitive routing); actor-goal flow "a platform operator at either tier enters a customer's tenant from Fleet → Directory, works inside it, and leaves", traced end to end across every gate on /solo, /business and /agency (file:line trace in the PR); defect reported by the owner with screenshots 2026-09-27
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read for this milestone; Impeccable applied to the one new control: the first render put "Exit tenant" and "Switch workspace" side by side with the same icon at the same weight, which read as two doors to one place; Exit now carries its own return mark (CornerUpLeft), re-rendered in both themes
MATERIAL_FLOW_CHANGE: YES: Enter now lands the operator in the tenant's own workspace (Solo or sub-account) after the audited enter, or refuses before anything is recorded (agency, enterprise, unresolvable address); a new exit transition inside those shells ends the act-as through the audited operator_exit_tenant and returns to Fleet → Directory
FLOW_PROTOTYPE: WAIVED: owner-decision=coordinator defect ruling 2026-09-27 "act-as enters on the server but never enters in the app — Blocking", relaying Antonio's report with screenshots; reason=the owner ruled the changed flow itself as a blocking defect to be fixed in this lane (the act-as must complete on both sides or on neither, and an operator inside a tenant must always have a visible way out), so the flow is ruled and the frames below are the review surface
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator (super_admin or platform_admin) supporting one customer; job is to enter that customer's workspace with their name on the audit row, do the work, and leave; primary actions are Enter (directory) and Exit tenant (tenant header)
VISUAL_DIRECTION: PASS: Exit tenant reuses the exact control the tenant header already carries (Button variant="outline" size="sm", the same slot as Switch workspace), token-only, no gold (the act is leaving, not approving), a distinct return icon; nothing else visible changes
AUTOMATED_EVIDENCE: PASS: full vitest on the change 415 files / 5885 tests passed (2 skipped); main at the same moment 413 / 5867 passed, no failures on either side (separate worktree). New tests, each red on the old code: FleetConsoleEnter.test.tsx 3 of 4 fail on main (no landing, agency entry recorded, three presses record three entries; the refused-by-server case passes both ways because neither version navigated); WorkspaceExitControl.test.tsx operator cases 3 of 4 fail on main (the guard case passes vacuously there because no exit existed); RequireSoloBetaEntitlement.test.tsx operator case fails on main (sent to checkout recovery); actAs.test.ts pins the landing rule for every account type and the sub-account shell's exit (structural pin, see limitations)
STATIC_EVIDENCE: PASS: ci:tsc no new type errors (12/12); eslint on every changed file clean; lint:tier-features, lint:operator-reach, lint:user-facing-admin-urls, lint:shadow-vars, lint:title-authority, lint:views, lint:definer-fns clean; lint:gold fails on origin/main at src/components/dashboard/BusinessCreditDashboard.tsx:271, a file this change does not touch
RENDERED_EVIDENCE: PASS: local harness render of the real WorkspaceExitControl in a tenant-header strip (stubbed context, neutral fixtures), 900px, light and dark, states acting / leaving / member; no page errors; all controls 36px high; frames scripts/live-drive/artifacts/exit-control/exit-{light,dark}-{acting,leaving,member}.png (gitignored), sha256 prefixes light-acting 6293ffc696b14413, dark-acting 321971f997fc6f1b, light-leaving cc660d8ed1fe8eb6, dark-leaving 8c39850b4efc4766, light-member 3207a2ed9d905e35, dark-member b185f38808192947
BEHAVIORAL_EVIDENCE: UNVERIFIED: the enter → land → exit journey is proven against doubles in jsdom and by the route-gate trace, not by a browser drive of the running app; owed after deploy by a human operator session at each tier
AUTHENTICATED_RUNTIME: UNVERIFIED: requires deploy; owed to human sessions — platform_admin and super_admin each press Enter on a Solo tenant and on a sub-account and land in its workspace, press Exit tenant and return to Fleet → Directory; press Enter on an agency and see the refusal with no operator.tenant.enter row written; production readback of one enter row and one exit row per session
KEYBOARD_FOCUS: PASS: Exit tenant is a native button in the header's tab order beside Switch workspace, with the shell's focus ring; it is disabled while the exit is in flight so a second Enter key press cannot run a second exit
ZOOM_REFLOW: PASS: the control adds one button to an existing flex row that already wraps; no layout or width change to either shell
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: directory — landable (enter then land), not landable (refused, nothing recorded), server refused (stays, says so), in flight (further presses ignored); tenant header — operator acting (Exit tenant + Switch workspace), leaving (Exit disabled, "Leaving…"), exit refused (stays, still acting, says so), unsaved-work guard refuses (no exit), member (Switch workspace only), operator at rest (no Exit)
TRUTHFUL_STATE_LABELS: PASS: the Enter toast "Acting as … recorded" is gone, because the operator now lands in the tenant instead of being told so; refusals say "Nothing was entered"; the exit failure says "You are still acting as this tenant"
SOLO_UI: NO: the Solo owner's interface is unchanged; the one new control renders in the Solo header only for a platform operator acting in that tenant, beside the Switch workspace it already shows staff, and no Solo route, layout or owner-visible element changes
UNVERIFIED: the authenticated journey at both operator tiers after deploy; the in-shell placement of Exit tenant (rendered here in a header strip, not inside the full Solo and sub-account shells); the sub-account shell's wiring is a source-level pin, not a render

OWNER_INTENT: coordinator defect ruling 2026-09-27 relaying Antonio: "an act-as must either complete on both sides or on neither, and an operator inside a tenant must always have a visible way out"; the platform must never record operator access that did not occur
MUST_NOT_HAPPEN: an operator.tenant.enter row for a tenant the operator never reaches; an operator stranded inside a tenant with no control that ends the act-as; a member's Switch workspace removed or changed; any change to what the server authorises (no RPC, policy or migration changes)
MUST_PRESERVE: Switch workspace for members and staff exactly as before (staff's only in-app route to their own workspaces); the unsaved-work guard before leaving; the audited operator_enter_tenant / operator_exit_tenant as the only act-as seams; the agency shell's refusal of operators (not reopened here)
ACCEPTANCE_CRITERIA: an operator presses Enter on a Solo tenant or a sub-account and arrives in its workspace; presses Exit tenant and is back on Fleet → Directory with an operator.tenant.exit row recorded; presses Enter on an agency and is told it can't be entered, with no row recorded
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: WorkspaceExitControl member behavior (existing 11 cases green); RequireSoloBetaEntitlement owner behavior (existing 7 cases green); scopeIsNotNavigation narrowed to exactly one module, with a test that the exception is a single navigate; AgencyApp agency mode untouched (operators never mount it); TenantRouteOwnerAccountContext and BusinessEntry suites green in the full run

INTERNAL_BUILD_IDENTITY: a72a44b26ed7f7f32a733a9b52fba1b0407ada46; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here (tree c1dad96e92e013c084b959f76807db29df07851f) is the final code; the full-suite run above was on 020d00850, which differs from it only by the Exit icon, after which the affected suites (41 tests) were re-run green; the commit after it changes only this record
RELEASE_CHANNEL: development: blocking defect fix, merged on green per §4 pre-launch stance
RELEASE_CLASSIFICATION: internal-only: operator act-as routing and the operator's exit inside tenant shells
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated enter / land / exit at both operator tiers after deploy
RELEASE_RECOVERY: position=revert the merge commit, frontend only with no data change; reference=this PR

## Scope and collisions
- Classification: bug fix, frontend only.
- Affected flows: operator Enter from Fleet → Directory; operator exit from the Solo and sub-account shells; operator entry into a Solo Beta workspace.
- Neighboring regressions: member and staff Switch workspace (kept); unsaved-work guard (kept); agency acting-as-a-sub-account flow in AgencyApp (untouched).
- Active-owner/file collisions: #1520 (A1, the console scope band) also edits FleetConsole's Enter with an in-flight guard; it is held for owner design approval and will take this change on merge.
- Explicit exclusions: entering agency and enterprise tenants (their shell assumes an agency manager); an automatic exit row when an operator enters over an open act-as (an audit-contract change, needs its own ruling); the console scope band (#1520).

## User job and state map
An operator enters one customer's workspace to support it, with their name on the audit row, and leaves. States are listed under STATE_COVERAGE. Exits: Exit tenant (audited, to the console) and Switch workspace (to the chooser). Side effects: one audit row on enter, one on exit. Scroll owner unchanged.

## Evidence index
- Route-gate trace, 2026-09-27: /solo mounts for an acting operator unless the tenant is Solo Beta-marked; /business mounts, with "Back to {agency}" as its only control; /agency sends every operator to /operator/fleet/directory.
- Production (read-only), 2026-09-27: operator.tenant.enter rows at 16:51:22Z and 16:51:23Z (platform_admin, agency) and 21:45:26Z (platform_admin, standalone), no exit rows; the pointer moved from the agency to the standalone with no exit recorded between.
- Frames and commands under RENDERED_EVIDENCE and AUTOMATED_EVIDENCE.

## Review and limitations
- The sub-account shell's exit is pinned by source text, in the style of the existing ownership suite, because AgencyApp is not rendered in unit tests.
- The directory no longer shows the "Acting as" toast; landing in the tenant replaces it.
- Every UNVERIFIED item above is owed to a human session after deploy.
