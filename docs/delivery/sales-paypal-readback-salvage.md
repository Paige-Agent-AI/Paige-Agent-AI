# PayPal readback salvage — bounded, non-executing slice

Base: `53dbf7eb` (current main, INT-334 R4). Source branch: `141a3e1bbf5789d0eb7c033b708d6bc0b59ad8f7`. Only the two PayPal readback files are ported. No inherited branch commits, Chat/router changes or stale delivery claims are carried forward.

## Pre-edit capability routing

1. Outcome: establish a safe PayPal provider-fact normalizer for the existing canonical money contract; this does not make PayPal usable yet.
2. Owner: Sales Payments. Shared Turn Route, C4, Memory and Cognitive Fabric remain untouched.
3. Harness/Gateway: the eventual executor must supply account-scoped, authorized provider GET responses through the canonical provider transport. This module does not acquire credentials or create another gateway.
4. Spine: existing `sales_invoice.payment_request` is the eventual caller; PayPal execution is UNAVAILABLE in the current adapter. This port does not register a second payment capability.
5. Provider: Integration Capability Registry `paypal`; partner access, seller onboarding/permissions, environment and binding-version readback remain PROOF OWED. Listed never means connected.
6. Authority: read-only normalization, no mutation verb or approval. Later request/capture acts retain their existing high-risk Trust gate; this module grants no authority.
7. Jobs: none added. Existing provider reconciliation durable work remains the eventual owner.
8. Evidence: exact order, merchant, operation/request/invoice references, amount, currency, final capture and environment are checked. Output is only the existing safe `HostedPaymentReadback` union; the canonical writer alone owns allocation and Rail.
9. Surface: no visible surface or Binding Ledger state changes. PayPal request UI remains unavailable.
10. Acceptance: deterministic provider-shaped tests only. Real provider responses, credentials, seller permissions, hosted execution, authenticated two-tenant settlement/allocation and launch parity remain UNVERIFIED.

## Flow and refusal boundaries

Canonical request + immutable operation → authorized merchant/environment GET order → validate one purchase unit and exact references → approved/payer-action state remains unallocated → completed capture candidate → GET exact capture → validate merchant/order/amount/currency/environment and instant disbursement → safe settled facts for the existing allocation writer.

Transport failure, missing object identity, missing evidence or conflicting facts remain `outcome_unknown`. This module never POSTs, captures, searches for or creates another payment. Reconciliation without a known order identity still requires the later canonical recovery adapter; that gap is not hidden.

The accepted evidence contract is intentionally stricter than fields marked optional by PayPal. Missing payee, disbursement, related-order, fee/net or exact-environment self-link evidence refuses settlement. Authenticated provider testing must establish whether the delegated GET response supplies these facts before the adapter may allocate. A future alternative must establish equivalent evidence, not remove checks just for green tests.

Sources: [PayPal capture definition](https://developer.paypal.com/sdk/payment/v2/definitions/capture/), [platform checkout](https://developer.paypal.com/platforms/checkout/standard/integrate), [merchant onboarding readiness](https://developer.paypal.com/platforms/checkout/save-payment-methods/onboarding/platform/).

No ledger, balance store, scheduler, approval channel, provider activation or customer-money action is introduced. No PAN/CVV, payer payload or provider error reaches returned facts. PAIGE Billing is unchanged.

Local verification: the complete provider-contract suite passes 206 tests across 11 files, including 33 PayPal cases. No authenticated provider response or payment was exercised. Development channel only; migration/Edge/UI deployment changes NOT_APPLICABLE. Exact commit and independent review are recorded in the PR before merge. This is internal substrate work, not a customer release or S4 acceptance.
