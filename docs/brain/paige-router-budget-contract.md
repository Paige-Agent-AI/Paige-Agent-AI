# Paige Router Budget Enforcement Contract — PROPOSAL (Stage 1 piece ④)

> **October27,2026 owner billing supersession — current policy.** ANT11 owner
> ruling69816972 / receiving143b7cae and ANT1616a27e37d supersede this historical
> financial-stop proposal. All attributable PAIGE-provided consumption is billed
> to the consuming tenant at published rates; the accepted contribution target
> is25% after actual attributable variable/payment costs. Collection thresholds
> trigger collection, not cessation; direct-provider charges are not billed twice.
> No default/tenant/session/turn monetary allowance or exhausted-wallet stop may
> block permitted use. Cost estimates and thresholds are informational.
>
> The original router-budget API/settings/trace fields remain compatible, but
> every model band continues above those markers without model downgrade.
> Missing usage observations remain unknown, never invented zero. Original
> read-only continuation cannot hide a verified work result for prior spending
> or an unavailable cost source. Tenant attribution stays in paige_llm_trace;
> original domain/capability receipts remain authoritative. This source repair
> does not prove actual meter→collection→usage-invoice reconciliation or final
> dollar rates. Technical throughput, anti-abuse, provider readiness, routing,
> current authority, exact business-action approvals and activation stay intact.
>
> The text below is preserved historical context, not current release authority.
> Candidate source/tests are not production cap-removal evidence; exact review,
> CI, affected Edge graph deployment/readback and authenticated proof are required.

> **Status:** PROPOSAL. Documentation only. Extends the Paige Runtime Harness doctrine
> (`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §3, responsibility #2 "Model routing") as the
> fourth and final Stage 1 contract, sibling to the durable-job (#1083), receipt/Rail
> (#1086), and context-assembly (#1094) contracts. It owns no registry fact and creates no
> new store: `paige_llm_trace` remains the one cost ledger; `pickRoute` remains the one
> router.

---

## 1. Problem (grounded survey, 2026-09-10, `main` `6e08e590`)

Master §3's inventory names it exactly: "enforced per-task/tenant spend ceilings … remain
owed. **Estimates are not budget enforcement.**" Grounded:

- `_shared/model-router.ts` (1,034 lines) routes by band — cheap → Featherless with
  Claude self-rescue, reasoning → Claude reasoning, **sensitive → Claude reasoning, never
  an open model** (a hard wall that already behaves like enforcement and is the pattern to
  extend).
- Every call writes a `paige_llm_trace` row: `tenant_id`, `job_kind`, `tokens_in/out`,
  `latency_ms`, `cost_estimate_usd`, `cost_basis`, `status`, plus `doctrine_gate_hits`
  jsonb — a ready-made accrual ledger and a ready-made gate-decision field.
- What does not exist anywhere: a ceiling value, a sum over the window, or a refusal. A
  runaway loop (a cron retry storm, an agent loop) can spend without limit and every call
  would individually look correct. The doctrine's own caution list ("arbitrary
  agent-to-agent chat", "unbounded jobs") has no spend-side answer today.

## 2. The contract

**Every model call crosses a budget decision before it is made.** The decision is a pure,
synchronous function of (accrued spend, ceiling, job band) — never of the caller's hopes:

1. **Ceilings are config-as-data** (§10/§200 precedent): platform default + per-tenant
   override in `admin_app_settings` (`llm_budget_daily_usd`, `llm_budget_daily_usd:<tenant>`),
   resolvable to `null` (fail closed) or a number. Absent config = the platform default,
   never unlimited. Changing a ceiling needs no deploy.
2. **Accrual basis:** `SUM(cost_estimate_usd)` over the tenant's `paige_llm_trace` rows in
   the rolling UTC-day window — estimates, honestly labeled (`cost_basis` already exists);
   the ceiling guards against runaway spend, not invoice reconciliation.
3. **Enforcement ladder, by band, fail-closed at the top:**
   - `soft` (≥80% of ceiling): CHEAP kinds continue; every trace carries the gate hit
     `budget_soft`. Reasoning kinds continue.
   - `hard` (≥100%): CHEAP kinds still route (they ARE the economy tier) but with
     `budget_hard` recorded; REASONING kinds fail closed (`budget_exceeded`, no call);
     **SENSITIVE kinds never silently degrade — they fail closed** (`budget_exceeded`),
     because the existing hard wall already trades cost for safety in the same direction.
   - A failed-closed call returns an honest error the caller can surface ("budget ceiling
     reached — resets at UTC midnight / raise it in settings"), never a fabricated
     completion.
4. **The decision is recorded, never silent:** the gate outcome lands in the trace row's
   `doctrine_gate_hits` (budget_soft / budget_hard / budget_exceeded) — the same field the
   doctrine-gate system already uses — and is therefore Rail-correlatable via the receipt
   contract's `llm_trace_id`.
5. **Scope fence:** budgets resolve per (tenant, UTC day). The platform operator's own
   system-tenant work (§200) is a tenant like any other — no exempt identity, no bypass;
   internal work budgets under the same seam with its own ceiling value.
6. **Never weakened by defaults:** the platform default ceiling is finite and conservative;
   `unlimited` is not a settable value; raising a ceiling is an owner-visible settings
   change, not an env var.

## 3. Adapter-first rollout

1. **Seam module** `_shared/router-budget/` — `resolveCeiling(admin, tenantId)` (TTL-cached,
   §200-style), `accruedSpendToday(admin, tenantId)`, and the pure
   `enforceBudget({ accrued, ceiling, jobKind }) → { decision, gate }`. Dependency-free,
   vitest-importable.
2. **Adopter:** `model-router.ts`'s `callModel` path — one enforcement check before
   dispatch, one `doctrine_gate_hits` write on the trace. `pickRoute` is untouched.
3. **Then:** the cron/subagent invoke paths that bypass `callModel` route through the same
   check.
4. **New work rule:** any new model-call entry point enforces before dispatch; no caller
   may sum-and-decide for itself.

**Maturity gate.** `PROOF OWED` until: ceiling resolution from settings (set/absent/malformed
→ default, never unlimited), accrual over the UTC window, the three-band ladder decisions,
fail-closed sensitive behavior, and the trace gate-hit are each proven (unit) and the first
production trace with a budget gate hit is observed. Until then the platform truthfully has
estimates, not enforcement.

## 4. Collision assessment

- Extends Master §3 responsibility #2; #572 (model router/trace/metering) owns the router
  implementation — this contract is the enforcement layer it composes with, not a fork.
- §33 cost-cap / §205 metering safety net: same family; this is the call-time enforcement
  those post-hoc checks currently lack. No duplicate ledger — `paige_llm_trace` only.
- Receipt contract (#1091): gate hits correlate via `llm_trace_id`; nothing new to store.
- No UI in scope; the settings surface is a later, separately evidenced beat.
