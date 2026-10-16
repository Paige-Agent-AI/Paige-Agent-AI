# ANT-21 — current task versions through the existing Chat read

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: ordinary eligible SOLO owner lists native CRM tasks, reads the current optimistic version, and submits the exact task update/completion through the existing caller-JWT CRM door
PAIGE_UI_DESIGN: PASS: project UI routing and protected-behavior guidance applied; shared backend read projection/model-facing guidance only, with no visible component, layout, control, interaction container or motion change
MATERIAL_FLOW_CHANGE: NO: repair the existing task-read and native-command connection without adding a user flow or authority
FLOW_PROTOTYPE: NOT_REQUIRED: no new control, step, confirmation, navigation or permission
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: all eligible existing and future SOLO owners can request an existing task correction/completion using current native data rather than a guessed version
VISUAL_DIRECTION: NOT_APPLICABLE: existing Chat and Operations presentation is unchanged
AUTOMATED_EVIDENCE: PASS: 15 actual Chat/native-CRM-handler cases and 26 unchanged CRM read-binding baseline/mutant controls pass; initial failing-first run reproduced 7 failures among 13 cases; native SQL execution port is synthetic
STATIC_EVIDENCE: PASS: scoped new-script ESLint and git diff whitespace check; no writer, migration, credential, provider, registration, CI/extractor or source-pin edits
RENDERED_EVIDENCE: UNVERIFIED: no authenticated rendered task drive performed by this isolated implementation worker
BEHAVIORAL_EVIDENCE: PASS: normal interactive browser-shaped request executes the actual Chat handler and actual crm-command validation/authority handler; selected-column/status/tenant table fixture refuses unrestricted columns and omits unselected data
AUTHENTICATED_RUNTIME: UNVERIFIED: root lead owns governed activation, production source readback and ordinary authorized task execution/readback/reload; this worker makes no production call
KEYBOARD_FOCUS: NOT_APPLICABLE: no keyboard, focus or frontend implementation change
ZOOM_REFLOW: NOT_APPLICABLE: no geometry, viewport, scrolling or typography change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: default open selection; exact pending/completed/in_progress/cancelled; explicit all; current-version completion/update; legacy created_at fallback; missing/invalid version; native stale-version refusal propagation without retry; member denial; workspace-change refusal; foreign-tenant exclusion
TRUTHFUL_STATE_LABELS: PASS: source fixture success is not production execution, native SQL proof, deployment, Live restoration or owner acceptance; no version is invented and native authorization/version checks are unchanged
SOLO_UI: YES: the composed task-management PR also repairs SOLO task links and legacy routing; this read-only binding adds no geometry change
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport certification at this source checkpoint
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated viewport certification at this source checkpoint
UNVERIFIED: native full-schema pgTAP execution, hosted exact-head CI, root integration of source fingerprints, production deployment/activation/readback, ordinary authenticated Chat/Live outcomes, reload/recovery and final owner product acceptance
OWNER_INTENT: restore the original 18 historical capabilities and 50 parity findings for all eligible current/future SOLO accounts through canonical shared architecture; this increment repairs task read/version availability
MUST_NOT_HAPPEN: no stale or missing version may grant mutation authority; no tenant-specific branch, second task engine, writer change, guessed contact relationship or provider effect
MUST_PRESERVE: omitted status still excludes completed; exact status filters, tenant binding, caller role, stored approvals, native replay/version guards, original task records and existing receipts remain authoritative
ACCEPTANCE_CRITERIA: an authorized ordinary SOLO owner can find a protected existing task, correct or complete it using current readback, see the native task/receipt after reload, and receive truthful refusals for stale/missing versions or changed workspace
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: PASS: affected tenant/workspace scope, native task readback/version data, Spine consumption, approval/authority and privacy boundaries tested with protected module fixtures; authentication/account selection implementations, entitlement/provisioning/billing, canonical writers, Rail/audit/Memory writers, transcript/stream/history, Live implementation, Secure Browser/Vault, providers/external effects, durable scheduler/retry engine, responsive geometry and accessibility implementations not changed; corresponding customer/runtime claims remain unverified
INTERNAL_BUILD_IDENTITY: 5b01be1b039e4999db0bbbc8ab4c0d8a673bc03f isolated-worktree base; candidate commit supplied to root after local proof; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(root governed source release); evidence=docs/evidence/ui-delivery/ant21-chat-task-read-versions.md and scripts/int336-crm-task-read-check.mjs
RELEASE_CHANNEL: development: isolated implementation and protected fixtures only
RELEASE_CLASSIFICATION: internal-only: bounded existing task-read repair pending root review/release
CUSTOMER_RELEASE_IDENTITY: none: no deployed customer outcome is claimed by this worktree
RELEASE_NOTE_REQUIRED: no: this worker does not publish a release or announcement
RELEASE_TRUTH_BOUNDARY: PROOF OWED: actual native records/receipts, ordinary authenticated Chat and Live, exact deployment, tenant isolation and owner acceptance remain root's outcome requirements
RELEASE_RECOVERY: position=reviewed forward fix preserving canonical task records and version/approval gates; reference=docs/evidence/ui-delivery/int346-interactive-issuance.md and supabase/tests/governed_crm_commands.sql

## Defect and bounded correction

