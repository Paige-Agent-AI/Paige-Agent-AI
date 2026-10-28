# Stale-deployment screen recovery — a failed Try again converts to Reload (PR12 / EXP04 b0d8f65d)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no journey changes — the lazy-screen loading/recovery flow keeps its steps; the only change is which honest card a person sees when a screen download fails TWICE (first failure unchanged: Try again + Reload; after a failed Try again: the stale-deployment card with Reload PAIGE as the only action). The recovery the person needs is now the one the card leads with.
PAIGE_UI_DESIGN: PASS: existing card design (same container, tokens, type scale); the new copy is the same honest-voice family as the existing boundary cards.
MATERIAL_FLOW_CHANGE: NO: error-path presentation refinement inside one existing flow; no new goal, state machine, exit or consequence.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner whose screen fails to open after a deployment update presses the one action that actually works (Reload PAIGE) instead of a retry that deterministically fails; the card tells them their unsent PAIGE message is kept.
VISUAL_DIRECTION: PASS: existing tokens only.
AUTOMATED_EVIDENCE: PASS: failing-first regression pins EXP04's exact sequence (first failure → both actions + original copy; failed Try again → "PAIGE may have been updated." card, Try again absent, draft note present; navigation reset still recovers); ScreenLoadBoundary suite 5/5; affected suites 61/61 (settings-mount, operations-retention, finance-navigation, shell-ownership); tsc-ratchet clean; build + solo-entry-size-guard PASS.
STATIC_EVIDENCE: PASS: non-author review verified the state machine attempt-by-attempt (incl. React 18.3.1's lazy-cached rejection making the retry-then-stale sequence deterministic, and boundary remount on screen switch), the rethrow layering for non-download errors, and — directly in source — that the composer draft session store persists across a real browser reload (sessionStorage round-trip suite), which is exactly what the copy promises.
RENDERED_EVIDENCE: UNVERIFIED: the changed surface is a transient double-failure error card on the lazy screens; no steady-state render changed and no rendered capture of the error path exists (the tmp-capture harness covers steady states). The behavioral suite pins every shown string and action; a rendered error-state capture remains a possible future addition.
BEHAVIORAL_EVIDENCE: PASS: driven by the real component with real dynamic imports (data hooks mocked as in the incumbent suites); deleting the retryFailed logic fails the test (the Try-again-absent assertion).
AUTHENTICATED_RUNTIME: UNVERIFIED: EXP04's authorized-owner observation (b0d8f65d) is the real-world trigger evidence; an authenticated double-failure observation on the designated ordinary account is the founder window's leg.
KEYBOARD_FOCUS: PASS: buttons remain ordinary focusable controls; no trap introduced.
ZOOM_REFLOW: NOT_APPLICABLE: small single card, same container as the existing boundary card.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: both failure presentations (first + stale) and the navigation-reset recovery pinned; the successful-retry path remains covered by the incumbent first test.
TRUTHFUL_STATE_LABELS: PASS: the stale card says "may have been updated" (a cached transient rejection also fails the retry — the softer claim is the true one) and promises only what source proves: the unsent PAIGE draft survives reload (session store) and saved data is unaffected; it promises nothing about unsaved non-PAIGE screen state.
SOLO_UI: YES: the Solo shell's lazy-screen error card.
UNVERIFIED: authenticated double-failure observation on the ordinary account (founder window); rendered error-state capture.

OWNER_INTENT: fix the EXP04-reported recovery gap (ANT-50 b0d8f65d): after a deployment retires a hashed chunk, Try again deterministically fails and the card never said which action works.
MUST_NOT_HAPPEN: a recovery dead-end (a retry button that cannot succeed); copy claiming a certainty the failure does not prove; any promise about unsaved non-PAIGE state; other lanes' files.
MUST_PRESERVE: the rethrow layering (render errors still belong to SoloScreenBoundary); both-actions-first presentation; navigation reset; the #2769 draft-survival guarantee the copy cites.
ACCEPTANCE_CRITERIA: EXP04's sequence now leads to the working recovery; all incumbent suites green.
MOTION_PURPOSE: NONE.

## Scope and collisions

- Classification: Solo shell error-path recovery (2 files: SoloApp.tsx boundary, its test; this record). E01-owned (the boundary shipped in #2884); no other lane's file.
- The evidence record exists because the ui-delivery gate recognizes src/solo/SoloApp.tsx (the PR body's initial contrary claim was wrong — corrected in the review disposition; thanks to the reviewer's refutation).

## Evidence index

- vitest: `node node_modules/vitest/vitest.mjs run src/solo/SoloApp.screenLoadBoundary.test.tsx` → 5/5 (4 incumbent + the EXP04-sequence regression).
- Trigger evidence: ANT-50 comment b0d8f65d (EXP04 authorized-owner QA); ACK 7d9163ed posted before the fix.
- Draft-survival source: src/lib/paigeComposerScopeState.ts (sessionStorage `paige.composer.drafts.v1`, owner-scoped, TTL) + its session round-trip suite; #2769 integration test.

INTERNAL_BUILD_IDENTITY: 316fe798658d247b0523c348209f47d9f0c7fd1e; deployment=undeployed at authoring (ships with the next web build; readback follows); environment=local vitest + CI; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record + the boundary suite
RELEASE_CHANNEL: development: merges through the normal PR gate.
RELEASE_CLASSIFICATION: internal-only: pre-evaluation recovery repair.
CUSTOMER_RELEASE_IDENTITY: none: internal-only recovery repair ahead of the founder evaluation window — no coherent owner-visible outcome ships alone here.
RELEASE_NOTE_REQUIRED: no: error-path recovery refinement; no journey change.
RELEASE_TRUTH_BOUNDARY: PARTIAL: behavior suite-proven + source-verified draft survival; rendered error-state and authenticated observation UNVERIFIED.
RELEASE_RECOVERY: position=forward-fix; reference=this record + the ANT-50 thread (b0d8f65d → 7d9163ed → repair reply)
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no steady-state visual change; the changed card is a transient error state (behavioral suite pins its strings/actions).
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same rationale.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no steady-state visual change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no steady-state visual change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no steady-state visual change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no steady-state visual change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no steady-state visual change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no steady-state visual change.
