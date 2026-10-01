# Knowledge rolling-summary scope protection

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bounded compactor lifecycle packet; authority routes inspected before failing-first real-handler tests.
PAIGE_UI_DESIGN: PASS: existing refusal/stream behavior retained; no UI component or layout edits.
MATERIAL_FLOW_CHANGE: NO: repairs the existing account-switch refusal contract.
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction; approved Knowledge scope and existing refusal retained.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tenant callers receive Knowledge only while the selected workspace remains valid.
VISUAL_DIRECTION: PASS: existing chat presentation retained.
AUTOMATED_EVIDENCE: PASS: real-handler suite 508 passed/0 failed; final harness against base handler 454 passed/54 failed; initial failing-first 421 passed/19 failed; checked-write15 passed.
STATIC_EVIDENCE: PASS: git diff --check and Node syntax checks for both harness files; Deno handler typecheck UNVERIFIED (Deno unavailable). No full app compiler run for this backend slice.
RENDERED_EVIDENCE: UNVERIFIED: no authenticated mounted Chat drive performed.
BEHAVIORAL_EVIDENCE: PASS: real preflight and post-turn folds, response-closed waitUntil task, stored-summary recall, owner/tenant/raw/resolved authority, zero-row writes and watermark predicates exercised with module-boundary doubles.
AUTHENTICATED_RUNTIME: UNVERIFIED: local module-boundary doubles do not establish live tenant switching.
KEYBOARD_FOCUS: NOT_APPLICABLE: no frontend controls changed.
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changed.
REDUCED_MOTION: NOT_APPLICABLE: no motion changed.
STATE_COVERAGE: PASS: missing/foreign thread, cleared/malformed/throwing active scope, resolved scope change, owner/tenant loss after provider, readback refusal, platform authority and post-response lifecycle covered.
TRUTHFUL_STATE_LABELS: PASS: no new capability or LIVE declaration.
SOLO_UI: NO: backend guard only; existing Solo refusal behavior retained.
UNVERIFIED: authenticated tenant/account-switch, deployed edge parity, Deno handler typecheck and final Knowledge integration.
OWNER_INTENT: bind summary transcript, model egress, storage and recall to the same caller-owned thread and unchanged workspace.
MUST_NOT_HAPPEN: no stale summary egress/write/recall, no foreign-owner thread, no widening platform authority, no compactor failure rewriting a completed parent outcome.
MUST_PRESERVE: tenantless platform operator, own NULL platform thread while entered in a workspace, parent streaming/latch/enrollment and canonical approval.
ACCEPTANCE_CRITERIA: preflight and post-turn compaction reuse current authority before provider/write and after write; missing/refused authority skips compaction; recalled summaries retain binding at subsequent parent boundaries.
MOTION_PURPOSE: NONE: no motion changes.
PROTECTED_SEAMS: account scope, model egress, buffered reply and telemetry covered by real-handler synthetic scenarios; enrollment, storage, billing, Memory, Vault and UI geometry unchanged.
INTERNAL_BUILD_IDENTITY: 96f4b8ea3d5cf25577bed9ab406c22ecc2175d29; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat); evidence=scripts/knowledge-scope/stage1-check.mjs; reviewed head recorded in PR.
RELEASE_CHANNEL: development: local only.
RELEASE_CLASSIFICATION: internal-only: bounded protection repair.
CUSTOMER_RELEASE_IDENTITY: none: no deployed release.
RELEASE_NOTE_REQUIRED: NO: no customer announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: live authenticated scope and deployed handler parity.
RELEASE_RECOVERY: position=revert bounded patch before release; reference=96f4b8ea3d5cf25577bed9ab406c22ecc2175d29.

## Pre-edit scope and authority packet

Owner cleared the handler; coordinator assigned this separate compactor slice. Parent owns no concurrent writes in this checkout. No CRUD, Spine, UI, schema, provider integration, release or deployment change.

- Flow: caller-owned persistent thread -> preflight fold -> summary recall -> protected parent response -> persisted assistant turn -> silent waitUntil fold.
- Authority: caller JWT getUser identity; existing get_paige_persona_context and raw profiles.active_tenant_id; caller-RLS thread row pinned to id/caller_user_id/tenant_id. Existing normal-turn validator is forced for compaction without setting the parent's evidence latch or refusal state. Compactor refusal remains sticky locally.
- Platform rule: migrations 20260803170000 and 20261020100000 explicitly preserve an operator's own NULL platform thread both with no tenant and while entered into one. Strict USER-client is_platform_owner=true is required. No other-tenant thread exception is admitted.
- Persistence: update includes pinned owner/tenant and prior summary_through_seq. A concurrent watermark advance or zero-row result cannot announce completion. Returned id plus fresh authority read are required before done. A scope loss after storage suppresses completion/recall; this does not claim rollback of an already committed update.
- Following use: the recalled summary installs thread-binding validation into existing parent provider/reply checks. Other parent behavior and enrollment regression checks remain in the 398-check baseline.
- Harness: fake RPC now awaits async results so the waitUntil case holds assistant append until the parent response closes, then changes profile scope before background fold. Existing thread fixtures now include real identity fields. Parent gate counts deliberately stop before background append.

## Evidence and limits

`npm run test:knowledge-scope`: 508 PASS. The same final harness with the base handler temporarily substituted (restored in finally) reports 454 PASS /54 FAIL. Original pre-implementation run reports 421 PASS /19 FAIL. `npm run test:checked-write`:15 PASS. `node --check` both edited harness files and `git diff --check`: PASS.

This is synthetic actual-handler proof with no provider/database traffic. Native Deno typecheck, authenticated account transitions, real RLS enforcement and deployed parity remain UNVERIFIED. Sequential authority reads do not lock a workspace across HTTP/provider calls, and a switch away and back between checkpoints cannot be detected. The watermark predicate prevents overwriting a newer fold; no general retry/idempotency redesign is claimed. No full application build or compiler was run for this backend-only slice. Independent review is required after commit; no push, PR, merge or deployment authorized in this task.
