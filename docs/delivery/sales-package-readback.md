# Sales commercial package — canonical readback slice

Grounded at `53dbf7eb52119a5b720f298ab024f27c69ac46fc`, composed with current main `eefbc90ba53a52e241594c97892fe024e1fe27cd` after Collections #1792. This is a bounded step toward COMMERCIAL-ASSEMBLY-01, not S2 completion.

## Pre-edit routing

1. Owner outcome: inspect the exact canonical invoice/client/selected offer/signing document/recorded commercial schedule together, and see missing dependencies before proposing any execution.
2. Domain owner: Sales; signing state remains Agreement-owned, client identity Clients-owned. INT-334, C4, Memory S5 and Operating Fabric are active; their hot seams are excluded.
3. Harness/Gateway: read-only projection uses the existing authenticated database/actor gate. No work package executor or Harness runtime is added.
4. Spine: planned additive `sales_invoice.commercial_package_read` over `public.read_sales_commercial_package`. Not present at this checkpoint. Chat binding remains UNAVAILABLE until shared runtime integration is proven; no hotfile or hand-wired Chat tool.
5. Provider: no provider call. Registry Stripe/PayPal acceptance debt remains unchanged; projection cannot establish merchant readiness.
6. Authority: read-only/no mutation verb/no approval. Existing constituent draft, terms, signing, issuance, delivery and payment gates are unchanged. Readiness is never package approval.
7. Jobs/events: no job, scheduler, continuation or package store. C4 ASK_USER/WAIT_APPROVAL remain shared; C4d durable conversational resume remains a separate dependency.
8. Readback/Rail: read canonical IDs and source versions through same-tenant relations; record only the existing safe capability receipt. Receipt failure refuses the whole read. No new evidence ledger.
9. Surface: `sales.department` keeps its current proof boundary. No new visual UI or customer action is implemented in this slice; approved package design is not claimed integrated.
10. Proof: real PostgreSQL owner/member/foreign-tenant/missing-reference/source-version/redaction/Rail tests and deterministic adapter checks. Authenticated two-tenant Chat/UI and complete assembly remain UNVERIFIED.

## Canonical flow

Authenticated owner/admin → expected current tenant → canonical invoice/client → invoice draft `agreement_id` → same-client `paige_agreements` → `commercial_terms_id` → same-client `tenant_client_agreements` → recorded schedule and source versions → bounded missing/conflict projection → existing Rail receipt.

The bridge already exists. No new financial table or ID substitution is needed. A completed signing record means an existing sealed document; an unsigned canonical record remains unsigned; upload provenance does not become executed terms.

Recorded mutable collection terms do not prove agreement with sealed signed bytes. Dedicated tax/fee treatment and signature-before-collection policy are not grounded canonical fields today. The read must name these unknowns; it must not invent zero taxes/fees, dates or executable approval.

No principal is recalculated from provider events here; invoice balances stay in the canonical invoice reader. No collection terms are silently changed to match an invoice. Subsequent assembly must use deterministic integer-minor-unit schedule code and existing constituent Trust gates.

Migration candidate: `20270598000001` (main latest `20270597000002`; open Memory S5 PR #1788 claims `20270598000000`). Recheck before push. Read-only additive function; no backfill or table change.

## Executed local proof

- `sales-package-read-proof.mjs`: 45 PASS against disposable PostgreSQL 16 on loopback port56366. Executes actual canonical actor/balance/terms/Rail bodies and the new function twice. Positive second-tenant read, foreign/missing/workspace-switch refusals, exact350000/50000/300000/ten30000 recorded schedule, manual/provider split, source versions, signed-document treatment, unknown tax/fees, conflict detection, reload and receipt rollback exercised. This is database-role evidence, not authenticated application/browser acceptance.
- Package reader, assembly and deterministic schedule:52testsPASS across3files. Capability Kit/declaration guards pass; no new bypass or model tool registration.
- Existing Sales Collections SQL workflow now executes the new PostgreSQL proof. CI execution is pending until pushed; proof existence is not a green CI claim.

Channel development; exact candidate/independent review recorded in the PR before merge. No customer release identity. Migration/deployment NOT_YET_OBSERVED. Impeccable visible-flow review NOT_APPLICABLE to this unbound read slice; required integrated package design/interaction acceptance remains owed. S2 and COMMERCIAL-ASSEMBLY-01 remain UNVERIFIED, including shared ask/resume, constituent act execution and authenticated two-tenant parity.
