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
- **Automated:** `npm run test:openai-responses` gives 83/0 (after review round 2), through the real adapter with an injected transport and the recording fake Supabase. It is wired into CI. Eleven planted defects were each caught:
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

**Carried to R5–R7:** the stream can finish with `length` or `content_filter`. `paige-ai-chat` treats any `finish_reason` as finished (index.ts ~9648, ~16757), so a refusal or a truncation must be surfaced when the seam is wired.
