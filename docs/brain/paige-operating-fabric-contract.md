# PAIGE Operating Fabric — current-state map + the Domain Snapshot / Business Operating Snapshot contract

> **Status:** Phase 0 is a GROUNDED MAP: every status below is backed by a file:line, a migration,
> or a read-only prod aggregate, taken 2026-10-06 at `main` `8b7f975`. Phases 1–2 are a CONTRACT,
> and their first slice (the pure seam) is code in `_shared/paige-context/snapshot.ts`. Nothing here
> claims a capability is LIVE unless prod evidence says so.
>
> **Extends, never forks:** the one Runtime Harness (`paige-ai-chat`), the Context Assembly Contract
> (`paige-context-assembly-contract.md`), the Spine registry, the receipt/Rail contract, the governed
> memory contract (`paige-memory-contract.md`), the Turn Route (`_shared/paige-turn/route.ts`), and
> modality neutrality (`docs/doctrine/paige-modality-neutrality.md`). It creates no Brain, executor,
> approval system, memory store, analytics warehouse, or model router.
>
> **How the map was built (§1/§39/§71).** Seven mappers worked in parallel: six domain clusters plus
> one runtime lane. An adversarial verifier then tried to refute every LIVE and Live-reach claim, and
> a completeness critic re-searched every claim that something was absent. Prod reads were SELECT
> aggregates only. Two verifier refutations changed rows (Deep Research and CRM tasks), and one
> changed a cross-cutting claim (Live admission). All three are applied below.

---

## The seven data classes this fabric keeps apart

| Class | Question it answers | Home today |
|---|---|---|
| Canonical domain truth | What is true right now? | Each domain's own tables and read RPCs (CRM `clients`, `deals`, `paige_invoices`, `messages`, `calendars`, …) |
| Rail | What actually happened? | `paige_workspace_events` (capability receipts) + `paige_client_events` (contact Rail) |
| Knowledge | What has the business supplied? | `tenant_knowledge_docs`/`_chunks` (voyage-3) |
| Memory | What should carry forward? | `client_memory`, `paige_owner_memory`, thread summaries + `paige_operating_memory()` |
| Game Plan | What are we trying to accomplish? | `business_missions` + brief versions; `plans`/`plan_items` |
| Deep Research | What does outside evidence suggest? | `research_runs`/`research_sources` (provisional, never promoted) |
| Mind | What subset matters for THIS job? | The per-turn context projection. It is not a store. |

The Mind is the projection over the other six. The Business Operating Snapshot is one such
projection, and it is read-only.

---

## A. Current-state fabric map (grounded, `8b7f975`, prod 2026-10-06)

The status vocabulary:

- **LIVE**: the path is wired and prod shows it running.
- **PARTIAL**: some of the path is wired or running.
- **UNAVAILABLE**: there is no substrate.
- **UNVERIFIED**: code exists, but there is no runtime evidence.
- **PROOF OWED**: shipped, with a named proof outstanding.

"Chat" means the typed `paige-ai-chat` turn. "Live" means a spoken Live Conversation turn. A Live turn
re-enters the same handler, so its reach equals Chat's reach unless the table says otherwise.

