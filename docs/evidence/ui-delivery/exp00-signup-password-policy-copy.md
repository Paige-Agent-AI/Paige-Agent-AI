# Signup password policy — one truthful contract across form, indicator and server

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: A brand-new customer choosing a password during Solo Beta signup sees the exact
requirement the server enforces BEFORE submitting, and never meets the dead-end "Couldn't create
your account… contact support" toast for a correctable password choice (the exact failure observed
live during the first real signup drive, EXP00 2026-10-17). Existing customers' sign-in stays
untouched.

MUST_NOT_HAPPEN: No sign-in path change (legacy weaker passwords must keep parsing for login,
including client-invite portal users). No second password authority invented client-side; no
loosening of the server policy; no secrets/PII in messages; no layout redesign smuggled into a
validation fix.

MUST_PRESERVE: The shared `authSchema` shape for login (email + min-6 password), the existing toast
patterns and error branches (account-exists, breach, generic), `PasswordStrengthIndicator`'s role on
the Account Security panel and ResetPassword page (their own min-8 gate unchanged), and every other
Auth.tsx flow (OAuth intent, invite, operator chooser).

ACCEPTANCE_CRITERIA: A symbol-less strong password is rejected at submit with the specific policy
message; whitespace/emoji do not count as the symbol class (server's documented set only); the
indicator's requirement list shows all four classes + length, derived from the SAME policy module as
the schema (no visible "all green" while submit rejects); a server weak_password rejection maps to
the same actionable copy; login with a legacy password still submits; contract tests pin all of it.

Goal: Choose a compliant password first time.
Human and feel: First-time customer; direct and unhurried.
Entry and exit: Signup form password field + indicator; submit proceeds to verification state.
System: Existing form components and toast; no new visual system.
Signature: The indicator's five checks agree with the submit gate, always.
Feedback: Validation message under "Validation error" toast; indicator checks tick live.
Rejecting: Any dead-end generic toast for a correctable password input.
Variants: Same contract for every new signup; login unchanged.

| From | Input | To / recovery |
| --- | --- | --- |
| Signup, symbol-less password | Submit | Validation error with the specific policy message; fix and resubmit |
| Signup, compliant password | Submit | Proceeds to signUp → verification-email state |
| Signup, server weak_password despite client pass | Server 422 | Actionable "Password needs more variety" toast (same guidance) |
| Login, legacy weak password | Submit | Parses (min-6 only) → signInWithPassword |
| Indicator | Any typing | Five checks derived from the shared policy module |

PROTECTED_SEAMS: Affected: signup validation gate and its displayed contract (schema/indicator
unity pinned by tests). Unaffected: login gate, OAuth/invite flows, Account Security panel and
ResetPassword (same component, requirement list now truthful for them too), server policy itself.

VISUAL_DIRECTION: PASS: Existing form/toast/indicator vocabulary only; no new visual system, no
layout change — one added row in the indicator's existing requirements grid and message copy.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract above; state/transition table covers every changed branch; the failing-first live evidence is the 2026-10-17 drive toast (GitHub #2329 comment 6244132169).
PAIGE_UI_DESIGN: PASS: No new design surface — existing components reused verbatim with one added grid row; the mandatory reading was applied to the copy change only (patterns unchanged).
MATERIAL_FLOW_CHANGE: NO: no new goal/state/transition/exit; validation precision and truthful copy on an unchanged flow.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material change (grammar rule above).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: First-time Solo signup customer; choose a compliant password and submit without a dead end; see the exact unmet requirement.
VISUAL_DIRECTION: PASS: existing token vocabulary; no new visual direction.
AUTOMATED_EVIDENCE: PASS: vitest src/__tests__/auth-password-policy.test.ts — 6 cases incl. symbol-set truth (emoji/whitespace rejected), login-path regression, message pinning.
STATIC_EVIDENCE: PASS: changed files type-clean (auth-js AuthError.code declared); tsc no new errors; policy module single-sourced (schema + indicator import it).
RENDERED_EVIDENCE: PASS: no-layout-change slice; the indicator renders its existing grid with one added row (component unchanged in structure); live rendered verification owed at deploy readback (below).
BEHAVIORAL_EVIDENCE: PASS: live drive 2026-10-17 proved the ORIGINAL dead-end behavior (screenshot in session evidence, #2329); the new behavior is pinned by the contract suite; post-deploy browser verification lands with the EXP00 packet.
AUTHENTICATED_RUNTIME: UNVERIFIED: the new toast/indicator behavior on production awaits deploy + the packet drive; login-path safety is contract-pinned, not yet production-observed.
KEYBOARD_FOCUS: PASS: no focus-order or control change; existing inputs/toasts.
ZOOM_REFLOW: PASS: no layout change; existing grid adds one row in the same flow.
REDUCED_MOTION: PASS: no motion added or changed.
STATE_COVERAGE: PASS: states covered in the transition table (4 classes × signup, server-mapping fallback, login legacy).
TRUTHFUL_STATE_LABELS: PASS: indicator labels now state the actual enforced classes incl. the server symbol set example.
SOLO_UI: NO: public auth surface, not a Solo shell surface.
UNVERIFIED: production-rendered confirmation of the new copy (owed at deploy readback; no other claims outstanding).

OWNER_INTENT: recorded above (module 1 block).
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: b5a0a0d68a25e1ece6c59501bc9562f474451f93; deployment=PENDING merge to main then Vercel production; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + PR #2346 CI
RELEASE_CHANNEL: development: internal engineering slice on the public signup surface; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: patch: corrects the live-observed signup password-policy defect (client contract now matches the server rule with truthful displayed requirements).
CUSTOMER_RELEASE_IDENTITY: none: defect repair, no release note.
RELEASE_NOTE_REQUIRED: no: fixes a defect that blocked correctable password choices.
RELEASE_TRUTH_BOUNDARY: LIVE: client-side validation/copy contract at merge+deploy; PROOF OWED: production-rendered confirmation only.
RELEASE_RECOVERY: position=forward-fix (client-only change, revert-safe); reference=PR #2346 review thread + contract suite.
