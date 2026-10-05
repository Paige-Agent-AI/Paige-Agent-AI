# INT-322 — R3 Exit Package (the inspectable research dossier)

Delivered 2026-10-05. PR #1759 merged as `3acad14c3`; migration `20270588000000` applied (the `dossier` column is live in production); edge redeployed; the corrected judge (rubric_judge_v2) is live. **No retrieval/ranking/threshold/prompt/routing change was made anywhere in this slice** — R3 was instrumentation, and the engine's substantive outputs are proven unchanged (behavioral deep-equal test, 32/32 with the M0 contract suite).

---

## A. Flow-by-Flow map of the instrumented lifecycle

The grounded Q0 map (REPORT.md §A) now carries these capture points:

```
strategize (traced, L1) 
→ HOP LOOP (per hop, captured):
    PLAN (llm|entity)      → planned_queries
    SEARCH (Firecrawl)     → searches_run, search_hits_added
    READ (fetch-url-content) → reads_selected / reads_content_ok / reads_empty
    budget snapshot        → {searches, reads, cost_usd_est, elapsed_ms}
→ rank (unchanged) → citable set
→ SYNTHESIS (one doc_draft)  → synthesis.returned + synthesis.candidates
→ validateAndBind (captured) → per candidate: cid, summary(240), citations_emitted,
    resolved, unresolved[ref+reason], checks{name_grounded, website, phone, values},
    outcome accepted|dropped, drop_reason (canonical taxonomy)
→ persist (research_runs.dossier, one bounded jsonb; NULL pre-R3)
```

## B. Schema/contract change

One additive nullable `dossier jsonb` on `research_runs` (migration 20270588000000 + column comment). No second store, no fetched-body duplication (research_sources owns source identity), no grants/policy change, no fork: the dossier rides the canonical record through the same persist path, and the M0 governed read RPC does NOT expose it (explicit field list — the dossier stays service-role diagnostic, so rejected candidates can never reach a user as findings).

## C. Candidate/drop taxonomy (derived from the ACTUAL validator branches)

`citation_missing` (no citations field) · `citation_empty` (array empty) · `citation_unresolvable` (refs emitted, none resolve; per-ref `index_out_of_range`) · `name_token_mismatch` (entity name not grounded in any cited source) · `contact_unverified_strict` (strict mode: name ok, every claimed contact vector failed). Accepted rows carry per-check verdicts. 64-candidate cap with truncation flag.

## D. 24-development-case diagnostic results (fresh drive, holdout untouched)

27 instrumented runs total (24 dev + F1 re-smoke + 2 warmups). Full data: `r3-drive-diagnostics.json`.

| Measure | Result |
|---|---|
| Runs where synthesis RETURNED but produced **zero candidate findings** | **18/27 (67%)** |
| Runs where synthesis produced candidates | 9/27 — acceptance rate **92%** (89/97 accepted) |
| Total candidates / accepted / dropped | 97 / 89 / 8 (drop rate 8.2%) |
| Drop reasons | `name_token_mismatch` ×8 — the ONLY validator drops; zero citation_missing/empty/unresolvable, zero contact drops |
| Synthesis call failures (returned=false) | 0/27 |
| Gathering health on zero-candidate runs | 516 search hits added, 91 reads with content across 37 hops — retrieval and reads are NOT the failure |

**Which questions get candidates**: simple lookups (minimum wage, FDIC limit, WHO PM2.5, stamp price, most-valuable-company, space-flight deaths) — plus, notably, the two private-company no-answer cases (S1/S2: the model produced "no reliable figure exists" findings, accepted). **Which get zero candidates**: every comparison (M1-M5), every multi-part high-stakes regulatory question (H1/H2/H4/H5), every contested case (C1/C3/C4/C5), and the judgment cases (A1-A3). 

## E. Top actual causes of the validation collapse (measured)

