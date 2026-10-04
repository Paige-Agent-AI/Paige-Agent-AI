# Solo invoice workspace and PDF delivery

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: owner-approved invoice inspection/payment/delivery packet in docs/delivery/solo-sales-invoice-pdf-workspace.md.
PAIGE_UI_DESIGN: PASS: project overlay/modules and Impeccable craft floor applied; https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md.
MATERIAL_FLOW_CHANGE: YES: spacious invoice pop-out, inline payment corrections, PDF download/print and email attachment.
FLOW_PROTOTYPE: PASS: owner approved invoice-popout-prototype.html on 2026-10-04: “okay perfect. You can move forward with live implentation”.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo business owners inspect the invoice, record/correct received payments and prepare delivery; customers download a real PDF.
VISUAL_DIRECTION: PASS: Mineral/Obsidian tokens; invoice preview beside an operational action pane, one body scroll, full-screen compact workspace.
AUTOMATED_EVIDENCE: PASS: 220 tests across 21 invoice/billing/delivery suites; real Chromium PDF smoke produces four valid template PDFs and blocks network requests.
STATIC_EVIDENCE: PARTIAL: production Vite build passes. App tsc retains ten pre-existing errors in unrelated files; no changed-file errors. JavaScript syntax and contract inspection pass.
RENDERED_EVIDENCE: PASS: 24 actual component cases, both themes and PAIGE states, six viewport sizes; assets/solo-sales-invoice-pdf-workspace/workspace-proof.json, desktop.png, mobile.png and invoice.pdf.
BEHAVIORAL_EVIDENCE: PASS: partial payment draft/review/cancel and guarded dirty exits; correction review/cancel preserves input; delivery approval explains attachment; PDF failure refuses download; public token download scrubs URL. All component auth/RPC responses are local fixtures.
AUTHENTICATED_RUNTIME: UNVERIFIED: trusted CUA process failed; signed-in owner/second-tenant, production bearer document and provider attachment acceptance not driven. No external email or payment mutation performed.
KEYBOARD_FOCUS: PASS: payment/correction inputs receive focus; review cancel returns to editing; pop-out close restores its invoker in actual-component fixture drive. Full authenticated keyboard path remains UNVERIFIED.
ZOOM_REFLOW: PASS: 390/430px narrow reflow has no horizontal body overflow. Native browser zoom UNVERIFIED.
REDUCED_MOTION: PASS: reduce preference used in component drive; workspace and overlay animations/transitions disabled under that preference.
STATE_COVERAGE: PASS: issued/partial balance, record/correct draft, canonical prepare/cancel, dirty continue/discard, PDF unavailable/retry, preview loading/error and public-link invalid refusal covered by component/unit contracts. Real role/account switching remains UNVERIFIED.
TRUTHFUL_STATE_LABELS: PASS: human-recorded payment remains separate from provider settlement; provider acceptance remains separate from customer delivery. PDF preparation failure sends nothing.
SOLO_UI: YES: shared Sales Payments and public invoice document, all existing/future Solo tenants; no account-specific path.
UNVERIFIED: hosted renderer, authenticated owner/second-tenant, native PDF viewer print, real provider attachment acceptance and full role/workspace-switch journey.
OWNER_INTENT: Remove draft UUID/technical reference from customer invoices; replace cramped invoice action area with approved pop-out; download/print/email genuine PDFs.
MUST_NOT_HAPPEN: No extra invoice store, second browser host, new approval gate, payment mutation without canonical review, inferred settlement, cross-tenant data or HTML disguised as PDF.
MUST_PRESERVE: Frozen issued obligations/branding; historical numbers/documents in storage; canonical ledger conservation, reversal history, approval/idempotency/recovery, sender readiness and SMS A2P boundaries.
ACCEPTANCE_CRITERIA: Invoice action pop-out fits laptop/tablet/mobile; edits survive cancel/dirty close; clean customer PDF contains current dated payment facts; approved email sends the same PDF projection through existing provider seams or fails closed.
MOTION_PURPOSE: Existing dialog entrance/exit only; reduced-motion removes it.
PROTECTED_SEAMS: Tested invoice ledger/version, public grant, command approval/unknown recovery, token redaction, shared browser auth/rate/concurrency/network fence and ordinary email transport. Settings platform Billing, agreements/seals, Clients identity, Marketing writes, entitlement, chat transcript and scheduling remain unchanged.
INTERNAL_BUILD_IDENTITY: git commit containing this record; deployment=UNVERIFIED before merge; environment=development; migrations=NOT_APPLICABLE; edge=UNVERIFIED sales-invoice-document/send-message pending canonical deploy; evidence=this record and assets.
RELEASE_CHANNEL: development: production promotion authorized by owner; actual deployment identities must be recorded after merge.
RELEASE_CLASSIFICATION: internal-only: invoice workflow repair, no named customer release.
CUSTOMER_RELEASE_IDENTITY: none: authenticated end-to-end acceptance remains PROOF OWED.
RELEASE_NOTE_REQUIRED: no: no customer announcement authorized.
RELEASE_TRUTH_BOUNDARY: PARTIAL implementation with local automated/rendered proof; production/provider/authenticated claims remain PROOF OWED.
RELEASE_RECOVERY: position=forward-fix scoped renderer/UI/transport; reference=existing immutable invoice facts and governed operation recovery retained; PDF failure refuses provider dispatch, never substitutes HTML.

