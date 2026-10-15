# INT-311 S3/S4 — customer request through verified allocation

## Owner continuation — 2026-10-06

Release-order repair: production already persisted `20270596000000`; active PR #1770 claims `20270597000000`. Payment migrations are therefore renumbered to `20270597000001` and `20270597000002`, with SQL bytes unchanged (SHA-256 respectively `391409623540edd87f559c17099da0e35a5304c1eaf5d42de5db414a86569c79` and `e1d83b13653004fc479e63deba0d1441647f0e8e0ea99508c1b04356f683f6a7`). The proof script and receipt ledger reference the new filename. Older checkpoint version references below are historical evidence, not the deployment target. Production persistence remains UNVERIFIED until the canonical deployment ledger confirms these versions.

The owner authorizes completing the shared payment foundation and then recurring payments and conversational Collections. This is one canonical Solo-shell implementation for all current and future tenants. Each tenant supplies its own merchant binding; no owner account is a default, fallback, or global merchant. Generic tenant fixtures establish isolation without requiring the owner to open multiple live merchant accounts. The owner workspace may be an additional test target, never a code branch or the sole acceptance scope. A live merchant remains capable of real-money effects even when its workspace is used for testing; provider sandbox mode remains the financial test target.

Current checkpoint: PR #1769 head `51d58305d4beb641b6a6168bdf838506f45fc1f8` has eleven completed successful GitHub checks, including verify, collections-sql, database-contract, UI evidence, Supabase Preview and Vercel Preview Comments. This proves CI for that candidate only, not merge, deployment, authenticated payment acceptance or PayPal parity. Stripe execution is implemented in the shared adapter; PayPal currently refuses execution honestly and still requires the tenant merchant-permission/onboarding adapter. The owner will connect PayPal when the reusable in-product connection flow is ready. Do not request credentials in conversation.

Delivery sequence remains dependency-driven: complete provider request/readback/settlement/allocation parity, then exact authorized recurring mandates and lifecycle, then Collections driven by canonical unpaid balance. Agent-first commands and manual UI must call the same Spine/Trust/Rail capabilities. Recurring or Collections cannot declare successful collection from a checkout redirect, an unverified provider event, or a customer statement.

Grounding: current main `d90a6da261d84143d9076a4319daf7b0bc76f2f5`, 2026-10-05. Development only. Owner authorizes S3/S4; stop before S5. INT-327 is separate, with authenticated acceptance owed.

## Pre-edit capability routing
1. Outcome: a tenant requests a customer's full/partial invoice payment; hosted providers collect credentials; verified settlement changes the one canonical receivable exactly once; Collections reads that same balance.
2. Owner: Sales `paige_invoices` and append-only `paige_invoice_payments`. Clients owns customer identity; `tenant_client_agreements` owns commercial schedules; signing documents remain `paige_agreements`. No additional balance ledger.
3. Shared execution: canonical Capability Kit, governed decision, pending confirmations and durable work. Historical Harness completion map is not current runtime proof. Provider adapter is a domain implementation, not another Gateway or scheduler. C4 owns conversational waiting/resume; no Sales continuation.
4. Spine: existing `sales_invoice.read`, publish/manual receipt/delivery declarations are present. Hosted request/reconciliation capability is currently UNAVAILABLE; no name is claimed callable before registration and governed dispatch are implemented.
5. Providers: Stripe registry PARTIAL; existing `tenant_stripe_accounts` and server `record_sales_stripe_readback` own identity. Tenant-connected DIRECT CHARGES, zero application fee, inline amount/price data, no platform Product/Price reuse. PayPal registry exists but no executable adapter/partner proof established. Both must satisfy S4 before close.
6. Trust: new hosted request is consequential/high, exact tenant/customer/invoice/version/amount/currency/provider/merchant binding in the canonical stored proposal. No approval boolean/store. Reconciliation verifies existing authorized operation; cannot change its target or dispatch another payment.
7. Durable execution: existing durable work owns leases/recovery. Business operation identity is not a scheduler. External uncertain results preserve immutable identity; no blind fresh charge or unlimited re-dispatch after provider idempotency retention expires.
8. Evidence: provider account-scoped readback plus immutable operation/transaction/settlement references; allocation and `record_capability_run` persist transactionally with existing receipt ledger. Redirects and unauthenticated webhook bodies prove nothing.
9. Surface: `sales.department` remains PARTIAL; first slice has no UI edits. Existing invoice/workspace callers must later expose truthful request/processing/unknown/confirmed states; Impeccable finish review remains required. No customer release claim.
10. Proof: failing-first adapter cases, real PostgreSQL caller-role/lock/rollback/concurrency proofs, exact-head independent review and CI, then authenticated two-tenant provider-served acceptance. Local doubles are not provider or production proof.

