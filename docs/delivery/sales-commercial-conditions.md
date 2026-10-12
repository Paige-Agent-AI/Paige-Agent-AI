# INT-311 P1-B — commercial conditions (#1843)

## Pre-edit routing and owner intent

Grounded main: `360f50a71f4bdc3e5c1140029425ec3457ff553d`. Channel: development. No release claim.

1. Outcome: record explicit invoice tax/fee disposition and read exact agreement/version/economics conflicts before commercial execution. Preserve the 350000 principal, 50000 deposit and ten 30000 installments with explicit dates.
2. Owner: Sales domain; Clients owns identity, Catalog owns offer, Agreements owns signing and sealed history. No signing-engine writes in this slice.
3. Harness/Gateway: existing governed invoice draft create/revise dispatcher and canonical shared writer. Existing caller-JWT package read. INT-346 remains DRAINING; consequential conversational acceptance is prohibited until its owner's verified clearance.
4. Spine: `sales_invoice.draft_create`, `sales_invoice.draft_revise`, `sales_invoice.commercial_package_read`; existing collection-term capabilities remain unchanged. No parallel tool/router.
5. Provider: no provider dispatch. Existing Stripe/PayPal integration registry remains controlling; a TEST merchant is not yet established by this work. Secure setup preparation is separate from activation.
6. Authority: draft writes retain existing action-risk, Trust and canonical actor gates; package projection is read-only. No signature assertion, reusable package approval or autopay consent is introduced. INT-335 owns package authority.
7. Jobs/events: none added. No schedule executor, continuation table or scheduler. Recorded due dates remain obligations/preview, not charges.
8. Readback/Rail: existing invoice draft operation identity, immutable issued snapshot and package read receipt. The canonical balance owner is unchanged. An uncertain write retains existing replay rules.
9. Surface: existing Sales invoice draft and package read; binding `sales.department = PROOF_OWED` remains unchanged. No navigation, CSS or approved Performance redesign. Any later visible input work must follow the existing UI standard; backend contracts do not claim that UI delivered.
10. Proof: actual writer/RPC PostgreSQL tests, closed TS contract tests, foreign tenant/client/offer, stale version, unavailable document, recorded charges and replay controls; independent exact-head review and hosted CI. Authenticated manual package acceptance remains owed under #1832. No provider fixture becomes TEST acceptance.

## Canonical flow and boundaries

Owner/admin → exact current workspace → existing invoice draft writer → server-resolved client/catalog/agreement → invoice-owned versioned conditions → immutable issued facts → same package RPC → canonical terms/schedule/version checks → existing read receipt.

Tax/fee absence is unknown. Explicit not-applicable is recorded separately. Supported recorded tax/fee amounts identify included canonical invoice lines, currency and recorded source/policy; they do not add a second amount to the invoice, calculate jurisdictional tax, apply late fees or create debt. Unknown treatment does not default to zero.

Agreement identity, lifecycle, document availability and invoice-captured source version can be verified. Existing signing records do not freeze linked commercial economics. Therefore historical signed-economic compatibility must remain unknown when no immutable evidence exists; matching mutable totals or an owner checkbox cannot establish it. Any prospective signing-time commercial snapshot is an Agreements-owned dependency. No historical document is backfilled or modified.

## Current proof state

BOUNDED SERVER CONTRACT MERGED + DEPLOYED / PRODUCTION SOURCE READBACK PASS. Product PR #1846, reviewed head `bebbe18d8ed36464f13240365a1522724ae0b724`, merge `1da3839f5a2829d02b2d3749b7ff66cbc58db9ed`. Independent non-author review COMPLETE / SHIP; 120 focused tests and 55 real PostgreSQL checks PASS. All 11 hosted checks SUCCESS; verify job `113123756761` reports 10005 tests across 665 files PASS, build/typecheck/Deno ratchet PASS. The local Windows rerun's 33 failure names all reproduce on clean baseline; no hosted gate was waived.

Production migration `20270601000009` persisted. Migration workflow `37720517237` and Edge workflow `37720517228` SUCCESS. Stored helper/writer/package contract markers and private/authenticated ACLs independently read back; a synthetic read-only explicit not-applicable validation succeeded without a business mutation. Production `paige-ai-chat` ACTIVE v362, `sales-invoice-command` ACTIVE v47, and `sales-invoice-draft-command` ACTIVE v18; all changed modules present in their respective bundles exactly match merged source. Vercel production `dpl_DRjYBGQagaN9M5q2qrhenxuuTcJv` READY at the exact merge SHA.