SOLO_1536X770_PAIGE_CLOSED: PASS: workspace-proof.json both themes; body is scroll owner, no horizontal overflow.
SOLO_1536X770_PAIGE_OPEN: PASS: workspace-proof.json both themes; modal overlays dock, controls remain reachable.
SOLO_1366X768_PAIGE_CLOSED: PASS: workspace-proof.json both themes; viewport-fitting workspace.
SOLO_1366X768_PAIGE_OPEN: PASS: workspace-proof.json both themes; viewport-fitting workspace.
SOLO_1024X768_PAIGE_CLOSED: PASS: workspace-proof.json both themes; stacked actions and preview toggle.
SOLO_1024X768_PAIGE_OPEN: PASS: workspace-proof.json both themes; compact PAIGE folded before modal; no overlap claim for underlying compact dock.
SOLO_900X1000_PAIGE_CLOSED: PASS: workspace-proof.json both themes; stacked actions and preview toggle.
SOLO_900X1000_PAIGE_OPEN: PASS: workspace-proof.json both themes; compact PAIGE folded before modal; no overlap claim for underlying compact dock.

## Evidence and review boundary

Fresh main grounded at 2441d069; Sales owns this slice. Adjacent Marketing PR1704 owns its editor, PR1657 owns address lookup; no file collision found with invoice, send-message or shared browser changes. Recheck before merge.

Reproducers: scripts/live-drive/invoice-workspace-smoke.mjs (24 geometry/interaction cases), invoice-workspace-extra.mjs (correction, attachment approval, error, focus and public PDF), scripts/invoice-pdf-smoke.mjs (actual invoice HTML + warm-browser PDF). Synthetic records only. Production role, sender/provider and second-tenant claims are not established by them.

PDF generation uses the existing paige-browser host, not a new service: JavaScript off, service workers blocked, every network request aborted, bounded HTML/output and per-phase timeouts. Existing document read authentication/grant is unchanged. Email attachments are derived server-side after the canonical atomic claim from the current version-checked ledger; the invoice is re-read before provider dispatch. A pre-provider PDF failure finalizes failed; a provider-attempt failure remains outcome_unknown. No token or PDF bytes are persisted in message metadata/logs.

Customer documents hide legacy DRAFT references without renumbering/mutating historical issued facts. Correct payment appends the existing governed reversal; replacement is a separate recorded receipt, never an in-place rewrite.

Independent exact-head non-writer and Impeccable finish review must complete before merge; its verdict is recorded in the PR. Scope is INT-299 deferred; no wider Sales Harness architecture is included.
