# PAIGE conversational loop — C4: one resume for a paused objective

## 2026-10-08 authenticated read-acceptance driver preparation

`scripts/proof/int304-authenticated-observation.mjs <explicit-QA-fixture.json>` uses the existing
synthetic `PROOF_EMAIL`/`PROOF_PASSWORD`/`PROOF_ANON_KEY` injection pattern (existing `LIVE_DRIVE`
email/password names also accepted). Identity/QA owns provisioning and approved secure injection;
this runner searches no secret stores and creates no account, thread, intent, operation or artifact.
Without an explicit fixture it reports BLOCKED before credential/environment or network use.

The fixture contains only pinned actorId, tenantId and a bounded list of existing thread/intent
and effect/work references, named expected observations and expected held-executor state. It grants
no permission. A genuine session is minted with the public key on the fixed canonical project;
service keys/tokens are rejected. Server user/current-tenant reads surround every status-only
request, and each case is reread. Session logout is local to this fresh proof session. Neither
activation nor executor admission, release, retry, effect dispatch or fixture mutation is called.
Output contains bounded case states, not passwords, tokens, account email or raw business payloads.

Eleven recording-double controls PASS, covering actor/tenant drift, service keys/sessions, uncertainty,
unavailable durable evidence, replay reads and held ownership. The returned-service-token control failed first (an unauthorized logout request), then passed after validation before token assignment. These are driver regressions, not
authenticated production proof. A production PASS of unavailable-only cases establishes only those
negative read contracts; positive authoritative outcomes/artifacts require their own fixture cases.
The driver always reports Solo UI and security clearance UNVERIFIED and continuation NOT_RUN.
It cannot establish C4f Chat/Live acceptance or waive INT-346. No production drive occurred here.

## Required-CI correction before release

Fresh main163cca44c6994aac72c136cc6b19ec7835e24673 and production migration history both contain the separately owned Sales migration13. The unmerged observation migration is therefore renumbered14 before release; its SQL is unchanged. Initial12 was never merged or applied to production. No out-of-order deployment or production migration-history rewrite is permitted. Both existing delivery rows are preserved during fresh-main reconciliation.

Exact-head CI rejected an observation-only retired coach role exemption. The initially reserved migration12, now collision-free migration14, uses the current Document owner/admin permissions established by the canonical retirement migration; native permission controls failed first and pass34/34 after repair. No title-authority exemption or required-check waiver was added. Two incumbent MCP tests now assert actual registry membership and validation instead of a closed three-domain source string, retaining field-for-field checks and adding forged-tool/class/risk/approval rejection controls;24 tests PASS. Fresh non-author review and exact-head CI are required on the repaired composition before merge.

Fresh main f2fc41666178c60c2a1c639548f71043a22b556c adds the separately owned metric read. Registry composition retains both registrations and declares only its incumbent tenant/member Chat seat, fixing an actual missing-authority lint failure without editing Analytics implementation or extending the issuer permission. The issuer retains its narrower owner-grantable permission. Combined metric/registration/MCP tests54 PASS and actual Chat status handler PASS; all hosted checks and non-author review must be repeated on this fresh composition.

## 2026-10-08 durable observation in the canonical authenticated status consumer

This candidate adds read-only `interactive.workId` observation to the existing status branch.
It creates no scheduler, worker, receipt, approval or continuation executor. Ten routing answers:
(1) preserve the original conversation's durable identity; (2) Conversational Loop owns consumption,
Document/Research own artifact production; (3) reuse `paige_durable_work` and protected Chat turns;
(4) authenticated `read_paige_durable_observation` is an observation seam only; (5) no provider/model
call; (6) current JWT actor, tenant, owned thread, latest intent and current seat are revalidated;
(7) no dispatch, transition, wake, retry or settlement; (8) terminal lineage and canonical artifacts
are checked without returning raw payloads; (9) incumbent status presentation remains unchanged;
(10) rollback PostgreSQL and actual-handler doubles prove behavior, not production authentication.

The caller supplies only UUID references. Document work uses its existing derived domain intent;
the original protected assistant turn binds that work to the conversational intent. Research uses
the same envelope and requires an exact work-linked canonical result. Legacy Research runs without
`work_id` remain unavailable. Missing, stale, foreign or contradictory evidence grants no authority.
Pending approval authority is unavailable; a cancelled or expired work record cannot authorize
resumption. `durable_work` is separate from executor settlement; executor state is reread after all
awaited observations. Neither observation nor a verified artifact releases the execution lock.

Failing-first: the two new status assertions failed against the original six-test helper, then
eight passed after integration; combined-observation/concurrent-authority controls bring status
coverage to ten tests. Independent review identified stale readback and numeric Research findings:
ten new adapter race controls failed first, then eighteen adapter tests passed after a final
caller-bound canonical reread; the numeric-finding native control also failed first. All thirty
native checks pass, and the artifact-success bypass mutant is rejected. Actual loaded-handler regressions
exercise DRAINING and caller-JWT-only durable reads with no provider call, insert, preparation,
dispatch, receipt append, state transition, admission or release. Native rollback tests exercise
the real migration against an isolated dependency schema, including artifact-success mutants.
Final immutable-head review, required hosted CI, merge, deployment and production readback remain pending.
Authenticated Solo acceptance, automatic reconciliation and consequential C4d/C4e continuation
remain UNVERIFIED. This is an independently safe consumer, not completion of runtime continuation.

## 2026-10-08 original-operation observation in the existing status path

PR #1871 merged as `466a33dd33ae59d3a6c5d170355c0447f3d13068`, exact reviewed head
`33021e46039a44b89e209a9713986ed6106856b7`, fresh base
`539ed407acb7ff23ad6bd53ec64c3017f6bdc506`. Independent NON-AUTHOR SHIP (`6069967618`);
nine check runs and both Vercel statuses SUCCESS. Verify `37850825613`/`113563131252`,
database-contract `37850825583`/`113563009319`. Production Edge workflow
`37852543308`/`113568823842` SUCCESS, Chat version369/verify_jwt=true; returned source for Chat
and the three new helpers matches normalized SHA256 of reviewed source. Exact-SHA Vercel
`dpl_7VM4mygKKgZ5sCSJazjEJJfoavxT` production READY. Production rollout active=false,
activated_at=null. Readback record: PR comment `6070188351`.
This is an observation consumer, not automatic settlement or C4d/C4e runtime completion.
Authenticated acceptance, fresh specialist rendering and security clearance remain UNVERIFIED.

Pre-edit routing: (1) the owner wants PAIGE to verify the original Pipeline operation;
(2) Conversational Loop owns this status consumer, Pipeline owns its records;
(3) the existing authenticated interactive status path consumes the reviewed canonical readers;
(4) the original protected card/intent resolver and existing catalogue/operation ledger remain the
callable seams, with no new capability or execution binding;
(5) no provider connection or model call is used;
(6) fresh caller, current tenant, owned thread, original actor/intent/effect and current admin permission
are required by the existing resolver;
(7) no job, event, scheduler, receipt or retry is created;
(8) exact receipt hash and business-record version establish readback, contradictory evidence stays unknown;
(9) existing Solo status polling retains its executor semantics, with no UI/layout change;
(10) handler doubles and deterministic regressions prove code behavior, not authenticated production acceptance.

An optional UUID `interactive.pipelineEffectId` references the existing server-issued operation;
it supplies no command, tenant, actor or permission. Status requests can read while DRAINING.
`original_operation` is separate from `executor_active` and `settled`; executor state is reread
after awaited observations. No observation releases ownership, issues a terminal receipt, retries,
activates execution or relaxes the `outcome_unknown` successor-write brake. Responses are no-store.
Ordinary status requests preserve their prior response shape.

Failing-first: extracted legacy status behavior failed three of six behavioral assertions, then all
six passed after enrichment. The actual loaded handler proves DRAINING successful readback with a held
executor, foreign tenant/actor, stale version, absent original and missing receipt, without inserts,
provider calls, admission, append, settlement or release. Resolver/catalogue calls are caller JWT-bound.
Existing canonical readback tests retain actor-switch, stale-intent, concurrent observation and replay
coverage. Revoked-permission and forged-effect handler controls are included in the final regression.