| Domain | Canonical source | Tenant-safe read seam | Spine | Chat reach | Period read? | Status |
|---|---|---|---|---|---|---|
| Business identity / Settings | `tenants.brand`, `tenant_setup_*`, `tenant_legal_profile` | `get_business_context_readiness()` (JWT tenant) | `business_context.readiness` (read only; writes unregistered) | per-turn block + `update_business_profile` | no | PARTIAL |
| Team / authority | `tenant_members`, invitations | `get_team_authority_readiness`, `get_paige_team_context` | `team.authority` (read only) | per-turn blocks + team tools | no | PARTIAL |
| Agency / operator tiers | `tenants.parent_tenant_id`, `agency_team_members`, `user_roles` | SQL predicates | none | operator briefing only (tenant-less) | no | PARTIAL; Live unreachable (needs a tenant thread) |
| Trust Compass | `admin_app_settings.paige_trust_compass` | `get_platform_trust_compass` (operator) | none | enforced via `resolve_tool_autonomy*`, never stated to PAIGE | no | PARTIAL |
| Systems Check (tenant) | `paige_systems_check_run/_finding` (794 tenant runs) | `systems_check_snapshot(p_scope)` | none | **none** (0 matches in chat) | substrate yes, seam no | PARTIAL (runner live, PAIGE blind) |
| Systems Check (operator) | same, `tenant_id IS NULL` | owner-context service read | none | operator briefing line | no | PARTIAL (chat delivery PROOF OWED) |
| Connections / integrations | `channel_connectors`, `*_mcp_connections`, `tenant_n8n_connections` | `list_integration_surface()` | `integrations.list` (+ `integrations.health` declared, **no tool**) | Mind block + `integrations_list` | no | PARTIAL |
| Secure Browser / PAIGE Computer | `secure_browser_*` (all 0 rows) | `browser-use` edge (gated off) | none | none | no | UNAVAILABLE |
| CRM / clients | `clients`, `client_contact_methods` | service-role reads filtered by persona tenant | `contact.*`, `company.*` via crm-command | search/summary tools; governed writes | fixed 7/30-day counts only | PARTIAL |
| Sales / pipeline | `pipelines`, `pipeline_stages`, `deals` | `readPipelineWorkspace` (caller JWT, tenant bracketed) | `pipeline.deal_stage_evidence` + pipeline actions | `pipeline_catalogue`, `crm_pipeline_summary` | point-in-time; `practice_dashboard_metrics(p_window_days)` is **UI only** | PARTIAL |
| Payments: invoices / receivables | `paige_invoices`, `paige_invoice_payments` | `read_sales_invoice(_expected_tenant,_id)` (single invoice) | `sales_invoice.*` | sales invoice tools (prod-proven 2026-10-04) | **no** (no list, aging, or collected-in-range read for PAIGE) | PROOF OWED |
| Payments: collections / terms | `paige_sales_collection_operations` (0) | `read_sales_collections` | `sales_collections.*` | tools | no | UNVERIFIED |
| Payments: Stripe direct-charge | `tenant_stripe_accounts` (0) | `read_sales_invoice_payment_request` | `sales_invoice.payment_request` | tool | no | UNAVAILABLE (no connected merchant) |
| Platform billing (§38 L1) | `platform_subscriptions`, `tenant_revenue_classification` | operator RPCs | none | operator briefing only | `operator_mrr_history(p_days)` not chat-reachable | PARTIAL |
| Communications inbox | `messages` + `threads` | `list_inbox_messages` (≤50 envelopes, no window) | `comms.messages_read` | `inbox_list`; `threads` never read | **no** | PARTIAL |
| Email: one-to-one send | `messages` bound via `comms_email_binding` | `comms-email-command` door | `comms.email_send` | `comms_send_email` (11 confirmations / 6 receipts in 7d) | via Rail only | LIVE for Chat send-to-provider; delivery receipts 0; Live can propose, never execute |
| Email: inbound | `messages` inbound (5 rows, last 2026-09-11) | `handle-inbound-email` | none | `inbox_list` envelope | no | PARTIAL |
| Email: campaigns / series | `email_campaigns` (1 draft), `email_sequences` (0) | `read_email_campaigns`, `read_email_series` | `email_campaigns.*` | tools | no (0 dispatches) | UNVERIFIED |
| Email: transactional | `email_send_log` (45) | none for tenants | none | none | substrate only | PARTIAL |
| SMS (tenant) | `messages` sms (**0 ever**); inbound lands in `paige_conversations` | `send-message` adapter | none | no send tool | no | UNAVAILABLE |
| Voice / phone | `messages` voice (7; 6 stuck queued) | `voice-access-token`, `voice-twiml` | none | envelopes only | no | PARTIAL; no SIP; phone never reaches PAIGE reasoning |
| Campaigns: briefs | `campaign_briefs` (1) | `get_campaign_briefs` | `campaign.*` | tools | no | PARTIAL |
| Studio / Growth pages, forms, funnels | `growth_pages` (8), `growth_forms` (5), `growth_form_submissions` (0), funnels (0) | upsert/publish RPCs | `growth_page.*`, `growth_form.*`, `growth_funnel.*` | tools | submissions-in-period: **UI only** | PARTIAL (page save LIVE, thin) |
| Social | `tenants.features.social_handles`; `paige_social_*` (all 0) | `get_social_presence_evidence` | `social.presence` | per-turn block; post/analytics refused | no metrics substrate | presence LIVE; operations UNAVAILABLE |
| Ads / paid acquisition | **none** (searched ad_account, ad_spend, adset, google_ads, meta_ads) | none | none | ad-copy drafting only | no | UNAVAILABLE |
| Events / webinars / registrations | **none** (calendar `event` model; `calendar-webinar.tsx` is fixture-only) | none | none | none | no | UNAVAILABLE |
| Calendar: booking presets | `calendars` (19) | `get_calendar_presets` | `calendar_preset.*`, `calendar_link.*` | tools | no | PARTIAL |
| Calendar: bookings | `internal_bookings` (3, last 2026-07-14) | **no read for PAIGE** | none | write-only `calendar_book_meeting` | **no** | PARTIAL |
| Reviews / reputation | **none** (`paige_nps_responses` 0, no seam) | none | none | none | no | UNAVAILABLE |
| Promotions | none for tenants | none | none | none | no | UNAVAILABLE |
| Analytics (tenant metrics) | computed on read from canonical tables | `practice_dashboard_metrics(p_window_days)`, `practice_attention_queue()`, `issue_analytics_evidence_bundle` — **UI only** | none | **none** | yes, in UI only | PARTIAL (stranded) |
| Analytics (telemetry) | `analytics_events`, PostHog | write-only | none | write-only | n/a | LIVE (write-only) |
| Tasks: CRM | `tasks` (2 rows, tenant_id NULL) | service-role read (`:14275` reads one branch without a tenant filter) | via crm-command | `crm_list_tasks` | overdue only | PARTIAL |
| Plans / plan items | `plans` (0), `plan_items` (4) | `plan_list(p_from,p_to)` | none | `plan_*` tools | **yes** | PARTIAL |
| Durable work | `paige_durable_work` (2) | `get_paige_durable_work(id)` | `long_form.*` | document tools only; C4d paused | no | PARTIAL |
| Knowledge | `tenant_knowledge_docs` (12) / `_chunks` (34) | `match_tenant_knowledge` (caller JWT, fail-closed) | none | per-turn retrieval block; confirm-gated save | n/a | LIVE (retrieval) |
| Business Vault | `business_vault_*` (all 0 rows) | `business_vault_snapshot`, `business_vault_get_context` (**0 callers**) | none | **none** | n/a | UNVERIFIED (stranded) |
| Deep Research | `research_runs` (138 in 7d, mostly eval harness), `research_sources` | `get_workspace_research_run`, `list_workspace_research` | none | `deep_research` tool (4 chat runs, all no_results) | no filter | PARTIAL (verifier refuted LIVE) |
| Memory: client / own-person | `client_memory` (21) | `match_paige_memory` + service read | none | per-turn memory block, written each turn | no | LIVE (Chat) |
| Memory: thread continuity | `paige_chat_threads.summary`, `paige_operating_memory()` | caller JWT | none | per-turn blocks | last-N, not a window | LIVE (Chat) |
| Memory: operator (God) | `paige_owner_memory` with `tenant_id IS NULL` (8) | `loadOwnerContextBlock` | none | operator briefing | no | LIVE (Chat, operator); Live unreachable |
| Memory: workspace / owner (tenant-scoped) | `paige_owner_memory` with a tenant (1 row) | `get_paige_memory` / `match_paige_owner_memory` (**0 callers**) | none | **none** (slice 4b deferred) | no | UNAVAILABLE (S5 in flight) |
| Memory: decisions, commitments, corrections, agent lessons | contract types (0 rows) | `record/get_paige_memory` (0 callers) | none | none | no | UNAVAILABLE |
| Memory: performance | `response_quality_feedback` (8), `team_scoreboard_metrics` (0) | eval + UI only | none | none | substrate only | PARTIAL (write only) |
| Game Plan: missions | `business_missions` + brief versions + receipts (**0 rows ever**) | `get_business_mission`, `list_business_missions` | `business_mission.*` | mission tools; context only for a selected or thread-bound mission | no target or metric columns | PROOF OWED |
| Game Plan: goals, targets, KPIs, pillars, bets | **none** (searched goal, target, objective, okr, strateg, pillar, bet, initiative, kpi, metric, scorecard) | none | none | none | no | UNAVAILABLE |
| Game Plan: performance evidence | `analytics_evidence_reference` (0) | not mission-linked | none | none | ranges exist, no rows | UNAVAILABLE |

