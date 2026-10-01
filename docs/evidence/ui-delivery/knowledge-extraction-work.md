# Native Knowledge extraction into pending review

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: verified selected caller -> bounded source capture -> native durable intent -> fenced extraction -> pending review readback; published content remains unchanged.
PAIGE_UI_DESIGN: PASS: AGENTS routing assessment finds no visible interface change; UI design work and its checks are outside this backend slice.
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam; current consumers and Chat unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface implementation in this slice.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: prepare pasted or UTF-8 text-file content for review without claiming it was published or made searchable.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: 36 actual SQL assertions plus one two-connection completion race, migration replay twice, 80 focused Vitest tests including actual worker handler with fake dependencies and old document route.
STATIC_EVIDENCE: PASS: strict standalone compile of knowledge-extraction.ts and its scope dependency; focused ESLint for all changed/new TypeScript; consumer inventory and diff check. No full application compiler.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption here.
BEHAVIORAL_EVIDENCE: PASS: actual SQL native envelope and document migrations, new lifecycle RPCs/grants/row locks; actual worker handler executed with fake model/source/RPC ports. No real provider dispatch.
AUTHENTICATED_RUNTIME: UNVERIFIED: real Supabase identity, full migration chain and API serialization not exercised.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls.
ZOOM_REFLOW: NOT_APPLICABLE: no layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: actor/scope denial, malformed and unsupported inputs, byte/character limits, invalid UTF-8, object/hash changes, frozen intent, revision and attempt conflicts, lease recovery, lost acknowledgement, receipt failure, draft secrecy, unchanged published content, legacy writes and document dispatch.
TRUTHFUL_STATE_LABELS: PASS: work succeeded means extraction ready for review, not published Knowledge; completed_unrecorded preserved; URL/PDF/image/DOCX and publication explicitly unsupported in this adapter.
SOLO_UI: NO: staged service only.
UNVERIFIED: Deno deployment/runtime, real authenticated Supabase Storage and PostgREST, full production migration chain, provider extraction and final owner workflow. No provider extraction is implemented in this bounded slice.
RELEASE_CHANNEL: development: local fixture only.
RELEASE_CLASSIFICATION: internal-only: no customer release.
CUSTOMER_RELEASE_IDENTITY: none: no deployed human flow.
RELEASE_NOTE_REQUIRED: NO: staged capability.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated deployment and all privileged consumer adoption; lifecycle Spine capabilities remain UNAVAILABLE.
RELEASE_RECOVERY: position=disable kb-extract-submit and Knowledge worker branch while retaining canonical content and pending review records for reconciliation; reference=2f74af35bcaca6abbd547e9f851ed969d7f42df2
INTERNAL_BUILD_IDENTITY: base=2f74af35bcaca6abbd547e9f851ed969d7f42df2; branch=codex/knowledge-extraction-work; deployment=NOT_APPLICABLE; environment=local; migrations=PROOF_OWED(real Supabase application of 20270532000000_knowledge_extraction_work); edge=PROOF_OWED(kb-extract-submit and paige-document-worker deployment); evidence=scripts/knowledge-service/extraction-check.py



## Ten routing answers (contract approved before implementation)

1. Outcome: capture paste/text-file content into pending review with recoverable native work. The complete review/bulk/replace flow remains owned but incomplete.
2. Domain/collisions: Knowledge owns intake and extraction. Shared native worker, lifecycle grants and privileged readers are the bounded collision surfaces. Parent approved this contract; no Chat/UI/Settings edits.
3. Harness: existing actor authority, paige_durable_work envelope, internal worker gate, pg_net wake and existing cron sweep; no replacement Harness.
4. Spine: knowledge.extract remains a native correlation key only, not a LIVE registered capability. Governed CRUD is a separately owned slice.
5. Provider: existing private tenant-knowledge Storage and PostgreSQL. This slice makes no model/embedding calls. Tests use fake HTTP/model ports.
6. Lane: explicit human intake through JWT-verified Edge, reauthorized by service-only SQL. No approval token, actor or capability status accepted from the request body. Future governed publication requires its own approved native contract.
7. Job/event: extend paige-document-worker with knowledge-run and an isolated Knowledge sweep branch; reuse the existing cron. No new table/queue/scheduler.
8. Readback/Rail: pending_review is read back inside completion; receipt uses existing ten-argument record_capability_run and work ID. Receipt failure yields capability_completed_unrecorded; no duplicate Chat receipt.
9. Surface: no UI/ledger state change. Source/review reads remain explicit scoped RPCs; owner workflow proof still owed.
10. Proof: local SQL roles/locks and actual worker fake-port execution. Real Storage/auth/PostgREST/Deno and full owner interaction remain UNVERIFIED.

