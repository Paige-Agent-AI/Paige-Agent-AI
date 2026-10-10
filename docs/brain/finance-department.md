# Finance department — current source and full operating target

Grounded on 2026-10-09 against main `794a38263e2d1d565ccab20253751593ed9c8f5b`.
Owner-approved design and subsequent “live merge on green” authorize normal delivery. They do not authorize a real provider connection or financial effects.

The department build is **not complete**. The current candidate introduces the canonical Solo Finance destination and source-backed Sales consumers. Deployment, authenticated acceptance and the complete Finance intelligence path remain separately verified evidence legs.

## Sources and boundaries

Finance reads existing `list_sales_invoices` through the Sales parser, and existing `issue_analytics_evidence_bundle` through the Sales metric consumer. Server contracts retain active-workspace owner/admin checks. Request identity, authentication changes, pagination cursors, evidence expiry and refresh remain fail closed. Invoice provider allocations may contain TEST records; eligible collection totals come from the canonical metric producer. Receipt evidence does not establish a bank deposit or recognized revenue.

Original account names and invoice-line wording belong to the source. `sourceLabels.ts` defines a proposed provider-label contract and explicit metadata mapping; it is **not yet connected to a QuickBooks adapter**. Unknown classifications remain unresolved. Currency totals remain separate.

Company banking, expenses, liabilities, accounting statements, supported profit, durable budgets and calculated forecasts are **UNAVAILABLE** in this candidate. Legacy QuickBooks numeric snapshots cannot safely provide these measures: missing rows can become zeros and company scope, reporting basis, currency and coverage are not established. Existing banking records are consumer/user scoped and cannot substitute for company accounts.

Sales retains invoice, allocation, payment and Collections ownership. Settings Billing remains PAIGE subscription billing; Settings Analytics owns its canonical general measurements. Finance creates no payment ledger, accounting engine, metric formula service or provider registry.

## One-PAIGE binding

The present callable seams are `analytics.metric_read` and `sales_invoice.read`. The UI hands a bounded metric/evidence reference to the existing `paige:open` bridge; PAIGE must re-resolve workspace authority and reference expiry. No raw invoice/client data, source tokens or financial prose is automatically copied into Chat context. A prepared prompt proves neither successful retrieval nor governed execution.

Dedicated Finance capability declarations and authorized domain snapshots remain **UNAVAILABLE**. Finance will contribute domain facts and quality to the existing Fabric composer; PR #1790 retains its separate owner. Harness, Trust, Orchestration, Rail, Model Fabric and Agent Intelligence remain canonical. Changing balances are operational facts, never automatically durable Memory.

Ship-time checklist: knowledge record present; existing callable seams reused; dedicated bounded Finance context absent; dedicated Finance tools absent; Solo route availability implemented but authenticated proof owed; unsupported answers withheld; Chat/Live financial retrieval, governed follow-up, readback and receipts remain **UNVERIFIED**.

## Provider audit and remaining delivery

### Backend resumption — 2026-10-10

Owner authorizes the complete backend mission through bounded reviewed releases. Approved seven-view UI remains intact; provider setup stays in Settings Integrations. Owner login, real provider activation, new consent, provider spending and customer financial effects remain restricted. No additional implementation agents are assigned.

Current source baseline: main `b0eface4ba461136d77edaf16c9de9e5dde86258`. Source classifications below are repository-grounded, not authenticated production acceptance:

| Capability | Status | Source / missing proof |
|---|---|---|
| Receivables / eligible receipts | PARTIAL | Canonical Sales RPCs and metric/evidence producer; bank settlement and recognized revenue are separate. |
| QuickBooks accounting reads | IMPLEMENTED BUT UNVERIFIED | Legacy OAuth/sync/report code exists; company authority, single-use state, pagination, nullable figures and revocation still require repair. Registry remains PROOF_OWED. |
| Company bank accounts / transactions | UNAVAILABLE | Legacy Plaid consumer rows are user-scoped. Item-wide transactions/balances are incorrectly assigned to a selected local account; products configured as auth/transactions do not prove liabilities coverage. |
| Company identity binding | UNAVAILABLE | CRM `businesses.owner_user_id` can equal the tenant owner for customer companies. That is not proof of the workspace's own legal entity. No legacy rows are automatically promoted to company Finance. |
| Debt / credit terms | UNAVAILABLE | Approved UI retains nullable fields and individual accounts. No verified lender/company adapter yet. Credit cards must not be classified as LOCs. |
| Accounting profit / expenses / payables | UNAVAILABLE | Legacy zero-default snapshots lack verified currency, basis and complete pages; they cannot establish Finance measures. |
| Budgets / reproducible forecasts | UNAVAILABLE | No canonical Finance assumptions/versioned scenario producer yet. |
| Finance Spine / Fabric | PROOF OWED | Existing Sales/analytics capabilities remain canonical. Finance contributes domain snapshots; Operating Fabric composition remains its standing owner's seam. |
| Chat / Live Finance acceptance | PROOF OWED | PR #1899's non-effectful conversation recovery withholds tools while interactive admission is unavailable. Finance must not change the competing executor/security path or claim prompt-launcher acceptance. |