**Live admission (verifier correction).** `paige_live_pilot_authorized_internal` never reads
`paige_live_pilot_subjects`. It admits an active member of a tenant whose tier allows Live, which is
13 standalone Solo tenants. Agency and sub-account tenants are structurally excluded. Prod has 26
sessions, 4 of which reached LIVE, the last on 2026-09-24, and none in the last 7 days. **Every Live
cell above is therefore UNVERIFIED at runtime**, even where the code path is shared.

**Cross-cutting ledgers that make "reachable" hard to prove:**

- `paige_chat_turns.tool_calls` is null in 1445 of 1445 turns.
- `paige_workspace_events.llm_trace_id` is null in 94 of 94 events in the last 7 days.
- `platform_metered_events` has 0 rows.

## B. Connected end to end today (prod-proven)

1. **Typed Chat → crm-command door.** The door calls `execute_crm_command`, which writes
   `clients`/`deals`, then `crm_command_results`, then a `paige_workspace_events` receipt. Last proven
   2026-10-01.
2. **Typed Chat → sales-invoice door.** The door calls `paige_invoices`/`paige_invoice_payments` and
   writes receipts. Proven 2026-10-04.
3. **Typed Chat → `comms.email_send`.** The path runs approval card → `send-message` → a bound
   `messages` row → a receipt. Six succeeded in the last 7 days. Delivery outcome is not tracked.
