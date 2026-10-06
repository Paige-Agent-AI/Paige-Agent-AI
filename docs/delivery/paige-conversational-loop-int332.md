# PAIGE Conversational Loop — INT-332: an accepted offer is the task, and a card is never narrated into being

Lane: Conversational Loop (P1 hotfix, bounded priority over C4d/C4e). Shell: SOLO. Owner of record: the
coordinator's INT-332 order (2026-10-06). Sibling records: [C1 — the turn contract](paige-conversational-loop-c1.md)
(the continuation loop this extends) · [C4 — interrupt/wait/resume](paige-conversational-loop-c4.md).

## 1. The production strand (grounded, artifacts)

A long Solo thread (`dad0fd37…`), 2026-10-06 UTC:

| time | turn | what the records say |
|---|---|---|
| 15:21:48 | assistant, FINAL / answer / 3 tools / 2 rounds, `claude-sonnet-5` | closes on ONE offer: "Want me to send that approval card now so we actually close this loop, and then move into building his $2,500 invoice for Wednesday?" |
| 15:25:25 | user | "Yes we may as well for sure" |
| 15:25:30 | assistant, **FINAL / fast_answer / 0 tools / 1 round**, `claude-haiku-4-5`, `stop_reason: end_turn` | "Sending the approval card now for the canonical deal-to-contact link…" — and **no `paige_pending_confirmations` row** for the deal or for `crm_assign_deal_contact` |
| 15:26:19 | assistant, FINAL / fast_answer / 0 tools, Haiku | "If approvals are OFF in your workspace, then I can run this link directly without the card" |

Searched and read, not assumed:

- **The tool was offered.** `crm_assign_deal_contact` is pushed into every main-chat turn's `toolDefs` unconditionally
  (`CRM_COMMAND_TOOLS`, `paige-ai-chat/index.ts` ~L7801); the only narrowing is the Studio scope. The repro was the
  owner's main chat, so the action was in her hands. **Routing: this stays in the Conversational Loop** (not Platform
  Reach — the tool was present; not CRM — the door was never called).
- **Why the tool was not called.** Two gates read only the person's literal words. The tier router
  (`substantiveTurnIntent`) does not match "Yes we may as well for sure" (its "yes" form requires a following verb), so the
  turn ran on the cheap tier — the tier #34 already documents as dropping mutating tool calls. C1's `isActionIntent`
  (`ACTION_INTENT_RE`) does not match it either, so the prose round was accepted as FINAL. Nothing checked prose that
  *claimed* a card against whether one existed.
- **How often.** Over 30 days, 14 assistant turns said a card was coming/ready; **5 had no proposal row within 2 minutes**
  (2026-09-10, 09-24, 09-30, 10-01 after a bare "Yes", 10-06). The other 9 had a real card.
- **The fold did not hide the offer.** `foldThreadSummary` keeps ≥ 5 verbatim turns (`KEEP_FLOOR`); the 15:25 reply quotes
  the offer's details, so the model had it. Long-thread compaction is not the cause; the cause is tier + acceptance.

## 2. Frame (Flow-by-Flow)

Mode: Bug or Repair. Depth: Deep (R2 — cross-flow conversational contract, approval truth). Paradigm: web (Solo main chat).

Actor-goal flows (F1–F12, from the order):

| | flow | contract |
|---|---|---|
| F1 | explicit single offer → "yes" | the offered step runs: tool → card (or a truthful refusal / one question) |
| F2 | affirmative variants | "sure", "go ahead", "yep 👍", "may as well", "for sure" … read the same |
| F3 | explicit restatement | handled by the ordinary action path (not a bare acceptance) |
| F4 | multiple offers / alternatives | ask which; act on nothing |
| F5 | informational acknowledgement | ordinary path, ordinary tier |
| F6 | stale offer (> 30 min) | ordinary path |
| F7 | workspace switched | refused before PAIGE is reached (existing 409) |
| F8 | another user's thread | offer invisible (RLS); never continued |
| F9 | act no longer possible | truthful refusal stands as the answer |
| F10 | card minted | wire = persisted turn = proposal row (reload reads the saved turn) |
| F11 | approval | executes once, through the C4 door resume |
| F12 | no duplicate | a standing card/question/work is not re-offered; no second live proposal |

## 3. Decisions (grounded)

