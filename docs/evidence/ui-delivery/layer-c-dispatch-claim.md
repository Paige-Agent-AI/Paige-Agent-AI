# UI delivery evidence: Layer-C dispatch claim — the approval says when a step is already running

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow traced from an owner approving a held Layer-C act (ApprovalRow, useSoloProposals, useCommandCenter, useAgencyCommandCenter → execute-approval → approve-executor) through redemption to the dispatch claim in supabase/functions/_shared/paige-orchestration/dispatch-claim.ts; two simultaneous approvals of one row are already serialised by execute-approval's own claimed_at lock (the loser gets already:in_progress, no sentence), so the new sentence is reached only when an engine re-drive or an earlier failed attempt holds the dispatch claim
PAIGE_UI_DESIGN: PASS: no visual pattern introduced — the four approval callers that render the response's `error` string show one new sentence in their existing toast or inline error; DraftsAwaitingPanel's batch approve counts failures and shows no sentence
MATERIAL_FLOW_CHANGE: YES: an approval no longer fires a held step while another caller holds its dispatch claim — an engine re-drive of the same act (its lane moved to auto) or an earlier approval attempt whose ledger write failed within the last ten minutes; the approver sees that PAIGE may already be running it and can approve again later
FLOW_PROTOTYPE: WAIVED: owner-decision=INT-179 Slice 2b continuation directive 2026-10-12; reason=the owner directed the atomic execution claim as the next approved slice and the lifecycle it fixes is not a new interaction, only one refusal sentence in the existing toast
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace owner or admin approves a step PAIGE held; the primary outcome is that the step runs exactly once, whatever else reaches it at the same moment
VISUAL_DIRECTION: PASS: unchanged — same toast and inline error components, same tokens, same placement
AUTOMATED_EVIDENCE: PASS: vitest 140/140 across src/__tests__/paige-orchestration-*.test.ts including the claim cases in the native and approve-executor suites (forcing every claim to succeed fails 7); pgTAP supabase/tests/paige_act_dispatch_claim.sql 28/28 (restoring the original ledger RPC fails 15; the previous draft of this migration fails G1 and errors on G2)
STATIC_EVIDENCE: PASS: deno check exits 0 on execute-approval and paige-native-event-dispatch; capability-kit, definer-fn and migration-version guards pass
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI source changed — one edge response `error` string was added and the existing approval toasts render it unchanged
BEHAVIORAL_EVIDENCE: PASS: headless, against a disposable locally rebuilt database (supabase db reset replaying every migration) — scripts/proof/layer-c-native-vertical.mjs runs the production function files for cases A–E; case F holds the act's row lock in one session, confirms eight separate psql sessions are queued on it, releases it, and exactly one claimant wins (removing the claim guard lets all eight win); 17/17. That the engine and approval executor take the claim before every dispatch is unit-proven (vitest), not driven end to end
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in drive on the deployed surfaces — production holds 0 automations and 0 Layer-C acts, and creating one needs separate safe-tenant authority; the protected synthetic tenant (QA #1832) does not exist yet. The affected claim is the new sentence seen in a live toast
KEYBOARD_FOCUS: NOT_APPLICABLE: no dialog, focus, keyboard or navigation code changed — migration, edge and test files only
ZOOM_REFLOW: NOT_APPLICABLE: no layout or sizing code changed; the sentence is one to two short lines in the existing toast
REDUCED_MOTION: NOT_APPLICABLE: no motion code changed
STATE_COVERAGE: PASS: claimed → the step runs once; another caller holds the claim → "PAIGE may already be running this step. If it hasn't finished in ten minutes, approve it again." with the row left open and nothing fired; the claim cannot be read or written → the plain line "PAIGE couldn't complete that action." with nothing fired (unit-covered in src/__tests__/paige-orchestration-approve-executor.test.ts)
TRUTHFUL_STATE_LABELS: PASS: the sentence says "may already be running" because the claim can also be this approver's own earlier attempt whose ledger write failed; the claim protects a dispatch for ten minutes (DISPATCH_CLAIM_STALE, floored at 7 by the RPC) and the next approval after that re-takes it once a readback shows nothing landed; no sentence says nothing changed when a dispatch may have landed
SOLO_UI: NO: no Solo UI source changed — the Solo approval hooks render the edge function's `error` unchanged
UNVERIFIED: the live toast on a deployed surface for a real held act (no production automation exists; safe-tenant authority and QA #1832 owed); sub-account, agency and platform-owner approver paths
OWNER_INTENT: an approved or automatic step must run at most once, however many callers reach it at the same moment, without ever falsely telling the owner it did not run
MUST_NOT_HAPPEN: two callers firing the same act; a re-derived decision overwriting an act whose effect may have landed; the snapshot args being lost on a later write; a claimed act stuck forever after its claimant dies
MUST_PRESERVE: the readback-confirm path recording a landed effect regardless of posture; the reconciler and resume paths (the claim does not change the outcome); final rows never overwritten; non-orchestration approvals unchanged
ACCEPTANCE_CRITERIA: on the real platform, an approval that reaches a held step while an engine re-drive is dispatching it does not fire it a second time, and the approver sees "PAIGE may already be running this step…"; the step produces one effect, one receipt and one Rail entry
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: paige_record_act_execution (redefined in place, still the one ledger writer), paige_approve_act_execution redemption, the reconciler, resolve_automation_autonomy through readProcessPosture — reused, none duplicated
INTERNAL_BUILD_IDENTITY: 04c0bd7d89b9c5ba858e8a9be73d52b52aa0b4cc plus this record (branch claude/charming-rubin-lbxd4o, before merge); deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271023000000 applied by deploy-migrations on merge); edge=PROOF_OWED(execute-approval and paige-native-event-dispatch production deploy via deploy-edge-functions on merge); evidence=pgtap-26-vitest-140-layer-c-proof-17
RELEASE_CHANNEL: development: built and verified locally against a disposable rebuilt database; production follows green CI and merge via deploy-migrations and deploy-edge-functions (pre-launch §4)
RELEASE_CLASSIFICATION: internal-only: an at-most-once execution guard on a path production has never exercised
CUSTOMER_RELEASE_IDENTITY: none: no customer-facing capability added; production holds no automations
RELEASE_NOTE_REQUIRED: NO: no customer-visible capability change; the path is unexercised in production
RELEASE_TRUTH_BOUNDARY: UNAVAILABLE: Layer-C execution does not occur in production today (0 automations); the behaviour is proven against a rebuilt database headlessly, and the live drive is owed
RELEASE_RECOVERY: position=revert the Slice 2b code commits and keep the applied migration, because the guarded RPC is backward-compatible with the pre-2b callers and the unused claim RPC is inert (a forward migration is needed only to drop paige_claim_act_dispatch, and restoring the old RPC body would re-open the in-flight overwrite); reference=migration 20271023000000

## Scope and collisions

- Classification: database + edge hardening with one owner-visible refusal sentence; no UI source in the diff.
- Callers of `paige_record_act_execution` inventoried: engine phase 4/5, the approval executor, and the SQL reconciler (writes executed/failed, which the guard allows). Callers of the new claim: engine phase 5 (both dispatch sites) and the approval executor (fresh and resume), all through `dispatch-claim.ts`.
- Exclusions: generalising phase 4/5 to every dispatching adapter, n8n correlation binding and orphan reconciliation (later milestones); n8n effectful execution stays disabled.

## Evidence index

- `npx vitest run src/__tests__/paige-orchestration` → 140/140.
- `supabase test db supabase/tests/paige_act_dispatch_claim.sql` → 26/26.
- `LAYER_C_E2E_DISPOSABLE=1 node scripts/proof/layer-c-native-vertical.mjs` → 17/17 including case F.

## Review and limitations

Independent non-author review is run on the pushed diff before merge and recorded on the PR. The live toast on a deployed surface is PROOF OWED.
