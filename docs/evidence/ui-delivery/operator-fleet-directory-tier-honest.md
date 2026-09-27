# UI delivery evidence: operator-fleet-directory-tier-honest

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full; mode Bug or Repair, Standard depth (R1 one-flow display state, permission-sensitive); affected flow is a platform operator (super_admin or platform_admin) opening Fleet → Directory to see every tenant; Platform Operator milestone slice 3 of 5, coordinator ruling 2026-09-27 (frontend-only, no backend change, no stand-in for a future access grant)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read with UPSTREAM.md, vendor frontend-design SKILL.md, accessibility checklist, paige-quality-gates.md and review-and-testing.md; Impeccable SKILL.md, reference/operate.md, reference/clarify.md and reference/craft-floor.md read; `impeccable context --target src/operator/surfaces/FleetConsole.tsx` ran (no PRODUCT.md; narrow refinement on the incumbent implementation, allowed)
MATERIAL_FLOW_CHANGE: NO: no goal, step, control, exit or side effect changes; the same rows, chip and Enter act-as remain; only what an unread seat count displays and how it grades changes
FLOW_PROTOTYPE: NOT_REQUIRED: presentation-of-state correction inside an existing view; no new or changed action, transition or exit
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is a platform operator at either tier; job is to see every tenant and which need attention; primary action is reading the directory (Enter is secondary and unchanged)
VISUAL_DIRECTION: PASS: incumbent operator console tokens (`--pg-*`, `[data-pg]`); no new token, colour, font or component; the unread state uses the existing faint/muted ink and the existing row anatomy minus the seat bar
AUTOMATED_EVIDENCE: PASS: new src/operator/surfaces/FleetConsole.test.tsx — 3 directory tests red on the pre-change code (At risk counted 3 instead of 1; no not-visible line; no could-not-be-confirmed line); after review, fleetDetailVisible unit tests (owner/not owner/unanswered/read failed) and a header risk-count test (mutation-checked: red when the count reverts to the old grading); 9/9 green; src/operator/shell and v3 suites green (56/56)
STATIC_EVIDENCE: PASS: eslint clean on changed files; gold-discipline lint clean; `npx impeccable@4.1.0 detect` exit 0 on useFleet.ts and FleetConsole.tsx; `npm run ci:tsc` no new type errors (baseline 12, current 12); baseline-guard ok
RENDERED_EVIDENCE: PASS: harness render (local, gitignored, neutral fixtures, not live) of FleetDirectoryView at 780x700 in light and dark for three states — owner (seats read), platform_admin (not visible), check unanswered; 0 page errors, no document horizontal scroll; frames at scripts/live-drive/artifacts/fleet-dir/{owner,admin,unknown}-{light,dark}.png
BEHAVIORAL_EVIDENCE: UNVERIFIED: the directory is auth-gated; no signed-in operator session drove the deployed surface in this environment — owed to slice 5 (human-driven sessions at both tiers)
AUTHENTICATED_RUNTIME: UNVERIFIED: no operator credentials in this environment; slice 5 records Antonio Cook's super_admin session and the platform_admin holder's session against the deployed console with a production count readback
KEYBOARD_FOCUS: PASS: no control added or removed; the row buttons, internal chip and their order are unchanged; the new header line is static text
ZOOM_REFLOW: PASS: the new header line wraps (no nowrap) and the row's seat cell is shorter than before; no horizontal scroll at 780px in the harness
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: seats read (owner, both reads succeeded) — unchanged bars, counts, grades; seats not visible (platform_admin) — "seats —", Not graded unless status is not active, one header line; unconfirmed (owner check unanswered, OR the seat/client read failed even for the owner) — same row treatment, header says seat counts could not be confirmed; loading and read-error states unchanged
TRUTHFUL_STATE_LABELS: PASS: a count this session never read is no longer shown as "no seats" or graded At risk/Nominal; grading on status alone is stated in the header; the footer no longer names database columns
SOLO_UI: NO: Platform Operator console only
UNVERIFIED: the authenticated render and grading on the deployed console at both operator tiers (slice 5); whether the RLS the signal mirrors still matches production at the moment of that drive

