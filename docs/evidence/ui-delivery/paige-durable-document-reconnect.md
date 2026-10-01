# UI delivery evidence: Paige durable document reconnect

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded flow, collision map, state transitions, proof boundary, and ownership line are recorded in `docs/brain/paige-document-production-plan.md`
PAIGE_UI_DESIGN: PASS: project `paige-ui-design` skill and all mandatory foundations/modules were read before the shared chat projection changed; the incumbent artifact card, transcript layout, tokens, and interaction were preserved
MATERIAL_FLOW_CHANGE: NO: this is a persistence correction to an existing completion state — the same existing artifact card now reconstructs from the completion turn after reload; no goal, choice, action, layout, exit, or consequence is added
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow or visual design changes; the already-shipped artifact-card interaction is reused byte-for-byte and only its persisted input projection changes
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tenant owner/admin asks Paige for a long-form draft and later opens the same verified artifact from the same conversation; Open remains the primary card action and Send remains host-delegated
VISUAL_DIRECTION: PASS: no new visual direction; existing Paige transcript and `PaigeArtifactCard` are the approved surface
AUTOMATED_EVIDENCE: PASS: `npx vitest run src/__tests__/document-production.test.ts src/__tests__/paige-durable-work-envelope.test.ts src/components/dashboard/PaigeAIChat.clientScope.test.tsx` — 3 files, 27 tests passed; reconnect test proves persisted `bundle_ref.paige_artifact` reconstructs with the stored tenant and id
STATIC_EVIDENCE: PASS: migration-version lint passes (1075 unique); app typecheck matches the documented 12-error trunk baseline with zero introduced; repair `d247abba47e386fa7426179a52c449550c41f7c4` gives zero-diagnostic real Deno checks for the shared router, existing document export consumer, and new durable document worker
RENDERED_EVIDENCE: UNVERIFIED: no deployable, authenticated document completion exists until the Reach-owned Spine/schema relay and PH-EVIDENCE-21 land; no screenshot is presented as proof of an unavailable end-to-end state
BEHAVIORAL_EVIDENCE: PASS: DOM regression mounts the real shared Paige chat, reloads a stored assistant completion turn, and observes the existing artifact-card boundary with the persisted artifact id and tenant scope
AUTHENTICATED_RUNTIME: UNVERIFIED: no production write or deployment was authorized; durable submission, provider completion, authenticated artifact hydration, disconnect/reload, account switch, and revision remain proof owed after registry integration and persisted apply
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus order, focus target, or keyboard behavior changed
ZOOM_REFLOW: NOT_APPLICABLE: no markup geometry, sizing, scroll owner, or layout class changed
REDUCED_MOTION: NOT_APPLICABLE: no motion was added or changed; the existing artifact card retains its shipped reduced-motion behavior
STATE_COVERAGE: PASS: local PostgreSQL 16 proof covers accepted/replayed, duplicate dispatch, succeeded with verified readback, version-conflict blocked, authority-change blocked, missed-wake recovery, ambiguous post-dispatch reconciliation, cross-tenant refusal, and receipt-failure rollback; DOM covers reconnect reconstruction
TRUTHFUL_STATE_LABELS: PASS: durable substrate remains `SUBSTRATE PROVEN`; this candidate is not called LIVE, deployed, or production-proven; agreement-shaped output is labelled an attorney-review draft artifact only
SOLO_UI: NO: the changed code is the shared transcript data projection and existing artifact type/label; no Solo shell, route, navigation, form fit, or viewport geometry changes
UNVERIFIED: Reach-owned Spine declaration and existing-tool schema evolution; governedExecution integration and per-invocation receipt; full migration replay; `db-live`/`edge-live`; authenticated create/disconnect/reload/revise/export/account-switch evidence; owner 45-second verification; captured production 400 field diagnosis

