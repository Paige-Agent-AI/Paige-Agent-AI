# EXP10 — Read-payload breadth + the "runner not available" confession (2026-11-06, owner live-test follow-up)

## OWNER REPORT (verbatim, after the #3292 live re-test)

> "Is there a way to make this a better experince for our users? PAIGE has to have more intelligence
> than this. If I ask for a list of contacts she shouldn't be limited to finding me only 2. When I ask
> for something general she should be asking and asking over and over. Take a look at your EXP10 to
> make sure my request is within your assignment scope."

His transcript proves the #3292 fix works end-to-end (five approved card runs; PAIGE reads real data
back: `her_nextplace`, `joviaaa 🦖`, both `Shay Wright` records with dates). Three gaps remain, two of
them mine.

## GAP 1 (IN SCOPE — MY CAPS): "list 5 contacts" → PAIGE could honestly report only 2

The gateway's 4 000-char data cap plus the chat's 3 000-char re-cap cut the page off mid-third-contact
(PAIGE said exactly that: "the response was cut off during the third contact"). Reads are
side-effect-free; the only reasons to bound the channel are injection surface and context budget.

**Fix:** gateway cap 4 000 → **12 000** (`result.ts RESULT_DATA_CAP`), chat re-cap 3 000 → **8 000**
(`run-projection.ts FORWARDED_DATA_CAP`), and the `read_observed` glossary note now teaches the
truncation discipline: "if `data` ends with [truncated] you did not see the whole result — narrow the
query instead of presenting a partial list as complete."

## GAP 2 (PARTLY IN SCOPE — THE CONFESSION IS MY NOTE'S JOB): "I don't have the action runner available in this chat"

Prod forensics (paige_chat_turns seq 2422/2431 vs 2427+): on terse person-lookups ("Can you find Shay
 Wright?", "What about Shay Wright") the turn routes READ, and the exposure fabric withholds every
mutating-classified tool — `ghl_run_action` is risk-class `high` (action-risk.ts:142), so the round
offered only `ghl_list_actions`. The model called the lister (its "1 step"), saw the actions approved,
and TRUTHFULLY reported the runner absent. On explicit phrasings ("search for Shannon Wright") the
route widened and the same chat ran the tool seconds later.

Two layers own this: **(a) EXP10 (this PR)** — the lister's `note`, the one text guaranteed to be in
the model's context at that exact moment, now forbids the confession and teaches the honest move:
approved actions are NEVER unavailable; ask the person to re-send (which re-routes the turn with the
runner) or ask the question you need. **(b) Conversational Loop (INT-304, routed with this
diagnosis)** — the durable fix is the route classifier / exposure fabric itself: a person-lookup
intent should not route without the CRM runner, and an unavailability confession should escalate
(`escalateTurn`) instead of ending the turn. That file is the CL stack's territory and is not touched
here.

## GAP 3 (OUT OF SCOPE — ROUTED): "When I ask for something general she should be asking and asking over and over"

Conversational clarification patterns are the Conversational Loop lane (INT-304). Noted there with
the owner's verbatim quote. (He liked the one clarification PAIGE did offer — "Shay or Shannon?" —
so the direction is: more of exactly that.)

## AUTOMATED_EVIDENCE

- `result.test.ts` / `run-projection.test.ts` — cap pins renewed to 12 000 / 8 000; NEW
  truncation-discipline note test; all gateway tests 33 passed.
- `mcp-ghl-chat-slice.test.ts` — NEW test pins the lister note's two sentences ("are NEVER
  'unavailable'", "do not tell the person the action or runner is unavailable"); 15 passed.
- `mcp-execute-e2e-contract.test.ts` 15 passed; smoke 400 assertions green.
- Spine: 29 incumbent fingerprints renewed (module's own inspector, documented note); self-test
  PASS, main lint PASS (245 capability), ancestry 32/32 — run LOCALLY BEFORE PUSH this time.

## STATE_COVERAGE

Covered: cap raise + markers, truncation discipline reaching the model, the confession-forbidding
note at the exact surface that failed, all pins renewed. Not covered: the route/exposure fix itself
(INT-304, out of this lane's scope by the owner's own scope-check request); provider JSON semantics.

## BEHAVIORAL_EVIDENCE (owed after deploy)

Owner re-test: (1) "list 5 contacts" — PAIGE should report ~5 real contacts, or say the excerpt was
truncated and narrow the query herself; (2) a terse "find [person]" — PAIGE should never again say
the runner/action is unavailable; she asks to re-send or asks her question.

## INTERNAL_BUILD_IDENTITY

**LANDED 2026-11-06 04:49Z**: PR #3294 squash-merged (head `9de68b2168c064c5e39f4a72a15c257346491dda`,
11/11 checks green) -> **main `21aa150710c63a37bbf77aa6b5ce151f72ba9415`** -> deploy-edge-functions
run 42164650634 SUCCESS: secrets applied, `deployed mcp-gateway` + `deployed paige-ai-chat`, readback
both PASS (source/configuration matched) at 04:49:59Z.
