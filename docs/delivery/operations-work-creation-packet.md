# Operations O2b — authorized task creation

Development work only. O1 and O2a release gates remain separate. This packet precedes implementation.

1. Outcome: create a real task with a named responsible person, project/milestone, priority and deadline; inspect the persisted task before claiming success.
2. Domain: Operations consumes Planning and Team. No Finance, Communications or shared Chat executor changes.
3. Harness/Gateway: manual caller JWT and existing Planning authority. No automated executor activation.
4. Spine: existing `planning.assign_task` and `planning.list`; conversational execution remains PARTIAL until governed proof. No new tool registry.
5. Provider: no new provider. Existing Planning assignment notification mismatch is parked in #1916. No notification delivery or provider-effect claim.
6. Lane: manual internal record creation through canonical `plan_assign_task`. Existing confirmation UI reviews creation/assignment; no substitute Trust approval for PAIGE execution.
7. Durable work: existing record-only action bus filing is retained. No retry worker, scheduler or operation ledger. Create is non-idempotent: lost responses must not be replayed automatically.
8. Readback: a scoped acknowledgement supplies the item identity; a separate caller-RLS SELECT with tenant and item fences must match the submitted task. Readback failure preserves the identity for inspection and prohibits blind retry. Acknowledgement is not Rail or client acceptance.
9. Surface: canonical Solo Work. Binding Ledger stays PROOF_OWED for the full department.
10. Proof: local fixture tests, isolated SQL/ACL/tenant/role negatives, non-author review, exact-head CI and production readback. Named authenticated runtime remains UNVERIFIED under owner restrictions.

## Flow contract

Open New task; enter title and optional context, choose an authorized active person, project and its milestone, priority and due date. Review before committing. Cancel retains a draft while the panel remains open. Missing roster never invents identities; self-assignment remains source-verified. Server locks the caller's scope row and validates the project's milestone relationship before delegating canonical permission, audit and bus filing. No browser-only task is inserted. On acknowledgment, inspect the exact persisted row independently, then refresh the shared work source. Refusal preserves the draft. Unknown write outcome disables repeat submission and directs the user to inspect current work. Actor/workspace switching unmounts the flow and rejects late readback.

## Ownership

New Operations-only creation component/adapter/tests and a narrow Planning precondition wrapper. Canonical Team identity, Planning tables, existing writer and shared confirmation components remain the sources. No changes to unrelated QuickAdd, Communications notifier, Chat executor, tenant ownership or customer records for testing.

## Development proof

Tenant-authority follow-up 10ee402cb: the Operations wrapper requires canonical current membership; assignment to another person requires `is_tenant_admin(selectedTenant)` before legacy delegation. UI uses the same scoped hint. Thirteen rollback assertions are registered, including global-role-only delegation refusal. The prior native twelve-assertion proof below is historical and does not prove this new assertion or final-head permission path. Fresh suite, review and full-schema release CI remain required.

- Creation adapter: 11 focused tests PASS (matching source readback, field/scope mismatch, lost response, actor switch, refusal and no automatic replay).
- Creator: 6 component tests PASS (confirmation/cancellation, verified-only refresh, uncertain lock and discard warning, nonstaff self-only choice, exact-identity inspection, unknown-identity refresh with no replay).
- Scoped ESLint, definer ACL/signature lint and type ratchet PASS (baseline 10/current 10).
- Disposable native PostgreSQL: 12 rollback assertions PASS; actual authenticated database-role creation PASS; four canonical RLS visibility cases PASS. Actual Planning writer/member/role/scope/RLS functions, with explicit platform/action-bus fixture ports. No complete action-bus, notification, hosted-schema or JWT/runtime claim. Synthetic rows cleared; server stopped.
- Actual shared-shell creator: both themes, all four required sizes plus phone PASS for draft preservation, refusal, discard cancellation, real scrolling/containment and invoker focus. Explicit synthetic source/permission/refusal ports; no saved customer work or authenticated account. Mobile panel uses full width. Captures and geometry are in the Operations evidence directory.
- Non-author static authority review at `6151f73e` PASS. Visual review required an uncertain-save inspection action; it now opens the acknowledged identity through the existing scoped detail view or refreshes current work when identity is unknown. Repeat submission stays locked. Four browser recovery cases PASS in Obsidian desktop and Mineral phone using explicit synthetic lost-response/acknowledgement ports; no persisted-task proof. Current-head review, full rebuilt-schema CI, exact release identity, production migration/readback and authenticated runtime remain owed. Full CRM-task unification, task priority/history editing and the rest of the department remain later work; this is not O2 or department completion.

## Solo API scope pre-edit follow-up

Match the canonical isSoloStandalone registry boundary (literal standalone, no parent) before Operations record access or canonical delegation. Preserve current membership/tenant administration, creator/assignee authority, validation, CAS, audit and effective legacy permission intersection. No lifecycle entitlement inference or non-Solo expansion. Add disposable excluded-account SQL refusals; new SQL remains UNEXECUTED until rebuilt-schema CI, with independent review required. No customer workspace testing.

Current registered rollback SQL assertions: 15; new Solo-scope assertions UNEXECUTED pending fresh rebuilt-schema CI.

