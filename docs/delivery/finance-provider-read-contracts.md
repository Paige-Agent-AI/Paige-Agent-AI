# Finance provider read contracts — controlled source slice

## Owner outcome and routing

Owners need original account labels and individually scoped financial facts, with incomplete provider responses refused instead of converted to zero. Finance owns normalization; Settings → Integrations owns company consent, activation, credentials and synchronization. Sales retains receivables and payment records. Protected Chat/Live execution files are outside this slice.

The existing Harness gateway and company-source authority must resolve actor, tenant, entity/version, connection and native account selection before ingestion. These pure functions grant no authority. Finance Spine registration is **UNAVAILABLE** in this slice; no new capability key, tool registry or execution engine is introduced. Integration Registry entries `quickbooks` and `plaid` remain at their existing readiness levels; this candidate establishes no native provider readiness.

There is no mutation verb, financial effect, approval channel, durable job, scheduler or provider request here. A future governed ingestion must atomically persist complete batches/cursors, recheck membership and consent, issue canonical receipts, and read back its outcome. The `finance.department` Binding Ledger row stays **PROOF_OWED**; the approved interface is unchanged.

Authenticated company/connection isolation and controlled transport/persistence integration are owed before exposing the adapters. Real provider activation, customer ingestion and provider spending remain separately gated. Unit fixtures are development evidence only.

## Source contract

- QuickBooks queries accept only Account, Bill, Purchase, BillPayment and Deposit, with bounded pagination, native-ID uniqueness and advertised-count consistency. `pagesComplete=false` forbids publishing staged rows as a complete batch. Accounting balances do not become available bank cash or credit capacity.
- QuickBooks reports preserve native rows, titles and paths. Currency, accounting basis, reporting period, generation date and aligned semantic total columns must be supplied before supported financial interpretation. Localized account names never determine financial classifications.
- Plaid account products use explicit type/subtype metadata. Credit cards, deposit cash and loan obligations remain distinct. Unsupported loan capacity, interest rates and maturity remain unknown.
- Plaid transaction cursors remain item-wide. Every added, modified and removed record retains its actual native account. Output is filtered against an immutable snapshot of the initially authorized selection. Caller mutation during an awaited page cannot expand that selection. This snapshot does not replace the ingestion envelope's revocation fence.
- Failed or capped Plaid traversal discards every staged mutation and retains the original cursor. Pagination mutations restart from the original cursor. Initial and historical update completion remain distinct.

Primary references checked: [Plaid Transactions API](https://plaid.com/docs/api/products/transactions/), [Plaid sync migration](https://plaid.com/docs/transactions/sync-migration/), [Intuit query response properties](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/a77ed435-080a-c935-aad5-d09b2088d222.htm) and [Intuit query limits](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html).

## Evidence and release boundary

Current-main controlled suite: **65 tests PASS**. The mutable-selection regression failed before the scope snapshot and passes afterward. Focused static checks are recorded separately. Independent exact-head review, hosted CI, merge, deployment, source persistence, authenticated acceptance and native-provider behavior remain **NOT_DONE / UNVERIFIED** for this candidate.

Internal development source only; no customer release name or announcement. No schemas, customer financial records, provider connections, shell branches or UI behavior are changed.

## Current-main continuation

Reconciled with released cash-scenario main `ad092c3146eccc9df2e82cad6ca9cb9579405da1`, preserving all upstream Finance and peer source. The QuickBooks/Plaid Integration Registry entries and companion rows now record the pure controlled readers and retain their existing readiness states. This slice also records the actual #2004 production closeout in the existing Master/Brain/delivery records; it adds no migration or provider handler. Current exact-head independent review and hosted release evidence remain owed.
