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

Actual complete handler normalized SHA-256 remains `b09dac5ef9274847caa014679331c070874d6cf826d0c9b534ea6f110ad16e41`. The source verifier, affected graph and deployment workflow also remain byte-equivalent to e76 after existing LF normalization. The first source freeze left pins unchanged; the subsequent distinct-review authorization below permits only the listed single source fingerprint reconciliation. Required exact-head CI and authoritative deployed source/metadata readback remain owed.

INTERNAL_BUILD_IDENTITY: Development branch `fix/ant21-edge-runtime-readback`, exact reviewed base `e76eef0568f935b7bbc18f1c352a41dbf68d97a1`; freeze commit recorded in the handoff/review receipt.
RELEASE_CHANNEL: development.
RELEASE_CLASSIFICATION: Internal release reconciliation; no new customer release or feature activation.
CUSTOMER_RELEASE_IDENTITY: NONE.
RELEASE_NOTE_REQUIRED: No customer announcement for this internal correction.
RELEASE_TRUTH_BOUNDARY: Source/protected fixture proof only. The first source freeze performed no push; root subsequently authorized a READY PR after review. No merge, deployment, Auth/provider operation, customer data change or Live acceptance in this slice. Original creation of live skill-runner verify_jwt=false remains historically UNVERIFIED; this explicit configuration preserves the observed posture and existing handler authentication.
RELEASE_RECOVERY: Revert the bounded source/config commit through the ordinary reviewed release if needed. The type-import revert emits identical JavaScript but recreates the false dependency. Reverting the stanza restores the undeclared-config mismatch; do not independently tighten production JWT metadata or weaken the verifier to disguise that mismatch. Preserve all domain/security/provider controls and tenant-stripe-connect v13.

## Independent Review and narrowly authorized pin reconciliation

Root (`/root`, distinct from source author `/root/gmail_native_review`) completed **Independent NON-AUTHOR Review — PASS** on exact source freeze `a60a4e113288e4fcbd1bc61cec50f47b5de2a0d0`. It inspected the actual five-file diff, credential/current-workspace/exact-approval handler contracts, unchanged verifier/default, 64 readback and 30 focused tests, identical emitted JavaScript, and explicit incumbent gateway posture. No material findings. This records root's review receipt; it is not an author self-review or a GitHub human approval.

Root authorized exactly the C0b `SOURCES` value for `channel-adapters.ts` from `6ca080080233039c808d79af0a659ab3f93adb818b59573a99083b1cee015e2c` to `f29fe7502ceb961ad886863c570970d48c4c19969ce2b6fce203a04867deef41`. All metadata, extractors, 29 dispatch contracts and other source pins are preserved. The final-head receipt records the actual focused binding test result; this scalar reconciliation does not waive CI or allow runtime/config mismatches.

Actual requested command `node --test scripts/ci/c0b-incumbent-resource-binding.test.mjs`: **59 PASS, 0 FAIL, 0 skipped/cancelled** (94164.7747ms), `work/edge-runtime-c0b-final.log`. This is the real native Node test suite, not a transpiled substitute. The initial sandbox runner was stopped without any assertion result; the protected offline rerun outside it supplied the actual PASS. A separate exact-text check proved that the C0b file differs from a60 only in the one approved scalar (`work/edge-runtime-pin-scope.log`). A clean merge-tree probe against current main `efd55ca6db1c563cf735cdea37258d4c654d0ef2` preserves concurrent Research work; no rebase or working-tree merge was performed.

Root owns final-head review applicability, required exact-head CI, merge, production release/readback and authenticated customer acceptance. READY PR preparation/push is delegated; merge/deployment are excluded from this handoff. Source completion is not production recovery or Chat/Live proof.

## P0 reopened review finding — authenticate every skill path before registry access

The prior source freezes and green receipts above remain historical evidence for their exact heads; they do **not** disposition the subsequent material review finding. PR2271 thread `PRRT_kwDOSAAXqM6tbx8j`, comment4300853892, identified that browser-enabled skills read the privileged skill registry before authenticating the request. Their authority exceptions also reached the generic500 response. The original ten handler cases exercised only the email skill, so that proof did not cover the browser-enabled branch. The existing PC-1 acceptance package (`docs/delivery/pc1-s32c-acceptance-package.md`, preflight5c) explicitly expects an unauthenticated direct skill-runner POST to return401. Livefalse metadata was observed, but that observation did not make the ordering or500 response correct.

Root authorized this narrow handler/test/config-comment/evidence correction atop `aff3c7680fd59f5a69fcf13abe75e64e93d929bd`. This supersedes the earlier no-handler-edit lease for this finding only. No new executor, authority engine, browser permission, provider activation or capability registration is introduced. The intended outcome is the existing skill door refusing invalid sessions and unattended infrastructure before privileged skill lookup, while retaining the authenticated owner's existing governed path.

