# UI delivery evidence: operator-platform-admin-not-a-client

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this milestone's session and followed here; mode Bug or Repair, Quick depth (one guard, one role name, reversible); affected flow is a platform_admin operator signing in, choosing Platform on the account chooser and landing in the operator console; coordinator-authorized 2026-09-27 as in scope for the Platform Operator milestone because it blocks slice 5's platform_admin session
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed references read for this milestone; this change edits the role list of a render-nothing route guard (the component returns null) and changes no markup, token, copy or control, so no Impeccable check applies to a surface and none was run
MATERIAL_FLOW_CHANGE: NO: the flow (sign in, choose Platform, land in the console) already exists and works for super_admin; this removes a defect that sent the platform_admin tier to the client dashboard instead, so no step, state or exit is added or removed
FLOW_PROTOTYPE: NOT_REQUIRED: defect fix in a route guard's role classification; no screen, state or transition is designed or changed
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator at the platform_admin tier; primary action is reaching the operator console after choosing Platform
VISUAL_DIRECTION: NOT_APPLICABLE: the guard renders nothing
AUTOMATED_EVIDENCE: PASS: new src/components/auth/ClientOnlyRouteGuard.test.tsx — the platform_admin case failed before the fix (expected '/app' to be '/operator/fleet/directory'), 1 failed and 3 passed; after the fix 4/4; the super_admin, client-only and no-role cases pin the unchanged behaviour; full suite 405 files passed, 2 skipped, 5851 tests passed
STATIC_EVIDENCE: PASS: eslint clean on both changed files; npm run ci:tsc no new type errors (baseline 12, current 12)
RENDERED_EVIDENCE: NOT_APPLICABLE: the guard renders nothing; the surface it unblocks is the operator console, whose render is recorded by the slice 3 and slice 4 records
BEHAVIORAL_EVIDENCE: UNVERIFIED: diagnosed from production request logs (a repeating cycle of the operator check, then the client dashboard's reads, then the chooser) and the account's roles; the signed-in platform_admin drive after deploy is slice 5's
AUTHENTICATED_RUNTIME: UNVERIFIED: no operator credentials in this environment; slice 5 records the platform_admin holder's signed-in session against the deployed console
KEYBOARD_FOCUS: NOT_APPLICABLE: no control or focus change
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: platform_admin-only account on /operator stays (was sent to /app); super_admin stays (unchanged); client-only and no-role accounts are still sent to /app (unchanged)
TRUTHFUL_STATE_LABELS: NOT_APPLICABLE: no label changes
SOLO_UI: NO: shared route guard; the change only affects accounts holding platform_admin
UNVERIFIED: the platform_admin holder reaching the deployed console after sign-in (slice 5)

OWNER_INTENT: coordinator authorization 2026-09-27: add platform_admin to STAFF_ROLES with a test that a platform_admin-only account is not redirected away from /operator; frontend only; in scope because the platform_admin half of the milestone cannot be proven while that tier cannot sign in
MUST_NOT_HAPPEN: a client-only or role-less account reaching /operator or /broker/app; any change to server-side checks, RLS, roles or data; any change to the other role lists that name super_admin without platform_admin (recorded for the owner's decision, not changed here)
MUST_PRESERVE: the client-only redirect to /app for accounts with no staff role; the super_admin path; RequireOperator as the console's own guard
ACCEPTANCE_CRITERIA: an account whose only role is platform_admin, signed in and choosing Platform, stays on /operator/fleet/directory rather than being sent to /app
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: client-only redirect for client and no-role accounts (tested); super_admin on /operator (tested); RequireOperator and the server operator checks (untouched); the other forbidden prefix /broker/app now also admits platform_admin-only accounts client-side, where the broker surface's own guards and RLS still decide what they can do

INTERNAL_BUILD_IDENTITY: bce5f0d6e5e6f29f6601b6d01a35d31caa212658; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here carries the whole code and test change (tree 57a63722aa6ee6a62c7e1bd7af977e3a87436ac2; no binary files); the commits after it change only this record; vitest, eslint and ci:tsc were run on that code
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge through the frontend deploy
RELEASE_CLASSIFICATION: internal-only: platform operator access, not customer-facing
CUSTOMER_RELEASE_IDENTITY: none: operator access fix, no customer release
RELEASE_NOTE_REQUIRED: NO: internal operator surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: guard-level proof only; the signed-in platform_admin session is slice 5's
RELEASE_RECOVERY: position=revert the merge commit (frontend only, no data change); reference=this PR

## Scope and collisions

- Classification: Platform Operator milestone, access defect blocking slice 5.
- Affected flows: a platform_admin operator signing in and choosing Platform.
- Neighbouring regressions: the client-only redirect (tested unchanged).
- Explicit exclusions: the other role lists that name super_admin without platform_admin, and the act-as findings from the same diagnosis, are recorded at the milestone settlement for the owner's decision and are not changed here.

## User job and state map

The platform_admin operator signs in, is shown the account chooser, picks Platform and should land on Fleet → Directory. Before this change the guard classed them as a client and sent them to `/app`; the chooser appeared unresponsive. After it, the guard treats them as staff and leaves `/operator` to `RequireOperator`, which the server already answers yes for this tier.

## Evidence index

- Red: `npx vitest run src/components/auth/ClientOnlyRouteGuard.test.tsx` before the fix → 1 failed, 3 passed.
- Green: same command after → 4 passed.
- Full suite on the fix branch: 405 files passed, 2 skipped; 5851 tests passed.
- `npm run ci:tsc` → 12/12, no new errors.
- Diagnosis (read-only, production): the locked-out account holds platform_admin only; its sign-in produced a repeating cycle of the operator check, the client dashboard's reads, and the chooser; no exit request was made. `/operator` joined this guard's forbidden list in #543.

## Review and limitations

The fix is one role name. The guard is a client-side redirect, not a security boundary; the change does not widen anything the server allows. Deployed behaviour is `UNVERIFIED` until slice 5's signed-in platform_admin session.