Guarded-read/Solo-boundary local follow-up: complete Operations plus tenant-switch suite PASS, 91 tests in 16 files; scoped shared-hook/Workspace lint and definer/ACL-signature lint PASS. New rollback SQL execution remains UNVERIFIED pending rebuilt-schema CI. No customer runtime or production acceptance inferred.

Shared dependency safety follow-up: mirror reviewed O2a refusal ordering (membership/item visibility before version comparison), with31registered versioned SQL assertions UNEXECUTED until exact-head rebuilt-schema CI. No new rendered behavior.

O2a dependency fixture correction mirrors f554ec589: cross-workspace cohort now respects both canonical role-sync triggers and explicitly checks member A/admin B.32registered SQL assertions pending fresh CI; old12PASS before fixturefailure is historical, not fullguardedread proof.

## Isolated release preparation checkpoint

The O2b-only release tree contains task creation, independent readback, scoped permissions, guarded recovery, creator styling and one SQL workflow assertion step. Independent non-author extraction and permission-effect reviews PASS. Its 22 local tests PASS before the later permission-effect refinement. The actor+tenant dependencies and per-effect late-response fence now pass all seven creator tests, including the previous-tenant permission-response regression, in the warm development tree; creator and test files match the isolated release tree by SHA-256. This is not a fresh full-suite result. Current scoped creator lint PASS with zero warnings. Current type verification remains UNVERIFIED after resource-stalled compiler attempts. Latest Chromium rendering of the isolated source failed with ERR_INSUFFICIENT_RESOURCES after two navigation timeouts; these are not render PASS. Existing labeled synthetic capture evidence remains historical. The extra loopback preview and identified owned compiler were stopped; unrelated processes untouched. No additional PR opened while O2a remains pending.

Development migration00412 is not a release allocation: active shared continuation work also claims it and production is above00428. Allocate and independently review an unclaimed newer migration number only when this slice is promoted after O2a.

## Reconciled task-creation proof — October 11

Isolated source reconciled at 814373a592a98de7e22239ef7617875d5d9814ab: fresh 23 tests in three files PASS; non-author exact-head static review PASS. Creator-only phone correction uses the full viewport width; seven creator tests PASS afterward. Scoped ESLint and definer/ACL-signature lint PASS. Current type check remains in progress.

Fresh corrected actual shared-shell matrix: 18 configurations PASS in both worlds at the four required sizes plus phone. Initially-open PAIGE remains a side rail at wide sizes and is folded using its genuine control at narrow sizes before ordinary keyboard creator entry. No focus through a modal backdrop. Confirmation, refusal and discard states are captured with document animations settled. Phone drawer is 390px, correcting the inherited 292.5px drawer width. All runs use reduced motion; draft retention, explicit refusal, warned discard cancellation, containment and invoker focus PASS. Earlier runs that focused New task behind a modal are INVALID for entry-path proof and are superseded, not counted as passes.

Four fresh lost-response/acknowledged-identity recovery cases PASS: known identity opens canonical inspection; unknown identity refresh retains the locked creator and requires explicit warned closure. No automatic replay. These are labeled synthetic source/permission/refusal/acknowledgement ports, not saved-task or customer acceptance. Final non-author visual re-check and genuine zoom proof are running. SQL 15 assertions, current-head CI, migration allocation, deployment and authenticated runtime remain owed.

Current creator evidence correction received independent non-author visual SHIP after the single re-check: genuine narrow PAIGE fold and settled confirmation/discard captures are resolved. This is a bounded creator verdict, not full department acceptance.

Genuine native Chrome zoom: eight configurations PASS at 200%/400%, both worlds and PAIGE initially open/closed. Fresh unsigned-in local profiles set actual browser zoom; measured DPR2/4, CSS width674/337, physical1366 and visualViewport scale1. Canonical PAIGE modal folds normally before keyboard entry. Confirmation focus, explicit refusal, actual drawer scrolling/reachable review action, containment and invoker focus PASS. Uncropped CDP viewport captures and creation-zoom-verification.json preserve the synthetic boundary. No production task or named account was created/tested.

Current type ratchet PASS: baseline10/current10. Independent fixture audit found the latest role-sync trigger skips an ordinary member's global grant; no product authority defect was established. The rollback test now mirrors the proven admin-B/member-A cohort and asserts its actual target authority before attempting delegation. Both canonical sync triggers stay enabled. This adds one precondition: 16 SQL assertions remain UNEXECUTED until rebuilt-schema CI, not a local PASS. No production role or customer data change.


## Promotion after UI release — October 11

PR #1922 is merged as cf11661f39c0b67ae37ee9ab3062b73c5939b998. This slice is reconciled with that squash merge at 301c1c107. Production migration20 and reviewed function hashes/ACLs are verified. Fresh active reservation scan finds030 and100 already claimed; the unapplied development00412 is renamed to20271020000110, above the applied frontier20 and all observed active claims. SQL body is unchanged. Recheck frontier and reservations before merge; never reset applied history. Sixteen rollback assertions and fresh final-head CI remain owed. Historical pending type/zoom/review notes above are superseded by the completed evidence below them.