## Grounded substrate and gaps
Production read-only schema confirms invoice operations, invoice payment receipts/reversals, invoice lifecycle versions and tenant Stripe binding/readback fields. `paige_invoice_operations` stores immutable command/result history, not in-flight dispatch state. `paige_invoice_payments` currently admits only human/import receipts and full receipt corrections; provenance readers label those human-recorded. Any extension must preserve their meaning and change all canonical readers together. No production settlement/allocation/provider-operation home was established. `paige_payment_authorizations` is legacy and must be inspected before selecting persistence. `paige_sales_collection_operations` is Collections command replay, not provider dispatch. Existing storefront destination charges remain isolated and untouched.

## Flow map and transition contract
Every step carries server tenant/client/invoice, fixed amount/currency and operation identity. Provider steps additionally carry provider/environment/merchant binding version and provider object IDs. Actors: authenticated owner/admin for request; provider-authenticated webhook/server reconciliation for readback; hosted customer for payment credentials.

| Transition | Canonical owner and evidence | Replay / failure / unknown |
|---|---|---|
| Resolve obligation/customer | invoice scoped read + Clients ID + lifecycle/snapshot version + current outstanding | foreign/stale/void/draft/overbalance refuses; no identity by name/email |
| Resolve merchant | tenant Stripe binding + fresh server provider observation; PayPal seller permission readback | foreign/revoked/stale/environment mismatch refuses |
| Review/authorize | shared risk/Trust + exact pending proposal inputs | changed tuple invalidates proposal; no model authority |
| Prepare/claim dispatch | immutable invoice-bound operation + one atomic dispatch claim | same request returns same identity; competing in-flight collection refuses |
| Dispatch hosted request | account-scoped adapter, fixed idempotency, safe metadata | definitive refusal fails; timeout becomes outcome_unknown |
| Customer action | provider-hosted URL; no card arguments/records | abandonment remains pending/expired; success redirect never allocates |
| Authenticate event | existing signature mechanism before route; account/environment/object validation | forged refuses; duplicates may trigger safe reconciliation |
| Read back/reconcile | exact provider account/object/metadata/amount/currency/status | no new payment on recovery; conflicting/multiple candidates remain unknown |
| Verify settlement | captured successful transaction with provider settlement identity and final evidence | accepted/processing/pending balance state cannot allocate |
| Allocate | existing invoice payment ledger + unique settlement/operation identity under invoice lock; Rail same transaction | duplicate/concurrent zero additional allocation; receipt failure rolls back |
| Read balance/Collections | canonical invoice readback, partial remains outstanding; zero stops pursuit | no surface/modality balance calculation; reload same state |
| Later reversal/dispute | append-only provider correction and canonical allocation reversal | never rewrite history; S5 execution not included now |

Regression scope: manual receipts/corrections, issuance and document immutability, ledger pagination/PDF, invoice delivery fences, Collections/import, client identity, shared authority, legacy storefront/Billing isolation. No provider activation, new migrations or financial writes have occurred during grounding.

Sources: Stripe direct charges https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=stripe-hosted ; Checkout API https://docs.stripe.com/api/checkout/sessions/create ; PayPal platform checkout https://developer.paypal.com/platforms/checkout/standard/integrate . Provider evidence and exact settlement decision must be grounded against these current primary contracts before activation.

## Visible-flow contract before UI integration

