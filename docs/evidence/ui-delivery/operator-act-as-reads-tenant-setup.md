# UI delivery evidence: an operator acting as a Solo workspace sees its Game Plan

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read for this milestone; flow is operator enters a Solo workspace from Fleet → the Command Center's Business Game Plan resolves (or shows its error) → Exit tenant; pre-edit packet in the PR body
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read for this milestone; no element, copy, layout or motion changes; the Game Plan's existing error card becomes reachable
MATERIAL_FLOW_CHANGE: NO: no state, transition or exit is added; a Setup read that was refused for every operator now answers read-only, and a failed Setup read now reaches the error state the surface already had
FLOW_PROTOTYPE: NOT_REQUIRED: no visible element changes; the resolved Game Plan and its error card are the shipped surfaces
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator (super_admin or platform_admin) acting as a Solo workspace to support it; primary action is reading the workspace's Business Game Plan
VISUAL_DIRECTION: PASS: no visual change
AUTOMATED_EVIDENCE: PASS: src/solo/data/useSoloSetupBrief.test.tsx two new cases (a refused read with no row, a failed read) each fail before the change and pass after, and a third pins that a late failure from the previous workspace does not settle the current one; src/solo 2123 passed; supabase/tests/operator_act_as_reads_solo_setup.sql 25/25 on the local stack; its behavioural cases fail on the current functions (super_admin read NULL; business context raising 42501), its two direct-pointer cases fail on this PR's first version of the predicate, which trusted the pointer without a receipt, and its forged-receipt cases fail before the audit-log policy (the forged row landed and the read succeeded)
STATIC_EVIDENCE: PASS: ci:tsc 12/12 baseline; eslint clean on the changed files; lint:definer-fns clean; lint:migration-versions no version reused; lint:title-authority R0–R7 pass; the two replaced functions' bodies are production's byte for byte (md5 of pg_get_functiondef matched between production and the local stack before the change) except each one's opening gate
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered element changes; the Game Plan renders from data this change makes readable
BEHAVIORAL_EVIDENCE: UNVERIFIED: the operator read is proven in pgTAP as both operator tiers against the real functions; the resolved Game Plan inside a real operator session has not been driven
AUTHENTICATED_RUNTIME: UNVERIFIED: requires a human operator session on production after deploy; owed with the remaining live-drive items
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element added, removed or reordered
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: member resolves as before; operator at rest reads nothing; operator acting reads read-only (either account state, including canceled); an operator pointer set without an open enter receipt reads nothing; a forged operator.* receipt cannot be written; operator after exit reads nothing; tenant.act_as withdrawn reads nothing; non-member non-operator with a global admin role reads nothing; a refused or failed read shows the surface's error instead of a permanent skeleton
TRUTHFUL_STATE_LABELS: PASS: the Game Plan no longer presents a refused read as still loading
SOLO_UI: YES: src/solo/data/useSoloSetupBrief.ts (data hook behind Business Game Plan and Settings → Setup); no Solo component, layout or geometry changes
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it decides whether the Game Plan's existing skeleton or its existing error card renders; neither surface, its layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
UNVERIFIED: the resolved Game Plan in a real operator session at each tier; left to A2 as ruled — an enter left open because a session expired can be reused by re-pointing by hand (the audit trail still records that operator as inside); a platform_admin's approvals, knowledge and offers panels still read empty because those tables' policies admit only super_admin across tenants, which is G3's redefinition of the operator helpers

OWNER_INTENT: owner live drive 2026-09-28: "Every one of the accounts that I log into should be able to resolve properly … it's just not resolving when coming from the platform operator account"; coordinator: an operator who lands inside a tenant but cannot see its content is a half-working entry
MUST_NOT_HAPPEN: an operator writing a workspace's Setup through this read; an operator reading a workspace they have not entered through the audited act-as (a self-set pointer with no open receipt reads nothing, tested); a failed read shown as endless loading
MUST_PRESERVE: the member Setup read and write exactly as they were; the stale-response guard that drops a previous workspace's late answer; every Setup write gated on membership
ACCEPTANCE_CRITERIA: an operator at either tier who enters a Solo workspace from Fleet sees its Business Game Plan resolve; if the read is refused the surface shows its error card
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: save_solo_setup_context, solo_setup_lock_expected_tenant, check_solo_setup_managed_email, search_solo_setup_naics (unchanged, still member-only); solo_setup_can_read (unchanged); solo_setup_access_scope (unchanged, operators read read_only)

INTERNAL_BUILD_IDENTITY: 471a8af837cf6c99a8b11197209c029637e6c7dc; deployment=none; environment=development; migrations=PROOF_OWED(20270513000000_operator_act_as_reads_solo_setup applies on merge through deploy-migrations and is then read back on production); edge=NOT_APPLICABLE; evidence=the commit named here (tree d924d717de311a658bea14d4df1f2360f61e5655) holds this PR's code, tests and migration, including the open-receipt requirement added after independent review and the audit-log policy that keeps operator receipts server-written (Codex review of 41fff866)
RELEASE_CHANNEL: development: blocking-defect fix from the owner's live drive, merged on green per CLAUDE.md §4 pre-launch stance
RELEASE_CLASSIFICATION: internal-only: operator support reads; no customer-visible change
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: proven in pgTAP and unit tests; production readback and a real operator session owed after deploy
RELEASE_RECOVERY: position=revert the merge and apply a migration restoring the two functions' original gate (their bodies are production's apart from that line) — the two new helper functions are unreferenced once reverted; reference=this PR

## Scope and collisions

- Classification: blocking defect found in the owner's live drive of the act-as fix.
- Affected flows: an operator acting as any Solo workspace opening Command Center → Business Game Plan, and Settings → Setup.
- Neighboring regressions: none; the member read path is unchanged and re-tested.
- Consumers (§37): useSoloSetupBrief (Business Game Plan, Settings → Setup); useSoloBusinessContext (get_solo_business_context); get_public_presence_paige_context, which reads get_solo_business_context and feeds paige-ai-chat's public-presence block — an acting operator now gets the owner-confirmed public facts there instead of UNAVAILABLE (read-only, draft-only); save_solo_setup_context and save_solo_business_context call the read only after their own member gate.
- Active-owner/file collisions: none found on main; #1520 (held) does not touch these files.
- Explicit exclusions: tenant-filtering the knowledge and department counts for a super_admin (next PR); widening a platform_admin's reads on other tables (G3); any Setup write for an operator (G3's tenant.act_as.write).

## User job and state map

An operator enters a Solo workspace. The Setup read now answers when the caller holds tenant.act_as and the workspace is their own recorded act-as pointer, read-only. When it is refused or fails, the Game Plan leaves its skeleton for its error card.

## Evidence index

- `npx vitest run src/solo/data/useSoloSetupBrief.test.tsx` → 7 passed (2 red before the change).
- `npx vitest run src/solo` → 2123 passed.
- `supabase test db supabase/tests/operator_act_as_reads_solo_setup.sql` → 25/25 (behavioural cases red on the current functions; the two direct-pointer cases red on the pointer-only predicate).
- Production read-only: md5 of the current definitions of get_solo_setup_context, get_solo_business_context and solo_setup_assert_canonical_tenant equal the local stack's.
