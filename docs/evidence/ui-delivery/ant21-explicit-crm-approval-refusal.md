# Explicit native CRM approval refusal

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: supplied approval -> original-result readback -> existing exact native claim -> Gateway decision -> truthful refusal or existing native execution
PAIGE_UI_DESIGN: PASS: native endpoint only; existing approval controls and refusal/result surfaces remain unchanged
MATERIAL_FLOW_CHANGE: NO: correct an existing stale-approval fallthrough without a new choice, destination, executor or approval channel
FLOW_PROTOTYPE: NOT_REQUIRED: retain the established deliberate approval/refusal interaction
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible existing/future SOLO customer can distinguish a still-valid approval from one that requires inspection and fresh review
VISUAL_DIRECTION: NOT_APPLICABLE: no JSX, CSS, layout, motion or control changes
AUTOMATED_EVIDENCE: PASS: actual endpoint failing-first202 versus expected403;51 corrected actual-handler assertions over protected SDK/database ports
STATIC_EVIDENCE: PASS: script syntax and whitespace; exact scope and preserved native claim/result/Gateway source inspected; native Deno compilation UNVERIFIED because the local remote-import cache lacks zod3.22.4
RENDERED_EVIDENCE: UNVERIFIED: no new UI rendering claim
BEHAVIORAL_EVIDENCE: PASS: confirm/auto failed claims refuse without proposal or executor call; fresh proposal, valid exact stored approval, exact original replay and uncertain original readback preserve their incumbent paths
AUTHENTICATED_RUNTIME: UNVERIFIED: no ordinary customer/provider/hosted database action, deployment or production mutation
KEYBOARD_FOCUS: NOT_APPLICABLE: no UI source changed
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changed
REDUCED_MOTION: NOT_APPLICABLE: no motion changed
STATE_COVERAGE: PASS: actual-handler controls cover absent, consumed, expired, unissued, foreign actor/tenant and forged approval in confirm/auto; acknowledgement fault, role refusal, original success and result-readback fault
TRUTHFUL_STATE_LABELS: PASS: unavailable or unconfirmed approval means inspect the original record/result and request fresh review; it never reports execution or automatically creates another proposal
SOLO_UI: YES: the restoration composition includes SOLO Work UI; this shared CRM refusal seam preserves the existing approval surface for all eligible tenants
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no viewport proof for this CRM refusal seam
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no viewport proof for this CRM refusal seam
UNVERIFIED: distinct source/security review, exact-head CI, deployment/source readback, authenticated stale/fresh approval and reload QA, actual concurrent native CAS, broader role/Live/new-account/owner acceptance
OWNER_INTENT: deliberate approvals must execute only through their still-valid native authority; expired or consumed approvals must not silently become fresh proposals or standing-autonomy instructions
MUST_NOT_HAPPEN: no failed native claim may run an effect, mint replacement approval, manufacture a role, or bypass original-result recovery
MUST_PRESERVE: existing original result reader, exact stored command/key/subject/fingerprint handling, native claim filters, Gateway refusals/risk/lanes, audit, tenant/role/version isolation and native domain writers
ACCEPTANCE_CRITERIA: fresh proposals and exact valid approvals retain normal behavior; failed explicit claims return refusal with no new proposal/execution; exact completed original replay is readback only
PROTECTED_SEAMS: affected native approval refusal and decision audit; unchanged Auth, native SQL/claim predicate, domain writers, original result/replay, publication-context RPC, Spine metadata, provider/budget/activation and UI geometry
INTERNAL_BUILD_IDENTITY: base=d9f5ff42209c8d3b299beb46429dcc7179187eec; candidate=commit containing this record; branch=fix/ant21-crm-failed-approval-refusal; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed native CRM deployment and source readback); evidence=docs/evidence/ui-delivery/ant21-explicit-crm-approval-refusal.md
RELEASE_CHANNEL: development: isolated source and protected endpoint fixtures
RELEASE_CLASSIFICATION: internal-only: native approval correctness repair awaiting review and guarded integration
CUSTOMER_RELEASE_IDENTITY: none: customer release and acceptance are not claimed
RELEASE_NOTE_REQUIRED: no: integration lead owns eventual release closeout
RELEASE_TRUTH_BOUNDARY: PROOF OWED: exact-head review/CI, real deployment/readback, ordinary customer approval/reload and owner acceptance
RELEASE_RECOVERY: position=reviewed forward correction preserving canonical records, pending identities and exact original-result inspection; reference=docs/evidence/ui-delivery/ant21-decline-effect-fence.md

## Cause and bounded correction

The recovery integration's real endpoint test found that an explicitly supplied approval whose native claim returned no row could fall through to a fresh proposal. The same missing claim could meet a standing-autonomy decision. This slice adds a deny-only native boundary; it does not change the Gateway or introduce permission logic, a store or execution engine.

The endpoint still reads the exact original command result before any claim. That keeps a successful original's lost-acknowledgement retry as readback rather than another mutation. An unconfirmed original read remains a refusal before claim. The native atomic claim's exact user/tenant/tool/fingerprint/unconsumed/issuance/expiry filters are unchanged.

After the existing Gateway computes its normal risk/lane decision, an explicit failed claim can only retain a Gateway refusal or become a refusal. An unavailable claim returns403/CRM_APPROVAL_UNAVAILABLE; an error reading its acknowledgement returns503/CRM_APPROVAL_UNCONFIRMED. Both require original-record/result inspection and fresh review. The existing audit records the actual refusal. No proposal INSERT or execute_crm_command call follows. Existing underlying access refusals remain intact.

Successful native claims still route the exact stored command and original idempotency key. A fresh request without a supplied approval retains the incumbent proposal or legitimately authorized standing-autonomy path. Canonical result/replay, uncertainty, domain CAS and permissions are unchanged.

## Proof limits

The existing actual CRM endpoint proof was strengthened from expecting a revalidation proposal for invalid approvals to requiring refusal with zero replacement proposal/execution. Before the source correction it failed202 versus403. The final51 assertions preserve the prior task/deal title, task locator, stored-command substitution, exact approval, cached replay and tier/role controls, adding both-lane invalid-claim and acknowledgement/error cases. Query error is a narrow protected SDK port; no production Auth, RLS, database constraint or real domain persistence is claimed by these tests.

The original recovery status test's consumed-race failure remains in its separate worktree and must pass against this independently reviewed correction before integration. Publication availability remains an observed read, never a future execution lease. Native consumption/CAS continues to revalidate any later action.

No source fingerprints, extractor, metadata, authority schema, credentials, provider settings, activation, main or production were changed. Full compilation is not claimed: the actual cached-only Deno attempt could not resolve the absent zod3.22.4 remote import; it fetched no package. Exact-head CI and distinct source review remain owed.