4. **Tenant Knowledge retrieval.** Every turn runs `match_tenant_knowledge` → the TENANT KNOWLEDGE
   block. Telemetry shows it running, last on 2026-10-04.
5. **Memory continuity.** `client_memory` is written and read every turn. The thread summary and
   `paige_operating_memory()` are injected every turn.
6. **Operator briefing.** `paige_owner_memory` (tenant_id NULL) plus operator Systems Check health
   reach the operator chat (§52).
7. **Daily heartbeat.** `heartbeat_stale_clients` → `paige_actions client.followup` (109 rows).
8. **Live → same runtime.** A spoken turn re-enters `paige-ai-chat` behind a signed challenge, with the
   same tools and gates (`index.ts:1131-1194`). Twelve turns were persisted inside Live windows.
   Stale since 2026-09-24.

## C. Exists but stranded (built, not connected to PAIGE's reasoning)

- **Analytics.** `practice_dashboard_metrics(p_window_days)`, `practice_attention_queue()`,
  `operator_dashboard_metrics`, `issue_analytics_evidence_bundle`, and `get_analytics_daily_summary`
  are period-capable and tenant-derived, but only the UI calls them. **This is the single biggest
  stranded asset for "how are our numbers looking?"**
- **Tenant Systems Check.** 794 runs and 21,715 findings are reachable only through `useSystemsCheck`.
- **Business Vault.** About 9 tables and 31 RPCs exist. `business_vault_get_context` has 0 callers,
  and every table has 0 rows.
- **Governed memory seam.** `record_/get_/forget_paige_memory` and `match_paige_owner_memory` have 0
  runtime callers. Slice 4b is deferred, and S5 is in flight.
- **Sales lists.** `list_sales_invoices`, `list_sales_collection_register`,
  `list_sales_invoice_payment_operations`, `operator_mrr_history(p_days)`, and
  `get_tenant_revenue_breakdown` are UI-only or operator-only.
- **Other UI-only reads.** `threads` (unread and snooze state), `growth_form_submissions`, and the
  marketing-overview period model.
- **Missions.** `business_missions` has full governed write, readback, and receipt substrate, and 0 rows.
  There is no list tool for PAIGE. `campaign_briefs.mission_id` has no writer.
- **Research.** `research_runs` results are never promoted, and `work_id` is never populated.
- **Orphans.** `_shared/session-memory.ts` has 0 importers.
- **Phantom capability.** `integrations.health` is declared with chat tool `integrations_health`,
  but no such tool exists.
- **Trust clamp.** `trust_effective_rung()` (=1) clamps autonomy invisibly. PAIGE cannot state it.

## D. Missing cross-domain contracts (exact)

1. **A period-aware domain read for PAIGE.** No domain exposes "what happened in [start,end)" to the
   Harness. Phase 2 below owns the contract. Each domain owns its read.
2. **Rail outcomes by window.** `paige_workspace_events` is service-role only, and there is no tenant
   read of "capability outcomes in [start,end)". This needs a domain-owned read RPC.
3. **Receivables and collected-in-period.** No receivables or aging read exists, and no
   collected-in-range read exists (a pg_proc regex search for receivab, aging, and collected matched
   nothing relevant).
4. **Comms by window.** `list_inbox_messages` has no since/until and a cap of 50. Inbound SMS never
   reaches `messages`.
5. **Bookings read.** No tenant read of upcoming or past bookings is exposed to PAIGE.
6. **Trace ↔ receipt ↔ meter join.** `llm_trace_id` is never written on receipts, and nothing is
   metered (§67 M1).
7. **Game Plan targets.** There is no canonical goal, target, or KPI structure. Missions carry no
   metric linkage. See H.
8. **Business-wide memory scope.** See G.
9. **Intent-aware context selection.** Every block loads on every turn. See E and F.
10. **Spine registration** for reads PAIGE already performs: tasks, plans, knowledge, research, and
    business-profile writes.

