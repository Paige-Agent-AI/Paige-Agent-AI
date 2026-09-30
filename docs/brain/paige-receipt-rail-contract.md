# Paige Receipt & Rail Contract — PROPOSAL (owner green-lit 2026-09-10)

> **Status:** PROPOSAL, owner green-lit for drafting. Documentation only — this delivery
> changes no runtime code, schema, capability state, or release identity. It extends the
> Paige Runtime Harness doctrine (`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §3,
> responsibility #7 "Evidence and operations") as the durable-job sibling of
> `paige-durable-job-contract.md`. It owns no Brain/Spine/registry fact and creates no new
> store: `record_capability_run` / `paige_workspace_events` remain the one Rail seam.

---

## 1. Problem (grounded survey, 2026-09-10, `main` `00ebdbbe`)

Master §3's inventory: "Rail and detailed receipts `PARTIAL` — Rail and capability-run
evidence cover bounded paths. A universal, correlated, redacted detailed-receipt contract
across all Harness work is not live." Grounded:

- **The Rail seam is real and well-shaped.** `record_capability_run` (migration
  `20261212000000`, evolved `20261220000000`) writes `paige_workspace_events` with a
  six-outcome vocabulary — `capability_succeeded | failed | refused | unreachable |
  outcome_unknown | completed_unrecorded` — where the sixth exists precisely so "the act
  landed but its record did not" (e.g. Twilio charged, row unwritten) is never collapsed
  into `failed`. Membership-validated **on the argument subject, not the caller**, `SECURITY DEFINER`, service-role-only — on the 6-argument signature. The 10-argument overload added by `20270107000000` carried no ACL until `20270416000000` (in the repo; MEASURED 2026-09-24 -- prod already service-role-only on both signatures, so the hole is not live).
- **Recording happens at the executor, by design.** `_shared/capability-record.ts` is the
  one home for HOW (a design crew rejected the central-dispatch-hook alternative for four
  documented failure modes, including the anon-key permission-denied silence). Adopters:
  `paige-ai-chat`, `business-mission-action`, `export-document`,
  `pipeline-capability-outcome`, `weekly-summary-cron` (first cron adopter, #1084).
  Two legacy inline writers (`n8n-management.ts`, `mcp-outcome.ts`) predate the helper;
  their migration is already tracked as its own slice (their vitest harnesses inject
  fixed module maps).
- **What is missing for "universal":**
  1. **No correlation.** A receipt does not name the durable-job attempt, model trace, or
     release identity it belongs to. The durable-job contract (#1084) records receipts and
     the model router writes `paige_llm_trace` — but nothing joins them, so an owner
     asking "what did this send cost, which model, under which approval" gets three
     disconnected rows.
  2. **Detailed receipts are PARTIAL.** Doctrine (Master §3, Migration Advisor contract):
     "the universal immutable detailed-receipt contract is `PARTIAL` and must be approved
     in that shared seam before persistence." Today only the summary lands on the Rail.
  3. **Two writers outside the one home** (tracked slice, unchanged here).
  4. **Scheduled-work receipts** (#1084's cron adopter) write with the recipient's own
     tenant/actor; no owner-facing surface change is claimed by this doc.

## 2. The contract

### 2.1 Correlation block (extend the existing seam, add no store)

`record_capability_run` gains OPTIONAL correlation parameters (all nullable, all
backward-compatible — existing callers unchanged):

| Parameter | What it names | Source |
|---|---|---|
| `_job_attempt_id` | The durable-job execution attempt this receipt proves | durable-job adapter (`_shared/durable-job/`) |
| `_llm_trace_id` | The model-router trace for the reasoning that produced the act | `_shared/model-router.ts` → `paige_llm_trace` |
| `_release_id` | The approved release record the code identity belongs to | release schema (absent ⇒ null, never guessed) |

Rules:
- Correlation is **reference-only**: uuids, never payloads. A receipt that cannot name a
  source passes null — it never fabricates a join (§13: an absent id is a gap, not a
  guessed answer).
- The durable-job contract's terminal/`outcome_unknown` transitions are the FIRST
  mandatory correlation adopters: job attempt → receipt in one write.
- The owner-visible Rail projection may later render correlations; this doc changes no UI.

### 2.2 Detailed-receipt rules (the PARTIAL → approvable contract)

The detailed receipt is what a summary cannot say, under hard redaction:

1. **Shape:** what was asked (normalized intent, not raw transcript), what was read
   (sources + as-of), what changed (canonical record ids + versions), what was verified
   (readback proof), what was left unchanged, approvals consumed, cost/tokens, outcome,
   correlation block.
2. **Never present:** secrets, credentials, cookies, raw payloads of private content,
   other tenants' data, hidden prompts, reasoning traces, un-redacted transcripts.
   `redactKeys()` runs before any persistence (existing precedent from the memory work).
3. **Immutability:** a detailed receipt, once persisted, is append-only. Corrections are
   new rows that supersede, never edits.
4. **Gating:** persistence is disabled until this section is owner-approved in this doc;
   until then the detailed receipt is returned inline (the Migration Advisor's
   read-only-slice precedent) and the Rail keeps summaries only.
   **OWNER APPROVED — 2026-09-10:** the §2.2 persistence gate is open. Detailed receipts
   may persist through `record_capability_run` under the rules above; the shared
   `redactDetail()` scrub in `_shared/capability-record.ts` is the tested enforcement
   point (denylist key drop at any depth, 16KB size fence server-side, depth cap), and
   `weekly-summary-cron` is the first correlated adopter (deterministic
   `job_attempt_id` = `weekly-summary:<user>:<week-intent>`, detail without recipient
   address or message content).

### 2.3 Writer consolidation order (existing tracked slice, unchanged scope)

1. `n8n-management.ts` and `mcp-outcome.ts` migrate onto `capability-record.ts` when their
   harness cost is paid deliberately (not inside this contract).
2. Every NEW executor (durable-job adopters first) records through the helper with the
   correlation block — no new inline writers, ever.

### 2.4 Capability mandate alignment (owner directive 2026-09-10)

The owner has mandated Paige be capable of **read, write, create, publish, edit** across
the platform and through n8n/Zapier/MCP, with guardrails. Receipts are how that mandate
stays honest: every mutating verb registered in the Spine owes a receipt with its
authority lane (`read | draft | auto | confirm | prohibited`) and approval proof. The
receipt contract does not grant verbs — the Spine registry and autonomy lanes do — it
proves what each verb did. No new authority system is created here.

## 3. Maturity gate

`PROOF OWED` until: a first correlated receipt (job attempt + trace id joined, rendered
from real runtime rows), redaction verified against a canary payload, immutability
append-only proof, and the two legacy writers' slice status restated. Until then the Rail
remains `PARTIAL`, truthfully.

## 4. Collision assessment

- Extends Master §3 responsibility #7; owns no Brain/Spine/Rail/registry fact; adds no
  table, no UI, no release claim.
- Durable-job contract (#1084 / `paige-durable-job-contract.md`): §2.1 makes its
  receipt step the first correlated adopter — no change to its mechanics.
- #917 (orchestration/tools), #729/#776 (Spine/Rail): receipts stay summary-level through
  the existing RPC; correlation columns land only in that RPC's signature and event row.
- Legacy-writer slice (n8n/zapier inline callers): named, not absorbed.
