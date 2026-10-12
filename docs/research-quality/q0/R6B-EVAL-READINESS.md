# INT-322 R6-B (#1855) — Evaluation Readiness & Owner Decision Package

**Status: PREPARED / NO SPEND.** Nothing in this package ran a billable call, flipped a flag, or
touched production. Phase-1 (#1851/#1853, merge `af3b0894db083dd6caa81604425c8edff3b7af52`) is
complete and closed; this package stops exactly at the owner-gated benchmark/activation boundary.

## 1. Verified Phase-1 status (current)

- `paige-deep-research` production ACTIVE; the deployed function contains
  `RESEARCH_FABRIC_ENABLED=false` — production still routes via `routedChatCompletion` exactly as
  R5/R6-A shipped (byte-parity pinned by the merged tests).
- **Historical release identity = merge `af3b0894d`.** The `edge-live` tag has since advanced with
  later main traffic and must NOT be read as the R6-B release identity (per coordinator).
- Full evidence: `R6B-RETURN.md` (30 new tests / 177 family / deno zero-new / review SHIP).
- **The #1853 Supabase Preview failure — characterized for the CI-infrastructure owner (theirs to
  disposition):** check-run `113171907951` on final PR head `4167acf39` (2026-10-08T05:54:23Z),
  summary `failed to bundle function: exit status 1`, no function named. The identical content
  bundled and deployed successfully as the merge commit `af3b0894d` at 06:08:07Z — fourteen
  minutes later — and every later main commit's Preview check is green. Read: transient
  bundler-side failure, unreproducible on the same content, did not gate anything that shipped;
  whether it should be a required check and its retry policy is the infrastructure owner's call.
  Production deployment evidence (deploy run 37735920700, success) stands separately.

## 2. The frozen evaluation definition (no new corpus authored)

The corpus already exists and is immutable — **the Q0 30-case blind-authored set:
`docs/research-quality/q0/evidence/{A,C,F,H,M,S}1-5.json`** (30 packs: 24 dev + 6 holdout,
1/class holdout; authored before any run; holdout NEVER used for tuning).

- **The benchmark set = the 24 dev packs, exact IDs:** F1–F4, M1–M4, H1–H4, C1–C4, S1–S4, A1–A4
  (verified against `r5-after-dev.json`). Each pack carries the frozen `question`,
  `sub_questions`, `freshness_days`, class and answer-class — the drive reads them verbatim.
- **Preserved frozen history:** the corrected **7/78** cohort (C1/C4/A1/A2 all-truncated +
  S3/S4/A4 typed-insufficient — the exact seven, unchanged), Judge v3 go-forward / v2 frozen
  historical, the r4clean/r5 eval datasets in the store (byte-identical clones verified at the
  G.3 bridge). No real customer data anywhere — synthetic drive tenant only (the established
  `7e700000-…` pattern; password-grant admin; password rotated after every drive).

## 3. The comparison design (flag-OFF baseline vs flag-ON trial — measured fields, no manufacturing)

Two arms over the same 24 packs, identical drive parameters (hops/caps/timeouts unchanged):

| Arm | Build | Planners (hop+unit) | Synthesis units | Route |
|---|---|---|---|---|
| A — baseline | production-identical, flag false | `extract` → open-pool Qwen flat-plan (Claude classification fallback) | `doc_draft` → Anthropic reasoning | today's, unchanged |
| B — trial | same engine, flag true | fabric `cheap` class → Anthropic classification (OpenAI off) | fabric `operational` → same Anthropic reasoning tier | class+job fabric requests |

**Per-call record** (every field already emitted by existing trace/dossier/telemetry — no new
instrumentation): `{arm, case_id, phase, requested_class, served_provider, served_model,
route_reason, fallback, attempts, tokens_in, tokens_out, cache_read/create, latency_ms,
cost_estimate_usd (trace), budget_verdict (ungated_null_tenant | allow_gated | block |
unknown_accrual), error_state (closed class only), stop_reason}`.
**Per case:** `{findings, accepted, acceptance_rate, silent_failures (=0 required), unit
outcomes ok/truncated/insufficient/failed, unresolved_units, wall_latency_ms}`.
**Per arm (the decision view):** `{Judge v3 vector (entailment/precision/completeness/
contradiction/insufficiency with scored/degraded counts), zero-candidate rate, latency p50/p90,
total cost from trace rows, provider-use envelope, budget stops}`.

## 4. Development-only activation feasibility — VERIFIED FEASIBLE, design prepared, NOT deployed

The flag is a build-time constant, so the trial surface is a **separate Supabase DEV project
ref**, never a production override:

1. Deploy the SAME function set to a dedicated dev project with the one-const build delta
   (`RESEARCH_FABRIC_ENABLED=true` there only). Production deploys are ref-pinned and never see a
   true flag; **no global flip, no request-scoped override (deliberately rejected — a hidden
   prod flag is exactly the forbidden shape), no double-dispatch** (production receives zero
   fabric-on calls; the dev endpoint IS the trial surface).
2. The 24 packs are posted to the dev endpoint only, as the synthetic drive tenant; both arms run
   there (flag-false build first = baseline, flag-true second = trial) so even the baseline arm
   spends only in dev.