Owner job: request exact full/partial invoice payment through the same governed Sales capability as Chat, inspect provider confirmation and the shared remaining balance. Customer enters credentials only at the provider. Preserve incumbent invoice workspace/popout, manual receipts, PDF/email, Trust, tenant isolation, Billing separation and one canonical ledger. Never label request/redirect/provider acceptance paid, never show stale hosted links, never expose claims/authority/secrets, and never retry an uncertain dispatch as a new payment.

Internal Flow Prototype: `docs/prototypes/sales-payment-flow.html`, illustrative only. States: prepare, exact review, hosted customer action, confirming, unknown/same-operation recovery, partial confirmed, zero balance, refused, expired, merchant unavailable and neutral customer return. Owner 2026-10-05 S3/S4 standing authorization controls productive implementation; internal prototype is not an owner blocking gate.

Protected seams affected: canonical reads/writes, Trust/Spine, Rail, provider binding, idempotency/recovery, secrets, customer/public grant, accessibility, invoice-domain geometry. Billing/entitlement/provisioning, auth-account chooser, Chat transcript/scroll/popout, Voice runtime, Secure Browser/Vault UI, shell navigation/layout, Memory are not changed. Automated domain and PG proof exist; UI integration/rendered/browser/authenticated/provider/deployment proof remains UNVERIFIED.


## Recovery implementation checkpoint — 2026-10-05
Existing durable-work leases now own GET-only provider reconciliation. Dispatch cannot proceed without a persisted recovery-work identity. Recovery validates merchant/environment/binding, preserves outcome_unknown, and never creates another provider object. Signed balance-availability events read exact-account operations in bounded GET-only batches, including exhausted work. A completed readback stamp advances event retry batches; no work attempt/history is reset. Known open hosted requests are checked hourly; ambiguous outcomes are checked every five minutes. Exhaustion remains visible and does not invent payment failure/success. A late verified settlement closes the same exhausted work without resetting attempts.

Local evidence: 168 provider/domain tests across nine files pass, including recovery merchant mismatch, lost lease, failed evidence persistence, and terminal replay. PostgreSQL proofs include atomic ledger/Rail rollback, one dispatch/work claim, late settlement, and exactly-once allocation. These are local implementation checks, not authenticated provider/production acceptance. INT-327 merged at 51be9b75b8f3990f4748460bb5a536a89a7932d8; its separate authenticated acceptance remains UNVERIFIED. S3/S4 remains unmerged, undeployed, and provider acceptance UNVERIFIED. PayPal adapter/launch parity remains outstanding.


### Independent review repair checkpoint
Review of 6346e3bf returned HOLD: late balance-availability events did not read exhausted reconciliation work. Repaired with bounded exact-account event readback over the same provider operation and existing allocation/terminal-close functions. Real PostgreSQL regression proves exhausted operation selection, foreign account/environment refusal, late allocation, no replay allocation and unchanged attempt count. Provider suite now173PASS/10files. Fresh exact-head review is still required after repairs.

Impeccable internal integrated captures identified missing exact payment-review facts, invisible request-editor discard, blocked dismissal, missing rejected-read recovery, misleading request-vs-payment copy and stale hosted links. Repairs are in progress. Internal fixtures at laptop/mobile render actual components with synthetic responses; authenticated parent-drawer/customer/provider proof remains UNVERIFIED. The TypeScript ratchet passed at the preceding checkpoint (10 inherited errors, zero new); rerun required after repairs. Full Windows regression run exposed shell/platform-dependent and other failures; no baseline/diff ownership conclusion or green full-suite claim yet.


### Reviewed draft delivery checkpoint
PR #1769 is OPEN/DRAFT at f2a5891b75af60ed3355b15944508c1f48847d03, based on main51e1a629. Independent nonwriter COMPLETE/SHIP and scoped internal Impeccable SHIP cover that candidate. Migration renames to20270595000001/02 are100% unchanged semantics; real PostgreSQL proof passes after renumbering. TypeScript ratchet baseline10/current10 PASS. Payment Requests/LifecycleActions focused11 tests PASS. Seven selected local Windows failures reproduce on unchanged main from its own working directory; this does not attribute all full-suite failures or waive required CI. Required CI is pending. Provider-served, PayPal, authenticated two-tenant, production deployment/persistence and parent-drawer geometry remain UNVERIFIED. Production read-only inventory found zero tenant Stripe bindings and zero PayPal connections; owner sandbox configuration reference requested, no secrets read and no money dispatched.

