# UI delivery evidence: native Chat question continuation

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Bug/Repair trace on main `8232051a66d5a26446a8ae6dd139743debd0c808`: existing ASK_USER -> native bound-answer admission -> scoped liveness -> unique claim -> post-claim binding -> model continuation -> canonical/wire settlement. Installed Flow-by-Flow and routed implementation, verification, delivery and orchestration instructions read; protected states and neighboring seams are below.
PAIGE_UI_DESIGN: PASS: project router, upstream/vendor instructions, accessibility, quality gates, review/testing, owner-intent, protected-behavior and release-evidence references read. Impeccable context ran for `paige-ai-chat/index.ts`; no matched concrete UI surface and no UI files changed. Helper detector completed successfully. Existing unrelated design-sidecar drift was not edited.
MATERIAL_FLOW_CHANGE: NO: this repairs the server's interpretation of its own admission marker to restore the existing approved question/answer continuation; it introduces no choice, control, state, route, side effect or permission.
FLOW_PROTOTYPE: NOT_REQUIRED: the existing ASK_USER answer flow and recovery states are retained; this bounded repair restores their implementation without designing another interaction.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the person answering a saved Chat question can select Use this, type an answer or skip, then continue the same objective once through the existing server claim.
VISUAL_DIRECTION: PASS: existing Paige Chat question card, composer, transcript and canonical state renderer; no style, geometry, copy, token or motion changes.
AUTOMATED_EVIDENCE: PASS: focused served-handler fixture 17 checks plus 9 history controls; fresh local PostgreSQL fixture 11 native contracts, 2 actual-handler checks and 6 history controls; whole incumbent client-memory authorization harness 1,035 passed, 0 failed; incumbent interactive lifetime check passed. Exact commands and proof boundary are below.
STATIC_EVIDENCE: UNVERIFIED: full composed-head static acceptance is owed. Changed helper/test ESLint, helper TypeScript check, test syntax and diff whitespace checks passed. Full Chat ESLint still reports the identical 398 baseline errors at immutable main: 392 no-explicit-any, 2 prefer-const, 4 ban-ts-comment. Global ancestry fingerprints and exact composed-head CI remain integration work.
RENDERED_EVIDENCE: UNVERIFIED: this server-only work did not render the existing Chat surface. No screenshot or viewport result is claimed.
BEHAVIORAL_EVIDENCE: UNVERIFIED: a signed-in browser drive and real-model continuation are not collected in this worktree. The real served Chat handler passes locally through native PostgreSQL admission, executor, unique answer append and settlement with a valid local provider SSE stub.
AUTHENTICATED_RUNTIME: UNVERIFIED: local synthetic actor/workspace and role-scoped native SQL prove the fixture contract, not a deployed authenticated customer exchange, current production schema replay or rollout activation.
KEYBOARD_FOCUS: UNVERIFIED: controls and focus code unchanged; no browser keyboard drive in this slice.
ZOOM_REFLOW: UNVERIFIED: layout unchanged; no new zoom or reflow capture in this slice.
REDUCED_MOTION: UNVERIFIED: motion unchanged; no rendered reduced-motion drive in this slice.
STATE_COVERAGE: PASS: local controls cover own native admission, marker-free control, repeated answer, pending/answered/reopened history, forged JSON, foreign marker/question actor/workspace, wrong ask/supersedes, unissued question, Stop, intervening ordinary/system messages and a message racing before the claim. Native SQL checks enforce wrong actor/workspace refusal, immutable provenance, delayed-intent supersession and the actual partial unique index.
TRUTHFUL_STATE_LABELS: PASS: the positive handler path stores one FINAL and emits one resumed/completed FINAL; refusals call no model and retain existing interrupted settlement. Tests do not label synthetic rollout state as activation or production success.
SOLO_UI: YES: existing canonical Solo Chat question/answer interaction; no shell, navigation, card, composer or transcript rendering edit.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no rendered capture in this server repair.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no rendered capture in this server repair.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no rendered capture in this server repair.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no rendered capture in this server repair.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no rendered capture in this server repair.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no rendered capture in this server repair.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no rendered capture in this server repair.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no rendered capture in this server repair.
UNVERIFIED: independent composed-head review, exact-head CI/fingerprints, release/deployment, production native contract and activation, signed-in question -> answer -> continuation -> reload, real model behavior, and all browser visual/keyboard/responsive proof. No production operation was performed for this candidate.

OWNER_INTENT: Repair the existing native activated question continuation while keeping one claim per question, actor/workspace/ask binding and the established refusal/recovery behavior.
MUST_NOT_HAPPEN: No blanket system-turn exclusion, JSON-only provenance trust, duplicate continuation, cross-actor/workspace answer, stale answer execution, fake approval or suppression of an ordinary message, Stop or unrelated system barrier.
MUST_PRESERVE: Native admission/executor authority, immutable turn provenance, partial unique claim index, stored transcript, supersession/retirement proof, native RPC ABI, action authorization, approval and idempotency paths, canonical/wire finalization and unchanged frontend controls.
ACCEPTANCE_CRITERIA: On an owner-designated signed-in ordinary Chat account, answer the saved question once, observe the same objective continue, verify one native answer claim and matching canonical/wire completion, resend and receive the existing already-answered response, then reload. Foreign/stale/ordinary-message controls must still refuse. This deployed acceptance remains UNVERIFIED.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Changed/tested: pre-claim answer liveness and post-claim adjacency against exact native admission provenance; historical pending/answered/reopened normalization. Incumbent authorization and interactive lifetime suites pass. Unchanged: CRM door and guard, approval/fingerprints, domain writers, transcript append RPC, unique index, migrations/retirement functions, frontend rendering and People projection. No global source fingerprint was renewed.

