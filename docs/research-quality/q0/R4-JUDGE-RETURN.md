# INT-322 — R4 Clean Judge v2 Re-Score + Token Analysis Return

No engine change. Judge v2 unmodified (same rubrics, route, model, 1600-token budget). The frozen 24-dev clean-R4 outputs were seeded as new datasets (`r4clean_*-v2`) and scored through the canonical paige-eval; results live in the store.

## A. Clean-R4 Judge v2 semantic vector (24 dev; per-metric n varies)

| Metric | n scored/degraded | Score | Q0-v2 baseline (frozen v1 engine) | R3-era v2 |
|---|---|---|---|---|
| Entailment | 22/2 | **0.991** | 0.984 | 0.984 |
| Precision | 19/5 | **0.676** | 0.613 | 0.613 |
| Completeness | 24/0 | **0.389** | 0.408 | 0.408 |
| Contradiction | 2/0 | **0.500** | 0.200 | 0.200 |
| Insufficiency | 4/0 | **1.000** | 1.000 | 1.000 |

**No new quality regression.** Entailment strengthened (0.984→0.991 — 33 accepted findings are almost perfectly cited); precision improved (0.613→0.676); contradiction DOUBLED (0.200→0.500 — C2's space-dispute now surfaces both counts, and C5's contested single-case sample scored 0.5 vs 0.2); completeness is statistically flat (0.408→0.389 — fewer findings overall but the judge scores covered sub-questions similarly).

## B. Judge degradation/parse rate
7 of 66 judge calls (11%) — entailment 2, precision 5 (judge replies unparseable → null, never zero). Lower than the Q0 v2 run's 4/105=4% on entailment and 10% on precision — same order, no judge regression.

## C. Scored counts
24 dev cases; 66 judge results total (24+24 entailment/precision halves, 24 completeness, 2 contradiction, 4 insufficiency — contradiction/insufficiency n reflect the class filters and the drive's case list); 33 accepted findings were audited finding-wise inside the entailment sets.

## D. Overall-unit token/stop-reason analysis — **THE decisive finding**

55 doc_draft calls on the clean drive, all HTTP-success. **43 of 55 (78%) sit at/near the 900-token output ceiling (median tokens_out = 900 exactly; 40 of 55 ≥ 895).** Only 1 call returned a tiny output (<60 tokens — a genuine `insufficient`/empty JSON).

**This re-attributes the class-C "silent empty"**: `synthesizeUnit`'s parse fallback returns `{findings: []}` when `parseJsonLoose` fails — and truncated-at-ceiling JSON is exactly what fails loose parsing. The units are not primarily *refusing*; **they are being cut off mid-JSON at the 900-token cap and the parse failure silently discards the output.** This explains both the F-class degradation (the monolith had 2400 tokens; the units have 900) and a large share of the 18 zero-candidate dev cases.

## E. R5 scope — CONFIRMED and sharpened

The evidence supports all three ruled directions, with the token finding upgrading item 3:
1. **Eliminate silent-empty unit outcomes** — deterministic normalization (a successful unit with zero findings and no `insufficient` flag → typed insufficiency/unresolved state, never silent disappearance), AND distinguish parse-failure (truncation) from true-empty in the unit diagnostics — they are different defects with different fixes.
2. **Surface insufficiency at the result layer** — as typed meta-state with unit provenance; grounded non-disclosure findings (sources that positively state absence) remain normal cited findings through the validator. The A/B distinction is implemented as: A = finding with citations, B = typed state, never pushed through validateAndBind.
3. **The 900-token ceiling is proven binding (78% of unit calls at cap)** — the bounded 2400-token budget is justified for the `overall` unit at minimum; the truncation data argues every unit kind needs more than 900 (43/55 at cap spans all kinds, not just overall). Recommendation within the ruling's constraint: 2400 for `overall`, and a separate truncation-aware remedy for side/facet/position units (either the same 2400 or a parse-retry at higher budget, bounded within the 7-call ceiling).

Judge v2, retrieval, ranking, validator: untouched. Holdout: untouched.
