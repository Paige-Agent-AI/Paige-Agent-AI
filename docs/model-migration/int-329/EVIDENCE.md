# INT-329: Claude reasoning tier, Sonnet 5 → Sonnet 5.5 (evidence record)

**Sequencing.** GitHub dispatches a workflow only from the default branch, so the A/B gate has to land before the switch it gates.
- **Part 1, PR #1772:** the seam, trace truth, the gate and the `model-ab` workflow. The model stays `claude-sonnet-5`.
- **Part 2:** the one-line flip of `CLAUDE_REASONING`, merged only after a GO.

Each entry names its evidence class: **automated** (a script that runs), **static** (typecheck or build), **deployed-runtime (preview)**, **production read-only** (a query against prod), or **UNVERIFIED** (with the reason).

## 1. The seam

`supabase/functions/_shared/claude-models.ts` holds `CLAUDE_REASONING` and `CLAUDE_CLASSIFICATION`. It is the only place a Claude model id is chosen. `claude.ts` re-exports both constants, and `model-allowlist.ts` derives its Anthropic ids from them.

Every reasoning-tier entry point resolves through `tierModel()`:

| Entry point | How it resolves |
|---|---|
| `callClaude` | default tier |
| `chatCompletionCompat` / `gatewayCompat` | legacy label → tier, plus the PDF upgrade |
| `routedChatCompletion` | job kind → tier |
| `callModel` text/vision frontier | `claudeText` |

The full consumer map, about 45 call sites, is in the PR description.

## 2. Characterization gate: `npm run test:reasoning-tier` (automated, wired into CI)

The gate drives the real seams under the repo's Node loader, with a recording fake Anthropic and a recording fake Supabase.

| Run | Result |
|---|---|
| Head, constant `claude-sonnet-5` (part 1) | **67 passed, 0 failed** |
| Head, constant `claude-sonnet-5-5` (the part-2 state) | **67 passed, 0 failed** |
| Base seam `66d16b6` (a 63-check version of the gate, plus the data-only `claude-models.ts`; every other line base) | **52 passed, 11 failed** |
| Earlier cutover-shaped dry run (constant flipped back, nothing else) | 63/0, plus token-pricing 22/0, trace-wiring 20/0, client-memory-authz 813/0, knowledge-scope 423/0 |

The 11 base failures are all trace-truth or stop-reason defects:
- 1.5, 3.5, 3.8: the requested alias is traced instead of the served id.
- 4.3: the legacy `google/gemini-2.5-flash-lite` label is traced.
- 5.4, 5.6, 5b.1: `null` model on failure.
- 5.5: a Claude failure is blamed on the skipped Featherless model.
- 5b.3: `null` on the fallback row.
- 5c.1, 5c.3: refusal and `max_tokens` are invisible.

The rollback dry run means the documented one-line rollback keeps CI green.

**Equivalence oracle.** For 9 paths, the request body is byte-identical to `fixtures/request-bodies.json` apart from `model`. That fixture was frozen on the base commit and independently regenerated there by the adversarial reviewer (empty diff).

**Planted defects, each caught (§71.4).** Each was introduced, run, and restored:

| Planted defect | Checks that fail |
|---|---|
| `thinking: {type:"disabled"}` added to the stream request | 3.4, 6.3, 8.gateway_stream_* |
| Sampling regex no longer matches `sonnet-5-5` | 1.2, 2.3, 6.1, 8.callClaude_default, 8.compat_pro_tools, 8.routed_doc_draft |
| Forced-tool clamp removed | 1.6, 6.2 |
| Router catch blames the open model again | 5.5, 5.6 |
| Stop metadata dropped by the trace allowlist | 5c.1, 5c.3 |
| Malformed-body guard removed | 4.4 ×3 |
| Streamed trace back to the requested id | 3.5, 3.8 |
| callModel failure trace back to null | 5b.1 |
| `claudeText` drops the stop reason | 5c.4 |
| Stream trace invents `end_turn` | 5c.5 |

## 3. Static

`deno check` (Deno 2.9):
- `_shared/claude.ts`, `model-router.ts`, `model-allowlist.ts`: exit 0.
- `paige-ai-chat`, `paige-deep-research`, `growth-page-draft`: identical pre-existing diagnostics on base and head (10, 3 and 1), all in files this change does not touch.
- CI's Deno ratchet grades all 48 affected functions on the PR. The set includes `paige-live-relay`; its redeploy can end a Live session that is open at that moment (pre-launch, no live customers).

## 4. Deployed runtime (preview project `jgcqxruqwqnmzfhnmsbh`, commit `ef99e62`, 2026-10-06 13:09 UTC)

