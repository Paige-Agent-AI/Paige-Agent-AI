# INT-334: route by state, intent and capability before model (evidence record)

**Owner ruling (2026-10-06).**
- Sonnet 5 is retired. The Anthropic reasoning seam moves to `claude-sonnet-5-5` (INT-329 part 2, #1783).
- Sonnet 5.5 is a frontier peer, not PAIGE's universal brain.
- PAIGE routes each turn in this order:

  thread state → intent → capability → governance → cognitive class → model and provider → execution → verified readback and receipt → response.

- The GPT-6 family is first-class:

  | Model | Tier |
  |---|---|
  | `gpt-6.1-sol` | operational |
  | `gpt-6-astra` | frontier / escalation |
  | `gpt-6-luna` | cheap |

- Open models stay in the high-volume pool.
- No model or provider gains authority by being chosen.

The work ships as bounded PRs, R1–R12. Each entry below labels its evidence class: automated, static, production read-only, or UNVERIFIED with the reason.

## R0: grounded map (2026-10-06, `origin/main` `eff41d6a7` plus production)

### Chat model selection
- `paige-ai-chat` picks a legacy label at four streaming call sites:

  | Call | Line | Picks "pro" (reasoning) when |
  |---|---|---|
  | main | 9461 | Studio, an attached document, or a substantive turn |
  | loop | 16420 | Studio or a substantive turn |
  | continuation | 16452 | a substantive turn |
  | close | 16534 | Studio or a substantive turn |

  Otherwise it picks `google/gemini-2.5-flash`.
- Five non-streaming calls use flash, flash-lite or pro labels: session summary, thread fold, document read-check, and two extraction calls.
- `tierForLegacyModel` maps `pro` to Claude reasoning and everything else to Haiku. A `gpt-6` label would fall to the cheap tier.
- `substantiveTurnIntent` is a regex that **only** chooses that tier. A typed "yes" never approves: approval is the card's server-issued fingerprint.
- Production, last 7 days: Haiku served 77 `chat` and 50 `chat-tool-loop` rows. There were no OpenAI text traces.

### Gates
- Chat's inline tools are gated inside `executeToolCalls`, not through `decideGovernedExecution`.
- `web_search`, `deep_research`, `generate_image` and `delegate_to_subagent` are unregistered legacy capabilities.

### Tools and token limits
- About 95 tools are sent on every turn. Only Studio narrows them.
- No chat call sets `max_tokens`, so the 2048 default applies.

### The model fabric before INT-334
- `routedChatCompletion` reaches only Anthropic and Featherless.
- `callModel` text cells reach Anthropic, Groq and Featherless.
- Nothing in the router streams.
- `openai.ts` `openaiChat` has no callers. It uses Chat Completions with `gpt-4o`, and has no tools and no streaming.

### Existing homes the routing work extends
- `paige-turn/contract.ts` (turn states and resume kinds).
- `paige_pending_confirmations` and the C4a/b/c resume.
- INT-332 `continuity.ts` (#1781, open), which turns an accepted offer into the task.
- `paige_durable_work`.
- `projectCapabilities` and the capability gateway.
- `paige-deep-research` and `paige-web-search` (Firecrawl).

### Absent today
- Image search does not exist.
- Secure Browser is hard-wired unavailable and cannot be reached from chat.

## R2: OpenAI Responses adapter (dormant)

### What was built
- `_shared/openai-models.ts` is the one place a GPT-6 id is chosen, by cognitive class. Effort:

  | Class | Model | Effort |
  |---|---|---|
  | cheap | Luna | `none` |
  | operational | Sol | `medium` |
  | frontier | Astra | `high` |

- `_shared/openai-responses.ts` calls `POST /v1/responses` with `store:false` and `include:["reasoning.encrypted_content"]`. It accepts function tools only; hosted or provider-native tool types and untranslatable content parts are refused before the key is read or any call is made.
- It maps the chat shape PAIGE already builds in both directions:
  - system messages become `instructions`;
  - user text and images become `input_text` and `input_image`;
  - assistant `tool_calls` become `function_call` items, and tool results become `function_call_output` items, keyed by `call_id`;
  - streamed events become the same chat-shaped SSE that `claude.ts` emits.
- Reasoning items ride a distinct `paige_provider_items` key and are replayed only to the same model.
- Reporting is honest:
  - an HTTP error, `status:failed`, a failed stream, an `error` event or a truncated stream is traced as an error and never finishes cleanly;
  - a refusal is a refusal stop, never answer text;
  - `incomplete(max_output_tokens)` is reported as `max_tokens`.
- Traces carry the **served** model, the uncached input (`tokens_in`) separately from cached tokens, and the stop reason.
- Callers get PAIGE primitives, not OpenAI vocabulary: `reasonOperational`, `reasonFrontier`, `classifyStructured`, `streamToolReasoning`, `reasonVision`.
- The allow-list derives the three ids from `openai-models.ts`.
- Pricing rows, as list prices from openai.com:

  | Model | $ per MTok, input / output |
  |---|---|
  | Luna | 0.10 / 0.50 |
  | Sol | 2 / 10 |
  | Astra | 10 / 50 |

  Cached-input pricing stays with INT-331.

### Proof
- **Automated:** `npm run test:openai-responses` gives 84/0 (after review round 3), through the real adapter with an injected transport and the recording fake Supabase. It is wired into CI. Eleven planted defects were each caught:
  - `store:true`;
  - hosted tools allowed;
  - a forced `tool_choice` passed through;
  - cached tokens billed as fresh;
  - the served model ignored;
  - a failed stream finishing cleanly;
  - a truncated stream marked a success;
  - a refusal emitted as text;
  - reasoning replayed to any model;
  - the OpenAI price rows removed;
  - a file part silently dropped.
- **Automated:** `test:reasoning-tier` 67/0, `test:token-pricing` 22/0 and `test:trace-wiring` 20/0, all unchanged.
- **Static:** `deno check` reports no errors on the four changed shared files.
- **Dormancy:** `edge-affected.py` finds no function importing `openai-responses.ts`. A merge redeploys the importers of `model-allowlist.ts` and `token-pricing.ts`, the same 39-function set as R1.

### UNVERIFIED
- Every live OpenAI behaviour is unverified: served ids, real event order, reasoning-item replay across tool rounds, cache hits, and latency.
- Reason: nothing calls the adapter until R7, and R7 carries the first live proof.
- Key status, as reported by the owner on 2026-10-06; names only, values never read:
  - `OPENAI_API_KEY` is set, and the owner rotated it the same day because the old value may have expired.
  - A second, misspelled secret (`OPEN_AI_API_KEY`) was deleted.
  - The adapter reads only `OPENAI_API_KEY`.
- Providing the key is taken as the owner's go-ahead for OpenAI as a provider. The adapter keeps `store:false`.

### Review round 1 (independent, BLOCK, all fixed)
1. **Reasoning replay never fired.** Items were tagged with the dated served id but matched against the requested alias. They are now tagged with the requested model.
2. **Replay was a side door.** Any item type passed through. Replay now carries only encrypted `reasoning` items, rebuilt field by field.
3. **Orphan reasoning after a refusal.** A refusal turn's reasoning is no longer replayed.
4. **A non-JSON 200 threw with no trace.** It is now a traced `invalid_json` error.
5. **`cancelled`, `queued` and `in_progress` read as success.** Only `completed` and `incomplete` now carry an answer.
6. **Empty tool arguments went out as `""`.** They are now sent as `{}`.
7. **Streamed calls were keyed on `output_index` only.** They are now keyed by `item_id`, with arguments reconciled from the `.done` events. A call with no arguments streams `{}`.
8. **The adapter did not enforce its own limits.** It now enforces the allow-list, and Sol and Astra never receive effort `none`.
9. **A pricing comment was false.** The `token-pricing.ts` comment is now model-neutral.

Gate: 79/0 at the end of round 1. **Correction (round 2):** the claim that each of the 9 findings was reinstated and caught was overstated. Re-reinstating them, the confirming reviewer found two that passed: the stream tagging reasoning with the served id (finding 1) and the non-stream result returning `""` arguments (finding 6). Both now have their own tests (8.2, 8.1).

### Review round 2 (independent confirmation, SHIP)
All nine round-1 fixes were confirmed against the real module. Further findings, all Low:
- **L1, fixed.** A `.done` that contradicted the streamed arguments finished as a clean tool call carrying invalid JSON. Those bytes are already sent, so the turn is now a traced `tool_arguments_mismatch` error with no finish (8.3).
- **L2, fixed.** The stream trusted the `response.completed` event name. A terminal response whose own status is `cancelled` (or anything other than `completed`/`incomplete`) is now an error, matching the non-stream path (8.4).
- **L3, fixed.** The two coverage gaps above (8.1, 8.2).
- **L4, carried to R7.** Replay puts a turn's reasoning items before its text and calls. If one output interleaves reasoning and calls, the provider may reject the reordered replay. Unverified live; R7 tests it.
- **Info.** Trace `input` is `body.messages`, so replayed encrypted reasoning blobs reach `paige_llm_trace.input`, up to its truncation limit. Dated served ids are refused by the allow-list; callers pass the alias.

Gate: 83/0. Each of the four round-2 fixes was reverted on its own and caught by exactly its own test (M1→8.2, M2→8.1, M3→8.3, M4→8.4).

### Review round 3 (independent, on the round-2 commit, SHIP)
- **Low, fixed.** An early `.done` with empty arguments emitted the `{}` fallback, so a later event carrying the real arguments became a mismatch error. The fallback is now emitted only when the stream finishes (8.5; reverting it fails 8.5, and dropping the end-of-stream fallback fails 7.8).
- **Low, accepted.** A `.done` that differs from the streamed deltas only in whitespace is treated as a mismatch. OpenAI's `.done` is the exact joined deltas, so this is a deliberate strict choice.
- **Carried to R7.** Tool-call deltas from a turn that fails are already on the wire. The R7 caller must act on tool calls only after a `tool_calls` finish, never on deltas from an unfinished turn.

Gate: 84/0.

**Carried to R5–R7:** the stream can finish with `length` or `content_filter`. `paige-ai-chat` treats any `finish_reason` as finished (index.ts ~9648, ~16757), so a refusal or a truncation must be surfaced when the seam is wired.

## R3: the Turn Route contract (pure) and R7a: the finished-round tool gate in chat (live defect closed)

### What was built
- **`_shared/paige-turn/route.ts`** replaces `substantiveTurnIntent` as the *contract* for model selection (chat adopts it in R4–R7). `resolveTurnRoute(facts)` is pure and total: server-resolved facts in, one route out.
  - **State first.** In order: an approval verified by fingerprint → `deterministic` (the stored act runs; no model, no tools); an answer to PAIGE's standing question → operational with tools; an accepted offer (INT-332 `readForeground` + `offerKind`) → an act or unknown step is operational with the governed tools, a prose step may be cheap only when a trusted classifier calls it light and data-free; an offer with alternatives → PAIGE asks which; a standing card → operational, and typed words never approve it.
  - **Classification second.** A cheap structured classifier (wired in R4/R5) supplies intent, research need, difficulty, image need and data need. It can raise a state's floor and never lower it; below 0.6 confidence it changes nothing. For an accepted offer it reads the accepted *step*, not the bare "yes".
  - **Cheap never carries tools.** With no classifier, a fresh turn takes the conservative default: operational with the governed tools.
  - **A route is not authority.** Its keys are pinned (`v, basis, intent, capability, cognitive_class, reasons`). It never predicts whether a card is needed; the tool/Spine door still decides risk, autonomy, role, workspace and approval.
  - **Stays in the loop, not the route:** held-step continuation, accumulated-output inspection, the claim guard, truthful readback, the continuation budget, wire = transcript. WAIT_WORK is not a routing state (C4d/e paused).
  - **Class policy (data):** operational Sol → Sonnet 5.5; frontier Astra → Sonnet 5.5; cheap Luna → open pool (Featherless, Groq) → Haiku.
  - **Fallback eligibility:** only auth/config, billing, rate limit, model unavailable or provider outage, each as the provider's response proves it. Never on an invalid request, `unknown`, a refusal, an answer someone dislikes, honest research insufficiency, a governance refusal, a required approval or a downstream tool failure; never once a round emitted a tool call or visible text, unless proven unexecuted.
- **`_shared/paige-turn/round.ts`** — the R7 invariant. `readModelRound` folds the chat-shaped stream both converters emit; `executableToolCalls` returns a round's named calls only when it ended in a normal tool-use stop (`finish_reason: "tool_calls"` then `[DONE]`, reader intact), else none. `wholeArguments` is the per-call check the dispatcher applies: an object or empty (a no-input tool; Anthropic streams no argument text for it), never cut-off JSON, an array or a scalar. `ROUND_NOT_FINISHED_NOTE` is the one sentence the person sees.

### R7a: the gate in chat (a LIVE defect, closed)
- **The defect (production, before this PR).** `consumeRound` recorded whether a round finished but nothing gated execution on it: any `tool_calls` delta set `hasToolCall` and the loop dispatched. Anthropic's converter maps every non-`tool_use` stop (`max_tokens`, `refusal`) to `stop`, and a broken stream ends with a clean `[DONE]` and no finish. So a cut-off, token-limited or refused round's visible calls ran, and several dispatch branches read cut-off JSON as `{}` (only the step announcer refused it). Found by the R5–R7 grounding map, 2026-10-06.
- **The fix.** `consumeRound` collects its `data:` payloads and asks the shared gate. A round that is not runnable executes nothing, calls no model again (every post-loop continuation/correction branch is skipped via `unfinishedRound`), and ends INTERRUPTED with the server's sentence; when nothing ran this turn it adds `NOTHING_RAN_NOTE`. Live takes its tools-free closing answer instead. Server-built resume rounds (stored approved acts) are unaffected. Inside a finished round, a call failing `wholeArguments` is refused before any branch reads it (`ARGUMENTS_UNPARSEABLE`), so the model can resend it — the recover-and-retry behaviour (36.23h) is kept, the unsafe `{}` path is gone.

### Proof
- **Automated (Deno, CI):** `route.test.ts` + `round.test.ts` 28/0 — 30 route conformance cases (the R4 set: "Yes", "Sounds good", "We may as well", "For sure", "Go with that", "The second option", each by state) and a 664,320-combination state × classification sweep pinning the floors, cheap-without-tools, unsure-changes-nothing and the key set; the owner's six round cases plus pinning cases in both providers' finish mappings.
- **Automated (Node, CI):** `test:round-gate` 30/0 — the REAL Anthropic converter (`gatewayCompat`) and the REAL OpenAI converter (`responsesStream`) fed provider-native events for eight cases; only the normal tool-use stop yields a call, for both.
- **Automated (end to end, CI):** `test:client-memory-authz` 934/0, including 43.40: a whole accepted-step tool call from a round cut off / at the token limit / ended as a refusal → no door call, no card, exactly one model call, the server's sentence, INTERRUPTED; the CONTROL (same call, finished) mints its card.
- **Mutation:** route 14 planted → 10 caught, 4 equivalent (the final cheap-tools guard; the standing-card floor it restores; the classifier's `cheap` assignment, reachable only when already cheap; an accepted act always carrying tools). Round 8 → 8 caught. Converters: making OpenAI finish any tool round as `tool_calls` fails 4 cases, Anthropic 2. **In chat: switching the gate off (today's production behaviour) fails exactly the three unfinished 43.40 cases.**
- **Static:** Deno diagnostics on `paige-ai-chat` identical to `main` (10 = 10, same set); `deno check` clean on the new modules.
- **Unchanged:** `test:openai-responses` 84/0, `test:reasoning-tier` 67/0.

### Carried
- **R4** wires state-first routing into chat against merged INT-332, with the classifier.
- **R5–R7** move chat onto the shared streaming fabric; the gate is already in the loop, so every provider inherits it.
- **Sol/Astra compatibility gate (from the loop lane):** before Sol becomes primary, replay the INT-332 fixtures against representative Sol output (offer detection, completion-claim detection, step matching, claim correction); same for Astra. Misses feed the semantic replacement, not more patterns.
- **The INT-332 claim-correction call** is classified operational when R5–R7 remove the legacy labels.

## R2 deploy readback (production, read-only, 2026-10-06)
- Deploy run 37532499262 for `fc5406999` (#1785): conclusion success, logged "✓ deployed" for the same 39 functions `edge-affected.py` selects, and moved `edge-live` to `fc5406999`.
- Provider byte readback (`get_edge_function`, sha256 of `claude-models.ts`, `model-allowlist.ts`, `token-pricing.ts`, `openai-models.ts` and each `<slug>/index.ts` against the commit): **35/39 match**.
- Still stale, each holding the PARENT commit's shared files: content-draft (v98), extract-business-credit-report (v81), generate-outreach-draft (v83), growth-funnel-draft (v81). growth-funnel-draft is three deploys behind and still serves `CLAUDE_REASONING = "claude-sonnet-5"` (the `55c820c5` blob). Their versions did not move this time; the CI log claims all four deployed.
- The three functions stale after R1 other than growth-funnel-draft (kb-ingest-file, paige-eval, pipeline-suggest) now match.
- This is another occurrence of INT-320 (deploy reports success, provider serves stale source). Per the owner ruling it is tracked and fixed on its own, not in this lane. The next `claude.ts` deploy (the provider-failure classification PR) redeploys all four; that deploy gets one readback.
- UNVERIFIED: runtime behaviour (no function was invoked); `openai-responses.ts` is in no bundle, as expected while nothing imports it.

## R7a deploy readback (production, read-only, 2026-10-06)
- #1787 merged as `8b7f9757a`; `edge-live` moved to it. `paige-ai-chat` is v350 (updated 21:49:43Z). `get_edge_function` returned 146 files; **146/146 are byte-identical** (sha256) to the repo at `8b7f9757a`, including `_shared/paige-turn/round.ts` and `route.ts`.
- This proves the deployed SOURCE. Runtime behaviour of the gate on a real cut-off provider round is UNVERIFIED in production (such rounds are rare and cannot be induced safely); it is proven by the end-to-end harness (43.40) and the real-converter check (`test:round-gate`).

## R4: state-first routing in chat, and the R7a review follow-ups
- **The Turn Route is chat's model-selection authority.** `substantiveTurnIntent` (the #34 regex) is gone. `paige-ai-chat` builds the route's facts from server-resolved state — Studio/Live surface, a fingerprint-verified approval, an answer bound to PAIGE's question, INT-332's foreground offer and `offerKind`, attachments — and resolves the route before its first model call. Until the shared streaming fabric lands (R5), the class maps onto the two legacy tiers: cheap → classification tier, everything else → reasoning tier.
- **The turn classifier** (`_shared/paige-turn/classify.ts` pure, `classify-call.ts` IO) runs only where state leaves the decision open (a fresh turn, a reply beside a standing card, an accepted prose step). It reads the message — or, for an accepted offer, the offered STEP (PAIGE's own earlier text, which can name a record) — never the rest of the thread, retrieved Knowledge or tool results; its output is closed enums and a confidence; anything malformed is `null`. It runs on the classification tier (the open-model cheap lane measured 5.6 s mean / 8.9 s p90 over 14 days — too slow for every turn's front door) with a 1.2 s deadline. It is egress, so it starts only after the last pre-egress account check, and the account is checked again after it, before the chat dispatch. On most fresh turns nothing else is awaited between its start and the first model call, so **it adds its own round-trip to the time to first token**: comparable small Haiku calls in production (session-summary, ~200 tokens in / 35 out, 30 days) run p50 840 ms, p90 1.46 s. That is the cost of the cheap-tier saving on light turns; the real `turn-classify` latency is measured from traces after deploy. It is never called on Studio or with an attachment (the floor is already operational). On a timeout or error the route takes its conservative default (operational, governed tools).
- **Independent exact-head review of `56b33dace` — verdict FIX, fixed on this branch:**
  - **B1 (blocking, §9/#1255):** the classifier started BEFORE `revalidateTenantKnowledgeScope()`, so a switched, unresolved or revoked account still sent the person's message (and an accepted step) to the provider before the 409, with a trace billed to the stale tenant. `test:knowledge-scope`: base `8b7f9757a` 423/0 → head 17 failed. Not caught here because that harness was not in the local run set; every CI npm harness is now run before a push. Fixed: the classifier starts after the last pre-egress check (after the deferred document extraction's re-check). The harness answers the classifier apart from scripted rounds, asserts it never egresses on a switched account (12, three cases) and expects its attributed trace row (23.2). 426/0; moving the start back above the check fails exactly the three new assertions.
  - **S4:** no classifier call on Studio or an attachment (the floor is operational whatever it says). **S2:** a bare go-ahead ("do it", "go ahead", "send it") is labelled `act`, never `converse`, so it cannot take the cheap class; pinned in `classify.test.ts` and end to end (43.42e). **S5:** route pins end to end — an approval resume and an accepted act make no classifier call (43.42a/b; calling it unconditionally fails both), a fresh "thanks" is cheap only on the classifier's say-so (43.42c), a failing classifier keeps the reasoning tier (43.42d). **N1/N2:** doc wording corrected.
  - **Round 2 on `a25a0c9f4` — FIX, fixed:** **B2 (blocking, #1255):** the classifier wait became the only awaited step between the pre-egress check and the chat dispatch on an ordinary fresh turn, with no re-check — a switch during it would dispatch the prior account's Knowledge. Fixed: when the classifier ran, the account is re-checked after it and the turn 409s before the dispatch. knowledge-scope 12b (switch at that check: the classifier ran, no chat call, 409); the groups that time switches by persona-call index (13, 16, 17, 18) re-derived for the new post-classifier boundary, not bumped (16.0's per-tool transition moves 5 → 6). 429/0; removing the re-check fails 14 (12b and every re-derived table). **N4:** the overlap the comment promised does not exist on ordinary turns — comment corrected, deadline cut to 1.2 s from production latency, cost stated above.
  - **Carried to R5, stated, not fixed here:** S1 — a cheap round still sends the tool list (the route's tool exposure is applied by R5's narrowing); S3 — the classifier calls Anthropic directly, outside the tenant budget gate (R5 routes it through the fabric).
- **Behaviour change (owner ruling: Haiku is no longer a front-door tool-loop model):** short conversation ("one moment", "thanks") stays on the cheap tier; an accepted act always reaches the reasoning tier; lookups that need the workspace's records move from Haiku to the reasoning tier (Sol after the R7 cutover).
- **R7a review follow-ups (from the independent review of #1787):**
  - **M2 — Live.** After an unfinished round, Live's tools-free closing call is told the step did not run (`LIVE_ROUND_NOT_FINISHED_NOTE`) and the turn is marked INTERRUPTED (the reducer's sticky flag). Harness 26.9; removing both fails exactly 26.9.
  - **M1 — the malformed-arguments refusal, pinned in chat.** 43.41: a finished round's CRM-door call with cut-off arguments reaches no door and the model is told `ARGUMENTS_UNPARSEABLE`. With the refusal switched off the CRM door IS called with `{}` — the exposure the refusal closes.
  - **L4 — route.** An ambiguous offer is capped at read tools whatever the classifier says (PAIGE asks which; she does not act). No fallback after text the person already saw, even when a tool call is proven unexecuted. Removing either fails its test.
- **Proof (fixed head):** Deno `route` + `round` + `classify` 34/0; `test:knowledge-scope` 429/0; `test:client-memory-authz` 941/0 (930 + 43.40 ×4 + 43.41 + 26.9 + 43.42a–e); every other CI npm harness exits 0; `test:round-gate` 30/0; `test:reasoning-tier` 67/0; `test:openai-responses` 84/0; Deno diagnostics on `paige-ai-chat` identical to `main` (10 = 10). Harness mutation: routing on the classifier alone (state ignored) fails 6 end-to-end cases (approval resumes; "sure", "go ahead", "yep 👍" accepting an offer).
- **Carried:** the classifier moves to the fabric's cheap class (Luna first) in R5–R7; the route's tool exposure narrows `toolDefs` in R5 (tracking prompt, tool-definition, cache-write, cache-read and output tokens separately; context compaction is separate work).

- **R4 in production:** merged as `53dbf7eb5` (#1789), deploy-edge-functions run 491 success. `paige-ai-chat` v351: 150/150 files byte-identical to `53dbf7eb5`. Source verified; the `turn-classify` latency and timeout rate are measured from traces once there is traffic (owed).

## R5a: chat's streamed rounds open through the shared Model Fabric (behaviour with OpenAI off unchanged)
- **The fabric** (`_shared/model-fabric.ts` `fabricChatStream`): a cognitive class in, one chat-shaped stream out. Candidates come from the Turn Route's `CLASS_POLICY` in the owner's order (operational: Sol → Sonnet 5.5; frontier: Astra → Sonnet 5.5; cheap: Luna → open pool → Haiku). The open pool does not stream, so it is skipped for chat. The Anthropic candidate goes through the real `gatewayCompat` (budget gate, request shaping and trace unchanged); the OpenAI candidate through `responsesStream` (`store:false`, function tools only, the class's effort).
- **OpenAI stays off for chat.** `OPENAI_CHAT_ENABLED = false` until the controlled Sol canary meets the release bar; turning it on is a reviewed one-line PR, never an environment toggle. With it off, every class is served by Anthropic exactly as before R5: operational and frontier → Sonnet 5.5, cheap → Haiku, and a `deterministic` class that reaches a model → operational.
- **Fallback is narrow** (route.ts `mayFallback`). The next candidate is tried only when the stream never opened AND the failure is proven health: auth/config, billing, rate limit, model unavailable, outage, or a network throw. Never on an invalid request or an unknown failure (that status reaches chat's existing handling unchanged), never once a stream opened, never for a budget stop (rethrown). Failure classes come from `_shared/provider-failure.ts`: status, error type and code, and recognised phrases only; the message text is never kept. Anthropic's credit-balance 400 is named `billing` (task #5). A thrown error is classed by its own type: a missing key (`NeedsConfigError`, now also thrown for a missing Anthropic key) is `auth_config`, a timeout or a fetch `TypeError` is transport, and anything else thrown before a response (a refused tool or content shape, a model off the allow-list) is `unknown` and never falls back.
- **Chat's five streamed rounds** (entry, tool loop, claim correction, continuation, close/Live answer) open through the fabric for the route's class. The claim correction is always `operational` (INT-332). The legacy model labels at those sites are gone; the non-streamed calls are unchanged. Trace tags are unchanged (`chat`, `chat-tool-loop`, `chat-claim-correction`, `chat-continuation`, `chat-close`, `chat-live-answer`). A server log line names the attempts whenever a candidate failed.
- **Every round keeps the governed tool list, the cheap class included** (43.42f). The first head of this PR took tools off cheap rounds, rescued only by the claim correction and the action-intent continuation. The independent review found neither runs on Live, on a client seat, or for a request phrased as a question, so a misread would have lost the step there. Taking tools off a cheap round therefore moves to R5b, which designs that rescue for every surface.
- **Review S3 disposition (classifier outside the budget gate):** no change. The budget contract (`router-budget/mod.ts` `enforceBudget`) returns `allow_gated`, not `block`, for the cheap band at the hard ceiling; the classifier is a cheap-band call.
- **Proof:**

  | Check | Result |
  |---|---|
  | `test:model-fabric` | 80/0 (new) |
  | `test:client-memory-authz` | 943/0 (43.42f: a cheap round keeps its tools; 43.42g: a cheap turn's claim correction runs on the reasoning tier) |
  | `test:knowledge-scope` | 429/0 |
  | Deno `route` + `round` + `classify` + `provider-failure` | 39/0 |
  | Every other CI npm harness | exits 0 |
  | Deno diagnostics on `paige-ai-chat` | 10 → 9, nothing new |

  `test:model-fabric` pins: OpenAI is never called while off; each class gets its Anthropic model; with OpenAI on, Sol/Astra/Luna serve first with `store:false` and the class's effort; fallback happens on 401, 429, insufficient_quota, 503 and a network throw, and does not happen on 400 or an unknown status; the same chat shape reaches the round gate from either provider.

  The diagnostic that went away is the old `Response` cast on the closing call. Bites:
  - Turning OpenAI on fails 19.
  - Always falling back fails 4.
  - Never falling back fails 16.
  - Dropping the extras or the class effort fails 2.
  - Returning a budget stop instead of rethrowing it fails 2.
  - Classing a missing key as an outage fails 1.
  - Running the claim correction on the turn's own class fails 43.42g.
- **Deploy:** `_shared/claude.ts` changes, so the merge redeploys every function that imports it. That includes the four INT-320-stale functions (content-draft, extract-business-credit-report, generate-outreach-draft, growth-funnel-draft); one readback is owed after the deploy.
- **Independent exact-head review of `d30cd850a` — FIX, fixed:**

  | Finding | Severity | Disposition |
  |---|---|---|
  | B1: cheap rounds without tools lose the step on Live, client seats and question-phrased requests, contrary to the records | blocking | Reverted: every round keeps its tools; narrowing and its rescue move to R5b (43.42f pins it) |
  | S1: the budget-stop rethrow was untested | should | Pinned (fabric-check, via a gateway test seam; returning it instead fails 2) |
  | S2: the lift to operational before a claim correction was untested | should | Gone with B1 (no lift needed while every round has tools) |
  | S3: more drift with OpenAI off than stated | should | Gone with B1: with OpenAI off, every round's model and request are as on `main` |
  | S4: a config failure was labelled an outage | should | Fixed: a missing key is `auth_config` (OpenAI and Anthropic), other pre-fetch throws `unknown` |
  | S5: OpenAI-path preconditions | should | Recorded below as release-bar items before `OPENAI_CHAT_ENABLED` turns on |

- **Must close before `OPENAI_CHAT_ENABLED` turns on (review S5, added to the R6/R7 release bar):**
  - **Budget gate:** `responsesStream` has no tenant budget gate; only `gatewayCompat` enforces the daily ceiling. The OpenAI path must apply the same gate.
  - **Adapter refusals:** `toResponsesContent` does not carry a PDF/document part, and the adapter refuses hosted tools; both throw `ProviderToolRefused` before any call, which the fabric classes `unknown` (no fallback). Nothing was sent, so falling back is provably safe. Before the flip, give such a refusal its own fallback-eligible class (or route document turns to Anthropic first) so a document turn is served by Sonnet rather than failing.
- **Side effect of naming a missing Anthropic key:** `claude.ts` now throws `NeedsConfigError`, so `model-router.ts` `callModel` reports its honest `needs_config` for an Anthropic cell with no key, instead of throwing into the frontier fallback. Callers already handle `needs_config`; production has the key, so nothing changes there.
- **Round 2 on `ed7c79801` — SHIP.** The reviewer byte-compared all five rounds against `main` with OpenAI off: every site × every class × a plain and a PDF turn, Studio thinking on and off — 48/48 identical requests. S1 (the claim correction's class was untested) closed by 43.42g; S2 recorded above.
- **Carried:** R5b narrows the tool list by the route's capability and domain, and traces tool-definition tokens separately (prompt, cache-write, cache-read and output are already separate columns); context compaction is separate. R6/R7: the Sol canary to the release bar, the flip, Astra, and the classifier onto the cheap class.