The repair runs the **existing** server caller resolver and canonical `decideSkillRun` gate before the skill registry lookup. The requested slug is an audit label; it does not select a different risk or permission classification. Missing, forged, expired or revoked-session results return401; Auth errors cannot authenticate a returned user field. Profile/authority response errors cannot grant workspace or approving authority. Exact internal service credentials remain infrastructure, retain the canonical403 mutation refusal, and no longer acquire a human audit identity from a body label. No service browser delegation is added.

For authenticated people, existing Secure Browser authority remains an additional current-session/workspace/role/contact check before a run or interpreter call. Known authority refusals return401/403. A session or active-workspace change between the two authority checks refuses without execution or replay. Existing browser control-plane, budget, consent, tier, role and provider gates are unchanged. The exact-draft sender approval, scoped single-use confirmation, provider refusal, durable domain writers and uncertainty handling remain unchanged.

Caller compatibility was inspected: `src/pages/admin/SkillsHub.tsx` uses ordinary authenticated `supabase.functions.invoke`; `paige-mcp/index.ts` forwards an exact service credential plus actor labels. That infrastructure request cannot manufacture a person's browser approval. Its previous browser branch bypassed the shared service-principal restriction by resolving a body-named human first; it now receives the same governed refusal as other skill paths. A separately authorized delegated MCP browser flow remains outside this correction, not a capability claimed restored here.

### Configuration decision

Keep the explicit function-specific `verify_jwt=false`, matching observed skill-runner140. Only its explanatory comment changes in this correction. The handler now supplies the strict credential-first boundary required for that posture; no global verifier/default change or production metadata modification is made. No historical evidence establishing the origin of livefalse has been discovered, so that origin remains **UNVERIFIED**. The accepted401 contract is repaired in source rather than being relabeled or excused. Current official Supabase guidance distinguishes [gateway and handler authentication](https://supabase.com/docs/guides/functions/auth-headers); [getUser](https://supabase.com/docs/reference/javascript/auth-getuser) performs server-verified user retrieval. This patch reuses the existing client and authentication contract; it does not adopt another auth framework or token type.

### Fresh bounded proof and remaining release gates

- Failing-first actual browser-enabled handler campaign: **17 FAIL / 9 PASS**, `work/skill-browser-auth-red-actual.log`. It demonstrated the registry-before-auth/unknown-skill disclosure, inconsistent browser500 responses, and service-principal normalization gap. The preceding sandbox run failed before tests on Windows temporary-file rename permissions (`work/skill-browser-auth-red.log`); it supplies no passing assertion evidence.
- Additional service audit-identity negatives: **2 FAIL**, with27 tests excluded by the deliberate name filter, `work/skill-service-provenance-red.log`. Both demonstrated the body-named user reaching the service decision; source now normalizes that principal's userId and audit actor to null.
- Complete final focused run: **48 PASS, 0 FAIL, 0 skipped** across two suites, `work/skill-browser-auth-frozen.log`:29 actual handler/type-erasure cases plus19 incumbent canonical governed/email-approval cases. Cases include browser missing/forged/expired/revoked credentials, Auth returned-error/throw, strict service refusal, current nonmember/role revocation, session revocation between checks, real workspace transition, foreign contact, body-spoofed authority, valid ordinary owner, authenticated unknown/inactive skill responses, unchanged CORS, provider hold and exact confirmation refusal.
- Final focused ESLint PASS (`work/skill-browser-auth-frozen-eslint.log`); actual `tsconfig.app.json` semantic program rooted only at the handler test and its imports:0 owned/0 imported diagnostics (`work/skill-browser-auth-frozen-types.log`), not full-application or hosted Deno green. Parser diagnostics0 for handler/test, whitespace PASS, existing Spine registry lint PASS214 (`work/skill-browser-auth-spine.log`), repository runtime/config contracts2 PASS (`work/skill-browser-auth-config-contract.log`).
- Actual complete `Deno.serve` handler and real authority/decision/approval modules execute in the protected fixture. Auth/database/model/interpreter/provider I/O ports are synthetic and all outbound network is forbidden. The positive browser case reaches only a held interpreter port and truthfully returns cancelled/needs_config; it proves authenticated routing and scope, **not** browser execution, hosted Auth cryptography, provider readiness, customer acceptance or Live completion.
- Source review packet: `work/skill-browser-auth-review-inputs.json`, with exact old/new normalized and canonical handler SHA-256 values, parser diagnostics and unchanged protected source checks. `skill-runner/index.ts` is absent from the actual `incumbentSourcePaths` list; therefore this correction proposes **no C0b SOURCE scalar changes**. The previously reviewed channel-adapters scalar, all metadata/dispatch/other pins, verifier, affected graph and deployment workflow remain unchanged. No pin was renewed automatically.

The48-case proof is source/control-flow proof only. Root owns distinct review of this correction, review-thread disposition, new exact-head CI (including hosted compilation), push/merge, production source/config readback and authenticated acceptance. The earlier CI does not certify the new head. No production request, browser/provider operation, secret or credential change, feature activation, customer write or deployment was performed. Recovery must retain credential-first rejection; rolling this handler repair back to the insecure ordering is not a safe production rollback. Use a reviewed forward correction or the existing governed function retirement procedure if needed; do not weaken the source verifier or turn unsafe execution back on.
