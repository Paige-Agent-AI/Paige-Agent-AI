# Shared Knowledge extraction consumer adapters

## Scope and frozen contract

Base:009898cb6565151bb98c0f92d0ded7cb1d99467d. Backend contract:007cc088e234848c1d73e3dc495b0cda940676f2 in the separate extraction branch. This slice adds one library module and its tests. No UI, hook, handler, worker, schema, polling, storage upload, persistent store, cancellation or publication changes. The module has no production caller yet.

Owner-approved full intake/review/batch experience remains owed. Parent approved this infrastructure slice after reading outputs/knowledge-next-intake-consumer-packet.md. Current AddDocDialog stays unchanged.

1. Outcome: shared typed submit/status/review adapters for the frozen native extraction contract.
2. Owner/collision: this checkout owns only the new library/tests/evidence; backend author owns extraction SQL/functions, parent owns integration/publication.
3. Harness: injected JWT function/RPC client; existing knowledge extraction and durable-work APIs.
4. Spine: existing knowledge.extract work identity only. No new capability or activation.
5. Provider: none invoked by this slice; server's supported UTF-8 path only.
6. Authority: tenant equality remains a precondition; server owns authentication/authorization. Required caller incarnation callback checks before and after async boundaries; tenant equality alone is explicitly insufficient.
7. Jobs: reuse paige_durable_work references; no client queue, poller, retries or persistence.
8. Readback: exact tenant/document/extraction-work association before status; unknown submission remains uncertain and requires an explicit same-intent reconciliation.
9. Surface: no UI adoption yet; no new customer-facing claim.
10. Proof: unit contract and adjacent adapter regression tests, standalone module compilation, lint and diff checks. No authenticated runtime or deployment claim.

## Consumer contract

`submitKnowledgeExtraction`: one kb-extract-submit invocation; strict paste/file shape; UUID references, paired replacement revision, tenant-bound supported path and bounded content/serialized body. Fresh response requires claimed + revision1 for a new draft or expected revision+1 for replacement. Replay accepts absent revision and an existing durable status. Return references carry captured tenant and intent; server response lacks tenant/intent fields, so source identity is verified on subsequent scoped review read. References are not authority.

`readKnowledgeExtractionReview`: exact p_expected_tenant/p_doc_id read; verify returned tenant, document, work association and nonregressing revision. Validate plain extracted/reviewed text and source bindings, retain original and pending source bindings separately. `phase=awaiting_review` only when validated pending_review exists; otherwise `review_unavailable`. No canonical content promotion, markup rendering, invented summary or receipt field.

`readKnowledgeExtractionStatus`: first reads/validates the source-to-work association because get_paige_durable_work does not return tenant/document fields; then requests that exact work ID and validates knowledge.extract/knowledge_extract, known state and bounded metadata. These are separate HTTP observations, not an atomic snapshot or fresh server authorization guarantee. Changes after either request are not claimed impossible; consuming UI must continue its scope and revision checks.

All scope guards are captured by value and rechecked after each await, including errors. Same A-to-B-to-A tenant value cannot revive an expired caller incarnation. No automatic write retry after transport errors, function errors or malformed acknowledgement. Error has submissionUncertain=true for post-dispatch ambiguity, including scope loss. Read failures do not trigger writes.

Backend known limits: pending review only; reviewed_content stays null until a future writer; no publication/review-save/pending discovery/cancel API. Public status/review do not expose terminal receipt outcome. Succeeded means extraction work succeeded; it does not assert published/indexed Knowledge or a recorded receipt. No cancel/delete wrapper is introduced. SQL delete can remove a known draft at exact revision, but does not cancel its durable work; this distinction was checked directly in20270526000000_knowledge_canonical_delete.sql.

## Verification

PASS82 new adapter tests; PASS105 across new extraction tests plus existing knowledge-service and knowledge-delete suites. Cases include fresh/replay/replacement, all five supported file extensions, invalid/oversized/escaped input, wrong tenant/path/document/work, malformed and empty acknowledgements, no automatic retries, stale scope before/after submission and reads, partial/canonical review shapes, missing review, plain untrusted text, unsupported receipt/publication fields, and all seven durable work statuses.

PASS standalone module typecheck: `npx tsc --noEmit --target ES2022 --module esnext --moduleResolution bundler --skipLibCheck src/lib/knowledge-extraction-service.ts`.
PASS focused ESLint for module and tests. PASS git diff check.

No failing-first baseline claim: this is a new uncalled module; tests were written alongside implementation and then run. No full application build/typecheck/full-suite rerun. No rendered proof needed for this unmounted adapter slice. Authenticated Supabase, deployed worker/cron, Storage and eventual Settings/Chat interactions remain UNVERIFIED. Backend independent review is separate and may require contract revalidation before integration.

Independent review pending. No push/PR/merge/deployment performed. Shipped Delivery Log:N/A, not merged to main.

## Repaired acknowledgement contract

Backend review found ambiguous submission acknowledgements; repaired immutable007cc088e234848c1d73e3dc495b0cda940676f2 was read before this final consumer handoff. HTTP503 now reports `{ok:false,error:'submission_outcome_unknown',intent_id,reconciliation:'replay_same_intent'}`. Supabase function errors remain conservatively uncertain; if the explicit body is available, adapter checks its exact intent and reconciliation instruction before returning the same unknown error. No HTTP409/null/malformed acknowledgement is treated as a safe reason for a new intent. Added three explicit reconciliation cases; final105 tests and standalone compile/lint PASS.
