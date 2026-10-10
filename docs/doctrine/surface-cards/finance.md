# Solo Finance

- **Owner job and user flow:** inspect the company's financial condition, trace evidence, review exceptions and prepare a governed follow-up. Seven views: Overview, Banking & Cash, Receivables, Expenses & Payables, Profitability, Budgeting & Forecasting, Connections.
- **Tenant data / domain owner:** Finance owns presentation and future approved domain reads; Sales owns canonical invoices, receipts, allocations and metric producers. Integrations owns connection activation. No independent accounting/payment ledger.
- **Solo shell placement:** additive `/solo/:account/finance/*` destination in the existing shell and persistent PAIGE workspace. No agency, operator or account-specific shell fork.
- **States:** initial/refresh loading, unavailable source, empty/matching invoice records, partial/expired metric evidence, source error and retry, server refusal, workspace/authentication change, paginated reads and evidence drawer close. No live create/edit/save effect exists in this initial consumer.
- **What PAIGE can read:** existing authorized `analytics.metric_read` evidence and `sales_invoice.read` projections; Finance-specific snapshots are unavailable. Client-supplied references are not authority.
- **What PAIGE can propose or perform:** prepare a financial coverage review using the existing conversation and governed tools. A UI prompt does not establish that a task ran. The full target includes source-backed reconciliation, budgets, scenarios and verified internal follow-ups.
- **Required confirmation / approval:** current owner-authorized read-only UI delivery; existing Trust/Spine gate for subsequent actions. No provider activation, accounting writeback or real-money effect is authorized by this interface.
- **Rail outcome and follow-up:** no new Rail producer; existing canonical actions retain their receipt path. Finance retrieval-to-action-to-readback acceptance remains unverified.
- **Truth label:** `PARTIAL` implementation; binding `PROOF_OWED`; company banking/accounting/budget/forecast reads `UNAVAILABLE`; authenticated acceptance `UNVERIFIED`.
- **Dependencies, collisions, and required browser proof:** Sales, Integrations, Analytics and Fabric owners retained. Finance has shared-nav priority; Operations parks overlapping shell files. Required source-backed authenticated owner/admin, wrong-role, workspace switch, negative-scope, refresh and evidence-expiry proof remains owed; local synthetic rendering is separate evidence.

Current implementation and remaining target: [Finance brain record](../../brain/finance-department.md).
