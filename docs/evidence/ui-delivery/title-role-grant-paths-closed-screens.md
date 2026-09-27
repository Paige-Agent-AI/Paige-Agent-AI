# UI delivery evidence: title-role-grant-paths-closed-screens

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are an admin inviting a teammate, an admin changing a member's roles, an admin removing or revoking a member who holds clients, an admin reassigning a member's clients, and a teammate accepting a staff invitation
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change removes one option from existing pickers and changes which rows show two existing controls, with no token, layout or motion change
MATERIAL_FLOW_CHANGE: NO: every picker, dialog and roster keeps its controls, states and exits; the retired role disappears from the options, invite forms default to the least-privileged option, and the roster shows the accepting-clients pill and the reassign item for members who have clients assigned instead of for holders of the retired role
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction, layout or state; an option is removed from existing pickers and an existing control's visibility rule changes from a role to an assignment
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: admins hand out access from the roles that authorize; a title given to a person is never among them
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: src/lib/auth/titleRoleGrantPathsClosedScreens.test.ts asserts no role picker, invite form, seat picker or roster reads, offers or defaults to the retired role and that the reassign-before-removal guard runs for every member; src/lib/auth/titleRoleGrantPathsClosedServer.test.ts asserts the same for staff invitations, invitation acceptance, the inbound assignment bridge, the operator toolset and PAIGE's grant and revoke tools; both red on e1c6a4288a93edd4d2a492b6ef02d465629027dd (6 real assertions, the other 410 files passing) and green after; whole vitest suite 0 failures
STATIC_EVIDENCE: PASS: tsc baseline did not grow; eslint clean on every changed src file (pre-existing untyped values in InviteMemberDialog typed against the generated database types); Impeccable detect clean on every changed UI file; tool-catalogue, receipt-coverage, action-risk and MCP governed-door lints green
RENDERED_EVIDENCE: NOT_APPLICABLE: no layout or style changes; the only visible differences are one fewer option in pickers and one fewer row in the Solo Setup People role legend
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: assigned-clients count unreadable (revoke and delete stop, nothing changes), member with clients assigned (pill and reassign shown, removal routes to reassign first), member without (neither shown, removal proceeds), invitation carrying the retired role (refused before any change), invite form opened fresh or reset (least-privileged default)
TRUTHFUL_STATE_LABELS: PASS: no screen or tool describes the title as granting anything
SOLO_UI: YES: Solo Setup People role legend reads ROLE_LABEL and ROLE_BLURB from ManageRolesDialog, so it no longer lists Coach as a role; no Solo source file changes
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated browser session in this environment; the legend loses one row and nothing else changes
UNVERIFIED: authenticated browser behavior of the changed pickers, roster and Solo legend, because this environment has no authenticated session

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a business may still give a person the title, which describes and never authorizes
MUST_NOT_HAPPEN: any screen, invitation, tool or bridge granting or offering the retired role; a member with assigned clients removed without their clients being reassigned
MUST_PRESERVE: every other role option; the reassign-before-removal protection; the client-facing profile fields and the accepting-clients toggle for people who serve clients
ACCEPTANCE_CRITERIA: no grant path offers or writes the retired role, proven by the two test files; the reassign guard runs for every member
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: grant_tenant_member_role and the tenant seat value are left to slice 4; no RLS policy changes; no denial-letter or business-certification policy is touched

INTERNAL_BUILD_IDENTITY: b3bb43f7805d68bed1461ffbcb4515fe13b82c4f; deployment=none; environment=development; migrations=PROOF_OWED(20270507000000 applies on merge through deploy-migrations.yml and is checked after merge); edge=PROOF_OWED(accept-invite, handle-inbound-webhook, paige-ai-chat, paige-mcp and send-admin-invitation deploy on merge through deploy-edge-functions.yml and are checked after merge); evidence=PR verify run on the implementation head (this SHA), red run on e1c6a4288a93edd4d2a492b6ef02d465629027dd
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening; visible changes are one fewer option in pickers, one fewer legend row, and invite defaults
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level behavior proven in CI; migration and edge deploys confirmed after merge; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert, since no data changes and the migration only redefines a catalogue function; reference=this PR

## Scope and collisions

- Classification: coach removal, slice 3b (grant paths in the servers and screens).
- Affected flows: invite a teammate (three screens and the operator toolset), change a member's roles, accept a staff invitation, the inbound assignment bridge, remove or revoke a member, reassign a member's clients, PAIGE's grant and revoke tools.
- Neighboring regressions: the three screens that call send-admin-invitation change in the same PR, so no invite form offers a role the server now refuses.
- Active-owner/file collisions: none known.
- Explicit exclusions: grant_tenant_member_role and the tenant seat value (slice 4); the Solo team workspace copy and the account chooser's seat label, which are reads rather than grants (slice 4's CI check).

## User job and state map

An admin invites a teammate or changes their roles from the roles that authorize. A member who has clients shows the accepting-clients pill and a reassign action, and has their clients reassigned before removal, whatever roles they hold.

## Evidence index

- `src/lib/auth/titleRoleGrantPathsClosedScreens.test.ts`.
- `src/lib/auth/titleRoleGrantPathsClosedServer.test.ts`.
- Red run: `verify` on e1c6a4288a93edd4d2a492b6ef02d465629027dd.

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment.
