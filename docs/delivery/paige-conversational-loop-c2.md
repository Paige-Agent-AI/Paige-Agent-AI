# PAIGE conversational loop — C2: truthful tool START + FINISH

Owner ruling (2026-10-04, after C1): add truthful tool/action START + FINISH semantics. Keep the
low-level tool lifecycle in the expandable "What PAIGE did" trace; narrate in the conversation only
when it is useful — never turn every tool start into visible prose. Fix the continuation-budget
replay gap before or during C2, so the living-turn UI (C3) does not amplify it: the saved canonical
turn and the visible completed turn must converge.

C2 ships as **two PRs, in order**, so no open tab ever misreads a lifecycle frame:

- **C2a — clients ready + replay fix** (this document's "As built" section). Every client learns the
  step lifecycle before any server sends a START.
- **C2b — the server emits START** for each tool that has passed every policy gate and reaches its
  handler, and FINISH as soon as it is over, instead of building every step at the end of the round.

## The lifecycle contract

One frame, `paige_step` (no new top-level key: an unknown key is dropped by the typed consumers, so
a START would never close). The same id moves through:

| status | meaning |
|---|---|
| `running` | the tool passed every policy gate and its handler is running now |
| `done` / `error` | it finished; the row stays |
| `withdrawn` | it started, but nothing it did is worth showing (its result is one the trace does not render) — the row is removed |
| missing | an older frame: means `done` |
| anything else | ignored, never drawn as done |

A row still `running` when the read ends — for any reason — is dropped (`settleOpenSteps`), so the
"at work" strip and every spinner always stop. Only `done` / `error` steps ever persist in
`bundle_ref.turn_trace`.

## C2a — as built (2026-10-04)

**Clients (one home for the rules: `src/lib/paige-stream`, shared by every consumer).**
- `PaigeStepTrace` / `upsertStep`: merge by id; `withdrawn` removes; unknown status ignored; missing
  status = done. `StatusGlyph` no longer shows ✓ for an unknown status.
- `PaigeAIChat`, `PaigeChat`: settle open steps whenever the read ends (done, rollback, error, abort,
  halt). `PaigeAIChat` settles only while its request is still current, so a superseded request never
  clears the newer turn's running rows.
- Studio (`useStudioChat` + `StudioSession`): upsert by id (later frame for an id replaces the earlier
  one, keeping its start time), a running glyph, removal on `withdrawn`, settle at read end. **This
  deliberately replaces the old pin "first id wins, status collapses to done|error"** — under it a
  START would have won and hidden its own close. `useOperatorChat` ignores steps and is unchanged.

**Server.**
- `boundTurnTrace` persists only `done` / `error` steps (`running` / `withdrawn` never persist; a
  missing status still reads as done; skipped steps do not use the entry cap).
- **The continuation-budget replay defect is fixed.** The exhausted branch used to stream the blockage
  sentence and then replay the last narration round (and the provider's `[DONE]`) after it, while the
  saved turn held only the sentence; if that narration round never finished, the wire said
  `LIMIT_REACHED` and the record `INTERRUPTED`. It now replaces `finalChunks` with exactly the saved
  sentence plus `[DONE]` (server-authored, so `lastRoundFinished = true`), and the one replay path
  sends terminal → phase → the saved sentence → `[DONE]`.
- **A new standing rule: the streamed answer equals the saved text** for every driven turn
  (`scripts/lib/audit-turn-frames.mjs` `wireAnswerMatchesSaved`; client-memory-authz 36.8b over every
  drive, knowledge-scope 29.13, unit 36.8c). Measured clean after the fix; with the fix reverted it
  reports 7 mismatches — 4 of them pre-existing drives ("Do not run it.") that had been streaming
  narration after the sentence unflagged. Studio `ask_choices` turns count `paige_choices.prompt` as
  the answer, because that is what is saved.

**Evidence.**
- client-memory-authz 559/0 (36.11c wire == saved for the exhausted turn; 36.11d a cut-off last round
  stays `LIMIT_REACHED` on wire and record; 36.11e the protected variant; 36.8b/36.8c the rule);
  knowledge-scope 419/0; client suites green (see the PR); `ci:tsc` 10/10; Deno chat 11 errors, same
  codes as base.
- Mutation proofs: every fix above reverted fails its case (tables in the PR).
- Rendered frames of the Studio running row: `docs/evidence/ui-delivery/assets/c2a-step-lifecycle/`.
- UNVERIFIED: an authenticated drive. Nothing visible changes until C2b sends `running`.

## C2b — as built (2026-10-05)

The server now sends each tool's step as it starts and as it finishes, instead of building every step
at the end of the round. Nothing new is narrated in the conversation: a START is a `paige_step` row in
"What PAIGE did", never prose.

**The rule.** The owner ruling is the one at the top of this document: truthful tool/action START +
FINISH, the lifecycle in "What PAIGE did", no prose per tool start. Under it, the integrator decided
where a START may appear:

1. **No START for a call refused by a policy gate:** authority, the seat (a client seat), the workspace
   role, the autonomy lane, an approval still owed, a door (sales, publish, CRM), the Studio capability
   boundary, the workspace binding (no workspace resolved; a service-role CRM tool bound to a workspace
   that is not the caller's own), and internal text in a draft for a customer.
2. **No START for a call whose non-empty arguments cannot be parsed at all.** Nothing true can be said
   about what it would do. Empty or whitespace-only arguments read as `{}` and are not refused for this.
3. **A START for every call that passed every policy gate and reached its handler.** If the handler then
   rejects its input, the row closes `error` (see "Handler input refusals" below).
4. **A FINISH never says `done` for a call whose result reports failure.**

**The START map** (`_shared/paige-turn/step-start.ts`, pure, no imports).
- `STEP_START_LABELS` — 63 tools with a fixed present-tense label ("Buying that number", "Searching the
  web"). Never the past-tense claim `describeStep` would make with no result ("Bought a number").
- `STEP_START_SAME_LABEL` — `action_file` and `delegate_to_subagent` keep `describeStep`'s own wording:
  it is already present tense, from a fixed vocabulary, and does not depend on the result.
- `STEP_NO_START` — 12 tools that are never announced: `web_fetch` (never rendered); `social_post`,
  `social_analytics`, `social_accounts` (refused at dispatch every time); `get_business_snapshot` (no
  dispatch branch); the publish door (`growth_page_publish`, `growth_form_publish`) and the CRM door
  (`crm_create_contact`, `crm_update_contact`, `crm_log_activity`, `deal_create`, `deal_move_stage`),
  which decide authority, approval and execution remotely in one call, so nothing can be announced
  before their answer. They still get a FINISH, as before.
- Every other tool name (no START wording) is never announced either: for example
  `update_client_data`, the funding tools, `marketplace_browse`. Each still gets its FINISH, as before
  (`marketplace_browse`'s post-read workspace check still closes a FINISH-only row).
- A START never carries `detail`. The group comes from `describeStep`, asked with no result.
- `src/__tests__/paige-step-start.test.ts` reads `describeStep`'s cases out of the edge function and
  fails if any tool has no START decision, or if a decision names a tool `describeStep` does not know.

**Where the START fires.** Inside `executeToolCalls`, after the gates that `continue` ahead of dispatch
(Studio scope, seat, role, autonomy lane, approval), immediately before the dispatch branches, and only
when `announceStart(tc)` says yes. `announceStart` asks again, without producing a result, the policy
gates that sit inside the dispatch chain, and it refuses unparseable arguments (rule 2):

| refused before START | how it is asked |
|---|---|
| no START wording (including the social tools and the doors in `STEP_NO_START`) | `describeStepStart` |
| sales, publish and CRM doors | the door name sets (`CRM_COMMAND_TOOL_NAMES`, `GROWTH_PUBLISH_DOOR_TOOL_NAMES`, `SALES_*_TOOL_NAMES`) |
| owner/admin role (defense in depth behind the early role gate) | `requiresWorkspaceAdmin` + `authorityAdmits(authorityForCall(tc.id))` (cached per call) |
| no workspace resolved | `personaCtx.tenant_id`; only `STEP_START_WITHOUT_WORKSPACE` (6 tools that run tenant-less) may start without one |
| service-role CRM tools bound to the caller's own workspace | `crmWorkspaceBindingRefusal`: one read of `current_user_tenant_id` per call, memoized and shared with the owner-ops branch, cleared when the next call starts |
| internal text in a customer draft (`action_file`, `action_advance`, `propose_action`, `calendar_link_send`) | `outboundDraftRefusal`, memoized per call on tool + stage + arguments |
| non-empty arguments that do not parse | `JSON.parse` of the raw arguments; empty or whitespace reads as `{}` |

**Shared pre-checks.** A few input checks are also asked before START, because each is a shared source
the branch itself calls (the same function, or the same one read), so asking it costs nothing:
`action_advance`'s unaddressable id (`unaddressableConfirmArgs`), `propose_action`'s missing body or
recipient (`readProposeActionDraft`, module scope; the branch files from the same reading),
`growth_form_save`'s question list (`buildFormSchemaFromQuestions`), and `agreement_send`'s workspace and
id (`agreementSendPrecheck`, new, exported from `_shared/agreements/chat-write.ts`; `sendAgreement` now
calls it). **This list is not complete and is not meant to be.** Input validation is not re-asked in
general; a handler input check that is not on it gives START then `error`.

The branches keep their own checks unchanged. Any throw inside `announceStart` means no START.

**Handler input refusals: START then `error`, by design.** A call that passed every policy gate reaches
its handler, so it is announced. When the handler then refuses its input, the row closes `error`. That is
truthful: the action was attempted, and the row never says it succeeded. The verifier's examples, all of
which behave this way:
- `agreement_draft` — `empty_title`, `bad_contact_id`;
- `agreement_status` — `bad_contact_id`;
- `agreement_list` — `unknown_status`;
- `booking_preset_create` — `CALENDAR_PRESET_ARGUMENTS_INVALID`;
- `campaign_brief_create` — `CAMPAIGN_BRIEF_ARGUMENTS_INVALID`;
- `calendar_link_prepare`, `calendar_link_social_copy` — `CALENDAR_ID_INVALID`;
- `mission_revise` — `MISSION_ID_REQUIRED`.

These are not added to `announceStart` one by one. Doing so would never be complete, and the contract
does not ask for it.

**Far-end refusals stay announced.** Some refusals can only be made by the far end after the request
has gone out: the agreement-send owner check, `CAMPAIGN_BRIEF_FORBIDDEN`, the booking-calendar RPCs'
role checks, a backend's forbidden-workspace refusal, and `ACTIVE_ACCOUNT_CHANGED` from the mission,
campaign-brief, booking-preset, calendar-link and agreement helpers, which read the workspace again
inside the handler (a switch landing in that window shows `running` → `error`; only the CRM binding is
read once and shared with the START). These show `running` → `error`, or `running` →
`withdrawn` when the refusal reads as policy (`describeStep` drops `forbidden` / `permission` / `not
allowed` errors). Decision: they stay announced, because the request really was dispatched. They never
show `done`.

**The FINISH** (`createToolStepHooks`, from a `try/finally` around each call's dispatch).
- It closes the same id with the same `seq` as its START. A FINISH with no START takes a fresh `seq`.
- `done` or `error` from one reading of the tool's result, `toolResultReportsFailure`: a result has
  failed if it carries `success: false`, or `ok: false`, or a non-empty `error` string with no
  `success: true` / `ok: true`. `describeStep`'s own `failed` uses the same helper, so the wording, the
  status on the wire and the persisted `turn_trace` row always agree. `detail` allowed as before.
- `withdrawn` when `describeStep` returns null for the result and a START is open: the row is removed.
  With no START, nothing is sent (as before).
- A call that throws before it has a result closes `error` with its START label. A call that never
  started and throws sends nothing.
- Only `done` / `error` reach `stepTrace`, so only they can persist in `bundle_ref.turn_trace`.
- Ids are `pass:round:index:tcid`. `round` restarts on each continuation pass and a provider may omit
  `call.id`, so the id carries the call's index and the pass (`continuationsUsed`). The index part is
  tested. **The pass part is defensive and unproven.** A continuation pass can start only if no tool ran
  in any earlier pass: a continuation needs `!signalTerminal`, which requires `totalToolCalls === 0`;
  every executed call adds at least 1 to `totalToolCalls`; the one exit that skips that addition (the
  scope-invalidated break) sets `forcedTermination`, which also blocks a continuation; and a step frame
  is sent only for a call already in `executed`. So ids from two passes cannot collide today, and no test
  can show the pass part is needed without faking the loop. Replacing it with `0` passes every case.
- The approval rewrite, the confirm/research/CRM traces, the audit row and the rail stay at round end;
  the rail reuses the FINISH's `describeStep` answer.

**Declared behaviour changes.**
1. **A mid-batch workspace change now shows the finished steps of the tools that ran.** Before, the
   abort skipped the round-end emission, so no step showed at all. The tool that ran did run; its row is
   now true. knowledge-scope 16.4 asserts exactly `["tool-1"]`; client-memory-authz 36.26.
2. **Steps arrive per call**, as each tool finishes, instead of all at once at round end.
3. **A thrown call that had started persists an `error` row** in `turn_trace`. Before, the throw escaped
   the round and no row was written.
4. **A result that reports failure as `ok: false` or as a bare `error` is now `error`, not `done`.**
   Before, only `success: false` counted, so a refused calendar-link read closed `done` as "Prepared a
   booking link to share". Every `describeStep` label that branches on `failed` now also sees those two
   shapes. `calendar_link_prepare` and `calendar_link_social_copy` gained failure labels ("Couldn't
   prepare that booking link" · "nothing shared"; "Couldn't prepare that social post copy" · "nothing
   posted"). The rail and the audit row are unchanged, and **they do not use this helper**: the rail
   records only `success === true`, and the audit row (`auditWriteForTool`) still reads only
   `success: false` (or n8n `ok`). So the step and the audit can disagree on a bare-`error` result: a
   refused `update_client_data` (`paige-write-back` returns `{ error }`) now shows its step as `error`
   while `paige_audit_log` still records `succeeded`. That audit reading predates C2b and is filed as a
   follow-up; changing it is a behaviour change to the audit log and is not made here. Side effect of
   the wider `failed`: `describeStep`'s policy drop (`not enabled|disabled|permission|not allowed|
   restricted|forbidden`) now also applies to `ok: false` and bare-`error` results, so such a result is
   `withdrawn` instead of `done`. No live refusal text was found that triggers it (the `paige-web-search`
   and `paige-write-back` messages do not match).
5. **Arguments that do not parse are no longer announced.** Before this fix they were read as `{}` and
   the call was shown `running`. Where the branch parses strictly (tested: `web_search`,
   `crm_search_contacts`, 36.23h) they still close `error`. Some branches swallow a parse error and carry
   on with `{}` (`contact_event_status`, `marketplace_browse`, the mission argument check); those calls
   now run with no START and close with whatever status their result reports.
6. **Cost: no extra network read in the normal case.** The START's two remote checks are the branch's
   own reads, memoized per call (the CRM workspace binding and the internal-text draft read), and the
   role answer is the per-call cache. Everything else the START asks is pure. A memo miss (arguments
   that do not serialise) asks the draft question once more.

**Existing exposure, widened on two paths.** `web_search` and `deep_research` FINISH details carry the first 80
characters of the model's own query, and `emitStep` is never held for a protected turn's final check, so
that text can reach the wire before the check. This predates C2b, and a START never carries a detail.
But two paths now send FINISH frames that were never sent before: a mid-batch workspace-scope abort, and
a call that throws mid-round (declared changes 1 and 3). On those paths the details of tools that had
already run (the search query, an agreement title, a phone number) can now reach the wire, where before
the round-end emission was skipped. Same class of exposure, same authenticated viewer; the filed
follow-up covers these two paths as well.

**Evidence** (classes kept apart).
- Automated harness, against in-memory doubles (not an authenticated runtime): client-memory-authz
  578/0 (base 559/0) — 36.21–36.26 (start A, finish A, start B, finish B; distinct rows without provider
  ids; every gate-refused shape never `running`; 36.23b–g the in-chain checks, including a workspace
  switch at every read point and a fresh read per call; withdrawn absent from `turn_trace`; a throw
  closes `error`; the mid-batch change); 36.23h (truncated JSON arguments to `web_search` and
  `crm_search_contacts` are never `running` and still close `error` on the wire and in the trace) and its
  control (empty and whitespace arguments are announced and closed on the same row); 36.27 (both
  calendar-link reads with calendar id `the-intro-call` are refused `CALENDAR_ID_INVALID` and close
  `error`, never `done`, with no label claiming success — observed `running` "Preparing a booking link to
  share", then `error` "Couldn't prepare that booking link"); 36.27b (`web_search` closes `running` →
  `error` "Couldn't search the web" for both a `success: false` result and a bare-`error` result, the
  shape paige-web-search returns on a provider error); 36.8d (the lifecycle audit is not vacuous), 36.8e
  (each broken lifecycle shape flagged). knowledge-scope 420/0 — 16.4 and 22.2b (a running or withdrawn
  step classifies neutral). The step-lifecycle rules live in the shared stream auditor
  (`scripts/lib/audit-turn-frames.mjs` `auditStepLifecycle`) and run over every driven turn.
- Unit: `src/__tests__/paige-step-start.test.ts` 9/9 (parity, tense, no detail, never-announced tools).
- Static: `ci:tsc` 10, at baseline; Deno check on the chat function, the same 11 errors and codes as base
  (TS2339×1, TS2345×8, TS2740×1, TS2769×1).
- Mutation runs: removing each re-ask, sending START before the gates, never sending it, a fresh FINISH
  `seq`, no withdrawal, no close on throw, ids without pass and index (the index is what that case
  catches), a START with detail, keeping the
  round-end emission, two binding reads, a memo shared across calls — each fails its case. Added with
  the two fixes: unparseable arguments read as `{}` (36.23h fails); whitespace arguments treated as
  unparseable (36.23h control fails); the FINISH status reading only `success !== false`, and
  `describeStep` reading only `success === false` (36.27 and 36.27b fail); the helper ignoring `ok: false`
  (36.27 fails) or a bare `error` (36.27b fails); either calendar-link failure label removed (36.27
  fails). Two mutants survive, as expected: the role re-ask sits behind the early role gate, which refuses
  the same calls first, so it is defense in depth; and the step id's pass part replaced with `0` changes
  nothing, for the reason given above.
- The social tools are never announced: they are in `STEP_NO_START`, so `describeStepStart` refuses them
  on the line before any other check. A separate `UNAVAILABLE_SOCIAL_TOOLS` line in `announceStart` was
  unreachable and is removed (putting it back changes no result); the set is still used at dispatch.
- The Studio step-lifecycle harness (`drive-step-lifecycle.mjs`) now listens for console errors on its
  `matrix()` pages as well as `run()`. Syntax-checked only; not driven for this change.
- C2a evidence wording: the running glyph is described as "light lavender (measured rgb(185,168,255))",
  not "violet". No field, PASS value or path changed.
- UNVERIFIED: an authenticated drive on the live platform.
