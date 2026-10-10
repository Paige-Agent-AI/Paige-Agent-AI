# INT-322 R6-B (#1851) — Phase-1 Research Consumer Integration: First Return

Owner-approved continuation. R6-A remains CLOSED — its evidence (DEL-119/DEL-120, Judge v3
go-forward, frozen v2, the corrected **7/78** degradation record) is untouched and binding.
Grounded from current main `348d56810` (post-#1849) on a fresh branch; no R6-A branch reused.

## A. Grounded phase adoption map (the four research-owned call sites + the shared strategist)

| #1851 phase | Engine function | Declared class (RESEARCH_COGNITIVE_CLASSES, unchanged R6-A data) | Flag-OFF route (today, unchanged) | Fabric job identity (flag-ON) | Owner authority needed to enable |
|---|---|---|---|---|---|
| hop_query_planner | `planHop` | `cheap` | `routedChatCompletion("extract")` → open-pool Qwen (Claude classification on failure) | `research_hop_planner` | **YES — material economics** (see D) |
| unit_planner | `planSynthesisUnits` | `cheap` | `routedChatCompletion("extract")` → same | `research_unit_planner` | **YES — material economics** (same class) |
| unit_synthesis | `synthesizeUnit` | `operational` | `routedChatCompletion("doc_draft")` → Claude reasoning tier | `research_unit_synthesis` | YES — policy diff (budget gating/trace; model/tier parity) |
| dossier_synthesis | `synthesize` (entity dossier + monolith) | `operational` | `routedChatCompletion("doc_draft")` → same | `research_dossier_synthesis` | YES — same as above |
| strategist | `_shared/reasoning/strategize.ts` — **NOT migrated** | `operational` (declared only) | its own `routedChatCompletion("plan")` (self-traced) | — | **Not research's to change.** Bounded handoff in §E |

## B. What shipped (the dormant consumer adapter)

New research-owned file `supabase/functions/paige-deep-research/fabric.ts` (the only new module;
zero shared files touched):

- `RESEARCH_FABRIC_ENABLED: boolean = false` — the release gate. **Shipped false.**
- **Flag OFF (the default production path, unchanged):** `researchCompletion(phase, class, body, ctx)` forwards to `routedChatCompletion(jobKind, body)` — the SAME job kinds (2×extract, 2×doc_draft), the SAME request bodies, NO trace argument, no telemetry side-effects. Byte-parity with the R5/R6-A shipped path, pinned test-by-test.
- **Flag ON (dormant code, owner-gated):** one `fabricCompletion({ cognitive_class, job, ...body }, { trace })` request per call. The class comes from the CALL SITE's `RESEARCH_COGNITIVE_CLASSES` value; the job is research's own stable snake_case identity. No provider, model, policy, candidate order, fallback rule, or budget system exists in research code — the adapter holds none (pinned: no `CLASS_POLICY`/`mayFallback`/candidate lists; provider-string ban on executable code).
- **Trace (#1851 §5):** `{ tenant_id: resolvedTenantId, agent_id: "paige-deep-research", task_id: runId, job_kind: <fabric job> }`. `resolvedTenantId` is the engine's EXISTING M0 server-side resolution (JWT → RLS-pinned `current_user_tenant_id`; service-role → `profiles.active_tenant_id`; never body-trusted). An unresolved tenant stays **NULL** — the adapter never invents a UUID and never defaults to a membership guess (pinned). Honest statement for the activation review: a NULL-tenant fabric call is recorded but budget-UNgated (the fabric's own rule); today's tenantless calls are equally ungated, so no enforcement is being silently claimed or added for that class.
- **Telemetry (#1851 §3):** the fabric's route evidence projects into CLOSED diagnostic values only — per-unit `served_route: { requested_class, job, served_provider, served_model, fallback, reason, attempt_count }` on `dossier.units[]` (the key itself ships now as one additive null-valued field on the structured records, so post-activation rows differ only in value, never in shape), and `dossier.synthesis.served_route` for the entity/monolith call (sparse-object form: absent until truthy). No attempt detail, no raw provider error text, no identifiers (mutation-pinned). The R6-A `served_model`/`cognitive_class` readbacks survive unchanged; `served_route` reads `null` on the flag-off path.
- **Failure semantics preserved:** a fabric failure throws a closed `research_fabric_route_failed:<reason>` (provider text never crosses the line); a budget stop rethrows as-is (terminal). Every caller keeps its existing conservative contract: planner → deterministic degrade; unit → typed `failed`; dossier → honest error result with no fabrication.
- **Strategist untouched** (§E); **Judge untouched**; **holdout untouched**; **no live/authenticated R6-B calls made anywhere in this slice** (all tests are token-free source-behavior tests).

## C. Test/proof identity

- **NEW suite `src/__tests__/deep-research-r6b-fabric.test.ts` — 30 tests**, written failing-first
  (verified red on the missing module), all green: dormant-gate pins; flag-off byte-parity per
  phase (exact job kind + body + no trace arg + no fabric call); deterministic-phase refusal;
  flag-on request shape (class from the call site, stable job names, trace fields, null-tenant
  honesty, response unwrap); closed-failure throw; budget-stop rethrow; telemetry projection
  (closed values, no error text — mutation-pinned); engine integration pins; strategist
  non-migration; the no-second-authority + provider-string bans.
- **The binding corrected 7/78 seven, tested against the real predicate:** from the frozen
  `r5-after-dev.json` artifact — C1/C4/A1/A2 (all-truncated, retrieval healthy) escalate ONLY
  with sufficient evidence (≥2 sources) with reason `typed_truncation_with_sufficient_evidence`;
  the same truncated outcomes with no evidence stay honest insufficiency; S3/S4/A4 (typed
  insufficiency) NEVER escalate — A4 tested with abundant evidence and unresolved ambiguity,
  both guards firing.
- **Family: 177/177 across 10 deep-research files** (30 new; r4/r5/r6a harness pins updated to
  the adapter with assertions unchanged — mechanical stub rename + two R6-A-era pins whose truth
  R6-B supersedes, each replaced with the equivalent adapter-era pin).
- **Deno edge check:** `deno check` on the engine — exactly the 3 pre-existing `prompt-forge.ts`
  diagnostics on and off the change (verified via stash) — **zero new diagnostics** (the ratchet's
  contract). tsc-ratchet clean for committed files; eslint clean.

## D. Quality/cost/latency comparison — the MATERIAL finding is the cheap class

From the repo's own pricing tables (`_shared/token-pricing.ts`) and the drives' real token shapes:

| Phase | Today (flag-off) | Fabric (flag-ON, OpenAI off) | Verdict |
|---|---|---|---|
| Planners (cheap) | open-pool Qwen2.5-14B via flat-plan host — nominal $0.0002/1K; planner call ≈ 2.5K in/0.7K out ≈ **$0.0006 nominal, marginal ≈ $0 under the flat plan**; Claude classification on failure | Anthropic **classification tier** $0.001/$0.005 per 1K → ≈ **$0.006/call**; ~3–5 planner calls/run | **MATERIAL provider-economics change** (≈ +$0.02–0.03/run nominal; unbounded relative change off a flat plan) + a model-family change (14B open vs Claude classification) with UNMEASURED planner-JSON quality. This is exactly #1851's flagged case: measured diff + owner authority required BEFORE enabling. |
| Synthesis/dossier (operational) | Claude reasoning tier (sonnet-class) $0.003/$0.015 | **The same tier via the fabric's Anthropic candidate** — model/price/transport parity | No economics change. Policy diffs at activation: research calls become tenant-attributed + **budget-gated** (today they trace tenantless and run ungated); when OpenAI enables later, the class inherits the fabric's candidate order — a fabric-owner policy research does not control. |
| Latency | per-provider | same transports (`chatCompletionCompat` on the Anthropic leg); + two indexed reads per tenant-attributed call (the budget gate's ceiling resolve + accrual read — the #1847 precedent, single-digit ms vs model latency); no extra provider hops (OpenAI candidates skipped while off) | Parity for synthesis; planner latency moves with the provider change (part of the cheap-class diff to measure). |

No production cutover is included in this slice — by design there is also no dual-dispatch
shadow mode (it would double-spend). The measured-diff protocol is an activation step: flip the
gate in an owner-authorized window, drive the 24-dev corpus, score with Judge v3 (go-forward
instrument), and compare trace cost/latency — against the frozen v2 series for floor anchoring.

## E. Shared-file conflicts + the strategist handoff (bounded, non-overlapping)

**None.** Touched files: `paige-deep-research/index.ts` (research-owned), NEW
`paige-deep-research/fabric.ts`, the four research test files. `_shared/model-fabric.ts`,
`_shared/model-router.ts`, `_shared/reasoning/strategize.ts`, all eval files: untouched.

**Strategist consumer contract (for that shared module's owner, not research):** if the
strategist adopts the seam, the bounded shape is
`fabricCompletion({ cognitive_class: "operational", job: "reason_strategize", messages, temperature: 0.3, max_tokens: 1000 }, { trace })`
— its §13 honest-degrade contract and its `reason:strategize` trace tag (caller-wins rule)
survive unchanged; the module keeps its §17 reasoning-tier guarantee via the operational class's
Anthropic candidate. Research made no change there and claims no ownership.

## F. Remaining true activation gates (default-OFF until all are satisfied)

1. **Owner authority for the cheap-class economics change** (§D row 1) — measured diff first.
2. **Budget/trace policy acknowledgment**: activation makes research model calls tenant-attributed and budget-gated; a ceiling stop surfaces through the existing typed-outcome contracts (planner degrade / unit `failed` / dossier honest error). Owner confirms that is the intended production behavior.
3. **Cutover proof**: 24-dev corpus drive on the enabled path, Judge v3 scored, cost/latency from trace rows — floors: silent=0, completeness not materially below R5's 0.782, entailment not below 0.936 without owner review, ~97% acceptance, M comparisons not regressed.
4. **Not blocked by** #1850 (streaming budget/doc/abort — research is non-streaming), the Sol canary (separate owner gate), or the frozen-Judge migration (Eval owner). **Not permitted at activation without separate authority:** any provider activation, CLASS_POLICY change, frontier arming (the predicate stays declared-and-tested; arming is its own bounded step with one-call-site + one-per-unit cap), or credential issuance.
5. R6-B **implementation ≠ authenticated production acceptance** — no live claim is made here.

## G. COO platform fit labels

LIVE: research engine (R5 behavior, byte-parity under the dormant gate), Firecrawl
search/read, saved research records, typed outcomes, Judge v3 instrument. PARTIAL: fabric
adoption (code complete, dormant; activation gated on §F). UNAVAILABLE: frontier escalation
(declared predicate only), OpenAI-class research calls (fabric candidates off). UNVERIFIED:
fabric-path research quality/cost in production (no authenticated R6-B drive has run — §F3).
Future handoffs remain gated: research identifies a need (e.g. Secure Browser/PAIGE Computer for
auth/portal tasks) → router selects the capability → Harness/Spine/Trust authority — research
never operates sites itself and never becomes a second coordinator or authority source.
