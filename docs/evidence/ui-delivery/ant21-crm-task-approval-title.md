# CRM task approval title fidelity

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing task.create command -> canonical CRM door -> governed proposal -> server-held approval -> unchanged stored command; no new flow or executor.
PAIGE_UI_DESIGN: PASS: project UI routing and protected-behavior guidance applied to the existing approval summary; no layout, controls, motion or interaction changes.
MATERIAL_FLOW_CHANGE: NO: repair one incorrect task label using the existing canonical patch; approval states, exits and consequences are unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: existing approval behavior and controls are preserved; no new or materially changed user flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: any eligible SOLO owner or admin sees the actual task title before approving the stored task command.
VISUAL_DIRECTION: PASS: existing confirmation sentence, trim, 80-character display limit and Untitled fallback preserved; no styling change.
AUTOMATED_EVIDENCE: PASS: actual served CRM handler exercised by scripts/crm-approval-summary-check.mjs; 21 protected fixture checks; wired into existing crm-command-edge-contract.test.ts.
STATIC_EVIDENCE: PASS: one production expression changed from top-level command.title to canonical command.patch.title; request schema, authorization, risk, approval fingerprint, stored arguments and writer unchanged.
RENDERED_EVIDENCE: UNVERIFIED: backend summary-only repair; no browser or rendered production claim from this isolated source work.
BEHAVIORAL_EVIDENCE: PASS: actual handler proposes the exact canonical task title and redeems the stored task despite request drift; fixture SQL response is explicitly not real task persistence evidence.
AUTHENTICATED_RUNTIME: UNVERIFIED: ordinary authenticated production approval, native task persistence and receipt QA belong to the integrated release; no production calls made here.
KEYBOARD_FOCUS: NOT_APPLICABLE: existing approval controls and focus behavior unchanged.
ZOOM_REFLOW: NOT_APPLICABLE: no layout or component change; existing 80-character display bound preserved.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: canonical patch title, top-level decoy, trim, truncation, absent/malformed title fallback, correct deal shape, exact stored approval, actor/workspace/reused/forged token negatives, schema and role refusal.
TRUTHFUL_STATE_LABELS: PASS: no capability status or release state promoted; approval_required remains a proposal rather than an execution claim.
SOLO_UI: NO: backend approval-summary expression only; existing SOLO confirmation surface reused without interface changes.
UNVERIFIED: production deployment, existing-account readback, authenticated Chat and Live, native SQL persistence and owner acceptance are not established by this source slice.
OWNER_INTENT: eligible SOLO customers must see and approve the actual business task PAIGE proposes, through existing canonical governance.
MUST_NOT_HAPPEN: changing a command, approval scope, argument hash, risk, entitlement, actor/tenant authority or executor to repair a label; no external effects.
MUST_PRESERVE: correct top-level deal.create title schema, native task patch shape, full stored title, exact approvals and original writer/source ownership.
ACCEPTANCE_CRITERIA: a task proposed through ordinary production Chat displays its requested title; approval executes the stored task once; authentic native record and receipt remain required release QA.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: existing CRM canonicalizer, Gateway decision, confirmation args/fingerprint, server provenance, actor/tenant predicates and native execute command route exercised; no provider or migration changes.
INTERNAL_BUILD_IDENTITY: 8232051a66d5a26446a8ae6dd139743debd0c808 base; candidate=local commit accompanying this evidence; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed crm-command release); evidence=docs/evidence/ui-delivery/ant21-crm-task-approval-title.md
RELEASE_CHANNEL: development: not deployed; root lead owns exact integrated-head release gates and production readback.
RELEASE_CLASSIFICATION: patch: incorrect task approval display repaired; no customer release identity assigned.
CUSTOMER_RELEASE_IDENTITY: none: isolated repair is not a customer release.
RELEASE_NOTE_REQUIRED: no: local source slice; integrated customer wording must follow verified release scope.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: production task approval, execution, Chat/Live and owner acceptance remain UNVERIFIED; only source and fixture verification pass.
RELEASE_RECOVERY: position=forward-fix or revert this display-only expression while preserving approval storage and domain records; reference=this bounded diff against 8232051a66d5a26446a8ae6dd139743debd0c808.

## Root cause and scope

`crm-command` requires `task.create.patch` and the native task writer consumes `patch.title`.
The approval summary incorrectly read top-level `command.title`, producing `Untitled` even
though the stored command was correct. Only that summary expression is repaired. `deal.create`
requires a top-level title and is already correct; regression coverage explicitly preserves it.

This is shared tenant-neutral code for every eligible existing and future SOLO account using
the canonical CRM door. No account IDs, cohort exceptions, provisioning or migration changes
are introduced. Two neutral fixture tenants with owner/admin roles exercise the same code;
they do not establish production account classification or new-account provisioning acceptance.
The original 18-capability and 50-parity registers remain unchanged; this repair closes no
authenticated row by itself. Legitimate roles, autonomy configuration and entitlements remain
the existing domain controls.

## Failure-first and protected proof

- Before the production expression changed, the actual handler returned `Create a task "Untitled".`
  for `{action:"task.create",patch:{title:"Review the fixture plan",assignee_user_id:<synthetic actor>}}`;
  the new actual-handler check exited 1 on that exact summary mismatch.
- After the repair, `node --import ./scripts/knowledge-scope/register.mjs scripts/crm-approval-summary-check.mjs`
  passes 21 checks. Only Deno serving and Supabase SDK boundaries are replaced by the existing harness;
  real request validation, canonicalization, Gateway, subject, fingerprint and handler code execute.
- The check denies network egress and uses synthetic identities. Approval proposals never call the
  native executor. Display formatting preserves complete stored args, identity key and fingerprint.
  The approved round-trip routes the stored command despite request-title drift, adding only the
  original server-owned `operator_card` execution-channel stamp.
- Focused Vitest: 4 files, 68 tests PASS (CRM edge contract, approval-door wiring, approval
  resolution and Chat adoption); the existing edge-contract suite runs the actual-handler proof.
  Focused ESLint, Node syntax and whitespace checks PASS.
- Negative claim fixtures independently use fresh approvals for a different actor, a different
  workspace and a forged token; a consumed approval is separately refused for execution. These
  prove the handler's scoped query and routing, not PostgreSQL transaction isolation or provider behavior.

## Integration and remaining gates

Independent Review of the immutable integrated diff, required exact-head CI, Spine source-proof
renewal where the existing source guard requires it, merge, `crm-command` deployment/readback,
ordinary authenticated approval/execution and truthful record/receipt QA remain with the root lead.
This slice does not activate Chat, modify INT-346, call production, create a fixture account,
send communications, change credentials or touch any other branch or in-flight release.
