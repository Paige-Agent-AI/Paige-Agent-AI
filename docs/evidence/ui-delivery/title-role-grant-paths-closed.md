# UI delivery evidence: title-role-grant-paths-closed

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are an admin reassigning a staff member's clients from Team settings, and a person accepting an invitation (no app or edge code calls accept_invitation, so that flow has no visible surface)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; no UI file changes, only the server answer a dialog shows
MATERIAL_FLOW_CHANGE: NO: the reassign dialog keeps its controls and its target list; the server now decides target eligibility by active membership of the admin's business instead of the retired role; the dialog shows the server error in a toast, so the refusal text an admin can see changes (it no longer names the retired role)
FLOW_PROTOTYPE: NOT_REQUIRED: no interaction, layout or copy change in the app
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an admin moves a staff member's clients to another member of the same business; holding the retired role neither qualifies nor disqualifies anyone
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: supabase/tests/title_role_grant_paths_closed.sql proves an outsider holding the retired role is refused as a reassignment and bulk-assignment target, an active member is assignable without it, invitations carrying it are refused, admins cannot change anyone to it, it maps to no seat, and it enrolls nobody as an affiliate; red on the test-only commit on real assertions for the mapping, role-change, affiliate and reassignment tests; the invitation test's first fixture set a token hash that the insert trigger overwrites, so its red and green were re-proven on production in a rolled-back transaction (before: accepted and granted the role; after: refused with 42501, nothing granted) and the fixture now inserts the plaintext token as a real invitation does; green on the implementation head
STATIC_EVIDENCE: PASS: no app code changes; tsc baseline did not grow; whole vitest suite 0 failures
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered layout or style changes
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: target is an active member (eligibility passes), target is not a member of the business (refused with an error toast), unassign (no target, unchanged)
TRUTHFUL_STATE_LABELS: PASS: the refusal names membership, which is the rule actually applied
SOLO_UI: NO: the reassign dialog lives in Team members and roles; no Solo surface changes
UNVERIFIED: a completed reassignment to an eligible member, because the function writes columns that do not exist and fails before and after this change (filed separately); authenticated browser behavior of the dialog, because this environment has no authenticated session

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a title describes, it never authorizes
MUST_NOT_HAPPEN: the retired role granted by an invitation, a role change, a seat sync or an affiliate enrollment; the role deciding who may be assigned clients
MUST_PRESERVE: admin and owner reassignment and bulk-assignment authority; function names, signatures and grants
ACCEPTANCE_CRITERIA: every grant path in this migration refuses or ignores the retired role, proven by the pgTAP file in the database contract job
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: grant_tenant_member_role is left to slice 4; no RLS policy changes; no denial-letter or business-certification policy is touched

INTERNAL_BUILD_IDENTITY: 999f01fb9710a88a61e02e3a12222495c5316d9a; deployment=none; environment=development; migrations=PROOF_OWED(20270506000000 applies on merge through deploy-migrations.yml, the schema_migrations row and function behavior are checked after merge); edge=NOT_APPLICABLE; evidence=PR database-contract run on the implementation head (this SHA, migration from f2af2d40252dbc610531efc5a4659f1b95a53c6c and corrected fixture), red run on cf08c04290390fa67864ac50851dbdbd29cb4629
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening; the only visible change is the text of a refusal toast
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: database behavior proven in CI and by a rolled-back production run; production apply confirmed after merge; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix, since the migration replaces function bodies only and changes no data; reference=this PR

## Scope and collisions

- Classification: coach removal, slice 3a (database grant paths).
- Affected flows: Team members and roles, reassign a staff member's clients; invitation acceptance (no caller).
- Neighboring regressions: bulk assignment keeps admin authority and now requires the target to be an active member of the admin's business.
- Active-owner/file collisions: none known.
- Explicit exclusions: grant_tenant_member_role (slice 4); app and edge grant paths (slice 3b).

## User job and state map

An admin opens Reassign on a staff member, picks another member or unassign, and submits. A target outside the business is refused with a toast.

## Evidence index

- `supabase/tests/title_role_grant_paths_closed.sql`.
- Red run: the PR's test-only commits, `database-contract`.

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment. A completed reassignment is `UNVERIFIED` because the function's write step fails before and after this change; that defect is filed separately.
