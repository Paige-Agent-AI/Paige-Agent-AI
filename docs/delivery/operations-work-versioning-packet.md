# Operations O2a — stage proposal and concurrent-edit protection

This slice follows the approved V3 build contract. It does not complete O2 or the department.

Pre-edit read-boundary addition: Operations selects an optional guarded read in the existing shared Planning hook, with explicit expected actor/tenant. A new authenticated-only source wrapper delegates canonical `plan_list` and removes records outside target administration or legitimate item creator/assignee relations; private plan access still requires owner/creator or tenant administration, while team plans remain readable. Scope switches lock the same profile row and late client reads remain fenced. No copied records, separate source, new role authority or changed non-Operations read is introduced. Shared legacy source risk is parked #1933. SQL/read-hook negatives, scope switching and non-author review are required; all previous-head CI is historical after this addition.

## Capability routing

1. Outcome: move existing work to a reviewed stage without overwriting a teammate's intervening edit.
2. Domain: Operations consumes canonical Planning and Team. Finance and zCod's Chat executor/security path are excluded.
3. Harness/Gateway: manual caller-JWT Planning RPC; existing shared context and canonical SQL authority. This does not activate a Harness executor.
4. Spine: existing `planning.list` and `planning.update_item`; conversational writers remain separately PARTIAL and require their own governed proof. This UI wrapper is not a second registered tool.
5. Provider: none. No communication or model/provider effect.
6. Lane: manual internal work UPDATE through existing Planning permissions; existing confirmation component reviews the proposed change. No substitute Trust approval or automated execution.
7. Durable work: no asynchronous job in this slice. No scheduler, retry worker or receipt store.
8. Readback: exact bounded actor/tenant/item acknowledgement followed by canonical `plan_list` field matching. Acknowledgement is not Rail, durable completion or client acceptance.
9. Surface: canonical Solo Operations Work; Binding Ledger remains PROOF_OWED for the complete department.
10. Acceptance: local synthetic DOM and isolated SQL proof, independent review, exact-head CI and production source/migration readback are separate. Authenticated runtime remains UNVERIFIED under standing owner restrictions.

## Flow and exits

Board drag resolves the current scoped item, proposes a stage in the same detail editor, and retains the saved card in its original lane. Open-task keyboard inspection provides the same stage selector. Save opens confirmation; cancellation retains the draft. Only confirmed changes call the versioned scoped writer. The server holds profile and item locks, checks the source timestamp at PostgreSQL precision, then delegates canonical permission, assignment and audit behavior to the existing writer. No timestamp or an intervening edit refuses the write. Explicit refresh replaces the draft/version only after canonical readback. Lost responses remain uncertain with no automatic retry.

Workspaces remount at the actor/tenant boundary; late draft or drag identifiers do not survive switching. External drag payloads are never resolved as work records. Cancelled stages remain excluded from movement until authorized cancelled-item history/readback exists.

## Proof and remaining scope

- Focused local Operations suite: all 27 assertions passed, including background-refresh draft retention and native-event proposal tests. Scoped ESLint and definer-function ACL lint passed.
- Native disposable PostgreSQL: 10 version/ACL/source assertions passed, plus a second committed canonical transaction refused the stale save and preserved intervening work. Minimal fixture ports, not full-schema or JWT/runtime proof.
- Rendered native drag (1366x768) and keyboard equivalent (390x844): passed in Obsidian and Mineral using actual shared shell and explicit synthetic read/role/refusal ports. Correct task identity, cancellation draft retention, refusal, unchanged saved lane, invoker focus and page containment verified. Full migrated-schema tests and exact-head CI remain owed before release.
- Task creation, activity/history, priority editing, project dependencies, signed engagement handoff, client acceptance, playbook execution, recorded availability, COO/Chat/Live execution: still owed by later bounded slices.

Flow-by-Flow, Flow Prototype and [Impeccable](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md) remain the UI workflow. Preserve existing tokens, names/photos, focus and reduced motion; do not reopen approved visual direction.

## Solo API scope pre-edit packet

Outcome: refuse direct Operations calls for agency, child and other excluded account types. Source: the existing isSoloStandalone contract requires account_type standalone and no parent. Apply that same registry condition inside the three Operations wrappers before record access or canonical delegation. Preserve membership, target-tenant authority, CAS, audit, canonical source ownership and default shared Planning reads. No lifecycle entitlement inference, operator-shell expansion, provider effect, customer mutation, identity change or new authority. Test excluded agency and parented-standalone scopes in disposable rollback SQL; existing standalone positives remain. Independent review and fresh exact-head CI are required; authenticated runtime remains UNVERIFIED.

## Version precondition authority pre-edit follow-up

Before CAS comparison, versioned Operations mutation must require canonical current membership and target-tenant admin/record creator/assignee visibility. Otherwise unrelated members could distinguish an existing stale record by its conflict response. Preserve the same canonical scope/mutation/audit/locks, no new authority; add a stale-version negative under unrelated target member/global role elsewhere. Fresh independent review and exact-head CI required. No customer runtime proof.

## Test cohort correction under canonical role synchronization

Exact-head4e08 database step failed; final job log not yet available. Source inspection found the global-admin-elsewhere fixture granted its role while the granting caller was admin in target A. Canonical sync_user_role_to_tenant_member legitimately seats the grantee in that caller workspace, invalidating the intended member-A/admin-B cohort. Grant now runs while the caller is in B before switching to A. No trigger, constraint or authority is bypassed; actual production role synchronization remains unchanged. Independent review and fresh rebuilt-schema proof remain required; this source finding is not yet asserted as the exact CI failure text.

Completed CI log confirms4e08failure: operations_versioned_work_update.sql line58 duplicate tenant_members_tenant_id_user_id_key after12PASSassertions. Tenant-role UPDATE also reverse-syncs the global role before the explicit insert, so the fixture now selects B before both role changes. This prevents an unintended A seat without disabling either synchronization or consent trigger. Production authority is unchanged.32assertions registered; fresh CI required.

Exact-head f554ec589ad2225ee0ab96b56fa1a23648ce60d1 rebuilt-schema log confirms 29 versioned/guarded-read assertions PASS, including the explicit member-A/admin-B cohort, private-item filtering and agency refusals. The step then failed at fixture hierarchy setup: the synthetic tenant administrator correctly could not change parent_tenant_id. Database-owner fixture setup now clears its local JWT subject through the existing guard's no-JWT branch, changes only the rollback-owned fixture, then immediately restores the synthetic caller for parented-scope API negatives. No production source, grants or triggers change; no API assertion runs without its caller. All 32 assertions still require fresh exact-head CI.