1. **No new state.** The foreground offer is read from the caller's OWN persisted thread with the session client (RLS):
   the newest three turns (`role, content, created_at, bundle_ref`), skipping the just-appended reply. No table, column,
   flag, store or second conversation state machine. The order forbade one, and none is needed: the thread already
   holds the offer, its state and its time.
2. **An affirmative continues one foreground offer — not "yes = execute".** `readForeground`
   (`_shared/paige-turn/continuity.ts`) accepts only when PAIGE's immediately preceding turn is FINAL (or predates the turn
   contract), younger than `OFFER_FRESH_MS` (30 min), not a standing wait (WAIT_APPROVAL / ASK_USER / WAIT_WORK, a
   `paige_confirm` or a `paige_ask`), closes its last paragraph on exactly ONE offer phrase, and the reply is a plain
   acceptance: short, no question, nothing that declines, defers, hedges or changes it. Two offers or alternatives in the
   offer → ambiguous → PAIGE is told to ask which. The affirmative is a CLASS (yes / sure / ok / go ahead / let's / may as
   well / for sure / 👍 …) bounded by structure, not a patch for one sentence.
3. **What acceptance does — and does not.** It routes the turn to the reasoning tier (`substantiveTurn`), counts it as
   action for C1 (`isActionIntent`), and adds one system note naming the offer as the task. It grants nothing: the call
   still goes through `crm-command` (or the general gate), which alone decides whether the act needs a card. Proven:
   a model-asserted `confirm: true` still mints a card and executes nothing (43.12).
4. **Never narrate a card that does not exist.** `unbackedClaim` flags a reply that says a card is coming, ready, sent,
   waiting, "you'll see", or "once you click Approve…", when no card was created this turn (`queuedApprovals` /
   `confirmTrace`) and none is standing from the previous turn. Offers, futures, conditionals, negations and references to
   a standing card are not claims. A claim is never terminal: C1 feeds a correction back on the reasoning tier, inside the
   SAME continuation budget (`MAX_CONTINUATIONS` = 3). If it still stands, the server authors the answer ("I haven't put an
   approval card in front of you — nothing is waiting for your OK yet…") on the wire and in the transcript, and a spent
   budget records LIMIT_REACHED. The behaviour is fixed, not a sentence banned: the correction tells PAIGE to call the tool.
5. **Approval authority is the platform's.** The same guard flags PAIGE deciding approval herself ("approvals are off",
   "run it directly", "without the card", "skip the approval") — never backed, even beside a real card. Standing rule added
   to CRM OPERATOR MODE: "APPROVAL IS NOT YOURS TO DECIDE … decided by the platform when you call its tool (the act's
   risk, the workspace's Trust settings, the person's role, the workspace)". Server truth is unchanged: `crm-command`
   resolves autonomy lane, role and workspace per call.
6. **INT-333 in this seam: prose only.** A standing rule — "NAME RECORDS, DON'T PRINT THEM … never put raw record ids …
   or internal field names (like `contact_client_id`) in your reply; … or the last four characters, like 'deal …d798'".
   This is model behaviour (a rule), not an enforced transform; it is labelled as such in §6. No identifier used for
   execution, lookup, fingerprints, idempotency, receipts, Rail, audit, database identity or logs is touched.

## 4. Regression impact map

| surface | risk | held by |
|---|---|---|
| C1 continuation | a second trigger in the same loop could double-continue | claim check runs first and sets `claimContinued`; C1's own test is skipped that round (one continuation per exit); 43.13 proves C1 still fires on a non-claim promise |
| C1 exhausted sentence | the claim fallback and the exhausted sentence both replace `finalChunks` | claim fallback runs first and sets `claimAnswered`; the exhausted branch is skipped for that exit (43.10) |
| C4a/b approval resume | a "yes" after a card could mint a second proposal | standing card → `standing_wait`, no note (43.4); door returns its live proposal, no second row |
| C4c ask resume | an answer turn is not an offer acceptance | the foreground read is skipped on `answerBinding`, the note on `answerResume`; group 41 green |
| Studio / Live / document turns | different loops | the read and the guard are skipped (`!studioSessionId`, `!liveRuntimeScope`, `!attachedDocument`) |
| client portal seat | tools deny-by-default | `offerAccepted` false for `callerTier === "client"`; the claim guard still applies (a client seat may not narrate a card either) |
| cost | more reasoning-tier turns | only accepted offers (and claim corrections) — short replies to PAIGE's own offer |

## 5. Evidence (classes kept separate)

