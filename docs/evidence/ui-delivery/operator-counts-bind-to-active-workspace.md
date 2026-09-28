# UI delivery evidence: an operator acting as a workspace sees only that workspace's knowledge and counts

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read for this milestone; flow is an operator (or a member of several workspaces) viewing a workspace's Knowledge, Game Plan knowledge tile and department counts
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read for this milestone; no element, copy, layout or motion changes
MATERIAL_FLOW_CHANGE: NO: no state, transition or exit changes; the same surfaces show the active workspace's rows instead of every workspace RLS admits
FLOW_PROTOTYPE: NOT_REQUIRED: no visible element changes
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a super_admin acting as a workspace, and a member of several workspaces; primary action is reading that workspace's knowledge and open work
VISUAL_DIRECTION: PASS: no visual change
AUTOMATED_EVIDENCE: PASS: src/hooks/__tests__/tenantScopedCounts.test.tsx two cases fail before the change (no tenant filter issued on tenant_knowledge_docs or paige_actions) and pass after, one pins that no filter is added with no active workspace; full suite 5963 passed
STATIC_EVIDENCE: PASS: ci:tsc 12/12 baseline; eslint 0 errors (one react-refresh warning of the kind main already raises in useTenantContext.tsx); lint:tier-features and lint:operator-reach clean
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered element changes; the lists and counts render from narrower data
BEHAVIORAL_EVIDENCE: UNVERIFIED: the filters are proven in unit tests; a super_admin session counting one workspace's rows has not been driven
AUTHENTICATED_RUNTIME: UNVERIFIED: requires a human operator session on production after deploy
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: active workspace → that workspace's rows; no active workspace → unchanged; workspace switch → the previous workspace's counts are never shown (snapshot keyed on the workspace)
TRUTHFUL_STATE_LABELS: PASS: a workspace's knowledge count and department counts no longer include other workspaces
SOLO_UI: YES: src/solo/data/useSoloKnowledge.ts (data hook behind Knowledge, the Game Plan knowledge tile and the PAIGE workspace); no Solo component, layout or geometry changes
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: data-hook change only — it narrows which rows the knowledge list and department counts show; no Solo component, layout, geometry or scroll owner changes at any viewport, PAIGE open or closed
UNVERIFIED: a real super_admin session inside a workspace after deploy; owed with the remaining live-drive items

OWNER_INTENT: owner 2026-09-28: operate on everything that has to do with the platform operator; the counts an operator sees inside an act-as must be the entered workspace's (§9/§57)
MUST_NOT_HAPPEN: another workspace's documents listed or counted as the entered workspace's; the filter treated as authority
MUST_PRESERVE: RLS as the authority; behaviour with no active workspace; the department epoch guard
ACCEPTANCE_CRITERIA: acting as a workspace, its knowledge list and department counts contain only its rows
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: usePaigeDeptStatus accountEpoch contract (existing tests pass); useTenantContext throw-on-mis-mount unchanged (the new accessor is separate)

INTERNAL_BUILD_IDENTITY: d9a14b18ab092630c3a15d90db879a7da1643f3e; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here (tree 9481807bddfcf4153a2e00bad38eb002e26ec44c) holds this PR's code and tests
RELEASE_CHANNEL: development: operator act-as correctness, merged on green per CLAUDE.md §4 pre-launch stance
RELEASE_CLASSIFICATION: internal-only: operator and multi-workspace member views; no customer-visible change for a single-workspace member
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-visible change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-proven; a live super_admin session owed after deploy
RELEASE_RECOVERY: position=revert the merge (frontend only, no migration); reference=this PR

## Scope and collisions

- Classification: operator act-as correctness (§9/§57), found tracing the owner's live drive.
- Affected flows: Knowledge, the Game Plan knowledge tile, the PAIGE workspace, and every surface reading department counts, while a workspace is active.
- Neighboring regressions: none; full suite green.
- Active-owner/file collisions: #1554 (mine) touches useSoloSetupBrief only.
- Explicit exclusions: server policies are unchanged (a super_admin's cross-tenant read stays, per the owner's ruling that it is the deliberate-access path).

## User job and state map

Inside a workspace, its knowledge and open work are that workspace's. At rest, nothing changes.

## Evidence index

- `npx vitest run src/hooks/__tests__/tenantScopedCounts.test.tsx` → 3 passed (2 red before).
- `npx vitest run` → 5963 passed.
