# UI delivery evidence: title-role-read-nowhere

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are an admin filtering the Solo team roster by permission and reading the Roles & access view, a person choosing which account to enter, PAIGE describing a person's seat in chat, and staff reading another person's name through the staff name projection
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change removes one option from an existing filter and one branch from an existing label, with no token, layout or motion change
MATERIAL_FLOW_CHANGE: NO: every screen keeps its controls, states and exits; the Solo team permission filter loses the retired option, the Roles & access view loses the note that described it, and the account chooser no longer relabels a seat that can no longer be stored
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction, layout or state; one option is removed from an existing filter
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an admin filters the team by the permissions that exist; a title given to a person is never one of them
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: scripts/ci/title-authority-guard.mjs self-test on this SHA (78 mutations caught, 18 controls quiet; 25 of the mutations for R7) red on b645db6fc06907f20c744ea529d2ba6cbd9a7379 and green after; supabase/tests/title_role_read_nowhere.sql (19 assertions) red on the same commit only where intended (the staff name projection, and a deparsed view shape the first search missed, since fixed), searching the rebuilt database's live catalogue with the same pattern R7 uses, which the guard requires verbatim; the one pattern gives identical results in JavaScript and Postgres on 48 samples plus the permission-alias sample, and finds nothing on production outside the named exemptions and the two objects this PR's migration fixes; the Solo test files pass (132 files, 2114 tests); whole vitest suite 413 files, 5869 tests, 0 failures
STATIC_EVIDENCE: PASS: lint:title-authority (R0–R7) green on the real tree; lint:views, lint:migration-versions, lint:managed-schema and lint:definer-fns green; eslint clean on every changed src file; Impeccable detect clean on every changed UI file
RENDERED_EVIDENCE: NOT_APPLICABLE: no layout or style changes; the only visible differences are one fewer option in the Solo team permission filter and one fewer note under the Roles & access cards
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: filter opened with each remaining permission and with all permissions; account chooser showing an owner, an admin and any other seat, which is shown as stored
TRUTHFUL_STATE_LABELS: PASS: no screen or PAIGE sentence describes the title as a seat or a permission
SOLO_UI: YES: the Solo team workspace permission filter loses its retired option and the Roles & access view loses the note describing it; nothing else in Solo changes
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the filter loses one option and nothing else changes
UNVERIFIED: authenticated browser behavior of the Solo team filter and the account chooser, because this environment has no authenticated session

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a business may still give a person the title, which describes and never authorizes
MUST_NOT_HAPPEN: any permission, policy, view, screen or PAIGE sentence reading or offering the retired title role as a role or seat
MUST_PRESERVE: every other permission option and label; the staff name projection's other branches (self, platform owner, admins of the person's business, the person's assigned staff member); the value used as data (conversation lens, assignment seat label, affiliate tier)
ACCEPTANCE_CRITERIA: lint:title-authority R7 and title_role_read_nowhere.sql are green, and production shows no reader outside the named refusals and removal paths
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: map_tenant_role_to_app_role keeps every seat a membership may hold (owner and admin to admin, member to user) and loses only the branch for the forbidden seat; the refusals in accept_invitation, change_user_role and grant_tenant_member_role are kept; the removal paths (admin_remove_coach_role, revoke_platform_access, revoke_tenant_member_role, the remove_coach_role tool) are exempt until the last rows holding the value are deleted; no denial-letter or business-certification policy is touched

INTERNAL_BUILD_IDENTITY: 6e30dd3c32f68ce2e358c6c7691602c2076ab184; deployment=none; environment=development; migrations=PROOF_OWED(20270509000000_nothing_reads_the_retired_title_role applies on merge through deploy-migrations.yml and is checked after merge); edge=PROOF_OWED(paige-ai-chat and the functions importing _shared/paige-spine deploy on merge through deploy-edge-functions.yml and are checked after merge); evidence=PR verify run on the implementation head (this SHA), red run on b645db6fc06907f20c744ea529d2ba6cbd9a7379
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening; the visible change is one fewer option in the Solo team permission filter
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level and catalogue-level behavior proven in CI; migration and edge deploys confirmed after merge; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert, since no data changes and the migration only redefines a view's WHERE clause and one mapping function; reference=this PR

## Scope and collisions

- Classification: coach removal, slice 4b (the broad check that no permission reads the retired role).
- Affected flows: filter the Solo team roster by permission, choose an account, PAIGE describing a person's seat, staff reading another person's name.
- Neighboring regressions: the staff name projection keeps every branch but the retired one; assigned staff still see their clients' names through the assignment branch.
- Active-owner/file collisions: none known.
- Explicit exclusions: the removal paths and their tool, which go with the last rows holding the value (slice 5).

## User job and state map

An admin filters their team by the permissions that exist. A person entering an account sees their seat as it is stored. PAIGE describes a person's seat from the seats that exist.

## Evidence index

- `scripts/ci/title-authority-guard.mjs` (R7) and `scripts/ci/title-authority-baseline.json`.
- `supabase/tests/title_role_read_nowhere.sql`.
- Red run: `verify` on b645db6fc06907f20c744ea529d2ba6cbd9a7379.

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment. R7's TypeScript half does not see a JSX option whose role word sits on its enclosing element; the database check does not depend on it.
