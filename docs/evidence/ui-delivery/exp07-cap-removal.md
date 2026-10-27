# UI delivery evidence: exp07-cap-removal (billing supersession — media spending ceilings removed)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the pre-edit packet is the billing-supersession ACK (ANT-162 544c5852) plus this lane's cap inventory: the media surfaces carried five monetary stops — the null-ceiling off-switch, the per-tenant daily ceiling, the platform-wide daily pause, the video daily allowance, and the insufficient-credit 402 — each surfacing a refusal message in the Studio's media panel (useMediaJobs mapped needsCeiling, budgetDenied and limitReached onto the error surface). The supersession (owner, 2026-10-27) removes every one. Flows after this PR: (F1) a submit whose workspace has no ceiling configured proceeds exactly as a configured one — the "Media generation isn't switched on yet" sentence can no longer appear; (F2) a workspace past any former ceiling proceeds — the "Daily media budget reached" and "Platform media spend is paused" sentences can no longer appear; (F3) a video past the former daily allowance proceeds; (F4) a workspace with insufficient prepaid credits proceeds — the "Add Media Credits" 402 sentence can no longer appear — the uncovered cost is metered to the tenant invoice chain at settle (platform_usage_events, event media_usd, idempotent by job, credits consumed first as already-paid value so nothing double-bills); (F5) the approval boundary is UNCHANGED — video, premium and above-allowance jobs still wait on the same confirmation card with the same asker-only claim; (F6) the error surface still renders the server's own sentence verbatim for the failures that remain (technical configuration, provider transport). Failure exits: a metering failure logs and retries on the next sweep — it never blocks a job and never surfaces to the customer.
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md; impeccable detect over the changed files exit 0; no visual direction changed — the panel's anatomy, copy register and states are untouched except that three monetary refusal states can no longer occur.
MATERIAL_FLOW_CHANGE: YES: the media flow's precondition changed materially — spend is no longer gated by any ceiling; formerly-refused submissions now proceed and bill the tenant through the canonical meter.
FLOW_PROTOTYPE: PASS: this is the owner's own ruled flow change (the billing supersession, ANT-162 2010d550/a0f9987d) realized on the existing media flow — the approval-card prototype and the error-surface pattern are the established approved designs, unchanged here.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: purpose — the owner's media generation is never interrupted by PAIGE-imposed money stops; audience — the Solo business owner; primary action — generate (and approve where the action-permission boundary asks); the money outcome moved from "refuse the action" to "bill the usage".
VISUAL_DIRECTION: PASS: unchanged; no new styles.
AUTOMATED_EVIDENCE: PASS: media-budget-seam 10/10 pins the informational posture (unknown accrual, unset ceiling and exceeded totals all allow, totals ride along; the platform guard always allows); media-approval-handler 17/17 includes the rewritten pin — a spent-out ceiling at approval time NEVER blocks, the job dispatches and the claim is spent exactly once; media-credits-seam 11/11 covers the guard and the retained credit math; media-seam-security-contract green; the door suite carries the surface-agnostic pin; the sweeper's meter step is best-effort by construction (logged, retried next sweep).
STATIC_EVIDENCE: PASS: eslint clean on changed files; ci:tsc ratchet green (no new errors); deno diagnostics on the changed functions verified pre-existing (baseline); no migration.
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/exp07-publish/ (the Marketing surfaces unchanged); the media panel's remaining states are the established ones — the removed states are proven absent by the seam tests, not by new captures.
BEHAVIORAL_EVIDENCE: PASS: the approval-handler world drives the REAL submit and approve code — the formerly-refusing paths now dispatch (provider double called; receipts filed), and the replay-once claim semantics hold with no ceiling in play.
AUTHENTICATED_RUNTIME: UNVERIFIED: harness/world only; an authenticated owner generating past a formerly-blocking state remains production proof owed (and the meter rows reaching the invoice read chain on live data).
KEYBOARD_FOCUS: PASS: no new interactives; the removed states were error text.
ZOOM_REFLOW: UNVERIFIED: no layout change (three error strings become unreachable).
REDUCED_MOTION: PASS: no motion.
STATE_COVERAGE: PASS: every formerly-monetary refusal state is covered by a seam test proving it can no longer occur; the retained states (technical configuration, provider failure, approval-required) unchanged and covered.
TRUTHFUL_STATE_LABELS: PASS: no total is invented — an unreadable accrual renders as unknown in the informational payload, never as zero; no surface claims a spend state the meter did not record.
SOLO_UI: YES: src/solo/useMediaJobs.ts (the Studio media panel's job hook inside Solo).
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1536x770-paige-closed.png (panel unchanged; monetary refusal states removed at the seam)
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1536x770-paige-open.png (unchanged)
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1366x768-paige-closed.png (unchanged)
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1366x768-paige-open.png (unchanged)
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1024x768-paige-closed.png (unchanged)
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1024x768-paige-open.png (unchanged)
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-900x1000-paige-closed.png (unchanged)
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-900x1000-paige-open.png (unchanged)
UNVERIFIED: the authenticated live drive of a formerly-blocking state; meter rows observed in the invoice read chain on production data; the Supabase Preview check on this PR failed for a preview-pipeline reason unrelated to this diff (no migration present) and is named rather than hidden
OWNER_INTENT: the owner billing supersession (ANT-162, 2026-10-27) — remove every PAIGE-imposed spending/sending ceiling, bill attributable usage to the consuming tenant at published rates, retain technical anti-abuse and action permissions, prove the meter reaches collection without duplicate charges.
MUST_NOT_HAPPEN: any monetary state interrupting a job; double billing (credits consumed AND the same cost metered); a total invented where the read failed; the approval boundary or anti-abuse limits weakened.
MUST_PRESERVE: the draft-first approval cards and asker-only claims; the canonical proposal store; the durable job receipts; rate limits and provider failure handling.
ACCEPTANCE_CRITERIA: a submission that every former ceiling would have refused now proceeds, its uncovered cost lands in platform_usage_events exactly once, and the only remaining refusals are technical or permission boundaries.
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: tested — the informational ladder (seam suite), the approval-time never-block pin, the replay-once claim, the meter's idempotency key and credits-exclusion; unchanged — the proposal store, the credit ledger's hold and settle math, the provider adapters.
INTERNAL_BUILD_IDENTITY: 6a382724998c4b9c970c45aa61ab78638d8b1ed0 (6a3827249, branch exp07-cap-removal on main 307c2a1b6); deployment=local-harness-and-world; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-media and paige-media-sweeper deploy and readback on merge); evidence=docs/evidence/ui-delivery/exp07-cap-removal.md
RELEASE_CHANNEL: development: local harness only; not merged or deployed
RELEASE_CLASSIFICATION: internal-only: billing-supersession implementation on an internal surface
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the uncapped behavior is live only after merge, the edge deploy and the readback; the authenticated owner drive of a formerly-blocking state and live meter rows in the invoice chain remain the customer proof
RELEASE_RECOVERY: position=revert-frontend-and-edge (a revert restores the prior ladder and panel with no data or schema to unwind); reference=this record and the deploy of the revert

## Scope

- **Changed:** supabase/functions/_shared/media-provider/budget.ts (the ladder and guard become informational); supabase/functions/paige-media/index.ts (five stop branches removed; the approval boundary retained); supabase/functions/paige-media-sweeper/index.ts (the usage-meter step); src/solo/useMediaJobs.ts (the three dead denial fields removed); the seam and render tests rewritten to pin the new posture; the acceptance matrix gains the Team Hub and billing rows.
- **Added:** the surface-agnostic pin in the door suite; this record.
- **Honest gaps:** the meter's per-job idempotency check is a best-effort query (a unique functional index lands with the media-library migration); live invoice-chain readback and the authenticated drive are owed; the Supabase Preview failure is named, not diagnosed here.
