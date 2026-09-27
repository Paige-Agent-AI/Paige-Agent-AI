# UI delivery evidence: operator-act-as-visible-and-reversible

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this milestone's session and followed here; mode Feature on an existing surface, Standard depth (session scope, audited act, permission-sensitive); affected flows are an operator entering a tenant from Fleet → Directory, seeing which tenant they are acting as, and leaving it from the console; Platform Operator shell objective slice A1 (scope document 2026-09-27)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed references read for this milestone; Impeccable read and applied (installed .agents/skills/impeccable, upstream https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md): SKILL.md, reference/operate.md and reference/craft-floor.md; checks applied — Operate "accent for primary actions and state indicators only" (gold only on Exit tenant; the acting state uses the warning rule, not gold: met); craft-floor Contrast (every band text element 5.37:1 or better light, 6.93:1 or better dark: met); craft-floor States (rest, acting, leaving in flight, acting-unnamed, exit refused: met); craft-floor Copy "controls name their action; errors name the problem" (Exit tenant; "Couldn't leave the tenant. You are still acting as it.": met); an Impeccable critique of the first frames found the acting band barely distinguishable from rest in light theme, and it was changed to a raised ground, authority line and caution rule before this record; `npx impeccable@4.1.0 detect` on the four changed source files exit 0
MATERIAL_FLOW_CHANGE: YES: adds a transition that did not exist — leaving a tenant from the operator console (Exit tenant on the scope band, through the audited exit) — and changes what the band states while an act-as is open (from a fixed "No tenant" to the tenant being acted as)
FLOW_PROTOTYPE: PASS: rendered review frames of every band state (rest, acting, leaving in flight, acting-unnamed) in light and dark at 1200px and 390px from a local harness with neutral fixtures (scripts/live-drive/artifacts/scope-band/, gitignored; checksums below); owner-intent reference is the coordinator's Platform Operator objective of 2026-09-27 (entry into a tenant "visibly indicated in a way that cannot disagree with the actual state, and reversible from the console"); the owner's approval of this design has not been given and the PR is held unmerged until it is
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator at either tier; job is to know at every moment whether they are acting inside a customer's workspace, and which one, and to leave it; primary action on the band is Exit tenant
VISUAL_DIRECTION: PASS: the pack's own band geometry and exitScope control (Shell v3 L78-L82) on installed --pg-* tokens; acting tone = --pg-raised ground, --pg-line-authority border, inset --pg-warning leading rule; Exit in --pg-gold-core on the authority line; no new token, font or component library
AUTOMATED_EVIDENCE: PASS: new src/operator/shell/LiveScopeBand.test.tsx (6 tests: rest offers no exit; no database names in copy; acting names the tenant and offers exit; unnamed tenant said honestly; exit calls switchTenant(null) once for two presses and disables while in flight; a refused exit toasts and stays acting) failed before the component existed; new src/operator/surfaces/FleetConsole.enter.test.tsx failed before the guard (switchTenant called 3 times for 3 presses) and passes after (once); OperatorShell.test.tsx given the resting tenant context the app provides at its root; src/operator and src/lib/auth 46 files, 433 tests passed
STATIC_EVIDENCE: PASS: eslint clean on changed files; lint:shadow-vars clean (it failed CI on 0418d6c7b for a var()-built shadow without the shadow: hint — fixed in 52e4b36e4); gold-discipline lint clean on src/operator/shell and FleetConsole.tsx; npm run ci:tsc no new type errors (baseline 12, current 12)
RENDERED_EVIDENCE: PASS: harness render (local, not live) of the real ScopeBand component in four states, light and dark, 1200px and 390px; 0 page errors; no document horizontal scroll at 390px (the band wraps: 36px at rest wide, 47–54px narrow); Exit control 24px tall
BEHAVIORAL_EVIDENCE: UNVERIFIED: the band's binding to the live session scope and the exit's server round-trip are proven by tests against the context seam, not by a drive of the deployed console
AUTHENTICATED_RUNTIME: UNVERIFIED: no operator credentials in this environment; owed to a human operator session after approval and deploy: enter a tenant, see the band name it, exit from the band, then read back an operator.tenant.exit row
KEYBOARD_FOCUS: PASS: Exit tenant is a real button in DOM order after the band text, focusable, with the shell's existing gold focus ring; disabled while in flight; the pack's ⌘⇧X shortcut is not implemented (not claimed)
ZOOM_REFLOW: PASS: the band is min-height and flex-wrap, so at 390px the audit line and Exit wrap to a second row instead of clipping; no horizontal scroll
REDUCED_MOTION: NOT_APPLICABLE: only the band's existing 200ms colour transition, which predates this change
STATE_COVERAGE: PASS: rest (no pointer) — platform scope, no exit; acting (pointer set, tenant readable) — Acting as <name>, Exit tenant; acting, tenant not in the session's readable list — Acting as "a tenant this session cannot name", Exit tenant; leaving — Leaving…, disabled; exit refused — error toast, band still acting, exit re-enabled; Enter in flight — further presses ignored
TRUTHFUL_STATE_LABELS: PASS: the band now states the session's real scope instead of a fixed "No tenant"; "Entry and exit are recorded" is true of the operator RPCs this band and Enter call; database names removed from copy
SOLO_UI: NO: Platform Operator console only
UNVERIFIED: the deployed band during a real act-as at either tier; the exit row on production after using Exit tenant; behaviour when the pointer is changed from another window (the band reflects this session's loaded scope, refreshed on the app's own refresh events, not a live subscription)

