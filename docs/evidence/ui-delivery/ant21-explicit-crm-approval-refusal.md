# Explicit native CRM approval refusal

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: supplied approval -> original-result readback -> existing exact native claim -> Gateway decision -> truthful refusal or existing native execution
PAIGE_UI_DESIGN: PASS: native endpoint only; existing approval controls and refusal/result surfaces remain unchanged
MATERIAL_FLOW_CHANGE: NO: correct an existing stale-approval fallthrough without a new choice, destination, executor or approval channel
FLOW_PROTOTYPE: NOT_REQUIRED: retain the established deliberate approval/refusal interaction
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible existing/future SOLO customer can distinguish a still-valid approval from one that requires inspection and fresh review
VISUAL_DIRECTION: NOT_APPLICABLE: no JSX, CSS, layout, motion or control changes
AUTOMATED_EVIDENCE: PASS: original fallthrough failed202 versus expected403; losing-claim regression failed403 versus expected503; preserved-Gateway-denial regression failedundefined versus expectedtrue;59 actual-handler checks,1111 real Chat-wrapper checks and111 approval/adoption unit tests pass over protected SDK/database ports
STATIC_EVIDENCE: PASS: both script syntax checks, three-file scoped ESLint and whitespace; exact scope and preserved native claim/result/Gateway source inspected; native Deno compilation UNVERIFIED because std0.168.0, Supabase SDK2.75.0 and zod3.22.4 remote imports are absent and DNS resolution fails
RENDERED_EVIDENCE: UNVERIFIED: no new UI rendering claim
BEHAVIORAL_EVIDENCE: PASS: confirm/auto failed claims refuse without proposal or executor call; empty competing claims and lost claim acknowledgements remain unconfirmed; later canonical original results reconcile without a second execution; fresh proposals and exact stored approvals preserve incumbent paths
AUTHENTICATED_RUNTIME: UNVERIFIED: no ordinary customer/provider/hosted database action, deployment or production mutation
KEYBOARD_FOCUS: NOT_APPLICABLE: no UI source changed
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changed
REDUCED_MOTION: NOT_APPLICABLE: no motion changed
STATE_COVERAGE: PASS: actual-handler controls cover absent, consumed, expired, unissued, foreign actor/tenant and forged approval in confirm/auto; competing consumption after original read, lost claim acknowledgement, role refusal, original success, result-readback fault and blocked same-turn model re-emission
TRUTHFUL_STATE_LABELS: PASS: an empty or errored explicit claim is unconfirmed, never proof of non-application; inspect the original result before another action; it never reports execution or automatically creates another proposal
SOLO_UI: NO: shared native CRM door for all eligible tenants; no account selector or private implementation
UNVERIFIED: exact-final-head Independent Review, exact-head CI, deployment/source readback, authenticated stale/fresh approval and reload QA, actual concurrent native CAS, broader role/Live/new-account/owner acceptance
OWNER_INTENT: deliberate approvals must execute only through their still-valid native authority; expired or consumed approvals must not silently become fresh proposals or standing-autonomy instructions
MUST_NOT_HAPPEN: no failed native claim may run an effect, mint replacement approval, manufacture a role, or bypass original-result recovery
MUST_PRESERVE: existing original result reader, exact stored command/key/subject/fingerprint handling, native claim filters, Gateway refusals/risk/lanes, audit, tenant/role/version isolation and native domain writers
ACCEPTANCE_CRITERIA: fresh proposals and exact valid approvals retain normal behavior; failed explicit claims return refusal with no new proposal/execution; exact completed original replay is readback only
PROTECTED_SEAMS: affected native approval refusal and decision audit; unchanged Auth, native SQL/claim predicate, domain writers, original result/replay, publication-context RPC, Spine metadata, provider/budget/activation and UI geometry
INTERNAL_BUILD_IDENTITY: base=60c5ebf655c0f54d40c88219b7661fc6f6c06d94; candidate=commit containing this record; branch=fix/ant21-crm-failed-approval-refusal; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed native CRM deployment and source readback); evidence=docs/evidence/ui-delivery/ant21-explicit-crm-approval-refusal.md
RELEASE_CHANNEL: development: isolated source and protected endpoint fixtures
RELEASE_CLASSIFICATION: internal-only: native approval correctness repair awaiting review and guarded integration
CUSTOMER_RELEASE_IDENTITY: none: customer release and acceptance are not claimed
RELEASE_NOTE_REQUIRED: no: integration lead owns eventual release closeout
RELEASE_TRUTH_BOUNDARY: PROOF OWED: exact-head review/CI, real deployment/readback, ordinary customer approval/reload and owner acceptance
RELEASE_RECOVERY: position=reviewed forward correction preserving canonical records, pending identities and exact original-result inspection; reference=docs/evidence/ui-delivery/ant21-decline-effect-fence.md

