# Sales invoice post-merge correctness repair

Owner authorized 2026-10-04: close #1723 and repair both #1715 findings before INT-299/INT-311 grounding. This is the current invoice lane, not provider Payments completion.

## Pre-edit routing and collision map

1. Outcome: an unpublished draft opens honestly; a rendered invoice cannot change between the delivery claim and provider dispatch.
2. Owner: Sales invoice/Payments. Current main 601c53be741db76ce64f418daa437972b0507a74. Marketing #1725 owns email campaign Chat and migration 20270564000000; research #1714 claims 20270558000000; Sales address lookup #1657 is independent. The repair reserves unused 20270562000000 and does not edit their production seams.
3. Harness/Gateway: existing governedExecution and sales-invoice-command remain the door. No new run, scheduler or gateway; broader INT-299 remains deferred.
4. Spine: sales_invoice.read, sales_invoice.publish, sales_invoice.record_manual_payment, sales_invoice.reverse_manual_payment, sales_invoice.void and sales_invoice.email_send remain canonical. SMS remains the existing billing_send_invoice policy path, not a newly claimed binding.
5. Providers: existing Resend/Gmail/SMTP Comms and paige-browser PDF host. No new eligibility, merchant connectivity or financial-provider claim.
6. Authority: existing high-risk canonical approval, existing per-tool Trust policy and billing_send_invoice. The trigger grants no write authority; read-only roles retain no new write.
7. Jobs/events: no new durable job; existing delivery operation/message and its finalize/readback are reused.
8. Proof: claim and financial mutation serialize on the existing paige_invoices row; canonical messages.sales_invoice_binding dispatching state refuses receipt/reversal inserts and lifecycle/status changes. Finalization retains provider_accepted/failed/unknown and Rail distinctions.
9. Surface: sales.department remains PROOF_OWED. Draft workspace uses canonical draft/issued/void status. No design, route, tier or status promotion.
10. Acceptance: actual isolated SQL race, repeated migration, no-side-effect refusals, terminal release, component publication transition and responsive rendering. Real owner/second-tenant, live provider acceptance and pending-operation recovery remain UNVERIFIED.

## Repair contract

The delivery claim already locks the invoice before changing its message to dispatching. The new mutation trigger uses that same row lock, including before receipt inserts, so an uncommitted claim and a competing financial write cannot pass each other. While dispatching, typed P5501 refuses changes with an exact recovery step. There is no time-based release: elapsed time cannot prove a stopped provider attempt. A stranded dispatch requires canonical provider readback/finalization, never an automatic resend or invented success. Existing service-only finalize determines the real terminal outcome; unknown still fences a fresh delivery.

The draft workspace does not fetch the issued-document endpoint or label itself previously issued. Canonical publication/version readback enables the issued preview. Cancel, dirty-close, focus, PDF and approval seams remain intact.

## Verification and release

Local isolated PostgreSQL proof runs the actual migrations twice, refuses receipt/correction/void without side effects during dispatch, proves a concurrent receipt waits for the uncommitted claim then refuses, and permits a financial write after finalization. Removing the guard makes that regression fail. No production records are written by this fixture.

Focused tests: 220 invoice/billing/delivery contracts and 17 component tests PASS. Rendered draft/static results are recorded in the UI evidence. Exact-head separate review, CI, merge, migration persistence, edge deployment and production web identity are required and remain pending before PR preparation.

Release channel: development, production authorized after gates. Classification: internal-only. No customer release name or announcement. Recovery: scoped forward fix; never release an uncertain dispatch merely because a clock expired. Provider maturity and authenticated tenant acceptance are not inferred.
