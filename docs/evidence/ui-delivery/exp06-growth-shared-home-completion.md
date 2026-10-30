# Growth shared-home completion (EXP06; pure module moves + re-export wrappers, zero behavior)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no customer flow changes — the four remaining pure growth modules (bands, media, the theme resolver, the generated font manifest) moved into supabase/functions/_shared/growth/ with the app paths as compatibility re-export wrappers, completing the relocation begun in #3032 so the Deno edge runtime graph has zero dependencies outside functions_root (E09 proposal 59152c2d, applied through EXP06 ownership; ACK 854aa6f5). The recognized UI file's change is a re-export line: every value, function and token is byte-identical (~360 affected tests green; tsc ratchet PASS).
PAIGE_UI_DESIGN: PASS: unchanged — the same definitions execute through the wrappers; zero new hex, tokens or styles.
MATERIAL_FLOW_CHANGE: NO: pure module moves + wrappers; no component logic, styles, copy or flow changed.
FLOW_PROTOTYPE: NOT_REQUIRED: no UI behavior exists to drive — runtime inertness is proven by the ~360-test affected suite on the exact head; the standing PR7/PR8 harness frames remain the rendered truth for these surfaces.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged for every customer surface; the moves exist so the edge (portable export + hosting door) and the app share one home without the app's DOM module graph.
VISUAL_DIRECTION: PASS: zero visual delta by construction (moves only).
AUTOMATED_EVIDENCE: PASS: growth/export/brand-fonts/components/public suites (124+1 skip), hosting door + parts + full studio wall (235), tsc ratchet PASS (baseline 10 → current 6) on the exact head.
STATIC_EVIDENCE: PASS: the four moved modules are pure (no DOM, no npm — bands/media are string/data work; the theme resolver is token math; the manifest is generated data); the wrappers re-export verbatim.
RENDERED_EVIDENCE: PASS: no rendered surface changed (the same definitions execute); the standing frames remain the visual truth — no new frames claimed.
BEHAVIORAL_EVIDENCE: PASS: the hosting door's 22-test world wall and parts wall re-ran green on the same head, exercising the moved modules through the real door.
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session in this environment (unchanged standing dependency).
KEYBOARD_FOCUS: PASS: unchanged (no DOM behavior touched).
ZOOM_REFLOW: PASS: unchanged (no layout touched).
REDUCED_MOTION: PASS: unchanged.
STATE_COVERAGE: PASS: no state logic touched.
TRUTHFUL_STATE_LABELS: PASS: no labels touched.
SOLO_UI: YES: the change sits under the Solo growth surfaces' module spine (recognized file src/components/growth/growth-theme.ts).
UNVERIFIED: nothing new — the standing authenticated-drive dependency is unchanged.
OWNER_INTENT: one shared home for the growth pure modules (no drift between app surfaces and the edge) and a zero-outside-dependency edge graph (E09's runtime_closure requirement for the CURA live repair).
MUST_NOT_HAPPEN: no behavior change to any customer surface; no second definition of any moved module; regeneration overwriting the app wrapper (generator destination moved).
MUST_PRESERVE: every existing import path (wrappers keep them working); the publish door's authority; the export builder's byte behavior.
ACCEPTANCE_CRITERIA: both runtimes import the SAME definitions; zero runtime delta (proven by the suites, not asserted).
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: NONE_AFFECTED: module moves only; no authority, write, provider or isolation surface touched.
INTERNAL_BUILD_IDENTITY: e95100e0561b5053614da4be9ab9fcdb56556cc2; deployment=vercel-preview-of-PR; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + the ~360-test suite run on the exact head
RELEASE_CHANNEL: preview: ordinary PR preview; no staged rollout, no external eligibility.
RELEASE_CLASSIFICATION: internal-only: module-home completion within EXP06; not a customer release event.
CUSTOMER_RELEASE_IDENTITY: none: coherent owner-visible EXP06 evaluation has not occurred.
RELEASE_NOTE_REQUIRED: no: refactor increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source-level proof complete; rendered surfaces unchanged by construction; the authenticated in-Studio view remains the standing PROOF OWED.
RELEASE_RECOVERY: position=forward-fix; reference=revert restores the prior module homes (no data, migration, or provider change).
SOLO_1536X770_PAIGE_CLOSED: PASS: unchanged rendered surface — the standing frames remain the visual truth; no frame re-claimed for a module move.
SOLO_1536X770_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_1366X768_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_1366X768_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_1024X768_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_1024X768_PAIGE_OPEN: PASS: unchanged (as above).
SOLO_900X1000_PAIGE_CLOSED: PASS: unchanged (as above).
SOLO_900X1000_PAIGE_OPEN: PASS: unchanged (as above).