OWNER_INTENT: coordinator objective 2026-09-27: entry into a tenant is explicit, audited on entry and exit, visibly indicated in a way that cannot disagree with the actual state, and reversible from the console; slice A1 of the Platform Operator shell scope
MUST_NOT_HAPPEN: the band saying "No tenant" while an act-as is open; an exit that skips the audited RPC; a hard navigation on enter or exit (scopeIsNotNavigation.test.ts); gold at rest; any change to who may enter a tenant or to the RPCs, RLS or roles
MUST_PRESERVE: the band's geometry and its thin-never-hide collapse; the Fleet directory's rows, grading and Enter act-as; act-as as a scope change, not a navigation; the audited enter/exit RPCs unchanged
ACCEPTANCE_CRITERIA: after Enter on a tenant, the band reads "Acting as <that tenant>" with Exit tenant; pressing Exit once returns the band to platform scope, writes exactly one exit audit row, and leaves the operator on the view they were on
MOTION_PURPOSE: NONE: no motion added
PROTECTED_SEAMS: act-as is not navigation (scopeIsNotNavigation.test.ts, unchanged and green); shell geometry tests (OperatorShell.test.tsx, green with the resting context); Fleet directory rendering (FleetConsole.test.tsx 22/22); switchTenant and the operator RPCs (untouched)

INTERNAL_BUILD_IDENTITY: 52e4b36e4113218bf9dca8e660d2884c256e8b6e; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here completes the code and test change (tree 95860922da1b6cfe9b3cdc09aa660b5c2acf5d32; no binary files committed); it follows 0418d6c7b (tree 570284fb5bc0d3e26749d94561adbeb688e107a3), on which vitest, eslint, gold lint, impeccable detect, ci:tsc and the harness frames were first run, and adds only the shadow: type hint lint:shadow-vars requires on the acting tone's caution rule; on 52e4b36e4 the band and shell tests (50) and eslint were re-run and the four frames re-shot byte-identical to the checksums below, and the rule's computed box-shadow measured the same 3px inset before and after the hint; the commits after it change only this record; frame sha256: band-light-wide f63ac32d2fa685cf62ec380592f1662bae641463164275af21aedc782bb8dc7e, band-light-narrow 40cf5e3047fdd63e057d3086cfb2f3898cd064488cafd7ba6f6c8497534f3e3f, band-dark-wide cbd6d8d90ff4097c23efdb89cadb4485c1b3e339938bf263b819b813aef39e12, band-dark-narrow 7d9e4e987efd0c2ac657ae6eb4ef48ee1353b55aedb6918fbc73fff1c87a7c27
RELEASE_CHANNEL: development: pre-merge branch build; held for owner design approval before merge
RELEASE_CLASSIFICATION: internal-only: Platform Operator console
CUSTOMER_RELEASE_IDENTITY: none: operator console, no customer release
RELEASE_NOTE_REQUIRED: NO: internal operator surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: harness frames and tests only; the deployed band during a real act-as is proven by a human operator session after approval
RELEASE_RECOVERY: position=revert the merge commit (frontend only, no data change); reference=this PR

## Scope and collisions

- Classification: Platform Operator shell objective, slice A1 (act-as visible and reversible).
- Affected flows: enter a tenant from Directory; see the acting state; leave from the band.
- Neighbouring regressions: shell geometry, the Directory, act-as-is-not-navigation — all tested green.
- Explicit exclusions (later slices, per the scope document): refusing silent pointer changes server-side and routing the fresh-sign-in reset through the audited exit (A2, an authority change awaiting ruling); where Enter should land (ruling); cross-window scope broadcast; the ⌘⇧X shortcut; any change to who may act as a tenant.

## User job and state map

An operator enters a tenant from the Directory to support it. From that moment the band above every surface says "Acting as <tenant>" on a raised, caution-ruled strip with an Exit tenant control. Pressing it runs the audited exit; the band returns to "Platform scope" and the operator stays where they were. If the exit is refused, they are told so and the band still says they are acting — which is true. The scroll owner and every surface below the band are unchanged.

## Evidence index

- Red: LiveScopeBand.test.tsx failed (module did not exist); FleetConsole.enter.test.tsx — "expected to be called 1 times, but got 3 times".
- Green: src/operator and src/lib/auth — 46 files, 433 tests.
- Frames (not live): scripts/live-drive/artifacts/scope-band/band-{light,dark}-{wide,narrow}.png; minimum measured text contrast 5.37:1 light, 6.93:1 dark (the disabled "Leaving…" state is drawn at 60% opacity and its measured ratio excludes that opacity).

## Review and limitations

Self-reviewed against Impeccable's craft floor; the first render's weak light-theme acting state was corrected before this record. Needs the owner's approval of the design before merge (§00), then an authenticated human session to prove the band and the exit on the deployed console.
