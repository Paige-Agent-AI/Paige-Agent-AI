# INT-322 — R4 Clean Re-Drive Return Package

No code change was made for or by this re-drive. Same engine identity, same model (Claude Sonnet 5 reasoning route — the Sonnet 5.5 migration is a separate lane per the addendum), same corpus, same harness.

## A. Provider-health prerequisite
Recent-hour anthropic traces before the drive: 42/42 success, 0 errors (the 2026-10-05 22:00 incident window showed errors across ALL call classes — doc_draft, reason:strategize, chat, thread-summary — consistent with the account/credit-exhaustion hypothesis, not R4 concurrency).

## B. Deployed R4 identity
paige-deep-research ACTIVE v86 = merge `5040980cd` (edge-live), the same identity as the contaminated drive. Sonnet 5 route unchanged.

## C. Clean 24-dev results (F1–F4, M1–M4, H1–H4, C1–C4, S1–S4, A1–A4 only; holdout untouched)
- **Transport errors: 0** (was 9 in the contaminated drive — the 400 burst was environmental)
- Zero-candidate rate: **18/24 = 75%**
- Units planned 51 / executed 51 (100% planner + execution success); 2 units flagged insufficient
- Candidates 36 → accepted 33 (92%); validator drops 3 (all name_token_mismatch); zero citation drops
- Latency median ~50s (range 36–78s); model calls ~2.2/run average (1 extract + unit doc_drafts); cost ≈ $0.29 engine traces + the drive's share of provider spend

## D. R3-dev vs clean-R4-dev (both exactly 24 dev)

| Class | R3 produced (findings) | Clean R4 produced (findings) |
|---|---|---|
| fresh_fact | 4/4 (42) | 2/4 (8) |
| multihop_comparison | **0/4 (0)** | **1/4 (15)** — M1 Ireland/Singapore |
| high_stakes | 1/4 (15) | 2/4 (8) — H3, H4 |
| contested | 1/5→(4) (12) | 1/4 (2) |
| insufficient | 2/4 (14) | 0/4 (0) |
| abundant_insufficient | 1/4 (6) | 0/4 (0) |
| **Total** | 9/24 (89) | 6/24 (33) |

**The honest reading**: R4 reproducibly fixes the R3-identified collapse classes — comparisons went from always-zero to 15 validated findings, high-stakes improved 1→2 producers. But overall production DROPPED 9→6 cases and 89→33 findings: R3's simple-fact and insufficiency-class wins (which came from the monolithic call emitting "no reliable figure exists"-style findings) did not recur. Run-to-run variance is large (R3's F1 got 15 findings; clean R4's F1 got 6; R3's S1 7 vs clean 0), so single-drive comparisons carry noise — but the S/A-class zero is consistent with a structural cause (below).

## E. Transport-error classification
Zero. The 22:06–22:12Z incident is confirmed environmental (account/credit hypothesis stands; not R4 concurrency).

## F. Q0-v2 semantic re-score
Not yet run — the clean drive's 33 findings are staged for it (the harness's re-score phase needs pointing at the clean evidence packs; ~30min of script work, no engine change). Judge v2 unmodified.

## G. Per-class unit/candidate behavior
Units planned correctly in every class (51/51 executed; M1 planned the full side+relation+facet shape and it shows — 15 findings across comparison coverage). No planner failures, no provider failures.

## H. Residual zero-candidate taxonomy (18 dev cases)
**Every residual failure is class C: unit executed successfully, synthesis returned, and the unit emitted ZERO candidates** (0 dropped-by-validator residuals beyond the 3 name-mismatches; 0 citation drops; only 2 insufficient flags across the whole drive). The S/A-class regression is the clearest instance: R3's monolithic call emitted honest "no reliable figure exists" findings; R4's per-unit contract makes `insufficient:true` the sanctioned bow-out — but units almost never set it (2/51), they just return empty findings arrays, so the honest insufficiency that used to surface as findings now vanishes.

## I. Latency/token/cost delta
Median ~50s vs ~57s (R3) — flat. Model calls per run rose from 2 (strategize+monolith) to ~3.2 (strategize+plan+units) on producing runs. Engine trace cost ≈ $0.29 for the drive (same order as R3).

## J. R5 recommendation (evidence-based)
**The residual bottleneck is claim formation still refusing at the unit level — now visibly a prompt/contract issue, not architecture**: (1) the unit synthesizer needs an explicit honest-insufficiency OUTPUT contract ("emit a finding stating what could not be established, cited to the sources that failed to establish it, OR set insufficient:true — never silently empty"), which directly addresses the S/A regression and 2/51 flag rate; (2) F/M variance suggests unit synthesis on simple lookups regressed vs the monolith's larger single context — consider whether the `overall` unit should carry the monolithic 2400-token budget. Both are synthesis-prompt-scope changes within the R4 architecture; no retrieval/ranking/validation change is indicated by this data.

**Stopping here. No R5 implementation without owner review.**
