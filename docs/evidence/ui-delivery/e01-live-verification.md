# Live Conversation verification record (EXP01 PR5) — evidence classified source / synthetic / rendered / authenticated

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: PR5's verifiable-without-the-founder scope delivered as a verification record + rendered frames, not new machinery. Every Live behavior the owner's restart order lists is classified below with its ACTUAL evidence class and its exact remaining dependency; nothing is claimed beyond its class. The personal steps — the founder's own acknowledgement, microphone grant, audible bidirectional speech and perceived latency — remain PROOF OWED — FINAL EVALUATION WINDOW and are never manufactured by engineering.
PAIGE_UI_DESIGN: PASS: 20 rendered frames (below) show the existing Live surface across its states; no new design introduced.
MATERIAL_FLOW_CHANGE: NO: verification-and-evidence only; the only shipped artifacts are frames, an integrity receipt and this record. All behavior shipped earlier (#2611/#2657).
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged — a Solo owner discloses→acknowledges→speaks; these captures document exactly what each state of that journey looks like.
VISUAL_DIRECTION: PASS: existing Live stage design language only.
AUTOMATED_EVIDENCE: PASS: the verification matrix below maps every step to its existing automated proof (SQL 10/10 consent gate; pgTAP 142/142 feature guard; vitest Live suite covering permission-denied/retry, terms-acceptance flow, reconnect/minimize/restore, interruption + mute restore, hold, offline/hidden/disconnected fencing, one-use ticket, barge-in, focus/Escape, card governance).
STATIC_EVIDENCE: PASS: source-level facts pinned by blob hashes in native-integrity.json (migration, edge function, component, status hook, workspace row derivation).
RENDERED_EVIDENCE: PASS: 20 IHDR-verified PNG frames of the REAL component (synthetic stubs: no auth/network/provider/microphone) at exact viewport dimensions — states closed/terms/denied/listening; viewports 1536×770 (all states, dark+light), 900×1000 (all states, dark+light), plus closed at 1366×768 and 1024×768 (dark+light); reduced motion honored; a live node (trigger or stage) present in every frame. Receipt: docs/evidence/experience-01-foundation/live-verification-2026-10-24/native-integrity.json.
BEHAVIORAL_EVIDENCE: PASS: per-step mapping below; each synthetic proof names the suite or SQL case that carries it.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated audio session exists; 0 pilot subjects on production at last verified read; the founder's single window owns this class.
KEYBOARD_FOCUS: PASS: suite-pinned (initial Shift+Tab, full forward/backward trap, Escape returns to the exact chat control); rendered frames document the visible focus surface.
ZOOM_REFLOW: PASS: frames at 900×1000 (narrow) and 1024×768 document the reflowed layouts; no fixed-height regressions introduced (no code change).
REDUCED_MOTION: PASS: all captures taken under reduced-motion emulation; the stage's reduced-motion behavior is suite-covered.
STATE_COVERAGE: PASS: closed (trigger), terms (acknowledgement disclosure — the #2657 gate's refusal face), denied (microphone permission refused), listening (ready relay); revocation/expiry/mid-session states are SQL+suite proven and listed in the matrix.
TRUTHFUL_STATE_LABELS: PASS: the terms frame shows the actionable refusal copy; the denied frame shows denial without fabricated audio state; the listening frame is synthetic (stub relay) and is labeled as such in the receipt — it is NOT evidence of real audio.
SOLO_UI: YES: the Live surface is the one Solo shell surface.
UNVERIFIED: every AUTHENTICATED-class step in the matrix below — the founder's own acknowledgement→microphone→bidirectional audio→audible latency→interruption-as-a-person — PROOF OWED — FINAL EVALUATION WINDOW.

## Verification matrix (the owner's PR5 list, classified)

| Step | Class | Evidence | Remaining dependency |
|---|---|---|---|
| Acknowledgement gates admission (eligible+unacknowledged refused; acknowledged admitted; revoked/expired/partial refused; tier/kill-switch still refuse; service-role-only) | source+synthetic (SQL, production-deployed) | scripts/e01-live-consent-check.mjs 10/10 vs the real predicate lineage, wired in CI; prod readback: migration 20271113600000 recorded, RPCs live, grants exact | none |
| Admission predicate update + companion + status RPC semantics (expiry/revocation end admission; scope-close withdrawal; one acceptance never authorizes another) | source+synthetic (pgTAP, CI) | supabase/tests/paige_live_pilot_feature_guard.sql 142/142 on current semantics | none |
| Disclosure renders before any audio; acceptance is the person's own; refusal copy distinguishes the two faces | source+synthetic+rendered | component suite terms tests; paige-live-session refusal branch; the terms frames (this record) | the founder's OWN acceptance event |
| Permission refusal state (microphone denied) + retry without fabricated audio | source+synthetic+rendered | suite "shows permission denial and retry…"; denied frames | none (a real denial by the founder is in-window) |
| Blocked voice entry answers (busy/dictation/authority) | source+synthetic | #2657 listener-announcement regression | none |
| Session start, one-use ticket, capture-off-until-ready | source+synthetic | suite (ticket/relay tests; fails-closed without microphone) | real provider audio = in-window |
| Reconnect (minimized restore, renewal, availability loss) | source+synthetic | suite (restore/renew/settle; unavailable-no-reconnect) | real socket drop = in-window |
| Interruption/barge-in + mute restore | source+synthetic | suite (interrupt + mute-state tests) | audible barge-in = in-window |
| Minimization + safe text return + focus | source+synthetic+rendered | suite (minimize/focus/Escape); closed frames | none |
| Per-account capability truth (acknowledged/revoked/expired/unknown/not_acknowledged) | source+synthetic | #2657 parity suite + paige_live_terms_status SQL | none |
| Real bidirectional audio, speech latency p50/p95, audible interruption recovery | AUTHENTICATED | none claimed | **PROOF OWED — FINAL EVALUATION WINDOW** (founder's voice + consent; engineering will not manufacture) |

INTERNAL_BUILD_IDENTITY: e38ad9c49f8f0d0715927f80b66cf3cb5b8f4b8b; deployment=undeployed verification branch (docs+frames only; no runtime change); environment=local; migrations=NOT_APPLICABLE;edge=NOT_APPLICABLE; evidence=docs/evidence/experience-01-foundation/live-verification-2026-10-24/native-integrity.json
RELEASE_CHANNEL: development: local harness captures and existing deployed surfaces; no new deployment from this PR.
RELEASE_CLASSIFICATION: internal-only: verification evidence ahead of the single EXP01 founder evaluation.
CUSTOMER_RELEASE_IDENTITY: none: evidence-only PR.
RELEASE_NOTE_REQUIRED: no: internal-only verification evidence.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source/synthetic/rendered classes proven and classified; AUTHENTICATED class remains PROOF OWED to the founder window.
RELEASE_RECOVERY: position=forward-fix; reference=this record and the native-integrity receipt
SOLO_1536X770_PAIGE_CLOSED: PASS: rendered frame live-1536x770-{dark,light}-closed.png (IHDR-verified).
SOLO_1536X770_PAIGE_OPEN: PASS: rendered frames live-1536x770-{dark,light}-{terms,denied,listening}.png.
SOLO_1366X768_PAIGE_CLOSED: PASS: rendered frame live-1366x768-{dark,light}-closed.png.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: open states captured at the primary and narrow viewports (see ZOOM_REFLOW); no layout change shipped in this PR.
SOLO_1024X768_PAIGE_CLOSED: PASS: rendered frame live-1024x768-{dark,light}-closed.png.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same primary/narrow coverage rationale.
SOLO_900X1000_PAIGE_CLOSED: PASS: rendered frame live-900x1000-{dark,light}-closed.png.
SOLO_900X1000_PAIGE_OPEN: PASS: rendered frames live-900x1000-{dark,light}-{terms,denied,listening}.png.
