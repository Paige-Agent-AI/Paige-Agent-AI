# ANT-49 — commercial and signing row contracts

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Canonical writer -> table-specific BEFORE INSERT/UPDATE validator -> existing snapshot/signing guards -> persisted record; PostgreSQL proof is supabase/tests/sales_agreement_trigger_contracts.sql.
PAIGE_UI_DESIGN: PASS: Applicability reviewed against the repository skill; this restores an existing persistence contract without changing interface, navigation, controls, copy, or intended interaction.
MATERIAL_FLOW_CHANGE: NO: Restore legitimate agreement inserts under existing authority; no new user action or product flow.
FLOW_PROTOTYPE: NOT_REQUIRED: Bounded schema repair preserves the approved flow and all existing interfaces.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Authorized Solo commercial writers can save valid terms; signing writers preserve their separate row contract.
VISUAL_DIRECTION: NOT_APPLICABLE: No visual files or design tokens changed.
AUTOMATED_EVIDENCE: PASS: 38 actual PostgreSQL assertions on a source-extracted local schema with required client creator and commercial service-DML revokes; required database-contract job runs the same rolled-back test against full migration replay and reproduced production grants.
STATIC_EVIDENCE: PASS: Definer function lint, signature ACL guard, and migration collision guard passed locally.
RENDERED_EVIDENCE: NOT_APPLICABLE: No interface implementation changed; no screenshot claimed.
BEHAVIORAL_EVIDENCE: PASS: Legitimate commercial/signing inserts and updates, 22 exact-SQLSTATE scope denials, and seven snapshot/signing immutability denials in the PostgreSQL fixture.
AUTHENTICATED_RUNTIME: UNVERIFIED: Synthetic database role proof does not establish an authenticated owner browser transaction.
KEYBOARD_FOCUS: NOT_APPLICABLE: No keyboard interaction changed.
ZOOM_REFLOW: NOT_APPLICABLE: No layout changed.
REDUCED_MOTION: NOT_APPLICABLE: No motion changed.
STATE_COVERAGE: PASS: Valid records persist; invalid tenant/client/offer/price/template/terms links refuse; frozen economics and signing evidence remain immutable.
TRUTHFUL_STATE_LABELS: PASS: Local database verification is separate from hosted CI, merge, deployment, production source verification, and authenticated acceptance.
SOLO_UI: NO: Canonical Solo persistence repair; no UI file or geometry changed.
UNVERIFIED: Hosted exact-head CI, production migration persistence/source readback, and authenticated customer-facing acceptance are separate release evidence; no provider or money action occurs.
INTERNAL_BUILD_IDENTITY: base=099a6b04e3bb3a9bb143798a7a1a69ab168b72e5; deployment=local-postgresql-proof; environment=local; migrations=PROOF_OWED(production persistence of 20271020000280_sales_agreement_trigger_contracts); edge=NOT_APPLICABLE; evidence=supabase/tests/sales_agreement_trigger_contracts.sql
RELEASE_CHANNEL: development: Candidate repair has local PostgreSQL proof; production state requires the normal migration deployment and independent catalog readback.
RELEASE_CLASSIFICATION: patch: Restore the existing commercial row contract and isolate the unchanged signing validator.
CUSTOMER_RELEASE_IDENTITY: none: Internal source correction recorded under ANT-49, without a customer release name.
RELEASE_NOTE_REQUIRED: NO: No new customer feature or interface; bounded defect correction.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Production persistence/readback and authenticated acceptance; local tests do not claim either.
RELEASE_RECOVERY: position=transactional forward repair with five-second lock timeout; reference=supabase/migrations/20271020000280_sales_agreement_trigger_contracts.sql

## Cause and preservation

The commercial migration created `enforce_agreement_tenant_links()` for
`tenant_client_agreements`. The later signing migration replaced its body with
the `paige_agreements` row shape. Both table triggers retained the same function
identity. A legitimate commercial insert therefore reached a nonexistent
`NEW.commercial_terms_id` field before it could persist.

The forward migration copies each canonical original validator into a named
table-specific trigger function and rebinds only the two tenant-link triggers.
It retains the historical helper unmodified. There is no row backfill, RLS
change, caller permission expansion, new writer, approval, ledger, or provider
operation. Snapshot, seal, status-forward, signer and signing-event guards remain
untouched. Direct execution of the new trigger helpers is revoked.

## Failing-first and green proof

Before the forward migration, the PostgreSQL fixture fails its legitimate
commercial insert with `record "new" has no field "commercial_terms_id"` in
`enforce_agreement_tenant_links()`. After the migration it produces 38 PASS
assertions and rolls every fixture row back. Applying the migration twice also
succeeds. The local schema extracts canonical table/guard definitions but uses
reduced upstream dependency shapes and production-equivalent commercial service-DML revokes;
the hosted database-contract job is the full-schema/grant proof.

Raw commercial INSERT/UPDATE refusals run as `service_role`. Row-contract proof
runs as the canonical definer-writer database owner, challenging link validation
even when RLS is bypassed. Both INSERT and UPDATE are covered. Same-tenant wrong-offer prices
and wrong-client terms refuse as well as foreign-tenant references. Optional
signing links and optional commercial price remain supported. Tests also check
enabled, distinct trigger bindings and denied public caller helper execution.

Initial hosted runs exposed two fixture assumptions: required `clients.created_by`
was omitted, and commercial service-role DML was assumed available. The fixture
now supplies a synthetic creator and proves the production raw-write refusal.
Neither correction changes the migration or grants additional production access.

## Ownership and release

Sales owns this correction. Operations PR #1992 consumes the commercial contract
and remains separate. No Operations product file is changed. The migration
identity must be rechecked against main, open PRs and production immediately
before merge. Independent non-author exact-head review and required CI precede
merge; normal deploy-migrations precedes production catalog verification.

Production readback checks both new enabled trigger bindings, helper body hashes,
the migration ledger, and unchanged snapshot/seal/status guard hashes. No
production commercial/customer row needs to be inserted for source verification.