## E. Context Assembly adoption status

- `_shared/paige-context/mod.ts` has **one** production importer: `client-context.ts`
  (`resolveUserContext`). `paige-ai-chat` imports only `vp-address.ts`. The contract doc is still
  marked PROPOSAL, with its maturity gate PROOF OWED.
- About 25 context blocks are inline string builders in `paige-ai-chat`. 18 of them catch to empty or
  fall back to a default: persona defaults to neutral (`:2374`), the working tenant defaults to null
  (`:3315`), departments default to "legacy 2" (`:3336`), and memory, RAG, KB, team, business-context,
  social, mission, focused-client, sender, and rail-hydration blocks warn and continue.
- **Assembly is load-everything.** Every block is built before the model-tier decision, and only
  tenant, tier, funding, studio, and surface flags gate it. The Turn Route is not consumed on `main`.
  R4 is unmerged.
- **New rule this fabric enforces (contract §3.4):** every new source ships as a typed resolver. The
  Business Operating Snapshot is a typed, intent-selected source by construction. It runs only when a
  turn asks for a business review.

## F. Exact Chat ↔ Live shared-runtime path

**Typed Chat:**

1. `PaigeAIChat.tsx:1487` sends `POST /functions/v1/paige-ai-chat` with the caller's JWT.
2. The runtime validates the request (`:1120`) and resolves the actor tier (`:1985`).
3. It assembles context inline (`:1990-6060`).
4. `toolDefs` holds 95 tools plus domain arrays (`:6149`, `:7809-7819`), and every model call receives
   all of them. Only Studio narrows the set.
5. The model tier comes from a regex plus the foreground offer (`:9006-9051`). It does not come from
   the Turn Route yet.
6. The tool loop runs, gated on finished rounds (R7a), followed by a tools-free stream (`:16772`).
7. The turn is persisted through `paige_chat_turn_append`, and receipts are written through
   `recordCapabilityRun`.

**Spoken Live:**

1. `paige-live-session` resolves the tenant, applies the pilot predicate, and issues a ticket.
2. `paige-live-relay` opens a WebSocket. Flux transcribes the speech. The relay signs a challenge
   (session, tenant, actor, thread, epoch, transcript hash) and sends `runtime.dispatch`.
3. The browser calls **the same** `handleSend` → `paige-ai-chat` with `liveRuntimeChallenge`.
4. `paige-ai-chat` verifies the challenge and refuses approvals, resume, documents, and attachments
   (`:1146`). It re-checks the tenant and the pilot predicate, then claims the slot.
5. It rebuilds history from `paige_chat_turns` (49 turns). It strips clientContext, surfaceContext,
   canvas, and businessMissionId (`:1189-1193`).
6. It runs the same `toolDefs` and gates inside a Live tool-decision phase (`:9433`), then a tools-free
   answer.
7. The signed proof stream goes to the relay, and ElevenLabs speaks it.

**Divergences:**

- Live has reduced input context, and no ask, offer, resume, or claim-guard branches.
- Live writes no receipts or metering of its own (relay `:308` is a no-op).
- Agency and sub-account tenants are excluded from Live.
- Phone/SIP, inbound email or SMS, and automations do not reach the runtime at all.

**Consequence for this fabric:** a read capability added once to `paige-ai-chat`'s tool set is
reachable from typed and spoken turns identically, with the same tenant, period resolution,
authority, and answer semantics. Only presentation differs: spoken style and tools-free speech.
**No Live-specific path is needed or allowed.**

## G. Business-wide shared-memory scope gap

**What exists.** `paige_owner_memory(tenant_id NULLABLE, user_id NOT NULL, created_by, …)`.

- RLS returns own rows only (`user_id = auth.uid()`).
- `get_paige_memory` and `match_paige_owner_memory` scope by `auth.uid()` and
  `current_user_tenant_id()`.
- In-flight branch `s5-owner-memory-cutover` moves the owner's own preferences from `client_memory`
  into `paige_owner_memory`, keyed (user, tenant). It extends the `record_paige_memory` vocabulary with
  `milestone_completed`, `open_loop`, and `report_upload`.

**The gap.** Every row has an owning `user_id`, and only that user can read it. So a business fact
("our average deal is $4k", "we stopped offering X") that the owner tells PAIGE becomes the **owner's
personal memory**. A teammate's PAIGE cannot see it. If that seat leaves, the business loses it.
Performance lessons have the same problem. Moving a row to "tenant_id set" does not fix this,
because RLS still keys on `user_id`.