OWNER_INTENT: Paige accepts one long-form drafting intent, keeps working outside the chat request, and later returns one real openable draft artifact in the same conversation without duplicate generation
MUST_NOT_HAPPEN: duplicate dispatch on Retry; empty-artifact success; raw document content in Mind/Rail/work status; client-supplied authority; agreement lifecycle writes; implicit send/share/sign/publish; DONE plus timeout contradiction
MUST_PRESERVE: one Paige workspace; existing artifact card and preview; tenant scoping; transcript identity and scroll behavior; current approval/autonomy path; Studio-bound versioning; agreements-lane ownership of signable agreements
ACCEPTANCE_CRITERIA: one intent yields one work id/model dispatch/artifact lineage/completion turn/correlated receipt; exact readback precedes success; reload reconstructs the card; concurrent/replayed work fails closed; foreign tenants learn nothing
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: transcript hydration and tenant-scoped artifact handoff changed and are tested; composer focus, scroll anchoring, confirmation cards, extraction proposals, approval gate, artifact Open/Send behavior, and Solo geometry remain unaffected

INTERNAL_BUILD_IDENTITY: fc85bcffdc40d96e956f2d7251b87df291b51cd0; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(db-live-after-merge); edge=PROOF_OWED(edge-live-after-merge); evidence=npm-run-proof-paige-durable-document
RELEASE_CHANNEL: development: local candidate only; owner go-live approval not requested and no staged exposure exists
RELEASE_CLASSIFICATION: patch: durable recovery corrects the existing document handoff without releasing a new customer version from this branch
CUSTOMER_RELEASE_IDENTITY: none: pre-review local candidate and capability remains PROOF OWED
RELEASE_NOTE_REQUIRED: yes: when shipped, document authoring becomes durable and returns a recoverable draft artifact; agreement promotion remains separate
RELEASE_TRUTH_BOUNDARY: PROOF OWED: shared envelope is `SUBSTRATE PROVEN` and Phase 2 local transaction/DOM proof passes; Edge build, registry reach, deployment, persisted apply, and authenticated runtime remain unproven
RELEASE_RECOVERY: position=forward-fix before release; reference=canonical durable-work outcome_unknown/reconciliation contract and unchanged synchronous tool until registry relay

## Scope and collisions

- Classification: shared Paige chat persistence correction plus durable document backend candidate.
- Affected flows: document submit/claim/author/persist/revise/recover; stored completion-turn hydration into the existing artifact card.
- Neighboring regressions: ordinary chat history, confirm cards, CRM result cards, extraction proposals, Studio document loading/export, agreement lifecycle ownership.
- Active-owner/file collisions: Platform Reach exclusively owns Spine and chat-tool registration; Platform Health owns PH-EVIDENCE-21; Agreements owns signable agreement lifecycle. None of those owned registry/lifecycle surfaces were edited.
- Explicit exclusions: status/cancel tools, agreement promotion/signing, deep research, browser access, production apply/deploy, credentials, provider calls.

## User job and state map

The owner asks once, receives an accepted durable identity, may disconnect, and later sees the same existing artifact card after verified completion. Safe server states are claimed, blocked, expired/reclaimed, outcome_unknown/reconcile, failed, cancelled, and succeeded only after artifact plus transcript readback and receipt. Closing the chat never claims cancellation; Open remains the existing artifact exit.

## Evidence index

- `npm run proof:paige-durable-document` — disposable PostgreSQL 16 migration and lifecycle proof, PASS.
- `npm run proof:paige-durable-work` — real two-worker race, exactly one winner, PASS.
- Focused Vitest command above — 27/27 PASS.
- `npm run lint:migration-versions` — 1075 migrations, no version collision, PASS.
- Impeccable post-edit detect on `src/components/dashboard/PaigeAIChat.tsx` — `[]`, no finding.
- `npx tsc --noEmit -p tsconfig.app.json` — 12 known trunk diagnostics, exact candidate count 12, zero introduced.
- Real `deno check --allow-import --node-modules-dir=none` — zero diagnostics for `_shared/model-router.ts`, `export-document/index.ts`, and `paige-document-worker/index.ts` after repair `d247abba47e386fa7426179a52c449550c41f7c4`.

## Review and limitations

No independent review, preview, deployment, authenticated tenant drive, production provider generation, or persisted apply has occurred. The worker is intentionally unreachable from `document_generate` until Platform Reach supplies the missing Spine declaration and in-place tool-schema relay. The local evidence proves the transaction and reconstruction mechanics, not production durability.