`crm_list_tasks` omitted `updated_at` and `created_at`, although every native task update, assignment, reschedule, completion, reopen, cancellation and deletion requires an exact expected timestamp. An old create acknowledgement cannot replace a new read of an existing task. The handler now selects both fields and the existing tool describes the same `updated_at ?? created_at` rule already used by Operations and the SQL writer. Missing or malformed timestamps still fail the actual CRM request schema; stale values still reach the unchanged native version refusal.

The existing tool advertised `status: all`, while its query treated that explicit selection like an omitted status and removed completed rows. Explicit all now omits the status predicate; omitted status retains the previous open-task predicate and the four exact statuses retain their equality predicates. Other task filters, bounds and ordering are unchanged.

Only the task-read tool description and its existing dispatch branch change in product source. No task writer/migration or contact-task join changes. Native CRM still explicitly rejects a direct contact task link; the separate contact-summary `biz_id` issue is not absorbed into this slice. Portal #2233 and pending Sales #2191/#2192 sources are untouched. Root owns shared CI/guard fingerprints and release integration; this worker changes neither.

## Local evidence and limits

- `node --import ./scripts/knowledge-scope/register.mjs scripts/int336-crm-task-read-check.mjs`: initial actual-source run 7 FAIL / 6 PASS; corrected source 15 PASS. The model fixture obtains commands only from the handler's real tool-result data. Its table callback honours the actual selected columns plus tenant/status filters. It invokes the actual CRM function with real Zod and Gateway decisions. External database/provider calls remain doubles; injected SQL stale refusal proves forwarding, not SQL implementation.
- `node --test scripts/ci/c0b-crm-read-binding.test.mjs`: 26 PASS, including tenant filter removal, write/provider injection and scope-guard mutants; no guard edit.
- Scoped `npx eslint scripts/int336-crm-task-read-check.mjs` and `git diff --check`: PASS.
- Seven focused CRM/Operations Vitest files: 116 PASS / 1 FAIL among 117 in both the initial fork run (44.65s) and bounded one-thread rerun (9.04s). The sole failure is the inherited literal invocation assertion at `crm-command-chat-adoption.test.ts:266`, which still expects the CRM body before the predecessor's `expected_tenant_id` insertion. This slice does not touch that invocation. Root was notified to reconcile its predecessor assertion. During the apparent fork stall, only this worktree's verified controller/workers were stopped; final session readback showed that the initial run had reported the same 117 results, superseding the preliminary NOT_RUN description.
- `supabase/tests/governed_crm_commands.sql`: eight added native assertions, plan 160, covering exact update/completion, stale refusal/no status change, required version, replay, foreign task denial and an existing-record created_at fallback. Full-schema execution NOT_RUN locally; this file is executable proof owed to root's normal database CI, not an asserted result.

The fixture uses only neutral synthetic actors/tenants and no secrets. No account is special-cased, created or impersonated. Existing and future accounts use the same shared read and native provisioning; there is no new schema or backfill. Binding-ledger rows `paige.workspace` PARTIAL and `operations.department` PROOF_OWED are not promoted by this repair. The original 18-capability and 50-row registers retain their full outcome, isolation and new-account proof requirements. Chat testing does not establish Live completion.

## Lead integration before release

Distinct in-project CRM reviewer inspected immutablea294aa4e2dd6e0004913ea5531a4f7815f9d89cc: NON-AUTHOR PASS/no material findings, independently running15 actual-handler cases and26 unchanged read-binding/mutant controls. NativeSQL remains explicitly NOT_RUN locally. The predecessor static expectation correction from3a6649014943f55427749c44ba87e94dfb2f5e6a is retained in this branch; its22-test file passed in the lead checkout without changing runtime.

The lead adds the new handler script to the existing INT336 CI step and renews only29 reviewed fingerprint scalars plus explanatory comments. The unchanged extractor includes the full outer-handler ancestry, so the three reviewed task-reader lines affect all29 digests; metadata, helpers, extraction and negative controls remain unchanged. All59 incumbent restrictive controls,15 task-handler cases and214-capability Spine registry guard pass after this bounded renewal. An initial invocation of a nonexistent lint filename was corrected to the actual existing registry lint; no missing-file run counts as proof. Final immutable composition review, exact-head CI/nativeSQL, merge/deployment, ordinary authenticated action/reload and owner acceptance remain required.

## Coherent task-management integration

Actual ordinary production creation under released #2234 exposed two task-result defects: an approval
summary reading the wrong title shape and the obsolete task address opening the booking calendar.
The separately reviewed task-title0ee4378 and locatorb1d80a7 repairs are integrated into this same
task-management PR. Both distinct NON-AUTHOR source reviews passed. Existing exact stored arguments,
approvals, native writers, tenant authority and uncertain-outcome handling remain unchanged.

The merged source retains all29 task-reader adapter digests and adds only the one independently
reviewed canonical URL dependency digest. The combined15 task-reader cases,87 tests across the four
changed contract/router suites and59 restrictive controls PASS. The isolated locator review also
passed24 actual native-handler checks and167 tests across12 suites. One local Vitest invocation
used an unsupported older CLI flag and ran no tests; the corrected command used this installed
version's documented options and passed. No failing invocation is counted as proof.

The normal dependency resolver identifies16 affected Edge functions, including Chat, CRM and the
native notification/link consumers. Stripe Connect is not affected; its verified13 deployment and
security configuration remain preserved. Shared URL tests keep non-SOLO destinations unchanged.
This composition owes exact final-head CI, eight native SQL assertions, controlled release,
ordinary authenticated title/update/completion/navigation/readback/reload and separately proven Live.
