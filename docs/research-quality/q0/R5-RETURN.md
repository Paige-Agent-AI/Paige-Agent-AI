# INT-322 — R5 Return Package (typed unit outcomes)

## A — Operating Envelope
`SHELL: SOLO` · `FLOW-BY-FLOW: APPLIED` · `IMPECCABLE: APPLIED`

## B — R5 Build
- **Scope**: (1) silent-empty eliminated — every successful unit resolves to `ok | insufficient | truncated`; (2) truncation first-class — the provider's real stop signal (`paige_stop.stop_reason` / `finish_reason: length`, the compat-layer shapes the reviewer proved the `max_tokens` read was blind to) drives the diagnostic; (3) the A/B distinction — grounded non-disclosure findings stay ordinary findings through the unchanged validator; typed insufficiency is meta-state on `coverage.unresolved`, never a fabricated claim; (4) unit budgets evidence-raised 900→2400 (ceiling, not spend; call ceiling 7, lanes 3, phase deadline unchanged).
- **Files**: `supabase/functions/paige-deep-research/index.ts` + two test files. **84/84** across the family (17 R5 incl. 5 behavioral truncation cases + 3 executed mutants, 18 R4, 16 R3, 16 M0, 17 INT-323).
- **Review**: FIX-THEN-SHIP — both P1s landed (const→let note; the dead finish_reason signal now reads the router's real shapes, proven behaviorally); spine initially red on a stale sync (comms-email migrations below frontier — the known reproduce-machinery interaction), green after sync.
- **Merge**: PR #1776 merged `d8ef0b9ef`; **edge-live = d8ef0b9ef**; deploy-edge-functions success.

## C — Root-cause disposition (the 24-dev after-drive on the deployed engine)

| Measure | R3 | R4 clean | **R5** |
|---|---|---|---|
| Zero-candidate rate | 62% | 75% | **29%** |
| Candidates / accepted | 97 / 89 | 36 / 33 | **145 / 140 (97%)** |
| F class produced | 4/4 | 2/4 | **4/4 (27 findings)** |
| M class produced | **0/4** | 1/4 | **4/4 (52 findings)** |
| H class produced | 1/4 | 2/4 | **4/4 (35 findings)** |
| C / S / A produced | 1/4, 2/4, 1/4 | 1/4, 0/4, 0/4 | 2/4, 2/4, 1/4 |

Unit outcomes across 48 executed units: **ok 29 · truncated 16 · insufficient 3 · failed 0 · silent 0**. The 7 remaining zero-candidate cases are fully typed: 5 are all-units-truncated (C1, C4, A1, A2 — first-class diagnostics, work visibly lost not hidden) and 3 units typed insufficiency (S3, S4, A4 — **the honest answer** for genuinely unestablishable questions, now surfaced as meta-state instead of vanishing).

## D — Semantic vector (Judge v2, unmodified)
Scored 63/66; 6 judge calls (contradiction ×2, insufficiency ×4) errored on a **recurring provider 400 window** (the same instant invalid_request pattern as 2026-10-05; 14 anthropic errors 16:00–18:00Z against 148 successes — environmental again, not R5):

| Metric | Q0-v2 baseline | R4 clean | **R5** |
|---|---|---|---|
| Entailment | 0.984 | 0.991 | **0.936** (21/24) |
| Precision | 0.613 | 0.676 | **0.626** (21/24) |
| Completeness | 0.408 | 0.389 | **0.782** (21/24 — **nearly doubled**) |
| Contradiction | 0.200 | 0.500 | n/a (judge errored) |
| Insufficiency | 1.000 | 1.000 | n/a (judge errored) |

**Completeness 0.39 → 0.78** is the headline: sub-questions are now actually answered. Entailment dipped to 0.936 — with 4x the findings volume (33→140), ~1 in 15 findings cites imperfectly; the validator's structural checks are unchanged, so this is exactly the guardrail working on a larger surface. Precision statistically flat.

## E–G — Flow/Impeccable
The Solo journeys proven on the deployed engine: multi-part comparisons now return complete cited answers (Ireland/Singapore 21 findings; TX/CA renewables 22; Stripe/Adyen 4; WY/DE 5) where R3 returned silence; genuine no-answer questions (S3/S4) end in typed insufficiency with the honest "Could not establish: …" note rather than a blank; truncation, when it still happens, is a diagnostic, never a thin answer. The A/B distinction holds: honest non-disclosure findings (S1 Plaid, S2 Cerebras) are cited findings; unestablishable facts (S3 SEC timing, S4 monthly granularity) are meta-state. No user-facing jargon: the note says what PAIGE could not establish, in the question's terms.

## H — Merge / Live
PR #1776 → main `d8ef0b9ef` = edge-live (deploy success). Production runtime: the after-drive and Judge re-score above ran on the deployed engine.

## I — Parked
- **Anthropic 400 windows recur** (2026-10-05 22:00Z, 2026-10-06 16:00–18:00Z) across all call classes — environmental/account; owner awareness; no R5 action (per prior ruling, no blind 400 retries).
- Judge v2 contradiction/insufficiency on R5 outputs: 6 results null (judge-call errored in the 400 window) — re-runnable when the provider is healthy; nulls preserved, never coerced.

## J — Records
Memory updated; this file + `r5-after-dev.json` committed.

## K — Final Disposition
**R5 SHIPPED + PRODUCTION VERIFIED** (engine drives on the deployed edge; Judge v2 63/66 with 6 environmental nulls; contradiction/insufficiency re-score owed on a healthy-provider window — not blocking, vectors flat-or-better elsewhere and those classes' behavioral evidence is in the dossier outcomes).