INTERNAL_BUILD_IDENTITY: branch=fix/ant21-chat-question-continuation; base=8232051a66d5a26446a8ae6dd139743debd0c808; deployment=none; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/ant21-chat-question-continuation.md
RELEASE_CHANNEL: development: isolated candidate for independent review and coordinator integration; no merge or deployment in this slice.
RELEASE_CLASSIFICATION: internal-only: restore an existing governed Chat interaction; no new provider, permission or data class.
CUSTOMER_RELEASE_IDENTITY: none: candidate is not released.
RELEASE_NOTE_REQUIRED: NO: no customer release or activation occurs in this slice; coordinator owns the eventual release record.
RELEASE_TRUTH_BOUNDARY: PARTIAL: actual handler plus existing native SQL on a fresh loopback PostgreSQL fixture passes; production and browser acceptance are PROOF OWED.
RELEASE_RECOVERY: position=revert this source/test/evidence commit, no migration or stored transcript rewrite; reference=docs/evidence/ui-delivery/ant21-chat-question-continuation.md and coordinator integration review.

## Cause and repair boundary

`paige_chat_interactive_begin_v2` in the unchanged `20271108110000_int346_database_executor_isolation.sql` migration appends an empty SYSTEM supersession marker for a bound answer and returns `turn_id: null`. It stamps native actor, tenant and supersedes columns while leaving native intent and terminal columns null. The protected authority trigger prevents authenticated callers from forging or editing those native columns.

The existing answer checks read newest-first history. They interpreted that native marker as another instruction before the answer could be claimed; even after bypassing the first check, the same marker broke the required claim/question adjacency. This produced the existing ASK_NOT_OPEN refusal and an INTERRUPTED receipt with zero rounds/tools before any provider call.

The repair creates an answer-relationship view, preserving every stored row. An unclaimed current marker is omitted only with the currently checked executor, frozen server actor/workspace, current request's distinct intent/supersedes, an issued native question and exact protected marker shape. Its ID is captured for the post-claim read, which checks the executor again. Historical normalization requires the exact adjacent claim -> protected marker -> issued question triple and the matching claim/ask/intent relationship. Other messages remain barriers. No SQL, uniqueness, writer or retirement change is needed.

## Verification and reproducibility

Use Node with the incumbent `scripts/knowledge-scope/register.mjs` module loader:

```text
node --import ./scripts/knowledge-scope/register.mjs scripts/int336-answer-admission-check.mjs
node --import ./scripts/knowledge-scope/register.mjs scripts/int336-answer-admission-check.mjs --native-db
node --import ./scripts/client-memory-authz/register.mjs scripts/client-memory-authz/check.mjs
node --import ./scripts/knowledge-scope/register.mjs scripts/int336-interactive-check.mjs
node node_modules/eslint/bin/eslint.js supabase/functions/_shared/paige-turn/resume.ts scripts/int336-answer-admission-check.mjs
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --lib es2022,dom supabase/functions/_shared/paige-turn/resume.ts
node --check scripts/int336-answer-admission-check.mjs
git diff --check
```

Native mode requires `PSQL_BIN` and `INT336_DATABASE_URL` pointing to an **empty disposable loopback `int336_test*` database**; it refuses another host/name or an existing Chat fixture schema. It reuses the existing database fixture prelude and applies the original receipt, conversational, executor-isolation and answer-index SQL without editing them. The fixture explicitly enables synthetic rollout state and adds transcript sequence/time columns absent from the minimal prelude. This is native function/trigger/index proof, not production migration replay or the independent activation/retirement gate proof.

Failing-first results at immutable main: the protected module-boundary handler and native PostgreSQL handler both returned 409 ASK_NOT_OPEN where a genuine continuation required 200; the native marker/provenance contracts passed. Removing only the marker in the positive counterfactual allowed a model continuation. Patched results: 17 served-handler + 9 history checks with module-boundary fixtures; 11 native contracts + 2 served-handler + 6 history checks with real native SQL. A second answer returns ASK_ALREADY_ANSWERED, keeps one claim and calls no model.

One early native test bridge attempt incorrectly serialized `p_surfaces_used` as JSONB; correcting the fixture to the existing text-array ABI resolved its persistence-unconfirmed error. Product SQL/ABI was unchanged. The local PostgreSQL server uses a task-owned data directory and loopback-only port; it is stopped after verification and its fixture evidence is retained. No credentials, production database or business mutations are used.

## Review and limitations

This is author evidence. The coordinator owns independent review, composition with neighboring work, minimal source-fingerprint renewal, hosted CI and release acceptance. The fixture model emits a complete deterministic SSE response and performs no CRM effect; it does not prove a real model will select any particular next action. Browser and authenticated production acceptance remain explicitly UNVERIFIED.