**Safe canonical design (proposal; it needs an owner ruling on the audience rule; no migration in
this PR):**

| Audience | Subject key | Who may read | Who may write | Store |
|---|---|---|---|---|
| Personal owner memory | (tenant, user) | that user only | that user or the server for that user | `paige_owner_memory`, as today |
| Workspace / business memory | (tenant), `subject_kind='workspace'`, `user_id` = **attribution only** | active members of the tenant whose role passes a memory-read predicate | owner/admin, or a member's proposal confirmed by owner/admin | same table, a new `audience` column (`personal`/`workspace`/`performance`) with RLS branching on it. **No second store.** |
| Business-performance memory | (tenant), `audience='performance'`, sourced from receipts and metrics with evidence references | same as workspace | **server only**, derived from Rail/metrics evidence, `confirmation_state='proposed'` until confirmed | same table |
| Client memory | (tenant, client) | per-client relationship scope (existing `client_memory` + INT-326) | as today | `client_memory`, as today |

Invariants:

- No fake users.
- No `user_id` reuse as a tenant key.
- RLS is never weakened for personal rows.
- A personal row is never auto-promoted. Promotion to workspace is an explicit, receipted act
  (propose → owner/admin confirm), and the original author is kept as attribution.
- On seat removal, personal rows follow the existing deletion path. Workspace rows stay with the
  business.
- **Sequenced strictly after S5 merges**, because S5 owns `record_paige_memory`'s body.

## H. Game Plan / goals / milestones / missions — current state

- **Canonical and reusable:**
  - `business_missions`: title, lifecycle, next action, closure outcome, revision.
  - `business_mission_brief_versions`: immutable versions with desired outcome, deadline, baseline,
    strategy, constraints, success definition, assumptions, and revision reason.
  - `business_mission_mutation_receipts`: idempotency.
  - Spine `business_mission.create/revise/transition`, with chat tools.
  - **Prod: 0 missions ever.**
- **Horizon plans:** `plans` (scope, horizon week/month/quarter/year) and `plan_items`
  (milestone/task/reminder). Plans have 0 rows and plan items have 4. The chat tools are not
  Spine-registered and are not linked to missions.
- **Absent:** strategic goals, numeric targets, KPIs, pillars, and bets, plus mission ↔ metric
  linkage and performance evidence per mission. The Solo Game Plan UI *derives* priorities from setup
  gaps and Systems Check. Nothing stores them.
- **Rule:** strategy is not encoded into generic Memory. The missing piece is a canonical **target**
  structure: target (mission-scoped, metric reference `<domain>.<metric>` from the snapshot contract,
  period, baseline, desired value, revision). The snapshot can then report progress against it. That
  is a **new table plus RPC**, which is a material product decision. It is named here and not built
  (see L, F8).
- **Snapshot linkage now:** the `game_plan` domain adapter reports live missions (state, next action,
  deadline) as point-in-time facts. It invents no targets.

## I. Standard Domain Snapshot contract (implemented: `_shared/paige-context/snapshot.ts`)

```text
DomainSnapshot {
  domain        one of SNAPSHOT_DOMAINS (revenue, sales_pipeline, clients, payments, communications,
                email, sms, support, social, paid_acquisition, campaigns, events, bookings, reviews,
                work, game_plan, operations, outcomes, knowledge, research)
  owner         the owning lane/system (the domain owns its numbers)
  period        the SnapshotPeriod it was asked for (validated equal)
  as_of         when the domain read happened
  freshness     live_read | snapshot
  coverage      full | partial  (+ coverage_note REQUIRED when partial, e.g. "capped at 50")
  headline[]    SnapshotMetric { key '<domain>.<name>' (namespace enforced), label, value|null,
                unit count|currency_minor|percent|ratio|days, currency (iff money),
                basis in_period|point_in_time|all_time, window_note }
  changes[]     material changes the DOMAIN computed (never the composer)
  outcomes[]    Rail outcomes { capability_key, succeeded, failed, reference }
  risks[]       { kind, summary, severity info|watch|act, reference }
  upcoming[]    { kind, at, summary, reference }
  goal_links[]  { mission_id, relation advances|threatens|context }
  sources[]     provenance (≥1): { system, adapter, reference }
}
```

**Why this is not false uniformity:**

- Metric keys are domain-namespaced, and only the domain adapter defines them.
- `basis` separates "in the period" from "right now" from "all time".
- `window_note` states when a domain could only measure a rolling window.
- `coverage` states truncation.
- The composer never adds, compares, or ranks across domains.
- Each adapter returns `ContextSourceResult<DomainSnapshot>`, so `unavailable` and `degraded` carry
  reasons, per the Context Assembly Contract.

