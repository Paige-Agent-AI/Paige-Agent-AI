# E04 client invoice access — development evidence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: linked client -> exact canonical invoices -> authenticated document/payment read -> scope reproof -> reload; ten-question routing below.
PAIGE_UI_DESIGN: PASS: project skill and routed references applied before implementation; existing client shell, semantic roles, account route and document presentation reused.
MATERIAL_FLOW_CHANGE: YES: linked clients can inspect their invoices, recorded balances and existing approved payment request without a newly minted bearer grant.
FLOW_PROTOTYPE: PASS: local preimplementation work/client-commercial-prototype flow and 96 synthetic checks; owner 2026-10-14 Full Delivery Directive approves O1–O12 and delegates routine UI decisions. No claim the owner accepted this prototype or the completed experience. Actual-source review fixture is committed below.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: ordinary linked external client inspects their own commercial records and opens the exact invoice.
VISUAL_DIRECTION: PASS: existing account list, HSL semantic roles, local Schibsted font, restrained amount hierarchy; immutable public document keeps its existing separate presentation.
AUTOMATED_EVIDENCE: PASS: 95 affected Vitest tests; native PostgreSQL 93 checks and two migration applications; Deno check of the actual edited Edge function.
STATIC_EVIDENCE: PASS: scoped ESLint zero errors/warnings; Vite production build passed; raw app TypeScript retained ten existing diagnostics and introduced none in the edited files. This is not a globally clean TypeScript claim.
RENDERED_EVIDENCE: PASS: assets/e04-client-commercial-status contains actual source images at 1536,1366,1024,900,390,320; account light/dark and isolated document; synthetic SDK/network only.
BEHAVIORAL_EVIDENCE: PASS: actual-source browser fixture 102 cases plus paging, focus, exact nonsecret invoice selectors, reload, sign-out scrubbing, test checkout labels and PDF-only failure. No actual provider checkout or download occurred.
AUTHENTICATED_RUNTIME: UNVERIFIED: ordinary owner/staff/external-client hosted operation has not been exercised for this continuation.
KEYBOARD_FOCUS: PASS: actual source link focus and component tests; existing document controls remain named, keyboard reachable and at least 44px. Complete portal-shell navigation acceptance remains owed.
ZOOM_REFLOW: UNVERIFIED: no horizontal overflow at six CSS viewport widths including 320; native browser zoom for this changed flow was not exercised.
REDUCED_MOTION: PASS: browser preference exercised; list disables transition/animation and this flow adds no motion. No native/device-motion claim.
STATE_COVERAGE: PASS: loading, valid empty, unavailable, refused, ambiguous, retired response, paging, mixed currencies, exact large aggregate, test evidence, scope loss and PDF failure covered locally.
TRUTHFUL_STATE_LABELS: PASS: server and component tests distinguish manual/live/test payments and undetermined provider environment; next obligation and engagement completion cannot be promoted to paid or completed.
SOLO_UI: YES: shared Sales payment copy/formatter path changes; mounted new surfaces are external-client /app/actions and isolated /invoice. No Solo layout or Chat admission change.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: owner Solo shell not exercised for this shared formatter change; external-client image is separate evidence.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: owner Solo shell with PAIGE open not exercised for this shared formatter change.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: owner Solo shell not exercised for this shared formatter change; external-client image is separate evidence.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: owner Solo shell with PAIGE open not exercised for this shared formatter change.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: owner Solo shell not exercised for this shared formatter change; external-client image is separate evidence.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: owner Solo shell with PAIGE open not exercised for this shared formatter change.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: owner Solo shell not exercised for this shared formatter change; external-client image is separate evidence.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: owner Solo shell with PAIGE open not exercised for this shared formatter change.
UNVERIFIED: independent non-author review and finish review, exact-head hosted CI, Preview/production deployment, E09 privacy cutover, native zoom/print/download, authorized provider TEST settlement, Central QA and owner acceptance.
OWNER_INTENT: All twelve E04 outcomes remain mandatory. This continuation supplies part of O4/O5/O11 while preserving O8 and the complete agreement-to-delivery destination.
MUST_NOT_HAPPEN: No borrowed owner authority, first-client choice, token mint, service key in browser, invented payment/signature/service success, duplicate ledger or automatic provider action.
MUST_PRESERVE: Existing bearer-grant invoice access and bootstrap privacy, frozen invoice facts, canonical receipt allocation, exact-version delivery review, E4-S3 and INT-346 DRAINING restrictions.
ACCEPTANCE_CRITERIA: Properly linked client sees only their invoices/balances, opens the same record, sees current approved request with correct environment, loses access on revocation, and returns/reloads without fabricated success. Hosted acceptance remains unverified.
MOTION_PURPOSE: NONE: immediate read/status transitions only.
PROTECTED_SEAMS: Actual actor/self-link and before/after scope checks; canonical ledger/version cursor; existing merchant binding/expiry/version checks; public invoice bootstrap; delivery review presenter untouched. Signing, approval consumption, Operations writes, provider dispatch and Chat admission are unchanged.
INTERNAL_BUILD_IDENTITY: implementation=01931a84da782818c6e8930b7b0c167d491dbcd2; source=a4eb489a4d1264aa7e608040e8ccca691fd88465; main=ffbdd1d3c1b7fa2aebbc79fcf2562c7822f80006; deployment=UNVERIFIED; environment=local development; migrations=PROOF_OWED(20271101164000); edge=PROOF_OWED(sales-invoice-document); evidence=this record and assets/e04-client-commercial-status/result.json
RELEASE_CHANNEL: development: local source and synthetic proof only; no runtime/provider activation.
RELEASE_CLASSIFICATION: internal-only: incomplete development integration toward the full E04 destination; no customer release candidate is declared.
CUSTOMER_RELEASE_IDENTITY: none: whole E04 customer outcome and acceptance remain incomplete.
RELEASE_NOTE_REQUIRED: no: no customer release is announced by this draft.
RELEASE_TRUTH_BOUNDARY: PARTIAL: implemented local scoped invoice/status/document reader; PROOF OWED: coherent privacy integration, authorized hosted operation and customer acceptance.
RELEASE_RECOVERY: position=forward reviewed correction preserving immutable invoices and receipts; reference=existing Sales readers and this additive forward migration

