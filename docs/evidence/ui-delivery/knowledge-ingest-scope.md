# Knowledge ingestion workspace binding

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing-project security repair; orchestration, delivery, audit, build, review and verification routes read. Bounded actor-flow and failing-first evidence below.
PAIGE_UI_DESIGN: PASS: project skill, all five modules and routed standards read. Existing intake feedback and controls retained.
MATERIAL_FLOW_CHANGE: NO: restores the existing workspace-isolation precondition at server checkpoints; no new goal, control, confirmation, recovery path or permitted side effect.
FLOW_PROTOTYPE: NOT_REQUIRED: server authorization repair preserves the already approved intake flow and its existing refusal and uncertain-outcome presentation.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: authenticated tenants add private knowledge only in the workspace they explicitly selected.
VISUAL_DIRECTION: PASS: existing consumer-truth UI preserved; no visual code or layout changes.
AUTOMATED_EVIDENCE: PASS: focused real handler, real guard and real core tests; 118 tests across six files. Existing knowledge-scope suite 375 passed; SSRF smoke 20 passed. Initial handler regression run failed 20 cases and passed three before implementation.
STATIC_EVIDENCE: UNVERIFIED: changed test ESLint and diff check pass. Frontend type ratchet started after coordinator clearance but has returned startup output only; completion is unverified. Deno executable unavailable; no edge deployment/typecheck claimed.
RENDERED_EVIDENCE: UNVERIFIED: no fresh render for this backend-only change; prior consumer modal captures do not prove authorization.
BEHAVIORAL_EVIDENCE: PASS: actual handlers/core execute with injected auth, database and provider boundaries; no production caller or browser behavior claimed.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated database, provider or production mutations performed.
KEYBOARD_FOCUS: UNVERIFIED: no UI edits; inherited component behavior not re-driven.
ZOOM_REFLOW: UNVERIFIED: no UI edits; inherited layout not re-driven.
REDUCED_MOTION: NOT_APPLICABLE: no motion changes.
STATE_COVERAGE: PASS: mismatched explicit workspace, null/malformed active workspace, revoked/malformed authority, deleted actor, cross-membership path, download/extraction/embedding switches, downstream response switches, private success, owner authority and uncertain cleanup exercised.
TRUTHFUL_STATE_LABELS: PASS: pre-ingestion denial is retry-safe and identifies no indexing; after possible writes, core verifies removal or returns uncertainty. Late scope changes suppress success.
SOLO_UI: NO: only backend authorization and tests change; the canonical Solo interface remains untouched.
UNVERIFIED: real caller/database/provider, full UI/account switch, Deno typecheck, deployment and production acceptance. Checkpoint validation is not atomic across HTTP/provider/database calls and cannot detect a switch away and back between observations. Trusted core callers such as Studio keep their existing authorization until separately adopted.
OWNER_INTENT: Continue the approved Knowledge capability with server-derived workspace binding for paste, file and URL intake; supplied tenant identifiers are equality preconditions and cannot override authority.
MUST_NOT_HAPPEN: no cross-workspace source download or provider/write after observed invalidation; no fabricated success or rollback; no role-name fork or schema/UI/Chat changes.
MUST_PRESERVE: user-scoped document insertion, established owner/member predicates including company-operator authority, share/network behavior, SSRF guards, core partial/readback semantics, trusted Studio caller compatibility.
ACCEPTANCE_CRITERIA: actual handlers deny unauthorized intake before egress/write; subsequent checkpoints stop work on observed invalidation; cleanup targets only the newly inserted document and honestly reports uncertainty if absence cannot be established.
MOTION_PURPOSE: NONE: no motion changes.
PROTECTED_SEAMS: affected tenant isolation, authentication, canonical writes/readback, provider egress, privacy and retry outcome truth tested through injected boundaries. Unchanged billing/signup/provisioning, approval/autonomy, Spine, Rail/Memory, chat lifecycle, Live Conversation, Vault/Secure Browser, scheduling and shell geometry. Authenticated proof remains owed.
INTERNAL_BUILD_IDENTITY: 927d615e90cf708bbb6c00a355d9b61d91f69bf6; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(doc/file/URL deployment); evidence=src/__tests__/knowledge-ingest-scope.test.ts; final exact head belongs in independent review record.
RELEASE_CHANNEL: development: local implementation and synthetic boundary proof only.
RELEASE_CLASSIFICATION: internal-only: bounded isolation repair awaiting independent review and authenticated proof.
CUSTOMER_RELEASE_IDENTITY: none: no production release.
RELEASE_NOTE_REQUIRED: NO: no customer announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: real authenticated intake and provider/database acceptance remain unverified.
RELEASE_RECOVERY: position=revert bounded patch before deployment; reference=927d615e90cf708bbb6c00a355d9b61d91f69bf6; no migration or production changes.

