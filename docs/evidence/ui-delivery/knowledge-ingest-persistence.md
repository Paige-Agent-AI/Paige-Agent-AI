# Knowledge ingestion: verified persistence (slice 1a)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing-project repair; chunk write -> searchable-row readback -> count reconciliation -> truthful result; failures are exercised by src/__tests__/kb-ingest-persistence.test.ts.
PAIGE_UI_DESIGN: PASS: reviewed the repository skill and routing during the approved knowledge prototype; this patch changes only backend persistence and adds no interface layout.
MATERIAL_FLOW_CHANGE: NO: repairs the existing ingestion result contract; adds no entry point or authority.
FLOW_PROTOTYPE: NOT_REQUIRED: backend persistence repair; the broader knowledge layout was separately approved by the owner on 2026-09-30.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a tenant saving knowledge must receive success only for verified persisted searchable chunks.
VISUAL_DIRECTION: NOT_APPLICABLE: no UI files or visual styles changed.
AUTOMATED_EVIDENCE: PASS: focused Vitest suite24/24; existing test:knowledge-scope375/0; initial regression suite15failed/4passed on unchanged core; zero-vector canary1failed/21passed before correction.
STATIC_EVIDENCE: PASS: production build exit0; ci:tsc exit0 with12existing baseline errors and0new; focused test-file ESLint exit0; git diff --check exit0. Core ESLint retains its two existing no-explicit-any diagnostics on the client parameters.
RENDERED_EVIDENCE: NOT_APPLICABLE: backend-only slice; prototype captures do not establish this implementation's runtime behavior.
BEHAVIORAL_EVIDENCE: PASS: real ingestion function executed with recording database and provider adapters; exact persisted indices/counts, partial embedding, malformed vectors, lost responses, cleanup ambiguity and paging tested.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser/database/provider drive; browser-control runtime failed to start. No production writes were attempted.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interface controls changed.
ZOOM_REFLOW: NOT_APPLICABLE: no layout changed.
REDUCED_MOTION: NOT_APPLICABLE: no motion changed.
STATE_COVERAGE: PASS: empty, complete, partial, provider failure, invalid vector, write failure, readback mismatch, reconcile failure and uncertain cleanup are covered by the executable suite.
TRUTHFUL_STATE_LABELS: PASS: core ok:true requires readback; embedded:true additionally requires every intended chunk; failed cleanup reports persistence_unverified. Caller presentation remains separately owed.
SOLO_UI: NO: shared backend implementation only; no Solo component changes.
UNVERIFIED: actual provider/database behavior, authenticated owner/member/other-tenant proof, callers' handling of partial and uncertain outcomes, and the full approved CRUD/Spine/Rail/Mind outcome remain unverified.
INTERNAL_BUILD_IDENTITY: 3d0f12dd3ebe18bda491baa60a1583d179ec6ed0; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(shared-core deployment and authenticated readback); evidence=src/__tests__/kb-ingest-persistence.test.ts
RELEASE_CHANNEL: development: isolated branch and injected-adapter tests only.
RELEASE_CLASSIFICATION: internal-only: first repair slice, no customer capability release.
CUSTOMER_RELEASE_IDENTITY: none: no completed owner-visible capability or production release.
RELEASE_NOTE_REQUIRED: NO: internal foundation repair only.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: real ingestion requires authenticated provider and database proof; no LIVE claim. The approved knowledge feature remains incomplete.
RELEASE_RECOVERY: position=revert this isolated patch before deployment; reference=3d0f12dd3ebe18bda491baa60a1583d179ec6ed0; no schema/data migration.

## Routing and scope

- Owner outcome: upload/review/manage knowledge once across Settings, Chat and Mind, with governed Paige read/create/update/delete. This slice establishes only persistence truth.
- Portfolio: Chat/Command Center and Solo Settings; reuse existing ingestion adapter, authority and provider contracts.
- Harness: existing A/B/F/G seams; durable jobs are later batch work. No parallel execution, registry, receipt, memory or scheduling system.
- Spine: business_context.readiness remains status-only. Governed knowledge CRUD keys are not supplied by this patch.
- Provider: existing Voyage adapter unchanged. The integration registry names Voyage as platform infrastructure but has no ordinary-ingestion capability entry; reconcile that missing entry before provider activation/merge. No new provider authority is asserted.
- Approval: save_to_knowledge_base remains ordinary/save through existing authority; no gate changes.
- Readback: tenant+document scoped searchable chunk indices and exact count; document count is separately read after reconciliation. Failure cleanup proves absence before saying nothing was saved.
- Surface labels remain unchanged: paige.workspace PARTIAL; settings.setup PROOF_OWED; command-center.mind UNAVAILABLE in its binding record. Newer visible code is not proof of those bindings.
- Canonical registry/ledger/tier updates: N/A to this backend repair, because no capability or availability is being registered. Required future domain integration remains explicit.
- Active collisions: #1598 and #591 touch paige-ai-chat; no handler, action-risk, harness loader, or package file was changed.
- Shipped Delivery Log: N/A, this draft has not reached main.

## Compatibility and deferred slice 1b

Existing result keys and partial-success semantics are retained. A verified subset remains ok:true, embedded:false. This is deliberately not the complete human-facing truth repair: TenantKnowledgeAdmin accepts HTTP200 ok:false, Studio replaces older knowledge after partial indexing, and chat cannot yet distinguish uncertain persistence. The doc/file/URL adapters can drop outcome detail. Those consumers must be fixed in the next small slice, with the shared chat-owner collision resolved first. No end-to-end save guarantee is claimed here.

## Commands and proof boundary

- npx vitest run src/__tests__/kb-ingest-persistence.test.ts --maxWorkers=1 --reporter=dot: exit0,24tests.
- npm run test:knowledge-scope: exit0,375checks.
- npm run build: exit0; existing large-bundle warnings.
- npm run ci:tsc: exit0,12baseline/12current. Plain typecheck remains FAIL against the inherited baseline.
- npx eslint src/__tests__/kb-ingest-persistence.test.ts: exit0.
- npm audit --json: exit1,2high/4moderate/1low; package and lockfile unchanged. High: brace-expansion, vite; moderate: ajv, fast-uri, react-router, react-router-dom; low: dompurify. Existing dependency PRs1593/1596/1558/1544/1542 own relevant updates. No advisory is waived or fixed by this slice.

The independent specification reviewer found all-zero vectors could falsely count as searchable. The correction validates float32-representable, nonzero vectors, with zero, underflow and overflow tests. Final exact-head independent review is recorded in the PR. No full-suite, real-database, migration-replay, screen-reader, deployment or authenticated proof is claimed.