## Routing and source boundaries

1. **Outcome:** clients inspect the exact commercial relationship records later used by the owner. Classification: REUSE the invoice/ledger/document/checkout owners; EXTEND client-scoped reads and existing mounted account; REPAIR test/live presentation; no competing system.
2. **Owner:** E04 directly owns this continuation, with no retired-agent handoff. E09's new portal foundation retains its source boundary; existing helper adoption must compose that canonical producer, not replace it.
3. **Harness:** read-only customer projection; no approval, autonomy, execution, budget, durable-job or event admission added. Existing Harness/Trust remain consequential-action prerequisites.
4. **Spine:** incumbent `sales_invoice.read` remains the owner-facing capability. No new external-client Chat/Live capability is claimed. That integration is UNAVAILABLE here, and the admin reader is not exposed wholesale to clients.
5. **Provider:** existing Stripe registry/merchant infrastructure only; listing is not connection. The reader exposes an already approved usable URL only through canonical `_sales_invoice_payment_projection`. No new provider, connection, permission or activation is introduced; registry readiness remains unchanged.
6. **Authority:** actual `auth.uid`, real SDK `getUser`, exact linked nonmerged client, active relationship/business, standalone client book, no active staff membership, no platform-owner impersonation. JWT is memory/header transport, never a URL or authority substitute. Existing one-approval-gate execution is not modified.
7. **Durability:** existing `paige_invoices`, `paige_invoice_payments` and `paige_invoice_provider_operations`; no new table, ledger, scheduler, queue, approval or receipt stream.
8. **Readback:** canonical balance producer and immutable ledger/version cursor supply facts. Reload reauthorizes and rereads. Read-only UI emits no payment/delivery execution receipt.
9. **Surface:** existing account action surface and isolated document route; `ClientInvoices` mounts beside the preserved `ClientReleasedWork`. Binding Ledger runtime state is not promoted by local proof. New portal navigation/shell composition remains owed.
10. **Proof:** native fixture assertions are SQL/authorization evidence, browser fixtures are rendered/behavioral evidence. Neither is hosted customer authentication, provider settlement, Central QA or owner acceptance.

## Concrete implementation