1. **The collapse is NOT validation.** The binder rejected only 8 of 97 candidates (8.2%), all name-token mismatches. Citation formatting/identity broke NOTHING (0 citation_missing/empty/unresolvable).
2. **The collapse is synthesis refusal under the current single-call contract**: on 67% of runs the doc_draft call returns an EMPTY findings array despite healthy evidence (516 hits, 91 good reads on those very runs). The strict "state a fact ONLY if it appears in the fetched sources / never invent" prompt with a single monolithic JSON response makes the model emit nothing exactly on multi-part, comparative, and contested questions — the classes where a complete, safely-citable single statement is hardest to compose.
3. Secondary: ~20% of reads return empty content (paywalled/blocked pages) — a visibility gap the dossier now exposes per hop, but not the driver of emptiness.

**Answer to the ruling's question: the 79% collapse is "synthesis did not produce claims" — not "synthesis produced good claims but the binder rejected them" and not "citation formatting broke otherwise-valid claims."** (Run-to-run variance exists — F1 produced 15 findings this drive after 0 in Q0 — but the class pattern is identical: comparisons and multi-part regulatory questions reliably produce zero candidates.)

## F. Corrected judge-harness results over the frozen Q0 evidence (v1 preserved untouched)

Judge: `rubric_judge_v2` — identical rubric/route/model (claude-sonnet-5, reasoning tier); ONLY the output budget changed 500→1600 tokens; scorer name stamped. Q0's v1 records are untouched; v2 results live in the canonical store as separate datasets.

| Metric (corpus-wide, n=30) | v1 (500-tok) scored/degraded (avg) | v2 (1600-tok) scored/degraded (avg) |
|---|---|---|
| Entailment | 23 / 7 (1.000) | 29 / 1 (**0.984**) |
| Precision | 11 / 19 (0.772) | 27 / 3 (**0.613** — halves a/b: 0.719/0.502) |
| Completeness | 29 / 1 (0.362) | 30 / 0 (**0.408**) |
| Contradiction | 5 / 0 (0.200) | 5 / 0 (0.200) |
| Insufficiency | 10 / 0 (1.000) | 10 / 0 (1.000) |

Parse/degradation rate: precision **63% → 10%**, entailment **23% → 3%**, completeness **3% → 0%**. Nulls remain null; no zero-coercion anywhere. The v1 "entailment 1.0" was partly vacuous (empty-findings defaults); v2's 0.984 is over real per-finding audits. The semantic baseline for R4+ comparison is the v2 row. (v2 judge cost: ~$2.1 corpus-wide, recorded per-result in the store.)

## G. Impeccable review

Detector: exit 0 on all changed surfaces. Product-experience assessment of the inspectability itself: a developer reading one dossier can now answer the ruling's question top-to-bottom WITHOUT logs — hops show what was planned/searched/read and what each read returned; the synthesis block shows whether the model produced candidates at all; each candidate shows its citations (emitted vs resolved), every check verdict, and the exact machine reason it died. Rejected candidates are structurally separate from findings (different layer, never in the findings array) and are NOT exposed through the governed read RPCs — they can never visually masquerade as established facts. Future Solo-surface exposure (if ever authorized) must preserve the five-way distinction: searched / read / candidate / rejected / validated finding.

## H. R4 recommendation (measured, not intuited)

**Target the synthesis seam — the single monolithic doc_draft call that returns nothing on comparative/multi-part questions.** Concretely: move to per-sub-question or per-claim synthesis (the planner already decomposes; each hop's gap list names the sub-goals), so the model composes many small, safely-citable statements instead of one giant JSON it abandons. The dossier predicts the acceptance rate will stay high (92% today when candidates exist), while the candidate count on M/H/C-class questions should rise from zero. Retrieval, ranking, thresholds and budgets should NOT change in R4 — the evidence shows gathering is healthy (13.9 hits/hop on the very runs that produce nothing); it is claim FORMATION that fails. Secondary candidate for the same slice (from D): the ~20% empty reads suggest adding a read-fallback (retry one alternate source per failed read) inside existing read caps.

**Stopping here per the ruling. No R4 work begins without owner/coordinator review of this package.**
