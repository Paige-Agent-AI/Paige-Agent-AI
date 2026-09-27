# UI delivery evidence: operator-landing-directory

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full; mode Bug or Repair, Quick depth (one constant, reversible); affected flow is a platform operator signing in (operator door or shared sign-in → account chooser → Platform) and landing in the console; Platform Operator milestone slice 2 of 5, coordinator-approved 2026-09-27
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed references read for this milestone; this slice changes a navigation target only — no markup, token, copy or control
MATERIAL_FLOW_CHANGE: NO: the sign-in steps, chooser, guard and exits are unchanged; only the default view the flow ends on changes, from Fleet → Systems check to Fleet → Directory, which was the intended target all along
FLOW_PROTOTYPE: NOT_REQUIRED: corrects a stale destination to the view the constant was always meant to name; no step, state or exit added or removed
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator at either tier; primary action is to see every tenant immediately after signing in
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change
AUTOMATED_EVIDENCE: PASS: new test in src/lib/auth/operatorTarget.test.ts resolves GOD_CONSOLE through the shell's own resolveOperatorAddress and asserts slot fleet, view Directory, not stale, canonical path unchanged — red on the old constant (stale=true), green on the new; AgencyEntry.authorization, ChooseAccount, OperatorEntry, RequireOperator and operatorTarget suites 56/56 green
STATIC_EVIDENCE: PASS: eslint clean on changed files; npm run ci:tsc no new type errors
RENDERED_EVIDENCE: NOT_APPLICABLE: the destination view (Directory) renders as it did; slice 3's record carries its frames
BEHAVIORAL_EVIDENCE: UNVERIFIED: the post-sign-in landing is auth-gated and was not driven here — owed to slice 5
AUTHENTICATED_RUNTIME: UNVERIFIED: no operator credentials in this environment; slice 5's human-driven sessions at both tiers record where sign-in lands
KEYBOARD_FOCUS: NOT_APPLICABLE: no control or focus change
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: default landing (no next) now Directory; a safe ?next= deep link still wins (existing allowlist tests unchanged and green); unsafe next still falls back to the default
TRUTHFUL_STATE_LABELS: NOT_APPLICABLE: no label changes
SOLO_UI: NO: Platform Operator sign-in only
UNVERIFIED: the landing observed in a real signed-in browser at both tiers (slice 5)

OWNER_INTENT: coordinator ruling 2026-09-27, slice 2: an operator who signs in lands on the tenant directory
MUST_NOT_HAPPEN: a change to the ?next= allowlist, the chooser, or the guard; an operator landing on an address the console treats as stale
MUST_PRESERVE: open-redirect protections in operatorTarget; the chooser step; RequireOperator's server-decided admission
ACCEPTANCE_CRITERIA: signing in as either operator tier with no deep link ends on /operator/fleet/directory showing the tenant list
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: operatorTarget next-allowlist (tested, unchanged); ChooseAccount Platform choice (tested, uses the constant); AgencyEntry platform-staff redirect (tested, expectation updated to the new constant); the landing on the agency side is not otherwise touched

INTERNAL_BUILD_IDENTITY: 9a7ac9129a7f8d5ce7f9ded4abe9c5bd2bf337aa; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here carries the whole code and test change; the commit after it adds only this record; vitest, eslint, ci:tsc and harness frames were run on that code
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge through the frontend deploy
RELEASE_CLASSIFICATION: internal-only: Platform Operator console
CUSTOMER_RELEASE_IDENTITY: none: operator console correction, no customer release
RELEASE_NOTE_REQUIRED: NO: internal operator surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: resolver-level proof only; the signed-in landing is proven in slice 5
RELEASE_RECOVERY: position=revert the merge commit; reference=this PR

## Scope and collisions

- Classification: Platform Operator milestone slice 2, stale navigation target.
- Affected flows: operator sign-in landing, both tiers.
- Neighboring regressions: ?next= deep links; the chooser; the agency entry's staff redirect (shared constant — only its expected value changes).
- Active-owner/file collisions: none known.
- Explicit exclusions: no change to OperatorLogin, ChooseAccount, RequireOperator or the IA.

## User job and state map

Sign in → choose Platform → land on the tenant directory. Before, `/operator/fleet/tenants` named a view from the retired first-pack tree; the shell canonicalised it to the Fleet slot's first view, Systems check.

## Evidence index

- Red: `npx vitest run src/lib/auth/operatorTarget.test.ts` with the old constant → 1 failed (stale true).
- Green: same file plus AgencyEntry.authorization, ChooseAccount, OperatorEntry, RequireOperator → 56 passed.

## Review and limitations

Self-reviewed, lower assurance; the change is one constant with a resolver-backed test. The signed-in landing is `UNVERIFIED` until slice 5.