Runtime continuation and automatic settlement remain gated by INT-346. This consumer does not turn
the historical closure of #1807 into completion. Provider cessation (#1822), synthetic authenticated
Solo access (#1832), and C5 consultation authority D2 remain with their existing owners.

## 2026-10-08 C4e preparation-only durable adoption

**Preparation implementation MERGED; migration PERSISTED. Runtime activation, authenticated Solo
acceptance, owner acceptance and INT-346 security clearance remain UNVERIFIED.**
PR #1862, exact reviewed head `71d293d6bc46f98c235f8f40dd657386b4991d05`, merged as
`e633b13651b6916120cf7f7cf96dbe19eca2ee44` after composition on fresh main
`ccc3ee995a9bdfe906a433ac7b3e186282efbb77`. Independent non-author SHIP:
PR comment `6067296062`. All 11 hosted checks SUCCESS, including Supabase Preview job
`113488834668`. Verify run `37828630182`, job `113488568415`: 674 files / 10156 tests,
Sales 319, invoice 69 and native C4e 37 checks PASS. Database-contract run `37828630259`,
job `113487888587` SUCCESS. Migration deployment run `37830974520`, lint job
`113495916629` and deployment job `113496082375` SUCCESS.

Production read-only verification found migration `20270601000011` persisted; function body MD5
`f80f0a582a4bb921888326ac374bb1f3` matches merged source, SECURITY DEFINER with empty search path,
service execute true and authenticated/anonymous execute false. `interactive_active=false` remains.
Vercel `dpl_CqRciNpVdiLZQr2gbSX83dX5jjaV` READY at the exact merge. Production channel,
internal preparation patch; no customer version or announcement. Edge deployment NOT_APPLICABLE;
no worker, UI or runtime activation. Recovery must preserve blocked preparation and immutable identity;
use a reviewed forward migration rather than promote stored audit snapshots into permission.

QA handoff #1832 is NOT READY: its owner must provision the approved synthetic account and inject
credentials into the existing runner. No secret search is authorized. Provider-cessation proof #1822
is separate; deployment or a blocked prepared envelope does not establish that clearance.

This is a service-only preparation seam on the existing Harness envelope,
not a research scheduler, worker, approval engine, model router or receipt system.

Owner outcome: preserve the original research assignment and canonical durable identity so a future
authorized continuation can finish it in the original conversation. Shared Harness/Conversational
Loop owns preparation; Deep Research retains its existing provider/results architecture. The existing
`deep_research` tool's durable/Spine continuation binding remains UNAVAILABLE; no new model tool or
surface-ledger state is declared. Provider connections are not used. This performs an internal
reversible work-metadata write, not a provider effect; no new mutation approval channel is added.
Authority/budget/approval context is an audit snapshot and must be revalidated before any later
dispatch. Existing Trust/approval/budget controls remain mandatory. Signed-in/provider acceptance is
owed; fixtures establish persistence semantics only.

`prepare_paige_research_work` validates a bounded original question/options payload, preserves
tenant/actor/thread/intent/scope epoch and canonical authority snapshot, then uses the existing
`create_paige_durable_work` and `transition_paige_durable_work` inside one transaction. New work is
blocked with `research_execution_not_enabled` before commit. Exact retries return the same work ID;
changed payload/scope/authority conflicts, revoked membership/archive scope and dispatched/terminal
replays fail closed. The payload uses the existing immutable request fields. Browser execution is
denied; the private dispatch key is not returned. No wake, cron, provider request, fake research run,
success receipt, conversation resume or executor activation is added.

Local baseline without the preparation RPC failed at the actual call. The completed migration passed
37 real PostgreSQL checks in an empty localhost rollback fixture: identity/objective pinning, exact
replay, changed inputs/scope/budget snapshot, foreign actor/tenant/thread, removed membership,
archived conversation, immutable payload, terminal/dispatched replay, browser denial, one blocked
envelope and zero results/dispatch. The native runner is in the required CI database step.
Migration 11 was CLI-created and follows verified main/production 10; active future-tail PR migration
lists contained no collision. SQL authority linters and script syntax passed.

Runtime follow-through remains gated: a genuine server consumer must freshly resolve authority,
approval/capability/budget, dispatch using canonical ownership, bind actual `research_runs.work_id`,
verify run/source persistence and consume continuation exactly once. Current document recovery
excludes research and is not repurposed. Original inline findings/citations and saved Research library
remain governed by the approved R2b design (`docs/evidence/ui-delivery/e-deep-research-r2b-inline.md`)
and the frozen C3 turn prototype. No visible interaction or design changes are made here.

## 2026-10-08 independent safe slice — #1807 readback and C4d/C4e foundation

**Read-only implementation MERGED/DEPLOYED; authenticated acceptance UNVERIFIED.**
PR #1859 merged as `af5df1c8a2a6da336dffc4c2d045e1b56ade2c29`; independent non-author SHIP on
`44eec75c462c710cf86c0d0d3fc87bbeadbf19ec`, base `d85d5e607ae924646bf48420b214e643c47b1dd6`.
All 11 hosted checks and both Vercel statuses SUCCESS. CI run `37824303704`, verify job
`113473151128`: 672 files / 10138 tests PASS, plus Sales 319 and invoice 69; build, TypeScript,
new Edge Deno check and the new native PostgreSQL read-only proof PASS. Database-contract run
`37824303663`, job `113473025856` SUCCESS. Independent review: PR comment `6066418468`.
Migration deployment `37825798813` and Edge deployment `37825798702` SUCCESS; migration 10 persisted.
Production endpoint ACTIVE v1, JWT verification true, bundle
`135d900501ce930577d57b761613669794d00e637defcc72434baa4b642db33f`; all five deployed files match
merged source. Function body MD5 `aa45019746eeb0d313091f81a1e959e1` matches; authenticated execute
true, anon/service execute false, empty search path, stable read-only function. Unauthenticated POST
401 is gateway refusal only, not signed-in acceptance. Vercel `dpl_J6kfitq9nW498zD3UmP5Q8JAFpUA`
READY at exact product merge. C4d/C4e pure foundations are merged; no runtime consumer is deployed.

INT-346 #1823 is accepted merged
at `c43eeec244967b4711dbfe44b7bc8802755fb460`; DRAINING and security clearance UNVERIFIED remain.
This change does not activate or alter that protocol. Production read-only foundation patch;
interactive execution stays staged DRAINING. No customer version, name, announcement or visible flow change.

### Routing and shared-platform contract

1. Owner outcome: independently check whether an exact Pipeline metadata action actually applied,
   without repeating it. This is the business-action-to-evidence seam for the shared COO architecture.
2. Domain: Pipeline owns canonical metadata/operation semantics; Harness/Conversational Loop owns
   the readback adapter and durable-context foundations. No Sales, Marketing or Operator edits.
3. Shared layer: existing canonical Pipeline command ledger and protected INT-346 transcript;
   C4d uses the existing `paige_durable_work` internal envelope and C4 resume architecture.
4. Spine discovery: automatic Pipeline metadata reconciliation and continuation remain UNAVAILABLE
   as callable Chat/Live/specialist bindings. The new read endpoint does not invent a model tool.
5. Provider requirement: internal canonical database records; no new connection, Integration Registry
   provider or external operation. Research provider execution/adoption is unchanged.
6. Risk: read_only, no mutation verb or new approval/budget/autonomy lane. Existing Trust and one
   approval gate remain controlling; projections never confer consequential authority.
7. Jobs/events: no scheduler or event producer added. Durable continuation contracts consume the
   existing envelope only; no wake, claim, cancellation write or new receipt store.
8. Proof: exact tenant/actor/operation/hash plus current Pipeline UUID/reference/version/metadata.
   Missing, conflicting, newer or insufficient evidence stays unknown. No Rail/receipt is issued.
9. Surface: existing `campaigns.pipeline` / PAIGE workspace ledger states do not change. No UI change.
10. Acceptance: synthetic deterministic and real localhost PostgreSQL proofs establish code behavior
    only. Legitimate signed-in Solo acceptance remains UNVERIFIED, never inferred from service fixtures.

### Implemented code

`read_pipeline_metadata_original` resolves only the signed-in actor's currently selected tenant,
owned thread, protected original intent and exact server-issued consumed Pipeline approval row.
One protected approval observation must reference that exact token. It derives command/key and
PostgreSQL `md5(command::jsonb::text)` independently of the operation receipt; legacy client JSON,
foreign scope and contradictory token observations resolve unavailable. This authenticated read-only
RPC grants no execution authority. Migration `20270601000010` follows verified main/production 09
and active-PR collision checks.

`paige-pipeline-outcome` validates a real user through `getUser`, derives actor/tenant server-side,
accepts only thread/intent/effect UUID references, bounds input and returns a bounded no-store result.
Its shared adapter revalidates scope around canonical operation/catalogue reads and independently
re-resolves the original command after them. Exact atomic success plus exact current metadata gives
confirmed_success; lost responses/missing receipts/conflict/stale version give outcome_unknown.
It does not settle, release, retry, continue a model turn or change admission.

The internal observation projection distinguishes authoritative refusal before dispatch and explicit
non-application from unknown. It is not an authentication boundary: request booleans cannot establish
authority. The metadata writer persists no canonical failed receipt, so timeout/absence/unchanged rows
never produce confirmed_failure. Runtime failure/refusal integration still needs a canonical protected
producer; this endpoint currently returns only verified success or unknown.

C4d's pure continuation contract pins canonical work/actor/tenant/thread/intent/epoch/capability/kind
and original objective, revalidates authorization/budget/capability context and denies approval-pending,
interruptions, supersession, replay, unknown and unverified terminal state. C4e adds exact research
work/run/source/citation lineage, rejecting duplicate source indices even when excluded rows appear
first. Returned eligibility is context-only, never dispatch or atomic continuation permission.

### Executed local proof

- Pipeline observation missing implementation: 16 failing-first tests; implementation: 16 PASS.
- Read adapter: behavioral RED then GREEN; concurrent original-command replacement: 1 RED / 14 PASS,
  repaired to 15 PASS. Canonical resolver: 2 RED / 13 PASS, repaired 15 PASS.
- Actual shared endpoint handler: 10 RED / 1 PASS, repaired and expanded 13 PASS (auth rejection,
  body authority forgery, missing effect, malformed/oversized input and real adapter success path).
- Durable/research deny-all stubs: 4 RED / 38 PASS; implementation 42 PASS. Independent review found
  excluded-first duplicate citation ambiguity; added regression RED 1 / 17 PASS, repaired to 44 PASS.
- Native PostgreSQL negative control omitted the new RPC and failed at its first real call; migration
  then PASS: PostgreSQL command hash, exact identities, replay, switched actor/tenant, unissued/unspent
  proposals, conflicting observations, forged legacy JSON, role ACL and unchanged DRAINING/executor.
  This runs in the required CI native database step, not just a structural test.

### Remaining integration gaps and ownership

Conversational Loop: consume readback inside the original objective and perform governed settlement
only after INT-346 clearance. Durable continuation: canonical authorized server adapter and existing
atomic consumption/recovery/cancellation seams still need runtime adoption; no fixture boolean is
fresh authorization. Deep Research currently omits `research_runs.work_id` in its producer; this
assignment owns canonical durable adoption, original budget/approval preservation and verified result
delivery. Shared Chat/Live/specialist discovery/context and authenticated modality acceptance remain
owed; no independent chat-specific orchestration was added. Provider Operations #1822 and Platform
Identity/QA #1832 retain their external handoffs; neither is polled or bypassed by this slice.

Next authorized slice: complete canonical failure/refusal observation producers and non-activating
Deep Research durable adoption, preserving the same protected outcome/continuation contract. Gated
executor settlement and consequential resume stay unavailable until trusted release clearance.

Owner order (Antonio Cook, 2026-10-05, binding): WAIT_APPROVAL, ASK_USER and WAIT_WORK are three
reasons ONE objective paused — not three workflow systems. A resume keeps the thread, the objective,
the active workspace and its scope, the prior tool/result state, the exact pending dependency, the
work ids, and runs each act exactly once. For approval: "today the UI hides the synthetic approval
turn but the server starts a separate request and the model reconstructs the objective — C4 must fix
the runtime, not the presentation." After Approve the server carries the exact approved work forward;
the model is never asked to regenerate the approved call; the one approval gate and the stored
fingerprint/arguments stay. No new `approved:true` flag, no model-authored confirmation, no second
approval store, no hidden bypass. Human approval stays wherever Trust requires it; the manual UI stays
fully supported.

This file is the C4 record: the pre-edit packet summary, then each slice as built. C4a is the approval
kind for general-gate, thread-scoped proposals (§2). C4b extends the same resume seam to door-scoped
proposals — crm-command, the Sales doors, growth-publish-command (§2b). C4c adds the answer kind:
PAIGE asks one question, waits, and the same objective resumes on the answer (§2c).

## 1. Pre-edit packet (summary)

Full packet: the C4 plan (sections 0–9), grounded read-only against `5307015f6` (= `origin/main`).

- **Mode / depth.** Existing Project (repair) + New Feature; Deep; risk R3 (approval authority,
  persistence, cross-workspace scope). Independent review required.
- **Flows.** F2 decide on a proposed action (owner and team member, Solo / sub-account / agency
  drawer; Studio sends its thread and so takes the same server path); F5 reopen a saved thread. F3
  (ask-user) and F4 (durable work) are C4c/C4d. **Operator is NOT covered:** its client deliberately
  sends no `threadId` (`src/operator/data/useOperatorChat.ts`), the resume requires one, so an
  Operator approval still depends on the model re-emitting it — open work under owner gate 1 (§2.1).
- **What was broken (production, 30 days, read-only).** 28 approved general-gate proposals; 14 never
  executed — the model did not re-emit the call on the approval turn, and nothing else could run it.
  Latest strand 2026-10-04 17:26. Door-scoped: 8 of 21 stranded (C4b). The system prompt meanwhile
  told the model never to re-emit an approved act — the two rules could not both be followed.
- **Exactly-once already present.** The compare-and-set claim on `consumed_at IS NULL` with exact
  user / tenant / thread / client scope and `issued_in_request ≠ this request`. C4a reuses it; it adds
  no store.
- **Boundaries.** No migration in C4a. Door rows (`thread_id NULL`: crm-command, sales, growth-publish)
  and the client-side CRM / pipeline lanes in `PaigeAIChat.tsx` are C4b and are untouched. ASK_USER and
  WAIT_WORK are untouched.

## 2. C4a — as built

### The server (`supabase/functions/paige-ai-chat/index.ts`, `_shared/paige-turn/resume.ts`)

1. **Resolve (before PAIGE is asked anything).** After the scope and thread checks and the pre-egress
   workspace check, every approved token of the form `<scoped fingerprint>:<request uuid>` is matched
   to a stored proposal selected under the claim's own predicates: this user, this thread (non-null),
   this workspace (or the platform's null), this focused client, server-issued, never minted by this
   request. The row must pass the integrity check its card token was minted under
   (`confirmationToken`), and its tool must be a governed general-gate write (`isResumableTool`: in the
   mutating set, not a door tool). The read is also narrowed to the exact requests that minted the
   approved cards (`issued_in_request IN …`), so consumed rows an earlier proposal of the same act left
   behind cannot crowd the live one out of the bounded read (39.16). **The capability fingerprint:** the
   row's tool must be one THIS turn offers (the final tool list — manifest, Studio scope, funding,
   presets). A model can only emit an offered tool, so the old re-emit path was implicitly bounded by
   that list; a call rebuilt from a stored row must be bounded the same way, or a tool withdrawn since
   the card was shown would run. One that is not offered is not run and its approval is left unspent;
   the card says "That approval no longer matches anything Paige can run" (39.17, 39.17b, 39.20b). Before
   this check, an owner-seat approval of a stored proposal for the legacy CRM stage writer (removed from
   the manifest, dispatch branch tombstoned) was claimed and reached that branch — driven in the harness.
   A live row becomes one synthetic call
   `{id: resume_<token>, function: {name: row.tool_name, arguments: row.args}}`; the token is pinned to
   that id in a server-only map (`resumePin`) — never through the arguments. A row reads its own state
   from its two timestamps (`storedRowState`): consumed inside its window → used elsewhere (it may have
   run); unused past its window, OR stamped consumed at/after `expires_at` → expired. Only the expiry
   sweep in `recordConfirmation` can write that last shape (it stamps rows already past `expires_at`;
   the claim and the decline only stamp rows inside it), so a swept row no longer reads "may already
   have happened" (39.9b). A failure here degrades, loudly, to exactly
   the old behaviour.
2. **The first model call is lazy on a resume turn** (`response = resumeCalls.length ? null : …`). Every
   other turn makes the call exactly as before.
3. **The resumed round.** In the stream, after `started`, the server sends `paige_turn {event:
   "resumed", state: "WORKING"}` (an existing `TURN_EVENTS` value; no new frame key, no new mode) and
   the synthetic calls become round 0 of the same loop — the round the model used to spend
   re-emitting — dispatched through the existing `executeToolCalls`: Studio boundary, seat, role,
   autonomy lane, the risk gate, the CAS claim, the stored-args overwrite, `approvalSpend`, audit
   (`authorised_by: operator_card`), Rail, receipts (now keyed per approval, because `tc.id` is
   deterministic), the C2b step frames, then the existing round tail pushes the assistant `tool_calls`
   and results into the conversation and makes the first model call. PAIGE reads the result and
   continues the same objective.
4. **Guards added inside the existing gate.**
   - A resumed call whose lane moved to `auto` since the card is put back on `confirm`, so it still
     spends its approval (the claim is the exactly-once). `off` still refuses.
   - A resumed call whose claim fails never becomes a fresh card: re-reading the row tells "another
     request used it" (→ can't confirm) from "the claim could not run" (→ nothing ran, a check failed)
     from "it expired between selection and claim" (→ expired; PAIGE is told `approval_expired`, 39.9c).
   - While the reply holds a carried-forward act, any OTHER call to the same tool has an `auto` lane put
     back on `confirm`. A re-emit whose arguments drifted is not recognised as the same act (no stable
     subject id), so on a lane moved to `auto` it used to run a second write (verifier probe VFY-A); it
     now becomes a card the person sees (39.13).
   - A model re-emit of an act the resume handled (same tool and arguments once the gate's settled keys
     are set aside, or the same subject id) is refused as already handled — no second run, no new card.
     The subject-id half (39.14) matters because a re-authored `draft_content` is part of the act's
     identity. **Accepted cost (compliance finding 7):** for `action_advance` — the only tool with a
     subject key — a genuinely different second change to the SAME action inside the same reply is
     refused too; it can be proposed on the next turn. Keying on act identity alone would re-open the
     re-ask loop for re-authored drafts.
   - The approved-set lookup never spends a resume-handled approval, nor another approval on an act the
     resume already carried forward.
5. **The prompt.** Rule 1 of the standing prompt stays NEUTRAL, because most approval turns are not
   resumed (door proposals, legacy bare tokens, Operator, a resume that failed to resolve) and have no
   result to point at: never re-construct or re-emit an approved action; when the conversation holds a
   tool result for it, that result is what happened (success words only on success), then continue;
   when there is no such result, do not say the action ran. Only on a turn that carried an approval
   forward does PAIGE get a turn-local system note (`RESUME_TURN_NOTE`): the approved act was put
   through the gate before she was asked anything, its result is the tool result in the conversation —
   it may have run, been refused or be unconfirmable; do not call it again or re-ask. Proven both ways
   on the operator prompt (which carries rule 1): 39.12 (resume turn: note present, rule neutral),
   39.12b (bare-token approval turn with a second model call: no note, no "it ran" claim).
6. **Outcomes, wire and record.** One reading per resumed approval (`classifyResumedApproval`, the
   existing closed outcome set plus one new sentence for expiry) feeds both the
   `paige_approval_outcome` card on the wire and the saved turn: `turn_state.resumed = {kind:
   "approval"}` (closed enum; `contract.ts` + `readTurnRecord`) and `bundle_ref.paige_resume = {kind,
   from_turn_id, outcomes: [{tool, outcome}], approval_outcome}` — `approval_outcome` is the wire frame
   verbatim, read back defensively (card tokens, closed kinds, closed sentences only).
7. **Unchanged.** Decline; door proposals; legacy bare tokens; Live (voice) turns carrying any approval
   are still refused (403) before anything runs; document turns.
8. **Provider failures on a resume turn (by design, verifier finding 7).** The first model call now
   happens inside the stream, after the resumed round, so a 429 / 402 / 5xx no longer becomes an HTTP
   status: the act has already run once, the card says so, the turn ends INTERRUPTED with the fallback
   text, and the saved record keeps `paige_resume` (verifier probe VFY-F). That first call is the loop
   call: it carries no `paige_thinking` (required — thinking would reject a synthetic `tool_use` with no
   thinking block) and its trace job kind is `chat-tool-loop`, not `chat`. Metering and trace readers
   that count `chat` jobs will not see a resume turn's first call under that kind.

### The client (`src/lib/paige-stream/turn-view.ts`, `src/components/dashboard/PaigeAIChat.tsx`)

Render-only; the request is unchanged. When the server said `resumed` (live) or the record has
`turn_state.resumed` (reload), the answer that showed the card and the answer that carried it forward
are drawn as ONE answer (frozen prototype frames a3/a4): one line at the top of the answer that asked —
it restarts on the running step ("Sending to Daniel"), then reads "What PAIGE did" over the steps before
and after the card; no seam between the two bubbles; the report card answers for the act; PAIGE's words
follow. On reload the report card is rebuilt from `paige_resume.approval_outcome` through the same
reader the live stream uses. A follow-up the server did NOT carry forward keeps C3's presentation
exactly. A reader hears "Approved. PAIGE is working" where no report card speaks for the approval (the
drawer). No visible text says "resumed".

### 2.1 Review fixes (independent verifier + compliance officer, both FIX_FIRST)

| Finding | Resolution | Proof |
|---|---|---|
| V1 / C1 (blocking): rule 1 stated as fact that the act ran, on every turn | Rule 1 neutral; the "already attempted" note is turn-local, only when `resumeCalls.length > 0` | 39.12, 39.12b; mutants N6, N7, N8 killed |
| V2 (report): "Studio and Operator share the server path" | Corrected here, in the evidence record and the master doc: Studio resumes (39.20); Operator sends no thread and does not (39.19); Operator tracked as open work under owner gate 1 | 39.19, 39.19b, 39.20 |
| C2 (blocking): resumed act not checked against this turn's tool list | Capability fingerprint: not offered → not run, approval unspent, truthful card; the lookup also cannot spend it | 39.17 (red before: claimed, tombstoned branch reached), 39.17b, 39.20b; N2, N10, MV8 killed |
| C2 test: proposer demoted before approving | Already refused by the existing role gate before any claim; now pinned, with the reinstated role running it once | 39.18, 39.18b |
| C3 (blocking): tier and surface coverage | Per-tier table below; Operator (God, no tenant), tenant persona (Standalone/Sub-account), Studio cases added | 39.17–39.20b |
| V3: drifted re-emit on a lane now `auto` duplicates the act | Same-tool confirm clamp while a carried-forward act is in the reply | 39.13 (red before: two writes); N3 killed |
| V4: surviving mutants MV1, MV6, MV8, MV11, MV15, client C1 | Tests added for MV1 (39.15), MV6 (39.14), MV8 (39.17b), MV15 (39.21), C1 (vitest "only an APPROVAL…"); MV9 now killed too (39.9 / 39.9b assert no resumed frame). **MV11 rejected as equivalent:** a Live request carrying any approval is refused 403 at the top of the handler (`index.ts` ~L1120, `validatedData.approvedConfirmations?.length … return refuseLive()`), so `!liveRuntimeScope` at the resume is always true when reached; kept as stated defence in depth | mutation table in the evidence record |
| V5: `.limit(33)` could miss the live row | `.in("issued_in_request", nonces)` | 39.16 (red before); N1 killed |
| V6: swept / mid-flight-expired rows read "may have happened" | `storedRowState`; claim-failure re-read distinguishes expired | 39.9b, 39.9c (red before); N4, N5 killed; Deno unit test |
| C7: subject refusal blocks a different second change | Kept, accepted cost stated in §2 item 4 (re-authored drafts would otherwise re-open the re-ask loop) | 39.14 |
| C8: catch did not roll back `approvalTokenTool` | Rolled back. Mutant N9 survives: the stale entry is observable only when an approved-set lookup ALSO failed in the same turn (then "Paige didn't run this" instead of "something went wrong checking") — a compound failure the harness does not drive | — |
| V7 / C6 / C9 / C10 | Documented (§2 item 8; master doc wording; owner live look; authenticated drive owed) | — |
| C4 / C5 | The independent §39 read of the real diff and the Impeccable critic pass are the orchestrator's, not the builder's, and remain owed before merge | — |

### 2.2 Per-tier coverage (§51)

| Tier | Resume behaviour | Proof |
|---|---|---|
| God / Super Admin (Operator surface) | Not resumed: the Operator client sends no thread. Old model-re-emit path unchanged. OPEN WORK (owner gate 1). | 39.19 |
| God / Super Admin (any surface that sends a thread, e.g. the PAIGE chat) | Resumed under the operator's null tenant scope, once | 39.19b, 39.12 |
| Agency (as a tenant, PAIGE drawer) | Same handler path as Standalone/Sub-account: the resolved tenant persona scopes the selection and the claim; nothing in the resume reads account type | 39.7, 39.18 drive a tenant persona; an agency-typed persona was not driven separately |
| Standalone Tenant | Resumed under the tenant's scope; A→B→A refused in B | 39.7–39.7c, 39.18b |
| Sub-account | Same as Standalone (a sub-account is a tenant persona with a parent; nothing in the resume reads the parent) | 39.7, 39.18 |
| Client (portal seat) | The client seat's own write (`update_client_data`) resumes under the focused-client scope; any other tool is refused by the seat gate before a claim | 39.1–39.11 (default persona is a client seat), 39.4 another client |
| Anonymous | N/A: without a valid JWT the handler returns 401 (`index.ts` ~L981 / ~L997) before the request body, and so any approval, is read | read in source; not driven in the harness |
| Studio (surface) | Resumed; a scope narrowed after the card leaves the approval unspent | 39.20, 39.20b |

### Design deviations from the plan, with evidence

- **Call id `resume_<token>` with `:` → `_`, not `resume:<token>`.** The synthetic call is replayed to the
  provider as conversation history; Anthropic `tool_use.id` must match `^[A-Za-z0-9_-]+$`
  (`_shared/claude.ts` forwards `tc.id` as the block id).
- **The resumed round is round 0, not round -1.** Same model budget as before (the model used round 0 to
  re-emit), and the structural tests that pin one `for (let round = 0; …)` loop stay true.
- **`paige_resume` also keeps `approval_outcome`.** `{tool, outcome}` alone cannot rebuild the card a
  person saw (fingerprints and the closed note). Persisting the wire frame verbatim makes wire = record
  by construction (test 39.8b).
- **A consumed row at selection is "used elsewhere", not skipped.** Skipping fell back to the
  earlier-use check (claim time < this request's start), which reads a concurrent claim that landed a
  moment AFTER this request began as "Paige didn't run this" — false (test 39.3d).
- **The re-emit guard compares identity args, not the raw fingerprint.** The gate settles a fresh
  `request_key` / `idempotency_key` on a call that arrives without one, so a byte-honest re-emit would
  otherwise fingerprint differently. A DRIFTED re-emit (different arguments, no stable subject id) is a
  different act and can still become a new card that needs its own approval — it never runs (18.7e).

## 2b. C4b — as built: door proposals resume on the server

### Pre-edit frame

- **Mode / depth.** Existing Project (repair), Deep, R3 (approval authority, cross-workspace scope).
- **Grounding, re-verified at `d78a349ed`.** A door mints its own proposal (`crm-command/index.ts`
  ~L596, `sales-invoice-command/index.ts` ~L126-129, `_shared/growth-publish-command/door.ts`
  ~L368, collections and drafts alike): `thread_id` and `scoped_client_id` NULL, the card token is
  the bare fingerprint, and `args` are the door's own stored request (CRM: `{command, idempotency_key,
  approval_subject}`; Sales: `{command, operation_id, expected_tenant_id, …}`; publish: `{action, kind,
  id, expected_tenant_id, …}`). Each door stores exactly what it fingerprinted
  (`confirmFingerprint(tool, args)`). The door is the only claim site: it claims by fingerprint under
  user + current workspace + exact tool + thread/client NULL + unconsumed + unexpired + server-issued,
  then runs the stored request. Before C4b the chat reached a door with an approval only when the model
  re-emitted the call (CRM lane, Sales lane, publish lane in `executeToolCalls`); prod, 30 days: 8 of 21
  door approvals stranded (`deal_create` 5 of 7, `crm_create_contact` 3 of 10). The client CRM and
  pipeline lanes in `PaigeAIChat.tsx` (~L1932-2096) run a card's stored command directly, but only when
  the card carries it (1 of 52 prod `paige_confirm` rows did), and strip every fingerprint they attempted
  from the echo.
- **Search before scaffolding (§18).** Extended the C4a seam in place: the resolve block, `resumePin`,
  the `resumed` frame, `bundle_ref.paige_resume`, `resume.ts` outcome classification. No second resume
  path, no second claim, no new store, no migration.

### The server (`paige-ai-chat/index.ts`, `_shared/paige-turn/resume.ts`, the four door bridges)

1. **Resolve.** In the same resolve block as C4a, every approved token that is a bare 16-hex
   fingerprint is looked up among this caller's door proposals, under the door's own claim scope
   predicate for predicate: this user, this workspace (`personaCtx.tenant_id`, required), thread and
   client NULL, a door tool, server-issued, never minted by this request. A bare fingerprint is not
   unique across a door's history (each re-proposal of an act stores it again), but at most one row is
   live (the live unique index), so `selectDoorRow` takes the live row, else the newest. Then:
   - the row's `args` must still hash to its fingerprint (each door stores what it fingerprinted);
   - `doorResumeShape` must accept it: a CRM row with a full command whose action maps to the tool and
     an idempotency key; a Sales row bound to THIS workspace and a real operation id; a publish row of
     the tool's own kind in this workspace. A **CRM preview binding** (`{action, preview_id}` — merge,
     hard delete, bulk update, task/deal delete) is NOT carried forward: crm-command's request contract
     cannot take it back as a command. It keeps its existing path. The preview set moved to one home
     (`CRM_PREVIEW_REQUIRED_ACTIONS` in the shared catalog; crm-command reads it from there);
   - past its window → expired, the door is not asked (it would only propose again);
   - not offered on this turn → withheld, not run, unspent (C4a's capability fingerprint, unchanged);
   - already used: the CRM and Sales doors read back a result they committed under the stored key or
     operation BEFORE they would claim anything, so they are asked (a committed act reads back as what it
     did; nothing runs twice). The publish door keeps no such result, so a used publish approval is "can't
     confirm, check first" without a call.
   A carried-forward row becomes one synthetic call to the door tool, pinned in `resumePin` and in a
   second server-only map `resumeDoorPin` (call id → the stored row). The synthetic call's arguments are
   what the conversation records (PAIGE reads them); they are never what runs.
   **No thread is needed for this half** — a door row carries none, and the binding is the door's own.
   The general-gate half still requires one. **When there IS a thread, the resume preserves it** (review
   fix): a door row carries no thread, so its binding to the conversation is the card — a door token is
   carried forward only when one of THIS thread's recent turns (the same 25-turn read that names the
   suspended turn, made with the caller's own session) showed its card. A token posted in another
   thread, or one whose card is older than that window, keeps its existing path (a model re-emit); a
   failed turn read carries no door token (40.12, 40.12b, 40.12c). Each token is bound by its OWN card:
   two tokens posted together, only one of whose cards this thread showed, carry only that one (40.12d).
2. **Dispatch — the same door branches, one claim site.** The resumed round is round 0 of the same loop
   (C4a). In each door branch a pinned call skips the approval lookup and hands the door exactly the
   pinned proposal: CRM sends the stored command and idempotency key with the fingerprint (the body the
   card's own lane sends); the Sales and publish bridges take `pinned` and send the stored command /
   operation / artifact with the fingerprint. A pinned call is never sent without its fingerprint, so a
   door at `auto` can never treat it as an unapproved request. The door claims, decides, executes, reads
   back and files its receipt exactly as before.
3. **What a door's answer means for the carried-forward approval** (`settlePinnedDoorResult`). The door
   was handed the approval, so its answer is that approval's outcome (`classifySpentApproval`, never
   optimism), except when its claim found nothing to claim: the CRM and Sales doors then propose the act
   again (their own behaviour, unchanged), and the publish door answers `APPROVAL_NOT_AVAILABLE`
   (reported to the chat as `approvalUnavailable`, not to the model). A carried-forward approval never
   becomes a fresh card (C4a's rule). **Which outcome is read the way C4a reads it** (review round 3):
   the pinned row is read once more (`doorRowStateNow`, by its own minting request, under the door's
   scope) BEFORE anything is retired. Still live means the door's claim itself could not run (a store
   error on the claim — crm-command then proposes again, meets the live card at the unique index and
   answers with that same card): nothing ran, and the person is told the approval "could not be checked"
   (`RESUME_CHECK_UNAVAILABLE_RESULT`), not "it may already have happened", and the card stays usable
   (40.4g). Past its window: "expired". Used, or unreadable: "can't confirm — it may already have
   happened" (unreadable and past the pin's own expiry: "expired"). **The door's unshown re-proposal is retired** (review fix;
   the first build left it live). When the CRM or Sales door proposes again on a failed claim it inserts
   a LIVE proposal row no card shows — and crm-command re-mints under the SAME fingerprint (its stored
   command and key re-hash to the card's; unlike Sales it has no cycle nonce), so the old token could
   claim it later: a declined card run by a second stale Approve, an "expired" act run by a re-send.
   `retireDoorReproposal` consumes it before anything else reads it, under the door's claim predicates:
   this user, this workspace, this door tool, the card's fingerprint or the one the door just proposed
   (Sales mints a new cycle fingerprint), thread and client NULL, unconsumed, server-issued since this
   request selected the pinned row (less a 2 s allowance for the door isolate's clock), and **never the
   pinned row itself** (`issued_in_request` ≠ the pinned row's; review round 3 — inside the allowance the
   pinned row could otherwise be consumed when the door answered with it, 40.4g2). A live card for the
   same operation issued BEFORE this request (shown elsewhere, its own cycle) is not this request's and
   stays live — whether it was shown months (40.9i) or minutes (40.9j) before. Rows already consumed
   keep their `consumed_at` (40.4h), and another tool's row is never touched (40.9k, a synthetic 64-bit
   collision: the fingerprint hashes the tool). A retirement that fails is logged (`console.error`), and
   the outcome reported is unchanged — nothing ran here (40.2e, 40.4e, 40.4f, 40.9h, 40.9i). Another
   workspace's or another person's row with the same tool and fingerprint is never touched either
   (40.9l, 40.9m — synthetic collisions, added after the exact-head review found that dropping the
   `tenant_id` or `user_id` predicate left every check green). The
   longer-term fix is a cycle nonce in crm-command's proposals (as Sales has); that is a door change, not
   made here — **open**.

   **The retirement's race window, stated.** "Issued since selection" is `server_issued_at ≥ (the
   moment this request selected the pinned row − 2 s)` (`doorSelectedAt`, `paige-ai-chat` ~L8966). So a
   LEGITIMATE card for the same act and fingerprint that a concurrent request minted inside that ~2 s
   window (or while this request ran) and that is not the pinned row is retired with the door's unshown
   re-proposal. That fails closed: nothing runs, the person's approval of that card answers "can't
   confirm / check first" or "expired", and the act is proposed again on request — never an act run
   without its approval. For CRM the live unique index (user, fingerprint) means the concurrent card and
   the re-proposal are one row, so this is the same row either way.

   **Clock-skew caveat.** The window compares the chat's clock (selection) with the door isolate's clock
   (`server_issued_at` on the re-proposal). If the door's clock runs more than ~2 s behind the chat's,
   its re-proposal is stamped before the window and escapes retirement: that unshown proposal stays live
   until it expires (30 min CRM, 10 min Sales), claimable by the old token meanwhile. Same class, and the
   same durable fix, as the open crm-command cycle-nonce item above; not closed here.
4. **A door tool called again in the same reply is refused.** A door decides its own lane, so C4a's
   "put it back on confirm" clamp cannot apply; a drifted re-emit on a lane at `auto` would be a second
   write. While the reply carries a door approval forward, any other call to that door tool is not run
   and gets no card (`RESUME_DOOR_ALREADY_HANDLED_RESULT`). **Accepted cost:** a genuinely different
   second act of the same door tool in the same reply waits for the next reply, where it gets its own
   card; the note tells PAIGE to say so and propose it next.
5. **Wire and record, unchanged mechanism.** The same `resumed` frame, the same
   `bundle_ref.paige_resume {kind:"approval", from_turn_id, outcomes, approval_outcome}`, the same report
   card. `from_turn_id` and the persisted record need a thread; a thread-less request (Operator) emits the
   frame and the card but has no turn to record.
6. **Decline now covers the publish door** (review fix). `cancelConfirmations`' NULL-scope door
   fallback listed the CRM and Sales tools but not the publish door's, so "Not now" on a publish card
   left its row claimable — and with C4b a stale Approve carried it to the door every time, where before
   it needed a model re-emit. The publish door's tools are in that list now, same predicates (40.9g;
   vitest `sales-chat-cancellation`, `crm-command-chat-adoption`).
7. **Unchanged.** Live turns carrying any approval are refused (403) before anything runs; the
   general-gate resume (C4a); unpinned door calls (the Sales bridges still report no `spent`, so the card
   outcome an echoed Sales approval already gets is unchanged — pinned in vitest).

### The client CRM / pipeline lanes — retained (§58)

The approved card's own lanes in `PaigeAIChat.tsx` (CRM: invoke crm-command with the card's command,
key and fingerprint; pipeline: run the stored `configure_tenant_pipeline` row) are a shipped capability
and are **not removed in this slice**. They do not double-run with the server path:

- a lane strips every fingerprint it attempted from the echo, so the server never receives it from the
  same click;
- a fingerprint that reaches the server from elsewhere after a lane ran it (a stale tab, the drawer,
  Studio) is carried to the door with the stored key, and the door reads back what it committed — one
  execution, reported as ran (40.2a); the reverse order is the same (40.2b).

**§58 callout, explicit:** the client CRM lane is now redundant with the server path for every card
that carries a full command. It may be retired only after the server path is proven live on the deployed
platform (an authenticated approve of `crm_create_contact` and `deal_create` with no model re-emit), and
that retirement must be called out as its own removal with owner sign-off. The pipeline lane is not a
door (pipeline proposals are general-gate, thread-scoped rows) and is outside C4b.

### Operator (no thread is sent) — decided with evidence

`useOperatorChat.ts` sends no `threadId`. Door rows carry no thread either, and their binding is the
door's own (this user, this workspace, the tool, the fingerprint). So:

- an operator **at rest** (no workspace) has no door proposals to carry: `personaCtx.tenant_id` is
  null, nothing is selected (a door row always names a workspace; crm-command refuses a caller with none
  — `CRM_TENANT_REQUIRED`) (40.11);
- an operator **inside a workspace** (`operator_enter_tenant`) is carried forward once under the door's
  own binding; the door re-checks the active workspace at execution (40.11b). There is no thread, so no
  suspended turn is named and nothing is persisted.

General-gate (C4a) approvals on Operator remain open work (they are thread-scoped rows).

### Per-tier coverage (§51)

| Tier | Door resume | Proof |
|---|---|---|
| God / Super Admin, Operator surface, at rest | Nothing to carry (no workspace, no door rows). | 40.11 |
| God / Super Admin inside a workspace (no thread) | Carried forward once under the door's binding. | 40.11b |
| Agency (as a tenant, PAIGE drawer / page) | Same handler path as Standalone: nothing in the resume reads account type; crm-command reads the route only for the deep link. Not driven separately. | 40.1–40.9 (tenant persona) |
| Standalone Tenant | Carried forward once; A→B→A refused in B (with and without a thread). | 40.1, 40.7–40.7d |
| Sub-account | Same as Standalone (a tenant persona with a parent). | 40.1 |
| Client (portal seat) | A client seat cannot reach a door tool, so it holds no door proposal of its own; were one echoed, its pinned call meets the same client-seat gate (before every door branch) and no door is asked. Not driven. | read in source |
| Anonymous | N/A: 401 before the body is read. | read in source |
| Studio surface | Withheld unless the Studio scope offers the door tool. | 40.6 |

### Design deviations from the brief, with evidence

- **Doors need no thread.** The brief kept C4a's thread requirement implicit. Door rows have no thread
  and are claimed without one, so requiring one adds no binding and would leave Operator-in-a-workspace
  stranded (40.11b passes only without it; mutant N17). When a thread is sent, the card binds the token
  to it (40.12; mutant F5).
- **Used CRM / Sales rows are still handed to their door** (for its readback), used publish rows are not
  (the publish door has no readback and would say "nothing ran", which can be false). Mutants N7, N13.
- **CRM preview-bound proposals are not resumed** (crm-command's schema cannot take `{action,
  preview_id}` back as a command). Open: carrying them would need the door to accept a claim-only body,
  a door contract change not made here.
- **The re-emit refusal for doors is by tool, not by act**, because the door, not the chat, decides the
  lane (mutant N8).

## 2c. C4c — as built: PAIGE asks, waits, and the same objective resumes on the answer

Coordinator order (binding, from the owner's C4 order): when PAIGE cannot continue an existing
objective because one real fact or choice is missing, she asks, waits, and resumes the SAME objective
when the answer arrives — another interrupt reason over the SAME resume model C4a/C4b established;
no second continuation system; no new question store unless grounding proves one is required; a reply
is not an answer merely because it is text; one ask → one resume; an answer supplies facts and never
authority. Built on `main` `0fe769ef8` (C4a #1762 and C4b #1766 merged). Line numbers below are the
build worktree's; base references are `0fe769ef8`.

### A. Flow-by-Flow map

Mode Existing Project + New Feature; depth Deep; risk R3 (persistence, a migration, cross-workspace
scope). Actor: the owner or a team member in a saved PAIGE thread (Solo chat, PAIGE drawer; Studio
keeps its own client). Goal: PAIGE finishes the work she started once she has the one missing fact.

| Step | What happens | Home (file:line) |
|---|---|---|
| 1 Objective begins | An ordinary message on a saved thread; the turn is offered `ask_choices` (main chat: thread, not Live, not a document turn, not a client seat) | `paige-ai-chat/index.ts:8761` (`mainChatAsks`), tool def below it |
| 2 Missing fact | PAIGE calls `ask_choices` on its own (`prompt`, `needs`, `objective`, optional 2–4 `options`); a call beside other calls is answered "ask it on its own" and not shown | `index.ts:16113` (`askAlongside`), `:16262` |
| 3 ASK_USER emitted | `buildAskRecord` bounds it and mints `ask_id`; `paige_turn {waiting, ASK_USER, clarify}` then `paige_choices {prompt, options, multi, allow_other, ask_id}`; the turn ends (no closing completion) | `index.ts:16120-16140`; `resume.ts:525` |
| 4 Question persisted | The question turn's `bundle_ref` = `turn_state` (ASK_USER, `waiting_on.kind: "choice"`) + `paige_ask {v, ask_id, question, options, multi, allow_other, needs, objective}`, beside it at the persist call site (never inside `assistantTurnMetadata`) | `index.ts:15933` (`withResumeRecord`) |
| 5 Turn stops truthfully | Wire terminal `waiting/ASK_USER`; the client draws "Your call", the choices (or none), and the composer answering it | `PaigeAIChat.tsx:1747`, `:2336`, `:3285`; `PaigeAskCard.tsx` |
| 6 User answers | A choice, a skip, or words typed while the composer is answering → the request carries `resume: {kind: "answer", ask_id[, skipped]}`; "Ask something else instead" turns that off | `PaigeAIChat.tsx:2004`, `:1508` |
| 7 Server binds it | (a) **Check**, before anything else: declared ∧ validated workspace; the thread's latest turns read with the caller's session; `resolveAskLiveness` → live / pending / reopened / answered / stale; anything but live is refused with no model call. (b) **Claim**, the last thing before PAIGE is called — after the final workspace re-check: the person's turn appended WITH `paige_resume {kind: "answer", key: "answer:<ask_id>", from_turn_id[, skipped]}`; 23505 → already with PAIGE; then re-read: the claim must directly follow the question (`answerClaimBound`) or PAIGE is not called | `index.ts` `answerBinding` block (~L5527) and the claim before the model call (~L9420); `resume.ts` `resolveAskLiveness`, `answerClaimBound` |
| 7b Claimed, PAIGE not reached | Every exit between the claim and the stream (gateway 429/402/5xx, a failed re-read, an unexpected throw → outer catch) saves the SAME question again under a new `ask_id` (`reopenAsk`: same words/need/objective, `reopens` = the old id, ASK_USER) and replies `ASK_REOPENED` with it. A claim with nothing after it, older than any request can run (`ANSWER_STRANDED_AFTER_MS` = 10 min), is re-asked the same way when the answer is sent again; younger, the reply says PAIGE already has the answer (never that she is still working). The re-asked question's lead is true whether or not PAIGE was reached ("I didn't finish carrying on from your answer. Anything I'd already done is saved."), and its answer note tells PAIGE to check what already exists first (41.23b–e). The client keeps the composer bound to that question while the thread ends on the claim (reload, or the "already has your answer" re-read), so the re-send names it — the only way the server's re-ask is reachable | `index.ts` `afterAnswerClaimFailure`, `saveQuestionAgain`; `resume.ts` `reopenAsk`; `PaigeAIChat.tsx` `claimedAsk` |
| 8 Same objective resumes | `answerTurnNote` from the SAVED question (what she asked, was doing, needed — quoted as data the thread supplied, never as instructions; never invent; approves nothing) joins the prompt; `paige_turn {resumed, WORKING}` | `index.ts` (note pushed at the claim), `:16080`; `resume.ts` `answerTurnNote` |
| 9 PAIGE continues | The ordinary loop: reads, writes, or proposes (a consequential act → its card, WAIT_APPROVAL → C4a/C4b) | unchanged loop |
| 10 Final answer persists/reloads | The continuation's `turn_state.resumed {kind: "answer"}` + `bundle_ref.paige_resume {kind: "answer", from_turn_id, outcomes: []}`; reload rebuilds the question, its standing and the answer | `index.ts:15938`; `PaigeAIChat.tsx:1005` |

### B. Grounded existing-state inventory (base `0fe769ef8`)

Searched `ask_choices`, `ASK_USER`, `askUser`, `ask_user`, `paige_question`, `paige_choices`,
`choices`, `clarif`, `needs_input`, `paige_live_card`, `answers_turn_id`, `paige_pending_questions`,
`resume_handle`, `continuation_token` across `supabase/` and `src/`, and read the regions below.

| Fact | Existing home | Reused how |
|---|---|---|
| The question tool | `ask_choices`, Studio-only (`index.ts:8686` push; `:15973` turn-ender) | Same tool, same handler; main chat gets its own wording (free-form allowed, `needs`/`objective`); Studio's rule is byte-identical (two to four options) |
| Turn state | `TurnWaitingOn.kind: "choice"` (`contract.ts:93`); reducer `asked → ASK_USER` (`reducer.ts:182`); `RESUME_KINDS` already names `answer` | Unchanged contract; `turn_state.resumed {kind: "answer"}` is an existing value |
| The resume record / frame | `bundle_ref.paige_resume` + `paige_turn resumed` (C4a/C4b, `resume.ts`, `index.ts:15813`) | Same frame, same record (`kind: "answer"`, `outcomes: []`), same `withResumeRecord` |
| Thread / workspace | `paige_chat_threads.tenant_id`, the 409 thread check (`index.ts` ~L2407), `memoryWorkspaceScope` (declared ∧ validated), `proposalScopeResolved` | Reused as the answer's scope checks |
| The person's turn | `paige_chat_turn_append` (`20261020100000:109-174`, owner + workspace in-body), appended at `index.ts:5509` | The answer IS that append, now carrying the claim |
| Request / intent identity | `requestIntentId` (document turns only); approvals carry card tokens | Not used for the answer: the question's own `ask_id` is the identity |
| Client rendering | `decode.ts` names `paige_choices`; Studio's `AskCard` (`StudioSession.tsx:22`); main chat had no `choices` branch; C3 drew ASK_USER as `doneLine` (`turn-view.ts:274`) | Main chat gains the card (`PaigeAskCard`) and the c2/c5 lines; Studio untouched |
| Exactly-once for an answer | **none** — turns are append-only (`authenticated` SELECT only; no UPDATE path in `supabase/` or `src/`) and the append is an unconditional INSERT | The one database addition (below) |

**The four justifications for the index** (also in the migration header):
1. *What fact has no home.* "This question was answered by exactly one request." Nothing can be flipped
   in place on an append-only transcript; two concurrent appends both land (prod, 30 days: 18 adjacent
   identical user turns < 2 min apart — C4 grounding).
2. *Why `turn_state` cannot hold it.* jsonb in one row: no cross-row uniqueness, no update after insert,
   no ids or prose by contract, owner-forgeable through the append grant.
3. *Why `paige_durable_work` cannot hold it.* Dialogue is not durable work; the table is service-only,
   terminal rows immutable, identity fields frozen, its unique keys not "one reply per question"; using
   it would give the conversation a second job lifecycle.
4. *Why this is not a second workflow engine.* One partial unique index on the transcript that holds both
   turns — the `paige_chat_turns_work_uk` precedent (`20270418000000:44`). No table, column, function,
   trigger, worker, scheduler, lease or state machine. The resume runs in the existing chat loop.

### C. Ask identity and persistence contract

- **Identity.** `ask_id` = `crypto.randomUUID()` minted by the server when the question is asked; it
  rides the `paige_choices` frame and `bundle_ref.paige_ask.ask_id` on the question turn. The question
  turn's row id is `from_turn_id`. Never client-chosen.
- **Version.** `paige_ask.v = 1`; `readAskRecord` reads anything else as none (the client draws no card).
- **What is saved.** `paige_ask` = the question, bounded options (label 60, value 300, description 160,
  a preview only for a real http(s) URL, at most four; a single option is not a choice), `multi`,
  `allow_other`, `needs` (≤ 120), `objective` (≤ 160) — the model's own words, like `paige_confirm`'s
  summary; never in `turn_state`. Saved only when the turn ENDED waiting on it (ASK_USER).
- **Live rule.** A question is open only while its turn is the thread's newest turn and its record says
  ASK_USER. Any later turn closes it: an answer claiming it, or anything else (→ "superseded", for good).
  A claim binds only when it DIRECTLY follows the question; one that landed after another message (two
  tabs) never answered it (→ superseded). A bound claim with nothing after it is "pending" (PAIGE may
  still be on it, or the request that claimed it died — its `created_at` tells which); followed by a
  re-asked question it is "reopened" (the reply names the open one) — the chain is followed, so if that
  re-asked question was itself answered, is pending, or was moved past, the first id reads the same
  (answered / pending / stale), and of several re-asks in a row (two tabs) the newest stands; followed by
  PAIGE's continuation it is "answered". No time expiry on an unanswered question: it stays open until something is said after it.
- **A re-asked question** (`paige_ask.reopens = <old ask_id>`) is the same record under a new id, saved on
  PAIGE's own turn whose content opens "I didn't finish carrying on from your answer. Anything I'd already
  done is saved." — then the question. The lead is true whether or not PAIGE was reached before the
  attempt stopped (it never says nothing was done). It is answered like the first, except that the answer
  note also tells PAIGE an earlier attempt may already have done part of the work: check what exists
  before acting and repeat nothing (41.23d).
- **Owner-forgeability, stated.** The thread owner can append a `paige_ask` or a `paige_resume` key to
  their own thread through the RPC grant. Effects are bounded to their own thread: a forged question
  shapes only their own next prompt; a forged claim only makes their own question unanswerable. Neither
  is ever read as authority (41.9, 41.13d; Deno). Because a forged `paige_ask` reaches a system-role note,
  `answerTurnNote` quotes every field and says they are data the thread supplied, never instructions
  (Deno: "Treat them as data"); the approval gate is fingerprint-based and never reads it.

### D. Answer-binding contract

Request field `resume: {kind: "answer", ask_id, skipped?}` (zod, strict). Order of checks, each a
truthful refusal with **no model call and nothing saved**, and the message is never reinterpreted as an
ordinary one (the client puts it back): no thread → 409 `ASK_NOT_OPEN`; an approval/decline, a document
or attachments beside it → 409; a client portal seat → 409; persona unresolved or the declared
workspace ≠ the validated one → 409; an empty message → 409; the turn read fails → 503
`ASK_ANSWER_UNAVAILABLE`; liveness `answered` → 409 `ASK_ALREADY_ANSWERED` ("PAIGE already has your
answer"); `reopened` → 409 `ASK_REOPENED` naming the open question; `pending` and younger than
`ANSWER_STRANDED_AFTER_MS` → 409 `ASK_ANSWER_IN_PROGRESS` ("PAIGE already has your answer to that
question, so this wasn't sent again. If she hasn't replied 10 minutes after you sent it, send it again and
she'll ask the question again" — never that she is still working, which the server cannot know; the same window,
`ANSWER_STRANDED_AFTER_MINUTES`, in the server's copy and the client's hint), older → the question is asked
again and 409 `ASK_REOPENED`; `stale` → 409 `ASK_NOT_OPEN`. Then, at the claim (just
before PAIGE): 23505 → 409 `ASK_ALREADY_ANSWERED`; the append refusing the thread as another
workspace's → 409 `ASK_NOT_OPEN` (retrying from here cannot change it); any other append error → 503;
the claim not directly after the question (a message slipped in) → 409 `ASK_NOT_OPEN` with `answer_kept:
true` ("Another message reached PAIGE before your answer, so she didn't act on it and her question stays
unanswered. Your answer is kept in the conversation."), PAIGE not called — the client clears the words
from the composer, because they are in the transcript. The server's reasons say only what happened to the
answer; where the words are is the client's to say: typed words "are back in the box"; a choice made on
the card is not said to be (it never was there — the card returns if the question is open again).
Every exit after a written claim and before the stream asks the question again (`ASK_REOPENED`, keeping
the original status). A Live (voice) request carrying `resume` is refused 403 with the other Live refusals. The thread's
own workspace check (409 `ACTIVE_ACCOUNT_CHANGED`) runs before all of these. Only then is the answer
note added and PAIGE called. **Natural-language answers** are accepted as written when sent as the
answer; the note tells PAIGE to use the reply only for what it says and, if it does not give what she
needed, to say so and ask again (or respond to what they said) — the server never maps a reply into a
field. **Trust:** the note says an answer approves nothing; any consequential act PAIGE then calls meets
the gate and its card (41.10, 41.12).

### E. Exactly-once proof

- Database: pgTAP `supabase/tests/chat_turn_answer_claim_unique.sql` 11/11 (second answer same thread →
  23505, directly and through `paige_chat_turn_append` as the owner; same key another thread OK;
  assistant rows unconstrained; no key / NULL key never conflict; one row remains). Two-session race
  `scripts/proof/chat-answer-claim-race.mjs` 7/7 (the second committed session is observed WAITING on
  the first's uncommitted answer; commit → 23505, rollback → the second lands; exactly one row). Both run
  locally against PG16 with a minimal stand-in schema and a five-function pgTAP shim (labelled; CI runs
  the real pgTAP on the replayed Supabase stack — wired into `paige-spine-contract.yml`). Mutations:
  index dropped → 5 pgTAP failures and the race times out; role filter dropped → 2; thread dropped from
  the key → 1.
- Handler: 41.5 (sent again → 409 ALREADY_ANSWERED, no model call), 41.5b (two at once → one 200 / one
  409, one claim row, one continuation, one model call), 41.11b (the approval the answer led to, sent
  again, runs nothing). Client: Use this is gone the moment the answer is sent (no double send); a
  refused answer is put back and the thread re-read.
- **One ask never ends with zero resumes** (independent verifier F1, HIGH, fixed). The first build wrote
  the claim before the model call and returned on a gateway refusal or a late workspace switch with
  nothing after the claim; the client's retry was then refused "already answered" — untrue. Now: the
  claim is written last, after the final workspace re-check (a switch before it leaves the question
  open, 41.8); any exit between the claim and the stream asks the same question again (41.17 gateway
  529, 41.17b the old id sent again → `ASK_REOPENED`, 41.17c the re-asked question answered → one
  continuation, 41.17d a throw → outer catch, and a failed re-read); a claim left with nothing after it
  says PAIGE already has it while young and is re-asked once older than any request (41.19–41.19c).
  Once PAIGE is reached, a failure ends inside the stream in its own interrupted turn, a continuation
  that says what happened (unchanged) — and that turn carries the answer's `paige_resume` record like any
  continuation (41.21) — **with one exception: a workspace switch mid-answer** (exact-head review B1).
  The in-stream workspace re-checks stop the stream and cannot save anything after the claim (the thread
  now belongs to another workspace, and the append refuses it), so the claim strands after PAIGE may
  already have run tools or queued a proposal (41.23b). The first build then told the person "nothing was
  done with it yet" on the re-ask, and answering again ran the objective with no hint of the earlier
  attempt. Now every word on that path is true either way — "already has your answer" (never "still
  working"), "Anything I'd already done is saved" (never "nothing was done") — and the re-asked answer's
  note tells PAIGE to check what already exists and repeat nothing (41.23c–41.23e; Deno; mutation: the
  old copy fails 41.17/41.19/41.23c/41.23d, the note dropped fails 41.23d). **A claim with nothing after it is reachable from the client** (re-verifier 2,
  V2-1): the first build's client re-read the thread after "may still be working" and then had no open
  question, so a re-send went out as an ordinary message — the server's re-ask could never be reached,
  the copy promising it was untrue, and a re-send inside the window could start the same work twice. Now
  the composer stays bound to the claimed question (vitest: "already has your answer" → re-read → send
  again carries `resume`; reload with a claim → bound), so inside the window the re-send is refused with
  no model call (41.19, 41.19f: two at once) and after it the question is asked again exactly once
  (41.19d) — two re-sends at once can each save a re-ask, but neither reaches PAIGE and only one answer
  to the newest ever runs (41.19e). Residual, stated: a request killed by the platform between the claim
  and PAIGE's reply, or a workspace switch mid-answer, leaves a claim that holds the composer on "has your
  answer" for up to 10 minutes before a re-send re-asks it; after a mid-answer switch, whether the second
  attempt repeats an auto-lane act the first already did rests on PAIGE following the check-first note
  (model adherence, UNVERIFIED — confirm-lane acts still each need their own approval); two tabs re-asking a dead claim at the same moment can
  each save the re-asked question (the older then reads "Not answered"; nothing executes).
- **The claim and a message from another tab** (verifier F3): re-read after the claim; unless it directly
  follows the question, PAIGE is not called (41.18) and the question reads as moved past for good.

### F. Isolation proof (harness group 41)

1 another tenant: 41.8 (409 before anything; the question stays open) · 2 the same user's other
workspace: 41.8b (that thread never asked it → ASK_NOT_OPEN; A untouched) · 3 a stale declaration: 41.8c
(declared B, validated A → refused), 41.8d (agreeing again → answered once) · 4 another user: 41.9 (RLS
reads nothing; the RPC refuses a thread they do not own; nothing appended) · 5 Operator / no thread:
41.13 (tool not offered), 41.13b (an answer refused for that reason, no turn read), 41.13e (an operator
PAIGE chat WITH its platform thread: offered, bound once under the null scope) · client seat: 41.13c
(not offered), 41.13d (refused as a client seat).

### G. Composition proof (ASK_USER → answer → WAIT_APPROVAL → approval → execute)

40.15 (the C4b door path, verifier F5): ask → answer → the REAL crm-command mints a door card →
approval → the door runs its stored act exactly once, carried forward from the answer's continuation
turn (`paige_resume.from_turn_id`) → approving again executes nothing; one question, one answer claim,
one proposal row. 41.10: the answer resumes the objective and PAIGE proposes a consequential act → a card, terminal
WAIT_APPROVAL, the turn still `resumed {kind: "answer"}`, nothing written. 41.11: approving that card runs
the stored act once through C4a (`resumed {kind: "approval"}`, `from_turn_id` = the card's turn). 41.11b:
sent again → nothing runs; one answer claim, one card, one execution. No new bubble type, no other
workflow record, no new objective id: the thread and its turns are the record. Rendered:
`c4c-c3-then-approval-*`.

### H. Reload proof

Server: 41.6 (before the answer: the latest turn is the question, ASK_USER, its record readable as asked);
41.7 (after: question → answer (claim) → continuation (resumed), saved state = wire terminal). Client
(vitest): open again on reload with its choices, "Your call", the composer answering it, and the answer
carrying the SAVED id; after the answer: answered in place, the reply as written, the continuation its own
answer (not merged as an approval); after a skip: hidden sentence, "You let PAIGE choose"; moved past:
"Not answered"; a record outside the contract: no card; a claim with nothing after it: the card frozen
"Answered below", the composer bound to that question (its send names the saved id); a claim for ANOTHER
question: "Not answered", the composer free. Rendered: `c4c-reload-open-*`, `c4c-reload-answered-*`,
`c4c-reload-claimed-*`, `c4c-reflow320-reload-claimed-page-light`.

### I. Impeccable review

Read SKILL.md, `reference/operate.md`, `reference/craft-floor.md` before the first UI edit; built to the
frozen frames c1–c6. Operate mode: the tool disappears into the task — the question is PAIGE's words in
her bubble; the choices are an inline radio group (no modal); one primary ink action, a quiet skip;
nothing pre-selected; gold untouched (measured on 71 frames). Wording: "Your call" / "PAIGE has a
question for you" / "PAIGE is waiting on your answer above" / "Ask something else instead" /
"Answered below" / "You let PAIGE choose" / "Not answered" / "Question not answered" — the frames' own
copy; no "resumed", no "starting over". Continuity: the earlier answer keeps its "What PAIGE did", the
question freezes in place, the person's reply is their own bubble, PAIGE's continuation is a new answer
whose line runs the new steps (c3) — no duplicate status bubble, no phantom approval card (a card appears
only when the continuation proposes an act). Recovery: an answer with nothing after it keeps the composer
on its question — "PAIGE has your answer. No reply within 10 minutes? Send it again and she'll ask
again.", placeholder "Send your answer again…", with "Ask something else
instead" (frames `c4c-reload-claimed-*`). A stale or already-answered question is refused
truthfully, the words go back to the composer and the thread is re-read; an answer PAIGE never reached
comes back as the same question, asked again with one plain line of why ("I didn't finish carrying on
from your answer. Anything I'd already done is saved.") and the composer answering the NEW question
(vitest, 500 and 429); "PAIGE already has your answer" when that is all the server can know. A skipped
question's record ("You let <name> choose", the tenant's assistant name) carries the settled check, not
the question glyph. With a file attached the hint
line says "Your file goes as a new message — her question stays unanswered" and offers no switch (a
file is never an answer; compliance finding 5). Craft floor: option, hint and
record text ≥ 5.32:1, lines ≥ 4.85:1, focus ring 6.43:1 (indigo), 320 px / 200 % reflow clean, reduced
motion removes the sweep and the card fade. **One honest gap:** in frame c5 the line ("Question not
answered") and the record ("Not answered") say the same thing twice — exactly as the frozen frame draws
it; kept under §28 and flagged for the owner's next look.

### Per-tier coverage (§51)

| Tier | C4c behaviour | Proof |
|---|---|---|
| God / Super Admin, Operator surface | Not offered (no thread is sent); PAIGE asks in prose, unchanged; an answer is refused | 41.13, 41.13b |
| God / Super Admin, PAIGE chat with its platform thread | Offered; answered once under the null scope | 41.13e |
| Agency (as a tenant, PAIGE drawer / page) | Same handler path as Standalone; nothing reads account type | 41.x drive a tenant persona; not driven separately |
| Standalone Tenant | Offered and bound once; another workspace 409; stale declaration refused | 41.0–41.12, 41.8–41.8d |
| Sub-account | Same as Standalone (a tenant persona with a parent) | as Standalone; not driven separately |
| Client (portal seat) | Not offered; an answer refused (`client_seat`) | 41.13c, 41.13d |
| Anonymous | N/A: 401 before the body is read | read in source |
| Studio | Its own rule unchanged; its question is now saved as the same record; its client still sends plain replies (ordinary messages) | 41.16 |

### Design deviations from the brief, with evidence

- **No paige_pending_questions, no resume ledger, no client token** — as ordered; the only addition is
  the partial unique index (four justifications above).
- **The composer answers by default while a question is open** (prototype c2: "Or type your own
  answer…"), with "Ask something else instead" in the hint row — the coordinator's "answering mode" made
  visible and reversible, rather than a separate mode the person must enter.
- **Free-form questions** are allowed in the main chat only; Studio keeps two-to-four options (41.16).
- **Sibling rule** (a question beside other calls is not shown) applies to the main chat only; Studio
  keeps its behaviour (its siblings are still dropped — open, not this slice).
- **Document turns** are not offered the tool (that path offers tools but runs none, so a question there
  could never be shown).
- **No time expiry** on a question: it stays open until something is said after it.
- **Two question cards (§18), recorded as a deviation** (compliance finding 2). Studio keeps its own
  `AskCard` (`src/solo/studio/StudioSession.tsx:22`); `PaigeAskCard` is the main chat's. Moving Studio
  onto `PaigeAskCard` is a visible Studio change that needs its own §58 declaration and Studio's frames,
  so it is not folded in here; it is a tracked follow-up (one shared ask card for Studio and the main
  chat, then Studio's client binding its replies to the saved question).
- **Frozen frame c5 says "not answered" twice** (the status line "Question not answered" and the record
  "Not answered"). Built as frozen (§28); offered to the owner: drop the record line's words on c5, or
  say "Moved on" there. Not changed here.
- **The claim rides the person's own turn**, not a separate row; the `ask_id` is minted per question
  rather than reusing the request nonce.

### Evidence (C4c)

See §6 (C4c block) and the evidence record `docs/evidence/ui-delivery/c4c-ask-user.md` (frames, mutation
tables). Not verified: §7 (C4c bullets).

## 3. Owner exit gates (owner numbering) — what C4a, C4b and C4c discharge

| # | Gate | C4a |
|---|---|---|
| 1 | approval resume | **Approval part: discharged at harness level** for general-gate thread-scoped rows (39.1–39.1e) on the Solo chat, the PAIGE drawer and Studio, and (C4b) for door proposals — crm-command run as the REAL handler for every non-preview CRM action (40.1–40.1d, 40.13), the Sales and publish doors MODELLED, not run (40.9, 40.9d) — including Operator inside a workspace (40.11b). **Authenticated acceptance on the deployed platform: owed** (§7). **Open:** CRM preview-bound door proposals (merge, hard delete, bulk update, task/deal delete) keep their existing path; general-gate approvals on Operator (no thread is sent; 39.19). |
| 2 | ask-user resume | **C4c: discharged at harness level** in the main chat (Solo chat, PAIGE drawer, an operator PAIGE chat with its thread): ask → wait → one bound answer → the same objective (41.1–41.2b, 41.15); Studio's question unchanged and saved as the same record (41.16). **Authenticated acceptance owed (C4f).** Open: the Operator surface (no thread) keeps asking in prose; Studio's client does not bind its replies yet |
| 3 | durable-work resume | C4d |
| 4 | same-objective identity preserved | **Discharged for approval**: same thread, `from_turn_id` (39.8), same request carries the act and PAIGE's continuation (39.1c). **Answer (C4c)**: same thread, the question turn named by the claim and the continuation (41.1c, 41.1f), the saved question carried into the prompt (41.1d), and on into an approval (41.10–41.11) |
| 5 | exact wire / persist / reload convergence | **Discharged for approval**: 39.8b (record = wire frame), vitest "wire = persist = reload". **Answer (C4c)**: 41.6, 41.7 and the askUser reload cases |
| 6 | no synthetic approval bubble required for canonical history | **Discharged**: the stored act runs whether or not the model speaks; the decision sentence remains as the person's turn, hidden in presentation (C3) |
| 7 | no duplicate act | **Answer (C4c)**: one answer → one continuation (41.5, 41.5b, pgTAP + two-session race); the approval it leads to runs once (41.11b). **Discharged for approval**: 39.2, 39.2b, 39.3, 39.3c, 39.10, 39.13 (drifted re-emit on `auto`), 39.14 (re-authored same subject), 39.16, 18.7h, 18.H12, 18.H15; doors (real crm-command): 40.2a/2b (card lane + server, either order), 40.2c (double POST), 40.5 (re-emit, same and drifted on `auto`), 40.7d (sent again), 40.9b/9e |
| 8 | workspace-switch isolation | **Answer (C4c)**: 41.8–41.8d, 41.9, 41.13–41.13e. **Approval path discharged**: 39.4 (another user/tenant/thread/client), 39.7 (A→B→A: 409 in B, runs once back in A); doors: 40.3 (another workspace / person / a non-door row), 40.7–40.7d (A→B→A with and without a thread), 40.10c (a door-tool row the server never issued), 40.12 (a door token posted in another thread) |
| 9 | truthful failure / expired / refused states | **Approval outcomes discharged**: 39.3b/3d (used elsewhere), 39.9 / 39.9b / 39.9c (expired, swept, expired mid-flight), 39.11 (lane off), 39.17 / 39.20b (no longer offered), 39.18 (role lost), check-unavailable path; PAIGE is told no outcome on a turn that was not resumed (39.12b); doors: 40.4 (expired), 40.4c (used, nothing committed), 40.4d (expired between selection and the door's claim), 40.4e / 40.4f (re-sent after either: nothing runs — the door's re-proposal was retired), 40.5c (a model re-emit after an approval that could not be used), 40.6 (not offered), 40.9c (publish claimed elsewhere), 40.9g (publish declined, then a stale Approve), 40.9h (Sales declined, then a stale Approve) |
| 10 | Deep Research on the same resume substrate | C4d (the shared `paige_resume` / `resumed` contract is in place; `RESUME_KINDS` already names `work`) |

Exactly-once proofs required by the owner: double approval click (39.3), refresh / reopen (39.3c — the
same token sent again runs nothing), stale cross-workspace (39.4, 39.7), A→B→A (39.7–39.7c), readback
not optimism (39.1b: the outcome comes from the act's own result; `classifySpentApproval` never reads a
result that only fails to mention an error as success).

## 4. Database decision (C4a, C4b, C4c)

No migration. The approval kind needs no new storage: the stored proposal row is the authoritative act,
the CAS on `consumed_at` serialises execution, and what became of each approval is recorded on the turn
that carried it (`bundle_ref.paige_resume`). The two candidates the plan names for later slices — the
partial unique index on `paige_chat_turns` for answer resumes (C4c-1) and the failure-terminal writer
for durable work (C4d) — are not needed by C4a.

C4b: no migration either. The door's own proposal row stays the authoritative act and the door's claim
stays the only claim; exactly-once across retries rests on the doors' existing idempotency (crm-command's
committed result keyed by the stored idempotency key, the Sales doors' committed operation), which C4b
reaches by always sending the stored key/operation.

C4c: ONE migration, `20270596000000_chat_turn_answer_claim_unique` — the partial unique index
`paige_chat_turns_resume_uk (thread_id, (bundle_ref->'paige_resume'->>'key')) WHERE role = 'user' AND
bundle_ref ? 'paige_resume'` that the plan named (C4c-1). Additive, non-destructive; the four
justifications are in §2c(B) and the migration header. `paige_chat_turn_append` is unchanged: it already
surfaces the 23505 to its caller (pgTAP), and the handler reads it.

## 5. Push decision

Pull-on-re-entry, per the owner order: a resume always happens inside an authenticated, JWT-bearing
request of the person whose objective it is. Nothing runs a conversational model server-side without a
user request. C4a needs no push at all — the approval POST is the resume. Neither does C4b.

## 6. Evidence

- `scripts/client-memory-authz/check.mjs` group 39 (C4a): 650 passed / 0 failed after the review fixes
  (633/0 before them; base 597/0). The 17 review-fix checks run against the pre-fix server: 8 red
  (39.12, 39.12b, 39.13, 39.16, 39.9b, 39.9c, 39.17, 39.20b); the other 9 pin behaviour that already
  held and kill mutants that survived review. One fixture corrected with its reason: 39.3d's "claimed
  by another request" time moved inside the proposal's window (a claim stamped at or past `expires_at`
  is a shape only the expiry sweep can produce). Run against main the original group-39 assertions are red: 21 failures (39.1–39.1e, 39.2, 39.2b, 39.3–39.3d, 39.7b, 39.8–39.8b,
  39.9, 39.10, plus the updated 13.6b2, 18.H12, 18.H15, 18.7h). Live approvals still refused: two cases added to group 26.
- Declared assertion changes to existing checks (they encoded the strand): 18.H12 (all three approved
  cards now run, each once — main ran only the one the model re-emitted), 18.H15 (both approved subjects
  run), 18.7h (the pinned scoped approval runs once; the bare token beside it is never spent), 18.7e
  (asserts what EXECUTED: one grant with the stored role), 13.6b (now picks the gate's lookup by its
  columns) + 13.6b2 (the resume selection's predicates), 18.H29 (the race targets the claim's own
  select), the harness turn-state audit admits `resumed`.
- `supabase/functions/_shared/paige-turn/resume.test.ts` (Deno, 14 tests), wired into `ci.yml`.
- vitest: turn-view (resumed announce, merged rows), reducer (resumed record, reader), approval-outcome
  (the expiry sentence joins the closed set), `PaigeAIChat.turnStates` (live one-answer, non-resumed
  unchanged, wire = persist = reload, a record outside the contract draws no card).
- Mutation tables: see the evidence record `docs/evidence/ui-delivery/c4a-approval-resume.md`.
- Harness renders (not live): 33 frames in `docs/evidence/ui-delivery/assets/c4a-approval-resume/`.

**C4b.**

- Group 40 (`scripts/client-memory-authz/check.mjs`): 70 checks (43 in the first build, 13 added by the
  round-2 review fixes, 8 by round 3: 40.4g ×3, 40.4g2, 40.4h, 40.9j, 40.9k, 40.12d; 6 after the rebase
  over INT-327 and the exact-head review: 40.1e, 40.1f, 40.14a, 40.14b, 40.9l, 40.9m). The CRM checks run the REAL
  `crm-command` handler (captured through the same module boundary as the chat): its readback before the
  claim, its atomic claim on the shared proposal store, its governed decision, its re-proposal and its
  executor call all run as shipped; only the database is the harness's (the proposal store with real
  filter semantics; `read_crm_command_result` / `execute_crm_command` as a committed-result table keyed
  by the idempotency key). The publish and Sales doors are MODELLED on their cited claim / replay /
  re-propose behaviour, not run. Whole harness 737/0 (base 667/0, measured on `origin/main` `51be9b75b`;
  the first build measured 710/0, round 2 723/0, round 3 731/0). Round 3's 8 checks against the round-2 server: 2 red (40.4g's first assertion, 40.4g2); the
  other 6 pin behaviour that already held and exist to kill M5, M6, M8, M9. Run
  against the C4a head with the final harness: 33 of the round-2 harness's 56 group-40 checks red (the rest pin behaviour
  that already held and kill mutants). Run against the FIRST C4b build (before the review fixes): 6 red —
  40.4e, 40.4f, 40.9g, 40.9h, 40.12, 40.12c — plus 2 vitest (`sales-chat-cancellation`,
  `crm-command-chat-adoption`).
- 40.13 drives every non-preview CRM action in the catalog (27; a guard fails if one is added without a
  row; since INT-327 its `deal.create` row names its client by `client_ref`) through the REAL crm-command: minted by the door, approved with no model re-emit, the stored
  command runs once under the stored key. Each command is a minimal schema-valid one; the record reads
  and executor are the harness's committed-result table, so this proves the carry-forward contract
  (shape → door schema → claimed-vs-requested), not each action's business effect.
- Harness fidelity fix, declared: the proposal store now answers PostgREST's `insert(...).select(...)`
  readback with the inserted row (it returned every row, so a door re-minting beside history read
  "multiple rows" and failed with a 503 that production does not produce). No existing check changed
  outcome (667/0 before and after).
- Existing assertions changed, declared (review fixes): 40.2e was "at most one unshown proposal row"
  and is now "no live proposal left behind"; `crm-command-chat-adoption` pins the decline list WITH the
  publish door's tools; `sales-chat-cancellation` asserts the publish tools are in that list (its
  injected bindings gain `GROWTH_PUBLISH_DOOR_TOOL_NAMES`). Fixtures changed, declared: the Sales branch
  test injects `doorPin` / `settlePinnedDoorResult` (no pinned call in that test); the publish / Sales
  drives (40.9–40.9f) now carry a thread turn showing the card, because a door token is carried forward
  only from the thread that showed its card (40.12).
- Other gates (re-measured after the rebase, against the current base `origin/main` `51be9b75b`): `ci:tsc`
  10 (= base); Deno check `paige-ai-chat` 10 diagnostics, identical (code, message) multiset to base;
  `crm-command`, `growth-publish-command`, `sales-invoice-command`, `sales-collection-command`,
  `sales-invoice-draft-command` check clean (= base); knowledge-scope 420/0 (= base); **full vitest,
  measured whole-suite on both sides (clean `git worktree add --detach` of `51be9b75b`, never a stash):
  base 625 files passed + 2 skipped, 9361 passed / 0 failed (2 skipped); C4b 626 files passed + 2
  skipped, 9371 passed / 0 failed (2 skipped)** — the +1 file / +10 tests are `door-resume-pinned` (9)
  and the frozen-command case in `crm-contact-refs` (1); the `TenantCommandCenterShell.ownership`
  load-timing flake did not fire on either side in this run. (Before the rebase, against `d78a349ed`:
  base 621 files 9316 / 0, C4b 622 files 9325 / 0.) (The
  round-2 claim "touched vitest suites 357/357 (= base)" was a subset, and the whole suite was in fact
  red: `crm-executor-error-surfacing` asserted the pre-C4b source string — round 3, finding 1);
  `door-resume-pinned`, `sales-chat-cancellation`, `crm-command-chat-adoption`, `crm-approval-door-wiring` 54/54; all 67
  `lint:*` scripts green except `lint:gold` and `lint:impeccable`, which fail identically at base
  `d78a349ed`; `edge-affected.py` → `crm-command`, `paige-ai-chat`.
- `resume.test.ts`: 20 Deno tests (6 new: door token, row selection, CRM / Sales / publish shapes, the
  re-emit note).
- `src/__tests__/door-resume-pinned.test.ts`: 9 vitest cases over the four bridges' pinned path; 8 red
  against the C4a-head bridges (the ninth pins that an unpinned Sales call is unchanged).
- Mutation table (each mutant applied alone, then the harness / Deno / vitest run; all restored):

| Mutant | Killed by |
|---|---|
| N1 door half disabled | 40.1–40.1c, 40.2a/c/d, 40.4, 40.4c/d, 40.5, 40.6, 40.7c/d, 40.8/b, 40.9–40.9e, 40.11b |
| N2 selection drops the workspace | 40.3, 40.7b |
| N3 selection drops the user | 40.3 |
| N4 / N5 selection drops thread NULL / client NULL | 40.3 |
| N6 CRM branch ignores the pinned request | 40.1b, 40.2a, 40.7d |
| N7 used CRM/Sales rows not read back | 40.2a, 40.4c, 40.7d, 40.9e |
| N8 door re-emit guard removed | 40.5 (both) |
| N9 door capability check removed | 40.6 |
| N10 expired short-circuit removed | 40.4 |
| N11 a re-proposal becomes a fresh card | 40.4c, 40.4d |
| N12 expired-at-claim reads "can't confirm" | 40.4d |
| N13 used publish row handed to the door | 40.9b |
| N14 publish APPROVAL_NOT_AVAILABLE ignored | 40.9c |
| N15 row integrity check removed | 40.10b |
| N16 CRM preview binding allowed | 40.10; Deno |
| N17 doors require a thread | 40.11b |
| N18 Sales pin not passed | 40.9d, 40.9e |
| N19 publish pin not passed | 40.9f (survived the first run; 40.9f added) |
| N20 Sales `spent` ignored | 40.9d, 40.9e |
| N21 row selection ignores liveness | Deno (survived the first run; equivalent in production — the live unique index makes the live row the newest — the unit test was strengthened to pin the rule) |
| N22 Sales shape drops the workspace binding | Deno (the bridge's own check also refuses it in the harness) |
| B1 publish bridge still looks up when pinned | vitest (3) |
| B2 invoice bridge does not report `spent` | vitest (2); 40.9d, 40.9e |
| B3 publish bridge never reports `approvalUnavailable` | vitest (1); 40.9c |
| F1 publish door missing from the decline seam (review finding 1) | 40.9g; vitest (2) |
| F2 the door's re-proposal not retired (finding 2) | 40.4e, 40.4f, 40.9h |
| F3 retire only the card's fingerprint (Sales mints a new one) | 40.9h |
| F4 retire without the time bound | 40.9i |
| F5 no thread binding for door tokens (finding 5) | 40.12 |
| F6 a turn-read failure carries door tokens anyway | 40.12c (survived the first run; 40.12c added) |
| V4 re-emit guard only after a call that ran ("here") (finding 3) | 40.5c |
| V7a / V7 door selection drops the server-issued filter(s) (finding 4) | 40.10c |
| M5 retirement allowance widened from 2 s to 1 h (round 3) | 40.9j (survived round 2) |
| M6 retirement drops `tool_name` (round 3) | 40.9k — only with a synthetic 64-bit fingerprint collision; near-equivalent in production (the fingerprint hashes the tool, and the live unique index on (user, fingerprint) would block the CRM door's re-proposal beside such a row) |
| M8 thread binding admits every token once one card was shown (round 3) | 40.12d (survived round 2) |
| M9 retirement drops `consumed_at IS NULL` (round 3) | 40.4h (survived round 2) |
| M10 retirement drops the pinned-row exclusion (round 3, new predicate) | 40.4g2 |
| M11 a failed door claim settled without re-reading the row (round 3, the round-2 behaviour) | 40.4g, 40.4g2 |
| F4 re-run against the round-3 code (no time bound) | 40.9i, 40.9j |
| S1 vitest: the CRM failure result built from a hand-picked subset (`code: crmBody.code` for `...crmBody`) | `crm-executor-error-surfacing` "forwards the whole failure body…" |
| X1 retirement drops `tenant_id` (exact-head review: survived) | 40.9l |
| X2 retirement drops `user_id` (exact-head review: survived) | 40.9m |
| R1 crm-command resolves the frozen canonical command in place (the pre-fix code, below) | 40.G / 40.ABORT (the deal card is never minted); vitest `crm-contact-refs` source contract |
| R2 INT-327's Chat-side `preserveResolvedDealClient` dropped | 40.G / 40.ABORT at 40.1f (the door refuses the unlinked deal: `CRM_COMMAND_INVALID` at `command.client_ref`) |

**Rebase over INT-327 (#1761, `51be9b75b`) — what broke and what was fixed.** After the rebase the
harness crashed at 40.2c (`Cannot read properties of null (reading 'fingerprint')`): no `deal_create`
card was minted. Two causes, both found by driving the real crm-command:

1. *Fixture gap.* INT-327 makes `deal.create` require a canonical client (`client_ref` / `contact_id`)
   or an explicit `unlinked_reason`; group 40's deal fixture named neither, and crm-command correctly
   refused it (`CRM_COMMAND_INVALID`, `command.client_ref`). The fixture now names its client by
   `client_ref` (and 40.13's row too), and the harness models crm-command's service-side client lookup
   with its filters honoured (`clients`, `eq tenant_id`, `eq account_number`).
2. *Product defect, on `main` since 2026-10-01 (`124a2f3be`), not introduced by C4b or INT-327.*
   crm-command canonicalizes the request into a FROZEN object (`catalog.ts` `markCanonicalCrmCommand`)
   and then `resolveCommandContactRefs` fills references in place — which throws in strict mode
   (`Cannot assign to read only property 'client_ref'`). So every crm-command request that names a
   contact by `client_ref` — the reference Paige is shown, and since INT-327 the required shape of a
   linked deal — threw before anything was proposed or run. Reproduced against a clean `origin/main`
   worktree for `deal.create` and `contact.update`. Fixed in crm-command: the resolver works on a copy
   that is issued back through the canonical boundary (`body.command = canonicalizeCrmCommand(resolvedCommand)`),
   before the readback, the approval subject and the request; a vitest case pins both halves (the frozen
   object throws, the re-canonicalized copy carries the resolved client and keeps the INT-327 approval
   subject). Production impact was not measured in this slice (no prod access here); the C4b
   coordinator's post-deploy check then CONFIRMED the defect on production (crm-command, 2026-10-05
   21:51 UTC, before the fix deployed) and the repair live with C4b (crm-command v77, coordinator-
   reported). The repair is specific to this frozen canonical command: it resolves a copy and re-enters
   the canonical boundary; it is not a pattern for mutating canonical commands in general. The
   regression coverage (40.G / 40.ABORT, vitest `crm-contact-refs`) is kept.

INT-327 × C4b, proven: the door stores the deal AFTER resolving its client, so the pinned resume runs
the stored command WITH that client (40.1e); in a client-scoped conversation where the model omits the
client, Chat's `preserveResolvedDealClient` adds it before the door is asked and the resume runs that
stored deal (40.1f); and the resume never bypasses INT-327 — the door re-validates and re-resolves the
stored command on every request, so a stored deal with no client (a pre-INT-327 proposal still in its
window) is refused (40.14a) and a stored deal whose client no longer resolves is refused as not found
(40.14b), nothing runs, no card. The group now stops with a NAMED failure (40.G, carrying the door's
answer, then 40.ABORT) instead of a TypeError when a card it approves was never minted; the rest of the
harness still runs. One harness model made more faithful, declared: the modelled Sales door now reuses
only the caller's live cycle (this person, this workspace — `sales-invoice-command` ~L73-77); no
existing check changed outcome.

Not killed, stated: **V7b** (drop only `.not("issued_in_request","is",null)` from the door selection) is
equivalent — the next predicate `.neq("issued_in_request", requestNonce)` already excludes NULL (SQL
three-valued logic, and the harness store models it the same way); the filter is kept to mirror the
door's claim predicate for predicate. **N21 / N22** are killed by the Deno unit tests only (unchanged
from the first build: N21 is equivalent in production, N22 is also refused by the bridge's own check).

**Review fixes (verifier + compliance, round 2).**

| Finding | Disposition |
|---|---|
| V1 HIGH / C1: a declined publish card published from a stale Approve | Fixed: publish door tools added to the decline seam (§2b item 6). 40.9g; F1. |
| V2 MEDIUM / C1 MEDIUM: a failed pinned claim leaves a hidden live re-proposal the old token can claim | Fixed in C4b: `retireDoorReproposal` (§2b item 3). 40.4e, 40.4f, 40.9h, 40.9i, 40.2e; F2–F4. Not done: a cycle nonce in crm-command's proposals (door contract change) — the durable fix, open. |
| V3 LOW: no test of the "elsewhere" re-emit guard | 40.5c; V4 killed. |
| V4 LOW: server-issued selection filters never exercised | 40.10c kills V7a / V7; V7b is equivalent (above). |
| V5 LOW: a door resume is not tied to its card's thread | Fixed: the card binding (§2b item 1). 40.12, 40.12b, 40.12c; F5, F6. |
| V6 NIT: `readback` written, never read | Removed (the pin now carries `toolName`, `tenantId`, `selectedAt`, which the retirement reads). |
| C2: gate row 1 overclaimed | Reworded: discharged at harness level; Sales / publish modelled; authenticated acceptance owed. |
| C3: master doc said 709/0 | Replaced with the measured 723/0. |
| C4: only two CRM actions run through the real door | 40.13: all 27 non-preview actions. |
| C5: "PR TBD" | Unchanged: filled in the follow-up commit once the PR exists (the C4a pattern). |

**Review fixes (second independent re-verifier, round 3 — FIX_FIRST).**

| Finding | Disposition |
|---|---|
| 1 BLOCKING: full vitest red — `crm-executor-error-surfacing` asserted the pre-C4b source string (`JSON.stringify({ success: false, ...crmBody,`) | Expected string updated to the C4b shape (`crmContent = { success: false, ...crmBody,`), plus an assertion that `crmContent` is what the tool result serialises. Still bites: S1 (hand-picked subset) fails it. Full suite measured in the "Other gates" line above. |
| 2 LOW: retirement window tightness untested (M5 survived) | 40.9j: a live Sales card for the same operation shown minutes before the request stays live. M5 killed. |
| 3 LOW §13: a failed pinned claim on a still-live row reported "may already have happened" | `settlePinnedDoorResult` re-reads the pinned row first, C4a's way (§2b item 3); still live → "could not be checked", nothing ran, card still usable; and the retirement never consumes the pinned row. 40.4g, 40.4g2; M10, M11. |
| 4 LOW: thread binding with several tokens untested (M8 survived) | 40.12d. M8 killed. |
| 5 LOW: retirement predicates `tool_name`, `consumed_at IS NULL` unexercised (M6, M9 survived) | 40.4h (consumed rows keep `consumed_at`) kills M9; 40.9k kills M6 with a synthetic collision row — stated as near-equivalent in production. |
| 6 docs: "touched vitest suites 357/357 (= base)" | Replaced with the measured whole-suite numbers ("Other gates" above) and the new authz count, here and in the master doc. |

Not mutated, stated: dropping `.neq("issued_in_request", requestNonce)` from the door selection is
unobservable (doors mint with their own per-invocation nonce, never the chat's) and is kept to mirror
the door's claim predicate for predicate.

**C4c.** Base = a clean detached worktree at `0fe769ef8`; head = the C4c build worktree. Every number
below was measured on both, whole-suite.

- `scripts/client-memory-authz/check.mjs`: base 750/0 → first build 787/0 → after the review fixes
  800/0 (group 41 = 47 checks; group 40 gains 40.15–40.15c, the door composition). Group 41 run against
  the base server: 31 of the first 37 fail; the 6 that pass at base (41.3, 41.8, 41.11, 41.12, 41.13,
  41.13c) pin behaviour that already held. The 10 added after review (41.17–41.20) all fail against the
  first build's server; 40.15–40.15c pass there too (a test gap, not a defect) and bite on mutation P13.
- `scripts/knowledge-scope/check.mjs`: 423/0 base = 423/0 head.
- `supabase/functions/_shared/paige-turn/resume.test.ts` (Deno): base 20 → first build 26 → head 28, 28/28.
- vitest, whole suite: base 628 files passed + 2 skipped, 9423 passed / 2 skipped → first build 630
  files, 9448 → head 630 files passed + 2 skipped, 9452 passed / 2 skipped (+29: `PaigeAIChat.askUser`
  19, `PaigeAskCard` 6, `turn-view` 4). `PaigeAIChat.askUser` against the base client: 12 of the first 14
  fail; the 4 added after review all fail against the first build's client.
- `npm run -s ci:tsc`: ratchet 10 = 10. `deno check supabase/functions/paige-ai-chat/index.ts`: 10
  diagnostics at base and head, the same (code, message) multiset (one TS2769 message differs only in the
  print order of a union's literals).
- pgTAP `supabase/tests/chat_turn_answer_claim_unique.sql` 11/11 and the two-session race 7/7 (both re-run
  after the review fixes; the migration and both proofs are unchanged), locally on
  PG16 with a minimal stand-in schema and a labelled five-function pgTAP shim; CI runs both on the
  replayed Supabase stack (`paige-spine-contract.yml`). DB mutants: §2c(E).
- Lints: every `lint:*` passes except `lint:gold` and `lint:impeccable`, whose output is byte-identical
  to base (pre-existing). `lint:shadow-vars` caught a selected-option inset ring that emitted no
  box-shadow; fixed with Tailwind's `shadow:` type hint and the affected frames re-rendered.
  `lint:migration-versions` passes. `impeccable detect` on the three touched UI files exits 0.
- Harness renders (not live): 78 frames (7 added after review: the re-asked question on reload and a
  file attached while a question is open, page and drawer, light and dark) in `docs/evidence/ui-delivery/assets/c4c-ask-user/` (light, dark,
  320px, 390px, 200% zoom, reduced motion, keyboard), `results.json` beside them; the evidence record
  passes `scripts/ci/ui-delivery-evidence.mjs`.
- Mutation tables (server S/H/R/P, database DB, client C/CF, and the independent reviewer's mutants
  re-applied to the moved code): the evidence record. Every server and database mutant is killed; client
  C2 is equivalent today and stated.
- Review fixes, measured whole-suite again at head: `ci:tsc` 10 = 10; `deno check` the same (code,
  message) multiset as base (10); every `lint:*` exits 0 except `lint:gold` and `lint:impeccable`, whose
  output is byte-identical to base; `impeccable detect` on PaigeAIChat.tsx and PaigeAskCard.tsx exits 0;
  the evidence record validates.

**C4c review fixes (second independent re-verifier — FIX_FIRST).**

| Finding | Disposition |
|---|---|
| V2-1 MEDIUM (blocking): a request that dies after the claim leaves the claim as the newest turn; after "may still be working" the client re-read the thread, had no open question, and sent the person's re-send as an ordinary message — the server's re-ask was unreachable, the copy promising it untrue, and a re-send inside the window could start the same work twice | The composer stays bound to a claimed question (`claimedAsk` in `PaigeAIChat.tsx`: the thread ends on an answer claim that directly follows its question): the re-send carries `resume {kind: "answer", ask_id}`; the card stays frozen "Answered below"; the hint says "PAIGE has your answer. If she hasn't replied 10 minutes after you sent it, send it again and she'll ask her question again", with "Ask something else instead". Server unchanged in shape and proven exactly-once: young → 409 IN_PROGRESS, no model call (41.19; two at once 41.19f); stranded → re-asked once (41.19d: the same id sent again names that re-ask, nothing saved); two stranded re-sends at once never reach PAIGE and only one answer to the newest re-ask runs (41.19e). One window everywhere: `ANSWER_STRANDED_AFTER_MINUTES` = 10 drives the server constant, the server copy and the client hint (41.19 asserts the copy; mutation V21c). Vitest: IN_PROGRESS → re-read → send again carries `resume` (red on the previous build's client), reload with a claim binds the composer (red there too). Mutation V21a (the client drops `resume` on the stranded-claim re-send) killed by both; V21b (binds to any preceding question) killed. |
| V2-2 LOW: `resolveAskLiveness` "reopened" did not follow the chain — Q1 → claim → Q2 → Q2's claim → continuation, then Q1's id sent again read "reopened" naming Q2 | The chain is followed: after a claim, the run of re-asks directly after it is read and the NEWEST is resolved; live → reopened (it), anything else → that state (answered / pending on Q2 / stale). Deno "the first question's id follows the chain…" (answered, pending, moved past, two re-asks at once); harness 41.17e (409 ASK_ALREADY_ANSWERED, never ASK_REOPENED). Both red on the previous build; mutation V22 (the previous build's shape) killed by the Deno test, 41.17e and 41.19e. |
| V2-3 LOW (a): a claim that landed behind another tab's message is saved in the thread, yet the person was told their message was "back in the box — send it as a new message" | 409 ASK_NOT_OPEN with `answer_kept: true` and "Another message reached PAIGE before your answer, so she didn't act on it and her question stays unanswered. Your answer is kept in the conversation."; the client clears the words from the composer (they are in the transcript the re-read draws). 41.18 tightened (red on the previous build); vitest; mutations V23a, V23c killed. |
| V2-3 LOW (b): a choice made on the card and refused was told "your message is back in the box", but it never was in the composer | The server's reasons now say only what happened to the answer; the client adds "Your message is back in the box." for typed words only. Vitest (card choice refused → no box sentence); mutation V23b killed. |
| V2-4 test gaps | VFY2.429 / VFY2.402 adopted as 41.17f (kills N1); N2: vitest "a 5xx … Retry sends the same words WITH the question's id"; N7: vitest "a claim for ANOTHER question never binds the composer, and never answers this one"; N8: 41.22 (a document turn is not offered `ask_choices`); a pre-model ACTIVE_ACCOUNT_CHANGED after binding (a turn carrying memory evidence, the persona resolver switching after the first read): 41.23 — 409, no claim, no model call, the question still live, then answered once from A. All four mutations killed. |
| V2-5 INFO: the in-stream snag turn after the claim was read as saved with `bundleRef: null` | Measured, not assumed: the snag turn already carries the answer's record — `withTurnRecord` builds the bundle for any non-empty text and `withResumeRecord` adds `paige_resume {kind: "answer", from_turn_id}` (and `turn_state.resumed {kind: "answer"}`). Pinned by 41.21 (a tool whose error cannot be read throws inside the continuation: snag saved INTERRUPTED, resumed answer, `paige_resume.from_turn_id` = the question turn, the question reads answered). No code change. |

Measured again, whole-suite, base (the clean `0fe769ef8` worktree) → head:
- `client-memory-authz` 750/0 → 809/0 (group 41 = 56 checks: +41.17e, 41.17f ×2, 41.19d, 41.19e,
  41.19f, 41.21, 41.22, 41.23; 41.18 and 41.19 tightened). Group 41 at head run against the previous
  build's server: 125 pass, 4 fail — 41.17e, 41.18, 41.19 (the copy), 41.19e; the others pass there too
  (test gaps adopted from the re-verifier, each pinned by a mutation).
- `knowledge-scope` 423/0 = 423/0.
- Deno `resume.test.ts` 20 → 29, 29/29 (the new chain test red on the previous build).
- vitest whole suite: 628 files passed + 2 skipped, 9423 passed / 2 skipped → 630 files passed + 2
  skipped, 9458 passed / 2 skipped (+35: `PaigeAIChat.askUser` 25, `PaigeAskCard` 6, `turn-view` 4). The 6
  added this round: 3 red on the previous build's client (the two V2-1 cases and the kept answer), 3
  pinned by mutation (N2, N7, V23b).
- `ci:tsc` ratchet 10 = 10; `deno check supabase/functions/paige-ai-chat/index.ts` 10 = 10 diagnostics,
  identical (code, message) multiset.
- Every `lint:*` (67 scripts) exits 0 except `lint:gold` (output byte-identical to base) and
  `lint:impeccable` (identical to base once the worktree path is normalised); `lint:migration-versions`
  passes; `impeccable detect` on PaigeAIChat.tsx and PaigeAskCard.tsx exits 0.
- Harness renders (not live): 83 frames — the 78 re-rendered on the new client and 5 new
  (`c4c-reload-claimed-{page,drawer}-{light,dark}`, `c4c-reflow320-reload-claimed-page-light`); every
  frame: no overflow, no page errors, gold only on Send/Stop/Approve/New chat, ask text ≥ 5.32:1 (the
  claimed hint 5.32:1 light, 7.52:1 dark). One frame (`c4c-c2-free-form-page-light`) came out of the
  batch run before its first turn had landed and was re-rendered alone; it then matched the record.
- The evidence record passes the gate's own checks (`verifyPinnedBundle`, `classifyUiChanges`,
  `validateEvidenceText` from `scripts/ci/ui-delivery-evidence.mjs`) over the uncommitted tree against
  `0fe769ef8` — the script's CLI needs a committed head, and nothing was committed.
- Mutations this round (each reinstated, the named suite run, restored; sources byte-identical after):
  N1, N2, N7, N8, V21a, V21b, V21c, V22, V23a, V23b, V23c — all killed (the evidence record's tables).

**C4c review fixes (exact-head review of `05113f4ce` — FIX_FIRST) and the CI round on PR #1771.**

| Finding | Disposition |
|---|---|
| B1 (blocking): a workspace switch after PAIGE was reached strands the claim (the in-stream re-checks stop the stream; the append refuses the thread as another workspace's, so nothing is saved after the claim). The re-ask then said "nothing was done with it yet" — false once PAIGE had run tools or queued a proposal — and answering it ran the objective again with no hint of the first attempt | Every word on that path is now true either way: `ASK_REOPEN_LEAD` = "I didn't finish carrying on from your answer. Anything I'd already done is saved."; `ASK_REOPENED` = "PAIGE didn't finish carrying on from your answer. Anything she'd already done is saved, and she's asked the question again."; `ASK_ANSWER_IN_PROGRESS` = "PAIGE already has your answer to that question, so this wasn't sent again. …" (never "may still be working", which the server cannot know). `answerTurnNote` on a re-asked question (`reopens` set) tells PAIGE an earlier attempt may have done part of the work: check what already exists and repeat nothing. New 41.23b–e drive the in-stream switch (persona flips mid-stream after the model call: claim last, `pending`; young re-send → IN_PROGRESS, no "still working"; aged → re-asked with the true lead; the re-asked answer's prompt carries the check-first line; a first answer's does not). Mutations (re-run one at a time by the fix-round verifier): the old lead → 41.17, 41.23c; the old in-progress reason → 41.19, 41.23c; the old reopened reason → 41.23c; the check-first line dropped → 41.23d; the line added to every answer → 41.23e. Deno: the note on a re-asked question (both skipped and not) and the lead never saying "nothing was done". Residual: whether PAIGE avoids repeating an auto-lane act rests on her following the note (model adherence, UNVERIFIED); confirm-lane acts each still need their own approval |
| Craft 2: the claimed hint was long, had no full stop, and repeated the B1 untruth | "PAIGE has your answer. No reply within 10 minutes? Send it again and she'll ask again." (persona name) |
| Craft 3 / 4: the skipped record used the open-question glyph and hard-coded "PAIGE" | The skipped record carries the settled check; `PaigeAskRecord` takes the tenant's assistant name (vitest: name, glyph = answered ≠ unanswered) |
| Craft 1, 5, 6; nits (an `ask_choices` rejected by `buildAskRecord` falls through to dispatch as unknown; compaction one turn shorter; `ASK_ALREADY_ANSWERED` wording for a stranded claim followed by an ordinary message) | Not changed this round, recorded: the c5 double status is the frozen prototype wording (§7); the disabled "Use this" and arbitrary px sizes are within the craft floor's tolerance and left for the C3b/C4f visual pass |
| CI `audit` red on every new head | Not this PR's: GHSA-68fv-2mgg-jv7q (high) on `source-map-js` 1.2.1, published after main's last green audit. Fixed here by bumping that one `package-lock.json` entry to 1.2.2 (integrity checked against the registry); `npm audit --omit=dev --audit-level=high` exits 0. Stated: the production build installs from `bun.lockb`, which this bump does not touch (the drift `security-audit.yml` already notes); which production package pulls it in was not traced |
| CI `verify` red: capability-kit anti-bypass debt grew (`direct-tool-definition` · `ask_choices`) — the main chat's question tool was a second inline definition beside Studio's (the reviewer's registry-lint nit, measured by the stricter guard) | One declaration site: `askChoicesSpec` holds the surface's wording (Studio's or the main chat's, verbatim — the two never both apply) and one `toolDefs.push` defines the tool. capability-kit: "no new bypass" (baseline not touched); chat-tool-registry: 96 inline, none added. Harness 813/0 (group 39 Studio unchanged) |

Fix-round independent verifier (§39, the delta `05113f4ce..1e4285aa2`): **SHIP**, no blocking findings;
its notes taken here (this master/brain wording, the mutation attribution above, the lockfile scope).
Measured at the fix head: `client-memory-authz` 813/0 (base 750/0); `knowledge-scope` 423/0; Deno
`resume.test.ts` 29/29; `ci:tsc` 10 = 10; `deno check` index.ts 10 diagnostics, the same (code) multiset
as base; every `lint:*` exits 0 except `lint:gold` and `lint:impeccable` (neither names a touched file;
both fail identically on base); `impeccable detect` on PaigeAskCard.tsx and PaigeAIChat.tsx exits 0 with
no findings; vitest whole suite 630 files passed + 2 skipped, 9459 passed / 2 skipped (+1 `PaigeAskCard` record test; the `TenantCommandCenterShell.ownership` failure the reviewer saw on both sides passed this run — it is unrelated and intermittent); harness renders: all 83 C4c frames re-rendered on the fixed client.

## 7. Not verified

- An authenticated drive of the deployed chat (a real approval on a Solo test workspace): PROOF OWED.
  The Solo QA tenant and `LIVE_DRIVE_*` credentials are still an owner decision (plan §9.2).
- The real model's wording after a resume (it reads the result and continues); the harness model is a
  stub.
- Studio takes the same server path (harness 39.20) but its client does not render the resumed frame
  (C3b); not driven in a browser. On Operator (no thread is sent) the C4a general-gate resume does not
  run — open work; Operator **door** approvals inside a workspace do resume since C4b (40.11b, §2b
  "Operator").
- The real model's adherence to the neutral rule 1 and the turn-local note (harness model is a stub).
- C4b: the publish and Sales doors were modelled, not run (40.9h / 40.9i model the Sales re-mint, cited
  to `sales-invoice-command` ~L114-139); the real `crm-command` ran against a harness database. A
  retirement of the door's re-proposal that fails in production is logged, not retried, and that one
  row then stays claimable by the old token until it expires (30 min CRM, 10 min Sales) — the cycle-nonce
  door change would close it. An authenticated approve of `crm_create_contact` and `deal_create` with no model
  re-emit on the deployed platform is PROOF OWED, and is the precondition for retiring the client CRM
  lane (§58 callout above). Agency and sub-account personas were not driven separately; the client-seat
  and anonymous rows are read in source.
- C4b: CRM preview-bound proposals (merge, hard delete, bulk update, task/deal delete) are not carried
  forward — open work, needs a door contract change.
- C4b, open, pre-existing (re-verifier round 2, INFO 6): **the client CRM card lane re-mint hole.** The
  card's own lane (`PaigeAIChat.tsx` ~L1949-1990) invokes crm-command with the approved fingerprint; when
  that claim finds nothing (a declined card approved from a stale tab, a raced token) crm-command proposes
  again under the SAME fingerprint (no cycle nonce), the lane reads the answer as "not run" (its
  `reproposed` branch fires only on a DIFFERENT fingerprint) and retires nothing — so a live, unshown
  proposal is left that the old token can claim later: the lane in another tab that still shows the
  card, or, since C4b, a server echo of that token from another surface, which now carries it to the
  door without a model re-emit (before C4b that echo needed the model to re-emit the call). C4b retires the door's re-proposal only on its OWN (server) path. Not fixed here: the durable
  fix for both paths is the crm-command cycle nonce above (a door contract change); a lane-side retirement
  would be a second claim-adjacent write in the client and is not proposed. Recorded as open work, not
  claimed closed.
- C4b: no visible UI changed (the same report card and resumed frame), so no new evidence record or
  render; the C4a renders cover the presentation.
- C4c: an authenticated drive of the deployed chat — a real question on a Solo test workspace answered
  once, then sent again, then from a second tab — is PROOF OWED to C4f (which drives C4a/C4b/C4c
  together); the Solo QA tenant and `LIVE_DRIVE_*` credentials are still an owner decision.
- C4c: the real model's choice of when to ask, its question's wording, and its adherence to the answer
  note (continue the same work, never invent the missing fact, never treat the answer as approval) — the
  harness model is a stub.
- C4c: the migration's persisted apply on production (the `schema_migrations` row and the index in
  `pg_indexes`) is owed after merge (§32); pgTAP and the race ran locally against a stand-in schema, not
  the replayed stack.
- C4c: Studio's client does not bind its replies to the saved question yet (the server saves Studio's
  question as the same record; 41.16); Operator (no thread is sent) keeps asking in prose — the tool is
  not offered there.
- C4c: a question asked beside other calls in Studio still drops its siblings (unchanged, not this slice).
- C4c: real fonts were not loaded in the harness frames (system fallback); contrast is measured on the
  rendered pixels. Frame c5's record line ("Not answered") follows the frozen prototype wording.
- C4c (re-verifier 2, V2-1): the claimed-answer path is proven in jsdom and against the harness's
  doubles with seeded claim ages — not against a real platform kill of a running request, and not on the
  deployed chat. A withheld continuation (the workspace changed while PAIGE was streaming a turn that
  carried protected evidence) saves nothing after the claim, so the composer holds on "has your answer"
  for up to 10 minutes before a re-send re-asks it — truthfully worded, and the re-asked answer tells PAIGE
  to check what already exists, but whether she avoids repeating an auto-lane act rests on her following
  that note (real-model adherence UNVERIFIED; stated residual, §2c(E); exact-head review B1).
- C4c, acceptance item 3 on the DEFAULT composer path — **UNVERIFIED** (verifier F2). While a question
  is open, typed words are sent as its answer by default (frame c2), so an unrelated reply typed there IS
  bound as the answer; whether PAIGE then declines to fill the missing fact rests on the answer note
  alone. 41.3c proves the note is in the prompt and says so; real-model adherence is not proven (the
  harness model is a stub). What IS proven structurally: a message not sent as the answer ("Ask something
  else instead", a file, a voice turn, an approval) is never bound (41.3, vitest c5, the file case).
