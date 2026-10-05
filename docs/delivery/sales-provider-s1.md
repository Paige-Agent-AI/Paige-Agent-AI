# Sales S1 â€” merchant identity and payment contracts

Owner authorization: 2026-10-04 S0 accepted / S1 authorized. Grounded main 1db80559c9b4ce12ec72aeabdf4b21bad92b5f1d; production migration frontier 20270564000000; open research migration reserves 20270565000000. No S1 provider activation or customer money movement.

## Pre-edit capability routing
1. Outcome: bind a tenant merchant to a provider operation safely, with provider-neutral financial states and truthful readiness/readback.
2. Owner: Sales customer receivables. Settings/platform Billing and legacy storefront remain separate. Open #1729/#1615/#1608 own shared Chat seams; no S1 edits there. #1714 owns research grants/version 65; avoid it.
3. Harness/Gateway: reuse existing governed execution, durable-work lease/idempotency and canonical resource binding. S1 contracts do not introduce execution, authority, orchestration or a scheduler. Historical harness map is supplemented by current native-adapter code, not taken as runtime proof.
4. Spine: existing sales_invoice and sales_collections domains remain unchanged. Provider request/collect capability is UNAVAILABLE pending S2/S3; no proposed key is represented as callable.
5. Providers: existing Stripe integration registry entry PARTIAL; tenant_stripe_accounts remains Stripe merchant identity owner. PayPal entry missing: record grounded onboarding permissions and proof owed before merge. No return-query or tenant declaration counts as provider authority.
6. Trust: no S1 external mutation verb or new approval channel. Future money actions must use action-risk, resolve_tool_autonomy and the canonical pending approval claim; contract never grants authority.
7. Durable work: canonical paige_durable_work remains retry/lease owner. Provider operation stores business/provider identities, not a competing job.
8. Readback/Rail: authenticated provider account response must match stored tenant merchant identity/environment and binding version. Checkout completion cannot assert settlement. Existing record_capability_run / record_rail_event remain execution evidence owners.
9. Surface: sales.department remains PARTIAL / proof owed; no visible UI or binding promotion.
10. Proof: isolated caller-role SQL and scope/CAS/replay tests, real adapter input tests, independent nonwriter exact-head review. Live Stripe/PayPal merchant permissions, customer authority, hosted execution and settlement remain UNVERIFIED until later vertical acceptance.

## Flows / risk / boundaries
Deep / financial R3. Actor: tenant-admin connection management, followed by server provider readback. Wrong workspace, changed merchant, missing/revoked permissions, stale/invalid provider facts and environment mismatch refuse readiness. Provider operation retry uses fixed identity; ambiguous dispatch remains outcome_unknown until reconciled. Invoice remains canonical receivable; manual receipts remain manual. Transaction, settlement and allocation are distinct contracts; no allocation writer in S1.

Production confirms legacy tenant_stripe_accounts permits authenticated admin writes to account/readiness. S1 must prevent browser-authored merchant facts from becoming Sales readiness. Storefront read and its destination-charge endpoint stay intact. No account type/controller/fee-liability migration is implied by direct-charge selection.

PayPal before-payment onboarding requires approved partner access, seller PAYMENT permissions, confirmed email and payments_receivable provider readback; MERCHANT.PARTNER-CONSENT.REVOKED invalidates permissions. Approval/credentials are PROOF OWED, not assumed. Stripe operations/readback carry connected account and environment; no platform Product/Price reuse and no application fee.

## Sources
- https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted
- https://developer.paypal.com/platforms/seller-onboarding/before-payment
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Delivery
Development implementation: 49 merchant/payment contract tests PASS through normal CI test discovery. Explicit shared TypeScript, focused ESLint, actual Deno edge graph check, production frontend build, integration registry, migration-version, definer ACL and managed-schema lint PASS. Disposable local PostgreSQL migration replay and invoker role/scope/CAS/rebind proof PASS. Removing provider tenant provenance fails the named regression; restored code passes.
Early independent nonwriter review found legacy ownership provenance, observation tuple and tenant reassignment gaps. All addressed by provider metadata tenant binding, full observation identity and immutable merchant tenant. Exact-head final review/CI pending. No production persistence, release or live collection claim yet.
S1 request/operation/transaction/settlement/allocation definitions are contracts, not new persisted financial stores or an allocation writer. S2/S3/S4 must bind and persist them through canonical invoice/receivable state, real authority and atomic provider readback before execution claims.
SQL readback migration66 is additive above frontier64 and research reservation65. Refresh API response fields and storefront read grants retained; anonymous/authenticated merchant writes removed. Existing Stripe API/SDK pin retained for legacy compatibility; S1 does not migrate account controllers or fee/negative-balance responsibility.

## Owner addition â€” commercial operator acceptance
Owner 2026-10-04: INT-311 must support COMMERCIAL-ASSEMBLY-01. S2 must add canonical new invoice creation from conversational intent, deterministic integer-minor-unit schedules, truthful signed/draft/uploaded agreement handling, missing-fact ask/wait/resume and exact package review through existing Trust. Each constituent act retains capability, idempotency, provider operation, readback and Rail identity. Package approval is not a new approval mechanism and cannot widen existing authority. S1 references permit a later bounded work package; no Chat-owned draft/balance/schedule ledger. S3/S4 must still prove execution through verified settlement and allocation before broadening.
Acceptance: tenant/client/agreement match; total350000, deposit50000, remainder300000, ten monthly30000 installments; missing start date asks; canonical new draft/linked terms; honest document state; exact review before authority; published PDF and governed delivery; hosted/tokenized tenant-merchant request; readback and Rail; once-only verified allocation; same balance across UI/Chat/Voice; Collections pursues actual unpaid balance and stops on verified settlement. All runtime criteria remain PROOF OWED in S1.
