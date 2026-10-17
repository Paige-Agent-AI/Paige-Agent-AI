# UI delivery evidence: invoice amount calculation inside the Edge source boundary

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Bug/Repair mode, Deep depth (production Edge release). Affected flows: (1) platform release — CI deploys and source-certifies every affected Edge function; (2) owner drafts an invoice through `sales-invoice-draft-command` (behaviour preserved, not changed); (3) owner sends a portal invitation from the dashboard (PR #2298, held until this release certifies). Regression map: Solo Sales invoice editor, invoice draft API, Chat invoice tool, native draft door resume, Edge source-readback verifier. Grounding artifacts are listed in the evidence index below.
PAIGE_UI_DESIGN: PASS: incumbent Solo Sales invoice editor, billing workspace, copy, validation messages, layout and styling retained unchanged; the only `src/solo/` change re-exports the identical calculation function, so no design decision applies.
MATERIAL_FLOW_CHANGE: NO: no goal, state, transition, exit, validation message or consequence changed. The calculation body is byte-identical and the frontend public API is the same function object.
FLOW_PROTOTYPE: NOT_REQUIRED: a module-location move of a pure function with no visible or behavioural change has no interaction shape to prototype.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is the release pipeline and, downstream, every Solo owner who drafts an invoice or sends a portal invitation. Primary action: let the existing Edge source verifier certify the invitation release by removing the one Edge import that reached outside `supabase/functions`.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: on merged head (repair 6e9b97a9 + main 22f4da0b), Linux: full Edge source-readback suite `python3 -B -m unittest discover -s .github/scripts -p test_edge_source_readback.py` 68/68 PASS (27.5 s); invoice/editor/API/endpoint/Chat/door-resume/compatibility Vitest files 8/8, 169/169 PASS. Falsification (§71.4): reverting only the Edge import to `../../../src/solo/sales/invoiceDraftSnapshot.ts` makes `test_invoice_calculation_has_a_verifiable_edge_source_closure` FAIL; restoring it returns PASS. The negative fixture proves an off-root import is refused before any provider call or download.
STATIC_EVIDENCE: PASS: `node scripts/ci/tsc-ratchet.mjs` on merged head: no new type errors (baseline 10, current 7; the 3 fewer are pre-existing errors already fixed on main, not by this change). `npx eslint` on the four changed TypeScript files: 0 findings. The calculation function body is byte-identical to the removed frontend copy; only its input type location moved (`InvoiceAmountLine`, structurally identical to `Pick<InvoiceItemSnapshot,'unit_minor'|'quantity'>`). `edge-source-readback.py`, the deploy workflow and `action-risk.ts` are unchanged (verified by `git diff --stat`).
RENDERED_EVIDENCE: NOT_APPLICABLE: nothing rendered changed; no screenshots are claimed or fabricated.
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: no browser-visible behaviour changed; calculation behaviour is covered by the unchanged invoice snapshot/editor/API suites above, which import the shared function through the preserved frontend API.
AUTHENTICATED_RUNTIME: UNVERIFIED: production Edge deployment, deployed source/config readback and `edge-live` advancement happen only after merge through the existing deploy workflow and its workflow_dispatch recovery; owner invoice drafting on the deployed function is not driven in this record.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element changed.
ZOOM_REFLOW: NOT_APPLICABLE: no layout changed.
REDUCED_MOTION: NOT_APPLICABLE: no motion changed.
STATE_COVERAGE: PASS: invoice amount validation states (item count bounds, unit/quantity ranges, int4 overflow, deposit percentage, fixed deposit, positive balance) are unchanged byte-for-byte and remain covered by `invoiceDraftSnapshot.test.ts` and the endpoint suite.
TRUTHFUL_STATE_LABELS: PASS: no capability label changes. Invoice drafting stays as previously recorded; portal invitation Chat/Live send and customer acceptance remain UNVERIFIED.
SOLO_UI: YES: `src/solo/sales/invoiceDraftSnapshot.ts` (non-visual module under the Solo path); no Solo surface renders differently.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered Solo change.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered Solo change.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered Solo change.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered Solo change.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered Solo change.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered Solo change.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered Solo change.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered Solo change.
UNVERIFIED: post-merge production Edge source/config readback, `edge-live` advancement, deployed JWT configuration of the affected functions, deployed invoice drafting, and every invitation Chat/Live/customer-acceptance claim.

OWNER_INTENT: Verify and deploy the invitation fixes live, then continue the seven portal pillars. This slice removes the one release blocker found after PR #2293 merged, without weakening the verifier.
MUST_NOT_HAPPEN: No change to `.github/scripts/edge-source-readback.py`, the deploy workflow, `action-risk.ts`, invoice arithmetic, rounding, deposit rules, authority, approval, ledger, provider or UI behaviour. No forced `edge-live`, no migration-history reset, no forged evidence.
MUST_PRESERVE: `aggregateInvoiceItems` public API from `src/solo/sales/invoiceDraftSnapshot.ts` (same function object), the existing snapshot normalizer, BigInt int4 range guard, and every existing JWT/config contract.
ACCEPTANCE_CRITERIA: The `sales-invoice-draft-command` runtime closure contains no file outside `supabase/functions`; the frontend and Edge share one calculation; the full source-readback suite and invoice suites pass; after merge the normal or recovery Edge workflow certifies deployed source and advances `edge-live`.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Edge source verifier (unchanged, now satisfied); native invoice draft door (import path only); Chat invoice tool (suite PASS); invitation sender functions from #2293 (untouched).

INTERNAL_BUILD_IDENTITY: product=6e9b97a980720816af8fdda86306a15825488ef2; branch=claude/elegant-cori-cdhzuv; deployment=PROOF_OWED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(sales-invoice-draft-command and the accumulated #2293 function delta through the existing deploy workflow with exact source/config readback); evidence=docs/evidence/ui-delivery/e09-invoice-math-edge-source-root.md
RELEASE_CHANNEL: development: reviewed repair candidate; production Edge release follows merge through the existing guarded deploy workflow.
RELEASE_CLASSIFICATION: patch: move one pure invoice calculation inside the Edge source boundary so the existing verifier can certify the invitation release.
CUSTOMER_RELEASE_IDENTITY: none: internal repair with no customer-visible outcome.
RELEASE_NOTE_REQUIRED: no: nothing a customer can see changes.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: deployed Edge source/config certification and edge-live advancement; UNVERIFIED: invitation Chat/Live send and customer acceptance; no new LIVE claim.
RELEASE_RECOVERY: position=forward-fix; reference=revert this PR restores the prior import (which the verifier refuses); Edge recovery uses the existing workflow_dispatch in `.github/workflows/deploy-edge-functions.yml`.

## Scope and collisions

- Classification: release-blocker repair, non-visual.
- Affected flows: Edge release certification; invoice draft (preserved); dashboard invitation (#2298, downstream).
- Neighboring regressions: Solo Sales invoice editor and billing workspace, invoice draft API, Chat invoice tool, door resume.
- Active-owner/file collisions: open PRs #2306, #2308, #2298, #2297, #2229, #2227 and the open E04 drafts were diffed against main on 2026-10-17; none touch the five repair files (#2190 touches a different `sales-commercial` module). #2277 Live changes are already in the repair base.
- Explicit exclusions: verifier, deploy workflow, action-risk, migrations, UI.

## User job and state map

No visible state changes. The owner's invoice draft and its amount validation messages are byte-identical; the change is where the calculation lives so the Edge package is self-contained.

## Evidence index

- Root cause: Edge workflow run 39053371757 / job 117456304183 failed source verification with `unsupported_local_source_root` after #2293 merged (b5772250); `edge-live` did not advance.
- Repair commit 6e9b97a9 (calculation body SHA-256 7c55b3f8a17ef5d64ded4be022310eda3e7a59573eb3aac85dd98f1e44a644ee, unchanged).
- Commands and results: see AUTOMATED_EVIDENCE and STATIC_EVIDENCE above; run on Linux in the delivery container, 2026-10-17.

## Review and limitations

Review is AUTHOR-REVIEW / LOWER ASSURANCE (no distinct reviewer available), recorded in the PR. Remaining limitations are listed under UNVERIFIED.
