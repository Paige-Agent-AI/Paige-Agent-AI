# UI delivery evidence: operator-fleet-directory-row-data

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full; mode Existing Project extension, Standard depth; affected flow is a platform operator reading Fleet → Directory; Platform Operator milestone slice 4 of 5, coordinator-approved 2026-09-27 (client count and status text already read, truthful header counts per tier, no MRR)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design and routed references read for this milestone; Impeccable read and applied (installed .agents/skills/impeccable, upstream https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md): SKILL.md, reference/operate.md, reference/clarify.md and reference/craft-floor.md; `impeccable context` ran on FleetConsole.tsx (narrow refinement of the incumbent); checks applied — Operate accent rule "accent for primary actions, current selection and state indicators only, not decoration" (the resting seat bar moved off gold to muted: met), "state-rich semantic vocabulary, standardize these" (status words come from the platform's own STATUS_META map, not new strings: met), "consistent affordances, same form-control vocabulary" (no new control; a disabled chip that could never act is removed rather than left focusable: met), clarify (the header states what the at-risk figure includes at each tier: met), and `npx impeccable@4.1.0 detect` exit 0
MATERIAL_FLOW_CHANGE: NO: no goal, step or exit changes; rows gain two read-only facts, the header count wording changes, and a chip that could never act at the platform_admin tier is no longer offered there
FLOW_PROTOTYPE: NOT_REQUIRED: read-only presentation of data the view already fetched; no new action or transition
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a platform operator scanning every tenant to see which need attention and why
VISUAL_DIRECTION: PASS: incumbent `--pg-*` tokens and row anatomy; new facts use the existing muted mono/label styles; the resting seat bar moves from `--pg-gold-deep` to `--pg-muted` because gold is spent only on the act (§11), which a seat bar is not
AUTOMATED_EVIDENCE: PASS: 4 new tests in src/operator/surfaces/FleetConsole.test.tsx red on the parent tree (4 failed, 9 passed: no client counts, no status note, "— at risk" for platform_admin, "— live" header) and green after; after review, 4 more (lapsed trial counts elapsed days without rounding up, lapsed within the day reads "ended today", status labels from the platform map incl. Past due/Suspended, at-risk figure marked "internal included" when classification is unreadable); FleetConsole.test.tsx 17/17, with operatorLayer3e.v3 21/21; src/operator 245/245 per the reviewer's run before the review fixes
STATIC_EVIDENCE: PASS: eslint clean on changed files; gold-discipline lint clean on changed files (as CI scopes it — the repo-wide `npm run lint:gold` fails on a pre-existing finding in BusinessCreditDashboard.tsx:271 on both trees); `npx impeccable@4.1.0 detect` exit 0; `npm run ci:tsc` no new type errors (12/12)
RENDERED_EVIDENCE: PASS: harness render (local, gitignored, neutral fixtures, not live) at 780x700, light and dark, owner / platform_admin / check-unanswered; 0 page errors; no document horizontal scroll; frames scripts/live-drive/artifacts/fleet-dir/*.png
BEHAVIORAL_EVIDENCE: UNVERIFIED: auth-gated; not driven on the deployed console here — owed to slice 5
AUTHENTICATED_RUNTIME: UNVERIFIED: no operator credentials here; slice 5's human-driven sessions at both tiers
KEYBOARD_FOCUS: PASS: the internal chip remains a real button where offered; at platform_admin a disabled button that could never act is removed rather than left focusable; row buttons unchanged
ZOOM_REFLOW: PASS: the row's detail line is flex-wrap, so added facts wrap rather than overflow; no horizontal scroll in the harness at 780px
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: counts readable (clients shown as n / no clients); not readable (no client figure, header says so); non-active status named (Trial with days left, ends today, ended today, or ended n days ago counted in whole elapsed days; Canceled, Past due, Suspended); active not repeated; loading and read-error unchanged
TRUTHFUL_STATE_LABELS: PASS: the at-risk count is computed from the rows on screen at both tiers; the platform_admin header states internal accounts are included instead of a dash; no chip claims a filter the session cannot apply
SOLO_UI: NO: Platform Operator console only
UNVERIFIED: the deployed render at both operator tiers and the on-screen tenant count against a production readback (slice 5)

OWNER_INTENT: coordinator ruling 2026-09-27, slice 4: directory rows carry the real data already read — client count and status — and header counts read truthfully for each tier; no MRR (billing visibility is later)
MUST_NOT_HAPPEN: any new read, backend change, or revenue figure; a client figure shown to a role that cannot read clients; a header that disagrees with the rows beneath it
MUST_PRESERVE: slice 3's honest not-visible state; the owner's internal filter and chip; topology nesting; Enter act-as
ACCEPTANCE_CRITERIA: as super_admin each row shows seats, clients, grade and any non-active status, and the header's at-risk count equals the At risk tags shown; as platform_admin each row shows grade and any non-active status with no seat or client figure, and the header says how many tenants are listed with internal accounts included
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: owner grading and seat display (tested); internal filter and chip for the owner (existing v3 test green); slice 3 not-visible behaviour (its tests green); useFleet (unchanged in this slice)

INTERNAL_BUILD_IDENTITY: 88f5c7ea51a9ba9d42d85a52a90a45099bab6f4c; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=the commit named here carries the whole code and test change; the commits after it change only this record or merge main in after slices 3 and 2 merged; vitest, eslint, ci:tsc and harness frames were run on that code
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge through the frontend deploy
RELEASE_CLASSIFICATION: internal-only: Platform Operator console
CUSTOMER_RELEASE_IDENTITY: none: operator console improvement, no customer release
RELEASE_NOTE_REQUIRED: NO: internal operator surface
RELEASE_TRUTH_BOUNDARY: PROOF OWED: harness render only; deployed proof at both tiers in slice 5
RELEASE_RECOVERY: position=revert the merge commit (frontend-only); reference=this PR

## Scope and collisions

- Classification: Platform Operator milestone slice 4.
- Affected flows: operator reads Fleet → Directory (both tiers).
- Neighboring regressions: the owner's directory; slice 3's not-visible state.
- Active-owner/file collisions: none known.
- Explicit exclusions: plan is not shown (every production tenant's `plan_offer` is null today, so a column would render empty); MRR and billing are later; the grading rule itself (a trial counts as At risk because its status is not active) is unchanged and routed as a finding.

## User job and state map

Scan every tenant, see which need attention and why. Status labels and trial days come from `src/lib/platform/tenantLifecycle.ts` (`STATUS_META`, `trialDaysLeft`) so the words match the rest of the platform. Scroll owner: the directory list region, unchanged.

## Evidence index

- Red: `npx vitest run src/operator/surfaces/FleetConsole.test.tsx` on the parent tree → 4 failed, 9 passed.
- Green: FleetConsole.test.tsx → 17 passed; with operatorLayer3e.v3.test.tsx → 21 passed.
- Production read (aggregate, read-only): tenants by status — trial 3, active 10, canceled 3; `plan_offer` null on all 16.
- Frames (not live): `scripts/live-drive/artifacts/fleet-dir/{owner,admin,unknown}-{light,dark}.png`.

## Review and limitations

Independent adversarial review (§39): no blocker; one MAJOR fixed before push — a lapsed trial's elapsed days were rounded up (production's one dated trial, 9.2 days lapsed, would have read "ended 10 days ago"); MINORs fixed — "0 days left" now "ends today", the platform_admin at-risk figure now says internal accounts are included, a status-label test added, evidence counts and the gold-lint claim corrected. Recorded, not changed: the client and seat reads are row reads capped at the API's default row limit, so per-tenant counts would undercount past that cap (9 clients and 16 memberships on production today); a status outside the platform's label map would show its stored value (none exists on production). Deployed behaviour is `UNVERIFIED` until slice 5.

Base change: this PR was stacked on slice 3 and is now based on main after slices 3 (#1505) and 2 (#1506) merged; main was merged in rather than rebased, so the code commit named above is unchanged. Before its Codex review, the Impeccable citation above was expanded to name the upstream source and the checks applied, matching the finding raised on slice 2.