First bounded repair #1905 merged as `efc5456ef4eccf0516ec2d377dbb17ac83558cdc` after exact-head independent review and all five workflows/two Vercel statuses passed. QuickBooks sync authenticates before privileged connection access; exact service bearer is required for bulk admission and personal identity is verified. Before this release production listed only the QuickBooks webhook. The deployed sync containment is now v1 ACTIVE with gateway JWT verification; its handler/helper source hashes match reviewed code and `edge-live` points to the merge. Authenticated sync returns `503 FINANCE_SOURCE_UNAVAILABLE` without privileged database/provider access until the company-bound adapter lands. This repairs containment, not OAuth/company ownership or financial reads. Controlled actual-handler tests make no provider calls; authenticated/provider acceptance remains held. Exact release identity and proof are recorded in Master §4.0.

QuickBooks remains under Integration Registry/Connections ownership, with readiness `PROOF_OWED`. Source audit found an unvalidated OAuth nonce, user-keyed company selection, accounting plus payments permission mismatch, bulk sync before caller validation, incomplete pagination, missing-data-to-zero projections, duplicate refresh paths and unchecked disconnect readback. #1905 contains the unsafe sync path; remaining source repairs are still owed. Production gateway metadata is verified, while authenticated request behavior is untested under the login hold. Finance exposes no activation or accounting writeback from these endpoints.

Complete the approved department through company-scoped, basis/currency/period/coverage-aware provider reads; canonical budget and forecast assumptions; reconciliation evidence and financial exceptions; bounded Finance Spine/Fabric contracts; governed recommendations and verified internal follow-ups; authenticated positive, role/refusal, switching and negative-scope proof. Accounting writebacks, bill payments, transfers and tax filings remain owner-reserved financial effects. A live UI alone does not close this target.

### F1b company/source foundation — implementation candidate

`finance_company_entities` owns the bounded Finance company identity, not a general corporate directory or accounting ledger. The workspace company must match the existing Setup business brief legal name; an additional managed entity requires an explicit owner/admin declaration. Existing CRM customer ownership cannot supply this identity. The authenticated read/save RPCs compose `current_user_tenant_id`, `is_tenant_admin_as` and `agency_can_manage_child`, enforce active actor/workspace authority at the server, and deny raw browser table access. Saves use optimistic versions, serialized identity, idempotent replay and one atomic canonical `record_capability_run` receipt. Receipt failure rolls back the write. This internal CRUD seam is not yet registered as a model-callable capability; the future Spine binding must reuse the canonical action classification and approval channel.

`finance_source_bindings` links that identity to existing QuickBooks connection or Plaid account anchors. It owns no credentials or provider activation. Native identity is immutable and revisioned; matching names, institutions or masks cannot rebind it. Legacy connections are not backfilled or verified. A future provider authorization adapter must establish the verification reference from valid one-use consent and the actual native company/account before any financial projection consumes a binding. The current source catalog exposes metadata only; a `verified` flag alone is not proof of a live provider.

`finance_source_observations` stores immutable evidence metadata: company/binding revision, domain, currency, accounting basis, period, observed/synchronized dates, coverage, complete pagination and digest. No amounts, tokens or raw provider payloads are stored by this slice. Unknown currency/basis remains unknown; incomplete pages cannot claim complete coverage. Appends lock the company, binding and existing connection so revocation cannot race a successful evidence commit. No bank cash, debt, P&L or forecast becomes available merely because these tables exist.

Revoked bindings stay historical and cannot be revived. A new pending binding may reuse the old connection/native namespace only after the previous binding is revoked; it cannot append financial observations before fresh verification. Financial identity/evidence records remain protected by restrictive references and immutable history. The existing Operator retirement catalog treats unsupported financial/legal disposition as blocked; this slice does not grant deletion authority or modify that owner's retirement machinery.

Independent review identified disconnect/history compatibility gaps in this candidate. Both provider anchors are opaque historical UUIDs, validated and locked against active existing connections/accounts at insertion. Connection deactivation or deletion atomically revokes/version-bumps Finance bindings; reactivation cannot restore verification. Binding deletion is refused even without observations. Existing Integration-owned QuickBooks deletion can still remove its credential-bearing connection and cascade synced financials/transactions. This candidate leaves the existing disconnect HTTP handler and customer confirmation unchanged; its unchecked persistence/provider response remains a subsequent Integration-owned repair. No retained Finance history is used to retain OAuth credentials. Disposable SQL proves compatible erasure, retained history and concurrent QuickBooks binding-insertion/revocation.

