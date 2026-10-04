# Solo Sales Collections delivery contract

Grounded main: f5432026c4cc44ac9974590bb79e666bcfdf9ab8. Owner approval: 2026-10-04, pinned Collections reference, ambitious drawers/popouts/full workspaces, agreement-backed repayment plans, and explicit full implementation green light.

## Intended usable flows

Payments has Invoices, Collections, and Model a scenario. Recurring is a collection-plan feature; old recurring links remain compatible. Collections reads canonical obligations and recorded receipts, supports partial/off-platform recording, agreement-backed schedules, reviewed import and safe export, and governed invoice delivery. All existing and future Solo tenants use the same scoped implementation.

Plans: full, installment, recurring, deposit/balance, milestone, custom. Monthly, quarterly, annual, and explicit-date schedules retain integer minor units and canonical agreement currency. Optional interest/late fees are agreed metadata and previews; no automatic accrual, charge, loan origination, or legal/APR representation.

Import must create usable canonical historical records after review, not merely attach references. Existing client identity is required; conflicts, external IDs, currencies, opening balances and duplicates are explicit. Imported/manual evidence is never provider verification. Issued snapshots remain immutable. Export excludes bearer grants and secrets, escapes spreadsheet formulas, and reports pagination/coverage.

## Capability pre-edit gate

1. Owner outcome: operate customer collections, including schedules, receipts, import/export and eligible delivery.
2. Owner: Sales owns commercial records; Clients owns identity; Integrations owns connections; Settings Billing remains platform-to-tenant money.
3. Harness: reuse current command/governance executor. INT-299 broad runtime architecture is deferred; no Sales harness or scheduler.
4. Spine: invoice email and SMS use existing billing_send_invoice risk/approval seam. Collection save/import and imported receipt/correction commands use explicit Capability Kit declarations, canonical risk keys, one approval door, transactional Rail and scoped readback.
5. Providers: email reuses tenant Resend/Gmail/SMTP; SMS reuses Twilio/A2P and recipient pre-send checks. iMessage has no current adapter and remains unavailable. QuickBooks mapping is preparatory, not a connected integration.
6. Authority: server resolves tenant/actor and policy; read-only cannot gain writes. Commercial writes and external sends retain approval/readback.
7. Jobs: no new scheduler; plan dates are records/previews until canonical execution exists.
8. Evidence: immutable manual receipts, invoice operation replay and Rail remain canonical. Provider acceptance, delivery and payment are separate facts.
9. State: current invoice lifecycle migrations430 and delivery43000002 are reused; new forward migrations47000000/47000001/47000002. Studio PR1692 owns46000000. Hosted application state is not inferred from local files.
10. Proof: contract/SQL isolation, replay/concurrency, UI keyboard/error/account-switch, responsive geometry, authenticated runtime and deployment evidence are separate gates. Fixture rendering cannot prove persistence or sending.

## Canonical reuse and collisions

- paige_invoices / paige_invoice_payments: obligations and immutable manual receipts/reversals.
- tenant_client_agreements: collection terms/schedules; no second plan ledger.
- clients / tenant_products: canonical people/offers.
- sales-invoice-command and sales-invoice-delivery: governed mutation and provider binding.
- send-message and pre-send-pipeline: sole email/SMS dispatcher and recipient policy.
- QuickBooks financial report/expense adapter is not an invoice/payment sync seam.

Root owns SalesWorkspace, shared command/risk/Spine registration and integration. UI worker owns isolated Collections components after contract handoff. Backend worker owns collection terms/import model and47000000. Delivery worker owns readiness, invoice dispatcher binding and47000001. Studio PR1692 edits shared risk/Chat/catalogue seams; additions must preserve its changes during integration. No Marketing redesign or Platform Analytics changes.

## Research grounding

- https://docs.stripe.com/invoicing/partial-payments — partial allocation and remaining balance; hosted invoice pages do not imply arbitrary partial checkout.
- https://docs.stripe.com/reports/payout-reconciliation — payout batches, fees and adjustments differ from customer collections.
- https://docs.stripe.com/billing/subscriptions/subscription-schedules — dates/phases/end behavior differ from an executed payment.
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/payment — customer, linked invoice allocation, unapplied amount, external ID and version matter for future accounting matching.
- https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html — company-scoped external events and current CloudEvents contract require a future dedicated adapter.

## Evidence status

Implementation in progress. PASS: production bundle; scoped command/Chat approval tests; isolated PostgreSQL isolation, replay, atomic-import, receipt correction, cursor coverage and bounded-lock proofs; risk, receipt and capability anti-bypass guards. Rendered review identified and repaired drawer clipping, wrong dark-theme surfaces and imported receipt controls. Full20 responsive fixture matrix and independent final visual inspection PASS; local imported partial receipt consequence/readback and reduced-motion preference PASS. No authenticated Collections capability, external delivery, hosted migration or release is claimed by this contract. The reference prototype uses labelled synthetic data only; production must consume canonical scoped records.

## Execution and truth

- `sales-collection-command` is the sole Collections approval consumer. It reuses platform pending confirmations and declared decisions; service RPCs commit exact parsed commands and Rail atomically.
- Existing manual receipt/reversal Chat tools route imported records into this same door; no duplicate payment tools or ledger.
- `read_sales_collections` delegates to bounded canonical readers. Its model projection omits customer identity/free text and preserves explicit record kind, version, currency, balances and provenance.
- Historical imports preserve source account/entity identity. Conflicts cannot commit. Appending a later receipt advances the invoice version, making stale forms refuse; receipts are corrected by immutable reversal, not deletion.
- Export snapshots record membership, not financial facts. Read-time timestamps and completed pagination distinguish scope and freshness; formula-looking cells are escaped.
- Email and SMS readiness checks are metadata/policy checks for this exact issued invoice and recipient. Verified provider acceptance is established only after execution. iMessage and QuickBooks synchronization remain unavailable.
- Plan terms and previews are saved to existing agreements. They do not activate autopay, issue invoices, accrue fees or schedule sends. Interest is an agreement-backed preview, not an APR or financing-law determination.

## Release collision

Studio PR1692 was draft at initial grounding and merged as39d5c956 during final validation and owns46000000 plus shared Chat/risk/receipt files. Collections47000002 preserves its immediate predecessor catalogue through an unconditional private forwarding call and adds only the three new classified rows. Read-only hosted grounding found Studio46000000 already applied before its subsequent merge. Sales unpublished migrations47000000–47000002 therefore follow the hosted ledger. The normal deploy uses db push without include-all; no older migration backfill is used. Future catalogue changes must preserve Sales keys: the catalogue erasure guard will reject its old full replacement if it drops these entries. Before release, recheck main and actual hosted migration order. No other lane's branch was edited.
