# EXP03 original SMS uncertain-result recovery candidate

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: original F5–F7/Communications send→provider result→same message/receipt→reopen/recovery, recorded in SEND-MESSAGE-CONTRACT section6.
PAIGE_UI_DESIGN: PASS: original composer, Conversations unconfirmed line/warning and controls retained; no layout/component/style change.
MATERIAL_FLOW_CHANGE: NO: original SMS failure result now reuses the already-existing uncertain-result state and same-row replay refusal; no new human step, control, approval or visual design.
FLOW_PROTOTYPE: NOT_REQUIRED: existing approved uncertainty interaction reused, no new UI flow or visible control; rendered SMS reuse verification still owed.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: sender can distinguish an uncertain SMS attempt from a definite refusal and avoid sending the same message twice.
VISUAL_DIRECTION: PASS: unchanged canonical Conversations/composer and original message/warning presentation.
AUTOMATED_EVIDENCE: PASS: immutable original b49 source18cases9PASS/9FAIL, corrected18PASS; malformed receipt neighborhood20PASS/3FAIL→23PASS; entire original Communications CI list plus added cases1139PASS. Every provider port inert.
STATIC_EVIDENCE: UNVERIFIED: exact source review/type/lint/C0b identity/hosted review and checks remain required; local Deno unavailable.
RENDERED_EVIDENCE: UNVERIFIED: no new rendered packet claimed for this candidate; original parent dialog captures do not prove the new SMS uncertainty path.
BEHAVIORAL_EVIDENCE: PASS: actual original handler and registered SMS adapter run together;23cases cover response loss/throw/408/409/503/receipt absence or malformed, definitive4xx/429, same-row replay, original thread/words, SM/MM receipts, configuration and original provider-floor refusal.
AUTHENTICATED_RUNTIME: UNVERIFIED: no actual send or customer/tenant mutation; exact release/readback and legitimate customer proof owed.
KEYBOARD_FOCUS: UNVERIFIED: no new keyboard drive; original UI source unchanged.
ZOOM_REFLOW: UNVERIFIED: no new native zoom drive; original UI source unchanged.
REDUCED_MOTION: PASS: no product motion change.
STATE_COVERAGE: UNVERIFIED: source-bound SMS result/replay tests in supabase/functions/_shared/comms-sms-result.test.mjs pass; rendered/both-chat/durable operation/complete legal-dispatch coverage remains open.
TRUTHFUL_STATE_LABELS: PASS: uncertain result cannot become sent or ordinary retryable failed; provider accepted SID is distinct from delivery, mock distinct from customer proof.
SOLO_UI: YES: original Conversations/New conversation uncertainty/recovery flow.
UNVERIFIED: actual rendered SMS warning/record/reopen, fullshell/PAIGE/native200/AT, authenticated two-cohort/source deployment, both-chat consumers, durable SMS claim/unknown reconciliation, all50state dispatch and full Experience readiness/acceptance.
OWNER_INTENT: every provider effect requires current eligibility and uncertain effects must not be automatically replayed; source correction reuses the original operation/message path.
MUST_NOT_HAPPEN: missing/invalid provider receipt claims sent, lost response claims definitely unsent, same uncertain row replays, provider configuration failure becomes a false accepted effect, or a mock calls a real provider.
MUST_PRESERVE: original tenant/provider/consent gates, invoice/email/governed writers, message/error marker/replay guard, original UI/parser and callback/custody boundaries.
ACCEPTANCE_CRITERIA: uncertain SMS uses original warning/record and same-row replay refusal, definite rejection/configuration retains failed, valid receipt preserves original acceptance; real rendered/customer proof remains owed.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: send-message SMS adapter and original providerUnconfirmed projection only; no invoice finalizer/Gmail/email/approval/native/Root/TeamHub/callback/credential edit.
INTERNAL_BUILD_IDENTITY: base b49b80edcf9592625439f34701186d99ed6d8854 plus final reviewed source head; deployment=none-candidate; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(normal source importer release after gates); evidence=supabase/functions/_shared/comms-sms-result.test.mjs
RELEASE_CHANNEL: development: fictional source/transport fixtures only, no actual call/text or provider configuration.
RELEASE_CLASSIFICATION: patch: original SMS result truth and original same-message recovery guard.
CUSTOMER_RELEASE_IDENTITY: none: source candidate, no assigned customer release.
RELEASE_NOTE_REQUIRED: NO: bounded original result-truth repair, no feature announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: source23/1139 only, normal exact review/CI/release/readback plus rendered/customer coverage still required.
RELEASE_RECOVERY: position=existing uncertain-row/no-replay semantics and ordinary source forward-fix; reference=docs/comms/SEND-MESSAGE-CONTRACT.md section6

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no new full-shell drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no new full-shell drive.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no new full-shell drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no new full-shell drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no new full-shell drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no new full-shell drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no new full-shell drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no new full-shell drive.

The first mutable-source18case baseline overlapped a product edit and is EXCLUDED. Reproduced the baseline again from immutable original b49 source through COMMS_SMS_BASELINE,9PASS/9FAIL. Final23cases and full1139 use actual current source. No reduced assertion or global policy change; no real provider/customer/legal compliance claim.