Plaid account deletion can cascade its secrets; retained Finance identity cannot reactivate the erased source. Controlled SQL proves credential erasure and history retention together. No privacy processor or credential manager is replaced.

Existing connection identity changes also invalidate Finance authorization: QuickBooks realm/environment, actor/business or consent scope changes and Plaid item/native-account or actor/business changes revoke/version-bump bindings. Token refresh alone does not change the native source identity. Actual SQL fixtures exercise company/environment and individual native-account replacement; later OAuth upserts cannot reuse previous company verification.

Company identity/version changes or deactivation invalidate its source bindings as well; a revised legal identity cannot inherit old provider verification. Observation appends acquire lifecycle locks in workspace → connection → company → binding order and re-read the verified revision after those locks, so an earlier metadata lookup is never an authority grant. Controlled SQL exercises company-revision invalidation and concurrent native-source revocation.

The canonical agency switch leaves unmarked child `admin` memberships behind, so a parented admin seat alone is insufficient Finance authority. Finance requires current canonical agency standing for these ambiguous seats; direct child owners remain independently authorized. Suspended/deleted agency membership and archived parents fail closed even when the child admin seat remains active. Independently granted child admins cannot yet be distinguished from temporary seats: their Finance acceptance is PROOF OWED pending canonical Identity grant provenance. Standalone owner/admin access is preserved. This safety isolation does not repair or alter the shared switch machinery.

Foreign intake: existing Identity/Agency [#806](https://github.com/Paige-Agent-AI/Paige-Agent-AI/issues/806) now carries the exact Finance revocation consequence and grant-provenance dependency. Privacy/security [#1919](https://github.com/Paige-Agent-AI/Paige-Agent-AI/issues/1919) records the shared deletion processor's unconditional completion despite step errors and its source-level missing explicit caller gate; deployed exposure is UNVERIFIED. Finance removes its own credential-erasure obstacle, preserves the safety boundary and continues. Neither foreign handler is taken over; no INT identifier was invented.

Controlled proof: `scripts/proof/finance-source-authority.mjs` runs the actual migration against disposable loopback PostgreSQL, confirms the missing RPC before migration, repeats fresh replay, and exercises role/tenant/company/refusal, banned actor, membership revocation, workspace switching, stale versions, concurrent edits, retry receipt uniqueness, incomplete pages, immutable identity/evidence, revoked connections and concurrent revocation. Canonical authority/receipt dependencies are explicit fixtures; these tests do not establish deployed auth, actual Rail persistence, provider ownership or live company data. The dedicated CI workflow runs the same database proof. Migration/deployment, independent review, canonical production metadata and authenticated/provider acceptance remain separate proof legs.

Catalog reads are bounded to 200 company entities and 1,000 source bindings per workspace. An oversized scope fails explicitly (`54000`); it never silently truncates accounts or declares complete coverage. Controlled SQL proof exercises both limits. Scoped agency delegation also freezes the canonical agency-membership and parent-workspace rows; archived parents cannot grant delegated Finance access. Disposable proof observes actual PostgreSQL lock waiting for concurrent company edits/creation, connection revocation and agency permission revocation. The role resolvers remain explicitly simulated canonical dependencies, not authenticated agency acceptance.

## Owner efficiency ruling — 2026-10-10

Finance has six work tabs. Remove introductory banners throughout; connection setup belongs to canonical Settings Integrations. Existing `/solo/{account}/finance/connections` bookmarks redirect there. Finance remains directly below Sales for every eligible standalone tenant. Provider direction is Plaid and QuickBooks: bank accounts, credit cards and lines of credit where explicit provider contracts and approved scopes support them. This direction does not establish provider readiness or authorize real company activation, new permissions or financial effects.

Brokerage/investment accounts are future scope only (owner, 2026-10-10); no investment capability is added or claimed. Verify Plaid product availability, account coverage and separately approved permissions before implementation.

## Debt & Credit approval — 2026-10-10

Owner approved the separately reviewed Debt & Credit prototype and main deployment on green. Finance now has seven work views including Debt & Credit; Connections remains exclusively Settings Integrations. The approved view groups institution → product → individual account, retaining multiple same-product accounts, original labels, entities/currencies, source freshness and explicit match coverage. It distinguishes balance/principal, interest, capacity/cash and ordinary payables. The production source binding remains UNAVAILABLE until verified company/source identity, classification, currency and per-account synchronization are repaired; no legacy user/client rows or prototype values are shown as company debt. Debt-specific Spine/context/Chat/Live read and governed outcome remain UNAVAILABLE/PROOF OWED. No financial effect or provider activation is authorized by the design approval.
