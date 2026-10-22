# Core client Payments reachability

## Pre-edit routing and compact design brief

Current portalMenu.ts documents a known limitation: a server-resolved customer whose business catalogue lacks billing has no in-app Payments entry or Home balance line, despite the original authorized invoice pages. Complete universal seven-pillar delivery requires the same owner-hideable Payments destination across eligible businesses. Ordinary client billing is not the optional funding/credit product.

Goal: reach genuine own-business invoices through the existing customer navigation.
Human and feel: invited service customer; clear, familiar and trustworthy.
Entry and exit: existing Paperwork group/drawer -> Payments -> original invoice -> Payments/Home.
System: original AppNav, grouped menu, Billing/BillingInvoice and shared tokens; no new shell or layout.
Signature: the business's brand and original issued invoice/receipt, never invented money.
Feedback: original read loading/error/empty/issued states; ordinary navigation, no haptic or new motion.
Rejecting: address-only access and accidental funding activation.
Variants: catalogued/legacy/funding business, owner-hidden/renamed, unresolved/staff/foreign/revoked, desktop/mobile.

1. Outcome: discover and inspect the existing authorized client invoices without knowing a URL.
2. Domain: EXP09 owns customer menu/preview and Home reachability. EXP04 owns invoice/payment facts, documents and merchant logic. No commercial source edit.
3. Harness/Gateway: original customer read/relationship/hosted-link contracts; no new executor or provider call. Ordinary reads are not forced into Layer C.
4. Capability: existing client_portal_invoices, client_portal_invoice_payment_request and original invoice document services; owner Chat reuses client.engagement_status. No new Spine capability or availability grant.
5. Integration: original approved tenant merchant connection only, rechecked by the original per-invoice reader. No key, sender, Stripe/ledger, budget, provider registration or activation change.
6. Authority: current server-resolved business/customer relationship and native invoice scope. Menu is presentation, not authorization; owner overlay remains authoritative for hide/rename/order.
7. Durable work: existing invoice/payment request/receipt; no new row, scheduler, financial writer or action ledger.
8. Receipt: only original issued invoices and genuine provider/manual/test receipt classes; opening Payments creates no charge. A request is not collected money.
9. Surface: existing customer Payments and owner menu/preview share one registry. Add only the existing shownToCustomers rule to billing, preserving its customer floor and all funding entitlements.
10. Proof: before-edit prototype, failing missing-catalog regression, original menu/owner-editor/Home/payment negatives, rendered customer desktop/narrow navigation, exact-head CI and production source/readback. Actual external-client invoice/merchant transaction remains separately owed; no live payment test here.

## State and transition map

| From | Trigger and guard | Result | Feedback and recovery |
| --- | --- | --- | --- |
| Existing menu | Open Paperwork/mobile menu; verified customer, owner did not hide Payments | Original Payments link | Existing keyboard/focus/active-section behavior |
| Payments | Original authorized read succeeds | Issued invoices or genuine empty state | Existing source-backed facts and invoice link; return Home |
| Payments read | Loading/error/offline/relationship refusal | Original loading/recovery/permission state | No invented zero or leaked invoice; existing retry/exit |
| Invoice | Select original invoice | Existing invoice/receipt and permitted hosted link | No click on Pay/charge in this navigation change |
| Owner menu | Hide/rename/reorder billing through original config | Same registry preview/customer projection | No new configuration writer; stored choice preserved |
| No current customer | Staff/unresolved/revoked/foreign relationship | Existing floor/read refusal | No menu-to-authority inference |

New confirmation, destructive action, appointment expiry, file upload and haptic states: N/A; no such act is introduced. Payment/link expiry and unknown provider outcomes remain the original invoice contract. This is a bounded reachability flow, not permission or billing implementation.

## Prototype and release boundary

Reuse the original Payments customer/AppNav mount with synthetic original transport and deterministic missing-catalog/owner-hidden states. Before production edits, a local-only transform previews the existing shownToCustomers rule. Existing real pages cover populated/empty/refusal and return; no payment link is opened or external action performed. This minor existing-navigation change uses owner October21 explicit UI/UX discretion and autonomous safe release authority; no routine founder approval is requested. Record the winning interaction before production implementation and remove the transform for actual-source verification.

Original read state, menu grouping, customer identity/branding, optional funding entitlements, owner configuration and all EXP04 authority remain fixed. Functional/visual/experiential verification and final founder acceptance remain separate. Internal development increment, no named customer release or announcement. Migrations/Edge changes NOT_APPLICABLE. Recovery: compatible reviewed menu forward correction retaining original records and owner choices.

Pre-implementation prototype decision: retain the existing shownToCustomers rule, rather than a special menu or billing injector. The actual original AppNav/Payments pages with a synthetic server-owned catalogue lacking billing traverse desktop Paperwork -> Payments and mobile drawer/Enter -> Payments. The original empty invoice state is truthful, and a hidden billing overlay removes the entry; funding remains absent.390px has no horizontal overflow and the drawer closes to its original opener. No payment link, send or backend effect was used. Local prototype captures are in .cache/core-payments-prototype/evidence; source transform is throwaway and must be removed before actual implementation verification. This decision is within the owner's October21 explicit existing-Experience design/release discretion; no new product direction or founder evaluation is implied.