The Supabase preview branch deployed `ef99e62`, the pre-split commit whose constant was `claude-sonnet-5-5`. This is evidence for the failure-trace mechanism, not for the code at the merge head. The preview project has no `ANTHROPIC_API_KEY`, so **no model call happened there**.

One anonymous `paige-public-chat` turn on the synthetic `test-tenant-189-verification` produced:
- the honest 502 `assistant_unavailable`;
- a trace row with `provider = anthropic`, `model = claude-sonnet-5-5`, `status = error`.

On the base code, that routed failure row records `model = null`.

To open the public-chat gate, the probe used one published `growth_pages` row on the preview database. That row is now set back to `draft` with no blocks, which closes the gate again. The delete itself times out on the preview, so the row will be removed when the preview branch is torn down.

## 5. Production, read-only (prod `xygzykjyynhzqytbqnzu`, 14 days to 2026-10-06)

Sonnet 5 baseline by `job_kind`: n, errors, p50/p95 latency, tokens, cache. The table is in the PR description.

Trace-truth defects present on prod:
- 41 Anthropic rows with `model = null`.
- 2 rows labelled `google/gemini-2.5-flash-lite`.

The Anthropic 400 burst on 2026-10-05 from 22:06 to 22:12 UTC hit `chat`, `thread-summary-fold`, `reason:strategize` and `doc_draft` alike. Every failure returned an identical 234-byte `invalid_request_error` body. That pattern points to an account-level or provider-side cause, not a Deep Research request shape.

INT-322's clean R4 re-drive was running on Sonnet 5 at 12:00 UTC on 2026-10-06: 16 `doc_draft` calls that hour.

## 6. Frozen A/B: `npm run ab:sonnet` (cloud: the `model-ab` workflow, dispatch only)

**What is real:**
- the shipped gateway translation (stream and non-stream);
- the `doc_draft` routing;
- the trace rows;
- the provider's own stop reasons, refusals and thinking blocks, read at the transport.

**What is harness-authored:** the tool loop, the system prompt, the tool definitions and their frozen results. Case 8 is a C4-shaped transcript; it does not run the server's C4 resume path.

There are 15 cases and a pre-registered GO/NO-GO rule. The candidate is GO only if all of these hold:
- completion is no more than 5 points below baseline;
- zero refusals;
- zero `max_tokens` stops;
- errors are no higher than baseline;
- cost per completed objective is at most 1.15× baseline;
- p95 latency is at most 1.25× baseline;
- the cache is still read.

Verified with `--mock` only:
- Clean mock: 15/15 on both arms.
- `MOCK_FAULTS=2`: the candidate's stream dies partway through. The run survives; the case is counted as a failure plus a provider error; the report and a per-case partial file are written; exit is 0.
- `--reps abc` and a single distinct arm are each refused before any spend.
- The narration count is reported but deliberately not scored. Whether quieter "thought" steps are acceptable is the owner's call.
- `MOCK_FAULTS=1`: the candidate's refusal (with its category), 9 thinking blocks, and between-tool narration falling from 180 to 0 characters are all reported. The rule fails on completion and on refusal.

**UNVERIFIED:** every live A/B number. The run needs PAIGE's own Anthropic key, which is in neither the build sandbox, any workflow, nor the preview project.

Once part 1 is on `main`, run it two ways:
- the `model-ab` workflow: add the `PAIGE_ANTHROPIC_AB_KEY` secret, then dispatch it with `arms=claude-sonnet-5,claude-sonnet-5-5`;
- or `npm run ab:sonnet` wherever that key lives.

## 7. Owed before and after cutover

1. INT-322's clean R4 Sonnet 5 capture. The part-1 merge is held until it lands, so `paige-deep-research` is not redeployed mid-drive; its requests are byte-identical, but a redeploy can still disturb an in-flight run.
2. Merge part 1. Then:
   - read back the served bundles;
   - confirm prod traces now carry served ids and `stop_reason`;
   - confirm the null-model rows stop appearing.
3. The live A/B (`model-ab`), GO under the pre-registered rule. Include a small Deep Research compatibility smoke (dev cases, not the holdout).
4. Part 2: the one-line flip. Merge it, then verify:
   - provider-served bundles for `paige-ai-chat`, `paige-deep-research` and a sample of the 48 affected functions;
   - the first production `claude-sonnet-5-5` trace;
   - one tool round;
   - a non-zero cache read;
   - 4xx/5xx rates against the baseline.
5. An authenticated drive of one real C4 resume on 5.5.

Cutover notes:
- Caches are per model, so the first turns after cutover (or after a rollback) rewrite their prefixes.
- Prompts of 512–1023 tokens newly cache on 5.5, which means writes at 1.25× and then reads at 0.1×.
- The eval judge also moves to 5.5, so eval scores before and after cutover are not directly comparable. `judge_model` is logged per result.
