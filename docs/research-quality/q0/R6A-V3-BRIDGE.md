# INT-322 — R6-A Owner G.3: Judge v2→v3 Calibration Bridge Return

One-time run of the frozen comparison corpus through `rubric_judge_v3`, per owner ruling G.3 (R6-A
merged as `020432dee`, edge-live; `paige-eval` deployed with the v3 scorer at that commit).

**No engine change. No corpus change. Judge v2 remains frozen as the historical instrument.**

## A. Corpus integrity (the frozen thing stayed frozen)

The 24-dev clean-R4 outputs were NOT re-derived: the existing `r4clean_*-v2` datasets were cloned
verbatim as `r4clean_*-v3` (case `input`/`expected`/`rubric`/`metadata` copied byte-for-byte), and
the clone was verified by content hash before scoring — all 8 dataset pairs IDENTICAL
(`md5(input‖rubric‖expected)` over cases in creation order). Same tenant stamp (the synthetic drive
tenant), same case counts: entailment a/b, precision a/b, completeness a/b (12 each), contradiction
(2), insufficiency (4) = 78 judge calls.

## B. The calibration vector (v2 historical → v3, same outputs)

| Metric | v2 (published) | v3 | Δ | Read |
|---|---|---|---|---|
| Entailment | 0.991 (22 scored / 2 degraded) | **0.979** (24/0) | −0.012 | flat — v3 scored the 2 cases v2 degraded on (both 0.9–1.0 quality critiques) |
| Precision | 0.676 (19/5) | **0.668** (24/0) | −0.008 | flat |
| Completeness | 0.389 (24/0) | **0.256** (24/0) | −0.133 | **the one real discontinuity — see D** |
| Contradiction | 0.500 (2/0) | **0.350** (2/0) | −0.150 | n=2; the substantive case actually ROSE 0.5→0.7; the abstention case fell 0.5→0.0 (class of D) |
| Insufficiency | 1.000 (4/0) | **1.000** (4/0) | 0 | identical |
| Judge degradation | 7/66* (11%) | **0/78 (0%)** | — | **the design goal: fixed route, no failover, null-preserved — every call scored** |

\* Counting reconciliation (records correction, history unchanged): the R4-JUDGE-RETURN.md totals
"66 judge results" and "7 of 66" are arithmetic slips — its own composition list (24+24+24+2+4) and
the store both show **78 total calls, 7 degraded (9%)**. Per-dataset v2 aggregates in the store:
entailment 0.9820/1.0000, precision 0.7773/0.5675, completeness 0.4725/0.3042, contradiction 0.5000,
insufficiency 1.0000. (Store-recomputed v2 precision over the 19 scored results is 0.689; the
published 0.676 differs by half-credit rounding — both round to "flat vs v3's 0.668".)

Per-dataset v3: entailment-a 0.9583, entailment-b 1.0000, precision-a 0.7675, precision-b 0.5692,
completeness-a 0.4167, completeness-b 0.0958, contradiction 0.3500, insufficiency 1.0000. Run ids
live in the store under `r4clean_*-v3` datasets (drive tenant, 2026-10-07).

## C. Instrument health

All 78 v3 calls recorded `judge_model = claude-sonnet-5-5` (the fixed route — no failover ever
engaged, none available). Degradation 7→0 across the same corpus: the v2 judge's unparseable-reply
nulls are gone under the v3 shape (same rubric, same 1600-token budget). Rationales are
finding-level specific (e.g. naming the exact uncited source behind a finding's wording), which the
v2 degraded calls never produced.

## D. The completeness discontinuity is a STRICTER HALF-CREDIT RULE on the empty-findings class

Completeness-b fell 0.304→0.096; every case v2 scored 0.5 in that half scored 0.0 under v3. The
rationales are consistent and rubric-grounded, not parse noise. These are the R4-era zero-candidate
outputs: an EMPTY findings array plus a generic coverage note ("no claim survived source
verification"). v2 credited these 0.5 — reading the note as marking the sub-question unresolved.
v3 reads the rubric's half-credit rule strictly: half credit requires an **explicit per-sub-question
unresolved marking**; a general nothing-survived note is "close to an admission" but is not a
labeled marker, so 0.0 — with the reasoning stated in the rationale itself ("even if the note
counted as an explicit-unresolved flag, the most that could be credited is 0.5").

Substantive outputs are stable: every completeness case v2 scored 1.0 stayed 1.0 (one moved
1.0→0.75); the contradiction case with real content rose 0.5→0.7 (both counts + differing
definitions credited; dinged only for not naming the disagreement explicitly).

**Why this discontinuity is acceptable — the strictness lands exactly where R5 already acted.** The
R4-era corpus over-represents the silent-abstention class by construction. The R5 engine eliminated
that class: typed insufficiency now surfaces as labeled per-unit/per-sub-question unresolved state
(coverage.unresolved + "Could not establish:" notes), which is precisely the explicit marking v3's
half-credit rule requires. The v3 instrument therefore distinguishes what R5 made distinguishable —
a labeled honest abstention (0.5) from a bare silent one (0.0) — where v2 gave both the same credit.
On the R5-and-later corpora the two instruments should converge; on this pre-R5 corpus they
diverge by design, in the direction that measures the defect R5 fixed.

## E. The owed R5 contradiction/insufficiency re-scores — CLOSED on v3

The R5-corpus v2 runs for these two metrics were null'd by the 2026-10-06 provider 400 window
(six `needs_config` runs, 0 scored — the pair datasets and the singleton retries). Re-run on v3
(datasets cloned verbatim as `r5_contradiction-v3`/`r5_insufficiency-v3`, same verification):

| Metric | v2 attempt | v3 (this run) | n |
|---|---|---|---|
| Contradiction | NULL (needs_config) | **0.250** (0 degraded) | 2 |
| Insufficiency | NULL (needs_config) | **0.750** (0 degraded) | 4 |

These are the FIRST real scores for these cells. Per case:

- **Contradiction 0.0** — an all-units-truncated zero-candidate output (nothing produced, nothing
  surfaced); **0.5** — a real partial that surfaced 3-vs-18 but never cleanly named the dispute.
- **Insufficiency 1.0 × 2 — the clean typed abstentions**: empty findings + note + explicit
  `unresolved` entry + typed outcome (`stop_reason: no_results, outcome insufficient`). This is
  direct production validation of the R5 typed-outcome design: the exact shape the judge's
  insufficiency rubric asks for is what R5 now emits. **0.5 × 2 — hedged insufficiency**: outputs
  that state the absence but also lead with an implying figure (a $546M ARR headline; a
  many-dated-numbers headcount hedge) — dinged for implying an estimate, a fair critique of mixed
  outputs, not an instrument artifact.

## F. Verdict

`rubric_judge_v3` is calibrated as the successor instrument: zero degradation, stable on
substantive outputs, identical on insufficiency (1.0 on the clean-R4 corpus), and ONE documented,
explained, directional discontinuity (strict half-credit on unmarked abstentions) that aligns with
the R5 typed-outcome design rather than contradicting it — confirmed from the other side by §E,
where R5's labeled abstentions score perfect 1.0s. **Quality floors remain anchored to v2's
historical series for R5 comparisons; v3 becomes the go-forward judge with this bridge as its
provenance.** Longitudinal v2 history stays frozen and untouched.

Judge v2: untouched. Holdout: untouched. Engine: the R6-A code at `020432dee`, no route changes
(the escalation predicate remains inert; zero call sites).
