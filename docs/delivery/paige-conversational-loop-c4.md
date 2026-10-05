# PAIGE conversational loop — C4: one resume for a paused objective

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

This file is the C4 record: the pre-edit packet summary, then each slice as built. C4a (this change)
is the approval kind for general-gate, thread-scoped proposals.

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

## 3. Owner exit gates (owner numbering) — what C4a discharges

| # | Gate | C4a |
|---|---|---|
| 1 | approval resume | **Approval part: discharged** for general-gate thread-scoped rows (39.1–39.1e) on the Solo chat, the PAIGE drawer and Studio. Doors: C4b. **Operator: open** (no thread is sent; 39.19). |
| 2 | ask-user resume | C4c |
| 3 | durable-work resume | C4d |
| 4 | same-objective identity preserved | **Discharged for approval**: same thread, `from_turn_id` (39.8), same request carries the act and PAIGE's continuation (39.1c) |
| 5 | exact wire / persist / reload convergence | **Discharged for approval**: 39.8b (record = wire frame), vitest "wire = persist = reload" |
| 6 | no synthetic approval bubble required for canonical history | **Discharged**: the stored act runs whether or not the model speaks; the decision sentence remains as the person's turn, hidden in presentation (C3) |
| 7 | no duplicate act | **Discharged for approval**: 39.2, 39.2b, 39.3, 39.3c, 39.10, 39.13 (drifted re-emit on `auto`), 39.14 (re-authored same subject), 39.16, 18.7h, 18.H12, 18.H15 |
| 8 | workspace-switch isolation | **Approval path discharged**: 39.4 (another user/tenant/thread/client), 39.7 (A→B→A: 409 in B, runs once back in A) |
| 9 | truthful failure / expired / refused states | **Approval outcomes discharged**: 39.3b/3d (used elsewhere), 39.9 / 39.9b / 39.9c (expired, swept, expired mid-flight), 39.11 (lane off), 39.17 / 39.20b (no longer offered), 39.18 (role lost), check-unavailable path; PAIGE is told no outcome on a turn that was not resumed (39.12b) |
| 10 | Deep Research on the same resume substrate | C4d (the shared `paige_resume` / `resumed` contract is in place; `RESUME_KINDS` already names `work`) |

Exactly-once proofs required by the owner: double approval click (39.3), refresh / reopen (39.3c — the
same token sent again runs nothing), stale cross-workspace (39.4, 39.7), A→B→A (39.7–39.7c), readback
not optimism (39.1b: the outcome comes from the act's own result; `classifySpentApproval` never reads a
result that only fails to mention an error as success).

## 4. Database decision (C4a)

No migration. The approval kind needs no new storage: the stored proposal row is the authoritative act,
the CAS on `consumed_at` serialises execution, and what became of each approval is recorded on the turn
that carried it (`bundle_ref.paige_resume`). The two candidates the plan names for later slices — the
partial unique index on `paige_chat_turns` for answer resumes (C4c-1) and the failure-terminal writer
for durable work (C4d) — are not needed by C4a.

## 5. Push decision

Pull-on-re-entry, per the owner order: a resume always happens inside an authenticated, JWT-bearing
request of the person whose objective it is. Nothing runs a conversational model server-side without a
user request. C4a needs no push at all — the approval POST is the resume.

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

## 7. Not verified

- An authenticated drive of the deployed chat (a real approval on a Solo test workspace): PROOF OWED.
  The Solo QA tenant and `LIVE_DRIVE_*` credentials are still an owner decision (plan §9.2).
- The real model's wording after a resume (it reads the result and continues); the harness model is a
  stub.
- Studio takes the same server path (harness 39.20) but its client does not render the resumed frame
  (C3b); not driven in a browser. Operator does not take it at all (no thread is sent) — open work.
- The real model's adherence to the neutral rule 1 and the turn-local note (harness model is a stub).
