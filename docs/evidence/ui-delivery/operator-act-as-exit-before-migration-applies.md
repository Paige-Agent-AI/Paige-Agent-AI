# UI delivery evidence: operator Exit tenant works before its migration applies

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this milestone; this follow-up keeps the one flow #1547 shipped (operator inside a tenant → Exit tenant → Fleet) reachable while production lacks the bound exit
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read for this milestone; no visible element, copy or layout changes here
MATERIAL_FLOW_CHANGE: NO: the Exit tenant flow, its states and its copy are exactly #1547's; this only keeps the exit working against a server that does not yet have operator_exit_tenant(_expected)
FLOW_PROTOTYPE: NOT_REQUIRED: no flow, state, transition or exit is added or changed; the change restores the shipped exit's behaviour on the current production database
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator acting as a tenant; primary action is Exit tenant, which must end the act-as and return to Fleet
VISUAL_DIRECTION: PASS: no visual change; the control, icon, label and states are #1547's
AUTOMATED_EVIDENCE: PASS: src/hooks/useTenantContextActAs.test.tsx "still exits when the server does not have the bound exit yet" fails before the fallback and passes after, and three cases for the fallback reading the scope first (another tab's act-as is left open as moved, an already-ended act-as records no second exit, an unreadable scope is refused without exiting) each fail before the scope read; provider, components/auth, lib/auth and chooser tests 285 passed; supabase/tests/operator_act_as_one_at_a_time.sql 26/26 on the renamed migration applied locally
STATIC_EVIDENCE: PASS: ci:tsc 12 baseline errors, none in a changed file; eslint 0 errors on the changed file; lint:definer-fns clean; the migration file is renamed only, contents unchanged
RENDERED_EVIDENCE: NOT_APPLICABLE: nothing rendered changes; the frames recorded for #1547 in operator-act-as-lands-or-not-at-all.md still describe the surface
BEHAVIORAL_EVIDENCE: UNVERIFIED: the fallback is proven against a mocked PGRST202 response; a real press of Exit tenant on production before the migration applies has not been driven
AUTHENTICATED_RUNTIME: UNVERIFIED: requires a human operator session on production; owed with #1547's authenticated journey
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element added, removed or reordered
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: bound exit present (exits, moved, refused, as in #1547) and bound exit absent (PGRST202 → scope read first: another tenant open → moved with nothing ended; nothing open → exited with no RPC; unreadable → refused; this tenant open → unbound exit → exited, or refused by read-back as before)
TRUTHFUL_STATE_LABELS: PASS: "Couldn't leave {tenant}. You are still acting as this tenant." is shown only when the read-back confirms the pointer still holds the tenant; before this change it was shown on a missing function while the act-as could not be ended at all
SOLO_UI: NO: the provider behind the exit changes, not a Solo surface; the Solo and business shells' Exit tenant control is unchanged
UNVERIFIED: a live press of Exit tenant on production before and after the migration applies, and the production proof that 20270512000000 is applied with the three functions holding the lock

OWNER_INTENT: coordinator defect ruling 2026-09-27 relaying Antonio: "an operator inside a tenant must always have a visible way out" — the way out must work on the database production actually has
MUST_NOT_HAPPEN: an operator pressing Exit tenant and being told they are still acting as the tenant because the server lacks the bound exit; this migration colliding with another lane's renumbered migration
MUST_PRESERVE: #1547's Exit tenant control, copy and states; the stale-tab protection once the migration is applied; the migration's contents
ACCEPTANCE_CRITERIA: an operator inside a Solo tenant or a sub-account presses Exit tenant and returns to Fleet → Directory, both before and after 20270512000000 is applied
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: exitOperatorActAsFrom (tested with the bound exit present and absent); exitOperatorActAs and the sign-out seam unaffected (they call the unbound exit)

INTERNAL_BUILD_IDENTITY: 9a1c2f3f61ed86cb557b60db4843e03a39a8d2ac; deployment=none; environment=development; migrations=PROOF_OWED(20270512000000_operator_act_as_one_at_a_time applies once main's duplicate 20270510000000 is resolved by the other lane's renumbering, and is then checked on production); edge=NOT_APPLICABLE; evidence=the commit named here (tree 1991d4e3c0a2029115038739ed8a3721ae414f6e) adds the PGRST202 fallback to the bound exit and moves the unapplied migration from 20270511000000 to 20270512000000; production's schema_migrations was read before it and holds only 20270510000000 (operator_standing_one_answer) among 2027051*
RELEASE_CHANNEL: development: blocking-defect follow-up, merged on green per CLAUDE.md §4 pre-launch stance
RELEASE_CLASSIFICATION: internal-only: operator act-as exit and a migration version; no customer-visible change
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the fallback is proven in tests only; the migration is not applied on production until main's migration deploys succeed again
RELEASE_RECOVERY: position=revert the merge commit — the fallback only ever calls the unbound exit production already has, and the renamed migration is applied nowhere, so nothing on production changes by reverting; reference=this PR

## Scope and collisions

- Classification: post-merge follow-up to #1547 (client fallback plus a migration version move).
- Affected flows: operator Exit tenant from a Solo or business shell, and the chooser's workspace switch for an acting operator.
- Neighboring regressions: none; sign-out and the stranded exit already use the unbound exit.
- Active-owner/file collisions: #1549 (another lane) renames coach-removal slice 5's migrations to 20270511000000 and 20270511010000; this migration moves to 20270512000000 so the two do not collide.
- Explicit exclusions: resolving main's duplicate 20270510000000 is #1549's; this PR does not touch slice 5's migrations.

## User job and state map

The operator inside a tenant presses Exit tenant. With the bound exit on the server: exited → Fleet; moved → "already ended in another tab"; refused → "still acting". Without it (PGRST202): the client reads the scope first. Another tenant open → moved, nothing ended; nothing open → exited with no second exit row; unreadable → refused. Only when this tenant is open does the unbound exit run, then exited → Fleet, or refused by read-back as before. A tab entering between that read and the exit is closed by the server once the migration applies.

## Evidence index

- `npx vitest run src/hooks/useTenantContextActAs.test.tsx src/components/auth src/pages/ChooseAccount.test.tsx src/lib/auth` → 285 passed.
- `supabase test db supabase/tests/operator_act_as_one_at_a_time.sql` → 26/26 after applying the renamed file locally.
- Production read-only: `select version, name from supabase_migrations.schema_migrations where version like '2027051%'` → one row, 20270510000000 operator_standing_one_answer.
