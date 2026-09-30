# Paige Document Production — Phase 2 Plan

> **Status:** LOCAL INTEGRATION CANDIDATE; NOT LIVE. Platform Reach released the existing
> `document_generate` handler and the narrow Spine registry attachment to Long-Form. Chat now submits
> a bounded brief to `public.submit_paige_document_work`, browser Retry reuses one intent UUID, and
> the existing artifact is returned by the worker through the persisted conversation. The Spine
> carries `long_form.document_authoring` as an explicit action-unavailable/outcome declaration:
> the current vocabulary cannot truthfully describe the intentionally automatic Studio build lane,
> so it does not invent `chat-canonical` approval or a parallel governed-execution path.
>
> **Dependency:** `paige_durable_work` is `SUBSTRATE PROVEN`, not a live durability capability.
> Local single-claim concurrency is proven. Disconnect/resume, persisted apply, and authenticated
> owner readback must be proven before document production may ship as durable.
>
> **Candidate proof state:** the Phase 2 migration and durable document transaction are locally
> proven on disposable PostgreSQL 16, including malformed/cross-tenant refusal, same-intent replay,
> duplicate-dispatch refusal, receipt-failure rollback, revision conflict, authority change, missed
> wake-up recovery, and post-dispatch `outcome_unknown`. The shared router vocabulary blocker is
> locally repaired at `d247abba47e386fa7426179a52c449550c41f7c4`: `frontier` now maps to the
> reasoning budget band. Real Deno checks are zero-diagnostic for the shared router, the existing
> `export-document` consumer, and the new `paige-document-worker`.

## 1. Corrected current state: extend, do not replace

Document production is not absent. It is synchronous and trapped inside one chat turn:

- `paige-ai-chat` already exposes `document_generate`. The model places the complete document in
  tool arguments as structured design blocks, and the same request validates and saves it.
- `marketing_content` with `kind='document'` is the canonical artifact row. Its body stores
  `{ docType, title, blocks }`; it remains the document home.
- `studio_artifact_versions` is the existing append-only revision lineage for session-bound
  documents. It remains the revision home where a Studio session exists. A chat-authored document
  has no Studio session foreign key, so its bounded prior bodies stay on the canonical
  `marketing_content.meta.document_versions` row during compare-and-set revision; this is not a
  second universal artifact store.
- `export-document` renders the saved artifact to PDF, DOCX, PPTX, or Markdown and already emits a
  `document_export` Rail outcome.
- `PaigeArtifactCard` and `DocumentPreview` are the existing open/preview surfaces. They remain the
  renderer and artifact handoff.
- `paige_chat_turns.bundle_ref` is the existing persisted projection for cards reconstructed after
  reload. Live `paige_artifact` frames are not durable today.

The missing capability is therefore: accept a bounded document brief, attach it to one durable
work identity, author outside the interactive request, safely persist or revise the existing
artifact, and project its state back into the originating thread after disconnect.

The observed production `400 Invalid input format` remains undiagnosed until the owner-supplied
response body names the rejected field. This plan does not relabel it as a size or timeout defect.

### Agreement ownership boundary

A document produced by this capability is a **draft artifact and nothing more**, even when its
content looks like an agreement. `marketing_content` is the home for that draft. This lane does not
create, promote, mirror, or update a signable agreement in the agreements lane's tables, and it does
not assign agreement lifecycle, execution, signature, filing, or legal-review status.

Promotion from an agreement-shaped draft to a signable agreement is an explicit handoff to the
agreements lane through that lane's own governed path, tables, lifecycle, and evidence requirements.
There is no implicit synchronization between the two homes and no second agreement-authoring path.

## 2. Single-Spine attachment map