## J. Business Operating Snapshot contract (implemented: same module)

```text
BusinessOperatingSnapshot {
  version 1; tenant_id; actor_id; account_shape        ← resolved ONCE (ContextIdentity)
  period                                               ← resolveSnapshotPeriod(today | last_7_days |
                                                         last_30_days | current_quarter | custom ≤366d)
  composed_at; requested[]                             ← selectSnapshotDomains(focus) — intent-scoped
  domains: { [domain]: available | unavailable | degraded (+reason) }
  degradation[]                                        ← degradationLedger (never silent)
  budget { adapters_run, timed_out[], truncated[] }    ← bounded: maxDomains, per-adapter timeout
}
```

**Composition rules:**

- **Fail closed.** No workspace makes every domain `no_workspace`. A scope-epoch change makes every
  domain `scope_changed`. In both cases nothing runs.
- **Adapters are bounded.** Adapters run concurrently, each with its own timeout and abort. A thrown
  error becomes `adapter_error`, and the message is never leaked. A malformed snapshot becomes
  `invalid_shape:<reason>`.
- **Missing domains are named.** A domain with no substrate gets a grounded NOT-CONNECTED reason
  (ads, reviews, events, sms, social results, support tickets). A domain with no adapter yet gets
  `no_adapter`.
- **The projection is built LAST and bounded.** Every unavailable area appears as a NOT AVAILABLE
  line. The closing instruction forbids estimating, and states that an unavailable area is unknown,
  not zero. `maxChars` budgets the domain sections only. The header, the "left out for length" line,
  and the instruction are never dropped, and areas left out for length must be named as unknown.
- **Adapter text cannot forge the projection.** The validator refuses control characters
  (`control_chars`), and the projection collapses every adapter string to one line. A free-text
  reason from an adapter never reaches the model. Adapter reasons pass through only as closed codes
  (`[A-Za-z0-9_:.-]`, ≤120 characters). A code that collides with a composer code is prefixed
  `adapter:`. Anything else becomes `adapter_reason_unreadable`.
- **Hostile or broken adapters cannot break the composer.** A throwing getter, a null adapter, or a
  malformed result degrades to `invalid_result` or `adapter_error`. No error text is ever surfaced.
  `timeoutMs` is clamped to 60s, and `maxDomains` is floored and capped at 20.
- **Periods are strict.** ISO instants are digit-checked, so `2026-02-30T00:00Z` is refused. Only
  IANA zones are accepted, and raw offsets are refused. A day whose local midnight does not exist
  (Santiago, Havana, Beirut, Cairo DST) starts at its first real instant. The verifier brute-forced
  every IANA zone around the 2025–2027 DST changes and found 0 mismatches.
- **`previousPeriod(period)`** gives the equal-length prior window for "what changed since last
  time". This is the proactive seam (below), not built as a job.

**Who consumes it:** one read-only Spine capability, `business.operating_snapshot`, offered as one
Chat tool. Live reaches it through the shared runtime, so a spoken "give me a read on the last week"
and its typed equivalent resolve the same tenant, period, domains, authority, and semantics. The
Intelligence Router decides **which model** reasons over it. This fabric decides **what context** that
is. R8, when built, should expose this tool on a `research: none, intent: answer, tools: read` route
for business-review turns, and not on acknowledgements.

**Proactive future (designed, NOT built, needs separate authorization):** a bounded Harness job
composes `composeOperatingSnapshot(previousPeriod(p))` and the current period, and lets each domain
report its own `changes[]`. The composer never diffs. Outputs (daily briefing, weekly review,
goal-at-risk, unusual movement, upcoming deadline, collections risk) become proposals on the existing
action bus, never autonomous sends.

**Strategy / learning loop (designed, sequenced after targets exist):**

1. Canonical performance (snapshot).
2. Rail outcomes.
3. Performance memory (audience `performance`, server-derived, proposed).
4. Deep Research results (provisional; promoted only as an opportunity, risk, hypothesis, or proposed
   play).
5. A proposed Game Plan revision (`business_mission.revise` or a target proposal).
6. Owner confirm, on the existing approval path.
7. Execution.
8. New measured outcomes.

Research never becomes internal truth automatically.

**Omnichannel support (designed):** an inbound email, SMS, or phone turn should compose the client
canonical record, `client_memory` for that client, comms history, account and payment state, KB/SOP
retrieval, workspace memory, channel readiness, and authority. This uses the same typed-source bundle
as Chat. Today **none of these entry points reaches the runtime** (F). Adding one is a Harness
entry-point slice, not a new memory or context system.

