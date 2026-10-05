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

This file is the C4 record: the pre-edit packet summary, then each slice as built. C4a is the approval
kind for general-gate, thread-scoped proposals (§2). C4b extends the same resume seam to door-scoped
proposals — crm-command, the Sales doors, growth-publish-command (§2b).

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

## 3. Owner exit gates (owner numbering) — what C4a and C4b discharge

| # | Gate | C4a |
|---|---|---|
| 1 | approval resume | **Approval part: discharged at harness level** for general-gate thread-scoped rows (39.1–39.1e) on the Solo chat, the PAIGE drawer and Studio, and (C4b) for door proposals — crm-command run as the REAL handler for every non-preview CRM action (40.1–40.1d, 40.13), the Sales and publish doors MODELLED, not run (40.9, 40.9d) — including Operator inside a workspace (40.11b). **Authenticated acceptance on the deployed platform: owed** (§7). **Open:** CRM preview-bound door proposals (merge, hard delete, bulk update, task/deal delete) keep their existing path; general-gate approvals on Operator (no thread is sent; 39.19). |
| 2 | ask-user resume | C4c |
| 3 | durable-work resume | C4d |
| 4 | same-objective identity preserved | **Discharged for approval**: same thread, `from_turn_id` (39.8), same request carries the act and PAIGE's continuation (39.1c) |
| 5 | exact wire / persist / reload convergence | **Discharged for approval**: 39.8b (record = wire frame), vitest "wire = persist = reload" |
| 6 | no synthetic approval bubble required for canonical history | **Discharged**: the stored act runs whether or not the model speaks; the decision sentence remains as the person's turn, hidden in presentation (C3) |
| 7 | no duplicate act | **Discharged for approval**: 39.2, 39.2b, 39.3, 39.3c, 39.10, 39.13 (drifted re-emit on `auto`), 39.14 (re-authored same subject), 39.16, 18.7h, 18.H12, 18.H15; doors (real crm-command): 40.2a/2b (card lane + server, either order), 40.2c (double POST), 40.5 (re-emit, same and drifted on `auto`), 40.7d (sent again), 40.9b/9e |
| 8 | workspace-switch isolation | **Approval path discharged**: 39.4 (another user/tenant/thread/client), 39.7 (A→B→A: 409 in B, runs once back in A); doors: 40.3 (another workspace / person / a non-door row), 40.7–40.7d (A→B→A with and without a thread), 40.10c (a door-tool row the server never issued), 40.12 (a door token posted in another thread) |
| 9 | truthful failure / expired / refused states | **Approval outcomes discharged**: 39.3b/3d (used elsewhere), 39.9 / 39.9b / 39.9c (expired, swept, expired mid-flight), 39.11 (lane off), 39.17 / 39.20b (no longer offered), 39.18 (role lost), check-unavailable path; PAIGE is told no outcome on a turn that was not resumed (39.12b); doors: 40.4 (expired), 40.4c (used, nothing committed), 40.4d (expired between selection and the door's claim), 40.4e / 40.4f (re-sent after either: nothing runs — the door's re-proposal was retired), 40.5c (a model re-emit after an approval that could not be used), 40.6 (not offered), 40.9c (publish claimed elsewhere), 40.9g (publish declined, then a stale Approve), 40.9h (Sales declined, then a stale Approve) |
| 10 | Deep Research on the same resume substrate | C4d (the shared `paige_resume` / `resumed` contract is in place; `RESUME_KINDS` already names `work`) |

Exactly-once proofs required by the owner: double approval click (39.3), refresh / reopen (39.3c — the
same token sent again runs nothing), stale cross-workspace (39.4, 39.7), A→B→A (39.7–39.7c), readback
not optimism (39.1b: the outcome comes from the act's own result; `classifySpentApproval` never reads a
result that only fails to mention an error as success).

## 4. Database decision (C4a, C4b)

No migration. The approval kind needs no new storage: the stored proposal row is the authoritative act,
the CAS on `consumed_at` serialises execution, and what became of each approval is recorded on the turn
that carried it (`bundle_ref.paige_resume`). The two candidates the plan names for later slices — the
partial unique index on `paige_chat_turns` for answer resumes (C4c-1) and the failure-terminal writer
for durable work (C4d) — are not needed by C4a.

C4b: no migration either. The door's own proposal row stays the authoritative act and the door's claim
stays the only claim; exactly-once across retries rests on the doors' existing idempotency (crm-command's
committed result keyed by the stored idempotency key, the Sales doors' committed operation), which C4b
reaches by always sending the stored key/operation.

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
   subject). Production impact was not measured here (no prod access in this slice) — it should be
   checked in the deploy's post-deploy scan.

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
