# Edge runtime readback reconciliation — pre-edit contract

OWNER_INTENT: Complete the existing SOLO restoration release using exact deployed source/configuration proof. Correct the false runtime dependency without weakening the verifier, and declare the existing skill-runner handler-auth posture explicitly rather than changing production authorization.

MUST_NOT_HAPPEN: No verifier default change, accepting arbitrary live metadata, provider/credential activation, endpoint permission/body-auth changes, fake release evidence, source fingerprint renewal, overwrite of historical receipts, deployment or push before root review.

MUST_PRESERVE: Existing deploy selection/retirement/readback/tag gates, canonical handler authentication and governed skill adapter, server-derived actor/tenant, service mutation refusal, exact sender approval and tenant isolation. The channel attachment contract must emit identical runtime JavaScript. Root's other branches, existing untracked artifacts and source ownership are preserved.

ACCEPTANCE_CRITERIA: Existing runtime closure excludes the erased attachment type after explicit type-import normalization; real runtime/dynamic imports remain required. The explicit skill-runner config preserves observed verify_jwt=false and global default=true. Actual handler-port fixtures prove ordinary owner JWT-to-tenant/approval behavior plus absent/forged credentials, foreign target, body authority spoof and unattended service refusal, with no real network/provider effects.

## Grounded findings

PR2254 target e76eef0568f935b7bbc18f1c352a41dbf68d97a1 had a first deployed-source report with 41 selected functions, 29 PASS, 12 FAIL. Ten were source mismatches; the rerun's Chat428 subsequently matched 226/226 reviewed source files, so no Chat source patch is justified by that first stale readback. Root owns final rerun certification. The sanitized first report does not establish the provider's precise propagation/no-op mechanism.

The current handle-inbound-email106 archive contains26 local runtime files. Existing runtime_closure demanded27 because channel-adapters.ts used `serverAttachments?: import('./email-attachments.ts').EmailAttachment[]`. This is an erased TypeScript ImportTypeNode. Normalize to an explicit import type using the verifier's existing supported rule; do not alter the verifier or excuse runtime dynamic imports.

The observed skill-runner140 metadata is ACTIVE/verify_jwt=false, whereas e76 has no function stanza and the existing verifier correctly expects the defaulttrue. Handler-level verified JWT/server tenant/governed authority was deliberately introduced in a52b1947b (PR1179) and hardened in91c815fb4 (PR1183), with the original shared adapter/approval tests. The decision log explicitly documents service mutation refusal and body-supplied actor/tenant not being authority. No configuration history declaring a true transition was found. The original creation of livefalse metadata remains historically UNVERIFIED; source-auth intent and current observed posture are distinct evidence. Explicit false records the existing posture; it does not turn verification off in production or claim every historical release's settings.

Reference: Supabase's current https://supabase.com/docs/guides/functions/auth-headers distinguishes the platform gate from handler credential verification. This slice retains the existing handler verification, server-derived scope and service refusal. It changes no token type or provider setup.

## Scope and delivery boundary

Based on exacte76 in a new branch in the existing tracked-clean edge-source-readback-final worktree. Lease: channel-adapters type seam, skill-runner config stanza, focused readback/auth tests and this new per-PR evidence only. Preserve the existing untracked __pycache__ and ignored work. No SQL, handler permissions, provider settings, main/other branch edits, protected source pins, push, deployment or customer effects.

## Capability routing and unchanged customer flow

1. Outcome: make the existing release certify actual runtime source and current function metadata truthfully; no new customer action.
2. Domain: shared Communications contract and incumbent Skill execution, bounded release reconciliation; root owns parallel Chat/Research/automation work.
3. Harness/Gateway: retain the actual skill handler and canonical governed decision/approval adapter; no substitute authority or executor.
4. Capability: incumbent `skill_run` action-risk key (`high`, default `confirm`) and existing skill outcome channel `paige_skill_runs`; no new Spine registration or capability availability claim.
5. Provider: existing Communications email contract, exact tenant sender and existing configured send boundary. No provider connection or SendGrid/Resend/Gmail/Apple/Twilio policy changes, API calls, activation or credentials.
6. Approval: retain canonical governed refusal and the existing single-use exact-draft confirmation; service credentials never constitute a person's approval.
7. Durable work: no new event producer, drainer, scheduler or job.
8. Readback: preserve the existing source verifier/deployment tag gates and existing domain records; local test proposals are synthetic ports, never production records or execution receipts.
9. Surface: no surface/Binding Ledger transition. Existing Skills/customer surfaces are unchanged.
10. Proof: complete handler-port tests prove server-derived control flow, not real Auth crypto, hosted Deno, production/provider action, Chat/Live completion or owner acceptance. Those claims remain UNVERIFIED.

FLOW_BY_FLOW: Applied the existing-flow/authority/receipt and truthful-evidence checks. This bounded correction changes neither visible UI nor the customer flow.
MATERIAL_FLOW_CHANGE: NO. No form, state, navigation, interaction or visual modification.
FLOW_PROTOTYPE: NOT_REQUIRED for runtime type erasure and declaring already-observed metadata. No fabricated UI proof.
PAIGE_UI_DESIGN: NOT_APPLICABLE; no visible interface modification.

## Protected proof