OWNER_INTENT: coordinator ruling 2026-09-27: both operator tiers are milestone operators; a platform_admin may not see seats, clients or classification for this milestone; the fabricated At risk is the defect; render an honest not-visible state, never grade unread seats; no backend change and no stand-in for the later access decision
MUST_NOT_HAPPEN: a platform_admin seeing a number or grade built from rows it never read; any RLS, migration or RPC change; any control, stand-in or copy that anticipates a future grant of access
MUST_PRESERVE: the owner's directory exactly (seat bars, counts, Nominal/At risk grading, internal chip and filter, topology nesting, Enter act-as); loading skeleton; read-error alert
ACCEPTANCE_CRITERIA: signed in as platform_admin, the directory lists every tenant, marks only non-active-status tenants At risk, shows no seat numbers, and says once that seat counts are not visible to that role; signed in as super_admin, the directory is as before
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: owner directory grading and seat display (tested: "still grades a zero-seat active tenant At risk and a seated one Nominal"); internal filter (existing v3 test still green); Enter act-as (unchanged code path, not re-tested here); useFleet's other outputs (unchanged)

INTERNAL_BUILD_IDENTITY: 090c4161a08e18a2b3917033524eae8ad8fbfcbd; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here carries the whole code and test change; the commit after it adds only this record; vitest, eslint, ci:tsc and harness frames were run on that code
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge through the frontend deploy
RELEASE_CLASSIFICATION: internal-only: Platform Operator console, not customer-facing
CUSTOMER_RELEASE_IDENTITY: none: operator console correction, no customer release
RELEASE_NOTE_REQUIRED: NO: internal operator surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: rendered in a local harness only; the deployed console at both tiers is proven in slice 5
RELEASE_RECOVERY: position=revert the merge commit (frontend-only, no data change); reference=this PR

## Scope and collisions

- Classification: Platform Operator milestone slice 3, display-state repair.
- Affected flows: operator opens Fleet → Directory (both tiers).
- Neighboring regressions: the owner's directory view; the operator rail footer counts (`useOperatorChrome`, not mounted — unaffected).
- Active-owner/file collisions: none known on `src/operator/surfaces/FleetConsole.tsx` or `src/operator/data/useFleet.ts`.
- Explicit exclusions: client counts, status/plan text and header count truthfulness are slice 4; no change to who may read seats, clients or classification (owner-ruled to be decided after the milestone).

## User job and state map

A platform operator opens the directory to see every tenant and which need attention. Full-fleet seat and client reads are granted to the platform owner, so the directory treats counts as real only when the shell's one server answer (`useIsPlatformOwner`, passed through — no second call) says owner AND both reads succeeded (`fleetDetailVisible`), rather than inferring it from an empty result. Seats read: unchanged. Not visible: rows carry "seats —" and are graded on status alone, stated once. Check unanswered: same, and the header says access could not be confirmed. Scroll owner: the directory's own list region (`overflow-auto`), unchanged.

## Evidence index

- Red run (pre-change): `npx vitest run src/operator/surfaces/FleetConsole.test.tsx` → 3 failed, 1 passed.
- Green run: same command plus `src/operator/surfaces/operatorLayer3e.v3.test.tsx` → 8 passed.
- `npm run ci:tsc` → no new type errors (12/12).
- Harness frames (not live): `scripts/live-drive/artifacts/fleet-dir/*.png`; contrast of the new text against the workspace ground: header line 5.47:1 light / 7.61:1 dark; "Not graded" and "seats —" 5.23:1 light / 5.82:1 dark.

## Review and limitations

Independent adversarial review (§39) returned SHIP-after-F1 with 6 findings, handled before push: F1 MAJOR (a failed seat read would still grade zeros for the owner) fixed via `detailReadFailed` + `fleetDetailVisible`; F2 test gaps fixed (risk-count and visibility-rule tests); F3 header copy aligned with the rows; F4 comment corrected (reads are granted to the owner and within the caller's own tenants; restrictive policy wording removed); F5 duplicate owner RPC removed — the shell's `useIsPlatformOwner` answer is passed through (the ignored `canSeeRevenue` prop is replaced); F6 (pre-existing: the seat read has no row cap handling past 1,000 rows) recorded for settlement, not in scope. Every on-screen claim for the deployed console is `UNVERIFIED` until slice 5.