| Layer | Planned attachment |
|---|---|
| Spine | `long_form.document_authoring` is attached to `PAIGE_SPINE_CAPABILITIES` with the verified terminal outcome contract. Its `action` is explicitly unavailable until the shared vocabulary can represent the existing Studio-session authority honestly; runtime submission remains `public.submit_paige_document_work`. |
| Rails | Accepted work records its terminal receipt atomically in the worker. The five pre-envelope terminal paths record executor-local refusal or `outcome_unknown` receipts with the service-role client, no correlation/detail overload, and no mega-catch inference. Existing `document_export` receipts remain. |
| Harness | `paige_durable_work` plus the existing durable-job mechanism, model router, canonical `marketing_content`, Studio versioning where a session exists, and `export-document`. Completion uses one security-definer transaction instead of `save_marketing_content` because artifact + readback + completion turn + receipt + work settlement must commit or roll back together. No second scheduler, lease system, or artifact store. |
| Agent access | Evolve the existing `document_generate` entry into bounded submit semantics through the coordinator-held relay. No new authoring entry. Status/cancel tools remain deferred. |
| Mind | Completed or blocked safe summary only through existing projections. No document body, source text, prompts, or provider payload becomes Mind state. |
| Memory | No raw document persistence. Existing tenant-relative memory may retain an owner-approved preference only through its current governed path; this capability adds no memory writer. |
| Tenant knowledge | Tenant-resolved templates, brand facts, and approved business facts may ground the brief. All retrieval remains tenant-relative and untrusted content never becomes instruction. |

Tenant and user identity are resolved server-side at acceptance and revalidated at each execution
step. Client-passed tenant, actor, role, approval, or scope data is context only, never authority.

### Pre-edit capability routing decision

1. **Intended owner outcome:** ask once for a substantial private draft, leave or disconnect, and
   later recover the same verified document artifact without duplicate generation.
2. **Domain owner:** Vibe / creative owns the draft artifact path; the Long-Form lane owns its durable
   execution. The Agreements lane exclusively owns promotion into a signable agreement.
3. **Harness / Gateway dependency:** Layer A governance, the canonical durable-work substrate, the
   existing model router, canonical artifact writes, Layer F receipts, and existing chat-turn
   persistence. The durable substrate is `SUBSTRATE PROVEN`; deployed disconnect survival remains
   unproven. No parallel scheduler, lease, model router, artifact store, or receipt stream is added.
4. **Spine capability:** no document entry exists in `PAIGE_SPINE_CAPABILITIES`. The existing chat
   tool is `document_generate`; the existing status projection is `documents.create`. Platform Reach
   must register the existing authoring capability before shipment.
5. **Provider / connection:** native private Paige artifact; no tenant provider connection is
   required. Model generation stays behind the existing model router. Native artifacts are outside
   the Integration Capability Registry under rule R5, so no provider entry is invented.
6. **Approval / budget / autonomy:** `document_generate` remains `ordinary`, with a create/draft
   mutation and its server-resolved Trust Compass lane. The existing one approval gate remains the
   only gate. Authoring does not grant send, share, sign, publish, or file authority.
7. **Durable job / event:** required. It extends `paige_durable_work` and its transition/lease
   contract. Recovery may use the platform's existing scheduler infrastructure, never a second job
   system or claim implementation.
8. **Readback / receipt / Rail:** exact tenant-scoped `marketing_content` readback plus the persisted
   completion turn must match before `succeeded`. Every submit/resumed invocation and settlement
   emits `record_capability_run`, correlated by work id. No readback means no success claim.
9. **Visible surface / ledger:** `paige.workspace`, currently `PARTIAL`. This change reuses its
   existing transcript and `PaigeArtifactCard`; it does not change the shell or visual system. The
   row stays `PARTIAL` until authenticated runtime evidence discharges the owed proof.
10. **Proof required:** local migration replay, two-worker and retry idempotency tests, reconnect
    reconstruction, cross-tenant negative controls, exact receipt correlation, then persisted
    `db-live`/`edge-live` and authenticated owner create/disconnect/reload/revise/readback evidence.
    Until those deployed checks pass, the capability is `PROOF OWED`, not `LIVE`.

### Owner-intent and changed-flow contract

- **OWNER_INTENT:** Paige accepts one long-form drafting intent, keeps working outside the request,
  and returns one real, openable draft artifact in the same conversation.
- **MUST_NOT_HAPPEN:** no duplicate dispatch on Retry; no empty artifact success; no raw document in
  Mind, Memory, Rail, durable-work status, or authority context; no tenant/user authority from the
  client; no agreement lifecycle write; no implicit send/share/sign/publish; no simultaneous DONE
  and timeout claim.
- **MUST_PRESERVE:** the single Paige workspace, existing artifact card and preview, Studio linkage
  and version behavior, action-risk/autonomy gate, tenant isolation, export separation, transcript
  identity/scroll behavior, and existing synchronous behavior until the tool-schema relay lands.
