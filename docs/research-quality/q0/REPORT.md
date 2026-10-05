# INT-322 — Q0 Research Quality Baseline (frozen before-state)

Generated 2026-10-05. Measurement only — nothing in the research system was changed for or by this phase.
Every number below is reproducible from the committed evidence packs and the canonical eval substrate.

---

## A. Current-stack map (the Q0 execution fingerprint, grounded from code)

**Pipeline** (`supabase/functions/paige-deep-research/index.ts`): `strategize (optional) → bounded PLAN → SEARCH → READ → GAP-CHECK loop → rank → validate → ONE synthesis → validateAndBind → persist`.

| Aspect | Current behavior (verbatim from source) |
|---|---|
| Search | POST `paige-web-search` (Firecrawl), service-role; HTTP 404 → `unconfigured` (honest), other errors → empty-for-that-query |
| Read | POST `fetch-url-content` (SSRF-guarded); keeps `READ_BODY_MAX = 6000` chars/page |
| General bounds | `MAX_HOPS=3` (request clamps 1..3, default 2), `MAX_QUERIES_PER_HOP=4`, `MAX_TOTAL_SEARCHES=10`, `MAX_READS=6`, `WALL_CLOCK_MS=60s`, soft `COST_CEILING_USD=0.15` (breaks gathering, still synthesizes) |
| Dossier bounds (entity target) | hops 4 / queries 6 / searches 18 / reads 10 / 90s / $0.10 |
| Internal cost model | search $0.001 · read $0.0005 · cheapLLM $0.002/hop · synthesis $0.03 |
| Authority tiers | T1: `.gov .edu .mil .int` (authority 1.0) · T2: 19-domain allowlist (Reuters, AP, WSJ, FT, NYT, WaPo, BBC, NPR, Nature, Science, WHO, World Bank, OECD, ISO, IEEE, W3C — 0.8) · T5: 17-domain denylist (Pinterest, Quora, Medium, Reddit, social networks… — 0.15) · everything else T4 (0.35) |
| Reliability | `0.45·authority + 0.25·recency + 0.30·corroboration`; recency decays over `freshness_days` (requestable; unknown date = 0.4); corroboration = ≥4 shared content tokens with a DIFFERENT eTLD+1 (1.0, else 0.3) |
| Exclusion | T5 hard-excluded; anything < 0.25 excluded (kept for audit) |
| Gap-check | the PLAN prompt itself: later hops get gathered evidence and return `done:true` or ≤4 NEW queries (never repeats) |
| Contradiction behavior | **none structural** — no dedicated contradiction detection; conflicts only surface if the synthesizer happens to state both sides |
| Synthesis | exactly ONE `doc_draft` routed call = Claude reasoning (`claude-sonnet-5`), temp 0.1, JSON findings `{summary, citations[], …}`; prompt: "state a fact ONLY if it appears in the fetched sources… never invent" |
| validateAndBind | findings with unresolvable/empty citations are DROPPED; name-token checks vs cited text; dossier field checks |
| Stop reasons | `answered / max_hops / budget / wall_clock / no_results / unconfigured / error`; `finalStop` becomes `no_results` when nothing survived validation |
| Routing (`_shared/model-router.ts`) | sensitive kinds → Claude reasoning, never open models · cheap kinds (extract/score/classify/summarize…) → Featherless open model (Claude classification on fallback) · reasoning kinds (incl. `doc_draft`, strategist `reason:strategize`) → Claude reasoning. All calls self-trace to `paige_llm_trace` (provider/model/job_kind/cost) — the engine's own hops currently trace only the strategist row |
| Persistence/readback | service-role INSERT `research_runs`/`research_sources` (INT-309 grants, INSERT-only); saved verdicts only via governed `get_workspace_research_run` |

**Difference from the working mental model**: the loop is PLAN→SEARCH→READ with gap-check FOLDED INTO the plan prompt (no separate gap phase), and there is no contradiction-handling stage at all. That absence is measured below.

## B. Benchmark corpus (`scripts/research-quality/q0-corpus.json`, frozen)

30 cases: 24 development + 6 holdout (1/class). Six classes × 5: fresh_fact, multihop_comparison, high_stakes, contested, insufficient, abundant_insufficient (the 483a5501 canary class). Four answer-classes: answerable (15), contested (5), insufficient (5), judgment (5). Each case carries sub_questions, freshness budget, primary-domain hints, and a tier hint. Holdout is never used for tuning. Authored blind — corpus written before any run.

A correct "I cannot establish this from credible evidence" can and did outscore eloquence: see the insufficiency vector below.

## C. Measurement contract

