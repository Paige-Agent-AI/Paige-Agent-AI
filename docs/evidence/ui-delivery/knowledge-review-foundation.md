# Knowledge source and review foundation (frozen lifecycle)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: selected workspace -> canonical read or explicit review read -> tenant predicate -> bounded projection; lifecycle writes remain unavailable.
PAIGE_UI_DESIGN: PASS: AGENTS routing assessment finds no visible interface change; UI design work and its checks are outside this backend slice.
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam; current consumers and Chat unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface implementation in this slice.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: prepare canonical source/review storage without exposing draft content to ordinary readers or enabling an incomplete workflow.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: local run 2026-10-01 UTC, 48 PostgreSQL role/behavior assertions; existing metadata and deletion SQL suites rerun against this migration; replay twice in every suite.
STATIC_EVIDENCE: PASS: repository consumer and schema/grant scan, explicit projection review, git diff check. No TypeScript edits or full compile/build.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption here.
BEHAVIORAL_EVIDENCE: PASS: PostgreSQL16 executes actual migration, grants, restrictive policies, security-definer functions, constraints, trigger and delete cascades. Auth predicates and vector distance are explicit test models.
AUTHENTICATED_RUNTIME: UNVERIFIED: real Supabase identity, full migration chain and API serialization not exercised.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls.
ZOOM_REFLOW: NOT_APPLICABLE: no layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: legacy defaults, canonical detail and metadata projections, pending secrecy, draft exclusion, direct column denial, search draft/tenant filters, missing scope/actor, operator/owner/member authority, frozen lifecycle insert/update, bounds, pending deletion and legacy SQL regressions.
TRUTHFUL_STATE_LABELS: PASS: coverage defaults unknown; source binding defaults null; no reviewed truth is inferred. Frozen foundation does not claim review/extraction/replacement delivered.
SOLO_UI: NO: staged service only.
UNVERIFIED: deployed schema, real Supabase auth/PostgREST/Realtime, full migration chain, pgvector ranking, source existence/immutability, extraction/review submission, workers and UI adoption.
RELEASE_CHANNEL: development: local fixture only.
RELEASE_CLASSIFICATION: internal-only: no customer release.
CUSTOMER_RELEASE_IDENTITY: none: no deployed human flow.
RELEASE_NOTE_REQUIRED: NO: staged capability.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated deployment and all privileged consumer adoption; lifecycle Spine capabilities remain UNAVAILABLE.
RELEASE_RECOVERY: position=retain lifecycle freeze and revoke review RPC execute if containment is required without restoring wildcard projections over internal columns; reference=0149180e9d752d9077b7c8991a3c614d329c25ed
INTERNAL_BUILD_IDENTITY: base=0149180e9d752d9077b7c8991a3c614d329c25ed; branch=codex/knowledge-review-foundation; exact change identity=Git commit containing this evidence; deployment=NOT_APPLICABLE; environment=local; migrations=PROOF_OWED(real Supabase application of 20270531400000_knowledge_review_foundation); edge=NOT_APPLICABLE; evidence=scripts/knowledge-service/review-check.py

## Ten routing answers (recorded before implementation)

1. Outcome: prepare safe source/review storage and scoped reads; complete owner review/bulk/replace remains unavailable.
2. Domain: existing Knowledge family. Parent owns Settings adoption; ingestion and Chat authors work separately.
3. Harness: reuse existing profile identity, tenant authority and read/metadata/deletion services; no shared-layer status upgrade.
4. Spine: lifecycle read-review/submit/reindex capabilities remain UNAVAILABLE; no registration or public write seam.
5. Provider: native PostgreSQL only. Supabase is existing excluded delivery infrastructure; no provider authority invented.
6. Lane: read-only new RPC; no new mutation verb, approval flow, autonomous action or authority. Existing metadata and deletion contracts retain their lanes.
7. Job/event: none in this foundation. Future work must adopt paige_durable_work and the native worker; no new scheduler/store.
8. Readback/Rail: actual SQL projections establish read behavior. Existing metadata/deletion receipts unchanged; no read receipt fabricated.
9. Surface: no visible surface or Binding Ledger status changed; owner prototype remains the full-flow contract.
10. Proof: local SQL role behavior only. Real authenticated Supabase, API serialization, source verification and owner UI proof remain UNVERIFIED.

## Exact schema and read contract

Canonical tenant_knowledge_docs gains four columns:

