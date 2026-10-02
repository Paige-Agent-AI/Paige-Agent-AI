# Sales billing arithmetic foundation

Owner approved the Sales reconciliation prototype and invoice/deposit/recurring workflows on October 2, 2026, including removing its redundant Sales banner and adding defined outlines and lightly raised controls. The intended outcome remains canonical billing through each business's own Stripe and PayPal accounts, both required at launch.

This development slice implements only pure amount invariants in `src/solo/sales/billingAmounts.ts`. It has no consumer enabled yet and changes no visible workflow, provider call, persistence, authority, ledger state or customer availability.

The helper parses an explicit currency exponent without binary price conversion, refuses overprecision/unsafe integers, computes bounded quantities, rounds deposits to a minor unit while retaining a positive remainder, and derives remaining obligation from cumulative confirmed allocations minus confirmed reversals. Refund followed by repayment is supported. A provider refund is not automatically an allocation reversal: callers must project verified allocation evidence. Server writes must independently validate source scope, currency, database limits, current obligation and authority; browser arithmetic is never authoritative.

## Verification

- Failing first: focused suite could not resolve the missing helper. This establishes missing implementation, not mutation coverage of each invariant.
- Automated: 26 focused billing tests and 5 adjacent Sales Scenario tests pass; 31 total. Uses repository Vitest configuration with one thread worker.
- Independent review: a separately spawned non-author reviewer read both files, ran 24 initial tests, and identified the cumulative-refund/repayment contract ambiguity. Corrected in one batch; sole recheck read final files and ran all 26 focused tests, PASS with no material findings.
- Static: focused ESLint passes; diff whitespace check passes. Full TypeScript ratchet is rerun on final source; do not infer its result from the unit tests.
- Runtime: billing UI, canonical persistence, real caller authorization, provider operations, Rail/Spine and Analytics integration remain UNVERIFIED.

## Routing and release boundary

Sales/Campaigns family 4 owns client records/workflows; Money Spine family 11 owns financial effects. Extend the existing `paige_invoices` home after repairing canonical write authority and numbering. Retain canonical Catalog and commercial-term sources. Do not reuse the legacy MCP sender's synthetic URL as a payment link, or platform destination-charge checkout as tenant-owned collection.

The approved implementation follows Flow-by-Flow, then Impeccable. This arithmetic-only slice has no interface change; visual detector, rendered geometry and visual finish review are not evidence for these functions. The approved visual direction remains binding for subsequent UI changes.

Existing shared dependencies remain visible: campaigns.sales governed binding UNAVAILABLE; Stripe tenant-direct contract PARTIAL/future; PayPal registry entry absent; #787 form Rail vocabulary owner decision, #890 Sales disclosure routing, #1604 isolated preview proof, and active Chat/Analytics ownership. No parallel approval, receipts, job system or Memory store.

Release channel: development. Classification: internal-only. Customer release identity: none. Migration/edge/deployment: NOT_APPLICABLE. Shipped Delivery Log: N/A, not merged. Recovery: revert this additive helper and test. No tenant-specific branching or account identifiers added. No merge, production migration, deployment, real email, provider activation or money movement authorized by this record.
