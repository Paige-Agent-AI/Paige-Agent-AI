# INT-311 — commercial golden path

## P1 pre-edit contract

Grounding: current main `5aeb39cc6dbcaa1e597d2e09632ee0fcabcfae77`. Development channel; not a release claim.

1. Outcome: read one canonical invoice package with exact recorded principal installments, source versions and unresolved dependencies. The complete creation/delivery/payment path remains the program goal.
2. Ownership: Sales owns this domain adapter. Clients owns identity, Catalog owns offer facts, Agreements owns signing/document truth. Trust/C4 owns approval and same-objective resume; INT-346 remains an execution gate.
3. Harness/Gateway: reuse the existing Sales domain dispatcher and caller-JWT package RPC. The historical Harness map is routing evidence, not current production acceptance. No executor or context fabric is added.
4. Spine: existing `sales_invoice.commercial_package_read`, executor `public.read_sales_commercial_package`. Existing terms writes remain `sales_collections.create_commercial_terms` and `sales_collections.save_terms`.
5. Providers: no provider call in this slice. Stripe and PayPal registry entries were read. Stripe TEST acceptance and PayPal execution remain unproven; a listed provider is not connected.
6. Authority: read_only, no mutation verb, no approval or budget consumption. Constituent creates, publication, delivery and payment retain their separate existing gates. A schedule preview grants no mandate or package authority.
7. Durable work: none in this slice. C4 and canonical durable work own continuation and later recurring execution. No Sales scheduler or resume table.
8. Readback/Rail: validate the authenticated canonical package projection, then use the existing Collections parser/calculator for principal schedule rows. Keep its existing read receipt. No per-installment settlement inference or balance calculation.
9. Surface: existing PAIGE package-read result; no new visual interaction, navigation, controls, CSS or redesign. Binding-ledger `sales.department` proof boundary is unchanged.
10. Proof: failing-first adapter/dispatcher tests, full affected contract regressions, independent exact-head review, CI and deployed source readback. Authenticated manual package creation and conversational acceptance remain owed. No synthetic provider acceptance claim.

## Existing path and smallest gaps

`tenant_products/tenant_prices` → `tenant_client_agreements` → collection_terms → `paige_agreements.commercial_terms_id` → invoice snapshot agreement reference → `paige_invoices` → provider operation → `paige_invoice_payments` → canonical balance/Rail.

The deterministic repayment builder already conserves 350000 total, 50000 deposit and ten 30000 installments, requiring explicit dates. Manual controls can persist custom rows using the existing governed save action. The package reader currently returns recorded schedule configuration without the deterministic expanded rows consumed by the manual preview. This slice connects those reads; it does not claim new invoice creation or manual automation is complete.

The returned schedule is a recorded **principal preview**, not a payment-state ledger. Unknown taxes/fees, signed-term compatibility, delivery policy and signature dependencies remain explicit. No guessed dates, per-installment payment allocation, automatic collection or signed agreement mutation.

## Grounded external gates

Production aggregate read: one merchant setup row, zero provider operations, two payment records, one invoice and zero commercial-term records. Counts do not establish merchant readiness or actual provider payment acceptance. No customer rows or merchant identities were exported.

INT-346 repair #1823 is open/unmerged at grounding. Consequential PAIGE acceptance remains blocked pending its owner's verified production clearance. Safe read/domain work continues. INT-335 package-wide authority remains open; individual act approvals remain authoritative.

## Shared layer impact

Canonical Sales records: CONSUMER. Spine: CONSUMER of existing read. Trust: CONSUMER of existing read authorization. Rail: CONSUMER of existing receipt. Operating Fabric: FOLLOW-UP OWNER for cross-department composition. Metric/Evidence: existing Sales producers; no change. Harness/Orchestration/Events: NONE in this slice, later shared consumers. Memory/Knowledge: NONE for balances or schedule truth. Agent Intelligence: FUTURE CONSUMER of verified outcomes. C4/INT-346: FOLLOW-UP OWNER for consequential conversation.

Upstream Marketing may supply lead/source/routing context; canonical Clients and Sales retain commercial identity. Downstream delivery commitments and COO financial review consume domain-owned facts; their cross-domain handoffs are UNVERIFIED here. Provider settlement, recurring mandates and governed Collections follow-through remain separate milestones.

## Proof boundary

Implementation/tests/review/CI/merge/deployment are recorded only after observed. No money moved. No merchant enrollment, production commercial mutation or consequential conversational execution is performed by this slice.

Local verification: eight failing-first projection tests reproduced before implementation. Six focused test files pass (127 checks). Canonical stale/conflicting economics remain readable, with schedule preview withheld; inactive terms retain explicit status. Capability declaration lint has zero source disagreements and no baseline growth. Independent review, hosted CI, merge, deployment and authenticated acceptance remain owed.

Impeccable clarification checks applied: recorded due amounts are distinct from settlement/allocation, inactive terms remain explicit, missing taxes/fees remain unresolved, and no preview grants autopay or package authority. No visual layout changed. Canonical skill source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md

## C1 historical signing-context correction — development proof

The canonical `peek_agreement_signing(text)` read previously joined current mutable commercial terms next to a frozen document. The forward correction returns null amount/currency/term-summary while preserving the exact twelve-column response, document readability, token denials, first-view events and existing grants. Null means unknown; it is not zero, compatibility or acceptance. No signed history, document body/hash, approval, provider, schedule or activation is rewritten.

Native PostgreSQL proof: `scripts/agreements/signing-context-economics-proof.mjs`; failing-first baseline rejects the priced header, repaired replay twice passes 24 checks using the canonical draft writer and actual anon/authenticated RPC caller roles in a unique isolated database. This is synthetic database evidence, not hosted authentication, real signing or production acceptance. Evidence: `docs/evidence/ui-delivery/sales-signing-context-economics.md`.

C1 remains PARTIAL: a prospective approved-and-presented immutable economic/schedule producer is still absent. Historical signed financial compatibility stays UNVERIFIED; this correction removes an unsupported header claim only. E04 journey, shared Chat/authority, Analytics, INT335/346, and Operations handoff are unchanged.

## E04 direct continuation — prospective source and freeze contract

The retired lane's presentation and caller-scoped source helpers are preserved in the E04 continuation. The original SQL placeholder was empty; E04 adds the service-only freeze contract to the existing `paige_agreements` record. It retains the original body and freezes the exact rendered body, source versions, finite principal schedule, explicit included tax/fee treatment and document digests. The existing Collections producer owns all schedule generation. Replays return the same freeze without another event; changed source or payload is refused. This function neither authorizes an act nor sends or signs a document.

Fresh local proof: native PG16 31 checks with two migration applications; Deno 10 tests and 16 steps, including a real incumbent PDF render; caller-scoped reader Vitest 15 tests. The initial fixture-signature mismatch, missing new column and Windows raw-text newline mismatch were repaired before the successful native run. Cached-only Deno and default Vitest discovery attempts executed zero tests; explicit existing runners resolved those setup failures without a product fallback. Hosted CI, independent review and authenticated operation remain owed for this new composition.

All twelve E04 outcomes remain mandatory. This is an incomplete internal contract: approved execution wiring, both signature entry paths, effective-term transition, invoice/obligation lifecycle, owner/client UI and authenticated acceptance remain to be delivered. No historical terms are inferred or backfilled, no signed history is changed, and no production effect or provider readiness is asserted.
