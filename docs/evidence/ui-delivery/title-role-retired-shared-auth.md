# UI delivery evidence: title-role-retired-shared-auth

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are a signed-in person reaching staff surfaces (landing, navigation, settings tabs, planning staff view, plan bypass, feedback and contribution controls) where the retired coach role used to count as staff (coach removal, slice 1b app 1/6, PR 1508)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change removes a role from permission checks only, with no visual, copy, token, layout or motion change for any account that exists
MATERIAL_FLOW_CHANGE: NO: for every person on production the flows are unchanged, because the 4 holders of the retired role all hold admin; a person holding only that role would now follow the client path (client landing, client navigation, no staff tabs), which is the ruled outcome, not a new flow
FLOW_PROTOTYPE: NOT_REQUIRED: no visible interaction, layout or copy change; the only label affected ("Coach" in the navigation role label) is reachable only by a person holding the retired role without admin, and no such person exists
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: staff and clients reaching their own surfaces; staff standing now comes from the admin role and platform roles only, never from a title
VISUAL_DIRECTION: NOT_APPLICABLE: no markup, style, token or copy change for any existing account
AUTOMATED_EVIDENCE: PASS: src/lib/auth/titleRoleRetiredFromApp.test.ts asserts the retired role gives no staff standing, chooses no command-center view (falls back to the read-only viewer), and is read by none of the staff checks; all 3 fail on 59d9684 before the change (CI verify red) and pass after; whole vitest suite 0 failures before and after (5813 and 5816 tests)
STATIC_EVIDENCE: PASS: tsc error set identical to main; eslint clean on every changed file (pre-existing untyped values in the touched files are typed)
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes for any existing account
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session; behavior proven by the unit test and by the role data on production (every holder of the retired role is an admin)
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: admin, platform and client states unchanged; the retired-role-only state now resolves as a client, which the server already enforced for data access
TRUTHFUL_STATE_LABELS: PASS: the navigation role label no longer calls a person "Coach" because of a platform role; it reads Admin or Client
SOLO_UI: NO: Solo settings mocks updated only to drop the removed flag; no Solo surface changes behavior
UNVERIFIED: authenticated browser behavior for a person holding only the retired role, because none exists on production and no test account holds it

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a title describes, it never authorizes
MUST_NOT_HAPPEN: a person gaining or keeping staff surfaces, a plan bypass or a staff landing through the retired role; any existing admin or client losing a surface
MUST_PRESERVE: admin and platform staff surfaces, client surfaces, saved dashboard mode preferences
ACCEPTANCE_CRITERIA: isStaff is admin-only; no shared auth hook, context, guard or redirect reads the retired role; the command-center registry maps no view to it
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: server-side authorization is unchanged by this PR (policies and functions were retired in 20270502000000, 20270503000000 and 20270504000000)

INTERNAL_BUILD_IDENTITY: 8d734378d1925039242553da92db59742ddb333f; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=PR 1508 verify run on 59d9684 (red) and on the fix head (green)
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening with no customer-visible change
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only, no visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level behavior proven in CI; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert of the app commit, since no data or schema changes; reference=PR 1508

## Scope and collisions

- Classification: coach removal, slice 1b, app code part 1 of 6 (shared auth hooks and contexts).
- Affected flows: signing in and landing; navigation role label and staff menu entries; settings tabs; planning staff view; plan bypass; Paige feedback buttons; contribution filing.
- Neighboring regressions: Solo settings tests (mocks updated), command-center persona resolution.
- Active-owner/file collisions: none known.
- Explicit exclusions: comms, studio, Paige chat, CRM and team frontend, and the credit and funding surfaces follow in their own PRs; grant paths are the next slice.

## User job and state map

An admin reaches staff surfaces as before. A client reaches client surfaces as before. A person holding only the retired role is treated as a client everywhere in the shared hooks and contexts. No such person exists on production.

## Evidence index

- `src/lib/auth/titleRoleRetiredFromApp.test.ts`.
- Red run: commit `59d9684`, `verify` (Test step, the 3 new tests only).
- Whole-suite comparison against main in a separate worktree: 0 failures on both sides.

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment. The change narrows access only, and the server already refuses the retired role.
