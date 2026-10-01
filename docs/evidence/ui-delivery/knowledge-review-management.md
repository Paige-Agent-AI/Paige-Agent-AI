# Knowledge pending review management

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: selected caller -> native job visibility -> pending discovery -> revision-CAS save or terminal discard -> safe receipt readback.
PAIGE_UI_DESIGN: PASS: AGENTS routing assessment finds no visible interface change; UI design work and its checks are outside this backend slice.
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam; current consumers and Chat unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface implementation in this slice.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: discover, revisit, save and discard pending review without changing published Knowledge.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: 90 actual SQL assertion notices including legacy extraction regressions, migration replay twice and four two-session races.
STATIC_EVIDENCE: PASS: SQL source/permission review and diff check; no TypeScript or UI changes.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption here.
BEHAVIORAL_EVIDENCE: PASS: actual PostgreSQL native envelope, extraction and management migrations, real roles and concurrent transactions; no provider dispatch.
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
RELEASE_RECOVERY: position=revoke management RPC execution while retaining canonical content and pending review for reconciliation; reference=007cc088e234848c1d73e3dc495b0cda940676f2
INTERNAL_BUILD_IDENTITY: base=007cc088e234848c1d73e3dc495b0cda940676f2; branch=codex/knowledge-review-management; deployment=NOT_APPLICABLE; environment=local; migrations=PROOF_OWED(real Supabase application of 20270532010000_knowledge_review_management); edge=PROOF_OWED(kb-extract-submit and paige-document-worker deployment); evidence=scripts/knowledge-service/management-check.py



## Ten routing answers

1. Outcome: server-backed discovery, review save and terminal discard. Publication and the complete approved UI flow remain owed.
2. Ownership: Knowledge-only new migration31 and SQL fixtures; no shared Chat, Settings, worker or adapter edits. Parent approved exact interfaces before implementation.
3. Harness: reuse native paige_durable_work/get_paige_durable_work and current actor authority. No job engine or new store.
4. Spine: no LIVE capability or tool registration claim. Existing governed CRUD remains separate.
5. Provider: no provider, embedding, Storage mutation or source parser changes.
6. Authority: authenticated JWT only, raw selected workspace, existing actor predicate plus initiator/admin/owner native visibility. Service-role direct invocation of public management RPCs denied.
7. Jobs: terminal history remains immutable. No new transition, cancellation or dispatch.
8. Rail: ten-argument record_capability_run; deterministic operation/revision run reference. Receipt failure is capability_completed_unrecorded. last_review_operation stores one bounded reference/status, not an audit history or raw payload.
9. Surface: no caller/UI controls introduced. Existing extraction review schema1 remains compatible.
10. Proof: actual local roles, 105+ row pagination and two-session races; live auth/PostgREST/full production chain remain UNVERIFIED.

## Exact additive contract version1

- list_tenant_knowledge_pending(p_expected_tenant,p_after_id=NULL,p_limit=20): exclusive UUID cursor, 1–50 summaries. Canonical docs are the only discovery store. Items have identity/revision/title, record_state/review_available, linked safe native work projection and extraction_outcome. No text or storage path in list. next_cursor is present only when another visible item exists. Concurrent changes are not a snapshot guarantee.
- read_tenant_knowledge_pending(p_expected_tenant,p_doc_id): exact scoped detail with existing schema1 pending_review, separately staged pending_review_metadata, source bindings and safe receipt state. After replacement discard, the bounded operation reference allows readback through the same job visibility predicate. After draft removal, missing means absent; it is not attribution of a previous successful call.
- save_tenant_knowledge_review(p_expected_tenant,p_doc_id,p_work_id,p_expected_revision,p_content,p_metadata): requires succeeded extraction and pending review. Complete four-field metadata object (title/summary/category/tags), existing bounds; text <=480000 PostgreSQL characters and <=2MiB UTF-8. One revision increment; extracted text/provenance immutable. Canonical content/metadata/chunks/source are untouched.
- discard_tenant_knowledge_review(p_expected_tenant,p_doc_id,p_work_id,p_expected_revision): succeeded/failed/cancelled only. Remove a draft with verified doc/chunk absence, or clear pending fields on a replacement. Preserve immutable native terminal outcome. Return review_discarded, work_cancelled=false and source_cleanup not_attempted/retained_by_policy. No Storage deletion.

Each mutation locks work, then authority rows, then the document. Exact tenant/work/document/revision is checked. New extraction invalidates saved review metadata and prior operation reference. Internal columns are excluded from existing grants and protected against direct authenticated writes. Legacy explicit writes were exercised after migration.

Extraction outcome is one of capability_succeeded, capability_completed_unrecorded or unknown, derived only from a matching verified native terminal result; raw request/authority/terminal payload is never returned. Save/discard receipts contain references only. Readback preserves completed_unrecorded without claiming the Rail receipt exists. No automatic write retry.

The prototype Reading -> Pause and pending -> Resume/discard remains the final design. In-flight discard refusal is a temporary safe implementation boundary, not a design change. Pause, resume and reconciled cancellation remain owed; no UI control is claimed here.

## Verification

Failing first: management-check.py --baseline failed because list_tenant_knowledge_pending did not exist. After implementation: 90 SQL PASS notices including extraction regressions, actual grants/roles, raw scope/ban/owner/company operator, metadata allowlist/bounds, wrong work/revision, receipt failure, canonical preservation, terminal history preservation, post-discard absence and >100-row bounded discovery. Four actual two-session races: completion/completion, save/save, save/discard, worker completion/stale discard. Migration31 replayed twice.

Command: python scripts/knowledge-service/management-check.py --psql "C:/Program Files/PostgreSQL/16/bin/psql.exe". Unique disposable database only; existing cluster retained. The fixture models canonical auth dependencies, not live Supabase authorization or full production schema replay.

No full application compiler/build, provider calls, production writes, push, merge or deployment. Independent review pending.

## Independent review repair batch (2026-10-01)

Independent review of e988f0e93be4979528dc38723c90f579025b5c60 returned FAIL with one P2: the save validation
counted PostgreSQL characters while the typed consumer validates reviewed content by UTF-16 code units
(480000) plus UTF-8 bytes, so 240001 emoji fit both old caps yet could never be read back. Repair:

- save_tenant_knowledge_review now enforces knowledge_utf16_length(content) between 1 and 480000;
  the helper counts code points plus astral-plane matches and is revoked from PUBLIC/anon/authenticated/
  service_role with grants mirroring knowledge_review_metadata_valid.
- Every multi-signature REVOKE/GRANT in this migration is split into one statement per exact signature so
  the definer-signature-acl guard can attribute each ACL (same grants, no baseline change).
- management-behavior.sql adds the non-BMP boundary: 240001 emoji refused (KNOWLEDGE_REVIEW_INVALID),
  exactly 480000 units saved and read back exactly, 480001 units refused.

Re-run on the repaired tree: management-check.py full suite PASS (all SQL assertions, four two-session
races, migration replayed twice). Head changed with this repair; the sole independent recheck still owed
on the new head. In-flight discard refusal, pause/resume/cancel and authenticated proof remain owed.
