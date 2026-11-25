# Model comparison groundwork — Auto vs explicit vs hybrid (all non-GPT)

Status: RESEARCH BASIS for the owner's model comparison (MF-OWNER-2026-11-23 §3). The interim
routing is OpenRouter Auto (`openrouter/auto`, GPT excluded via the `auto-router` plugin); this
document records the broad catalog research and the decision frame the comparison must close.
It is NOT the comparison result: the deciding evidence is PAIGE Intelligence evaluation on real
PAIGE workloads (PO-EXP27 owns evaluation; PO-EXP25 owns the routing implementation), the live
trace ledger on the Auto posture, and the owner's final selection.

## 1. The three routes the owner asked compared

1. **OpenRouter Auto with enforceable eligibility** — the interim posture. One candidate per
   class; OpenRouter's Jev-powered router picks the model + reasoning effort per request from
   the pool our exclusions leave (GPT excluded via `excluded_models: ["openai/*"]` on the
   `auto-router` plugin). `cost_tier` (low/medium/high) selects the routing policy; account-level
   Routing-page defaults (saved exclusions + "prevent overrides") are an owner-side control.
2. **Explicit selection of qualified non-GPT models** — PAIGE pins one model id per class
   (`openrouter-models.ts` is the one home), chosen on measured PAIGE-workload quality, latency,
   tool continuation and cost per successful outcome.
3. **Hybrid** — Auto for a band (e.g. cheap/operational) plus explicit pins where measurement
   shows a specific model wins (e.g. document-bearing turns, or a qualified frontier model).

## 2. Published benchmark context (openrouter.ai/benchmarks/routers, run 2026-11-21)

Honest caveats first: (a) these grade SWE/terminal/vision/banking agent tasks, not PAIGE's
CRM/business-assistant workloads; (b) Auto's benchmarked pool INCLUDES GPT models — our
`openai/*` exclusion narrows that pool, so published Auto numbers are context, not our
configuration's forecast; (c) the owner's rule stands: published benchmarks alone are
insufficient — the deciding evidence is measured PAIGE workloads.

With that said, the published frontier (quality 0-10 vs cost/task):

- **Auto (Medium tier): 9.3 quality @ $0.58/task** — behind only Auto Code (9.8 @ $1.64, coding-
  tuned) and Gemini 4 Carbon high (9.9 @ $4.11) among listed entries.