- record_state text, canonical default; canonical or draft. Draft requires empty canonical content, zero chunk_count and no network sharing/review request.
- source_coverage text, unknown default; unknown/partial/complete names source extraction coverage, never indexing success.
- source_binding nullable strict JSON: bucket (tenant-knowledge), object_id (UUID), object_name (tenant UUID prefix, bounded path, no traversal/encoding), sha256 (64 lowercase hex), byte_size (1..25 MiB integer), mime_type (1..255), bound_at (valid UTC ISO timestamp). This validates structure only. No backfill guesses a binding, no Storage access occurs, and object existence/version/immutability remain future server responsibilities.
- pending_review nullable strict version-1 JSON: schema_version, extracted_content (1..480000 characters), reviewed_content (null or 1..480000 characters), extraction_version (1..100 characters), coverage (unknown/partial/complete), bounded to 4 MB serialized bytes. No approval, actor or arbitrary keys accepted. Null reviewed_content means no human review is asserted.

knowledge_lifecycle_frozen unconditionally rejects nondefault lifecycle INSERTs and changes to these fields on UPDATE, including service_role and database-owner DML. There is no caller flag/session-setting bypass. A future reviewed migration must explicitly replace that trigger after consumer adoption and source authority are proven. Schema administration can always alter triggers; tests use that administrator power only to seed adversarial future state, then immediately restore the guard.

read_tenant_knowledge_review(expected_tenant, doc_id) returns tenant_id, document_id, revision, record_state, source_coverage, source_binding and pending_review. It locks the raw profile selection, checks exact expected tenant and existing platform-owner/member/company-operator predicates, and looks up the document by both tenant and ID. No service-role/anonymous execute grant. This is a read contract, not a writable review workflow.

read_tenant_knowledge and update_tenant_knowledge_metadata now call an explicit private projection preserving every existing legacy field: id, tenant_id, title, summary, category, tags, source, source_url, share_to_network, network_review_status, network_reviewed_at/by, promoted_to_canon_id, token_count, chunk_count, created_by/at, updated_at, revision. Only document detail adds canonical content. Pending/internal columns never appear. Ordinary reads exclude drafts; metadata updates refuse drafts before CAS. Existing metadata validation, CAS and receipt behavior are retained.

## Direct access and privileged consumers

The original schema grants table-level SELECT to authenticated, which would expose every newly added column. The migration replaces only that table SELECT with grants for every legacy column listed above plus content. INSERT/UPDATE/DELETE grants remain unchanged. Current app queries use explicit legacy columns: KnowledgePanel, TenantKnowledgeAdmin, useSoloKnowledge, Studio knowledge context, PaigeWorkspaceContext and NetworkKbInsights. Complete repository references were scanned, including relational reads and realtime registrations; no authenticated runtime SELECT * or Knowledge realtime subscription was found. Generated types and test references are not callers. PostgREST and Realtime deployed behavior is unverified.

A restrictive document SELECT policy excludes drafts without replacing the existing tenant predicate. A restrictive chunk SELECT policy requires a visible same-tenant parent. Existing match_tenant_knowledge remains security-definer with its established JWT/platform-admin/service authorization; its query now also requires canonical parent state and parent/chunk tenant equality. The test fixture executes that actual SQL using a stand-in vector domain/operator, so filtering is tested but pgvector ranking is not.

Privileged residual access is explicit: kb-promote-to-network uses service-role SELECT *, Studio and Marketplace use privileged canonical paths, and service-role direct table access bypasses normal tenant RLS in Supabase. These were not converted into lifecycle consumers here. The unconditional freeze prevents pending/draft/source-binding activation until those callers are audited and adapted. Thus this slice does not claim complete privileged lifecycle isolation or enable extraction/review/bulk/replacement.

Deletion remains compatible: its definer lookup and CAS can remove canonical documents or adversarially seeded drafts, pending JSON disappears with the row, and child absence is checked. No Storage call occurs. Its existing source_cleanup label remains canonical_source_binding_unavailable, which is accurate while this freeze prevents any binding from being written. The later binding activation slice must update cleanup semantics and coordination before claiming source deletion.

## Executed proof

- Failing first: review-check.py --baseline failed because source_coverage did not exist (before migration implementation).
- review-check.py --psql <PostgreSQL16 psql path>: 48 actual SQL role/behavior assertions, migration replay twice.
- review-check.py --suite metadata and --suite delete: existing SQL behavior suites pass with foundation applied twice.
- Each harness creates/drops only a unique disposable database on localhost:55439; no cluster reset, external database or provider call.
- Supabase CLI generated the migration; filename moved forward after 20270530200000.
- No TypeScript, UI, Chat, worker, DOCX, durable-job or staging-generation changes. No full app compile/build was needed or claimed.
- Independent review is parent-owned and pending. No push, PR, merge, deployment or production proof.
