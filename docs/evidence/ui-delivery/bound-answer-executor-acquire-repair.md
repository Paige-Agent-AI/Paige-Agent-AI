# Bound-answer executor acquire repair (the interview answer 409)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: bug-or-repair mode; authenticated QA as the real customer (givalli44, Acmey Advisory) captured the live refusal body `{"proceed":false,"code":"INTERACTIVE_AUTHORITY_UNAVAILABLE","message_accepted":false,"status":409}` on every typed answer while begin_v2 accepted each intent; the executor chain was reproduced read-only at the database: `paige_chat_interactive_acquire_bound` requires exactly one admitted USER turn carrying the intent, but a bound answer's begin deliberately writes none (its claim is appended at the model call) → 'runtime admission unavailable' → the 409; the replacement function was dry-run against the REAL production schema inside a rolled-back transaction: bound-answer admission acquires (acquired:true), binding records admission=bound_answer/mode=normal, unadmitted intents still refuse, zero residue after ROLLBACK
PAIGE_UI_DESIGN: PASS: no visual change; the customer-visible effect is that answers to PAIGE's questions stop failing invisibly and the interview continues
MATERIAL_FLOW_CHANGE: NO: same claim-once, same settle/release; acquire_bound additionally recognizes the bound-answer admission shape (admitted intent + no user row — only begin can produce it, so it cannot be forged), and the claim-bind trigger extends the SAME J19 attest/recover lane to that shape (the claim turn is stamped with the thread's binding in the same transaction as its append — no edge-source change, no recovery window); user-turn admissions keep their exact incumbent binding bytes
FLOW_PROTOTYPE: NOT_REQUIRED: machine-to-machine authority path with unchanged human surface
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the customer answers PAIGE's interview question and the conversation continues — the first-exchange-works/every-answer-dies loop is closed at its true root
VISUAL_DIRECTION: PASS: existing surfaces
AUTOMATED_EVIDENCE: PASS: int346-runtime-recovery-db-check extended with live-shape regressions (bound-answer admission without supersedes acquires and its claim turn is auto-bound; marker-only supersedes admission acquires; admitted-shape mismatch with executor free still raises runtime admission unavailable; a second claim-shaped turn is never stamped — exactly-one) — each scenario also validated against the REAL production schema inside a rolled-back transaction (acquired:true; claim appended through the real turn_append as the caller and auto-stamped admission=bound_answer; attest-ready user turns = 1; zero residue)
STATIC_EVIDENCE: PASS: migration is a guarded create-or-replace of the one function with identical ABI and grants (revoke/grant pair unchanged); executor_v2 untouched (its md5 is pinned by the same check)
RENDERED_EVIDENCE: PROOF_OWED: the authenticated transcript with consecutive answered exchanges is the post-deploy readback (drive resumes immediately after deploy)
BEHAVIORAL_EVIDENCE: PASS: count>1 still errors; read-only-recovery mode and pre-registration fence unchanged; claim-once unique index untouched
AUTHENTICATED_RUNTIME: PROOF_OWED: the resumed QA drive on the real thread (ad0e6231) after deploy-migrations lands
KEYBOARD_FOCUS: NOT_APPLICABLE: no visual change
ZOOM_REFLOW: NOT_APPLICABLE: no visual change
REDUCED_MOTION: NOT_APPLICABLE: no visual change
STATE_COVERAGE: PASS: plain-message admission (existing proofs unchanged); bound-answer admission with and without supersedes; unadmitted intent; held-thread read lane (existing proofs unchanged)
TRUTHFUL_STATE_LABELS: PASS: the boundary code now reflects reality instead of masking a shape error as authority unavailability
SOLO_UI: YES: one chat engine for every current and future Solo account
UNVERIFIED: post-deploy consecutive-answer production proof and the remaining journey legs

INTERNAL_BUILD_IDENTITY: dedc3997c78073d067bce26a23f198ec04642af7; deployment=PROOF_OWED(undeployed fix branch; live drive resumes after deploy-migrations); environment=local; migrations=1; edge=0; evidence=docs/evidence/ui-delivery/bound-answer-executor-acquire-repair.md
RELEASE_CHANNEL: development: local/development build environment; proven by the production-schema rollback dry-run and the extended db-check
RELEASE_CLASSIFICATION: customer-facing-repair: unblocks every answer to a PAIGE question on the interactive protocol
CUSTOMER_RELEASE_IDENTITY: none: fix branch only
RELEASE_NOTE_REQUIRED: yes: interview answers stop failing after the first exchange
RELEASE_TRUTH_BOUNDARY: PARTIAL: authority path proven against the real schema; the live transcript proof is owed post-deploy
RELEASE_RECOVERY: position=forward-fix on the live failure class; reference=migration 20271112110000_bound_answer_executor_acquire.sql
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no visual change
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no visual change
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no visual change
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no visual change
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no visual change
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no visual change
