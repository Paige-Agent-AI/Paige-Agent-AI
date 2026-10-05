# Solo invoice dispatch and draft workspace repair

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: current authorized correctness packet in docs/delivery/solo-sales-invoice-dispatch-repair.md.
PAIGE_UI_DESIGN: PASS: project overlay/modules and Impeccable craft floor applied; https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md.
MATERIAL_FLOW_CHANGE: NO: approved pop-out and command flow retained; fixes draft truth and dispatch serialization.
FLOW_PROTOTYPE: PASS: approved invoice pop-out retained; narrow lifecycle/concurrency correctness repair, no new design or multi-step flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo business owners inspect the invoice, record/correct received payments and prepare delivery; customers download a real PDF.
VISUAL_DIRECTION: PASS: Mineral/Obsidian tokens; invoice preview beside an operational action pane, one body scroll, full-screen compact workspace.
AUTOMATED_EVIDENCE: PASS: 220 invoice/billing/delivery contracts and 17 component tests; actual PostgreSQL repeated migration and cross-session dispatch/receipt proof. Removing the guard makes the regression fail.
STATIC_EVIDENCE: UNVERIFIED: static ratchet and build running; exact results recorded in the PR before merge.
RENDERED_EVIDENCE: PASS: 24 actual-component draft pop-outs, both themes, dock states and six sizes; assets/solo-sales-invoice-dispatch-repair/draft-proof.json, 1536-dark.png and 390-light.png.
BEHAVIORAL_EVIDENCE: PASS: draft opens with zero issued-document requests; publication readback enables preview; late issued response after switching to draft is discarded; actual rendered publication review/cancel and invoker focus restoration. Synthetic local auth/RPC only.
AUTHENTICATED_RUNTIME: UNVERIFIED: trusted CUA process failed; signed-in owner/second-tenant, production bearer document and provider attachment acceptance not driven. No external email or payment mutation performed.
KEYBOARD_FOCUS: PASS: payment/correction inputs receive focus; review cancel returns to editing; pop-out close restores its invoker in actual-component fixture drive. Full authenticated keyboard path remains UNVERIFIED.
ZOOM_REFLOW: PASS: 390/430px narrow reflow has no horizontal body overflow. Native browser zoom UNVERIFIED.
REDUCED_MOTION: PASS: reduce preference used in component drive; workspace and overlay animations/transitions disabled under that preference.
STATE_COVERAGE: PASS: draft/not-issued, canonical publication transition, late scoped preview, issued regression, dispatch-in-progress payment/correction/void refusal and failed/unknown finalization release. Real account/provider/pending recovery remains UNVERIFIED.
TRUTHFUL_STATE_LABELS: PASS: human-recorded payment remains separate from provider settlement; provider acceptance remains separate from customer delivery. PDF preparation failure sends nothing.
SOLO_UI: YES: shared Solo Payments for every existing and future tenant; no account-specific branch.
UNVERIFIED: Real owner/second-tenant draft publication, live concurrent delivery/payment, stranded-dispatch readback, provider attachment acceptance and native print. Local synthetic proof does not establish them.
OWNER_INTENT: Close both post-merge PR1715 findings before INT-299/INT-311 backend grounding: stable invoice version through dispatch and truthful draft pop-out.
MUST_NOT_HAPPEN: No extra invoice store, second browser host, new approval gate, payment mutation without canonical review, inferred settlement, cross-tenant data or HTML disguised as PDF.
MUST_PRESERVE: Frozen issued obligations/branding; historical numbers/documents in storage; canonical ledger conservation, reversal history, approval/idempotency/recovery, sender readiness and SMS A2P boundaries.
ACCEPTANCE_CRITERIA: Draft is never described as issued or given a failing issued-preview request. No commercial mutation invalidates the claimed invoice while dispatching. Terminal outcomes retain canonical truth and authority.
MOTION_PURPOSE: Existing dialog entrance/exit only; reduced-motion removes it.
PROTECTED_SEAMS: Existing invoice/deal/offer/Comms/approval stores, claim/finalize, invoice row locks, operation identity and Rail. No new provider, scheduler, approval or ledger.
INTERNAL_BUILD_IDENTITY: 601c53be741db76ce64f418daa437972b0507a74 (base; exact reviewed head in repair PR); deployment=UNVERIFIED; environment=development; migrations=PROOF_OWED(20270562000000 pending canonical deploy); edge=PROOF_OWED(sales-invoice-command pending canonical deploy); evidence=this record.
RELEASE_CHANNEL: development: production promotion authorized by owner; actual deployment identities must be recorded after merge.
RELEASE_CLASSIFICATION: internal-only: invoice workflow repair, no named customer release.
CUSTOMER_RELEASE_IDENTITY: none: authenticated end-to-end acceptance remains PROOF OWED.
RELEASE_NOTE_REQUIRED: no: no customer announcement authorized.
RELEASE_TRUTH_BOUNDARY: PARTIAL: focused implementation with local automated/rendered/concurrent SQL proof. Hosted migration/edge/web and authenticated provider acceptance remain PROOF OWED.
RELEASE_RECOVERY: position=forward-fix scoped renderer/UI/transport; reference=existing immutable invoice facts and governed operation recovery retained; PDF failure refuses provider dispatch, never substitutes HTML.

SOLO_1536X770_PAIGE_CLOSED: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_1536X770_PAIGE_OPEN: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_1366X768_PAIGE_CLOSED: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_1366X768_PAIGE_OPEN: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_1024X768_PAIGE_CLOSED: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_1024X768_PAIGE_OPEN: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_900X1000_PAIGE_CLOSED: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.
SOLO_900X1000_PAIGE_OPEN: PASS: draft-proof.json both themes; unchanged viewport-fitting workspace, no horizontal overflow; synthetic local auth/RPC.


## Scoped correctness proof

See [repair routing and contract](../../delivery/solo-sales-invoice-dispatch-repair.md). SQLSTATE P5501 provides a closed recovery sentence; no database payload enters customer copy. There is no time-based unlock or invented send outcome. Independent exact-head non-writer and Impeccable finish reviews must complete; verdicts are recorded in the PR.