Authenticated manual acceptance UNVERIFIED; condition-entry controls are not delivered by this contract slice. Historical signed-economic compatibility remains UNVERIFIED pending Agreements-owned frozen evidence. Stripe TEST merchant/provider acceptance UNVERIFIED: zero TEST bindings and zero provider operations observed. Consequential Chat rollout remains `active=false` / DRAINING. #1843 and Commercial Golden Path 1 remain open. No money moved.

## Implemented behavior

- Optional closed `commercial_conditions@1` lives in the existing versioned invoice draft. Both tax and fees independently distinguish unknown, explicitly not applicable, and recorded included line charges. Source/policy is mandatory for affirmative treatment; supported currency is the existing USD invoice contract. No jurisdictional tax calculator or automatic fee is added.
- Recorded charges bind to resolved line positions and cannot together exceed the included invoice line. A revision changing resolved lines cannot reuse unchanged recorded treatment; it must explicitly revise treatment. Existing draft version, actor and operation fingerprint controls remain authoritative. Issued records cannot be revised through this writer.
- Package read accepts both existing frozen Catalog fact shapes, checks current agreement against the invoice-captured agreement version, verifies tenant/client/offer identity, document/lifecycle state, active commercial terms, schedule/amount/currency compatibility, and preserves canonical balance ownership.
- Historical signed agreements do not contain frozen linked commercial economics. The read therefore retains `signed_terms_compatibility` and `unverified_no_frozen_commercial_snapshot`; matching mutable terms never clears it. Agreements owns any prospective sealed economic snapshot.
- The synthetic exact example records 350000 USD minor units, 50000 deposit, ten explicit 30000 installment dates, and explicit not-applicable tax/fee declarations. This proves the contract, not an authenticated accepted business transaction.

## Flow and adversarial proof

Actual pre-migration writer rejects the new treatment; the same canonical writer after migration accepts it. Exact replay returns the same invoice identity, changed treatment under the same operation refuses, issued revision refuses, and changed-line annotations require review. The new proof loads the real writer and package function into disposable PostgreSQL, applies the migration twice, and verifies Catalog-backed save/readback, agreement mismatch without commercial terms, foreign tenant/client, actor/role refusal, preserved balance and receipt rollback. The hosted Collections proof workflow runs this script against its existing disposable service.

Manual UI condition-entry controls are not implemented here. Snapshot normalization preserves recorded conditions, but this is not evidence that a human has completed all package inputs through the application. #1832 owns secure authenticated synthetic QA access. Consequential conversational execution remains blocked by INT-346 DRAINING; INT-335 owns package authority.

## Stripe TEST prerequisites — no provider action

Safe production aggregate grounding found no TEST merchant binding, no bound ready TEST merchant and no provider operations. An unresolved LIVE-mode setup reservation must not be adopted or relabeled as TEST. Current server key configuration selects provider environment globally; do not switch production's LIVE configuration to perform a test.

Required next action: provider/setup owner supplies an approved isolated TEST configuration, one authorized synthetic Solo owner/admin QA identity, one authorized TEST tenant connected merchant, and TEST webhook configuration through approved secret channels. Credentials must not be sent in Chat or GitHub. No onboarding/account creation/request/transaction was performed for this proof.

Existing individual `sales_invoice.payment_request` authority and `sales-invoice-command` execute the bounded request; `sales-payment-reconcile` and signed `stripe-webhook` perform merchant-scoped provider GET reconciliation. `allocate_verified_sales_invoice_payment` updates the existing invoice payment ledger exactly once. Final successful capture plus available provider balance evidence establishes settlement; redirect does not.

Acceptance will inspect one 50000 settlement/allocation, 300000 remaining, matching Sales/Collections reads and Rail, plus replay, foreign tenant, stale binding/version, environment, failed/expired and unknown-outcome negatives. Unknown dispatch uses the original operation and GET-only recovery. Post-settlement automated provider refund/reversal/dispute reconciliation remains a separate lifecycle gap; manual reversal proof is not provider reversal acceptance.
