# UI delivery evidence: operator-standing-client-g2

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this milestone's session and followed; mode Refactor/consolidation on existing flows, Standard depth (permission-sensitive routing); affected flows are an operator signing in (operator door, /auth, /join-platform) and reaching the console, a tenant user signing in and landing, and a client being kept off staff surfaces; Platform Operator shell objective slice G2 (scope document plan-agreed 2026-09-27, rulings packet and amendment of the same day)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read for this milestone; no visible surface is redesigned — copy, layout, tokens and components are unchanged; the one label-bearing change is the Paige persona id for an operator at rest (`super_admin` → `platform_operator`), whose rendered label "Paige Operator" and tagline are unchanged; Impeccable not applied because nothing drawn changes
MATERIAL_FLOW_CHANGE: NO: every successful path lands where it did (operators at the chooser, tenant users as before, clients on /app); what changes is the SOURCE of the operator answer (one server read instead of role lists and two RPCs) and two failure paths — a failed operator-standing read now returns the existing "try again" retry door instead of being decided from role words, and ClientOnlyRouteGuard no longer sends a person to /app when their reads fail (a failed read was treated as "client")
FLOW_PROTOTYPE: NOT_REQUIRED: no screen, state or copy changes; the two failure paths now use the retry states the flows already had
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is every signed-in person at sign-in, and platform operators at either tier entering the console; job is to be routed by who they are; primary action is sign-in
VISUAL_DIRECTION: PASS: unchanged; no token, component or copy change
AUTOMATED_EVIDENCE: PASS: full vitest 408 files / 5862 tests passed, 2 skipped; new ClientOnlyRouteGuard case (a failed standing read bounces nobody) failed against the pre-G2 guard and passes now; new resolveLandingRoute case (a failed standing read returns the retry door) failed against the pre-G2 resolver and passes now; RequireOperator's five person-keyed-grant tests pass unchanged against the shared hook; the 15 failures seen mid-change were measured green on origin/main in a separate worktree (all caused by this change) and each fixed; lint:operator-roles fails on the pre-G2 tree (seven files with role lists) and passes on this one; its self-test 9 cases
STATIC_EVIDENCE: PASS: npm run ci:tsc no new type errors (baseline 12, current 12); eslint on changed files 0 errors (1 pre-existing fast-refresh warning in useTenantContext); lint:operator-roles, lint:operator-roles:test, lint:tier-features, lint:user-facing-admin-urls, lint:operator-reach, lint:title-authority, lint:shadow-vars clean; baseline-guard clean
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changes; the persona label text is unchanged
BEHAVIORAL_EVIDENCE: UNVERIFIED: routing is proven by tests against the RPC seam, not by a browser drive; operator_standing() is not on production until G1 merges
AUTHENTICATED_RUNTIME: UNVERIFIED: requires G1 (operator_standing) on production first; then owed to human sessions at each tier — super_admin and platform_admin sign in through the operator door and /auth and reach the console; a tenant owner and a client sign in and land as before
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element added or changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: operator known (admit), not an operator (deny to /app), signed out (to the door), read failing (retry, then "Couldn't verify your access"), subject swap (previous person's grant dropped), token refresh (no re-ask); at sign-in: operator → chooser, standing read failed → retry door; ClientOnlyRouteGuard: tenant staff stay, operators stay, client and role-less accounts bounced, failed reads bounce nobody
TRUTHFUL_STATE_LABELS: PASS: the operator persona no longer calls a platform_admin "super_admin"; the console footer's role word is the server's tier
SOLO_UI: NO: routing and operator console only; Solo surfaces are not changed (useTenantContext's flags keep their meaning)
UNVERIFIED: authenticated sign-in at every tier after G1 and G2 are on production

OWNER_INTENT: coordinator rulings packet and amendment 2026-09-27: one server answer to operator + tier, every guard, route, surface, tool and policy deriving from it, with a lint that fails on a new role list; the client-side role lists are deleted in G2, not left beside the hook
MUST_NOT_HAPPEN: an operator locked out or a client let in; one person's operator grant admitting another; a failed read treated as a denial or as "client"; any change to who the server authorises (G2 is client-only)
MUST_PRESERVE: RequireOperator's person-keyed verdict, generation guard, bounded retries and "Couldn't verify" state; the chooser pause for operators at every sign-in door; useTenantContext's isPlatformOwner/isPlatformStaff meanings; tenant RoleGate outcomes (the Solo tenant-relationships files are not touched by this slice)
ACCEPTANCE_CRITERIA: after G1 and G2 deploy, each operator tier signs in through the operator door and /auth, lands on the chooser, picks Platform and reaches Fleet → Directory; a tenant owner and a client land as before
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: RequireOperator grant ownership (RequireOperator.test.tsx, 5 cases, green); sign-in doors' chooser contract (operatorTarget.test.ts, 18 green); landing routes (resolveLandingRoute.test.ts, 21 green); tenant route owners' account context (TenantRouteOwnerAccountContext.integration.test.tsx, 14 green); client guard (ClientOnlyRouteGuard.test.tsx, 5 green); act-as scope (untouched)

INTERNAL_BUILD_IDENTITY: 9e4bfca52617a5f32555514351c06077b5c1f520; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here carries the whole code and test change on top of G1 (claude/operator-standing-g1 64ddf1fb8); vitest, tsc, eslint and the lints above were run on it
RELEASE_CHANNEL: development: stacked on G1; authority-model slice, waits for a coordinator ruling and for G1 before merge
RELEASE_CLASSIFICATION: internal-only: sign-in routing and the operator console
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated sign-in at each tier after G1 and G2 deploy
RELEASE_RECOVERY: position=revert the merge commit, frontend only with no data change, and G1's functions stay harmlessly unread; reference=this PR
