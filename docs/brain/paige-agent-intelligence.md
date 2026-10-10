# PAIGE Agent Intelligence — INT-280 AI-1

Owner-authorized 2026-10-10. Source grounding: main `b0eface4ba461136d77edaf16c9de9e5dde86258`; production catalogue inspected read-only. This is the Intelligence observation contract, not an execution, approval, receipt, model-router or Knowledge authority. The official Agent Intelligence Game Plan remains the program contract. The approved five-workspace Operator UI and the login hold remain intact.

## Task identity and correlation, version 1

A trajectory is one meaningful objective. The first supported anchor is a server-issued `paige_durable_work.id`: its immutable tenant, initiating actor, intent, optional owned thread, capability and work kind identify the accepted objective. It is not a Chat message, conversation, LLM call or timestamp cluster. `intent_id` is scoped by tenant and initiating actor; the database checks immutable replay scope. Work attempts and subsequent turns can belong to the same work identity. Independent work in one conversation remains independent. Multi-work objectives without a canonical parent reference remain unlinked; no inferred objective grouping is permitted.

The pure contract is `supabase/functions/_shared/trajectory/contract.ts`. Its terminal taxonomy separates accepted, in progress, blocked, failed, cancelled, reconciliation required, terminal unverified, conflicting, artifact verified and read verified. It adds no execution states. A verified artifact means that artifact's creation was read back; it does not mean publication, sending, agreement execution, invoice collection or commercial success. Model success, HTTP 200, assistant narration and an approval request cannot establish completion.

`canonical` is an assertion the server projection must prove from source identity and current destination records. The pure reducer does not authenticate callers or validate database records. Clients may display its result but cannot create authoritative evidence. Only current-attempt success receipts plus a domain-specific verified terminal condition qualify; unresolved or conflicting current evidence fails closed. Null historical identity is UNKNOWN. Unknown relationships never broaden scope.

## Source-to-contract inventory

| Field / evidence | Existing canonical source and producer | Coverage / missing seam |
|---|---|---|
| Stable objective, origin, actor, tenant/workspace | `paige_durable_work`: id, intent_id, initiating_user_id, tenant_id, thread_id, capability_key, work_kind; `create_paige_durable_work` validates current active tenant/member and owned thread | Durable adopters only; arbitrary historical Chat objectives have no reliable work identity |
| Original and subsequent turns | `paige_chat_turns.work_id`; interactive effects explicitly name work_id, with interactive actor/tenant/intent fields; `read_paige_durable_observation` proves exact acceptance | Conversation membership alone is insufficient; transcript and user goal remain private. Safe category is the work kind |
| Execution envelope and continuation | Existing durable status, attempt_count, version, dispatch_started_attempt, leases, terminal_outcome; durable-job continuation/observation modules | Current state is recorded. Full transition history and parent links across distinct work executions are not universal |
| Model calls, tokens, latency, cost | `paige_llm_trace`; document worker sets taskId=work_id, research sets taskId=research_run.id; research_runs.work_id gives explicit second hop | task_id is untyped legacy text. Require known producer, exact reference, tenant and working-context match. Detached trace writes may be missing |
| Runtime fingerprint | Model/provider, tier, router_version and INT-334 route_* metadata in the existing trace; source receipt release_id where present | Prompt/policy, tool schema, harness, approval and feature-flag fingerprints are not universally recorded. UNKNOWN, never inferred from latest configuration |
| Tools / capability attempts | `paige_act_executions.work_id`, capability_key, outcome, decided/dispatched/settled timestamps | Nullable work_id; unlinked acts remain unlinked. No executor alteration |
| Approvals / decisions | `paige_pending_approvals`, pending/tool confirmations; orchestration binds its own approval reference in metadata | No universal work FK. Only exact server-produced references with matching subject scope may link; raw draft, args, hashes and tokens excluded |
| Receipts and Rail | `paige_workspace_events` written by `record_capability_run`: source_id, job_attempt_id, llm_trace_id, outcome, capability_key, detail | Document completion writes source_id=work_id and job_attempt_id=work_id:attempt atomically with readback. Other adopters require their explicit contracts; receipt metadata alone is not destination proof |
| Provider acceptance/outcomes | Canonical domain run/provider_ref fields and bounded orchestration outcomes | Provider response identities are references, not business success. No raw payload or confidential response content |
| Direct terminal evidence | Document: marketing_content id/work/tenant/revision + completion turn + receipt. Research: research_runs and scoped citation/source records, as in durable observation | Domain-specific checks; no universal business-outcome assertion. Sensitive record content is checked server-side and never returned |
| Evals, cases, runs/results | Existing paige_eval_*; eval_result.source_trace_id, eval_run.work_id | Can link only through a proven source trace/work chain and matching tenant. No new evaluator or dataset store |
| Source freshness | Source created/updated/settled timestamps, work version, projection observed_at | Elapsed task time is distinct from model latency. Cost is the sum of legitimately linked recorded estimates, not complete spend |

## Authority and privacy

The later Operator projection must use the released `is_platform_admin()` authority, authenticated caller identity, empty search_path, bounded cursor pagination and fail-closed `paige_audit_log` fleet-read auditing. No PUBLIC/anon/Solo execution or raw table grants. Platform diagnostic visibility is not permission to read another tenant's private conversations, goals, documents, payment details, approval payloads, tokens or authority snapshots. Return source IDs, closed categories/states, recorded measurements and coverage gaps only.

## Required regression cases

Successful read-only terminal condition; governed multi-step approval and receipt; provider/tool failure; interruption/resume; unresolved outcome; denied/expired approval; wrong-tenant links; missing historical evidence; concurrent same-conversation tasks; multiple turns/attempts of one objective. No assistant claim, missing receipt or arbitrary timestamp join may produce verified completion. Local controlled synthetic records are validation fixtures, not production activity.

## Routing and delivery boundary

Portfolio families 12 and 15; this lane owns observation. Shared Harness A/B authority, C execution, E durable work, F evidence and G verification remain their canonical seams. The historical Harness map records partial coverage (and an absent act boundary at its older grounding); current per-adopter code determines available evidence. No new Spine trajectory key exists: Chat/Live Intelligence context is UNAVAILABLE and stays so until its separately governed seam is implemented. No provider requirement, spend, mutation verb, approval mechanism or autonomy change. The surface binding remains operator.platform PARTIAL; full authenticated acceptance remains UNVERIFIED under the owner login hold. AI-2–AI-9, training, experiments, promotion and business-effect attribution are not implemented by this contract.

AI-1A: contract and negative regression foundation. AI-1B/C: explicit canonical source normalization and audited Operator projection. AI-1D: existing Forensic inspector. AI-1E: controlled full-chain SQL/runtime, exact-head review/CI, migration/deployment readbacks and separate acceptance truth. Release identities belong in Master §4.0 and the existing INT-280 evidence record; do not create a second delivery ledger.
