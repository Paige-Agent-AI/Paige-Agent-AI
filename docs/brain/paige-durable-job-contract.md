# Paige Durable Job Contract — ADOPTED

> **Status:** ADOPTED. The 2026-09-23 coordinator ruling replaced the adapter-only substrate
> decision with one governed cross-capability work envelope. Migration
> `20270417000000_paige_durable_work_envelope.sql` is the single home for work identity; this
> contract remains the execution mechanism layered on it. It owns no Spine, Brain, Memory, or
> capability registry facts. Existing capability run tables remain their domain records and carry
> a nullable `work_id` reference; the Rail remains `record_capability_run`.
>
> **Capability status:** `SUBSTRATE PROVEN`, not `DONE` or `LIVE`. The table, migration, transition
> contract, and local single-claim concurrency property are proven. Disconnect survival, client
> resume without duplicate dispatch, persisted deployment, and authenticated owner readback remain
> unproven. Until those land, this is a governed schema and execution contract—not yet a durable-work
> capability Paige can rely on in production.
>
> **Routing per Master §3:** written after reading Master §3 (Harness), `paige-brain-wiring-standard.md`,
> and `paige-spine-and-rail-state.md`. Collision-mapped against #917 (orchestration/tools),
> #729/#776 (Spine/Rail), #109 (action bus) at the end.

---

## 1. Problem (grounded current-state survey, 2026-09-10)

Master §3's current-state inventory calls durable work `PARTIAL`: "the action bus, scheduled
workers, claims, retries, alert evaluation, and several job records exist. They are not yet one
uniformly governed, owner-visible Harness job contract." The survey below grounds that verdict at
`main` `42a8d5aa`:

- **13+ separate run/job tables**, each with its own lifecycle: `paige_actions`,
  `paige_workflow_runs`, `paige_skill_runs`, `paige_systems_check_run`, `paige_authority_act_runs`,
  `research_runs`, `paige_readiness_scan_runs`, `paige_eval_run`, `business_verification_runs`,
  `security_canary_runs`, `team_handoff_queue`, `paige_customer_actions`, plus the comms
  scheduled-drain path.
- **6 scheduled edge functions** (`coaching-reminder-cron`, `plan-reminder-cron`,
  `weekly-summary-cron`, `affiliate-monthly-statement-cron`, `systems-check-run-scheduled`,
  `comms-scheduled-drain`) that select due work with plain filters — no atomic claim, no lease,
  no attempt counter, no `FOR UPDATE SKIP LOCKED`-style guard. Example: `coaching-reminder-cron`
  selects `reminder_sent = false` rows and sends; a concurrent fire or a retry after timeout
  double-sends. This is a live correctness gap, not a style issue.
- **20+ distinct status vocabularies** across those tables, with no shared definition of terminal
  states. Migration `20261213` ("a run that never finished is not the latest reading") is an
  ad-hoc repair of exactly the missing semantics — the system keeps growing local patches for one
  global absence.
- **Asymmetry between chat and schedule:** the governed execution seam
  (`_shared/paige-spine/governedExecution.ts`) already enforces structured single-use claim
  redemption on the chat path; the scheduled path has no equivalent, so the same action class can
  be claim-governed when a human triggers it and unguarded when a cron triggers it.

## 2. The contract (canonical semantics, adapter-projected)

**Two-layer rule.** The contract governs *machine execution attempts*, not business workflow.
`paige_actions.status` (filed → drafted → pending_approval → done …) is business state and stays
exactly as is. A business row *rides* the contract through its execution attempts; the contract
never replaces or renames business lifecycles.

**Canonical execution states.** Every substrate projects its native status onto exactly these:

| Canonical state | Meaning | Terminal? |
|---|---|---|
| `claimed` | A worker holds a live lease on this attempt | no |
| `succeeded` | Canonical write + verified readback done | yes |
| `failed` | Definitively failed within attempt ceiling; retryable only by owner-visible re-file | yes |
| `blocked` | Waiting on approval, provider, or dependency; names the waiter | no |
| `cancelled` | Owner/authority cancelled | yes |
| `expired` | Lease died without resolution | no — must reconcile |
| `outcome_unknown` | Effect may or may not have landed; **must reconcile before any retry** | no — must reconcile |

`outcome_unknown` is load-bearing doctrine (Master §3): an ambiguous provider outcome is never
silently retried. `expired` and `outcome_unknown` attempts reconcile first; only `claimed`,
`blocked`, and un-reconciled states are invisible to re-dispatch.

**Required mechanics — every substrate adapter must provide or adopt:**

1. **Idempotency key.** Opaque and server-issued once per accepted work identity. A stable caller
   intent folds a lost-response retry onto that identity, so the same user intent cannot mint two
   dispatch keys or produce two side effects.
2. **Atomic claim.** One statement: select due work `FOR UPDATE SKIP LOCKED` (or a
   `SECURITY DEFINER` RPC observing §59 caller-scope-in-body), stamp `claimed_at` + `lease_until`
   + `attempt++`. Claim and side-effect intent land in the same transaction.
