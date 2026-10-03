# Independent review — owner-authorized additional round

2026-10-02. Reviewer billing_draft_review did not write or edit implementation. PASS: bounded source review, no remaining material source defects. 16/16 API/hook tests independently rerun. Local SQL migration/proof inspected, not rerun by reviewer this round.

Reviewed SHA-256:

- migration B79018A6E6E596642F101D7F770AF29E0A0465D7CD9DA91B705579C3D03434EE
- SQL proof CE384F52C5FAE07472DB4D587CD4E4EBB23E837AAD53999E597AD838478B5C1E
- API CD6F2D962945BF5D966598614A9886B1CA9FE6A5434889F44268850851EE5B69
- API test 271398592779ACB77373F7172B753A2ABEF38A259D65BA8212BA511EE9D973E4
- hook 21AFBA8F602A9FB6C9CCF4B0DA800B59A43A2C8EFB4E7E1EC730864325C55B25
- hook test D4C1D004C091C99032905D4087638522EED0B0ED77CD9EA110790F007C553495

Catalog saved facts are separated from writable inputs; edit conversion drops derived fields and nulls catalog unit amount. Optional SQL null values decode. Hook discards observed workspace transitions, including A->B->A, and refuses mismatched opened-workspace saves. Final explicit discriminant narrowing inspected.

UNVERIFIED: hosted authentication/workspace, enabled UI, actual SQL races, pending-save switch/unmount, combined real SQL -> client -> catalog edit -> retry. Exact-head review remains needed before merge; this review identifies content by hashes.

## Current-main integration review — release HOLD

2026-10-03 UTC. Separate non-author reviewer sales_plan_review inspected head 9d80a0ef78ac7cf8b20b596ef8080a2e7822013b against main 17d67766e0ea2720a77bbc7b76cf5248bc1c4737. FAIL: managed drafts can reach legacy paige-mcp send_invoice, which sends email before the new database constraint rejects its update. A separate fail-closed sender prerequisite must be independently reviewed, merged and edge-deployed before this storage migration reaches production. This replaces any inference that prior bounded source acceptance clears all legacy consumers. No hosted production migration was performed.

Local real PostgreSQL proof independently passed and rolled back; 39 matching-source API/arithmetic tests passed. Local helpers are stubs, and hosted auth/provider proof remains UNVERIFIED. Updated content identities below correct the older review-hash set; the older entry remains historical.

- `supabase/migrations/20270535000000_sales_billing_drafts.sql` SHA-256 `17ba12ff212a2a27323cb5c6c15eae8fcf4d1b58ce1298072cdbeec4eb122bb9`
- `scripts/sql/sales-billing-drafts-proof.sql` SHA-256 `b9d487404db940b58aae7c87485369cc061a074dc1f3a5ded3751e91d0f4d13a`
- `src/solo/sales/billingDrafts.ts` SHA-256 `cd6f2d962945bf5d966598614a9886b1ca9fe6a5434889f44268850851ee5b69`
- `src/solo/sales/billingDrafts.test.ts` SHA-256 `271398592779acb77373f7172b753a2abef38a259d65ba8212ba511ee9d973e4`
- `src/solo/useSalesBillingDrafts.ts` SHA-256 `21afba8f602a9fb6c9ccf4b0da800b59a43a2c8efb4e7e1ec730864325c55b25`
- `src/solo/useSalesBillingDrafts.test.tsx` SHA-256 `b34f7ea5d727f1bf015f3f0c5136a6eb06b0a40f957f98fd77b28f933dec18d0`

The raw psql transcript retains trailing whitespace as captured; this causes diff-whitespace diagnostics for that evidence file only and is a recorded nonmaterial decline, not a claimed whole-diff PASS. No executable code whitespace failure was accepted.