- **ACCEPTANCE_CRITERIA:** one intent produces one work id, one model dispatch, one verified artifact
  lineage, one completion turn and correlated receipts; disconnect/reload reconstructs it; concurrent
  workers and rapid Retry fail closed; foreign workspace/account reads reveal nothing.
- **VISUAL_DIRECTION:** no new visual treatment. Reuse the incumbent Paige artifact card and thread
  layout exactly; only persisted data begins reconstructing the already-approved card after reload.
- **MOTION_PURPOSE:** none added or changed.

Changed-flow map (the existing inline conversation remains the container):

| From | Trigger / guard | To | Durable feedback | Recovery / exit |
|---|---|---|---|---|
| Request | bounded valid brief; server resolves tenant/user/thread | Accepted | persisted work reference; safe working summary | close or disconnect without cancelling |
| Accepted | one worker owns the claim | Authoring | server state only; no fake progress percentage | lease heartbeat; reconcile before retry |
| Authoring | verified artifact + completion-turn readback | Complete | existing artifact card in the thread | open, revise, export, or leave |
| Any active state | required fact or current approval absent | Blocked | named safe reason | provide fact/approval; resume same work id |
| Any active state | ambiguous provider/persistence boundary | Outcome unknown | no success claim | reconcile by work/artifact identity before retry |
| Reload / reconnect | authenticated thread load | Current persisted state | same work/artifact identity | foreign/stale workspace fails closed |

## 3. Owner flow

1. **Ask.** The owner asks Paige for an agreement, proposal, SOP, report, or revision.
2. **Resolve specifics.** Paige uses existing tenant knowledge and asks only for material missing
   facts. She does not submit placeholders such as `[CLIENT NAME]`, `[DATE]`, or `[AMOUNT]`.
3. **Accept once.** The server validates a compact document brief, resolves tenant/user/thread and
   creates or resumes one durable work row from the client intent id. Chat immediately receives a
   persisted work reference rather than waiting for the document body.
4. **Show progress.** A work card reconstructed from `paige_chat_turns.bundle_ref` reads the safe
   status projection. Disconnecting the browser does not cancel or orphan server work.
5. **Claim once.** The existing orchestration runner claims through the canonical transition RPC.
   A competing worker fails closed. No model call begins before claim ownership is established.
6. **Author.** The worker calls the existing model router with the compact brief and bounded tenant
   context. Generated blocks are treated as candidate data and validated by the existing block and
   placeholder guards before persistence.
7. **Persist and verify.** Create or guarded-revise the canonical `marketing_content` document,
   append existing version lineage where applicable, read it back, and only then settle the work as
   `succeeded` with `verified_readback=true` and identifiers—not raw content—in terminal outcome.
8. **Return the artifact.** Persist a safe artifact reference into the originating turn bundle.
   Connected clients may also receive a live frame, but correctness never depends on that frame.
9. **Revise.** A revision is a new work identity targeting the existing document and an expected
   version. It updates the same artifact lineage; it never creates a hidden parallel document.
10. **Export or send.** Export continues through `export-document`. Sending, publishing, signing,
    or sharing is a separate consequential capability and never follows implicitly from authoring.

## 4. Proposed bounded tool contract

The current tool makes the interactive model author every block inside a potentially enormous tool
argument. That is the wrong boundary for durable execution. Preserve the user-facing intent and
artifact format, but move authoring behind the work envelope.

### Submit (`document_generate`, evolved through the relay)

Inputs are a bounded brief: client intent id, document type, title or goal, audience, purpose,
required facts, tenant-approved source references, optional existing `content_id` plus expected
version for revision, optional export format, and originating thread. It does **not** accept the
full generated block array from chat.

Returns immediately: work id, `claimed`/`blocked` safe state, whether an existing intent resumed,
and a safe summary. It does not return the document body.

### Status (provisional name `document_work_status`)

Observe-only. Reads the allowlisted durable-work projection plus an artifact reference only after
verified persistence. It never exposes authority context, idempotency key, prompt, raw model output,
or cross-tenant existence.

### Cancel (provisional name `document_work_cancel`)

Server-authorized internal state transition. It can prevent undispatched work or request cooperative
cancellation of a claimed authoring step. It cannot claim that an already-dispatched provider call
was stopped; an ambiguous interrupted effect becomes `outcome_unknown` and reconciles.