- `read_client_commercial_status_scoped`: exact caller/client/tenant, keyset pages, per-currency totals from `_sales_invoice_balance_rows`, no draft/private collection strategy, no assumed next installment or engagement completion.
- `read_client_sales_invoice_payment_ledger_scoped`: reuse the existing canonical ledger and immutable cursor; redact internal provider-operation identity.
- `read_client_sales_invoice_payment_request_scoped`: read the existing latest request only, with the same invoice/snapshot/client/currency/remaining amount/merchant binding/environment/permission/expiry eligibility. Reads create no checkout or allocation.
- Existing `_sales_invoice_read` and ledger wrappers gain test subtotal/environment metadata. The existing payment projection gains environment; calculation and eligibility predicates remain with their canonical owners.
- `ClientInvoices`, `ClientScopedInvoiceDocument`, `InvoiceDocumentFrame` and `InvoicePaymentRequestView`: same account/document journey, stable nonsecret selector reload, no owner/bearer fallback after client refusal, sensitive view retired on actor/link loss. Public bearer view retains its original separate authorization and bootstrap behavior.
- Server document and payment copy identify test/unknown evidence. Unknown environment cannot offer a checkout link. Exact decimal-string formatting preserves large aggregate display without Number rounding.

## Reproduce the local proof

From repository root, using installed dependencies:

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/lib/client-commercial-status.test.ts src/lib/client-invoice-document.test.ts src/components/client/ClientInvoices.test.tsx src/pages/ClientScopedInvoiceDocument.test.tsx src/__tests__/e04-client-invoice-ledger.test.ts src/solo/sales/invoiceDocument.test.ts src/solo/sales/customerPaymentRequest.test.ts src/solo/sales/invoiceAppearance.test.ts src/pages/InvoiceDocument.test.tsx src/__tests__/invoice-document-bootstrap.test.tsx
node scripts/sql/e04-client-commercial-status-proof.mjs <psql> <isolated-loopback-port> <proof-user> <verified-own-cluster-directory>
node scripts/proof/e04-client-commercial-ui/check.mjs
```

The browser fixture starts/closes its own loopback Vite server, blocks external requests and uses synthetic caller/record transport. It imports the actual product components, CSS, adapters and invoice renderer. No user browser profile, session, account, provider or customer data is used. Native proof creates/drops only its own unique database after verifying the exact cluster directory.

The original multi-worker combined attempt executed zero tests because workers did not start; the unchanged set then passed 95 with one worker. An earlier sandbox attempt also ran zero tests due temporary-file EPERM. Five added false-confirmation regressions first failed, then passed after the repair. A browser fixture relocation initially timed out before any case; restricting dependency discovery to the one fixture produced the final 102-case result. No timeout, assertion, security guard or financial expectation was weakened.

Native receipt fixtures enforce the actual canonical receipt-shape constraint. Provider-verified rows are receipts only; reversal proof concerns manual correction. This does **not** implement or verify provider refunds/reversals, disputes, provider dispatch, reconciliation, or the complete production schema's writer/FK/RLS path.

Impeccable detector: zero anti-patterns; 18 advisories, comprising the new intentional fluid numeric emphasis and inherited isolated document palette/type values. Semantic client roles, real controls, hierarchy, contrast, mobile reachability, focus and immediate/reduced-motion behavior were checked. React review retained lazy client SDK loading for the public bearer route, primitive effect dependencies, abort/epoch invalidation and necessary sequential authorization reads. This is author review, not the required independent finish review.

## Remaining integration and acceptance

- E09 draft #2166 publishes `client_portal_relationship_id` and `client_portal_self_profile`. The existing E04 `readLinkedPortalClient` still performs the narrow raw self-link lookup. Consume the released producer coherently before raw self-RLS is retired; never add a permissive raw-table fallback. Full privacy cutover and external-client join remain gated.
- O2 effective exact signed economics, O3 authoritative next dated obligation, O5 actual Stripe TEST/refund/reconciliation, O6 onboarding integrity and O10 accepted commercial/service completion remain unfinished. An invoice's recorded zero balance does not establish any of them.
- Owner-facing Sales/Collections evidence presentation must also be reconciled through existing adapters; this document does not claim every department's test-mode labels are fixed.
- Actual client invoice/checkout behavior needs properly linked ordinary external-client QA. Designated owner access is not that role. No new QA account was created and no acceptance evidence was self-authored.
- Fresh exact-head independent review, CI, authorized deployment/readback and Central QA remain separate gates. INT-346 DRAINING is preserved. Final owner review concerns all twelve outcomes.
- Master Section 4.0 shipped row: **N/A — this draft has not merged to main**. No shipped/deployed/customer-ready claim or customer release name is added.