**Deterministic (no model in the loop; computed in `q0-run.mjs metrics` from the evidence pack):**
- `primary_ratio` — of the CITED sources (those backing ≥1 finding), the share on `.gov/.edu/.mil/.int` or the case's primary_domains.
- `citation_independence` — distinct eTLD+1 among cited sources ÷ cited count.
- `findings_with_citations` — share of findings carrying ≥1 resolvable citation (validateAndBind makes this 1.0 by construction; pinned).
- `newest_cited_age_days` vs the case's freshness budget.
- `empty_findings_rate`, `stop_reason`, source counts (retrieved/included/excluded/cited), `wall_latency_ms`, `trace_cost_usd` (L1 trace estimates), `engine_internal_cost_est_usd` (coverage × the engine's own COST constants).

**Judge (the canonical governed path — `paige-eval` rubric_judge, Claude reasoning `claude-sonnet-5`, temp 0.2, judge_model logged per result, blind to before/after by construction; unscorable → null, never 0):**
- `q0_entailment` (30) — per-finding: does the cited source actually contain the claim?
- `q0_precision` (30) — share of included sources genuinely relevant to the question.
- `q0_completeness` (30) — sub-questions addressed (explicitly-unresolved counts half).
- `q0_contradiction` (5 contested) — does the output surface the disagreement?
- `q0_insufficiency` (10 insufficient+judgment) — does it refuse the unsupported fact?

No aggregate "truth score." The vector is canonical; `baseline.json` carries per-case + per-split aggregates.

**Claim-level**: the engine's findings ARE the claim layer (each carries citations[]); entailment is judged finding-wise. The chat-side R2c classes are out of Q0 scope (accepted separately).

## D. Baseline results

**Development (n=24):** entailment 1.0 (vacuous — see limitations; scored 23/30 corpus-wide) · precision 0.765 (**scored on only 8/24 dev cases** — 16 judge replies unparseable → null, not zero) · completeness **0.354** (29/30 scored corpus-wide) · contradiction **0.25** (5/5) · insufficiency **1.0** (10/10) · primary_ratio 0.449 · independence 0.737 · findings-with-citations 1.0 · **empty-findings rate 0.792** · median latency 56.8s · engine trace cost $0.289 · judge cost $1.78 dev (105 judge calls corpus-wide incl. holdout).

**Holdout (n=6):** precision 0.79 · completeness 0.40 · contradiction **0.0** · insufficiency 1.0 · primary_ratio 0.139 · independence 0.889 · empty-findings 0.667 · median latency 60.1s.

**The headline**: 79% of development cases (19/24) produced **zero validated findings** despite retrieving 15–69 sources each — including trivially answerable ones (F1 federal minimum wage: 25 sources, 0 findings) and **all five high-stakes cases** (IRS dates, SEC accreditation, FDIC limits: 0 findings each). Meanwhile 2 of 5 insufficient-evidence cases DID produce findings (honest ones — the judge scored their refusal behavior 1.0). The system refuses more on answerable questions than on unanswerable ones. **Confound caveat**: 8 of the 10 insufficiency-judged 1.0s arrive via the same empty-findings channel that is itself the dominant failure mode — only S2/S3 behaviorally demonstrated honest insufficiency with content; the insufficiency vector conflates "refused correctly" with "returned nothing at all."

## E. Raw-evidence location

- Immutable per-case packs: `docs/research-quality/q0/evidence/<ID>.json` (question, config, engine head at run, HTTP status, wall latency, full engine result, L1 trace rows). Append-only: a re-run writes `<ID>.r<ts>.json`, never overwrites.
- Aggregates: `docs/research-quality/q0/baseline.json`.
- Canonical judge records: `paige_eval_dataset` (`target_ref = q0_*-v1`), `paige_eval_case` (input = engine output, rubric per metric), `paige_eval_run` / `paige_eval_result` (score, status, judge_model, cost) — all under the synthetic proof tenant `7e700000-…`.

## F. Failure taxonomy (from the measured evidence)

1. **Validation-collapse (dominant)** — sources retrieved, synthesis either refuses or everything fails validateAndBind → `no_results`. 19/24 dev cases. Evidence: every F/M/H case pack with `stop_reason: no_results` and 15–69 sources.
2. **High-stakes total refusal** — all 5 H-class cases empty. The stricter the question, the more likely zero findings.
3. **Contradiction blindness** — 4/5 contested cases returned nothing to surface; the one that surfaced (C2, in-flight-fatality counts) scored 1.0, proving the ceiling is reachable.
4. **Completeness collapse** — 0.354: sub-questions unanswered mostly because findings never formed (not partial answers).
5. **Primary-source under-citation** — holdout primary_ratio 0.139: even when citing, the engine cites mostly T4 (0.35-authority) domains.
6. **Judge-harness limitation (honest)** — entailment scored 1.0 vacuously on empty runs, and the judge's `max_tokens=500` degraded finding-wise entailment on the 7 finding-bearing runs (7 degraded, 23 vacuous-scored): Q0 could not deeply audit entailment where findings existed. Fixing the judge budget is a harness change for the NEXT measurement, not an engine change.

## G. Top bottlenecks (measured, ranked)

1. **The synthesis→validation seam** — one doc_draft call with a "state only what's in sources" prompt + a hard validateAndBind gate, over 6k-char page slices: the pipe refuses nearly everything answerable. Highest leverage by an order of magnitude (79% of all failure).
2. **No contradiction stage** — nothing structural searches for or reconciles conflicting sources (0.25/0.0).
3. **Primary-source discovery** — ranking is fine; the cited mix skews T4 (0.139–0.449).
4. **Freshness capture** — `published_at` often unknown (recency 0.4 floor) — freshness metric itself was mostly null (few cited sources with dates).

## H. R3 recommendation (not implemented — for owner review)

Make the **research dossier inspectable at the seam where Q0 says the quality is lost**: extend the canonical `research_runs` record (no second store) with the per-hop research trace — planned queries, what was read, and for each candidate finding the validateAndBind verdict (accepted / dropped + why). That single R3 slice (a) gives the owner visible evidence of what Paige attempted, (b) directly diagnoses the 79% collapse with per-claim drop reasons — the input every later fix (R4 retrieval, R5 evidence quality) will be measured against, and (c) needs no schema redesign beyond additive columns on the existing tables. Judge `max_tokens` raise for finding-wise entailment should ride the same slice so the next benchmark actually audits entailment.

---
*Phase discipline: no retrieval, scoring, prompt, synthesis, routing, budget, or threshold was altered during Q0. The engine ran as deployed; the harness only called it and measured.*