3. **Lease + heartbeat.** `lease_until` bounds every claim. A dead worker's lease expires to
   `expired`, which routes to reconciliation, never blind retry.
4. **Attempt ceiling + backoff.** Max attempts and backoff are per-substrate configuration,
   recorded next to the run row, visible to the owner.
5. **Receipt/Rail correlation.** Every terminal or `outcome_unknown` transition records through
   the existing `record_capability_run` seam — the run row carries the receipt reference. No
   parallel evidence store.
6. **Spine authority per step.** The contract adds no authority of its own; every step still
   crosses server-resolved identity, scope, approval, and budget exactly as Master §3 requires.
   The contract makes the *scheduled* path cross the same seam the chat path already uses.
7. **Honest visible state.** The owner-visible projection exposes canonical state + attempt count
   + named waiter (`blocked`) + reconciliation duty (`expired`/`outcome_unknown`). "Done" is never
   claimed without verified readback.

### Approval lifetime across durable work

The envelope records the authority context under which work was accepted for audit and replay
comparison. That snapshot is **not** durable permission and cannot extend or revive an approval.
Every consequential step must redeem a current, exact-call approval immediately before external
dispatch, while also revalidating current tenant membership, scope, autonomy, and budget.

- If the required approval expires before dispatch, the same work becomes nonterminal `blocked`
  with `blocked_reason = 'approval_expired'`. Its safe summary names the need for fresh owner
  approval. This is deliberately not `failed`: the work did not malfunction, and the audit record
  must distinguish expired authority from execution failure.
- Fresh approval resumes the existing work identity. It must not create a second envelope or
  blindly repeat a prior attempt.
- Once a live approval has been redeemed and the external effect has been dispatched, later expiry
  does not retroactively invalidate that dispatch. If the provider result is ambiguous, the work
  moves to `outcome_unknown` and must reconcile before any retry; it must not re-ask for approval
  and then risk duplicating an effect whose result is unknown.
- A later consequential step is a new exact call and requires its own current approval. Observe-only
  work carries no approval, but it remains subject to the same server-side authority checks.

This section fixes the Phase 1 contract only. Approval claim/re-approval wiring begins when submit,
status, or cancel become agent-accessible tools and therefore crosses the Phase 2 Spine/registry
relay. No approval token or expiry is persisted as reusable authority in this table slice.

## 3. One envelope, adapter-projected detail

Existing tables keep their schemas, native business lifecycle, and RLS. They gain only a nullable
foreign key to `paige_durable_work`, while the canonical row owns tenant, initiating user, optional
thread, immutable authority context, scope epoch, server-issued idempotency key, status, lease,
attempt ceiling, and terminal evidence. A caller-stable intent UUID folds a lost-response retry
onto the same server-issued work identity; a replay that changes immutable scope fails closed.

1. **Canonical identity:** `public.paige_durable_work`, created and transitioned only by the
   service-role seams in migration `20270417000000`.
2. **Mechanism:** `supabase/functions/_shared/durable-job/` remains the canonical state, lease,
   reconciliation, idempotency-window, and receipt-correlation contract.
3. **Capability detail:** existing `*_runs`, `*_jobs`, and execution ledgers keep their schemas and
   gain `work_id`; document production, deep research, and governed browsing adopt the same row.
4. **Owner-safe read:** `get_paige_durable_work` exposes only bounded status and safe summaries.
   Raw authority, documents, web content, provider payloads, idempotency material, and reasoning
   are not returned and never become Mind state.
5. **New work rule:** every new durable capability uses this envelope. A second universal work
   table, scheduler, lease implementation, or capability-specific envelope is prohibited.

**Maturity gate.** Source contract tests cover retry folding, scope binding,
reconciliation-before-retry, attempt ceilings, verified-readback success, and terminal
immutability. `npm run proof:paige-durable-work` passed on PostgreSQL 16.14 against a disposable
minimal dependency schema. It exercises the real migration and rollback proof, then races two
independent service-role sessions against one blocked row: exactly one advances it to `claimed`,
the loser fails closed with `DURABLE_WORK_TRANSITION_INVALID`, and one row remains at attempt 2.
Full-repository migration replay, persisted apply, first-capability receipt correlation,
disconnect/resume, and authenticated owner readback remain `PROOF OWED`. Until those pass, the
platform has one governed envelope in code but may not claim durable long-form work is `LIVE`.

## 4. Collision assessment

- Extends Master §3 Harness responsibility #5 (durable work); owns no Brain/Spine/Rail/registry fact.
- #109 (action bus): `paige_actions` business lifecycle untouched; contract governs only its
  execution attempts.
- #917 (orchestration/tools): consumes the same seam; this doc preempts no orchestration decision.
- #729/#776 (Spine/Rail): receipts flow through the existing `record_capability_run` seam; no new
  evidence ledger.
- No competing canonical home is created; if approved, this doc is the durable-job contract's home
  in `docs/brain/`, linked from Master §3 routing.
