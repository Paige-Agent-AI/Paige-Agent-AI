# Knowledge Chat declared-workspace protection

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bounded fresh-main #591 gap packet and failing-first real-handler tests.
PAIGE_UI_DESIGN: PASS: existing refusal/stream behavior retained; no UI component or layout edits.
MATERIAL_FLOW_CHANGE: NO: repairs the existing account-switch refusal contract.
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction; approved Knowledge scope and existing refusal retained.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tenant callers receive Knowledge only while the selected workspace remains valid.
VISUAL_DIRECTION: PASS: existing chat presentation retained.
AUTOMATED_EVIDENCE: PASS: real-handler suite 398 passed/0 failed; failing-first 381 passed/17 failed.
STATIC_EVIDENCE: PASS: git diff --check; TypeScript ratchet running, result recorded in PR.
RENDERED_EVIDENCE: UNVERIFIED: no authenticated mounted Chat drive performed.
BEHAVIORAL_EVIDENCE: PASS: real handler with injected boundaries refuses invalid declared scope before egress and after the first provider call; tenantless and ordinary controls remain green.
AUTHENTICATED_RUNTIME: UNVERIFIED: local module-boundary doubles do not establish live tenant switching.
KEYBOARD_FOCUS: NOT_APPLICABLE: no frontend controls changed.
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changed.
REDUCED_MOTION: NOT_APPLICABLE: no motion changed.
STATE_COVERAGE: PASS: regression cases cover cleared, changed, malformed, absent and throwing declared scope plus a post-provider change.
TRUTHFUL_STATE_LABELS: PASS: no new capability or LIVE declaration.
SOLO_UI: NO: backend guard only; existing Solo refusal behavior retained.
UNVERIFIED: authenticated tenant/account-switch, deployed edge parity, compactor lifecycle and final Knowledge integration.
OWNER_INTENT: prevent stale or unresolved active workspace from releasing private Knowledge.
MUST_NOT_HAPPEN: no fallback to oldest membership after declared scope clears; no historical #591 branch transplant.
MUST_PRESERVE: tenantless operator, existing streaming latch, enrollment repair, canonical approval and sticky refusal.
ACCEPTANCE_CRITERIA: initial valid retrieval may run; any later invalid declared workspace refuses protected egress, reply and telemetry.
MOTION_PURPOSE: NONE: no motion changes.
PROTECTED_SEAMS: account scope, model egress, buffered reply and telemetry covered by real-handler synthetic scenarios; enrollment, storage, billing, Memory, Vault and UI geometry unchanged.
INTERNAL_BUILD_IDENTITY: 07c802308dfb8f0e8d2c82ff2e6e09bca9b48ca1; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat); evidence=scripts/knowledge-scope/stage1-check.mjs; reviewed head recorded in PR.
RELEASE_CHANNEL: development: local only.
RELEASE_CLASSIFICATION: internal-only: bounded protection repair.
CUSTOMER_RELEASE_IDENTITY: none: no deployed release.
RELEASE_NOTE_REQUIRED: NO: no customer announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: live authenticated scope and deployed handler parity.
RELEASE_RECOVERY: position=revert bounded patch before release; reference=07c802308dfb8f0e8d2c82ff2e6e09bca9b48ca1.

## Pre-edit routing and owner clearance

Owner explicitly cleared the shared handler on 2026-09-30: "You have authority to work on it if needed". This supersedes the INT-266 file reservation for this lane. #1598 is already on current main; #591 remains historical reference only.

1. Outcome: refuse stale-workspace private evidence through existing Chat boundaries.
2. Domain: Knowledge; parent is sole handler writer, other workers own separate checkouts.
3. Harness: reuse identity/authority and protected-turn latch; no additional engine.
4. Spine: no new capability registered; business_context.readiness remains status-only.
5. Provider: existing gateway infrastructure only; no new connection or egress permission.
6. Approval: existing one-approval gate unchanged; this is a read-scope restriction.
7. Durable work: no new jobs; rolling compactor separately requires its own lifecycle repair.
8. Readback/Rail: suppress stale existing telemetry; no new receipt stream.
9. Surface: Chat existing refusal only; Binding Ledger status unchanged.
10. Proof: real handler with injected module boundaries and original regression suite; live identity/provider/UI remains unverified.

The persona resolver can return an old membership after profiles.active_tenant_id clears. Recheck the raw declared field as well as persona scope on each existing protected tenant boundary. Legitimate tenantless operator resolution remains unchanged. Sticky refusal remains in force. These sequential reads are boundary revalidation, not a transaction lock spanning a model request.

Shipped Delivery Log: N/A; no main merge or deployment performed.

## Commands

`node --import ./scripts/knowledge-scope/register.mjs scripts/knowledge-scope/stage1-check.mjs`: 398 PASS. New tests first reproduced 17 failures; the existing HTTP 409 payload is asserted by its stable ACTIVE_ACCOUNT_CHANGED code. No frontend bundle change. Independent exact-head review and TypeScript result are recorded in the PR.
