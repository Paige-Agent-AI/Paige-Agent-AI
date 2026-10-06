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
   `paige_confirm` or a `paige_ask`), closes on exactly ONE offer, and the reply is a plain acceptance.
   - **The offer is read across the message's tail** (the closing paragraph and the one before it). Any of these makes it
     a choice, and PAIGE is told to ask which: a second offer anywhere in the tail; a sentence opening on "Or…",
     "Alternatively…" or "Option B…"; "or / either / instead / I can also" after the offer phrase or after the offer
     sentence; or a generic offer ("Want me to go ahead?") whose paragraph-before lays out alternatives. A plan laid out as a
     list followed by "Want me to start?" stays one offer (a sequence: its first step).
   - **The acceptance is a whitelist parse, not a word test.** The whole reply must read as acceptance phrases (yes / sure /
     ok / go ahead / do it / let's / may as well / for sure / why not / no problem / 👍 …) plus fillers (we, um, I mean,
     PAIGE, now, thanks). Anything left over ("myself", "tomorrow", "got it", "I saw that", "what's the total", "to Dana
     instead") means it is not a bare yes, and the ordinary path reads it. "ok thanks" needs a strong word to count.
3. **What acceptance does — and does not.** It routes the turn to the reasoning tier (`substantiveTurn`), counts it as
   action for C1 (`isActionIntent`), and adds one system note naming the offer as the task. It grants nothing: the call
   still goes through `crm-command` (or the general gate), which alone decides whether the act needs a card. Proven:
   a model-asserted `confirm: true` still mints a card and executes nothing (43.12).
4. **Never narrate a card that does not exist.** `unbackedClaim` reads each clause (sentences split on "—" and ";", so a
   claim beside a question is still read). It flags an APPROVAL card — named as one ("approval card", "Needs your OK",
   "approval request") or a card in a sentence about approving — said to be sending, sent, up, out, live, on its way, "you'll
   see", "here's the card", "Card sent.", "I'll send the approval card now", or "click/hit Approve on the card", when no
   card was created this turn (`queuedApprovals` / `confirmTrace`). It stays quiet on: payment, contact, outcome, report or
   choice cards; explanations of how approvals work; offers, conditionals and futures ("Say the word and I'll put it on a
   card"); negations; and any card from before ("from earlier", "still waiting", "in your Approvals tab", "approved") — and,
   when the previous turn left a card standing, on anything but a NEW one. A claim is never terminal: C1 feeds a correction
   back on the reasoning tier inside the SAME continuation budget (`MAX_CONTINUATIONS` = 3). If it still stands, the server
   answers with `claimFallback`, which claims only what the server knows — "I didn't put a new approval card in front of you
   in this reply" (never "nothing is waiting", which it has not checked) — and adds "Anything I did in this reply is shown
   above" when tools ran, so completed work is never hidden. A spent budget with no card records LIMIT_REACHED; a correction
   that cannot run records INTERRUPTED — except when this turn minted a card, which keeps WAIT_APPROVAL.
4b. **The structural guarantee for the strand (review round 4).** Wording rules will always have gaps — four
   review rounds each found new phrasings. So the strand no longer depends on them: on a turn that accepts PAIGE's
   single offer, a prose QUESTION is not a terminal answer (C1's usual "a question ends the turn" does not apply).
   Such a turn ends only at the tool (and its card), a stated refusal or blockage (C1's refusal half), or a question
   asked with `ask_choices`, which ends the turn ASK_USER. Prose with no tool is continued with "The person accepted
   the step you offered, and it has not been done…". The claim guard remains the second net for every other turn.
5. **Approval authority is the platform's.** The same guard flags PAIGE deciding approval herself — guessing a setting
   ("If approvals are OFF…"), asking whether approvals are on, or offering a way around ("I can run it directly", "want me
   to run it without the card?", "let me skip the approval") — never backed, even beside a real card. It does NOT flag true
   statements of what happened or how it works ("it ran without a card — tasks don't need one", "approval is not needed to
   look up contacts", "I ran it directly since it's set to auto"). The correction tells PAIGE to rewrite without the claim,
   say what she actually did, and never call a tool again for anything that already ran. Standing rule added
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
| Studio / Live turns | different loops | the read and the guard are skipped (`!studioSessionId`, `!liveRuntimeScope`) |
| document turns | the foreground read is skipped (`!attachedDocument`) | the claim guard DOES run on them (corrected 2026-10-06 after review: the first draft of this table said both were skipped) |
| client portal seat | tools deny-by-default | `offerAccepted` false for `callerTier === "client"`; the claim guard still applies (a client seat may not narrate a card either) |
| cost | more reasoning-tier turns | only accepted offers (and claim corrections) — short replies to PAIGE's own offer |

## 5. Evidence (classes kept separate)

**Automated — handler + real door (`test:client-memory-authz`, group 43, 29 checks):** 843 passed / 0 failed on the
candidate (43.19 added in review round 2, 43.20 in round 4). **At base** (clean worktree of `d20b323e9` with the same harness): 825 passed / **16 failed — all in group
43**, every other group green; the checks that must hold on both sides (F5–F9, F11, F12, the `confirm:true` gate, and the
three "stay quiet" checks 43.14/43.16/43.17 — base has no guard to misfire) pass at base. **At the first-round head**
(`47d5e66ba`, clean worktree): 835 / **6 failed — 43.14–43.18, every review finding reproduced through the real handler**,
plus 43.10 for the fallback's new wording.

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
| 43.14 | review 3a: payment-card Sales prose on an ordinary turn — one call, no correction, saved verbatim |
| 43.15 | review 1: alternatives in separate paragraphs ("Want me to…?\n\nOr should I…?") → asked, nothing proposed |
| 43.16 | review 2: "Ok I'll do it myself" → not an acceptance: no note, nothing proposed |
| 43.17 | review 3c: explaining what needs approval → no correction, saved verbatim |
| 43.18 | review 4: a minted card, then an authority claim whose correction call fails → WAIT_APPROVAL kept, one card, the server's sentence names the work above |

**Mutation (§71.4) — each defect reinstated, full harness run (12 mutants, all caught):** drop the tier route → 4 red;
claim guard blind → 2; accepted offer not action intent → 1 (43.13); staleness ignored → 1; alternatives read as one → 2;
fallback removed → 2; note never sent → 6; a bare "card" counts as an approval card → 1 (43.14) + unit; a failed correction
marks INTERRUPTED beside a card → 1 (43.18); acceptance leftovers allowed → 5. Two are caught only one layer down, by the
unit tests: the standing-state check removed (the saved WAIT_APPROVAL turn also carries `paige_confirm`, an independent
check) and an alternative alone in the paragraph before a specific offer (the fixture added for it after the first
mutation run found no test biting).

**Automated — pure (`continuity.test.ts`, Deno, CI step added):** 14 tests holding about 150 fixtures — the prod turns
verbatim (offer, capability prose, narration, bypass, "say the word") and every input from the independent review's
probes: acceptances and non-acceptances, offers and choices, approval-card claims and the payment/contact/outcome/report
cards, explanations, earlier cards, authority guesses and true statements. Deno resume + continuity 43/43 under CI's
sandbox flags.

**Measured on real production prose (read-only replay, 2026-10-06):** `unbackedClaim` run over every assistant turn of
the last 30 days that mentions a card, approval, "directly", skip or bypass (180 turns, content verified against
Postgres `md5`), with each turn's real card evidence (`paige_confirm`, WAIT_APPROVAL, or a proposal row within 2 minutes)
and its previous turn's standing card. **IN-SAMPLE — the guard was then tuned on these same turns, so this is not an
out-of-sample false-positive rate.** **Round-2 guard: 6 hits, 6 true, 0 false** — the four narrated cards with no
proposal row (2026-09-30, 10-01 ×2, and the 10-06 strand itself), a fifth missed by round 2 ("Approval card coming now for
…", now caught), and the 10-06 authority turn. **Round-2 build before this measurement: 21 hits, 5 true, 16 false** —
15 of them the bare adverb "directly" in honest capability talk ("I can query it directly"), 1 an explanation ("you'll
need to hit Approve on the card"). Both were fixed from the measurement (authority "directly" now needs a card or approval
in the same un-negated sentence; "need to … Approve" is an explanation) and the prod sentences became unit fixtures. One
narrated card is not reachable by any wording rule: its turn was 2 minutes from another client's real proposal, so the
evidence window counts it as backed — recorded, not tuned around.

**Re-measured at the round-4 head (second read-only replay, 2026-10-06; 194 turns 09-07→10-06, md5-verified; guard
copies taken by `git show` from each sha, row data deleted after).** `0470b4cae`: 6 hits, 6 true, 0 false. `14f3ccfb1`:
**13 hits, 6 true, 7 false**, all `authority`. Cause: round 4 made "approv…" optional in the approval-question rule, so
"What are you working on?", "What have you got on hand…?", "…do you want to hold off…?" matched. Fixed in the next
commit: the question must name approval, either as its subject ("Are approvals enabled?") or after "you/your
workspace". The seven prod sentences are now a unit test, which fails against `14f3ccfb1`. After the fix the guard
again flags only the six true hits. One borderline miss at every head, not fixed: "Approval card coming for her deal
next." (09-30, no card minted). "Next" is not read as now, and widening the announcement rule has regressed earlier
rounds twice, so this is recorded rather than tuned.

**Static:** `deno check paige-ai-chat/index.ts` — 10 diagnostics, identical codes to base (1 TS2339, 7 TS2345, 1 TS2740,
1 TS2769). All 96 `npm run` steps in `ci.yml` pass except `test:deno-ratchet` (147/2: "a missing check tool FAILS") —
**measured identical at base** in a clean worktree, environmental.

**Authenticated runtime (Solo, prod):** see §7 — recorded after merge and deploy, with controlled data.

**UNVERIFIED:** how often the REAL model, on the reasoning tier with the note, calls the tool on the first round (the
harness scripts the model; the guard and correction are what make a wrong first round safe). The closing call after a
forced termination (budget/no-progress) streams directly and is not passed through the claim guard (§6).

### 5n. Independent review — round 14 (`574f80bfd`): FIX_FIRST, fixed

Round 14 confirmed round 13's B1 and S1–S3 closed. C1–C7 and C10 are identical across r12, r13 and r14. The
production offer cuts at ", and then move", and every restatement of it is accepted.

- **B1: `stepToolDoes` brought back round 12's BL-2 for generic and idiomatic offers.** "Want me to go ahead?",
  "Should I do that?", "get started on the landing page" and "redo the landing page" have no listed verb. So a page
  or research run that really happened got "The step you accepted wasn't carried out" (false). This regressed
  against round 13.
  - **Fix:** a step tool is judged by what the step concerns, not only by its verb:
    - a page/funnel step belongs to the generators;
    - a research step (including "look at / dig into") belongs to research;
    - a copy step belongs to drafting.
  - A step whose verb sends, links, moves, books, tags or archives never belongs to them.
  - For a generic verb, the plan before the offer decides. `readForeground` now carries its last paragraphs as
    `context`.
  - "I'll link Dana's deal. Want me to go ahead?", then research, then "Linked!" is still held with the
    step-not-done line (43.30.L).
- **B2: the pronoun rules rejected ordinary replies to compound offers.** `namedAside` treated any capitalised
  word cut off by a second act (a stage, a weekday) as a person set aside, and `severalNamed` treated any
  "Capital and Capital" as two people. So "yes email her" was rejected for "email Dana the recap and move her deal
  to Proposal", and a made-up "Done" stood.
  - **Fix:**
    - "set aside" counts only for a CONTRAST cut ("not / except / instead / rather / but", with or without a
      comma);
    - "several people" means names joined right after the verb ("email Dana and Sam…").
- **Tests:**
  - **43.30, 9 cases:**
    - V1/V2/V3/V5: a generic or idiomatic page offer with the generator.
    - V12: a generic research offer.
    - L: the link plan with research.
    - Q1/Q3: compound pronoun restatements.
  - **Deno round-14 test.**
  - **Mutations:** removing the plan context fails 3; the old `namedAside` fails 1.
- **Recorded:** a narrowing reply that the restatement rejects ("Texted him!") goes to the ordinary path. That is
  where a made-up claim was before INT-332 too (SW3, unchanged at every head).

Harness 925/0. Deno 27/27. `deno check` 10, identical to base.

### 5m. Independent review — round 13 (`3712350c1`): FIX_FIRST, fixed

Round 13 confirmed round 12's BL-1 and BL-2 closed. C1–C9 are identical to round 12.

- **B1: any step-capable tool counted as "the step", whatever was offered and even when it failed.** "Email Dana
  the recap?" followed by a successful `draft_marketing_content` and "Done — I've emailed Dana" ended FINAL with
  nothing sent. That is the draft-versus-send hallucination this hotfix exists for. The same happened when the
  draft failed, and with research or a generator on a link offer. This was a regression from round 12.
  - **Fix:** a step-capable tool is THIS step only when its result did not report `success:false` and, on an
    accepted act, when the offered verb is what the tool does (`stepToolDoes`):
    - generators: draft / build / create / make…
    - research: research / look into / dig…
    - copy drafting: draft / write / rewrite…
    - `propose_action` and `ask_choices`: any verb.
  - Otherwise it is a non-step tool, and a claim after it is held with "The step you accepted wasn't carried out
    in this reply."
  - **Tests (43.29):**
    - X6: email offer, draft succeeds.
    - X8: email offer, draft fails.
    - X1: link offer, research runs.
    - GF: page offer, generator fails.
    - Without the verb match, 2 of these fail; without the success check, 1 fails.
- **S1/S2: the offered step was cut wrongly.** An "and" in the first three words was dropped, so "remove Sam and
  keep Dana" lost its cut. The second-act verb list also missed "notify", "launch", "open"…
  - **Fix (`offeredStep`):**
    - Only *leading* connectives are dropped.
    - The step is cut before "not / except / instead / rather / but", and before "and / then / ," when the next
      word in the original-case offer is a lowercase word that is not an article, pronoun or preposition.
    - Names stay capitalised, so "email Dana and Sam" remains one step.
- **S3: a pronoun could narrow the offer to one person.** "Yes email her" was accepted for "email Dana and Sam"
  and "yes text him" for "text Dana, not Sam". **Fix:** a singular pronoun is rejected when the offer names two
  people joined by "and" or a comma, or when the cut set a named person aside. "yes email them" still accepts.
- **Recorded:** "move Dana to Proposal and Sam to Lost" (a second act with no verb) is not cut. This is rare; the
  card still gates the write.

Harness 917/0. Deno 26/26. `deno check` gives 10 errors, identical to base.

### 5l. Independent review — round 12 (`910e671e9`): FIX_FIRST, fixed

Round 12 confirmed round 11's B1, S1 and S2 closed. B1 was checked across all 20 named reads plus `web_search`,
`web_fetch` and `n8n_list_workflows`: every fake "Linked!" is held, with the matching line.

- **BL-1: the strict restatement rejected ordinary replies.** Rejected replies included "yes email her" (to
  "email Dana…"), "yes create the task" (to "create a follow-up task…") and "yes keep her". These fell to the
  pre-INT-332 path, where a made-up "Done, I've created the task" stood as final. This was a regression from
  round 11.
  - **Fix:**
    - Articles are interchangeable.
    - A person pronoun may stand in for whoever the offer named, rejected only against a *different* pronoun the
      offer used.
    - A contrast or second act no longer refuses the whole offer. The reply is matched only against the offered
      step itself, up to "not / except / instead / rather / but" or "and <second act>". So "remove dana" ← "remove
      Sam … and keep Dana" is still rejected, while "yes send the invoice" ← "send her the invoice instead of the
      quote" is accepted.
  - **Tests:** 43.28.P1 and P3, plus the round-12 Deno test. Going back to round 11's matcher fails 2.
- **BL-2: tools that do the step themselves were not "the step".** `growth_page_generate`, `growth_funnel_generate`,
  `deep_research`, `draft_marketing_content` and `propose_action` carry out an offered step, but they are not
  classifier writes. So a true "I've created a draft" was held and given "The step you accepted wasn't carried
  out" (false), and the generator could be re-invoked.
  - **Fix:** `STEP_CAPABLE_TOOLS` joins the classifier writes in "the step was done".
  - **Tests:** 43.28.G3 asserts 2 calls, FINAL, with the reply as written. 43.27.B2 now uses `n8n_list_workflows`,
    which genuinely cannot do the step. Without the step-capable set, G3 fails.
- **SHOULD-FIX, done:**
  - `zapier_list_actions` is off the read list: it can record a Rail event and rotate an expired token.
  - The accepted-step continuation no longer says "no tool ran" after a read. It now says "nothing that carries it
    out ran".
- **NIT, recorded:** `announcesTheStep` misses synonym verbs ("I'll connect" for "link"); this is rare.

Harness 913/0. Deno 25/25. `deno check` 10, identical to base.

### 5k. Independent review — round 11 (`59d9ff4e3`): FIX_FIRST, fixed

Round 11 confirmed every round-10 finding closed: N4/N4b, the restatements E/E2, N1, and read-then-announce. The
ordinary paths are unchanged.

- **B1: one counter was doing two jobs.** The broad "might have changed something" count also decided whether a
  read had ended the turn. So a read tool named by suffix (`crm_pipeline_summary`, `plan_list`, `inbox_list`…) or
  `web_search`, followed by a made-up "Linked!", ended FINAL. That was a regression against round 10.
  - **Fix: the counter is split.**
    - `classifierWrites` (MUTATING_TOOLS plus ask_choices) is what "the step was done" means.
    - `writeAttempts` (anything not a verified read) only decides which line the server may add.
  - **The line now has two forms:**
    - **"Nothing was sent, saved or changed in this reply."** when only plain reads ran;
    - **"The step you accepted wasn't carried out in this reply."** on an act when some other tool ran. This is
      true, since no write did the step.
    - On an unknown step with other tools, no line is added.
  - The 20 suffix-named read tools the reviewer verified as selects or read RPCs are listed explicitly
    (`NAMED_READ_TOOLS`).
  - Tests: 43.27.B1 (`crm_pipeline_summary`, `plan_list`) and 43.27.B2 (`deep_research` on an act). With one
    counter, B2 fails.
- **S1: `restatesOffer` was a bag of words.** It accepted "yes text him" ← "text her", "remove dana" ← "remove Sam
  and keep Dana", and "delete the original" ← "…not the original".
  - **Fix:**
    - The reply must follow the offered step in order, starting at its verb.
    - "it/that/this" may stand in for the object.
    - A person's pronoun counts only if the offer used that same one.
    - An offer that sets one thing against another (not / keep / except / instead / rather) is never accepted by
      a restatement.
- **S2: `announcesTheStep` matched any "I'll + verb".** It flagged "I'll skip it", "I'll be here" and "I'll go
  with…". **Fix:** it now matches only the offered step's own verb ("I'll link it").
- **Recorded:** "yes send the card" on the two-act production offer accepts the whole offer, the same as a bare
  yes (NIT). The note quotes the reply.

Harness 910/0. Deno 24/24. `deno check` gives 10 diagnostics, the same as base.

### 5j. Independent review — round 10 (`9e54b9f3d`): FIX_FIRST, fixed

All round-9 findings were confirmed closed. The `isActionIntent` change is behaviour-equivalent when no offer was
accepted. The kept-reply branch never fires on a non-held turn, and wire = saved holds on every new branch,
protected turns included.

- **B1: the line was false after `deep_research`.** `deep_research` saves a run but is not in `mutatingTools()`.
  This was a regression from round 9 keying on writes. 44 of 96 declared tools are unclassified, and some of those
  have side effects: previews mint bindings, web tools log events.
  - **Fix:** `writeAttempts` now counts every tool not plainly named as a read
    (`crm_search_|get_|list_|search_|lookup_|read_|find_|view_|fetch_|query_|describe_|show_`), plus every
    classifier write. The line is added only when nothing but plain reads ran.
  - Tested by 43.26.N4/N4b; counting writes only fails 2 tests.
- **B2: a yes that restates the step bypassed INT-332.** "yes link it", "sure, link it", "Yes, make it warmer",
  "yes text her" skipped the offer path (pre-existing). The ordinary path's verb list missed most of them.
  - **Fix:** `restatesOffer` accepts a yes whose words are the offered step's own verb first, with nothing new
    added. "…to Sam instead", "…tomorrow" and "but…" still take the ordinary path. F3's "Link the deal to Afonso
    now" against a send-card offer is still not a restatement.
  - Tested by 43.26.E/E2; with the check off, 4 tests fail.
- **SHOULD-FIX, done:**
  - `saysItWasDone` no longer reads listing heads ("Scheduled: …", "Updated last on Monday", "Created on March 2")
    or "pending now" as claims. Its "-ing … now" form is back to an explicit verb list (43.26.N1).
  - On a held **act**, a read followed by an announcement of the step ("Found Dana — I'll link the deal") is held
    (`announcesTheStep`). Without it, 43.26.A fails.
- **Recorded, not changed:**
  - The no-progress closing call after a forced termination still streams unguarded. This is pre-existing and
    already parked in §6.
  - `ask_choices` in a main-chat turn ends the turn before the write count. Its entry there is inert, and the doc
    wording is corrected here.

Harness 907/0. Deno 23/23. `deno check` gives 10 errors, the same as base.

### 5i. Independent review — round 9 (`f2357dac6`): FIX_FIRST, fixed

- **B1: a prose offer accepted with "go ahead", "please do" or "do it" lost its answer.** Accepting an offer
  bypassed the C1 text heuristic only for held kinds, so an accepted prose offer fell through to
  `ACTION_INTENT_RE` on the person's words. The answer was continued, and the generic sentence then replaced it
  (12 of 23 common acceptance phrasings).
  - **Fix:** an accepted offer decides action intent on its own. Held kinds are action, prose is not.
  - 43.25.B1 covers four phrasings; it fails with the old line.
- **S1: cost and pressure on unknown steps.** 42% of realistic prose offers classify as unknown. Each took four
  reasoning-tier calls under "call its tool".
  - **Fix:** an unknown step gets ONE continuation, with a neutral message: "if it changes something, call its
    tool; if it is only an answer, give it in full".
  - Two calls, then the kept reply with the line (43.25.S1).
- **S2: the line was false beside a past fact.** "It was already sent on Monday" was followed by "nothing above was
  sent". The line now speaks only of this reply: **"Nothing was sent, saved or changed in this reply."**
- **S3: a read then a made-up result stood** ("Linked!" after a contact search), and a failed continuation left the
  reply with no line.
  - **Fix:** on a held offer, writes (MUTATING_TOOLS, plus ask_choices) and cards end the turn. A read ends it only
    when the reply does not read as done (`saysItWasDone`). The kept-reply line is now keyed on "nothing was
    written" rather than "no tool ran", and it also covers a failed continuation call.
  - Tests: 43.25.T1, F2, and T0 (a read offer answered from the read still ends in two calls).
  - Mutations: the old isActionIntent fails 4 tests; counting reads as acting fails 1.
- **Not changed (NIT):**
  - "Yes, make it warmer" is not a bare acceptance, so it takes the ordinary C1 path. This was true at every head.
  - The prose-note path reports mode `fast_answer`, which is cosmetic.

Harness 899/0. Deno 22/22. `deno check` 10, identical to base.

### 5h. Independent review — round 8 (`2e29e8f74`) + second production replay: FIX_FIRST, outcome made safe

Round 8 found the same two-list problem inside the round-7 completion list.
- **True answers were replaced.** "The first email goes out on day 1", "it is live at your domain" and "Sorted by
  value…" triggered the hold, and the answer was then overwritten.
- **Made-up results stood.** "Forwarded it to Sam.", "I waived the late fee." and "Her trial now runs through
  March 30." stood as FINAL, because 56 of 67 act offers classified as unknown, and unknown was not held.
- **The replay agreed.** Of 12 production replies the completion list matched, 9 were wrong ("is live" in the
  future tense, "on it" as a preposition, "Good to go?").

**The fix makes the OUTCOME safe in both directions, so no word list decides what the person sees:**
- **Prose offers are not held.** These are the answer-is-the-reply allowlist, now including conversational offers
  ("Ready to dig into Q3?", "…and we'll move on").
- **Act and unknown offers are held** until a tool, a card, ask_choices or a stated impossibility.
- **When a held offer runs out of rounds, its last reply is KEPT, followed by the server's line:** "No tool ran in
  this reply, so nothing above was sent, saved or changed." That line is true whatever the reply was. A true answer
  wrongly held keeps its words, and a made-up result the lists miss is contradicted in the same message. Card and
  authority claims still get the server's own sentence instead, as before. The old "I wasn't able to complete that
  request" sentence remains only for turns that are not accepted offers.
- **On an accepted prose offer**, a reply that reads as if it did something ("Done, I've moved Dana…") gets the same
  line added beneath it, and nothing else happens. `saysItWasDone` can be broad, because a false match only adds a
  true line under a true answer.
- **Impossibility now needs the step's own grounds:**
  - the target is gone, or changed since the offer;
  - or someone else did it ("by her", "herself").

  A bare "already linked", with nothing checked, is held (C1–C4).
- **Other fixes:**
  - "Are you ready to…" is not an offer.
  - A "Ready to…" statement is not a second offer.
  - "…, or just give me the go-ahead" is a choice.
  - The conditional-approvals rule needs approval settings plus a write act.
  - Curly apostrophes are normalised.
  - The replay's missed act verbs were added (activate, run it, try it once more, knock out, forward, waive, extend,
    rebook, share, loop in, approve, restore).
- **Recorded, not in scope:** the replay found one made-up progress line on a turn that was not an accepted offer
  ("Archiving the four workflows now — on it", after a long reply with a screenshot). That is the general C1 path,
  which reads the person's words, not this offer path. Parked for its own change (§6).

Tests:
- Harness 43.23/43.24 re-specified to the exact saved text (kept + line, or the claim fallback). Each held case
  asserts 4 calls and LIMIT_REACHED.
- New harness cases:
  - G1/G4/G6: forward, waive, extend.
  - N7: a bare "already".
  - P9–P11: true explanations with claim words.
  - U2/U3: prose offers that get the line.
- Deno "review round 8 + replay".
- Mutations:
  - replace instead of keep: 17 fail;
  - hold prose offers: 19 fail.
- Totals: harness 890/0; Deno 22/22; `deno check` gives 10 diagnostics, the same as base.

### 5g. Independent review — round 7 (`3c1cc34d4`) + production replay: FIX_FIRST, redesigned

Round 7 showed that two exemption regexes could not split prose from act both ways. Round 6's default-act
brought back the BLOCKING-1 overwrite for 45 of 76 ordinary prose offers ("make it warmer", "suggest subject
lines", "run through the numbers"). Its prose lists exempted 24 act offers with a destination ("add the summary
to her record", "draft the email and queue it", "update the copy on the landing page"), where a made-up "Added
it to her record." then stood as FINAL. **The design changed instead of the lists:**

- **The kind of step is three-way** (`offerKind`: act / prose / unknown), decided in this order:
  1. An act after the draft ("…and queue it") makes it an act.
  2. A pure-answer verb (explain, suggest, give you, run through, translate, point you…) makes it prose,
     wherever it points, unless it reaches outside the reply (by email, access, set it up, when she opens it).
  3. A destination ("to her record", "on the landing page", "in Gmail", "in your Paige settings") makes it an
     act.
  4. An edit of prose (make it warmer, change the tone, a draft or script for the person) makes it prose,
     unless it names a record (invoice, agreement, letter, document, task…).
  5. A known act verb makes it an act.
  6. Anything else is unknown.
- **What the reply CLAIMS decides the rest, for every kind** (`COMPLETION_CLAIM`). A reply that says the step
  happened or is happening ("Added it…", "Queued — it goes out…", "Sending it over now", "Texted it to you.",
  "Done", "On it") while no tool ran is never final. It is continued with "your reply says the step was done,
  but no tool ran…". Only a known act is held further, to tool / card / ask_choices / a stated impossibility.
  Prose and unknown answers stand as written. So a misclassified act cannot stand as a made-up result, and a
  misclassified answer is not replaced.
- **Impossibility** (`NO_LONGER_POSSIBLE`) covers the target gone or changed, or the step already being the
  case ("already linked/paid", "was cancelled", "since then … archived"). It is void beside a completion claim,
  but "I've checked / I have nothing to link / I've left it" are no longer vetoes.
- **Authority:**
  - The approval-question rule is back to do/does/is/are/have/has. Settings advice ("Should approvals be on for
    invoices?") is quiet. A missed approval question is harmless because the gate decides when the tool is
    called, while a false hit replaces a true answer.
  - A new rule reads a conditional act across the question mark ("Did you turn approvals off? If so I'll run it
    now.").
  - The reassurance phrase is removed before the bypass rules read the sentence, as navigation is, so "Nothing
    goes out without your approval, so I'll send it without your approval this once" is a bypass.
  - "card is back" needs "approval" (payment cards are quiet).
- **The production replay** (read-only, 30 days: 180 claim rows and 91 offer rows, every row md5-verified, row
  data deleted after):
  - `unbackedClaim` gives 4 card + 1 authority hits, **all TRUE, identical at `2652c1e04`, `b11e40af3` and
    `3c1cc34d4`**. No row differs. Two more true narrations are hidden by the ±2-minute evidence window
    (recorded; not a guard defect).
  - Offer classification fixed from it: "draft the agreement as a document" and "draft that offer letter" are
    acts; "help you draft/prepare…" and "walk through an example" are prose.
  - The live miss **"Ready to archive it? Just say yes and I'll pull the trigger."**, whose next turn was a
    narrated card, is now one accepted offer. "Ready to…" opening a sentence is an offer phrase, and an
    invitation to reply right after an offer question is the same offer. An offer followed by "Or did you…?"
    asks which.
- **Residual, recorded and not tuned:**
  - A third party's action stated as fact ("Dana was already linked by someone on your team") ends an
    accepted act as said, as it did at every earlier head. The server cannot verify it, and holding it would
    hold honest answers.
  - Seven act phrasings classify as unknown ("text you the summary", "continue with the import"). They are
    protected by the completion-claim hold, not by the act hold.

Tests:
- Harness 43.24: 25 assertions. Prose answers stand. Claimed acts are held on act, prose and unknown offers
  (U1–U3). Impossibilities end the turn.
- Deno "review round 7 + production replay".
- Two mutations, each red:
  - completion hold off: 5 fail;
  - kind forced to act: 15 fail.
- Harness 884/0. Deno 21/21. `deno check` 10, identical to base.

### 5f. Independent review — round 6 (non-author, exact head `b11e40af3`): FIX_FIRST, fixed

Three blocking findings, all introduced by round 5's fixes:

- **B1: a false completion stood as terminal.** `NO_LONGER_POSSIBLE` matched bare "there's no…",
  "already done/in place" and "nothing to do", so on an accepted act "Linked! There's nothing else you need to
  do." and "Done. Dana's already linked…" ended FINAL with nothing run. **Fix:** the phrase must say the step
  itself can no longer be done: the target is gone, someone else already did it, or the record changed since
  the offer. It is void beside any word of completion or progress ("done", "on it", "I've…", "Linked!",
  "…ing now").
- **B2: the production strand came back.** `offerIsAct` was a verb allowlist that missed 53 of 83 realistic
  act offers, including "re-send the approval card" and "get that approval card to you". **Fix: the default
  is inverted.** Every accepted offer is a held act unless its answer is the prose: explain, walk through,
  summarise, compare, outline, list options, a draft or rewrite for the person to use (with nothing sent or
  saved after it), or an edit of that prose (tone, P.S., more ideas). Read offers stay held, because calling
  the read is what ends the turn. All 83 are now held, and the claim guard now also reads "I've resent the
  approval card" and "Approval card is back in front of you" as claims.
- **B3: true answers could still be replaced.** The round-5 "waiting" shape flagged explanations ("Approval
  requests waiting on you show up in Needs your OK"), and draft edits ("change the tone") were read as acts.
  **Fix:** the waiting shape needs one specific card stated as there now, with no modal, no when/once/if, and
  no "any/every". The prose edits are on the exemption list.
- **SHOULD-FIX:**
  - The approval-question rule now needs approval to carry the state of this workspace: no third party
    ("from her manager", "her company requires"), no preposition ("approval on Dana's list"), and no vague
    "set to the right setting".
  - The "nothing…" reassurance is exempt only in its exact shape beside "without your approval/OK", so
    "…without your approval — nothing goes out late" is a bypass again.
  - The DIRECTLY navigation exemption removes only the navigation phrase, so a bypass elsewhere in the
    sentence still counts.
- **Known, pre-existing, not tuned:** "Once the approval card is waiting, you'll see it in Needs your OK." and
  "You'll see it in Needs your OK shortly." read as card claims, as they did at `2652c1e04`. "Teeing it up now —
  you'll get the card in a sec." is not, also unchanged. On an accepted act none of these stands, because the
  turn is held.

Tests: the reviewer's probes are harness 43.23 (11 assertions; 10 fail against `b11e40af3`, and D1 already
held there) plus the "review round 6" Deno test (all 83 act offers, 25 prose offers, and every claim and
authority case above). Harness 861/0. Deno 20/20.

### 5e. Independent review — round 5 (non-author, heads `14f3ccfb1` and `2652c1e04`): FIX_FIRST, fixed

B1 and B2 from round 4 were confirmed closed, with no new execution path, no leak outside eligible turns, and
`ask_choices` always on offer when a continuation asks for it. One blocking regression from round 4's structural
rule:

- **BLOCKING-1: true answers were replaced on accepted offers that the prose itself fulfils.** "Want me to walk
  you through how approvals work?" or "…draft a short follow-up you can send her?" counted as action. The
  explanation or draft, ending on its natural "Want me to tweak the tone?", was continued three times and then
  overwritten by the "wasn't able to complete" sentence. At `0470b4cae` the same probes ended FINAL after one
  call. **Fix:** `offerIsAct` holds an accepted offer to tool / card / `ask_choices` / refusal only when it
  names a platform act: the offered verb is link, send, add, schedule…, or it is a generic "go ahead" that
  defers to an act named before it. Every other accepted offer still gets the reasoning tier and a note telling
  PAIGE to give the answer in full, and its prose stands. 43.21a–c are red with the fix off.
- **SHOULD-FIX-1: "can no longer be done" phrasings were not terminal.** Examples: "That deal no longer exists",
  "There's no deal…", "…was deleted", "…already linked". On an accepted act these now end the turn as said
  (`NO_LONGER_POSSIBLE`). 43.22.1–4 are red with the fix off.
- **SHOULD-FIX-2: two narrated waiting cards were missed.** "the approval request is waiting for you" and "an
  approval card waiting…" are now claims when no card was minted. *Not changed:* on an accepted act, a read
  still counts as acting for C1. The claim guard covers the narration that read-then-prose could carry, and
  treating reads as non-terminal would stretch honest read-and-answer turns. Recorded.
- **SHOULD-FIX (authority shapes): over-matches in three rules.** "Do you want to approve it on the card
  above?", "…or should I set up another?" and "Is the approval for Dana's link still on your list?" no longer
  count, because the approval-question rule now needs approval itself to carry the state ("approvals enabled",
  "turned approvals off", "approval required", "Trust Compass set to auto"). The reassurances "nothing goes out
  without your approval" and "I'll send nothing without…" are not bypasses. "I'll take you directly to the
  approval card" is navigation, not a way around approval.
- **NITs:** "would you rather" is not read as an offer, so that turn takes the ordinary path, which is safe and
  left as is. The first-round note for an act now names `ask_choices`.

Every round-5 probe is a unit or harness assertion: the "review round 5" Deno test and 43.21–43.22. Harness
850/0. Deno 19/19, with all 232 round-4 fixtures still holding. `deno check` gives 10 diagnostics, identical to
base.

### 5d. Independent review — rounds 3 and 4: FIX_FIRST each, fixed

**Round 3** (on `c8881dcb0`) showed that round 2's clause-wide exceptions had regressed it. A condition anywhere
excused "Sending the approval card now… once you approve", and an invoice/lead/board noun anywhere dropped "Sending the
card for Dana's invoice now". Every rule became local: assertions are claims whatever follows; only futures and
announcements are excused by a condition or a question; a non-approval card needs its owning noun beside it.

**Round 4** (on `0470b4cae`) ran 540 inputs against three heads. Two findings were blocking:
- **B1, the strand through a purpose tail.** "Sending the approval card now so nothing runs until you approve. Want me
  to start the invoice after?" was excused by a clause-wide negation, and C1 then took the "?" as terminal. Fixed
  twice over: negation now counts only before the card or as a "…but it failed" tail, and decision 4b makes a prose
  question non-terminal on an accepted offer (43.20, red with the rule off).
- **B2, a refusal read as a bypass.** "I can't send it without your approval" matched "i can". The SELF forms now
  exclude negatives, and a negated act is not a bypass.

Round 4's should-fixes were also fixed: earlier-card words count only beside the card; habitual explanations
("whenever…", "for anything that…", "is how you…") are quiet; "sending over" and "firing off" are claims; the
authority misses are covered ("since approvals are off…", "are approvals enabled…?", "This doesn't need a card, so
I'll…"); a bare "Should I?" after a choice asks which.

The reviewer's own expected-value judgements on its 232 new inputs went from 43 wrong to **0 wrong**, and all 232 are
now a committed fixture (`continuity.review-fixtures.json`) that the unit tests check one by one.

### 5c. Independent review — round 2 (non-author, exact head `1176c3bbd`): FIX_FIRST, fixed

| # | finding | fix |
|---|---|---|
| B1 | the CARD correction still said "call its tool now" with no "never re-call what already ran" (the round-1 3c repeat risk, on the card path) | the sentence is in both corrections now; unit-asserted |
| S1 | true "approve first, then I'll … directly" sentences and read-only "without approval" flagged as authority, even beside a minted card | "directly" excludes approve-first sentences; "without approval" excludes read verbs (look up, research, read, search…); a conditional setting must license an act ("…then I can…") to count |
| S2 | choices with no "or" — "two ways/paths", lists under such a heading, "I could also", "happy to also" — read as one offer | MULTI_PATH over the last three paragraphs; "could also / happy to also" added |
| S3 | `CARD_OBJECT` shapes skipped the approval test (card on file, card payment summary, a lead card in a column, a card sent to Stripe) | a card owned by another noun (payment, Stripe, column, lead, portal…) is skipped unless the sentence names an approval card; "once I propose…" is a condition |
| S4 | missed: curly apostrophes, "Card's up!", "I've already sent the approval card", "I've put it in your Approvals tab", "no rush" voiding a claim, "I'll send the approval card", "Approval card incoming!", "…below 👇" | apostrophes normalised; `'s` forms; "already"/approvals-list exempt only when nothing is created now; negation must govern the card; an unconditioned "I'll send the approval card" is a claim; incoming/below/into the approvals list |
| S5 | "no worries" / "no problem" alone read as yes | they count only beside an acceptance; 👎 ❌ 🚫 ✋ reject |
| S6 | a failed correction after work ran (WAIT_WORK, an executed write) recorded INTERRUPTED over it | the failure keeps the turn's own state whenever a tool ran or a card was minted; 43.19 (red with the old guard) |
| S7 | the replay figure is in-sample | labelled so above |
| N1–N3 | "either way", "instead of", "payment options" asked which; a stale comment; 👎 | single offers accept again; comment corrected; 👎 rejects |
| N4 | the foreground read inherits the turns policy (a tenant admin can read a member's client-scoped thread) | not new exposure — the summary and fold reads use the same scope; noted, unchanged |

Every probe from this round is a unit fixture (the "review round 2" test). Harness 842/0.

### 5b. Independent review — round 1 (non-author, exact head `47d5e66ba`): FIX_FIRST, fixed

The reviewer reproduced 836/0 and 43/0, then probed the input space the harness did not exercise (scripts kept in the
session scratchpad). Findings and what changed:

| # | finding | severity | fix |
|---|---|---|---|
| 1 | alternatives in separate paragraphs / option blocks / a trailing "Or I can…" read as ONE offer — and "yes" ran the last one | BLOCKING | the offer is read across the tail (§3.2); 43.15 + unit fixtures |
| 2 | declines, acknowledgements, deferrals and question-less questions read as acceptance ("Ok I'll do it myself", "yes I saw that", "yes, tomorrow", "sure, what's the total") — "yes = execute" over-breadth | BLOCKING | acceptance is a whitelist parse (§3.2); 43.16 + fixtures |
| 3a | any "card" counted (payment, contact, outcome cards) — would replace true Sales prose | BLOCKING | approval-qualified cards only (§3.4); 43.14 + fixtures |
| 3b | the fallback said "nothing is waiting for your OK" without reading pending confirmations; earlier cards counted as new | BLOCKING | the fallback claims only this reply; earlier-card references exempt (§3.4) |
| 3c | true approval statements flagged, even after a write ran; the correction said "call its tool now" (a repeat risk), and the fallback hid completed work | BLOCKING | authority = guessing/asking/offering a way around only; correction forbids re-calling what ran; fallback names work shown above (§3.5); 43.17, 43.18 |
| 4 | a failed correction beside a minted card recorded INTERRUPTED | SHOULD-FIX | a card this turn keeps WAIT_APPROVAL; 43.18 |
| 5 | claims beside a "?" and other shapes missed ("Card sent.", "I'll send the approval card now") | SHOULD-FIX | clause reading + the shapes added; fixtures |
| 6 | the forced-termination closing call is not guarded | SHOULD-FIX | NOT fixed — parked (§6), unchanged honest label |
| 7 | real acceptances missed ("Go", "sure, why not", "um, yeah", "100%") | SHOULD-FIX | whitelist covers them; fixtures |
| 8 | the doc said the guard skips document turns; and "a spent budget records LIMIT_REACHED" was not true on a failed call | SHOULD-FIX | §4 corrected; §3.4 states both outcomes |
| 9–11 | "I can also" read as one offer; an "or" inside one offer's object asks; quoted offer text in the note | NIT | 9 now asks (safe); 10, 11 kept as is, as the reviewer judged them |
| — | the guard's false-positive rate on real prose was unmeasured (the reviewer's "biggest evidence gap") | — | measured: 21 hits / 16 false on the first fix, then 6 / 0 false after fixing from it (§5) |

## 6. Parked / not in this change (with evidence)

- **Made-up progress on a non-offer action turn** (prod replay, 2026-10-06: "Archiving the four workflows now — on it" after a long reply, no tool, cards only two turns later). That is the C1 action-intent path, which reads the person's own words, not INT-332's offer path. It needs the same kept-reply-plus-line treatment applied to C1's exhausted branch. Own change.

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
