# Task assignment truthfulness — bounded source candidate

Candidate `bea2c2023a2234f9ad764c0ce21b46ff1f83ba86`, parent
`fece02e6682096f007e568377b7baa2e04285d9d`, branch `fix/ant21-task-assignment-truth`.
Seven leased files, +92/-17. No push, PR, deployment, native SQL write, provider call or production QA.

## Native source contract and repair

`20271108121000_task_progress_contract.sql:364–365` defaults omitted, JSON null or exact empty
`task.create.patch.assignee_user_id` to the native actor. Lines368–372 authorize the selected user;
lines387–389 persist `tasks.user_id`. Tasks cannot be unassigned. By contrast, lines443–453 require
an explicit authorized UUID for `task.assign`; omission/null/empty do not default on reassignment.
This candidate changes none of those native contracts.

`crm-command/index.ts:179` now receives the authenticated server actor for display only. Creation
discloses requester defaults; explicit canonical UUIDs identify you or the exact user UUID without
invented names or an extra lookup. Unknown/malformed input is not presented as a fictional person
or an unassigned task; the native writer retains format/authorization decisions. Reassignment
always names the actual task_id, unaffected by unrelated contact/company fields. No stored argument,
key, fingerprint, policy, claim, execution payload, readback, receipt or ACL changes.

The existing catalog and generator annotation now explain native defaults and tell the model to
clarify explicit unassigned intent before proposing. Leading catalog action labels stay unchanged.
Generator output changes only one description; all seven allowlists and generated SQL are unchanged.
There is no new Planning path, state, store, authority, provider, account fork or executor.

## Fresh proof

- Original 51 actual-handler approval checks PASS before edits.
- Failing-first real handler assertion: old `Create a task "Review the fixture plan".` lacks the
  required `assigned to you`. A direct actual emitted catalog assertion separately failed because
  the native requester-default guidance was absent.
- Final 82 actual CRM approval-summary checks PASS: all original51 plus31; omitted/null/empty,
  explicit actor/other, two neutral workspace contexts, malformed targets, actual task identity,
  exact default-shaped approval redemption despite assignee substitution, native readback unchanged.
- 122 tests in9 incumbent CRM suites PASS, including two added generated-schema tests with real AJV.
- 1103 full client-memory/authz assertions PASS, zero failures.
- 22 actual Chat contact-work read controls PASS, using its correct client-memory loader.
- Generated field guard PASS and12 generator negative/positive self-tests PASS.
- Actual emitted-provider-tool contract9 PASS; action-risk189 classified, zero unclassified writes.
- All7 edited files ESLint0 errors/0 warnings; Node parsing, whitespace and Impeccable detector PASS.
- Actual restrictive validator:98 dependency/ancestry entries,29 tools, zero findings; none of the7
  edited paths is pinned. Chat and physical source contract remain byte-identical to parentfece.
  No dispatch or dependency renewal is needed and no pin was changed.

Initial Vitest attempt ran zero tests because sandbox TEMP rename returned EPERM. A task-local
TEMP/TMP directory resolved it; the fresh9-suite run passed. One contact-work invocation used the
wrong loader and failed before serve capture; the correct incumbent loader then passed all22.
No tooling failure is represented as a product assertion or native database proof.

Reproduce with the existing bundled Node and installed dependencies:

```text
node --import ./scripts/knowledge-scope/register.mjs scripts/crm-approval-summary-check.mjs
node --import ./scripts/client-memory-authz/register.mjs scripts/crm-contact-work-summary-check.mjs
node --import ./scripts/client-memory-authz/register.mjs scripts/client-memory-authz/check.mjs
node --import ./scripts/client-memory-authz/register.mjs scripts/ci/paige-chat-tool-contract-check.mjs
node scripts/ci/crm-patch-field-gen.mjs
node scripts/ci/crm-patch-field-gen.mjs --self-test
node scripts/ci/action-risk-lint.mjs
node node_modules/vitest/vitest.mjs run src/__tests__/crm-patch-field-schema.test.ts src/__tests__/crm-command-contract.test.ts src/__tests__/crm-command-edge-contract.test.ts src/__tests__/crm-command-chat-adoption.test.ts src/__tests__/crm-approval-door-wiring.test.ts src/__tests__/crm-capability-run-contract.test.ts src/__tests__/crm-contact-work-summary.test.ts src/__tests__/crm-contact-refs.test.ts src/__tests__/crm-approval-resolution.test.ts --reporter=dot
```

## Sanitized UI-evidence handoff for root integration