## Cause and bounded correction

The recovery integration's real endpoint test found that an explicitly supplied approval whose native claim returned no row could fall through to a fresh proposal. The same missing claim could meet a standing-autonomy decision. This slice adds a deny-only native boundary; it does not change the Gateway or introduce permission logic, a store or execution engine.

The endpoint still reads the exact original command result before any claim. That keeps a successful original's lost-acknowledgement retry as readback rather than another mutation. An unconfirmed original read remains a refusal before claim. The native atomic claim's exact user/tenant/tool/fingerprint/unconsumed/issuance/expiry filters are unchanged.

After the existing Gateway computes its normal risk/lane decision, an explicit failed claim can only retain a Gateway refusal or become a refusal. A Gateway that otherwise permitted a proposal or execution becomes503/CRM_APPROVAL_UNCONFIRMED. An existing Gateway refusal retains its403 status, code and message. Both branches independently carry outcome_unknown=true and refused_before_run=false whenever the explicit claim failed. An empty claim can lose to a concurrent request after the original-result read returned no record; that other request may still commit its business effect. The losing request therefore cannot establish non-application. The existing audit records the refusal. No proposal INSERT or execute_crm_command call follows. Existing underlying Gateway access refusals remain intact.

Successful native claims still route the exact stored command and original idempotency key. A fresh request without a supplied approval retains the incumbent proposal or legitimately authorized standing-autonomy path. Canonical result/replay, uncertainty, domain CAS and permissions are unchanged.

## Proof limits

The existing actual CRM endpoint proof was strengthened from expecting a revalidation proposal for invalid approvals to requiring refusal with zero replacement proposal/execution. Before the original source correction it failed202 versus403. A subsequent review identified the losing-claim uncertainty gap: the regression then failed403 versus503. A distinct review of1dc6eac8 found that preserving autonomy_off or autonomy_lane_unrecognized also dropped uncertainty; its new regression failedundefined versustrue before the flags were bound to failed claim state independently of the denial code. The final59 checks preserve task/deal title, task locator, stored-command substitution, exact approval, cached replay and tier/role controls, adding competing-claim, lost-acknowledgement, preserved-denial and unchanged ordinary-refusal cases. Query faults and competing commits are protected SDK ports; no production Auth, RLS, database constraint or real PostgreSQL concurrency is claimed by these tests.

The correct existing Chat-wrapper command is `node --import ./scripts/client-memory-authz/register.mjs scripts/client-memory-authz/check.mjs`. Its initial run completed1102 passes and one stale assertion: marking the native claim uncertain now invokes the existing stronger prior-effect reconciliation brake before the ordinary same-turn re-emission guard. The corrected assertion requires that brake, an unconfirmed approval card, outcome_unknown=true and not_applied=false while retaining all zero-write, single-door-call and no-new-card checks. Two protected-port schedule cases per autonomy lane now place competing consumption after an empty original-result read and before the losing claim, then introduce the winner's later canonical result. They require an unconfirmed card/model before commit and readback-only success afterward, preserving the consumed timestamp. The final wrapper run passes1107 checks; its database result map models the domain boundary and does not prove a real concurrent transaction.

The focused four-suite approval/adoption run passes111 tests. Both modified scripts pass `node --check`; scoped ESLint passes for the native handler and both scripts. The actual local logs are in `work/claim-race-proof/handler-final.log`, `authz-final.log`, `adoption-final.log` and `lint-final.log`; the original failing losing-claim reproduction remains `work/claim-race-before.log`. The subsequent preserved-denial regression is `gateway-before.log`; final59 handler and1111 wrapper checks are `gateway-after.log` and `gateway-authz-expanded.log`, with scoped lint in `gateway-lint.log`. The expanded wrapper runs the original losing-claim/readback schedule for confirm, auto, off and unresolved; all preserve an unconfirmed original outcome before the delayed result and recover only by its canonical result. The earlier1107 result above remains a dated intermediate run. Exact-head hosted checks and deployment proof remain separately owed.

The original recovery status test's consumed-race failure remains in its separate worktree and must pass against this independently reviewed correction before integration. Publication availability remains an observed read, never a future execution lease. Native consumption/CAS continues to revalidate any later action.

No source fingerprints, extractor, metadata, authority schema, credentials, provider settings, activation, main or production were changed. Full compilation is not claimed: the actual `deno check --cached-only supabase/functions/crm-command/index.ts` attempt failed resolving the absent std0.168.0 server import; its log also names the Supabase SDK2.75.0 and zod3.22.4 remote imports. No package was fetched. The existing UI evidence guard passes against the full PR comparison with main a1b4355749e9a55658da095af75385a3dad09a1d (zero recognized UI source files, one evidence record); that validates attestation structure, not authenticated rendering. Exact-head CI and distinct source review remain owed.
