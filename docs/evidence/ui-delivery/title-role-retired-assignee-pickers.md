# UI delivery evidence: title-role-retired-assignee-pickers

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are a signed-in staff member picking an owner while creating a contact, creating or editing a deal, filtering and assigning contacts, and reassigning a departing member's clients, where the pickers listed people because they held the retired coach role (coach removal, slice 1b app 5b)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change replaces the data source behind existing Select menus with no token, layout, copy or motion change
MATERIAL_FLOW_CHANGE: NO: the pickers keep their controls and labels; the people offered change from "everyone the caller could see holding the retired role" to "the admins of the caller's own workspace", read through the existing get_tenant_assignable_members roster; under the old query RLS already limited the retired-role read to the caller's own row for anyone but the platform owner
FLOW_PROTOTYPE: NOT_REQUIRED: no visible interaction, layout or copy change; the only text that could change is a fallback name for a person with no profile name ("Unnamed member" instead of "Unnamed Coach" or "Coach")
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: staff hand contacts, deals and client books to a workspace admin; who may own work comes from the admin role inside the workspace, never a title
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: src/lib/auth/titleRoleRetiredFromAssigneePickers.test.ts asserts the shared helper offers only admins from the roster (a retired-role-only row is not offered) and that none of the seven pickers lists people by the retired role; both tests fail on main (all seven pickers flagged) and pass after; whole vitest suite 0 failures
STATIC_EVIDENCE: PASS: tsc baseline did not grow; eslint clean on every changed file (pre-existing untyped values in NewDealDialog and ReassignCoachDialog are typed); Impeccable detect clean on the changed UI files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered layout or style changes
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session; the roster RPC is server-scoped to the caller's workspace and was already in use by the Conversations rail and the relationships contact editor
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: roster loaded (admins offered), roster empty or unreadable (empty picker with a console warning, as before when no one qualified), and the reassign dialog excluding the member being reassigned from
TRUTHFUL_STATE_LABELS: PASS: a person with no profile name reads "Unnamed member", not a role they may not hold
SOLO_UI: NO: these are the admin contact, pipeline and team dialogs; no Solo surface changes
UNVERIFIED: authenticated browser behavior of the seven pickers against a live workspace, because this environment has no authenticated session

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a title describes, it never authorizes
MUST_NOT_HAPPEN: a person offered as an assignee because they hold the retired role; any picker listing people from another workspace
MUST_PRESERVE: the pickers' controls, labels and the "me" and "unassigned" choices; admins remain assignable
ACCEPTANCE_CRITERIA: every assignee picker reads the workspace roster through loadAssignableStaff and offers admins only
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: server-side assignment guards are unchanged by this PR (retired in 20270503000000 and 20270504000000); get_tenant_assignable_members is reused, not changed

INTERNAL_BUILD_IDENTITY: b0bd036a20e495fdbfba37052b14b0a5e5d69c63; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=PR verify run on the red commit (this SHA) and on the fix head
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening with no customer-visible change
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only, no visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level behavior proven in CI; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert of the app commit, since no data or schema changes; reference=this PR

## Scope and collisions

- Classification: coach removal, slice 1b, app code part 5b (assignee pickers).
- Affected flows: new contact, contact detail, contacts list filter, new deal, deal drawer, pipeline board, reassign clients.
- Neighboring regressions: the Conversations rail and relationships contact editor already read the same roster and are unchanged here.
- Active-owner/file collisions: none known.
- Explicit exclusions: invite and role-grant selects and coach revoke flows (grant paths, slice 3); credit and funding screens (slice 2).

## User job and state map

A staff member picks an owner from the admins of their own workspace. A person holding only the retired role is not offered.

## Evidence index

- `src/lib/auth/titleRoleRetiredFromAssigneePickers.test.ts`.
- `src/lib/team/assignableStaff.ts` (the one home for assignee pickers).
- Red run: the PR's first commit, `verify` (Test step, the new tests only).

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment. The change narrows who is offered and scopes the list to the caller's workspace.