The lease authorized exactly the seven source/test files, so this untracked local record supplies
the evidence for root's normal committed UI-delivery record before PR preparation. The source commit
declares `Visible-Flow-Impact: yes`. It is a source candidate, not release authority.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing task proposal, approval, native assignment and readback traced before copy repair.
PAIGE_UI_DESIGN: PASS: project skill and applicable owner-intent/protected-behavior/evidence references read; existing card preserved.
MATERIAL_FLOW_CHANGE: NO: correct existing tool guidance and approval consequence text; no new action/state/exit/consequence.
FLOW_PROTOTYPE: NOT_REQUIRED: exact copy correction restores the existing native assignment contract.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible customer can understand who will own proposed native task work before approving.
VISUAL_DIRECTION: PASS: retain the existing Chat approval card, typography, layout, controls and navigation.
AUTOMATED_EVIDENCE: PASS:82 actual approval checks;122 CRM tests;1103 authz;22 contact-work;12 generator;9 emitted-tool controls.
STATIC_EVIDENCE: PASS: seven allowlists/native SQL unchanged; all7 edited files lint clean; whitespace clean;98/29 source validator zero findings.
RENDERED_EVIDENCE: UNVERIFIED: no browser screenshot or viewport run; strings were exercised through actual handler fixtures.
BEHAVIORAL_EVIDENCE: PASS: actual served handler and native-command port over protected synthetic SDK/SQL responses; no real database claim.
AUTHENTICATED_RUNTIME: UNVERIFIED: no ordinary authenticated unassigned-intent clarification, task mutation or approval-card QA performed.
KEYBOARD_FOCUS: NOT_APPLICABLE: no keyboard, focus owner, control or DOM change.
ZOOM_REFLOW: UNVERIFIED: no rendered long-copy/zoom review; geometry and existing wrapping unchanged in source.
REDUCED_MOTION: NOT_APPLICABLE: no animation change.
STATE_COVERAGE: PASS: requester default, explicit actor/other target, malformed/missing reassignment, exact approval arguments, claim/replay/role/tenant negatives retained.
TRUTHFUL_STATE_LABELS: PASS: proposals describe intended assignment; no unassigned or completed-work claim from a proposal.
SOLO_UI: YES: shared task guidance and native approval summaries apply to all eligible current/future SOLO accounts through existing authorization.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no rendered review.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no rendered review.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no rendered review.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no rendered review.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no rendered review.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no rendered review.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no rendered review.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no rendered review.
OWNER_INTENT: reveal native requester assignment and require clarification for explicitly unassigned work without changing native defaults.
MUST_NOT_HAPPEN: no promise of unassigned work, fictional assignee, native contract narrowing, hidden assignment, new permission or Planning substitution.
MUST_PRESERVE: native arguments/fingerprints/claims/writer/readback/roles/workspace scope and all prior reviewed Chat/CRM/P0/recovery source.
ACCEPTANCE_CRITERIA: new proposals state the native target/default truthfully; ordinary explicit-unassigned Chat asks for clarification before any proposal; authenticated proof remains owed.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: approval display affected and tested; tenant/actor/role/execution/replay regression tested. Native writes/readback/receipts/audit semantics, auth/account choice, billing/provisioning, Memory, Chat transcript/stream/hydration, Live, Browser/Vault, providers, jobs, shell geometry, accessibility mechanics and secrets unchanged.
INTERNAL_BUILD_IDENTITY: bea2c2023a2234f9ad764c0ce21b46ff1f83ba86; deployment=NO; environment=local synthetic; migrations=NOT_APPLICABLE; edge=PROOF_OWED(exact crm-command deployment and served-source readback); evidence=this record.
RELEASE_CHANNEL: development: isolated source candidate, no customer activation.
RELEASE_CLASSIFICATION: patch: existing task consequence-copy correction.
CUSTOMER_RELEASE_IDENTITY: none: root owns integration, review, CI and any release decision.
RELEASE_NOTE_REQUIRED: no: isolated candidate with no customer release claim.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ordinary unassigned-intent clarification, rendered/authorized UI, native runtime, exact-head CI, deployment and acceptance.
RELEASE_RECOVERY: position=rollback: revert only this bounded source commit; no data/schema correction required.
UNVERIFIED: distinct Independent Review, exact-head CI, native SQL execution, rendered/browser/accessibility review, ordinary customer clarification and approval, deployment and owner acceptance.

## Review bounds

AUTHOR-REVIEW / LOWER ASSURANCE: fresh final diff inspected against owner scope and exact native
create-vs-assign semantics; no material finding retained. Distinct final review is pending with root.
No existing pending-card summary or historical task was backfilled. Previously persisted approval
summaries retain their existing immutable recovery behavior. No global pin/source metadata changed.

Impeccable clarify/copy accuracy and action-consequence checks were applied, detector passed; no
rendered finish claim. Context reported the existing DESIGN.md sidecar stale; it was not repaired
outside this lease. Canonical skill source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md.

## Root integration before release

RELEASE_RECOVERY: position=reviewed forward copy correction or revert of the task guidance and approval summary only; reference=supabase/functions/crm-command/index.ts and supabase/functions/_shared/crm-command/catalog.ts, preserving native task records and all command authorization/receipt contracts.

The bounded source bea2c2023a2234f9ad764c0ce21b46ff1f83ba86 received distinct Independent Review PASS from approval_postcommit_review. The exact reviewed model/recovery head28555691e3d5d3fdb80969babe1255c6127c26a3 was merged cleanly at2beeb1b0fd9c9bb26dfd334d12f1a952be20a59b, adding only the two independently reviewed P0 Research/Live fixture corrections froma2a0e1feb1c1ab1282a2152f96130b3723062aed. Runtime, approved arguments, SQL, source bindings and assignment authority are unchanged by that merge. Final documentation/composition review, exact-head CI and ordinary production clarification/card proof remain owed. Production release and owner acceptance are separate from these local test results.