## Flow and capability routing

Actor: authenticated user adding paste, file or URL knowledge. Resolve getUser, read the raw profiles.active_tenant_id under that caller, require a valid selected workspace, then call established is_platform_owner and is_tenant_member(_tenant) under the same JWT. Both predicate responses must be booleans with no error. Company-workspace operator authority stays in the existing membership predicate (20270521000000_operator_authority_in_company_workspaces.sql), never a duplicated role lookup. A supplied tenant is an equality assertion for every actor, including platform owners.

Knowledge owns this flow. Existing synchronous intake/core and Harness contracts are reused. business_context.readiness remains status-only; no new Spine capability, provider authority, event/job scheduler, Rail or Memory stream is added. Existing Voyage/model-router dependencies remain; private defaults and explicit share/network fields are unchanged. Surface ledger states remain unchanged (paige.workspace PARTIAL; settings.setup PROOF_OWED). Real caller/provider proof is required before a LIVE claim.

File source prefix must match the pinned workspace before download. Extractor trace and nested payload use that derived workspace. URL checks scope before each guarded fetch hop. File/URL check again before nested ingestion and before returning a result. Doc passes an optional authorization callback through core checkpoints: before document insert, each embedding, chunk write, count reconciliation and successful response. Existing trusted callers that omit the callback remain compatible. A failed checkpoint after insert uses existing new-document-only cleanup and readback.

## Verification and limitations

- Failing-first: knowledge-ingest-scope.test.ts executed the actual old handlers with injected boundaries: 20 failures / 3 passes. Failures included dual-member mismatch, cross-membership file path, revoked authority, switch during download/fetch and absent downstream pinning.
- `npx vitest run src/__tests__/knowledge-ingest-scope.test.ts src/__tests__/kb-ingest-persistence.test.ts src/__tests__/knowledge-consumer-truth.test.ts src/__tests__/knowledge-dialog-outcome.test.ts src/lib/knowledge/ingest-outcome.test.ts src/lib/knowledge/studio-learning-outcome.test.ts --maxWorkers=1 --reporter=dot --silent`: 118 passed on the final focused run, including authorization-specific HTTP status and storage traversal checks.
- `npm run test:knowledge-scope`: 375 passed; `npm run smoke:kb-ingest-url-ssrf`: 20 passed.
- Focused test ESLint PASS; `git diff --check` PASS.
- Supabase skill read; current changelog fetched and auth getUser documentation consulted: https://supabase.com/docs/reference/javascript/auth-getuser . No dependency/API-version change.
- No UI, schema, reserved paige-ai-chat handler, Studio authorization, automatic retry or idempotency changes. Source storage lifecycle remains separate.
- No atomic revocation guarantee: authority can change between checkpoints, or change away and back without detection. Cleanup uses service-role scope only for the newly created row; no existing knowledge is pruned.
- Shipped Delivery Log N/A: no merge or deployment. Independent review is owed on the final exact commit; the author does not approve their own work.
