# S2 canonical collection context — pre-edit routing

Base: current merged main b6178b285ae6d99052c73797f617fade8ecbc48c. This is a bounded read refinement in the approved INT-311 ladder, not full commercial assembly or provider acceptance.

1. Outcome: PAIGE can identify canonical commercial terms by their recorded client/offer/title and compare the exact recorded schedule. Existing read_sales_collections reaches these rows but drops those facts in its Chat projection.
2. Owner: tenant_client_agreements owns commercial collection terms; paige_agreements remains the separate signing/document owner. No new commercial table, owner or invoice store. Inspected open #1744, #1615 and #1745 changed-file lists do not own this adapter, Collections SQL reader or proof runner. Shared Chat handler and C3/C4 are untouched.
3. Harness/Gateway: existing declared sales_collections.read and caller-JWT dispatcher. No package runner or provider layer. Full package dependencies and C4 objective resume remain subsequent shared work.
4. Spine: extend the existing read capability, not a new resolver registry or monolithic commercial action. Preserve invoice/receipt projection and all existing write doors.
5. Provider: none for canonical recorded terms. Stripe direct charges and PayPal remain equal S3/S4 targets; recorded terms do not establish a mandate or settlement.
6. Authority: existing authenticated current-workspace owner/admin SQL gates; read_only/none. No new approval semantics. Terms cannot authorize altering a signed agreement or collecting money.
7. Durable work: no jobs for a read. No Sales-specific ask/resume, scheduler, orchestration or approval store.
8. Evidence: add an atomic canonical record_capability_run receipt to the existing read wrapper, with safe identity only; fail closed if receipt fails. Validate returned tenant/client/offer, versions, exact terms and consistency before exposing a bounded allowlisted projection. Omit notes, document/storage/provider identifiers and free-text fee doctrine; distinguish absent/stale terms and recorded instructions from executable authority.
9. Surface: existing PAIGE tool result and Solo Collections records. No new layout/modal; Impeccable applies truth, provenance and exact financial context to the existing flow. Binding remains PARTIAL until authenticated acceptance. Every current/future Solo shell uses the same code.
10. Proof: projection scope/shape/bounds/stale terms/truncation/no-secret negative tests; actual SQL role/workspace/receipt rollback and canonical reader delegation; regress existing reads/writes/import/receipt races. Exact-head non-writer review and CI required. Authenticated two-tenant Chat terms resolution, COMMERCIAL-ASSEMBLY-01, C4/package authority and provider settlement remain UNVERIFIED.

Release: development, internal-only; migration/edge production identities PROOF OWED until observed. No customer version or announcement. Recovery: forward-fix the allowlisted read/receipt; no financial records or provider state are changed by this unit. Post-merge identity belongs in Master Section 4.0, not a parallel delivery log.
