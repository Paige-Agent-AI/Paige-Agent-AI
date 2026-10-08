# INT-340 / #1837 — governed conversational measurements

SHELL: SOLO. Operator, Agency, sub-account and client portal lenses are excluded. Settings Analytics and #1836 acceptance remain complete. This record describes the existing #1837 assignment, not a new roadmap.

## Capability routing and affected flow

1. Owner outcome: ask PAIGE about business performance, receivables, recorded cash or operating measurements and receive source-backed explanations and useful proposed next steps.
2. Ownership: Platform Reach binds the shared read. Analytics owns the measurement/evidence contract; Sales owns its eleven commercial producers; Marketing owns acquisition producers. No new producer is introduced.
3. Harness: existing `paige-ai-chat` authentication, thread and workspace fences, completed-model-round gate, tool exposure, cancellation and bounded tool loop. Context uses the existing `ContextSourceResult` interface. No Harness, context composer or authority system is replaced.
4. Spine: `analytics.metric_read` / `read_business_metric`, registered by the same Capability Kit declaration that supplies the Chat schema. Before this change this binding did not exist.
5. Providers: the read is internal Supabase RPC consumption. Existing Chat Model Fabric and approved provider configuration are reused. No connector, provider activation, canary or paid service is added.
6. Governance: `read` / `read_only`, no mutation verb or approval. Actual actor JWT, resolved Solo tier, active workspace and current owner/admin membership control access. A platform role supplies no tenant seat.
7. Durable work/events: not applicable to this bounded read. No scheduler, job, event producer or Orchestration authority is introduced.
8. Readback: authenticated issuer followed by authenticated resolver, exact identity/period/source-reference checks, final workspace and expiry checks. Measurement evidence is not a business-action receipt and this adapter calls no Rail writer.
9. Surface: existing shared PAIGE Chat and Live runtime; no Analytics UI rebuild. Binding ledger remains PARTIAL while authenticated conversational proof is owed. Pipeline Mind signals retain their separate client/enumerated-fact restrictions.
10. Proof: automated unit and actual-handler regressions, independent exact-head review, hosted CI, deployed bundle identity, and separately authenticated natural-language Chat/Live acceptance. Tests and prior Settings acceptance do not satisfy the latter.

## One authoritative seam

`canonical department records → deployed versioned producer → issue_analytics_evidence_bundle → resolve_analytics_evidence_reference → shared validator → closed current-turn context → existing Chat/Model Fabric → owner answer`

Only the actual authenticated caller client reaches the RPCs. The seven-argument issuer derives actor, tenant and membership on the server; `p_account_epoch` is a captured expected identity, not permission to choose a tenant. The resolver rechecks actor, active tenant, membership, source digest, expiry and revocation. Service-role access is not substituted.

The unchanged pure validator is shared from `_shared/analytics-metrics/metric-contract.ts`; the existing frontend import reexports it, preserving Settings and Sales contracts. Chat performs no KPI arithmetic. One tool reads one supported metric: the deployed 22 Settings keys and eleven Sales keys. Unknown Marketing metrics, foreign identifiers and dimensions are refused rather than routed to raw tables.

Periods are explicit UTC half-open ranges. Sales date cohorts end at the last completed UTC day. `this_month` and `last_month` are calendar periods; rolling periods are distinct. Current-snapshot metrics describe current state regardless of the requested interval and must not be called historical balances. The result carries the actual source semantics. Currency totals preserve integer minor-unit strings and separate currencies; recorded payment/allocation is not provider settlement proof.

Fresh reads issue then resolve. Existing references require their exact captured metric and custom bounds; refusal never automatically creates replacement evidence. Parser/RPC/identity/source/expiry errors return no measurement. Payloads are closed at every nested level, exclude actor/workspace identifiers, and are capped at 32 KiB without silently truncating coverage. Diagnostic rows retain the existing twenty-item producer bound.

The existing typed context interface distinguishes a successful source read from measurement truth. A successfully read UNAVAILABLE metric still has null values; PARTIAL retains coverage and caveats. Refusal and degraded source reads carry null context. Definitions and source references are legitimate authorized current-turn interpretation data under the owner's 2026-10-08 ruling; they are not instructions or durable business facts.

## Intelligence-system connections

| Connection | Implemented boundary | Evidence state before release |
|---|---|---|
| Canonical data / Metric-Evidence | Existing department producers, issuer/resolver and unchanged shared validator | Existing substrate proven; new conversational consumption IMPLEMENTED BUT UNVERIFIED |
| Spine / Harness / Trust | One declared read, canonical tier and actual caller JWT; existing runtime gates preserved | IMPLEMENTED BUT UNVERIFIED in authenticated production |
| Mind current-turn context | Closed metric projection through existing `ContextSourceResult`; no `SpineSignal` schema change | IMPLEMENTED BUT UNVERIFIED in authenticated production |
| Operating/Cognitive Fabric | Existing F1 DomainSnapshot/BusinessOperatingSnapshot contract can consume this versioned result; snapshot composition stays with Fabric | OWNED BY ANOTHER LANE; #1790 remains open/draft at grounding, not live runtime |
| Knowledge / Second Brain | Same-commit capability/contract documentation and model-visible declaration; existing scoped knowledge retrieval unchanged | Capability description implemented; tenant-specific policy/definition retrieval remains its existing owner |
| Memory | No metric/interpretation auto-write; goals/decisions use existing confirmed-memory rules through their owner | NOT APPLICABLE to metric persistence; shared continuity OWNED BY ANOTHER LANE |
| Model/Intelligence Fabric | Provider-neutral Chat tool result, same authority and definition regardless of serving model | Existing seam reused; OpenAI-first cutover OWNED BY ANOTHER LANE |
| Rail / outcomes | Existing opaque measurement/source references preserved; no action receipt fabricated | NOT APPLICABLE to read execution receipts; later departmental actions remain separately governed |
| Agent Intelligence | Versioned metric, period, as-of, coverage and evidence references retained for legitimate outcome evaluation | OWNED BY ANOTHER LANE; no learning engine or policy change |
| Chat / Live | Both enter the same authenticated handler and metric adapter | IMPLEMENTED BUT UNVERIFIED in authenticated production; signed runtime regression is not spoken acceptance |

## Acceptance and release evidence

The failing-first new-reader suite initially failed because the callable reader was absent. The delivered parser baseline passed before promotion. The actual-handler harness additionally exercises the model/tool round, caller-JWT RPC selection, financial caveats, foreign inputs/results, membership refusal, missing/expired evidence, client/operator/agency denial, no business-action receipt, and no changing-KPI Memory writes. Its providers/authentication are controlled stubs, so it is automated evidence only.

Approved authenticated Chat/Live credential injection remains a specific external dependency owned by Platform Identity/QA #1832. QA's 2026-10-08 response confirms no approved fixture identity or injection route; the proposed Production Actions destination is not established access. Prior #1836 isolated fixture acceptance is preserved and does not establish natural-language Chat/Live acceptance. No credentials are requested or recorded here.

Release identity, complete review, hosted checks, deployed-bundle readback and final authenticated verdicts are recorded after they exist. No customer release version or announcement is authorized by this record.

Rollback: source-only revert of this additive binding; existing RPCs, producers, evidence registry, Settings UI and financial records remain unchanged. No migration is required.
