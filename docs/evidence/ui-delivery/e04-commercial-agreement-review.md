# E04 saved agreement review — development evidence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: extend the existing invoice inspection into a read-only review of the canonical proposal, then return to the same invoice.
PAIGE_UI_DESIGN: PASS: existing Sales inspection, InvoiceCommandReview, Solo tokens and shared Dialog reused.
MATERIAL_FLOW_CHANGE: YES: an authorized managing owner can inspect full proposed wording before any signing action.
FLOW_PROTOTYPE: PASS: local ten-state walkthrough exercised at 1366 and 390 widths before implementation; owner full-delivery instruction authorizes routine UX decisions, not final product acceptance.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: managing owner reviews the saved client, services, economics, dated obligations and conditions in the invoice's existing commercial inspection.
VISUAL_DIRECTION: PASS: existing typography, themed body portal, bounded reader and two accessible exits; no new workspace or navigation system.
AUTOMATED_EVIDENCE: PASS: affected Vitest 54 tests; agreement Deno 82 tests and 16 steps; scoped lint clean; production build completed in 1m21s. App tsc retains ten known baseline diagnostics, zero in edited files.
STATIC_EVIDENCE: PASS: exact source/account identity, existing authenticated reader and permission floor, shared canonical schedule/hash/composer; no writes or financial recalculation.
RENDERED_EVIDENCE: PASS: seventeen isolated actual-source browser cases, twelve exact viewport PNGs in assets/e04-commercial-agreement-review; synthetic transport, no hosted identity.
BEHAVIORAL_EVIDENCE: PASS: isolated mounted package inspection opens full proposal; close/Escape restores focus, pending completion and account retirement cannot restore stale content; missing/refused/error and long wording exercised.
AUTHENTICATED_RUNTIME: UNVERIFIED: no hosted ordinary owner, staff or linked external client was driven.
KEYBOARD_FOCUS: PASS: initial heading focus, accessible reader, Escape and return focus verified in isolated actual-source browser.
ZOOM_REFLOW: UNVERIFIED: actual viewport reflow checked down to 320px; native browser zoom not exercised.
REDUCED_MOTION: PASS: browser preference readback verified; this change adds no motion.
STATE_COVERAGE: PASS: proposed/loading/missing details/refused/error/retry/close/late completion/account retirement/long body covered locally; hosted persistence unverified.
TRUTHFUL_STATE_LABELS: PASS: proposed wording is not frozen, approved, signed, effective, invoiced, paid or sent.
SOLO_UI: YES: existing SalesBillingWorkspace and CommercialPackageInspection only.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: isolated reader frame is not the full authenticated Solo shell.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: authenticated Solo with PAIGE open not driven.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: isolated reader frame is not the full authenticated Solo shell.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: authenticated Solo with PAIGE open not driven.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: isolated reader frame is not the full authenticated Solo shell.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: authenticated Solo with PAIGE open not driven.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: isolated reader frame is not the full authenticated Solo shell.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: authenticated Solo with PAIGE open not driven.
UNVERIFIED: independent non-author source/finish review, exact-head hosted CI, deployment, signing integration, effective terms, obligations, actual provider settlement and owner acceptance.
INTERNAL_BUILD_IDENTITY: implementation=ce7f2bc1a2ae83152460e7998ead451bdb21b40b; deployment=UNVERIFIED; environment=isolated local browser and source runners; migrations=NOT_APPLICABLE(this child diff); edge=NOT_APPLICABLE(this child diff); evidence=this record
RELEASE_CHANNEL: development: local implementation only, no production activation.
RELEASE_CLASSIFICATION: internal-only: incomplete O1 review integration supporting the full twelve-outcome E04 delivery.
CUSTOMER_RELEASE_IDENTITY: none: full E04 remains incomplete.
RELEASE_NOTE_REQUIRED: no: no customer release asserted.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local source/rendered proof only; PROOF OWED: hosted authorization, persistence, independent review and acceptance.
RELEASE_RECOVERY: position=retain existing invoice and agreement records; reference=parent canonical presentation contract, no schema change in this child.

## Capability routing and pathway

The owner reviews saved commercial wording in Sales → invoice → Inspect commercial package → Review saved agreement → Close or Back to invoice. `SalesBillingWorkspace` passes managing permission and the account epoch to `CommercialPackageInspection`; its draft-only reader mounts `CommercialAgreementPreview`. The dialog uses the existing caller-authenticated `readCommercialPresentationProposal` and canonical source/version checks. Full proposed wording is assembled by the same `commercialPresentationText` used by the existing PDF producer. The existing Collections schedule engine produces the dates and amounts. No new agreement, ledger, scheduler, writer, provider, approval or receipt system exists here.

This is EXTEND/REUSE. Existing Spine `sales_invoice.commercial_package_read` maps to `public.read_sales_commercial_package`, with canonical actor checks and Rail read receipts. Its bounded Chat projection is unchanged. Preparing/freezing/sending through admitted Chat remains UNAVAILABLE in this slice. INT-346, the existing Harness/Trust approval gate and protected shared runtime remain unchanged. This read-only surface adds no MUTATION_VERB, event job, provider requirement or execution authority. Existing Sales surface bindings remain partial; this evidence does not promote them to LIVE.

Important source versions and missing details remain visible. The reader requests nothing until opened, tags state with exact account/invoice/agreement identity, rejects late responses after close or retirement, and exposes human recovery without raw backend errors. No signature, customer notification or financial completion is claimed. Saved draft changes remain in the existing editor; the proposed review itself does not retain an immutable presentation.

## Reproducible proof and limitations

`scripts/proof/e04-agreement-preview-ui/check.mjs` compiles the actual mounted inspection and canonical proposal/source/schedule/hash modules. Only database transport and identity ports are synthetic. A fresh headless context blocks external requests and writes twelve viewport screenshots at 1536×770, 1366×768, 1024×768, 900×1000, 390×844 and 320×720 in light/dark themes; PNG dimensions and actual viewport containment are asserted. `result.json` records seventeen passing cases, no page errors and zero external requests. No existing browser profile or customer session is used.

The SQL package projection intentionally omits payment-row labels. An initial fixture retained them and was corrected to the actual projection allowlist; no production guard was relaxed. Earlier full-page capture framing suggested clipping, but the actual viewport bounds passed: no demonstrated product clipping defect is claimed. Viewport screenshots now avoid that capture artifact. The existing body-portal pattern also avoids changing the shared Dialog API.

`src/__tests__/agreement-commercial-presentation-read.test.ts` brings the real fifteen-case reader contract into the normal CI test glob. The focused component/reader/editor batch passed 54 tests. Agreement Deno passed 82 tests/16 steps after composer extraction. Scoped lint passed without warnings; the production build passed. Raw app TypeScript is not clean: ten incumbent diagnostics remain outside edited files.

Impeccable context, hardening and craft passes were applied using the installed skill (upstream https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md). Its detector exited successfully without emitting findings; no numerical score or independent finish review is invented. Review is self-reviewed, lower assurance. Required independent review remains owed; no other agent was assigned.

ANT-51 retains the twelve-outcome matrix; ANT-52 retains protected acceptance. All twelve outcomes remain mandatory and incomplete. These local fixtures establish no authenticated acceptance, deployment, immutable signing or payment result. Shipped Delivery Log: N/A, this child has not reached main.