- **Tau3 Banking — the closest published analog to PAIGE's business-tool work: Auto (Medium) is
  BEST IN BENCHMARK at 53.1% @ $0.60/task ($1.13/success)**, ahead of Kimi K3.1 Pro high (54.6%
  appears first on quality but at 4.6x tasks' cost — read the frontier, not one cell).
- Deep SWE: Auto 69.0% @ $0.57; SWE Atlas QA: 59.7% @ $0.36; MMMU Pro Vision: 80.1% @ $0.020;
  Terminal Bench 4.0: 45.7% @ $1.33.
- Strong single-model (non-GPT) baselines for the explicit/hybrid options: GLM 5.3 Flash
  (Deep SWE 84.6% @ $0.20/task — best Deep SWE entry), Kimi K3.1 Pro high (Deep SWE 77.9%,
  Tau3 54.6%, MMMU 81.8%), DeepSeek v4.1 Flash (Deep SWE 77.5%), Gemini 4 Neon/Argon/Carbon
  (SWE Atlas QA 71.8/58.9/67.7%, MMMU 87.0/84.2), Claude Opus 5.5 high (9.1 quality @ $6.43/task).

## 3. Non-GPT candidate catalog (GET /api/v1/models receipt, 2026-11-24; $/M tokens in+out)

All through OpenRouter (the exclusive gateway). List prices; live prices and cache behavior vary
by provider endpoint.

- **Cheap band (classification, light drafting):**
  `z-ai/glm-5.3-flash` ($0.07/$0.38, 1M ctx) · `anthropic/claude-haiku-5.5` ($0.10/$0.50, 1M) ·
  `google/gemini-3.1-flash-lite` ($0.25/$1.5) · `deepseek/deepseek-v4-flash` ($0.09/$0.18, 1M) ·
  `qwen/qwen3.5-flash-02-23` ($0.065/$0.26, 1M) · `inclusionai/ling-3.0-flash` ($0.06/$0.18) ·
  `z-ai/glm-4.7-flash` ($0.06/$0.40).
- **Operational band (tool-bearing conversations, business reasoning):**
  `moonshotai/kimi-k3` ($0.19/$16) and `kimi-k3.1-pro` ($0.24/$8.40, 1M) · `z-ai/glm-5.3`
  ($0.07/$1.40, 1M) and `glm-5.3-prime` ($1.68/$5.28) · `deepseek/deepseek-v4.1-flash` family ·
  `google/gemini-4-neon` ($1.50/$7.50, 1M) · `anthropic/claude-sonnet-5.5` ($2/$10, 1M) ·
  `qwen/qwen3.8-max` family ($2/$6, 1M) · `minimax-m3.1-flash` ($0.15/$0.60).
- **Frontier band (hardest reasoning, long-horizon, large documents):**
  `google/gemini-4-carbon` ($2/$10, 1M) · `gemini-4-argon` ($2/$10) · `anthropic/claude-opus-5.5`
  ($4/$20, 1M) · `moonshotai/kimi-k3.1-pro` (high) · `z-ai/glm-5.3-prime` · `qwen/qwen3.8-max-prime`
  ($4/$12) · `x-ai/grok-4.7` ($2/$6, 500K).
- **Document-bearing candidates (the P1 open capability restoration):** Claude models document
  PDFs natively; Gemini models are multimodal; GLM 4.6V/5V are vision-capable. What must be
  proven before ANY is pinned: the document part translation on OpenRouter's Responses wire for
  the chosen id (the PAIGE adapter currently refuses document parts by design — the truthful
  refusal stays until a live document-bearing request through OpenRouter is proven end to end).
- Routers (context for the hybrid option): `openrouter/auto` (the interim), `openrouter/auto-code`
  (coding-tuned), `openrouter/pareto-code`, `nvidia/switchyard` (stage-switching), `~unbiased/pareto-*`.

## 4. What closes the decision (the evaluation the owner mandated)

PAIGE Intelligence (PO-EXP27) + the routing implementation owner (PO-EXP25) measure on actual
representative PAIGE workloads — routine drafting, business reasoning, document-bearing requests,
realistic tool-bearing conversations, and recovery behavior:

1. **Live Auto trace ledger** (needs Supabase up + the deployed interim): requested vs served
   model per turn, reasoning effort Auto chose, latency, cache hits, `usage.cost`, honest cost
   basis, failure/interruption rates, and which models Auto actually picks per class of work.
2. **Workload evaluation**: instruction adherence, tool selection + continuation reliability,
   refusal/uncertainty honesty, business-reasoning quality — through the existing PAIGE
   Intelligence evaluation infrastructure (no new engine).
3. **Document-bearing qualification** (the P1 open gap): a live PDF-bearing request through
   OpenRouter to the candidate document-capable model, then adapter translation + pins.
4. **Cost per successful outcome**, not cost per token: the trace ledger + the benchmarks'
   cost/success column are the pattern; PAIGE's own completed-outcome accounting is the deciding
   number the owner directed.
5. **Recovery behavior**: 402/rate-limit/outage handling on each candidate (the closed-code
   subtype diagnostics from #3395/#3400 give the classification), plus honest interruption.

## 5. The decision rule the evidence feeds

If Auto (with our exclusions) reliably enforces eligibility and wins on measured
quality-per-completed-PAIGE-outcome at acceptable latency/cost, it stays (possibly with
`cost_tier` tuned per band). If a specific qualified non-GPT model measurably wins a band or the
document-bearing case, PAIGE pins it explicitly (option 2) or splits bands (option 3). The
pinned rubric judge's migration to an OpenRouter-served model is a separate owner/PO-EXP27
instrument decision, preserved unchanged meanwhile.

Sources: GET https://openrouter.ai/api/v1/models (2026-11-24, full non-GPT listing receipt);
https://openrouter.ai/benchmarks/routers (run 2026-11-21); Auto Router docs (plugin-form
exclusions, cost tiers, account defaults); this file is the routing-side research input — the
evaluation runs through PAIGE Intelligence's existing infrastructure.
