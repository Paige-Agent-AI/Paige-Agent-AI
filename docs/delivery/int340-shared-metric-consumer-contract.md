# INT-340 shared metric consumer contract

Status: shared contract production-verified through merged PR #1814. The six-view Settings UI subsequently shipped in #1818; redundant heading removal shipped in #1828. INT-339 authenticated production privacy clearance remains closed. Post-merge evidence-lifecycle, permission and full accessibility acceptance are tracked by #1836; the shared governed Chat/Live reader remains separately owned by Platform Reach in #1837.

## One measurement seam

Canonical business records → department-owned versioned producer → shared evidence issuer/resolver → Settings, Marketing, Sales, Command Center and PAIGE consumers. Existing `analytics_evidence_reference` remains the ephemeral identity registry; metric values are recomputed from canonical records, not copied into a second warehouse.

The additive authenticated RPC is `issue_analytics_evidence_bundle` with these named arguments:

| Argument | Contract |
|---|---|
| `p_metric_key` | Explicit registered department metric key |
| `p_metric_version` | `1.0.0` |
| `p_dimensions` | JSON object; current producers require `{}` |
| `p_range_key` | `week`, `month`, `quarter` or `year` |
| `p_range_start` | Finite UTC timestamp, inclusive |
| `p_range_end` | Finite UTC timestamp, exclusive; no future end |
| `p_account_epoch` | Expected workspace UUID; equality guard, never authority |

The server derives the active workspace from authenticated identity and profile, and requires current active owner/admin membership. Supplying a foreign epoch fails closed. Tenant roles never grant the operator lens. Ordinary members are denied under the current canonical Analytics policy.

The range key labels the explicitly supplied interval. Settings currently requests rolling 7/30/90-day intervals. Sales won/lost date cohorts require UTC-midnight bounds; consumers must honor that producer requirement rather than alter its formula. Current snapshots never imply historical period-end state.

## Result and evidence

Results carry metric key/version, owning department, label, definition, formula, interval/bounds/timezone/semantics, dimensions, typed values/unit, source references, as-of and freshness, coverage counts, exclusions, truth state, caveats, source revision identity, account epoch identity, opaque evidence reference and expiry.

`LIVE` means complete measured coverage under the definition. `PARTIAL` remains visibly incomplete. `UNAVAILABLE` has null values; missing information is never zero. A refused or failed read is a separate read failure, not a successful unavailable metric.

Value shapes currently include counts, decimal strings, distributions, bounded ordered time series and currency-separated minor-unit string totals. Consumers format these results; neither frontend nor LLM computes authoritative KPIs. Currency totals are not combined across currencies.

`resolve_analytics_evidence_reference(p_evidence_ref)` rechecks the actor, current workspace, membership, expiry and source revision. References expire after 15 minutes. Changed source state, workspace changes, membership loss, another actor or expired references are denied. Consumers refresh through the issuer after refusal; they must not fall back to raw tables or unscoped reads.

The existing three-argument Sales funnel issuer and legacy resolver response remain compatible. Department producers remain private, without caller EXECUTE access. Operator Analytics RPCs and routes remain separate.

## Consumer responsibilities

Clear displayed results synchronously on actor/workspace/range changes; discard late responses from the previous scope. Validate the exact requested metric/version, dimensions, interval and epoch before rendering. Show source coverage and evidence on demand. Explain unavailable producers in owner language. Do not persist mutable KPI values in Memory.

Platform Reach owns the single governed metric-read capability, Spine registration and Chat tool integration. Typed Chat and Live Conversation must call that same capability through the authenticated runtime. A model/provider choice grants no extra data authority. Chat/Live proof is still owed; no Settings-only tool or voice calculation path is authorized.

The governed reader must forward the real authenticated caller context to the public RPC. The additive issuer/resolver deny service-role EXECUTE. A service client, caller-supplied tenant override, synthetic JWT subject or fallback raw-table read is not a substitute for that caller context.

Sales owns its 11 producers shipped by #1809 and the Sales Performance experience. Marketing owns its analytics producers and presentation. Settings requests only business-health, operations, team and AI/usage metrics, with Data Health exposing their coverage. Cross-domain summaries link to canonical owners without duplicating calculation systems.