3. **Owner-supplied prerequisites (not mine to create):** the dev project ref + its env
   (owner-held provider gateway config — NO new credentials from Research; nothing in GitHub),
   and the spend authorization in §5. Secrets stay owner-held; this package names no values.
4. Rollback = redeploy the dev function at flag-false (or delete the dev deployment); nothing to
   roll back in production because nothing in production changed.

## 5. Economic decision preparation — NOMINAL ONLY, actual cost UNMEASURED

From the repo pricing tables + the real R5 drive shapes (24 cases → 48 unit-synthesis calls
total; ~3–4 planner calls/case; strategist 1/case; no entity-dossier call on this corpus):

| Item | Basis | Nominal |
|---|---|---|
| **Planner delta (THE decision variable)** | ~76 planner calls; classification tier $0.001/$0.005 per 1K; ~3K in/0.7K out each | **+$0.50–0.65 for the trial arm** (baseline ≈ $0 marginal off the flat plan) |
| Unit synthesis (both arms, unchanged tier) | 48 calls × ~12K in/1.5K out at $0.003/$0.015 | ≈ $2.80/arm |
| Strategist (both arms, unchanged) | 24 × ~1K/1K reasoning tier | ≈ $0.43/arm |
| Judge v3 scoring × 2 arms | 78 calls/round (frozen datasets reuse) | ≈ $1.20/round |
| Firecrawl search/read | unchanged by the flag; engine-estimated | ~$0.31/run-set |
| **Total benchmark envelope** | both arms + judges | **≈ $9–11 nominal** |

**Proposed hard ceiling: $25 actual spend** (≈2.5× headroom for retries/variance), with a
**stop-loss at $15**. Concurrency = the engine's own bounds (3 unit lanes, ≤7 synthesis calls,
hop/query/read caps unchanged — no new parallelism). **Evaluation window: one owner-designated
2-hour slot.** Stop conditions (any one halts the trial): spend > $15; any provider 4xx window
(the known environmental class — halt, never retry into it); any silent unit failure observed;
any tenant/trace anomaly (unexpected tenant, missing attribution on a tenant-ful call); budget
block on the synthetic tenant. **Rollback:** §4.4. Expected provider-use envelope: Anthropic
classification ≈ 76 calls ≤ 3K/0.7K each; Anthropic reasoning ≈ 48 unit calls + 24 strategist +
156 judge calls; open-pool Qwen ≈ 76 baseline-arm planner calls (flat plan); no OpenAI, no
frontier, no new provider.

## 6. Acceptance contract (frozen starting point; any change is owner-reserved)

- **Silent failures = 0** (invariant).
- **Completeness not materially below R5's 0.782**; **entailment ≥ 0.936** (a fall below → owner
  review, not auto-fail); **acceptance ≈ 97%**.
- The M comparison cohort and the corrected 7/78 cohort behave consistently (no regression to
  pre-R5 silence).
- Judge v3 scores both arms (go-forward instrument); Judge v2 historical series stays frozen and
  untouched.
- Outcome recommendation shapes (no automatic cutover): **APPROVE CONTROLLED CANARY** /
  **REVISE ROUTING WITH INT-334 OWNER** / **KEEP FLAG OFF**.

## 7. Independently owned dependencies (status; nothing seized)

| Dependency | Owner | Status |
|---|---|---|
| Supabase Preview failure disposition (required-check? retry policy?) | CI infrastructure owner | **ROUTED** with facts in §1; unreproducible on identical content; all later green |
| Route/trace interpretation (served_route semantics, budget verdict vocabulary) | INT-334 Model Fabric | seam contracts stable (#1831/#1847); no interpretation divergence open; coordination only |
| Judge scoring methodology / any Judge change | Eval owner | v3 instrument ready; frozen datasets reuse; no Judge change requested |
| #1832 QA infrastructure | QA lane | parallel dependency; no bypass — authenticated proof still required before any production claim |
| #1850 OpenAI streaming budget/doc/abort | Model Fabric | NOT needed for this trial (research is non-streaming) |
| Sol canary / provider activation / credentials | owner | untouched, untouched, owner-held |

## 8. Remaining production & authenticated acceptance proof (after the owner-gated trial)

Measured quality/cost/latency/trace deltas from §3's records → independent review → owner
decision per §6. Only after an APPROVE decision: a separately authorized production canary
(small, tenant-scoped, reversible), then authenticated acceptance on the production build. Until
then R6-B stays **implemented + dormant**, and no live-behavior claim exists.

## 9. AI COO connection (labels unchanged, restated)

Research → **evidenced hypotheses/recommendations** → Operating/Cognitive Fabric context
(**PARTIAL** — dossier/coverage records exist; no automated COO feed) → PAIGE planning (LIVE
within chat flows) → Spine/Harness/Orchestration/Trust authorization (**LIVE, not research's**)
→ Rail readback (**LIVE**) → Metric/Evidence outcomes (**PARTIAL**) → Agent Intelligence
evaluation (**UNVERIFIED** for research outcomes). Research invents no router, memory,
coordinator, scheduler, metric engine, or approval gate — confirmed none exists in this slice.

---

**OWNER DECISION REQUESTED (the exact boundary):** authorize the dev-project 24-case two-arm
benchmark under §5's envelope ($25 ceiling / $15 stop / one 2-hour window / synthetic tenant /
owner-supplied dev environment), or defer. No execution until that authorization is explicit.
