# UI delivery evidence: contact-methods-guard-and-dead-code

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Audit mode, Standard depth, follow-up to the contact-methods lane (PRs 1576, 1583, 1585, 1584, 1582, 1586). Actor-goal flow guarded: a Solo owner or admin fixes a person's emails or phones once and every surface reads the same list. A read-only audit of main 76216dd92 (a finder, then an independent verifier that re-derived the result from production function bodies and view dependencies, not migration text) found no reachable code reading or writing clients.email/phone or profiles.work_email/phone as a person's address. This change acts on what that audit found: the frontend guard was guarding a dead file and missing its live successor, and three unreachable files contradicted the one-list model. Reachability (§71): each deleted file was proven imported by nothing across static imports, lazy(), import(), relative paths and route tables; the live Solo Setup is src/solo/settings.tsx (SoloSettings → SoloBusinessContextSetup), already recorded as mounted in team-setup-contact-methods.md and profiles-contact-methods-readers.md.
PAIGE_UI_DESIGN: PASS: Read the paige-ui-design router for this session. No visible surface changes: the change deletes unmounted modules and rewrites a test; two code comments and two docs that named the deleted file are corrected. Nothing renders differently, so no design decision is made here.
MATERIAL_FLOW_CHANGE: NO: no goal, state, transition or exit changes on any mounted surface; the deleted modules are reachable from no route.
FLOW_PROTOTYPE: NOT_REQUIRED: deletion of unreachable code and a test rewrite; there is no interaction to decide.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Purpose — keep "one list per person" true as the codebase moves: the guard must follow renamed and new files, and no dormant screen may drop address edits if remounted. Audience — engineers and CI; Solo owners only indirectly. Primary action — none (no visible change).
VISUAL_DIRECTION: PASS: unchanged; no visible change to direct.
AUTOMATED_EVIDENCE: PASS: `npx vitest run src/__tests__/clients-contact-methods-frontend.test.ts` — 100 passed (97 files guarded, found by scanning src/, against 27 in the old hand-written list; the five old-list files the scan no longer selects have no clients/profiles chain or clients( embed, so the old per-file test asserted nothing for them either — confirmed by the independent reviewer). Failing-first: a planted `.from("clients").select("id, email")` appended to src/solo/useSoloCommercialTerms.ts fails it (1 failed, 99 passed: "names \"email\""), then restored; the old list did not include that file, so it would have passed. `npx vitest run src/components/tenant-shell/TenantRouteOwnerAccountContext.integration.test.tsx` — 14 passed after removing its vi.mock of the deleted module. `npx vitest run src/__tests__/solo-completion-matrix.test.ts` — 15 passed with the orphan registry at 22 and the doc's totals updated to match. Whole suite, `npx vitest run` on this change: 495 files, 7,349 tests, all passed (exit 0); main 76216dd92 is green in hosted CI.
STATIC_EVIDENCE: PASS: `npx tsc --noEmit -p tsconfig.app.json` — 12 errors on main 76216dd92 and 12 on this change; `node scripts/ci/baseline-guard.mjs` — "tsc baseline did not grow (base 11 sigs → head 11 sigs)", alias baseline 52 → 52; `npm run build` (vite build) — exit 0, built in 39.27s; eslint on both changed test files — 0 problems; the independent reviewer additionally ran lint:solo-parity, lint:tier-features, lint:alias-ratchet, lint:legacy-mark, lint:skeleton, lint:shadow-vars, lint:write-targets, lint:operator-reach, lint:user-facing-admin-urls, lint:approval-direct-write, lint:approval-gate, lint:readiness-copy, lint:pg-tokens and lint:title-authority — all pass.
RENDERED_EVIDENCE: NOT_APPLICABLE: no mounted surface changes; the deleted modules render nowhere.
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: no mounted behaviour changes; the deleted modules are reachable from no route or caller.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated session in this environment. Affected claims: none of this change's own — it removes unreachable code. The lane's authenticated proof (an owner edits a person's addresses, creates a contact with addresses, and a dependent screen shows the same list) is owed separately by the owner's live check.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable control added, removed or changed on a mounted surface.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed.
STATE_COVERAGE: NOT_APPLICABLE: no state of any mounted surface changes.
TRUTHFUL_STATE_LABELS: PASS: removes the one place that could have lied about addresses — the retired Solo Setup owner drawer passed work_email/phone to saveOwner, which ignores them, and would have shown "Profile saved." for an edit it dropped had it been remounted.
SOLO_UI: YES: deleted unmounted Solo modules src/solo/setup.tsx and src/solo/useSoloAgreements.ts; no Solo surface renders differently.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no mounted Solo surface changes; the deleted modules are reachable from no route.
UNVERIFIED: none for this change's own claims, which are proven at automated and static class (unreachability by search, the guard by a planted failure, the build, the type ratchet). The lane's authenticated end-to-end proof remains owed by the owner's live check.

OWNER_INTENT: An owner or admin fixes a person's contact details once and sees them correct everywhere, instantly; the proof that no screen reads or writes the old single-value columns must keep holding as files are renamed and added.
MUST_NOT_HAPPEN: A mounted surface or capability is removed; the guard stops covering a file it covered before; CI turns red.
MUST_PRESERVE: Every mounted Solo surface, including Setup (src/solo/settings.tsx); src/pages/admin/IntegrationsHub.tsx, which two unrelated guard tests read as source; the guard's per-file assertions and the inbox assertions, unchanged.
ACCEPTANCE_CRITERIA: CI green on this PR; the guard fails when any non-test src file selects, filters or writes clients.email/phone or profiles.work_email/phone, including files it has never been told about.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Impacted and tested — the frontend address guard (planted failure), TenantRouteOwnerAccountContext's module mocks (integration test passes), the Solo completion matrix orphan registry and its doc count (matrix test passes). Unaffected, named — every mounted Solo route in SoloApp.tsx, Agency's own src/agency/setup.tsx (a comment only), the edge-function address guard in src/__tests__/contact-methods-edge.test.ts.

INTERNAL_BUILD_IDENTITY: 52257b408cd983d73bd5100e12c6a5eef44f7e67; deployment=NOT_DEPLOYED-merges-to-main-then-Vercel; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/contact-methods-guard-and-dead-code.md and the PR checks
RELEASE_CHANNEL: development: branch build and CI; the merge ships a frontend bundle without the deleted unreachable modules
RELEASE_CLASSIFICATION: internal-only: removal of unreachable code and a test guard; nothing a user sees changes
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change
RELEASE_NOTE_REQUIRED: NO: no customer-facing change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: this change itself is internal (unreachable code removed, a test guard widened) and claims nothing a user sees; the contact-methods lane's end-to-end production behaviour is PROOF OWED pending the owner's live check.
RELEASE_RECOVERY: position=revert the commit (no migration, no data change, no mounted surface depends on the deleted files); reference=this record

## Scope and collisions

- Classification: deletion of unreachable code plus a test-guard rewrite; follow-up to the contact-methods lane audit.
- Affected flows: none mounted. Guarded flow: a person's addresses are read and written only through client_contact_methods / user_contact_methods.
- Neighboring regressions: checked by the audit — no reachable reader or writer of the old columns on main 76216dd92.
- Active-owner/file collisions: none; src/solo/setup.tsx and src/solo/useSoloAgreements.ts have no importers, and the Apollo settings page was retired by PR 1586.
- Explicit exclusions: src/pages/admin/IntegrationsHub.tsx (unmounted, but read as source by two unrelated guard tests); the operator support panels that select a non-existent profiles.email (src/components/support/*, unmounted; outside the Solo scope); the paige-bridge inbound sync re-promoting the mirrored email and phone to primary (a SQL fix that needs a new migration and owner authorization).

## User job and state map

No visible job, state or exit changes. The guarded job: a Solo owner or admin edits a person's addresses once and every surface shows the same list.

## Evidence index

- Audit (read-only, main 76216dd92): finder and independent verifier reports in the session record; production reads were SELECT-only on pg_proc, pg_depend/pg_rewrite and row counts.
- Independent review of the change: FIX-FIRST on this record's absence (ui-delivery-evidence counts deletions as UI changes), otherwise no findings; stale references it listed are corrected in this change.
- Commands: as listed under AUTOMATED_EVIDENCE and STATIC_EVIDENCE.