- Failing first: unchanged runtime/config gave two actual `RepositoryRuntimeContracts` failures (`work/runtime-readback-red.log`). Corrected handler-test assumptions to match the incumbent 403 refusal and 16-hex fingerprint; these were fixture corrections, not product defects. The final pre-edit fixture run had 29 PASS and only the intended type-import assertion FAIL (`work/skill-handler-preedit-final.log`).
- Actual complete `skill-runner/index.ts` is transpiled/captured at its real `Deno.serve` entry. Real governed decision, email approval, secure-browser authority, fingerprint and contact-method modules remain in the fixture; only Auth/database/model/provider I/O ports are synthetic. Ten actual handler cases cover absent/forged/expired session, owner proposal, ignored body authority, foreign contact, unattended service, no resolved workspace, provider refusal, forged confirmation and exact scoped claim constraints. No real network/provider effects run.
- Final focused suite: 30 PASS across two suites (10 new actual-handler cases, one exact emitted-JavaScript/type-erasure regression, 19 incumbent authority/approval regressions), `work/skill-handler-final.log`.
- Final repository contracts: 2 PASS, `work/runtime-contract-final.log`. Undeclared functions still default to JWT verification enabled. A separate exact-base review packet proves the complete parsed configuration, after removing the sole new skill-runner stanza, equals reviewed e76; the enduring regression test does not prohibit legitimate future configuration changes.
- Existing complete release/readback suite: 64 PASS, no skips, `work/runtime-readback-final-retry.log` (134.200s). Runtime dynamic imports, side-effect imports, value imports/reexports, mixed imports and missing runtime files remain subject to the unchanged verifier; no bypass was added. The type-erasure regression applies only the attachment-syntax rewrite to the actual current module; separate exact-base emitted-byte proof is in the review packet, so unrelated future module behavior is not permanently frozen by this test.
- Focused new-test ESLint: PASS, `work/skill-handler-eslint.log`; final whitespace check PASS. Initial sandbox attempts hit Windows temporary-file ACL/rename errors before assertions; protected offline reruns outside that sandbox supplied the actual proof. Those environment failures are not product failures or passing tests.
- Actual TypeScript parser: zero diagnostics for both changed TypeScript files, `work/edge-runtime-syntax.log`. No full-application typecheck or hosted Deno compilation is claimed here.
- Focused actual `tsconfig.app.json` semantic program rooted only at the new handler test and its imports: 0 owned / 0 imported diagnostics, `work/edge-runtime-types.log`; this is not full-application green.

## Exact review inputs and root-owned gates

Read-only packet: `work/edge-runtime-review-inputs.json`. The only protected C0b SOURCE input changed is `supabase/functions/_shared/channel-adapters.ts`:

| Input | SHA-256 |
| --- | --- |
| Base C0b canonical TypeScript | `6ca080080233039c808d79af0a659ab3f93adb818b59573a99083b1cee015e2c` |
| Candidate C0b canonical TypeScript | `f29fe7502ceb961ad886863c570970d48c4c19969ce2b6fce203a04867deef41` |
| Base normalized source | `d92df0b87d85c407cb285a68cc186c9826c5828ea20cbade99ae4928db0f6d03` |
| Candidate normalized source | `78ed1d549ede3304712364e762a7e09b8abee029e1a36c4b9ec2aa806a95d89f` |
| Identical old/new emitted runtime JavaScript | `e3a17afd1059862b12de1a15b350df1588f62d697fae96adfa1b55724b48e616` |

Actual complete handler normalized SHA-256 remains `b09dac5ef9274847caa014679331c070874d6cf826d0c9b534ea6f110ad16e41`. The source verifier, affected graph and deployment workflow also remain byte-equivalent to e76 after existing LF normalization. Pins were not renewed; root must inspect the exact change and, only after its distinct review, reconcile that single source fingerprint. Required exact-head CI and authoritative deployed source/metadata readback remain owed.

INTERNAL_BUILD_IDENTITY: Development branch `fix/ant21-edge-runtime-readback`, exact reviewed base `e76eef0568f935b7bbc18f1c352a41dbf68d97a1`; freeze commit recorded in the handoff/review receipt.
RELEASE_CHANNEL: development.
RELEASE_CLASSIFICATION: Internal release reconciliation; no new customer release or feature activation.
CUSTOMER_RELEASE_IDENTITY: NONE.
RELEASE_NOTE_REQUIRED: No customer announcement for this internal correction.
RELEASE_TRUTH_BOUNDARY: Source/protected fixture proof only. No push, merge, deployment, Auth/provider operation, customer data change or Live acceptance in this slice. Original creation of live skill-runner verify_jwt=false remains historically UNVERIFIED; this explicit configuration preserves the observed posture and existing handler authentication.
RELEASE_RECOVERY: Revert the bounded source/config commit through the ordinary reviewed release if needed. The type-import revert emits identical JavaScript but recreates the false dependency. Reverting the stanza restores the undeclared-config mismatch; do not independently tighten production JWT metadata or weaken the verifier to disguise that mismatch. Preserve all domain/security/provider controls and tenant-stripe-connect v13.

Root owns Independent NON-AUTHOR Review, any source-pin reconciliation, exact-head CI, merge, production release/readback and authenticated customer acceptance. Source completion is not production recovery or Chat/Live proof.
