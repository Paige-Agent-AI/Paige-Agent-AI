# UI delivery evidence: title-role-retired-client-screens

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are a signed-in person creating or editing a contact in the relationships workspace, reaching the team floor and managing presence, seeing the team split in the client dashboard, picking an assignee for a contact or a support ticket, and reading the Solo shell's Owner/Team label, where the retired coach role used to count as staff (coach removal, slice 1b app 5a)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change removes a role from permission checks and one derived label, and replaces one loading spinner, with no token, layout or motion change
MATERIAL_FLOW_CHANGE: NO: for every person on production the flows are unchanged, because the 4 holders of the retired role all hold admin; a person holding only that role would now see the relationships workspace read-only, would not reach the team floor through the role, and would not be offered as an assignee, which is the ruled outcome
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction, layout or copy; the removed text ("N Coach" in the team KPI subtitle, "Unnamed coach" as a fallback name) could only render for holders of the retired role
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: staff act on contacts, assignments and the team floor; standing comes from the admin role, the platform roles and the other operating roles, never from a title
VISUAL_DIRECTION: PASS: one style change only, in the client dashboard's loading state: the hand-rolled border spinner (border-b-2 on a rounded element, which Impeccable flags as an accent border on a rounded card) becomes the platform's Loader2 icon spinner in the primary color; same size and position
AUTOMATED_EVIDENCE: PASS: src/lib/auth/titleRoleRetiredFromClientScreens.test.ts asserts none of the gates, staff checks, assignee filters or the shell label reads the retired role, and that the Solo shell names a non-owner a member; both tests fail on main before the change and pass after; Solo shell and tenant-shell ownership tests updated to the member label; whole vitest suite 0 failures
STATIC_EVIDENCE: PASS: tsc baseline did not grow; eslint clean on every changed file (pre-existing untyped values in AdminTicketPanel are typed); Impeccable detect clean on the changed UI files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes for any existing account apart from the loading spinner's drawing
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session; behavior proven by the unit tests and by the role data on production (every holder of the retired role is an admin)
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: PASS: the replacement spinner uses the same animate-spin utility the platform's other loaders use
STATE_COVERAGE: PASS: admin, platform, operating-role and client states unchanged; the retired-role-only state resolves as read-only and unassignable
TRUTHFUL_STATE_LABELS: PASS: the Solo shell's non-owner label value is now member; the visible text stays "Team workspace"
SOLO_UI: YES: the Solo shell role label and the relationships workspace used in Solo change as described; no Solo layout or copy changes
UNVERIFIED: authenticated browser behavior for a person holding only the retired role, because none exists on production and no test account holds it

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a title describes, it never authorizes
MUST_NOT_HAPPEN: a person gaining contact write, team-floor access, presence management or assignability through the retired role; any existing admin or operating-role holder losing a surface
MUST_PRESERVE: admin, platform and operating-role access; the Owner/Team label behavior, including the account-switch rule
ACCEPTANCE_CRITERIA: no gate, staff check, assignee filter or shell label in these screens reads the retired role
MOTION_PURPOSE: NONE: the spinner keeps its existing loading purpose
PROTECTED_SEAMS: server-side authorization is unchanged by this PR (policies and functions were retired in 20270502000000, 20270503000000 and 20270504000000)

INTERNAL_BUILD_IDENTITY: pending-head; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=PR verify runs on the red commit and on the fix head
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening with no customer-visible change beyond the spinner drawing
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only, no visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level behavior proven in CI; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert of the app commit, since no data or schema changes; reference=this PR

## Scope and collisions

- Classification: coach removal, slice 1b, app code part 5a (client, team and relationship screens: gates only).
- Affected flows: contact create and edit in the relationships workspace; team floor access and presence management; the client dashboard's team split and fallback names; contact and support-ticket assignee pickers; the Solo shell's Owner/Team label.
- Neighboring regressions: Solo shell label tests, tenant-shell ownership test.
- Active-owner/file collisions: none known.
- Explicit exclusions: invite and role-grant selects, coach revoke flows and the member drawer's coaching fields (grant paths, slice 3); the global coach assignee lists in the admin contact and pipeline dialogs (part 5b); credit and funding screens (with slice 2).

## User job and state map

An admin creates and edits contacts, manages presence and assigns as before. A person holding only the retired role sees the relationships workspace read-only and is not offered as an assignee. No such person exists on production.

## Evidence index

- `src/lib/auth/titleRoleRetiredFromClientScreens.test.ts`.
- Red run: the PR's first commit, `verify` (Test step, the new tests only).
- Whole-suite run with the change: 0 failures.

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment. The change narrows access only, and the server already refuses the retired role.

A separate existing defect surfaced while typing AdminTicketPanel: its profile reads select `email`, which `profiles` does not have on production, so ticket assignee and requester names do not load. Not changed here; it is recorded for routing.
