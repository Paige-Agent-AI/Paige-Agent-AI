# UI delivery evidence: title-role-grant-paths-closed

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are an admin reassigning a staff member's clients from Team settings, and a person accepting an invitation (no app or edge code calls accept_invitation, so that flow has no visible surface)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; no UI file changes, only the server answer a dialog shows
MATERIAL_FLOW_CHANGE: NO: the reassign dialog keeps its controls and its target list; the server now decides target eligibility by active membership of the admin's business instead of the retired role, so the error text an admin can see for a refused target changes
FLOW_PROTOTYPE: NOT_REQUIRED: no interaction, layout or copy change in the app
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an admin moves a staff member's clients to another member of the same business; holding the retired role neither qualifies nor disqualifies anyone
VISIBLE_FLOW_IMPACT: YES: reassign_coach_clients target eligibility changes; the dialog shows the server's error in a toast, so a refused target now reads "not an active member" instead of naming the retired role
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: supabase/tests/title_role_grant_paths_closed.sql proves an outsider holding the retired role is refused as a reassignment and bulk-assignment target, an active member is assignable without it, invitations carrying it are refused, admins cannot change anyone to it, it maps to no seat, and it enrolls nobody as an affiliate; red on the test-only commit (7 of 10 on real assertions), green on the implementation head
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