## K. Collision map

| Lane | What it owns | Collision with this fabric | Resolution |
|---|---|---|---|
| Intelligence Router INT-334 (R4 branch `claude/confident-lovelace-mi714v`; R5–R8) | model and class selection in `paige-ai-chat` (`substantiveTurnIntent` replacement), `paige-turn/classify*.ts`, R8 tool narrowing | Fabric adds one tool and a dispatch branch; R4 edits model selection. No line overlap expected. R8 will narrow `toolDefs`. | Fabric never selects models. It exposes `business_review` as a read tool for R8's route table to include or exclude. Sync main before merge. |
| Memory S5 (`s5-owner-memory-cutover`) + INT-326 | owner/workspace memory cutover, `record_paige_memory` body, memoryBlock region of chat | G's workspace and performance audiences change the same table and RPC | Fabric ships **no memory code**. G is a proposal sequenced after S5 merges and needs an owner ruling. |
| Deep Research R-series (R3–R6, `docs/research-quality`) | `paige-deep-research`, dossier, cognitive-class map for research phases | The `research` domain adapter would read `list_workspace_research` | Read-only, later slice. Research results are reported as provisional, never as business facts. |
| Conversational Loop C0–C4 (C4d/e paused) | turn contract, approvals, resume, claim guard | The tool is a read with no approval card. Live already refuses approvals. | None. A read needs no loop changes. |
| Sales / Payments lane | `sales_invoice.*`, `sales_collections.*`, list RPCs | The `payments` adapter needs a period read the lane does not expose to PAIGE | The adapter reports `no_adapter` until the lane ships a domain-owned period read. Fabric does not query invoice tables directly. |
| Communications (INT-328, comms substrate) | `messages`, `comms.*` | The `communications`/`email` adapters need a windowed read | Interim: email outcomes via the Rail outcomes read. Window read belongs to the comms lane. |
| Game Plan / Missions | `business_mission.*` | The `game_plan` adapter reads `list_business_missions` | Read-only. Targets are a new structure that needs a ruling. |
| Context Assembly (first adopter `client-context.ts`) | `_shared/paige-context/mod.ts` | Fabric adds a sibling module that **reuses** mod.ts types | Extends the seam, does not edit it. |

## L. Bounded PR sequence

| # | Slice | Touches | Gate |
|---|---|---|---|
| **F1** (this PR) | Phase 0 map + contracts (this doc); the pure seam `_shared/paige-context/snapshot.ts` (periods, DomainSnapshot validator, NOT-CONNECTED register, composer, projection) + tests | docs, one new `_shared` module, one test | no runtime change |
| **F2** | First adapters over **existing** tenant-derived reads: `sales_pipeline`/`clients`/`revenue` ← `practice_dashboard_metrics(p_window_days)`; `work`/`operations` ← `practice_attention_queue()` (+ tenant `systems_check_snapshot`); `game_plan` ← `list_business_missions`. Register Spine read `business.operating_snapshot` (chatBinding PARTIAL); one chat tool `business_review` + dispatch, caller-JWT client with the persona-tenant == `current_user_tenant_id()` bracket (the `pipelineWorkspaceRead` precedent) | `_shared/paige-context/adapters/*`, Spine domain file, `paige-ai-chat` (tool push + dispatch only) | unit + registry lint; authenticated Chat drive owed; Live drive owed |
| **F3** | Domain-owned windowed reads: Rail outcomes in [start,end) (SECURITY DEFINER, tenant from `current_user_tenant_id()`, §59 in-body check); bookings in window; comms counts in window | one migration per owning domain + adapter | §32 persisted-apply; §37 producer inventory |
| **F4** | Payments period read (receivables, collected in period, overdue) by the Sales lane, consumed by the `payments` adapter | Sales lane migration + adapter | lane owner |
| **F5** | Context Assembly: move the snapshot and two inline blocks (business-context, team-authority) to typed resolvers selected by the Turn Route once R4 merges | `paige-ai-chat` context region | after R4 |
| **F6** | Workspace and performance memory audiences (G) | `paige_owner_memory` + RLS + `record_paige_memory` | **owner ruling**; after S5 |
| **F7** | Game Plan targets (H) + snapshot progress-against-target | new table + RPC + Spine | **owner ruling** (material product decision) |
| **F8** | Proactive "what changed" Harness job | durable-job + action bus | **separate authorization** |
| **F9** | Omnichannel entry points (inbound email/SMS → runtime) | Harness entry | after comms windowed reads |
