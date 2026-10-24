# UI delivery evidence: E01 first-value core (ALG-02 / ALG-13 integration)

**2026-10-18 zCod E01 slice.** The deterministic ALG-02/ALG-13 integration: a pure, versioned module (`first-value-recommendation.ts`, FIRST_VALUE_LOGIC_VERSION 1) computes grounded first-value state and ranked explainable next-best-actions from owner-confirmed Setup facts plus canonical identity status; the interview panel renders it as a truthful "Where you actually are" section above the existing next-steps handoffs. The chat conversation remains the richer explainable layer; this core guarantees the deterministic floor — never fabricated engagement, never a capability claim without a real status input. ALG-03 business-health scoring and COO intelligence remain EXP02's; model routing (ALG-11) remains the Model Fabric's — nothing here duplicates them.

UI_DELIVERY_EVIDENCE_VERSION: 1

## Owner Intent & Experience Contract

OWNER_INTENT: an ordinary SOLO owner sees, at a glance in the interview panel, what is genuinely achieved (with the input that proves it) and the ranked next actions PAIGE can actually help take — explainable from their own confirmed words, honest about what needs setup or is not yet available, dismissible without pressure.
MUST_NOT_HAPPEN: no fabricated achievement or engagement; no capability/eligibility claim without a grounded status input; the first-action line never shows as achieved without its receipt; no new preference store (dismissal is visit-local and says so); no compulsive re-prompting (snoozed actions stay hidden for the visit; the foundational priority action is never dismissible because everything derives from it).
MUST_PRESERVE: the incumbent panel (facts, prompts, handoffs, editor, unknown-save withholding) byte-identical; the four-class availability contract; the existing identity RPC's authority (published routing is NOT claimed — the RPC does not expose it).
ACCEPTANCE_CRITERIA: no confirmed priority → exactly one foundational ask and nothing else; confirmed inputs → deterministic ranked actions (≤4) whose reasons quote those inputs; achieved items each carry evidence; dismissal hides for the visit with honest copy; the section withholds during edits and unknown saves exactly like its siblings.

## Capability routing — pre-edit

1. Outcome: grounded next-steps visibility — E01's own ALG-02/13 integration over existing seams.
2. Domain owner: E01; deterministic core is E01-local (charter: deterministic rule engines ship without ML).
3. Harness: none new; existing panel + hooks only.
4. Spine capability: none read or written; the surface consumes already-loaded context plus the canonical resolve_tenant_domain_identity RPC (existing, authenticated, tenant-pinned). Honest UNAVAILABLE: durable snooze persistence would need a store — deliberately not built (visit-local instead).
5. Providers: none; identity status comes from the canonical platform identity seam, not a provider probe.
6. Approval/risk: display-only; no action execution — the first-action entry routes to the existing governed chat path.
7. Events/jobs: none.
8. Readback: every achieved line IS a readback (names its grounding input); no new receipt path.
9. Surfaces: existing interview panel; Binding Ledger unchanged (no LIVE promotion).
10. Proof: pure-module tests (9), component tests (4), family suites (102/102 across five files), native matrix below; authenticated behavior OWNER WINDOW.

## Flow and state map (additive)

| From | Trigger | Guard | Result and recovery |
|---|---|---|---|
| Interview panel (ready) | Panel renders | !draft && !saveOutcomeUnknown (same gating as siblings) | Grounded section: achieved-with-evidence list + ranked actions with availability labels |
| Grounded section | "Not now" on a non-foundational action | action availability !== WORKING && key !== confirm-priority | Action hides for this visit; honest note says it returns next visit; no persistence |
| Data | Identity RPC resolves/errs | existing load gate | reserved/none mapping; any error stays "unknown" and the state says so — never guessed |

FLOW_BY_FLOW: PASS: additive rows extend the released #2258/#2311 flow table; every other row unchanged.
PAIGE_UI_DESIGN: PASS: refinement of the incumbent panel (Impeccable context loaded this session; craft floor applied: incumbent tokens, real states, no decoration; checklist rows carry evidence copy, not filler).
MATERIAL_FLOW_CHANGE: YES: a new always-visible grounded section changes the panel's information shape.
FLOW_PROTOTYPE: PASS: the isolated harness exercised the real component pre-commit — closed/open at four viewports × two themes with a reserved identity, plus a none-identity dismissed-state interaction frame; receipts in ../experience-01-foundation/first-value-2026-10-18/ (native-integrity.json binds 7 source blobs and 17 frames). No real model/provider/Auth/write effect.

## Prototype and evidence boundary

PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an ordinary SOLO owner reads what is genuinely done and chooses one ranked next action (or dismisses it) without leaving the interview; every claim on screen traces to an input.
VISUAL_DIRECTION: PASS: incumbent immersive panel; one new section in the established sbi idiom (divider, 12px secondary copy, pill availability labels); no new visual world.
MOTION_PURPOSE: NONE: no motion added; captures under reduced-motion.
AUTOMATED_EVIDENCE: PASS: pure module 9/9 (versioning; no-priority gate; determinism; explainability quotes only owner-confirmed fields; 4-cap; snooze honored incl. foundational protection; truthful half-ready/unknown states; ALG-02 grounding incl. never claiming first-action; confirmed-field counting). Component 5/5 (foundational-only case; ranked labels incl. NOT_YET_AVAILABLE; visit-local dismissal with honest copy; first-action never achieved without receipt; the always-present empty-address managed-email shape renders UNCONFIGURED — the fabrication class is test-pinned). Hook 30/30 incl. a new identity-seam mapping test (reserved/none/unknown + error) and every incumbent expectation unmodified. Interview family 26/26; Setup 63/63.
STATIC_EVIDENCE: PASS: scoped ESLint 0 errors on all six changed source files (1 pre-existing incumbent warning unchanged); TypeScript compiles in the suite transform.
RENDERED_EVIDENCE: PASS: 16 closed/open frames at 1536×770, 1366×768, 1024×768, 900×1000 in dark and light + 1 dismissed-interaction frame; every PNG dimension independently verified from its IHDR; DOM assertions bind the section, logic-version attribute, and both states.
BEHAVIORAL_EVIDENCE: PASS: dismissal hides the action for the visit (component test + interaction frame); identity "unknown" renders as could-not-read honesty (pure-module test).
AUTHENTICATED_RUNTIME: UNVERIFIED: the section's live appearance on the owner's real account (with his actual identity status) is OWNER WINDOW; nothing synthetic is claimed live.
RELEASE_CHANNEL: development: local/development build environment only — isolated harness captures and suites; no extension release, activation or hosted deployment.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: this slice is deterministic grounding and display — it is not an executed action, a receipt, or any capability activation claim.
KEYBOARD_FOCUS: PASS: the section's only interactive controls are real buttons in DOM order after the panel's existing controls (the 320px keyboard trail from the #2311 record still walks the incumbent order; the new buttons follow the facts list per tab order); physical mobile keyboard and assistive technology remain UNVERIFIED.
ZOOM_REFLOW: UNVERIFIED: 320px-class reflow verified in capture geometry; actual 200% browser zoom not proved.
REDUCED_MOTION: PASS: all captures with reduced-motion enabled; slice adds no animation.
STATE_COVERAGE: PASS: no-priority, confirmed, half-ready (managed email without confirmed business email), reserved/none/unknown identity, dismissed, and unknown-save withholding (section shares the sibling gate) covered by tests.
TRUTHFUL_STATE_LABELS: PASS: availability uses the approved four-class labels; achieved lines carry evidence; NOT_YET_AVAILABLE is used for the reserved-web publish step with its honest prerequisite.
SOLO_UI: YES: existing SOLO interview panel; one shared implementation for every eligible current/future SOLO account.
SOLO_1536X770_PAIGE_CLOSED: PASS: fv-1536x770-dark-closed.png (light pair included); exact IHDR dimensions; synthetic, not authenticated.
SOLO_1536X770_PAIGE_OPEN: PASS: fv-1536x770-dark-open.png shows the grounded section with the ranked actions; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1366X768_PAIGE_CLOSED: PASS: fv-1366x768-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1366X768_PAIGE_OPEN: PASS: fv-1366x768-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1024X768_PAIGE_CLOSED: PASS: fv-1024x768-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1024X768_PAIGE_OPEN: PASS: fv-1024x768-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_900X1000_PAIGE_CLOSED: PASS: fv-900x1000-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_900X1000_PAIGE_OPEN: PASS: fv-900x1000-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
UNVERIFIED: authenticated owner appearance, physical mobile keyboard, assistive-technology use, 200% browser zoom, real chat-model interplay with the grounded section, and durable snooze persistence (deliberately not built). Original 23 cases unchanged; folds into the single owner window.

INTERNAL_BUILD_IDENTITY: e929638da4e0759439abdcdd0e51456da3d386c5; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record plus the native integrity receipt and suites listed here, corrected per independent review.
RELEASE_CLASSIFICATION: internal-only: development slice with no customer announcement.
CUSTOMER_RELEASE_IDENTITY: none: internal development slice with no customer-facing surface claim.
RELEASE_NOTE_REQUIRED: NO: internal development slice with no customer release identity or publication decision.
RELEASE_RECOVERY: position=ordinary reviewed source revert of the seven-file slice with no database, provider or configuration effect; reference=docs/evidence/ui-delivery/experience-01-first-value-core.md.

## ALG contract acceptance mapping (charter §algorithm acceptance)

Input sources and owner: confirmed Setup provenance (owner-authored), resolve_tenant_domain_identity + managed-email state (platform identity seam) — all named in code. Versioned logic: FIRST_VALUE_LOGIC_VERSION 1, hash-pinnable. Freshness: reads live at render. Actor/tenant scope: the panel's existing owner-scope gating; identity RPC is tenant-pinned server-side. Thresholds/fallback: no predictive scoring (deterministic rules only). Uncertainty: unknown identity renders as unread. Precision/bias: N/A (no predictions). Bounded authority: display-only; no spend. Negative/consent: snooze honored; no compulsive re-prompt. Outcome metric: first-value state is itself the grounded metric; no fabricated engagement. Rollback: ordinary revert. No account-specific calibration or hidden tenant branch.
