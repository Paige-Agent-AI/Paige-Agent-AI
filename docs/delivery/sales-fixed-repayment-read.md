# INT-311 — canonical fixed repayment preview

## Pre-edit Flow-by-Flow routing

1. Owner outcome: PAIGE calculates the exact principal deposit/installment proposal from one already-resolved canonical commercial record; missing dates remain questions.
2. Sales owns the existing Collections read adapter and its domain declaration. Clients/Catalog/Agreements retain identity, offer and signing truth. C4 owns ask/wait/resume.
3. Existing caller-JWT read and Sales domain dispatcher are reused; no Harness, gateway or executor is introduced.
4. Existing Spine `sales_collections.read` and model tool `read_sales_collections`; an optional principal-preview input extends that read, not a new Chat calculator/tool registry.
5. No provider connection is required for a read. Stripe TEST and PayPal execution remain separate, unproven gates.
6. Read-only: no approval, financial write, saved schedule, mandate or execution. Saving terms still uses existing `sales_save_collection_terms` with exact authority and version.
7. No durable job/event: shared C4/Orchestration owns later continuation.
8. Canonical source projection and existing RPC receipt precede preview. Server supplies total/currency, existing deterministic Collections code supplies dates/amounts. No balance calculation.
9. Incumbent PAIGE read response only; no UI component/layout/navigation change. Binding-ledger proof state unchanged.
10. Required proof: failing-first adapter tests, canonical amount/currency and exact-reference negatives, missing inputs, stale/inactive source, no side effects, independent review and exact CI. Authenticated commercial assembly, deployed source and INT-346 clearance remain owed.

## Scope and exclusions

Base main: `5aeb39cc6dbcaa1e597d2e09632ee0fcabcfae77`. Current canonical read is bounded/paginated; an exact commercial reference absent from the returned page must be resolved through existing pagination, never guessed or replaced by a name match. A preview cannot rewrite an already-recorded conflicting plan.

The example is 350000 total, 50000 deposit and ten 30000 installments with explicitly supplied deposit/start dates. The model cannot provide a competing total or currency. Taxes, fees, signing compatibility, delivery and each constituent approval remain unresolved unless their canonical owners prove them. Preview output is principal-only and cannot be passed off as an approved agreement or active autopay.

Shared impact: Sales records/Spine/Trust/Rail CONSUMER; C4 FOLLOW-UP OWNER; no shared registry/Chat handler/metric issuer/provider/Memory/Knowledge/scheduler changes. INT-346 holds consequential conversation. No merchant action or money moved.

Impeccable clarification: exact source identity, visible preview-only meaning, missing-fact and conflict distinctions, no fabricated payment/authority wording. Existing response geometry unchanged. Canonical reference: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md

Release channel: development. Implementation/test/review/CI/merge/deployment/authenticated proof are not inferred.