**Automated — handler + real door (`test:client-memory-authz`, group 43, 22 checks):** 836 passed / 0 failed on the
candidate. **At base** (clean worktree of `d20b323e9` with the same harness): 822 passed / **13 failed — all 13 in group
43**, every other group green. Controls that must hold on both sides (F5–F9, F11, F12, the `confirm:true` gate) pass at
base, as they should.

| check | proves |
|---|---|
| 43.1a–f | F1 on a LONG thread (40 earlier turns): reasoning tier; note quotes the offer; narration corrected; ONE real-door proposal, ONE card; WAIT_APPROVAL; wire = persisted fingerprint = row; narration never on the wire or saved |
| 43.2 | fresh-thread control |
| 43.3 | F11: approve → the door executes `deal.assign_contact` once; approving again executes nothing |
| 43.4 | F12: a second "yes" with a card standing: no note, one live proposal, no execution |
| 43.5.1–3 | F2 variants |
| 43.6 | F4 alternatives → asked, nothing proposed |
| 43.7a/b | F5 informational ack, F6 stale offer → cheap tier, no note |
| 43.8a/b | F7 other workspace (refused before the model), F8 other user (offer invisible) |
| 43.9 | F9 truthful refusal ends the turn, one call, saved verbatim |
| 43.10 | narration every round → server's truthful sentence on wire + saved, LIMIT_REACHED, nothing proposed |
| 43.11 | E: "approvals are OFF… run it directly" corrected; never reaches the person |
| 43.12 | E: model-asserted `confirm: true` → card minted, nothing executed |
| 43.13 | C1: a promise with no claim ("On it — I'll link it now.") still continues to the tool |

**Mutation (§71.4) — each defect reinstated, full harness run:** drop the tier route → 4 red; claim guard blind → 2 red;
accepted offer not action intent → 1 red (43.13); staleness ignored → 1 red; alternatives read as one → 1 red; fallback
removed → 1 red; note never sent → 5 red. Standing-state check removed → harness green (the saved WAIT_APPROVAL turn also
carries `paige_confirm`, an independent check) and **the unit test F12 red** — caught one layer down.

**Automated — pure (`continuity.test.ts`, Deno, CI step added):** 14 tests over the prod turns verbatim (offer, capability
prose, narration, bypass, "say the word"): F1–F8, F12, claims and non-claims, notes bounded. Deno resume + continuity
43/43 under CI's sandbox flags.

**Static:** `deno check paige-ai-chat/index.ts` — 10 diagnostics, identical codes to base (1 TS2339, 7 TS2345, 1 TS2740,
1 TS2769). All 96 `npm run` steps in `ci.yml` pass except `test:deno-ratchet` (147/2: "a missing check tool FAILS") —
**measured identical at base** in a clean worktree, environmental.

**Authenticated runtime (Solo, prod):** see §7 — recorded after merge and deploy, with controlled data.

**UNVERIFIED:** how often the REAL model, on the reasoning tier with the note, calls the tool on the first round (the
harness scripts the model; the guard and correction are what make a wrong first round safe). The closing call after a
forced termination (budget/no-progress) streams directly and is not passed through the claim guard (§6).

## 6. Parked / not in this change (with evidence)

- **INT-333, card copy → CRM lane.** `crm-command` `summaryFor` writes `Change deal ${deal_id}'s contact to ${client_ref}`
  for `deal.assign_contact` (and the same `target` pattern for `deal.assign_owner`, `deal.move`, `deal.close`,
  `deal.reopen`), so the CARD shows the full deal UUID. `summary` is display-only (fingerprints are
  `confirmFingerprint(capability, args)`), so a label-based summary is safe to change, but it is the CRM door's copy.
- **INT-333, rendered prose → UI/UX lane.** A presentation transform in the chat renderer (UUID-shaped tokens shown as
  "…d798" with the full value available to copy and to screen readers; long/similar names; reflow) is the durable fix.
  This change ships only the prompt rule (model behaviour, not enforcement).
- **Forced-termination closing call** (`chat-close`, tools-free, streamed directly) is not claim-guarded. It runs only
  after tools ran and the loop hit its budget or a no-progress stop.
- **Live voice** turns use the Live decision path and are out of scope here (the read and the guard are skipped).

## 7. Merge, deploy, production

Recorded in the PR and the master doc's delivery log on completion (merge commit, `deploy-edge-functions` run,
`edge-live` drift, and the controlled Solo repro — or `PROOF OWED` with the reason).