The tool name, risk class, autonomy resolution, and chat governed-execution route already exist and
remain unchanged. Platform Reach owns the missing Spine declaration and the in-place input/return
schema edit described above. This lane will not pre-build a parallel registration or runtime.

## 5. Artifact and revision rules

- `marketing_content` remains the canonical document store; no `paige_documents` table is added.
- Raw blocks never live in `paige_durable_work`, Mind, Rail payloads, or chat status summaries.
- A terminal work outcome may hold only identifiers, hashes, counts, format, and
  `verified_readback=true`.
- Revision must use an expected-version compare-and-set or equivalent row lock. Two simultaneous
  revisions cannot silently overwrite each other; one wins and the other becomes `blocked` with a
  named version conflict requiring owner resolution.
- Existing `studio_artifact_versions` remains the version home for Studio-bound documents. A
  non-Studio chat document cannot write that table without fabricating a Studio session, so guarded
  revisions retain at most 20 prior bodies in the same canonical artifact row's
  `meta.document_versions`. That is per-artifact history, not a parallel work or artifact identity.
- Export failure does not erase a successfully authored document. Authoring may succeed while an
  optional export records its own failed or `outcome_unknown` receipt.

## 6. Approval and legal-content boundary

Authoring a private in-workspace draft is reversible internal work. It does not authorize sending,
publishing, signing, filing, or presenting the document as legal advice. Each later consequential
step redeems its own current exact-call approval immediately before dispatch.

If such approval expires before dispatch, the same work becomes nonterminal `blocked` with
`approval_expired`. The stored authority snapshot is audit evidence, never permission. If dispatch
already occurred and the result is ambiguous, the state is `outcome_unknown`, followed by
reconciliation before retry.

For legal agreements, governing-law language is not evidence that the document is legally adequate.
Until governed research is available, Paige may use an owner-approved template or create an
explicit attorney-review draft from owner-provided facts. She must not invent current statutory
requirements or imply counsel reviewed it.

## 7. Failure and resume semantics

| Condition | State and owner-visible meaning |
|---|---|
| Required fact missing | `blocked`; names the missing owner input |
| Approval required but expired before dispatch | `blocked / approval_expired`; fresh approval resumes the same work id |
| Worker loses lease before provider dispatch | `expired`; reconcile claim state, then safely reclaim |
| Provider may have produced output but receipt/persistence is uncertain | `outcome_unknown`; reconcile by work id/hash before retry |
| Deterministic validation/provider failure within ceiling | retry same work id while attempts remain; terminal `failed` only at the declared ceiling |
| Artifact persisted and exact tenant-scoped readback matches | `succeeded`; return the existing artifact card |
| Owner cancels before effect | `cancelled`; no artifact-success claim |

Retry from the chat UI always carries the original client intent id. It resumes or reports the same
work; it never silently submits four new generations for one owner intent.

## 8. Acceptance evidence before shipping

1. Capability-kit and registry relay accepted; no parallel registration path.
2. Full migration replay and persisted `db-live` evidence for the envelope and document additions.
3. Two-worker claim proof remains green in CI/local evidence.
4. Disconnect browser after acceptance; worker completes; reload reconstructs the same work and
   artifact card from persisted thread/work state.
5. Four retries with one intent produce one work id, one provider dispatch, one artifact lineage,
   and one terminal receipt.
6. Concurrent revision race produces one committed revision and one visible version conflict—no
   lost update.
7. Cross-tenant work, thread, artifact, revision, status, and export reads fail closed.
8. Every invocation emits `record_capability_run`; terminal success is impossible without verified
   artifact readback.
9. Authenticated owner proof covers create, progress, disconnect, resume, revise, export, cancel,
   retry, abandonment, account switch, and unavailable/error states.
10. The captured production `400` field is diagnosed and regression-tested directly; no telemetry
    work is added unless that evidence remains insufficient.

## 9. Deliberately deferred

- A truthful Spine action authority enum for the existing Studio-session auto-build lane. Until
  ratified, the registry explicitly carries no action rather than falsely declaring chat approval.
- Any future status or cancellation tool entry and its exposed semantics.
- Platform-wide catalogue generation, eligibility resolution, and specialist delegation. Platform
  Reach owns that broader convergence; it does not block the Long-Form integration.

No new authoring tool is required. Durable submission, worker execution, verified artifact
persistence, and reconnect reconstruction proceed behind the existing `document_generate` identity.
