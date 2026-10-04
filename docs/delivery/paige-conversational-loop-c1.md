# PAIGE Conversational Loop — C1: the turn contract (pre-edit packet)

**Status:** pre-edit packet, 2026-10-04. Builds on C0a (#1697). Read with
`docs/delivery/paige-conversational-loop-r0.md` §22–§24.

C1 gives every PAIGE chat turn a shape the server states and the client can read. It adds one
small server signal, one pure reducer, one record on the assistant turn and one shared client
parser. **Nothing changes on screen.** The visible "living response" is C3, which keeps its
Impeccable + prototype gate.

## Frame (Flow-by-Flow)

- **Mode:** Existing Project. It is a Refactor, because four hand-written client parsers become
  one and behaviour equivalence must be proven. It is also a New Feature, because it adds a turn
  contract.
- **Depth:** Deep (R2). It changes a cross-flow contract (the SSE stream every PAIGE surface reads)
  and persisted state (`bundle_ref`).
- **Prototype gate:** not triggered. There is no visible change, and C3 owns the visible change.

## Affected actor-goal flows

| Flow | Actor and goal | Entry | What C1 changes for them |
|---|---|---|---|
| F1 Ask PAIGE (Solo, Agency, Business) | owner or member gets an answer or an action | `/solo`, `/agency`, `/business` → `PaigeAIChat` | stream gains `paige_turn` frames, which the client drops today; assistant turn gains `turn_state`/`turn_trace`. The parser migration is deferred (see Collisions) |
| F2 Build in Vibe Studio | owner builds pages, forms, funnels | `/solo` → Vibe Studio → `useStudioChat` | parser moves to the shared module; same frames, same state |
| F3 Client portal chat | client asks their coach's PAIGE | `/app` → `PaigeChat` | parser moves to the shared module; the greeting's lost cross-chunk lines are fixed |
| F4 Operator chat | platform operator asks PAIGE | `/operator` → `useOperatorChat` | parser moves to the shared module; same frames |
| F5 Reopen a thread | owner reloads a past conversation | thread rail → `turnsToMessages` | the new `bundle_ref` keys are ignored by every reader (verified) |

## Decisions, grounded

1. **The turn signal is a new top-level frame, `paige_turn`, not a new `paige_step` kind.**
   All four live parsers silently drop an unknown top-level key, with no state change and no
   render (`PaigeAIChat.tsx:1439`, `PaigeChat.tsx:490`, `useOperatorChat.ts:221`,
   `useStudioChat.ts:205`). A new `paige_step` kind would render as an action row, change the step
   and department counts, replace the strip label and the live `workingLabel`, and trip the
   "Newer PAIGE content" scroll cue (`PaigeStepTrace.tsx:84-122`, `PaigeAIChat.tsx:753-768, 2078`).
   A new field on existing steps is invisible, but it cannot signal anything between or without
   steps.
2. **The frame carries closed enums only, never prose.** The client-seat leak reader
   (`client-seat-reply.ts:54`) does not scan unknown keys, so free text inside it would bypass the
   check. The frame is single-line JSON: a malformed line stalls two parsers.
3. **Events:** `started` is the first frame of every stream. There is exactly one terminal
   frame: either `completed` (state FINAL, BLOCKED (as built: LIMIT_REACHED), INTERRUPTED, WITHHELD or REFUSED) or
   `waiting` (state WAIT_APPROVAL, WAIT_WORK or ASK_USER). The terminal frame is emitted before any
   answer bytes, because the provider's own `[DONE]` rides inside the replayed answer.
   - On a protected turn it is emitted at release, after the final gates. That way a turn that is
     then withheld never first claims FINAL.
   - `segment` and `resumed` are reserved in the type for C2 and C4. C1 never emits them.
4. **Mode is observed, not predicted.** It is `fast_answer` when round 0 calls no tool. Otherwise it
   is decided by the tools actually executed: `build` (Studio build tools), `multi_agent`
   (delegation), `research` (research tools), `action` (any mutating tool), `clarify` (choices),
   else `answer`. The classifiers are injected, so a future domain needs no loop change.
5. **Persistence rides `bundle_ref`** on the assistant turn. The RPC stores jsonb verbatim and every
   reader picks named keys (`PaigeAIChat.tsx:795-814`, `studio-data.ts:160-170`).
   - `turn_state` is `{v, state, mode, rounds, tools, waiting_on?}`, enums and counts only. Any
     `waiting_on` work ids use the established `work_ids` name.
   - `turn_trace` holds action steps only: `describeStep` labels, group and status. Thoughts are
     never persisted (durable contract: model reasoning never becomes durable state).
   - Budget: at most 40 trace entries, labels capped at 80 characters. Today's largest `bundle_ref`
     is 762 B; the measured prod p95 is 485 B.
   - The persist gate is unchanged: an empty-text turn with no legacy card still persists nothing.
   - Status names do not collide with the durable-work envelope: turn `state` is a separate field
     from any work status.
6. **One shared client parser:** `src/lib/paige-stream/`, built on `_shared/paige-turn/contract.ts`
   (precedent: `src/components/chat/approvalOutcome.ts` imports `_shared`).
   - It owns line framing. A persistent buffer, `{stream:true}` decoding, CR stripping, comment and
     blank skipping, and a flush of a final unterminated line.
   - It owns frame typing. Consumers keep their own handling.
   - Per-consumer options preserve the measured differences: whether `[DONE]` is terminal, and
     whether a malformed line is skipped or stops the stream.
   - Characterization tests pin each consumer's current behaviour before the swap.

## Collisions (measured, not assumed)

- **#1701 (Deep Research R2b, open, not draft)** rewrites `PaigeAIChat.tsx`'s SSE loop and
  `turnsToMessages`. In `paige-ai-chat/index.ts` it rewrites `assistantTurnMetadata` and the terminal
  emit block. Therefore:
  - C1 does **not** migrate `PaigeAIChat`'s parser. That migration follows #1701's merge as C1b.
  - C1 does **not** edit `assistantTurnMetadata`. The turn record is composed at the persist call
    sites.
- **#1556 (draft)** touches `usePaigeThreads.ts`. C1 does not edit it.
- **Naming:** the continuation loop is already labelled "C1" in code (`index.ts` ~14437/14774/14821,
  asserted by `continuation-loop.test.ts`). The new module is named `paige-turn`, never "C1".

## Regression impact map

- **Server:** every stream exit path is touched: agentic success, the waiting states, budget
  exhausted, workspace changed (two sites), final-check withheld, client-seat withheld, snag, Live
  interrupted, the document path, and the client-scope refusal stream.
- **Tests that pin the touched code:**
  - `n5-client-prompt-denylist.test.ts` (exact `assistantTurnMetadata` output and the persist call
    string)
  - `crm-command-chat-adoption.test.ts` (metadata slice)
  - `continuation-loop.test.ts`
  - `studio-edge.contract.test.ts`
  - `client-seat-reply.test.ts`
- **Harness classifier:** `scripts/knowledge-scope/stage1-check.mjs` `nonNeutralFrames` defaults
  unknown keys to non-neutral. It gains a closed-shape `paige_turn` rule, with positive and
  negative cases in group 22.
- **Count-sensitive authz harness cases:** 31.20, 30.29 and 18.ID7. They are unaffected because
  `paige_step` emissions do not change.
- **Clients:** F2 Studio, F3 portal and F4 operator get a parser swap under characterization tests.
  F1 is untouched apart from frames it drops. F5 readers are proven to ignore the new keys.

## Failing-first plan

1. Reducer unit tests (states, mode, waiting, budget), plus a mutation check per rule.
2. Contract tests: the frame shape is closed, there is no prose, and it is one line.
3. Server wiring:
   - `started` is first on every stream, including the refusal stream;
   - exactly one terminal frame comes before any answer byte and before `[DONE]`;
   - on a protected turn the terminal frame comes after the final gate;
   - `turn_state`/`turn_trace` are persisted, with no thoughts in the trace.

   These run through `client-memory-authz` and `knowledge-scope` frame assertions.
4. Characterization tests for each client consumer (Operator, PaigeChat send and greeting, Studio)
   against the current parser, then the shared-parser swap with the same tests green. Plus an
   unknown-frame test proving `paige_turn` changes no consumer state.

## Evidence classes owed

Automated, static and structural evidence come with the PR. A production stream sample showing
`paige_turn` frames is a read-only check after deploy. Authenticated owner drive: **UNVERIFIED** —
the universal proof gate is still owed. No visible change is claimed, so there is no rendered proof.

---

## As built (2026-10-04)

The pre-edit packet above is kept as written. This section records what shipped, where the build
departed from the packet, and the decisions from the review round (§39 verifier and §5 compliance
officer). The compliance officer returned FIX_FIRST with three MAJOR and five MINOR findings. The
verifier returned SHIP with four MINOR findings. All of them are folded in below.

### What shipped

- **Contract** — `supabase/functions/_shared/paige-turn/contract.ts`. This is the one home for the
  frame, the record, the trace bound and the defensive readers (`isTurnFrame`, `readTurnRecord`).
  The edge function, the reducer, the client decoder, both harnesses and the tests all import it.
- **Reducer** — `supabase/functions/_shared/paige-turn/reducer.ts`. It records rounds, the tools
  that actually ran, issued cards, accepted durable work and how the turn ended. It never changes
  how the loop runs. The edge function injects the classifiers.
- **Server wiring** — `supabase/functions/paige-ai-chat/index.ts`. There are three streams: the
  client-scope refusal stream, the agentic stream and the document stream. Each one sends `started`
  first and then exactly one terminal frame. The record is attached at the persist call sites
  (`withTurnRecord` → `attachTurnRecord`). `assistantTurnMetadata` is unchanged.
- **Shared client parser** — `src/lib/paige-stream/` (`framing.ts`, `decode.ts`, and `index.ts`
  with `readPaigeStream`). It is used by `useStudioChat` (`stopAtDone:true, malformed:'skip'`),
  `useOperatorChat` (`stopAtDone:false, malformed:'skip'`), the `PaigeChat` send
  (`stopAtDone:true, malformed:'skip'`) and the `PaigeChat` greeting
  (`stopAtDone:false, malformed:'skip'`). Characterization tests pinned each consumer before the
  swap.
- **Harnesses** — `knowledge-scope` group 29 and `client-memory-authz` group 36. Both audit every
  stream they drive through one shared auditor, `scripts/lib/audit-turn-frames.mjs`, and each
  harness keeps its own counters and assertion ids.

### The provisional-terminal rule (in full)

The terminal frame has to reach the wire before any answer byte, because the provider's own
`[DONE]` rides inside the replayed answer and several consumers stop reading there. That forces
one rule per kind of turn:

1. **Protected turn** (held content, client seat, late retrieval). The answer is held, so the
   terminal waits for the release point, after the final scope check and the client-seat read.
   Whatever those gates decide is what the terminal says. A turn withheld there sends `WITHHELD`
   and never first sends `FINAL`. On a protected turn the wire terminal is final.
2. **Ordinary turn whose answer streams from the closing call** (Live, or a text turn closing out
   after a budget). The terminal is sent **lazily**, inside `capLine`, immediately before the first
   line that carries answer TEXT (a non-empty `delta.content`). Not the first line forwarded:
   `_shared/claude.ts`'s translator sends a synthetic role-only line first on every stream, and
   ends a stream that broke with the same clean `[DONE]` as one that finished — so "the first line
   forwarded" put `FINAL` on the wire with no answer behind it (fix round 2, finding A). Lines
   before the first text are **held, not dropped**, and go out right after the terminal in their
   original order (Live holds lines; the text path holds the raw chunks it forwards, so its bytes
   are unchanged, only later). Forwarding them first would put a `choices` frame ahead of the
   terminal; dropping them would change the bytes an answering stream sends; if no text ever comes
   they carried nothing. So a closing call that fails, has no body, or breaks before any text ends
   `INTERRUPTED` on the wire, never first `FINAL`.
   An ordinary **non-Live** turn whose answer is a **replayed round** already has it in hand, so its
   terminal goes out before the replay — `INTERRUPTED` when the provider never finished that round
   (no `finish_reason`, see below), or when there is no answer at all and the "couldn't finish"
   fallback is sent.
   **An empty answer is not a FINAL one (fix round 3).** A replayed round the provider finished
   cleanly with no text, on a turn whose tools never ran, ends `INTERRUPTED` instead of `FINAL`
   (`interruptEmptyFinal`; waiting, limit and worked turns keep their state). The document path does
   the same for an empty reply — a tool-call-only reply finishes (`tool_calls`) with no text there,
   because that path executes no tool.
3. **Ordinary streamed turn that fails after answer bytes went out** (`live_answer_failed`,
   `live_answer_incomplete`, or a snag after streaming began). What was said cannot be unsaid. On
   an ordinary streamed turn the wire terminal is **PROVISIONAL**:
   - a following `paige_live_error` frame, or the snag sentence, supersedes it;
   - the exactly-once guard keeps the wire to one terminal, so the catch adds nothing new to the
     wire, but the record still moves to `INTERRUPTED`;
   - **the persisted `bundle_ref.turn_state` is AUTHORITATIVE.** Where the wire and the record
     disagree, the record is right.

   This rule is written into the doc comment on the terminal events in `contract.ts`. **C3 must
   honour it:** a later error frame on the same turn overrides a `completed`/`FINAL`, and a
   reopened thread reads `turn_state`, never a replayed frame.

Proof:
- **n5** (`src/__tests__/n5-client-prompt-denylist.test.ts`). The always-enqueue fake is gone. The
  test now reads the production `emitTurnTerminal` (with its exactly-once guard) and
  `emitTurnTerminalBeforeAnswer` out of `index.ts`, and closes them over a real reducer. Across 8
  interrupted-Live endings × protected/ordinary, it asserts exactly one `paige_turn` on the wire,
  before `paige_live_error`:
  - An ordinary turn whose first answer TEXT already went out shows `FINAL` and never
    `INTERRUPTED`. The catch adds nothing to the wire.
  - Every other case (protected, non-ok, bodyless, and a stream whose only lines carried no text)
    shows `INTERRUPTED`.
  - The record is `INTERRUPTED` in every case.

  Every fake stream starts with the translator's role-only line, as the real one does, and the
  "streams only the final answer" case asserts that nothing at all goes out for it (fix round 2).
- **client-memory-authz (Live group).** 26.5 is the control: an ordinary Live answer says `FINAL`
  once, just ahead of its first answer line. 26.6 makes the ordinary Live closing call fail; the
  wire terminal is `INTERRUPTED`, never `FINAL`, before the Live error frame. 26.7 runs the same
  failure on a protected turn. 26.8 makes the ordinary Live closing call answer 200 and then break
  before any text: `INTERRUPTED`, no `FINAL`, before the Live error frame (it failed with `FINAL`
  first before fix round 2's finding A was fixed).

### Departures from the packet, and the judgement calls

- **`BLOCKED` is renamed `LIMIT_REACHED`** everywhere: the contract, the reducer, tests, harnesses
  and the client decoder and its tests (the decoder reads states through the contract's
  `isTurnFrame`, so it took the rename with no code of its own). The reducer method keeps the name
  `budgetStop()`. Packet
  decision 3 and the first contract comment said the states did not collide with the durable-work
  status words. That was not true for `BLOCKED`, which shares a word with durable work's `blocked`
  but has a different meaning (a budget stop, versus a document job's authority or version
  conflict). The turn states are now distinct from the durable-work words by name, and also by case
  (upper-case turn states, lower-case work statuses).
- **Refused tool calls are not executed.** `executeToolCalls` adds every dispatched call to
  `executed` before the Studio-scope, client-seat and autonomy-off gates. `observeToolResult` sets
  `ran: false` for five result shapes (fix round 2 added the last two), and `toolsExecuted` skips
  them for both the `tools` count and the mode. The existing per-call trails do NOT all agree on
  these, so each is matched to the trail it actually matches (corrected in fix round 2 — an earlier
  version of this line said all three "mirror `describeStep`", which was false for
  `outside_studio_scope`):
  - `disabled === true` — `describeStep` drops it, the write trail skips it, approval-outcome says
    `not_run`;
  - `error === "internal_text_in_draft"` — `describeStep` drops it, the write trail skips it,
    approval-outcome says `not_run`;
  - `refused_before_run === true` (`_shared/confirm-fingerprint.ts`) — the write trail skips it and
    approval-outcome says `not_run`; `describeStep` does not drop it (it renders a step);
  - `forbidden_seat === true` — `describeStep` drops it; the write trail does not read the flag;
  - `success === false` with `error === "outside_studio_scope"` — no existing trail drops it
    (`describeStep` renders a step for it, the write trail records a failed write). It is not-run on
    the dispatch code's own evidence: the boundary `continue`s before every door.

  **Not on the list: the approval-resolution refusal** (`{success:false, outcome:"refused", …}`,
  `index.ts` in the CRM door). It does `continue` before `crm-command` is invoked, so nothing was
  dispatched, and approval-outcome reports its card `not_run` (through `approvalRefusals`, not the
  result shape). But `outcome:"refused"` is also what executors that DID run return (`crm-command`,
  the calendar send), so the shape cannot tell them apart, and `describeStep` and the write trail
  both count it as an attempted call. It stays counted until it declares `refused_before_run`
  like the other pre-run refusals (#1460). Reducer tests cover each shape, the near misses, and the
  two `outcome:"refused"` shapes that stay counted. Harness 36.15 shows a client-seat refusal
  counted in neither the record's `tools` nor its mode.
- **`ExecutedTool.ok` is gone.** It was computed and never read. The not-run flag `ran` replaces
  it, and the `ok` tests went with it.
- **Non-Live failure paths are no longer `FINAL`.** Two paths now call
  `turnTracker.interrupted()`:
  - the "I gathered what I could but couldn't finish" fallback, when `!finalChunks` and the
    closing response is not ok-with-a-body;
  - a mid-loop provider exit with `!currentResponse.ok`.

  The no-progress repeated-signature stop (`seenSignatures`) calls `budgetStop()` and records
  `LIMIT_REACHED`. Harness coverage, `client-memory-authz` group 36: 36.12 is the fallback
  (`INTERRUPTED` on the wire ahead of the sentence, and in the record), 36.13 is the mid-loop
  failure, and 36.14 is the repeated call (`LIMIT_REACHED`; the repeat never ran).
- **A provider stream that breaks is not `FINAL`** (fix round 2, finding B). Every streamed model
  call the chat makes — the loop rounds, the continuation, the closing call and the document reply
  — goes through `gatewayCompat` → `_shared/claude.ts`'s `streamAnthropicAsOpenAI`. There is no
  OpenAI, Groq, Featherless or Gemini passthrough on the chat's streaming path: the
  `google/gemini-*` model strings are legacy tier names that `buildClaudeRequest` maps to Claude,
  and `_shared/model-router.ts`'s Featherless route is non-streaming and not imported by the chat.
  That translator sends `finish_reason` on the provider's own `message_stop` (`stop` or
  `tool_calls`) and on no other path, and it ends a stream that broke with the same clean `[DONE]`.
  So the reliable full version was built, not the conservative one:
  - `consumeRound` returns one more flag, `finished` (a `finish_reason` arrived); its other fields
    are unchanged. The loop keeps the last round's flag; a replayed round the provider never
    finished makes the turn `INTERRUPTED` before its terminal and its record.
  - The closing stream (text and Live) tracks `closingFinished` in `capLine`. A text answer without
    it is `INTERRUPTED` in the record (and on the wire too when it broke before any text, since the
    terminal waits for the first text). A **Live** answer without it is still spoken and still
    ends with the Live `done` frame — whether Live should fail it instead is a Live decision, not
    made here — but its record says `INTERRUPTED`.
  - The document stream tracks `docAnswerFinished`. A document answer without it is `INTERRUPTED`
    on the wire (every document turn is held, so its terminal goes out at release) and in the
    persisted record. The half-answer is still released and saved, as before.
- **Research mode** = the three research tools by name (`web_search`, `deep_research`,
  `web_fetch`), plus any tool whose Spine row (or, while it is unregistered, its legacy
  classification) puts it in a `research`/`research_*` domain with effect read. That also sweeps in
  `document_pending_reviews` and `document_resume_review` (`research_knowledge`, read). A
  research-family write (`document_generate`, `save_to_knowledge_base`) counts as an action.
  The classifier now sits below the import block, as `RESEARCH_CHAT_TOOLS`, a set computed once at
  module load (the first Spine row naming a chat tool decides). `isResearchCapability` is a lookup
  in that set. `deep_research` and
  `web_search` also have `describeStep` rows from #1701; this slice did not change them.
- **WAIT_APPROVAL** covers both kinds of approval card: `needs_confirm && confirm_summary` (the
  exact `paige_confirm` condition) and `propose_action`'s `{success:true, queued:true}` (the
  queued approval card, the only producer of `queued:true`). Waiting is derived from what was
  issued, not from how the loop exited.
- **Document turns are mode `fast_answer`.** The document stream offers tools but never executes
  them, so the turn is one round that answers.
- **The document stream's `pull()` is wrapped in try/catch.** On a throw it logs the cause and
  calls `emitDocTurnTerminal(controller, 'interrupted')` inside its own try. It then enqueues
  `[DONE]` and closes the controller, or errors it if that fails. Held frames are dropped, never
  released. The catch only CLOSES THE WIRE: it writes no record. A turn record persisted before
  the throw stands as written (the close-out persists before its last steps), and a throw before
  the close writes no record at all. Before this, a broken document stream ended after `started`
  with no terminal frame. Proven two ways:
  - `knowledge-scope` 29.1: a document stream that throws in its close-out (after the release)
    still ends with its one terminal and a `[DONE]`;
  - a throw BEFORE the release point cannot be produced through either harness: every awaited call
    in the close-out catches its own failure (scope revalidation, persistence, extraction,
    analytics), and the provider stream it reads never errors (the translator catches a reset and
    ends with `[DONE]`). So n5 reads the production catch block and the production
    `emitDocTurnTerminal` out of `index.ts` and runs them over a real reducer: a throw before the
    terminal puts `INTERRUPTED` then `[DONE]` on the wire; a throw after it adds no second terminal
    and moves the tracker to `INTERRUPTED`; a closed stream is errored, not left hanging.
- **The unprotected document branch is unreachable today.** `turnCarriesProtectedContentAtEntry`
  includes `attachedDocument`, so `holdProtectedContent` is always true on the document stream.
  The `!holdProtectedContent` branch is kept defensively, in case that latch ever changes, and the
  code comment says it is unreachable.
- **Third client behaviour change.** Besides the two sanctioned portal fixes (the greeting no
  longer loses a line or character cut across chunks; the send no longer stalls at a non-JSON line
  and drops the rest of the reply), every migrated consumer now flushes a final unterminated SSE
  line. Packet decision 6 required this. It changes nothing on real streams, because every server
  and provider line ends in `\n\n`.
- **Other deviations, on inputs the server never sends:** a non-string `delta.content` decodes as
  unknown; Studio's `data: null` is ignored instead of throwing; a frame carrying several
  top-level keys is decoded by one precedence order that keeps each consumer's own branch order.
- **Packet correction.** `src/components/chat/approvalOutcome.ts` mentions `_shared` only in a
  comment. The real precedent for importing `_shared` from `src` is a relative, extension-less
  import (for example `src/solo/sales/collections/importModel.ts`), and `decode.ts` follows it.
- **Shared harness auditor.** The two near-identical stream auditors (`started` first, one
  terminal, terminal before the first answer byte and `[DONE]`, the withheld and interrupted rules)
  are now one module that both harnesses import.

### Naming rule

The module, the comments, the harness group labels and the client fix markers say **"paige-turn"**,
never "C1". The continuation loop already owns the "C1" label in `paige-ai-chat/index.ts` ("C1: THE
BOUNDED CONTINUATION LOOP", "C1 — the while wrapper", "C1: THE POST-LOOP CONTINUATION CHECK", "end
the C1 while wrapper"), and `continuation-loop.test.ts` asserts those markers. They are left
untouched. Where the reserved events are concerned, the contract says "reserved for a later slice",
not "never emitted in C1". (This packet's filename and the program step name keep "C1" because
they name the program step, not code.)

### C1b — what the `PaigeAIChat` migration must reconcile

C1b is now unblocked, because #1701 has merged.

- `PaigeAIChat` moves to `readPaigeStream`. Characterization tests come first, as they did for the
  other consumers.
- **Malformed lines.** The shared parser's `malformed:'stop'` option was built for C1b and no
  consumer uses it yet. It yields one `malformed` frame and ends the read. `PaigeAIChat` today
  pushes the partial line back into its buffer and keeps reading until the body ends. C1b must
  pick one behaviour on purpose and prove it, not adopt `'stop'` by default.
- `turnsToMessages` may start reading `bundle_ref.turn_state` / `turn_trace` through
  `readTurnRecord`. Under the provisional-terminal rule, the persisted record outranks any replayed
  wire frame.

### Evidence (classes kept separate)

- **Automated:**
  - reducer unit tests: each state, the precedence, mode, waiting, the trace bound, and refused
    tools not counted;
  - contract tests: closed shape, one line, no prose;
  - the parser module tests and the three consumer characterization suites;
  - n5, driving the production terminal seam and the document stream's catch.
- **Harness:** `knowledge-scope` group 29 and `client-memory-authz` group 36 both run on the real
  handler. They audit every stream they drive through the shared
  `scripts/lib/audit-turn-frames.mjs`, and they cover:
  - `started` first, then one terminal before any answer byte and before `[DONE]`;
  - protected release ordering;
  - the `WITHHELD`, `REFUSED`, `INTERRUPTED` and `LIMIT_REACHED` endings;
  - the non-Live fallback (36.12), the mid-loop failure (36.13), the repeated call (36.14) and the
    refused tool (36.15);
  - observed mode end to end: an `action` turn (36.16) and a `research` turn (36.17);
  - provider streams that break after answering 200: before any text (29.2), mid-answer (29.3), a
    document answer mid-answer (29.4), an ordinary text closing call before any text (36.19,
    against the unbroken control 36.18) and mid-answer (36.20), and a Live closing call before any
    text (26.8). 36.18–36.20 also assert the body ends on `[DONE]`, the terminal precedes it, and
    the exact persisted count (1, 0, 1) — the earlier `.every(...)` was vacuous when nothing
    persisted, and removing the text path's final `startAnswer()` survived both harnesses until it
    did (fix round 3);
  - empty answers that FINISHED: a tool-call-only document reply (29.7) and a clean empty agentic
    round with no work (29.8) end `INTERRUPTED` with `[DONE]` last and nothing persisted; 29.9 is the
    control (a text answer stays `FINAL`; a turn whose tools ran keeps `FINAL` over an empty round);
  - a whitespace-only answer is empty on both paths (29.10); a document turn whose close-out delivered
    an `extraction_proposal` card answered through the card and stays `FINAL` with or without reply
    text (29.11 — the empty-document rule first marked it `INTERRUPTED`, caught by the round-3
    verifier); a turn stopped at a limit keeps `LIMIT_REACHED` over an empty closing round (29.12);
  - a document stream that throws after its release (29.1);
  - persisted `turn_state`/`turn_trace`, with no thought in the trace.

  `client-memory-authz` 26.5–26.8 cover the Live terminal: the ordinary answer, the ordinary
  closing-call failure that ends `INTERRUPTED` on the wire, the protected failure, and a closing
  call that breaks before any text.
- **Static:** typecheck ratchet, eslint, `deno check` on the shared modules.
- **Production stream sample showing `paige_turn`: pending** — a read-only check after deploy.
- **Authenticated owner drive: UNVERIFIED** — the universal proof gate is still owed.
- **Rendered:** none claimed, because there is no visible change.
- **Tier matrix:** no change; there is no tier-visible surface. PR: #1710.

### Known gaps (as of fix round 3)

- **A Live answer the provider cut off mid-sentence is still spoken and still gets the Live `done`
  frame.** Its record says `INTERRUPTED` and its wire terminal (`FINAL`, provisional) is not
  superseded on the wire. Failing it instead is a Live behaviour change for the owner to decide.
- **A text closing answer cut off mid-answer** shows its provisional terminal on the wire (on an
  ordinary turn); only the record says `INTERRUPTED`. The same is true of any ordinary streamed
  answer by design (rule 3 above).
- **A Live decision round that breaks** is not judged: the Live answer comes from the closing call,
  which is.
- **The approval-resolution refusal counts as a run tool** (see "Refused tool calls"), until it
  declares `refused_before_run` (#1460).
- **The edge function's `isBuild` and `isDelegation` classifiers are not pinned end to end:** no
  harness drives a Studio build or a delegation turn. The reducer's mode precedence is unit-tested
  with injected classifiers; `action` and `research` are now pinned end to end (36.16–36.17).
- **No assistant row, no record.** When the persist gate writes nothing (empty text and no legacy
  card — 29.2, 29.7, 29.8, 36.19), there is no `bundle_ref.turn_state` at all; the wire terminal is
  then the only signal of how the turn ended. `contract.ts` now says so.
- **`INTERRUPTED` outranks the waiting states in the record.** A narration cut off after a confirm
  card or accepted work records `INTERRUPTED` with no `waiting_on`, while the card is still pending.
  **C3 must render cards from their own frames** (`paige_confirm`, `approval_queued`, the work
  frames), never from `turn_state.waiting_on`.
- **A whitespace-only first delta counts as answer text** for where the lazy terminal goes (n5's
  whitespace-done case pins it). That is within the provisional rule — the terminal is provisional
  once any delta is out — but it is not "the first line a reader would call an answer".
  A whitespace-only ANSWER, by contrast, is empty: the replay and document paths read the trimmed
  text and record `INTERRUPTED` (29.10).
- **The unreachable unprotected document branch** still sends its terminal (`FINAL`) before the
  first forwarded byte, so it cannot see a later break or an empty reply. Unreachable while every
  document turn is held at entry; if that entry latch ever changes, the branch needs the lazy
  terminal shape fix round 2 gave the closing stream (finding A).
- **The closing stream's `interruptEmptyFinal()` call is defensive.** Every way into a text closing
  call has already recorded a limit or an interruption, and Live refuses an empty answer, so its
  state cannot be `FINAL` there today; removing that call survives both harnesses (mutation run,
  fix round 3). It is kept so one rule holds on both ends of the reply.
- **Pre-existing on `main`, out of scope:** when the continuation budget runs out, the blockage
  sentence is emitted but `finalChunks` is not cleared, so the last narration replays after it —
  the wire and the transcript disagree. Tracked as a follow-up; not changed here.