## Current-main reconciliation — 2026-10-06

This checkpoint supersedes the preceding unmerged/draft status; earlier checkpoints remain historical evidence. Current-main base: `8b7f9757af53ca2966472992a70de43d2bf041cc` (INT-334 Turn Route #1787).

- #1753 commercial terms are canonical; they are not active provider mandates.
- #1769 merged at `d20b323e9c146f3c763376f90e5721d9f44124a7`; #1779 records delivery at `f640484f8cbf92a950a6ee046e55f37e905cd243`.
- Production migrations `20270597000001` and `20270597000002` persisted. Reconciliation, command and webhook substrate deployed; Vercel production READY for the delivery. Subsequent main integration check cleared the historical migration-failure residue.
- Read-only production inventory: zero tenant Stripe bindings, zero provider operations, two invoice payment rows, one invoice, zero commercial agreements. Deployed substrate is not merchant/payment acceptance.
- Stripe sandbox acceptance is PROOF OWED: controlled TEST merchant onboarding/binding, issued invoice and exact approval, hosted payment, signed event plus account-scoped GET, settlement/allocation, replay, negatives, and authenticated two-tenant UI/Chat/Collections parity.
- CUA initialization fails at the Windows helper ACL boundary. This is missing authenticated browser proof, not an excuse to stop domain work. No secret or card-data extraction is authorized.

### PayPal salvage disposition

`feat/sales-paypal-parity` at `141a3e1bbf5789d0eb7c033b708d6bc0b59ad8f7` is evidence only. Its PayPal-specific addition is two GET readback files (`paypal-readback.ts`, `paypal-readback.test.ts`) plus a five-line checkpoint. Port only independently validated readback concepts onto fresh main; discard inherited branch history. Never merge or bulk-rebase the stale branch. Current request adapter remains Stripe-only; PayPal seller onboarding/receivability, environment/version binding, hosted request dispatch, authenticated event routing and runtime acceptance remain owed. Platform partner credentials have not been established; absence of tenant rows does not establish absence of platform credentials.

### Remaining bounded sequence

1. Repair Collections' stale register decoder: deployed register basis is `canonical_receipt_allocations`, while the client accepts only `manual_recorded_only`. Reuse canonical allocated-balance validation, preserve manual/provider evidence, export both, and prevent manual corrections from masquerading as provider reversals. No new financial ledger or migration.
2. Finish commercial package composition over existing invoice/terms/signing records. Existing pure package preview is not a callable complete objective. Preserve shared C4 asks/resumes and constituent Trust decisions. COMMERCIAL-ASSEMBLY-01 authenticated acceptance remains UNVERIFIED; never infer dates, fees or approval.
3. Prove controlled Stripe TEST acceptance through deployed capabilities when secure merchant setup and authenticated access are available.
4. Port PayPal readback, then implement missing provider mechanics against the same operation/settlement/allocation contracts. Missing external partner actions are explicit proof debt; continue unblocked work.
5. Implement due-obligation/receivable lifecycle before provider mandates. Finite installments, open-ended recurring terms, deposit/balance and explicit dates stay distinct.
6. Operational Collections consumes canonical balances/schedules and canonical Communications. Shared C4d WAIT_WORK must be re-grounded before conversational durable resume; no Sales continuation or scheduler.
7. Provide bounded Sales snapshot provenance for Cognitive Fabric. UI/Chat/Live/Voice are callers of the same capability; no modality ledger or mutable financial Memory.

Owner action genuinely required later: securely connect a controlled TEST merchant and, if missing, obtain platform PayPal partner/sandbox permissions. No request for credentials in chat and no LIVE-money authorization.
