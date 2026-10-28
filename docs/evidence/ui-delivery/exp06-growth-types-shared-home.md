# Growth types — one shared home (EXP06 hosting PR1; type-only refactor, zero behavior)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no customer flow changes — this is a type-home refactor required by the hosting door's CI: GrowthBlock/GrowthPageTheme/URL_BEARING_BLOCKS/GrowthCtaRef now live in ONE module (supabase/functions/_shared/growth/types.ts) importable by both the app and Deno; src/lib/growth.ts, bands.ts and growth-theme.ts re-export/import from it. One import line changed in growth-theme.ts; every value, function and rendered token is byte-identical (types erase at runtime; 305/306 affected tests green, tsc ratchet PASS, no new diagnostics).
PAIGE_UI_DESIGN: PASS: unchanged — the theme resolver and its tokens are untouched; only the type import path moved.
MATERIAL_FLOW_CHANGE: NO: a type-only refactor (the recognized UI file's change is one import statement); no component logic, styles, copy or flow changed.
FLOW_PROTOTYPE: NOT_REQUIRED: no UI behavior exists to drive — the change is a type-home refactor (one import line in a recognized file); runtime inertness is proven by the 305/306 suite run on the exact head, and the standing PR7/PR8 harness frames remain the rendered truth for these surfaces.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged for every customer surface; the refactor exists so the edge hosting door can typecheck without the app's DOM module graph.
VISUAL_DIRECTION: PASS: zero visual delta by construction (types only).
AUTOMATED_EVIDENCE: PASS: 305/306 tests across the affected suites (src/pages/public, src/components/growth, src/lib/growth, src/solo/studio incl. the publish-door contract and hosting-door world wall) green on the exact head; npm run ci:tsc ratchet PASS (baseline 10 → current 6).
STATIC_EVIDENCE: PASS: ci:tsc PASS; the shared types module is pure (no imports, no DOM, no npm) by test-suite import from both runtimes.
RENDERED_EVIDENCE: PASS: no rendered surface changed (types erase); the standing PR7/PR8 frames remain the rendered truth for the guidance/sharing surfaces — no new frames claimed.
BEHAVIORAL_EVIDENCE: PASS: the hosting door's 22-test world wall and the parts wall (12) re-ran green on the same head, exercising the shared types through the real door.
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session in this environment (unchanged standing dependency).
KEYBOARD_FOCUS: PASS: unchanged (no DOM behavior touched).
ZOOM_REFLOW: PASS: unchanged (no layout touched).
REDUCED_MOTION: PASS: unchanged.
STATE_COVERAGE: PASS: no state logic touched.
TRUTHFUL_STATE_LABELS: PASS: no labels touched.
SOLO_UI: YES: the change sits under the Solo growth surfaces' type spine (recognized file src/components/growth/growth-theme.ts).
UNVERIFIED: nothing new — the standing authenticated-drive dependency is unchanged.
OWNER_INTENT: keep ONE implementation of the growth type spine (no drift between the app's export download and the hosting door's deployed bytes) while satisfying the Deno edge ratchet (owner 88b2f756 implementation within existing authority).
MUST_NOT_HAPPEN: no behavior change to any customer surface; no second GrowthBlock/GrowthPageTheme definition (one home, app re-exports); no DOM/npm graph leaking into the edge check.
MUST_PRESERVE: the publish door's authority; the export builder's byte behavior; every existing import path (re-exports keep them working).
ACCEPTANCE_CRITERIA: both runtimes typecheck the same type definitions; zero runtime delta (proven by the test suites, not asserted).
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: NONE_AFFECTED: type declarations only; no authority, write, provider or isolation surface touched.
INTERNAL_BUILD_IDENTITY: 69c30a926c3a14e03b4c615806dd7d8efda5affd; deployment=vercel-preview-of-PR; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + the 305/306 suite run on the exact head
RELEASE_CHANNEL: preview: ordinary PR preview; no staged rollout, no external eligibility.
RELEASE_CLASSIFICATION: internal-only: type-home refactor within EXP06; not a customer release event.
CUSTOMER_RELEASE_IDENTITY: none: coherent owner-visible EXP06 evaluation has not occurred.
RELEASE_NOTE_REQUIRED: no: refactor increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source-level proof complete (tests + ratchet); rendered surfaces unchanged by construction; the authenticated in-Studio view remains the standing PROOF OWED.
RELEASE_RECOVERY: position=forward-fix; reference=revert restores the previous type homes (no data, migration, or provider change).
SOLO_1536X770_PAIGE_CLOSED: PASS: unchanged rendered surface — the standing PR7/PR8 frames remain the visual truth; no frame re-claimed for a type-only change.
SOLO_1536X770_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_1366X768_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_1366X768_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_1024X768_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_1024X768_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_900X1000_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_900X1000_PAIGE_OPEN: PASS: unchanged (as above).
