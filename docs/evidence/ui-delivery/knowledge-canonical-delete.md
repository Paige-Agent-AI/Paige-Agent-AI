# Canonical Knowledge deletion (staged service)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: active workspace -> selected document/revision -> transactional deletion -> doc/chunk absence readback -> existing Rail receipt.
PAIGE_UI_DESIGN: PASS: applicability reviewed against the repository paige-ui-design skill; this slice changes no visible interface (canonical deletion service behind the existing governed seams only).
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam; current consumers and Chat unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface implementation in this slice.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: active members delete the exact reviewed canonical revision without deleting a later edit or another workspace's content.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: local run 2026-10-01 UTC, 21 Vitest tests (14 deletion + 7 existing adapter), 26 SQL role/behavior assertions, four database-observed concurrent races, migration replay twice.
STATIC_EVIDENCE: PASS: focused ESLint and strict standalone TypeScript compile of src/lib/knowledge-service.ts; no full application compile/build claimed.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption here.
BEHAVIORAL_EVIDENCE: PASS: executable PostgreSQL16 fixture with actual roles, cascade foreign key, row locks, rollback and two connections. Identity/authority/receipt dependencies are explicit models.
AUTHENTICATED_RUNTIME: UNVERIFIED: real Supabase identity, full migration chain and API serialization not exercised.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls.
ZOOM_REFLOW: NOT_APPLICABLE: no layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: scope change, wrong document tenant, inactive member, missing actor, anonymous/service-role access, stale/null revision, child tenant mismatch, zero-row delete, parent reinsertion, suppressed chunk cascade, duplicate call, concurrent update/delete, workspace switch and chunk insertion, receipt failure.
TRUTHFUL_STATE_LABELS: PASS: database absence is separate from source cleanup and receipt persistence. No idempotent success or automatic retry.
SOLO_UI: NO: staged service only.
UNVERIFIED: deployed schema/RLS/receipts, real operator auth, full migration replay, UI adoption, source-object cleanup and final Chat binding.
RELEASE_CHANNEL: development: local fixture only.
RELEASE_CLASSIFICATION: internal-only: no customer release.
CUSTOMER_RELEASE_IDENTITY: none: no deployed human flow.
RELEASE_NOTE_REQUIRED: NO: staged capability.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated deployment and consumer adoption; knowledge.delete remains UNAVAILABLE in Spine.
RELEASE_RECOVERY: position=revoke the new RPC execute grant to contain activation (deletion has no undo, so recovery is a separately authorized verified backup restore); reference=0149180e9d752d9077b7c8991a3c614d329c25ed
INTERNAL_BUILD_IDENTITY: 0149180e9d752d9077b7c8991a3c614d329c25ed; deployment=none; environment=development; migrations=PROOF_OWED(20270531200000_knowledge_canonical_delete, isolated fixture only); edge=NOT_APPLICABLE; evidence=scripts/knowledge-service/delete-check.py and src/__tests__/knowledge-delete.test.ts

## Ten routing answers (recorded before implementation)

1. Outcome: delete the selected canonical document/revision and chunks; truthfully distinguish retained/unknown source cleanup.
2. Domain: Knowledge under the existing Chat/Command Center and Settings portfolio. UI adoption is separately owned.
3. Harness: existing identity/authority and receipt seams (A/B/F); no Harness status upgrade or bypass.
4. Spine: proposed knowledge.delete remains UNAVAILABLE; no registration or validator edit.
5. Provider: native PostgreSQL; Supabase remains excluded_delivery_infrastructure in the existing Integration Registry. No new provider.
6. Lane: future knowledge_delete is high risk / delete verb through canonical Chat approval; this staged human RPC preserves existing member/platform-owner/company-operator authority. No approval flags accepted.
7. Job/event: none for this bounded transaction; no scheduler or parallel store.
8. Readback/Rail: locked CAS delete, verified doc/chunk absence, existing ten-argument recorder. Receipt failure alone returns capability_completed_unrecorded.
9. Visible surface: none changed; existing ledger labels remain unchanged.
10. Proof: local SQL and adapter execution here; real Supabase caller and UI evidence remains UNVERIFIED. No merge or release authority inferred.

## Contract and source limitations

The existing document revision trigger covers legacy updates. Deletion locks the selected profile then tenant/document row and matching child rows. Because the canonical chunk FK only references doc_id, any mismatched child tenant refuses the operation. The parent lock prevents new FK references during deletion. Zero affected rows or remaining document/chunk rows abort and roll back. Existing member, platform-owner and company-operator predicates are preserved.

Returned deleted_revision names the last existing revision. A subsequent call returns KNOWLEDGE_NOT_FOUND, not claimed idempotent success. After lost acknowledgement, canonical scoped readback can establish absence but cannot attribute who deleted it or prove the receipt exists. The client never retries automatically.

Only the receipt call is inside the recoverable exception block. Its payload contains safe document UUID, revision and fixed operation/cleanup labels; no content, title or source URL. Its literal membership check may reject an authorized company operator: deletion still commits with capability_completed_unrecorded. No receipt-authority expansion here.

source_cleanup is always {status: not_attempted, reason: canonical_source_binding_unavailable}. kb-ingest-file receives/downloads an object path but does not pass it to canonical ingestion; docs store source/source_url without an object binding. This service makes no Storage calls and never guesses a path. Automatic cleanup requires a separate server-validated persisted source binding, shared-reference coordination and existing durable reconciliation machinery. Promoted canon, Setup references and Marketplace bookkeeping are unchanged.

## Executed local commands

- Failing first: 14 deletion Vitest cases failed with deleteKnowledge missing; SQL failed with delete_tenant_knowledge missing before implementation.
- `npx --no-install vitest run src/__tests__/knowledge-service.test.ts src/__tests__/knowledge-delete.test.ts --maxWorkers=1 --reporter=dot`: 21 passed.
- `npx --no-install eslint src/lib/knowledge-service.ts src/__tests__/knowledge-delete.test.ts`: exit 0.
- `npx --no-install tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler src/lib/knowledge-service.ts`: exit 0.
- `python scripts/knowledge-service/delete-check.py --psql <PostgreSQL16 psql path>`: 26 SQL assertions + four two-connection races, exit 0. Creates/drops only a unique disposable DB on localhost:55439; does not reset the cluster. Migration applied twice. pg_stat_activity confirms the first transaction reached its locked wait before the competing operation starts.
- `python scripts/knowledge-service/check.py --psql <PostgreSQL16 psql path>`: existing read/metadata SQL suite and concurrent CAS passed.
- Migration generated with Supabase CLI then moved forward to 20270531200000, after the existing 20270531100000 service migration.
- Shipped Delivery Log: N/A, no main merge. Independent review is parent-owned and pending; this implementation is not independently approved.

Supabase functions guidance checked: https://supabase.com/docs/guides/database/functions (empty definer search_path and explicit grants). Changelog checked 2026-10-01; no new extension or client version is introduced.
