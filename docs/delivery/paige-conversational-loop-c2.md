# PAIGE conversational loop — C2: truthful tool START + FINISH

Owner ruling (2026-10-04, after C1): add truthful tool/action START + FINISH semantics. Keep the
low-level tool lifecycle in the expandable "What PAIGE did" trace; narrate in the conversation only
when it is useful — never turn every tool start into visible prose. Fix the continuation-budget
replay gap before or during C2, so the living-turn UI (C3) does not amplify it: the saved canonical
turn and the visible completed turn must converge.

C2 ships as **two PRs, in order**, so no open tab ever misreads a lifecycle frame:

- **C2a — clients ready + replay fix** (this document's "As built" section). Every client learns the
  step lifecycle before any server sends a START.
- **C2b — the server emits START** for each tool that has passed every gate, and FINISH immediately
  after it, instead of building every step at the end of the round.

## The lifecycle contract

One frame, `paige_step` (no new top-level key: an unknown key is dropped by the typed consumers, so
a START would never close). The same id moves through:

| status | meaning |
|---|---|
| `running` | the tool passed every gate and is executing now |
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

## C2b — plan (grounded, not yet built)

- **START point.** Inside `executeToolCalls`, after every gate, immediately before dispatch, through
  an `announceStart(tc)` guard that re-asks the in-chain policy checks without producing a result (a
  START must never appear for a call a later check refuses — knowledge-scope 31.20 already pins the
  internal-text case). Doors (sales, publish, CRM) decide remotely, so they emit only a FINISH.
- **FINISH.** A per-tool `try/finally` emits FINISH right after the tool returns: `done` / `error`
  from the result, `withdrawn` when the trace would not render it and a START was open, `error` with
  the start label on a throw. The round-end step emission goes away; the approval rewrite, traces,
  audit and rail stay at round end.
- **Labels.** A present-tense start label map (`describeStepStart`), never a past-tense claim, never a
  `detail` on a START (the model's own query must not ride a START on a protected turn).
- **Ids.** Unique per turn: `round` restarts on each continuation pass and a provider may omit
  `call.id`, so ids must carry the pass and the tool index.
- **Tests.** Step-lifecycle rules in the shared stream auditor; startA/finishA/startB/finishB order;
  refused calls never `running`; withdrawn absent from `turn_trace`; a throw closes `error`.
