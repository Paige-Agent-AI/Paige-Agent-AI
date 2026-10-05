# INT-322 — R4 Exit Package (decomposed claim formation)

PR #1765 merged as `5040980cd` (edge-live). 67/67 tests; review round landed (P1 number-aware dedupe, P2 phase deadline, P2 one-sided-plan guard). Validator/retrieval untouched — causal purity verified by the reviewer function-by-function.

## A. Flow-by-Flow
question → (unchanged PLAN/SEARCH/READ) → citable set → **planSynthesisUnits** (one extract-tier call; answer-coverage units, NOT search queries; kinds overall/side/relation/facet/position/insufficiency; deterministic one-sided/single-position guard; parse failure → single overall = pre-R4 shape) → **synthesizeUnit** per unit (SAME grounding prompt + doc_draft route; 900-token budget; insufficient flag; conflict rule: separate cited findings, no consensus) in bounded lanes of 3, hard ceiling ≤7 calls, phase deadline (t0 + gathering + 110s) → **aggregateUnits** (deterministic; sameClaim = prose-Jaccard ≥0.8 AND numeric-fingerprint AND values equality — differing numbers NEVER merge) → **validateAndBind UNCHANGED** → persist (dossier gains units[]).

## B. Unit contract
unit_id / objective / coverage_kind ∈ {overall, side, relation, facet, position, insufficiency} / source_refs / status + diagnostics: synthesis_returned, insufficient, candidates_emitted, aggregated, deduped_away.

## C. Implementation: PR #1765, merged 5040980cd, edge deployed.

## D. Dev-only before/after (24 dev cases each drive; R3 = before)

| Metric | R3 (before) | R4 (after) |
|---|---|---|
| zero-candidate rate (all runs) | 18/27 = 67% | 21/27 = 78% — **but 9 are transport errors** (see F) |
| zero-candidate (excluding errors) | 67% | 12/18 = 67% |
| candidates → accepted | 97 → 89 (92%) | 42 → 37 (88%) |
| multi-unit runs | 0 | 16 |
| M-class (comparisons) | 0/5 produced findings | **M1: 20 findings, M3: 8** (M2/M4 zero) |
| H-class | 0/5 | H5: 4 (H1-H4 zero) |
| C/S/A classes | 0 | 0 |

**The causal question's honest answer: decomposed synthesis WORKS where units actually ran — the previously-always-empty Ireland/Singapore comparison produced 20 validated findings — but it did not yet materially reduce the overall zero-candidate rate, and it introduced a new failure mode.**

## E. Q0-v2 semantic before/after: not yet re-judged (the after-drive's findings are too few/clustered to re-score meaningfully before fixing F; the v2 baseline stands ready).

## F. The new failure mode (top remaining issue)
From 22:06 onward the drive sustained **11 instant Anthropic 400 invalid_request rejections** (100-650ms latencies, 3-at-a-time lane bursts) — 9 runs died on the all-units-failed path (`stop_reason: error`). Root cause not yet diagnosed (suspects: provider throttling returning 400 under R4's ~5-7x call volume, or a request-shape edge the burst exposes). This is the #1 fix candidate.

## G. Impeccable: engine-surface only this slice (detector exit 0). The one-answer experience: M1's 20 findings arrive as ONE result — coherent aggregation is structural (dedupe + one result payload); the Chat card renders them as one card. Full UX inspection owed when Chat-side surfacing lands.

## H. Remaining failure taxonomy (measured)
1. Provider 400 bursts in the unit phase (9 runs) — reliability, new in R4.
2. Contested/S/A classes still zero-candidate — the units plan but unit calls return empty or the run errored before synthesis; per-case dossier inspection (now persisted) is the next diagnostic.
3. Latency up (~45-77s vs ~57s median) with the multi-call phase.

## I. R5 recommendation
**Fix reliability before quality**: (1) diagnose/pace the unit-phase 400s (retry-with-backoff on 400 bursts, or lane pacing to 1 with the deadline already in place); (2) then inspect the persisted units[] dossiers per remaining zero-candidate case to see whether the unit planner emitted the right obligations and what the units returned — that inspection, not more architecture, determines whether R5 targets the unit prompts or moves to the evidence-quality engine as ruled.

**Stopping here per the ruling. No R5 work without owner review.**