## Supported boundary

kb-extract-submit accepts strict intent_id, expected_tenant, title, kind=paste|file, optional paired doc_id/expected_revision, and either content or path. Actor, hash, binding, arbitrary fields and approval assertions are rejected. Paste is at most 480000 UTF-16 code units and 2 MiB UTF-8. Files must have txt/md/markdown/csv/json suffix, text/* or application/json response MIME, valid UTF-8 without NUL, at most 2 MiB streamed bytes and 480000 decoded code units. The Storage read uses the caller JWT for intake and a fixed Storage origin/path for the worker. Redirects are refused, stream reads use a 30-second abort, and Content-Length is not trusted as the sole bound. Request-body reads are also bounded.

PDF, images, URL and DOCX return unsupported before submission. Existing legacy ingestion endpoints retain their current behavior; this adapter does not silently route unsupported formats through them. DOCX parity (Mammoth 1.12.2 plus archive expansion/time limits), PDF/image extraction, HTTPS URL stream limits, bulk UX, review editing and publication remain queued, not delivered.

bindKnowledgeIngestScope is adopted from reviewed ingestion commit db4f4a8b without merging its UI or overwriting existing handlers. Its runtime is unchanged; its caller port is now typed instead of any for lint/compile verification. It checks the actual JWT user, raw selected profile and existing owner/member predicates repeatedly. The service RPC independently checks the current actor through knowledge_actor_authorized.

## Canonical source and state

The existing document gains extraction_input, extraction_source_binding, extraction_work_id and extraction_revision. These are internal and excluded from ordinary SELECT grants/projections. Raw paste input exists only on the canonical document until completion; request_payload contains document ID, frozen request hash, input hash and revision, never raw text. File input stores only its verified candidate binding until the worker reads it again.

resolve_knowledge_extraction_source queries storage.objects through SQL (the Storage schema is not assumed to be a public REST API). It validates current actor authority and exact tenant path. Intake captures actual object UUID, bucket and name, streams actual bytes and computes SHA-256/length. Identity is checked again before submission. Worker checks object identity and byte/hash equality with the frozen binding. Completion locks and rechecks the object identity. This proves the bytes extracted for this intent; it does not claim the Storage object is immutable or cannot change after extraction.

Canonical source_binding is preserved for existing documents and remains null on new drafts. The candidate source is extraction_source_binding, explicitly returned only by read_tenant_knowledge_review along with extraction_work_id. Source cleanup is never attempted. Deletion still removes the pending document/chunks with CAS; it does not delete the uploaded file.

New documents are drafts with empty canonical content and no chunks. Replacement submission records one pending extraction on the same canonical document and leaves content/chunks/source binding untouched. Submission advances the canonical revision and freezes that revision in the native request. A concurrent metadata edit causes completion to refuse; it never overwrites the newer row. Another pending extraction/review blocks a new intent until the existing native work is failed/cancelled; this slice adds no automatic cancellation or publication.

## Native RPCs and fencing

Service-only functions explicitly revoke PUBLIC, anon and authenticated execution:

- submit_knowledge_extraction validates/fixes actor scope, source shape, optional target CAS and one pending work reference; serializes the intent; freezes request identity; creates the existing native knowledge_extract/knowledge.extract envelope and wakes the same worker.
- start_knowledge_extraction locks the envelope, current authority and document; checks revision/live lease and dispatch_started_attempt; returns raw input only to the trusted worker.
- complete_knowledge_extraction requires exact work/key/attempt/dispatch/revision/live lease, current authority, actual input hash and object identity. It writes pending_review only, verifies the row, records a safe receipt and transitions the native envelope atomically.
- settle_knowledge_extraction_failure is attempt/key/lease fenced. Ambiguous completion is outcome_unknown and never automatically redispatched.
- recover_knowledge_extraction retries only a missed predispatch wake using native expired/reconciled transition and attempt ceiling. Dispatched expiry becomes outcome_unknown. Authority loss blocks work.
- lock_knowledge_extraction_authority locks auth user, tenant, membership, role and selected profile rows before checking the existing canonical predicate. It adds no role taxonomy.

Successful extraction means phase=awaiting_review. Coverage=complete means the full bounded paste/UTF-8 bytes were decoded without truncation; it does not claim factual correctness or human review. reviewed_content remains null. Canonical source_coverage remains unknown. No embeddings are generated and no content is made searchable.

## Lifecycle activation and privileged reader inventory

The previous unconditional freeze is replaced by server-only lifecycle protection. Authenticated table-level INSERT/UPDATE grants are revoked and restored for every legacy column only; otherwise table grants would override column restrictions. New internal fields remain unreadable and unwritable directly. The trigger additionally refuses authenticated lifecycle changes and identity moves while extraction is pending. Legacy explicit canonical INSERT/UPDATE is exercised in SQL.

All repository tenant_knowledge_docs callers were inspected:

- kb-promote-to-network now selects only the legacy fields it uses and requires record_state=canonical.
- _shared/studio-brain annotation reads use explicit fields plus canonical and exact tenant filters; actual chunk retrieval already uses the foundation's canonical/same-tenant search filter.
- Marketplace and kb-ingest-core read back only the ID of their newly inserted canonical row; their explicit ID projections expose no internal fields. Cleanup/writes are unchanged.
- studio-learn-from-artifact performs scoped cleanup, not a document read. No new source_url value is introduced by this adapter.
- Ordinary app readers use legacy explicit columns and restrictive canonical RLS. read_tenant_knowledge and metadata responses remain explicit safe projections. Review alone exposes pending text to the authorized selected workspace.

Service-role remains trusted and can access internal rows directly. This slice adopts the actual existing privileged readers; it does not claim service-role RLS isolation. No publication writer is provided. The new worker mode is protected by the existing internal caller gate.

## Executed verification

- Failing first: extraction-check.py --baseline failed with missing start_knowledge_extraction before implementation.
- extraction-check.py: 36 SQL assertions plus one real two-connection completion race. The observed pg_stat_activity lock barrier proves concurrent completion writes the pending revision and receipt once. Migration replayed twice.
- 80 Vitest tests: extraction intake/core, actual worker handler with fake ports, existing document-production tests and existing read/update/delete adapters. Actual legacy document submit/replay/status/start also exercised in SQL.
- Focused ESLint across all changed/new TypeScript and strict standalone compilation of the extraction core/scope helper pass. No full compiler/build overlap.
- Evidence validator and git diff checks pass. No live DB, Storage, model, embedding, deployment or external mutation.
- Independent review is parent-owned and pending. No push, merge or release authorization inferred.

## Independent review repair: intake acknowledgement

Review of f975f44f found an uncertain submission was reported as rejected and malformed RPC replies could report success. Actual kb-extract-submit handler tests first reproduced five failures (three controls passed). The repair validates work/document IDs, native status, replay flag and fresh revision, returns only the acknowledgement projection, and identifies only explicit known SQL refusals as rejected. Lost, transport-error or malformed post-submit replies return HTTP 503 with submission_outcome_unknown, the original intent_id and reconciliation=replay_same_intent. No automatic retry or new intent is created. The original frozen input must be retained for explicit reconciliation.

Repair verification: 90 focused Vitest tests across six files, focused ESLint and strict core TypeScript. Migration and SQL behavior unchanged; existing 36 SQL assertions and concurrent completion race were independently rerun at the reviewed base. No live provider or Supabase runtime claim.