## INT-343 shared-layer impact

| Layer | Analytics impact |
|---|---|
| Metric/Evidence Fabric | Primary shared measurement-contract producer/owner |
| Spine | One governed metric read; registration owned by Platform Reach |
| Harness | Bounded read, no rival execution envelope |
| Orchestration | May compose evidence; does not redefine metrics |
| Trust | Server-derived identity, workspace, membership and role/lens authorization |
| Rail | Evidence source where relevant; no rewriting execution history |
| Memory | No changing KPI values stored as owner facts |
| Business organizational memory | INT-337 remains owner of future shared facts/policies |
| Knowledge / Second Brain | May supply durable definitions/doctrine; measured state stays canonical |
| Mind | Consumer for trend/exception reasoning, not metric storage |
| Agent Intelligence | Future evidence consumer; no self-authorized action |
| Model / Intelligence Fabric | Reasoning/provider selection confers no Analytics authority |

## Proof still required

For #1836, the corrected consumer still requires exact-head CI/review, deployment and authenticated lifecycle/accessibility acceptance. For #1837, shared governed-reader integration and typed Chat/Live evidence parity remain owed to Platform Reach. Earlier foundation and Settings production proofs are historical evidence, not acceptance of either remaining change. Synthetic rendering and rollback fixtures do not substitute for these gates.

## Evidence lifecycle and permission guidance — #1836 / #1837

Consumers must clear displayed values and any open evidence disclosure before revalidating, on scope changes, and on loss of connectivity. Check reference expiry before rendering; periodically resolve current evidence and resolve again on foreground/visibility recovery. Discard late responses from older actors, workspaces or request generations. Do not display a cached `LIVE` result while authorization or freshness is uncertain.

A resolver `42501` may mean changed source state, revocation, expiry or lost authorization. It does not by itself prove the actor lacks permission. Retry only through the canonical issuer with the original metric/version, dimensions, workspace epoch and captured time bounds. An issuer `42501` is an explicit permission refusal: clear all measurements and present a truthful permission state. A transport, server or parser failure remains a read failure; it never authorizes a broader query or turns missing measurements into zero. User-requested Refresh may start a new rolling range, while automatic revalidation preserves the captured interval.

Platform Reach should consume `src/lib/analytics/metric-contract.ts` for request/result validation and `docs/delivery/int340-metric-coverage.md` for the exact 22 Settings definitions, source coverage, exclusions and unsupported producer owners. Reuse the same authenticated issuer/resolver and opaque evidence identity in typed Chat and Live. UI lifecycle tests are consumer proof, not evidence that #1837 is integrated.

## Bounded operating diagnostics

Settings adds operations.recorded_workflow_activity (event timestamp cohort) and operations.current_system_exceptions (current snapshot). Measured values use diagnostic_events with at most 20 items, each containing exactly source, at, status, severity, retry_count, completed_at and check_key. Times are explicitly zoned; source-dependent statuses and canonical severities are preserved. Coverage contributing count equals returned items, and capped/unsafe/missing records remain exclusions. Evidence revisions bind all contributing and excluded facts. Raw source payloads and errors are not part of this read contract.
## Production foundation handoff — 2026-10-07

INT-339 PRIVACY BLOCKER CLEARED remains closed. Shared foundation PR #1814 merged as 27ea26556f6e3ce68741567ebc18208d913dcb34. Vercel production dpl_FWZvX1JiQofXk4NKDxRUHzBGNqMC is READY with production aliases. Supabase migrations 20270601000005/06 are persisted; deployment run 37693903137 succeeded and db-live matches the merge SHA. Independent catalog readback confirms committed function bodies and authorization ACLs. Controlled authenticated GoTrue/PostgREST proof passed all 33 metric issuer/parser/resolver cases and scope/membership negatives; synthetic fixture cleanup absence passed. Sales received the direct production handoff for #1821. Authenticated Settings browser UI, typed Chat and Live acceptance remain separate and are not inferred from this foundation proof.
