# Paige Runtime Harness — Completion Map

**Grounded against `main` @ `6aa077d`, 2026-09-12. Read-only survey by a five-agent grounding crew
(one substrate + four domain). The owner's required first deliverable of the Harness Completion Program
(standing directive 2026-09-12).**

**Primary lens = the owner's seven Harness layers (A–G).** §4 is the concise layer-state map the
directive asks for (which layers are real / partial / absent, their exact code+data seams, shared
dependencies, next phase). §5 is the per-domain installation-contract detail behind it. Per the
directive's §7 (as of the 2026-09-12 survey), this Map was produced and the program then ran
**phase by phase under Gate A** — no manufactured approval pause.

> **STATUS UPDATE 2026-09-13 (owner-ruled) — the Harness Completion Program is COMPLETE; active Harness
> construction has STOPPED.** The final Harness-owned slice was the `match_paige_memory` §53/§59
> authority-correctness fix (PR #1233, `0060f575`; decision-log 2026-09-13). This is a
> **construction-program** status — NOT a claim that every A–G layer is verified/LIVE. **The per-layer
> states in §4/§5 below remain exactly as recorded (several PARTIAL), and are the source of truth for
> per-layer reality.** The remaining layer work is parked for its own workstreams (Marketplace,
> Financial Integrations, provider activation, R2b wrapper-closure, R3b rest-of-c1/c2). Remaining Harness
> involvement is support/review only. The §10 "immediate next action" plan below is therefore
> **superseded** and retained only as the pre-completion record.

## 0. What this document is — and what it is NOT

This is a **navigation and sequencing synthesis** over the platform's existing canonical records. It
is **not a parallel registry** (§18) and it stores no new source of truth. Every state claim below
resolves to a canonical home that already owns it:

| Canonical home | What it owns | Path |
|---|---|---|
| **Spine registry** | the governed capability verbs | `supabase/functions/_shared/paige-spine/registry.ts` |
| **Action-risk classifier** | the risk class + autonomy lane of every mutation | `supabase/functions/_shared/action-risk.ts` |
| **Binding ledger** | per-surface proven state + completion target + next slice | `docs/binding-ledger/README.md` + `surface-binding-ledger.json` |
| **Integration registry** | per-provider capability, lane, proof, limits | `docs/integration-registry/integration-capability-registry.json` |
| **Native-event bus** | the transactional event outbox + dispatcher + process records | `supabase/migrations/20270119000000_*`, `20261022000000_*`; `supabase/functions/paige-native-event-dispatch/index.ts` |
| **Receipt / Rail contract** | the evidence model | `docs/brain/paige-receipt-rail-contract.md`; `_shared/capability-record.ts` |
| **Master reference** | SHIPPED / GAPPED truth | `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §4/§5 |

**The rule this Map obeys (§18 / owner correction 2026-09-12):** *"Do not create a parallel registry.
Extend or reconcile existing canonical records only after actual delivery changes truth."* When a phase
below ships, it updates the **binding ledger row / Spine registry / integration registry / master doc**
in the same PR — this Map is re-derived from those, never the other way round.

---

## 1. The one-line state of the Harness

**The governed *request* path exists and is honest; the governed *event→action* path does not exist
yet.** Paige can act when a human asks her in chat (through the action-risk gate, with receipts and
per-client Rail), and the binding ledger truthfully records that **no surface is `LIVE`** — every
wired surface is `PARTIAL` / `PROOF_OWED` pending an authenticated drive. But **nothing Paige or the
platform does fires a governed act autonomously**: the event bus delivers and records, then stops at
the act boundary. That single gap is why the owner's reference vertical (a new contact → a governed
Telegram alert) is air from link 4 onward, and it is the keystone of this Map.

---

## 2. THE KEYSTONE — the act-execution engine is missing (confirmed by all four domain surveys)

Two adjacent, fully-diagnosed gaps block consequential autonomy across **every** domain. They are the
same keystone seen from two sides.

### 2a. The native-event dispatcher executes no acts
`paige_native_events` (transactional outbox) → `paige-native-event-dispatch` (drainer) **delivers
events to matched `paige_automations` subscribers and records delivery, then writes
`result.acts_executed:false`** (`paige-native-event-dispatch/index.ts:13-19,128-152`). Concretely it:
- **evaluates no `conditions`** — explicit `TODO F3` (`:131-134`);
- **resolves no `granted_lane`** (the §67 auto|confirm|off grant on the process record);
- **applies no Trust-Compass ceiling / authority decay** (§67/§68);
- **routes no approval, meters no budget, runs no `paige_automation_acts`**;
- **emits no receipt and no Rail** (`:19` — "the owner-facing Rail projection are the next increments").

So the substrate is production-solid up to delivery and **deliberately inert at the act boundary**. It
also has **exactly one live producer** — `contact.created` (`20270119000000:30`). `conversation.call_ended`
and `record.lifecycle_moved` are catalogued but **dark** (`20261022000000:266-274`).

### 2b. The RE-2 autonomy execution lane is fully built but dark (no PR-3 consumer)
The standing-grant substrate (`20261230000000_re2_execution_substrate.sql`), the policy-aware
floor-lift resolver (`20261231000000_re2_policy_aware_resolver.sql` — its own header: *"ZERO
producers … unwired oracle"*), and the money/scope caps (`20270102000000`, `20270103000000`) all ship
**with no execution loop consuming them**. Every `high` action still clamps to `confirm` at runtime;
the campaign/client spend caps are refused wholesale. So even once an event *could* trigger an act,
there is no lane that lets it run **under a standing grant** rather than a fresh human confirm.

### Why this is THE keystone
The per-surface binding ledger (Phases 2–8) asks, surface by surface, *"can Paige act here when a human
asks?"* The Harness-completion question the owner is now asking is broader: *"can the platform act on
its own, under governed process grants, when something happens?"* **2a + 2b are the one build that
turns `contact.created` — and every future event — from a dead letter into an actual governed
process.** It is the common multiplier named as the #1 highest-leverage gap by **all four** domain
surveys independently.

**It is an EXTENSION, not a new system (§18).** The executor it calls is the one the governed door /
chat already use; the grant/lane primitives already exist (`paige_automations`, `paige_automation_acts`,
RE-2 caps, action-risk classes, Trust-Compass, `record_capability_run`, `record_rail_event`). The event
bus becomes a **second caller** of the same governed execution seam chat is the first caller of — the
exact shape §10/§18 prescribe ("the UI is one caller of the seam; Paige is another").

---

## 3. The reference vertical — Telegram contact-alert, link by link (the owner's required worked model)

Owner's model flow: *new contact → `contact.created` → subscription/rule → eligibility/authority/budget/
approval → approved n8n OR Telegram → governed alert → provider confirm/fail → fresh readback → receipt +
Rail → Paige explains.* Exactly what exists today:

| # | Link | State | Evidence |
|---|------|-------|----------|
| 1 | Genuine contact creation | ✅ **SHIPPED** | `create_contact_v2` returns `was_created` (insert vs resolve), tenant+email dedup — `20270118000000:23-102`. |
| 2 | Canonical `contact.created` event | ✅ **SHIPPED** (#1145) | `trg_clients_emit_contact_created` AFTER INSERT → transactional outbox row in `paige_native_events` (dedup key, §9-minimal payload, rolls back loudly on failure); catalogue row `is_live=true`; 5-min `pg_cron` sweeper backstop; atomic service-only claim ledger — `20270119000000`. |
| 3 | Subscription / automation rule | ⚠️ **SUBSTRATE ONLY** | `paige_automations` (§67 process record: `trigger_key`, `state`, `conditions`, `granted_lane`, `acts_fingerprint`) + ordered `paige_automation_acts` — `20261022000000:65-118`. Drainer *reads* matching subscribers (`:104-114`). No proven authoring path for a contact.created→Telegram process yet. |
| 4 | Eligibility / authority / budget / approval eval | ❌ **MISSING** | The drainer evaluates nothing (TODO F3). → **Keystone 2a.** |
| 5 | Execute the approved act | ❌ **MISSING** | The drainer runs no `paige_automation_acts` and sends nothing. → **Keystone 2a/2b.** |
| 6 | Governed Telegram alert | ❌ **MISSING as governed capability** | `send-telegram/index.ts` exists but is a **platform-operator side path**: single-row `paige_telegram_config`, env token, **no tenant scope**; **not** in the Spine registry, **not** in `action-risk.ts`, **not** an `action_kind`. Registry lists Telegram only under `uncatalogued_wired_providers` (`integration-capability-registry.json:1397`). |
| 7 | Confirm/fail → readback → receipt/Rail → Paige explains | ⚠️ **PARTIAL (honest absence)** | Readback exists: `get_contact_event_status` (SECURITY INVOKER, RLS, authenticated-only) returns `subscriber_count`/`delivered_count`/`error_count` — `20270119000000:112-145`. It honestly reflects `acts_executed:false`, so Paige can truthfully say *"the event fired and reached N subscribers,"* **never** *"an alert was sent."* No Rail/receipt on the dispatch path. |

**Verdict:** Links 1–2 are production-solid; link 3 is substrate-present-but-inert; **links 4–6 are
entirely unbuilt; link 7 is a clean event readback with no act-level confirmation.** The terminal
connector (link 6) has two honest routes and this Map recommends the first:
- **Route A (recommended):** route the "governed Telegram alert" through the **already-governed n8n/Zapier
  runner** — n8n is fully governed twice over (Spine `N8N_MANAGEMENT_CAPABILITIES` chatBinding LIVE;
  action-bus `high` with capability-run Rail + delivery truth-table + `execution_get` readback in
  `paige-n8n/index.ts:283-324`). This satisfies link 6 **today** with zero new provider surface.
- **Route B:** register Telegram as a **tenant-scoped, Spine-governed `external_effect` connector**
  (action-risk class + `action_kind` + per-tenant config + Rail), copying the n8n governance template.
  More work; only needed if direct Telegram (not via n8n) is required.

Proving this one vertical end-to-end **is** the completion proof for the keystone (§2).

---

## 4. The seven-layer completion map (A–G) — real / partial / absent

The directive's seven layers, each with present state, the exact code+data seams, shared dependencies,
and the next complete phase. "EXTEND" marks where the substrate exists and the work is wiring (§18),
never a new system. **State is honest per §13/§32 — a UI/tool/registry entry never counts as real.**

| Layer | What it is | State today | Exact seams | Shared dependency | Next complete phase |
|---|---|---|---|---|---|
| **A — Universal execution kernel** | one shared execution-decision contract (re-resolves tenant/workspace/actor/role/capability/entitlement/connection/authority/approval/autonomy/budget/evidence/risk) across Chat · MCP · jobs · automation · specialists | **PARTIAL — in flight (#1157).** The pieces exist for the *chat* caller (action-risk gate + autonomy clamp + receipt); MCP door is deny-by-default; jobs/automation/specialists do **not** re-resolve through one shared contract. | `paige-ai-chat/index.ts` action-risk gate (~8020) · `_shared/action-risk.ts` · `resolve_tool_autonomy`/`resolve_automation_autonomy` · `governedExecution.ts` (MCP door) · RE-2 resolver (dark) | **PR #1157 "Unified Governed Execution" owns this — do not duplicate.** | Adopt #1157's kernel as the single contract every other layer calls. |
| **B — Capability truth + Gateway** | tenant-specific capability manifest; Chat exposes only admissible capabilities | **PARTIAL/ABSENT — in flight (#1157).** The capability-truth substrate exists (Spine registry + binding ledger + integration registry) but there is no unified per-tenant manifest a Gateway reads. | `registry.ts` · binding ledger · integration registry · `capability-policy.ts` | **PR #1157 "Capability Gateway Foundation" owns this.** | #1157. |
| **C — Event + automation fabric** | platform events → governed acts, durable + retried | **ABSENT at the act boundary — THE KEYSTONE (§2).** Outbox + claim ledger + process records + one producer (`contact.created`) are production-solid; act-execution, condition eval, grant/lane resolution, Trust-Compass clamp, receipt/Rail are **not built**. | `paige-native-event-dispatch/index.ts` · `20270119000000_*` · `20261022000000_*` · `paige_automations`/`_acts` · RE-2 substrate | **consumes A/B (#1157)**; reuses Action Bus / n8n runner / Rails | EXTEND the dispatcher into the governed act-execution engine (calls the kernel) + a producer set from existing governed writes. |
| **D — Specialist runtime** | bounded workers as members of one governed system | **PARTIAL — substrate, not wired.** `paige_subagents` registry + `delegate_to_subagent` + sub-agent edge fns exist; specialists do **not** re-check the execution kernel and cannot be dispatched by an event/process. | `paige_subagents` · `delegate_to_subagent` · sub-agent edge fns | Layer A (a specialist must re-check the contract when it acts — §14) | route specialist acts through the kernel; let a process act dispatch a task-scoped worker. |
| **E — Always-on operations** | schedules · durable jobs · retries · leases · monitoring · recovery | **PARTIAL.** `pg_cron` sweepers (reminder crons, 5-min event sweeper backstop), durable `pg_net` post, atomic claim/complete/fail ledger exist; no bus monitoring/alerting, no scheduler→process path, no stale-work/escalation/recovery loop. | `pg_cron` crons · `paige_claim_event`/`_complete_`/`_fail_` · `pg_net` | Layer C (acts must execute before a run-loop means anything) | once C executes acts, add the continuous run-loop + health/stale detection + pause/resume/cancel/retry/revoke controls. |
| **F — Owner orchestration surfaces** | runtime evidence in Chat + Command Center (never decorative) | **PARTIAL — read seams only.** Readbacks exist (`get_contact_event_status`, `execution_get`, capability-run receipts); no consolidated runtime-evidence seam. | `get_contact_event_status` · `execution_get` · `record_capability_run` · `record_rail_event` | Layers C/E (real runtime to surface) | **CC builds the runtime-evidence *read seam* + interaction contracts + deep-link targets; Claude Design owns the visual (§00).** No dashboard until runtime is real (§32). |
| **G — Proof / evaluation / controlled learning** | authenticated verification path + evals + proposal-only learning | **PARTIAL — blocked on one owner action (§7).** `improvement_propose`/`_decide` loop LIVE + gated (#1152); §33 visual-critique gate; `paige_llm_trace` observability; `liveDrive` exists but the authenticated lane is blocked on test-tenant provisioning. | `scripts/live-drive/live-drive.mjs` · `improvement_*` · §33 gate · `paige_llm_trace` | **the one owner action** (test tenant + CI secrets, §7) | flow-definition framework + evidence/attribution + negative tests; discharges the B/C authenticated PROOF_OWED. |

---

## 5. Per-domain assessment — all twelve domains (7 points each)

State tags are the binding ledger's (`LIVE`/`PARTIAL`/`PROOF_OWED`/`UNAVAILABLE`/`INTENTIONALLY_ISOLATED`).
The recurring "missing automation path" and "dark act-execution" entries all resolve to **Keystone §2** —
noted once per domain rather than re-argued.

### 5.1 Command Center + Strategic Plans / Missions — ledger `PARTIAL`
1. **Capabilities:** `mission_create`/`mission_revise`/`mission_transition` (LIVE, chat-bound, Spine `business_mission.*`, RPC + `business-mission-action` executor); `plan_*` (create/milestone/assign/update/remove/reminder/list); action bus `action_file`/`_advance`/`_get`/`_list` + `propose_action`; `improvement_propose`/`_list`/`_decide`; reads `capability_status`, `get_client_rail`.
2. **Missing adapters:** no governed mission **list/read** verb; no plan↔mission **sequencing/link** verb; Systems Check remediation has no governed action (needs SCR-2+SCR-3); Mind tab has no Memory-write seam (#647).
3. **Missing events:** `mission.created/.transitioned/.completed`, `plan.created/.milestone_completed/.reminder_due`, `improvement.proposed/.decided` — none exist; mission/plan lifecycle is invisible to the bus.
4. **Missing automation:** nothing can subscribe to a mission/plan change (→ §2).
5. **Authority/budget:** well-governed — missions `high` (rendered approval card), `plan_remove_item` `high`, `improvement_decide` `high` (closed a live bypass, #1152), `automation_set_grant`/`_state` `owner_only` (§67). Budget via `router-budget`.
6. **Receipts/Rails:** missions record a capability-run receipt; **PARTIAL** — per-client Rail only fires when a write resolves to a `contactId`, so workspace-level missions/plans get the receipt but no Rail row; detailed-receipt correlation is PROOF_OWED.
7. **Next phase:** drive the authenticated signed-in owner Mission flow end-to-end (create/revise/transition → canonical readback → matching capability-run Rail row, workspace-switch, denied-role) → `PARTIAL`→`LIVE`. (Binding-ledger Business Game Plan MVP, owner-approved 2026-09-06.)

### 5.2 Clients / CRM / Contacts / Lifecycle — richest domain; `campaigns.pipeline` `PROOF_OWED`, `clients.people` `UNAVAILABLE`
1. **Capabilities:** contacts (`crm_create_contact`→`create_contact_v2`, `crm_update/delete/search`, `crm_get_contact_summary`, `crm_propose_contact_update`); notes/tasks/activity (`crm_add_note`, `crm_*_task`, `crm_log_activity`); relationships (`crm_assign_coach/_contact`, `crm_list_team`); lifecycle/journey (`crm_update_lifecycle_stage`, `crm_advance_journey_stage`); deals/pipeline (`deal_create`, `deal_move_stage`, `crm_update_pipeline_stage`, `pipeline_configure`, Spine `pipeline.deal_stage_evidence`); docs (`crm_file_document`, `crm_list_documents`).
2. **Missing adapters:** no merge/dedupe or bulk verb; no relationship-graph seam; the **Clients→People owner-UI edit emits no Rail (#757)** — a §10 dead-end that doesn't even receipt.
3. **Missing events:** `contact.created` LIVE; `pipeline.stage_changed` LIVE (via the *legacy* `stage_automation_events` path, not the new bus). Missing: `contact.updated/.deleted/.assigned`, `deal.created/.won/.lost`, `task.created/.completed`, `journey.stage_advanced`. **Tension:** `record.lifecycle_moved` is DARK yet the lifecycle/journey mutations exist and fire nothing.
4. **Missing automation:** the one live loop is pipeline-specific (`stage_automation_rules` → `dispatch-stage-automation`). `contact.created` delivers to subscribers but acts don't execute (→ §2).
5. **Authority/budget:** cleanly tiered — destructive/relationship/client-visible `high`; routine `ordinary`. Budget via router-budget.
6. **Receipts/Rails:** best-covered — CRM + action tools emit a per-client Rail row (`owner.crm_mutation`/`owner.action_taken`) **plus** a capability-run receipt. Gap: owner's own in-UI edits emit no Rail (#757).
7. **Next phase:** produce one real `pipeline.deal_stage_moved` Rail row + the authenticated pipeline-move drive → `campaigns.pipeline` `PROOF_OWED`→`LIVE`; then emit `record.lifecycle_moved`/`deal.*` events from the existing governed writes so CRM state can drive automation (feeds §2).

### 5.3 Campaigns / Pipeline / Forms / Funnels / Lead Capture — `campaigns.campaign-brief-planning` `PARTIAL`, rest `UNAVAILABLE`
1. **Capabilities:** campaign **briefs** (planning-only: `campaign_brief_create/_revise/_list`, Spine `campaign.*`, explicitly *intent, never proof a campaign launched/spent*); pipeline/deals (as §5.2); funnels/pages (`growth_page_generate`/`growth_funnel_generate` in-memory drafts; `growth_page_save`/`growth_funnel_build` `ordinary`; `growth_*_publish` `high`); a real **lead-capture on-submit spine** — `growth_form_automations` + `growth_submission_dispatches` + `growth-process-submission` + 8 executors (`20260714092000`).
2. **Missing adapters:** no governed **form create/update verb** (`growth_form_upsert` RPC exists but has **no chat/MCP verb and no action-risk class** — a §10 partial dead-end); no campaign **lifecycle** verb (launch/pause/send) beyond the planning brief; thin funnel/page read verbs.
3. **Missing events:** none of `form_submitted`, `campaign.launched`, `funnel.published`, `deal.won`, `lead.captured` are native-bus triggers. Pipeline fires through the **legacy** path, not the new bus (no unified outbox/fire-once/retry guarantees).
4. **Missing automation:** only the forms on-submit spine has real event→rule→executor wiring — and it is a **separate mechanism from the native-event bus** (its own dispatch ledger). Everything else → §2.
5. **Authority/budget:** clean classification for every write (publishes `high`, briefs/drafts/moves `ordinary`); `growth_form_upsert` has **no class at all**; campaign spend cap (RE-2) exists but is refused wholesale / dark.
6. **Receipts/Rails:** every classified write leaves an audit receipt; **Rail rows are per-client only** — campaign briefs, funnels, pages get no Rail (workspace-level).
7. **Next phase:** (`form.submitted` producer shipped 2026-10-11, MBC 4a, `docs/delivery/form-submitted-event-contract.md`; the form's own on-submit automations still run through `growth-process-submission`) promote the forms on-submit spine onto the `paige_native_events` bus as a `form_submitted` producer + give `growth_form_upsert` a classified chat verb — making "a lead fills a form → Paige acts" a first-class subscribable governed process (§67), which is also the cleanest first real producer for §2.

### 5.4 Calendar / Tasks / Reminders / Scheduling — `clients.calendar` `UNAVAILABLE`
1. **Capabilities:** `calendar_book_meeting` (`high` → `create_internal_booking`, default Meetings calendar per workspace, Google OAuth connect); tasks (`crm_create/update_task` `ordinary`, `crm_delete_task` `high`, `plan_assign_task`); reminders/plans with **real firing** — crons `plan-reminder-cron`, `task-reminder-notifications`, `coaching-reminder-cron` claim rows atomically and deliver.
2. **Missing adapters:** **no calendar Spine capability at all** (booking is a chat tool + RPC, not a registered Spine verb with maturity/evidence); no governed reschedule/cancel verb; no availability/free-busy read seam.
3. **Missing events:** `booking.created/.cancelled/.rescheduled` exist as **Rail event types**, not native-bus triggers (`20260712260000`). No `task.created/.overdue/.completed`, no `reminder.fired`. Task-overdue is a cron that sends directly, invisible to the subscription layer.
4. **Missing automation:** zero subscribable scheduling events — the most automation-hungry domain with none (→ §2). Reminder crons are direct senders, not bus producers.
5. **Authority/budget:** well-classified (booking `high`, task/reminder `ordinary`, destructive `high`); no budget dimension. No gap.
6. **Receipts/Rails:** `calendar_book_meeting` has both a receipt and a genuine per-client Rail row (DB booking trigger) — one of the few with both. Reminder *firings* are not receipted on the bus.
7. **Next phase:** the **Calendar Rail/event contract (FU-3)** — promote `booking.*` into the native bus as live triggers with correct attribution (#786), unlocking the Spine calendar capability and the first scheduling automations.

### 5.5 Conversations / Email / SMS — operator SMS works; tenant SMS hard-blocked
1. **Capabilities:** Spine `comms.messages_read` (PARTIAL, envelope-only unified inbox, `inbox_list`); **email send** governed (`comms_send_email`/`_bulk_email`/`_choosing_the_sender`, templates, `comms_add_email_domain` — all `high`, Rail → `email_send_log`), Resend provider, inbound via `handle-inbound-email`/`handle-resend-webhook`; **operator SMS works** (`paige-operator-sms-send/-inbound`, platform master Twilio, §46); `comms_buy_number`/`_name_number`/`_draft_registration`.
2. **Missing adapters:** **tenant SMS send is hard-blocked** — A2P capped `pending`, `createBrand`/`createCampaign` are `needs_config` stubs, no TrustHub onboarding, `send-message` refuses unless `approved` (`docs/brain/comms-capability-map.md`); **no Spine capability for email/SMS send** (only READ registered); no voice/call adapter; Telegram-as-comms-channel absent.
3. **Missing events:** `conversation.call_ended` dark; no `message.received/.sent`/`email.replied` on the bus — inbound lands via provider webhooks and emits no native event, so no inbound comms can trigger a process.
4. **Missing automation:** no comms event feeds the bus, and subscribers can't execute a comms act (→ §2).
5. **Authority/budget:** chat sends are `high` + autonomy-gated, but **no budget/metering clamp** (§67: zero `platform_metered_events` rows) and no Trust-Compass clamp at the event layer.
6. **Receipts/Rails:** chat sends record capability-run receipts, **PARTIAL and uncorrelated** (no join to job/trace/release); event-driven sends have no receipt (they don't happen).
7. **Next phase:** wire the §2 act-execution leg for **email first** (the one tenant channel that can actually send), gated by conditions+grant+Trust-Compass+approval with a receipt; register comms SEND as a Spine capability; add `message.received`/`email.replied` producers.

### 5.6 Integrations / n8n / Zapier / Telegram — `settings.integrations` `PARTIAL`
1. **Capabilities:** **n8n fully governed twice over** (Spine `N8N_MANAGEMENT_CAPABILITIES` chatBinding LIVE; action-bus `high` with capability-run Rail, three-layer delivery truth-table, `execution_get` readback — `paige-n8n/index.ts:283-324`) — but it is a **chat tool, never fired by the event bus**, and has **zero capability_run rows in prod** (ledger). **Zapier** action-bus-governed (`zapier_run_action` `high`, Rail `external_provider`) but **not Spine-registered**. Spine `INTEGRATIONS_LIST`/`INTEGRATIONS_HEALTH`. Connect seams for n8n/Zapier.
2. **Missing adapters:** **Telegram** — no Spine cap, no action-risk class, no `action_kind`, platform-only side path (§3 link 6). Accounting/finance connectors (QuickBooks) have no connected seam (UNAVAILABLE).
3. **Missing events:** no integration events on the bus (`workflow.execution_failed`, `connection.health_changed`); n8n executions are chat-pull only.
4. **Missing automation:** the keystone — the dispatcher executes no acts, so an event cannot auto-fire n8n/Zapier; runs are human-in-chat only (→ §2).
5. **Authority/budget:** chat runs `high`+gated (good); event-driven runs ungoverned because they don't run; no provider-call budget.
6. **Receipts/Rails:** n8n/Zapier chat runs record capability-run Rail — **wired but unproven (zero prod rows)**; event-driven: none.
7. **Next phase:** (Route A of §3) realize the governed Telegram alert through the already-governed n8n/Zapier runner, then build the §2 drainer→runner execution leg + execution/connection event producers; prove the n8n Rail with one authenticated drive.

### 5.7 Social / Vibe Studio / Content / Publishing — `campaigns.social` `PROOF_OWED`, `vibe-studio` `UNAVAILABLE`
1. **Capabilities:** `social_post` (`high`) + reads `social_analytics`/`social_accounts` → `paige-social` (Upload-Post proxy); `update_social_accounts` (`ordinary`); Spine **read-only** `social.presence` (PARTIAL) injected each turn; content/studio generation (`draft_marketing_content`/`generate_image`/`content_save`/`document_generate` `ordinary`, `content-draft`, studio brain loop, §33 visual-critique gate).
2. **Missing adapters:** **the social content pipeline is orphaned** — `20270117000000` created `paige_social_accounts`/`paige_social_posts` (draft→schedule→approve→publish→receipt) and *claims* Spine caps `social.accounts_read/.post_draft/.post_schedule/.post_publish/.analytics_read`, but **none are in `registry.ts`** (only `social.presence`), and `paige-social` never reads/writes those tables. No governed Studio *publish* verb.
3. **Missing events:** no `post.published/.scheduled/.failed`, `artifact.published`, `content.generated` native events. `social.post_publish` exists only as a `paige_action_kinds` entry.
4. **Missing automation:** nothing can subscribe to a publish/generation (→ §2).
5. **Authority/budget:** `social_post` correctly `high`. **Known defect #1154** — `social_post` is governable but **non-functional** (`paige-social/index.ts:102` references undefined `content`; profile/`profile_username` contract mismatch). **#1155** — `paige_social_posts` created twice with divergent schemas, breaking fresh migration replay.
6. **Receipts/Rails:** `social_post` has an audit receipt + a `record_capability_run` receipt; **no Rail row** (publishing to the workspace's own accounts names no contact). Content saves → audit only.
7. **Next phase:** fix #1154 and wire `social_post` to the `paige_social_posts` pipeline (draft→schedule→publish→receipt) with the `social.post_*` Spine caps actually registered — turning a classified-but-broken proxy into the real governed publish lane the migration already designed. **The operator-vs-tenant `paige_social_posts` schema conflict is the gating product decision here — filed as #1161** (the live operator table has no `tenant_id`; two Solo surfaces assume the never-applied tenant schema). P1 (#1155) shipped only a **compatibility bridge** that unbroke fresh replay (owner-approved 2026-09-12); it establishes no tenant-safe Social capability and is expected to be replaced by the complete Social Foundation migration.

### 5.8 Vault / Credentials / Filings / Forms — `settings.vault` `INTENTIONALLY_ISOLATED`
1. **Capabilities:** Vault upload/download/reconcile (tenant-scoped reservation RPC, OCR/DLP via `vault-ocr-dlp`); `crm_file_document` `high` / `document_generate` `ordinary` / `export-document`; **forms already feed `contact.created`** (`growth-process-submission` → `create_contact_v2`); credentials as NAMES only (§34); credit/finance opt-in (§2) via `ingest_*` (`ordinary`, staged to `paige_ingestion_proposals`), `business_verify`/`privacy_handle_request` `high`, providers Plaid/iSoftpull/SmartCredit/DocuSign.
2. **Missing adapters:** no **Spine capability** for Vault/filings/credit/forms (governance lives in action-risk + RPCs, not the registry); DocuSign/Plaid/iSoftpull are provider webhooks, not Spine verbs.
3. **Missing events:** no `form.submitted/.document.filed/.filing.completed/.credential.connected/.credit.pulled` native events; provider webhooks write their own tables, emit nothing on the bus.
4. **Missing automation:** same link 4–6 gap — "contact created → send intake form / request documents / file envelope" cannot run as a governed process (→ §2).
5. **Authority/budget:** the staging→confirm pattern (`paige_ingestion_proposals`) is a solid approval primitive; **no budget clamp on paid provider pulls** (credit pulls cost money); no Trust-Compass clamp at the event layer.
6. **Receipts/Rails:** Vault/credit acts map to capability-run tables, but the universal correlated receipt is **PARTIAL**; provider-webhook outcomes (envelope signed, Plaid sync) land no correlated Rail receipt.
7. **Next phase:** add `form.submitted`/`document.filed`/`filing.completed` producers; register Vault/forms/filings as Spine capabilities; add the budget clamp for paid provider pulls. **§2/§38 posture is clean today** (funding strictly `fundingEnabled`-gated, read-only Plaid, no merchant-of-record) — guard it when §6 metering lands.

### 5.9 Settings / Team / Workspace / Billing / Usage — `settings.team` `PROOF_OWED`, `settings.billing` `PARTIAL`
1. **Capabilities:** team/workspace is the one genuinely-wired area — `update_business_profile` (`ordinary`), `member_grant_role`/`_revoke_role` (`high`), `team_set_work_profile` (`ordinary`), `team_set_permission` (`high`), `team_invite_member`/`_resend`/`_revoke` (`high`), Spine read `team.authority` (PARTIAL). Workspace/tenant mutations exist as **MCP-only keys the door refuses today** (`tenant_create`/`_set_status`/`_set_features`, `agency_*`). **Billing is a React/edge dead-end** — edge fns exist (`check-subscription`, `generate-invoice`, checkout/portal) but **no billing chat tool and no billing Spine verb**.
2. **Missing adapters:** a billing-status **read** adapter (safe facts) into the Spine; a workspace-settings **write** adapter as chat tools (not refused MCP keys); an agency↔sub-account provisioning adapter as a governed chat action; a **usage/consumption read adapter** (none exists).
3. **Missing events:** no `member_role_changed`, `invite_revoked`, `permission_changed`, `subscription_changed`, `plan_upgraded`, `seat_added`. The department action bus (`20260720200830`) is **task-routing verbs**, not a domain-event stream.
4. **Missing automation:** no subscription to team/permission/billing changes (→ §2).
5. **Authority/budget:** team writes gated; **billing/usage bypass the chat gate entirely** (no governed seam). The router LLM budget is live and wired (`router-budget/mod.ts`, #1102) but its **default ceiling is $50/day, config-overridable — NOT the $1,000/day some briefs state** (§13 correction: code wins over memory), and it is still PROOF_OWED (no production gate-hit). High acts always clamp to `confirm` (RE-2 floor-lift not built).
6. **Receipts/Rails:** team chat writes emit receipts (PROOF_OWED for runtime); **billing edge functions emit no `record_capability_run`**; the universal correlated receipt contract is still PROPOSAL.
7. **Next phase:** promote `settings.billing` safe-status to a Spine read adapter (ledger Phase 8); wire the refused workspace/billing MCP keys into Chat behind the existing approval gate; emit settings lifecycle events; drive the `settings.team` authenticated proof (ledger Phase 5).

### 5.10 Marketplace / Funding — both `UNAVAILABLE`; Marketplace "most blocked"
1. **Capabilities:** Marketplace is **read-only from Paige's side** — only `marketplace_browse` is a LIVE chat tool. `marketplace_install`/`_uninstall` are **containment tombstones** (classified `high` but **no chat tool, no dispatch branch**); the real path is the `marketplace-install` edge fn + `install_marketplace_item` RPC the chat gate never sees. Integration registry: Platform Marketplace LIVE, lanes [read, confirm]. **Funding/capital is a React/edge/cron silo with ZERO Paige-governed verbs** (`readiness-scan`, `match-funding-products`, credit pulls, etc.); MCP keys (`ingest_credit_scores`, `readiness_approve_proposal`) are refused. **§2 clean** — the whole vertical is `fundingEnabled`-gated, never a default; finance providers deliberately uncatalogued (opt-in only).
2. **Missing adapters:** a governed `marketplace_install`/`uninstall` **chat tool** (wire the tombstones to the existing RPC through the approval card); a Spine read adapter for install-state/entitlement; for funding, a safe fundability/readiness read adapter (opt-in tenants only) + a governed snapshot-write adapter.
3. **Missing events:** `install_completed/.failed`, `uninstall_completed`, `entitlement_changed`, `marketplace_payment_confirmed`; funding `readiness_scan_completed`, `fundability_score_changed`, `funding_match_found`, `credit_alert_raised`.
4. **Missing automation:** no subscription on install/funding events (→ §2); readiness/fundability recalcs run on cron with no action-bus linkage.
5. **Authority/budget:** **a paid marketplace install is real money on Paige's L2 rails and requires M1 real-money spend control** (reserve/confirm/reconcile + Stripe receipt + Rail) — explicitly **never satisfied by LLM-token metering** — and **M1 is not built** (§6 keystone). Funding touches §38 read-side only (Plaid read-only, `[read, prohibited]`) — correct today; any funding *purchase* path would need M1 + the §38 tenant-BYO-processor fence.
6. **Receipts/Rails:** the `marketplace-install` edge fn and every funding edge fn emit **no `record_capability_run`** — the single largest receipt gap in the domain.
7. **Next phase:** wire the two install tombstones to Chat behind the approval card + M1 reserve/confirm for paid installs; add `marketplace.install_state` Spine read; emit install + funding domain events; add Rail emission to `marketplace-install` and `readiness-scan`.

### 5.11 Client Portal — `clients.portal` `PARTIAL`; the §7 MVP differentiator
1. **Capabilities:** client-side Paige = `paige-public-chat` — **READ-ONLY and TOOL-LESS by construction** ("NO tools are ever passed to the model… It answers, nothing else"). Portal invite = `create_tenant_invite_token` (admin-gated RPC, recipient-bound) → `send-portal-invite` → `accept-invite`. A real external-client gateway/linkage/shell/action substrate exists (ledger).
2. **Missing adapters:** **no governed chat/MCP verb for any portal write** — `create_tenant_invite_token` has **zero consumers** in chat/MCP (a §10 dead-end, human-click only). No "share record/document with client", "publish to portal", or "request client approval" verb. The client-side Paige cannot act at all. §60 tier-lock is UI-only; the server RPC is not yet tier-gated.
3. **Missing events:** none for the portal — `portal.invited/.accepted/.accessed`, `document.shared`, `approval.requested/.granted`, `client.message_received`. `client.message` exists only as a Rail event-kind, not a trigger.
4. **Missing automation:** nothing — no portal events, so no "client accepted → onboard" / "client replied → notify owner" (compounded by §2).
5. **Authority/budget:** `paige-public-chat` is fail-safe (no mutations); portal invite runs through an admin-gated RPC, **not a Paige tool** — so no autonomy-catalogue entry, no budget/approval lane for portal writes.
6. **Receipts/Rails:** portal invite/accept/share/approval actions emit **no capability_run receipt and no Rail** — they sit outside the governed executor.
7. **Next phase:** the dedicated Client Portal MVP build (owner-gated, master-ref §7, #1067). **Highest-leverage first slice:** a governed **portal-invite/grant verb** (Spine cap + executor RPC wrapping the existing recipient-bound `create_tenant_invite_token` + chat tool + receipt/Rail), closing the §10 dead-end so Paige can grant/manage client access through the one Harness.

### 5.12 Analytics / Forecasting / Cost / Recommendations — `analytics` `UNAVAILABLE`
1. **Capabilities:** **essentially none for tenant analytics** — no analytics/forecast chat tool, no tenant Spine verb, no governed RPC Paige can call. Analytics today = operator-intelligence RPCs (operator-scoped) + React dashboards + PostHog `[read]`. The one live **cost** primitive is the router LLM budget (`paige_llm_trace` + `enforceBudget`, $50/day). The one live **recommendation** seam is the self-improvement loop (`improvement_propose`/`_decide`) — but it governs *Paige's own behavior*, not business analytics.
2. **Missing adapters:** a tenant-analytics read adapter (safe KPI facts) into the Spine; a forecasting adapter; a usage/consumption read adapter (surface `paige_llm_trace` spend to the tenant); a recommendation adapter turning a real finding into a governed proposed action.
3. **Missing events:** `forecast_updated`, `metric_threshold_crossed`, `anomaly_detected`, `budget_breached` (the budget ladder records `budget_soft/hard/exceeded` into `doctrine_gate_hits` but **emits no event**), `usage_threshold_reached`, `recommendation_generated`.
4. **Missing automation:** nothing can subscribe to an analytics finding or a budget breach (→ §2).
5. **Authority/budget:** **the sharpest gap** — cost is observable but **neither billable nor capped at the real-money layer**: the documented `trace → platform_metered_events` leg has **ZERO writers** (B-Meter #57 unbuilt), exactly §67's "observable and not billable"; external real-money spend control (M1) is entirely unbuilt across every provider that can spend.
6. **Receipts/Rails:** no analytics/forecast action emits a receipt (there is no such action). Budget decisions are Rail-correlatable in principle (via `llm_trace_id`) but the contract is PROPOSAL.
7. **Next phase:** ship **M1 metering first** — wire `paige_llm_trace → platform_metered_events` (B-Meter #57) so internal spend becomes billable; then M1-a real-money reserve/confirm (RE-2); land the first production budget gate-hit (router budget PROOF_OWED→LIVE); then the Analytics read Spine adapter (SCR-2/3) + the recommendation→governed-action loop.

---

## 6. The phased Gate-A completion program (reconciled with the binding ledger; routed around #1157)

Each phase is a §4 MVP slice: built to the §13/§32 bar, proven, shipped to `main`, its canonical records
updated in the same PR, and **live before the next begins**. The program **reconciles with the binding
ledger's Phases 2–8** (it does not renumber them) and is sequenced to **not touch PR #1157 (Layers A/B)**.
Phase numbers below are program steps; capital letters always mean the A–G layers of §4.

> **Dependency spine:** Layers A/B kernel+gateway (#1157, concrete draft PR) → Layer C act-execution
> engine (the keystone) → the reference vertical → producer fan-out → the Layer G proof lane → metering
> → per-domain slices. Every phase after A/B is a *caller* of the kernel #1157 lands (§18).

| Phase | Name (layer) | What ships | Proof (§32/§70) | Reconciles with | Collision posture |
|---|---|---|---|---|---|
| **0 — now** | **This Completion Map** | the A–G map + sequence | the map itself, recorded on `main` | binding-ledger Phase 0/1 | docs-only; safe |
| **P1 (shared-health)** | **Fresh-replay repair** (#1155 + #275) | repair the `paige_social_posts` double-create + dup `profiles` CREATE so `database-contract` fresh-replay is green | fresh-replay CI green + the created objects prove-persisted (§32.a) | owner §3 "narrow shared repository-health issue … must be repaired"; unblocks Layer G's non-prod target | migration-only; not #1157; coordinate only if an open PR already fixes it |
| **P2 (keystone, Layer C)** | **Governed act-execution engine** | EXTEND `paige-native-event-dispatch` → evaluate `conditions` (TODO F3) → resolve `granted_lane` → clamp to Trust-Compass/decay (§67/§68) → route approval → run `paige_automation_acts` **through the kernel #1157 lands** → capability-run receipt + Rail | headless smoke of the execution logic + governed-door regressions + deploy-pipeline persist-proof + `get_contact_event_status` reflecting `acts_executed:true`; authenticated end-to-end = **PROOF_OWED → discharged by P4** | binding-ledger **Phase 2** ("record_capability_run fed by real acts") — the *event-bus* caller of that seam | **after #1157 lands Layers A/B.** Build on the kernel; never fork an executor or a second authority model. |
| **P3 (Layer C, reference vertical)** | **Telegram contact-alert** | author one real `contact.created → governed alert` process; terminal connector via **Route A** (governed n8n/Zapier runner); honest link-7 readback + Rail | the full vertical proven as far as headless allows; live end-to-end owed to P4 | §3 worked model; integration registry (n8n LIVE) | reuses n8n governance; no new provider surface |
| **P4 (Layer G)** | **Authenticated proof lane** | flow-definition framework on `liveDrive` + evidence/attribution + proof-status (VERIFIED/PARTIAL/PROOF_OWED/UNAVAILABLE/UNVERIFIED) + negative tests — **gated on the one owner action (§7)** | a real authenticated tenant-safe governed flow end-to-end (discharges P2/P3 PROOF_OWED) | binding-ledger Phases 4.4/5 authenticated drives; tasks #15/#16/#17 | new `scripts/live-drive/*.mjs` + `docs/evidence/*` — no collision |
| **P5 (Layers C/E)** | **Producer fan-out + metering keystone** | event producers from existing governed writes (`form_submitted`, `booking.*` on the new bus, `deal.*`, `record.lifecycle_moved`, `post.published`, mission events) **+ M1: `paige_llm_trace → platform_metered_events` (#57)** + M1-a real-money reserve/confirm (RE-2) | each producer proven to emit + one budget gate-hit (router budget PROOF_OWED→LIVE) | binding-ledger Phase 4 (#755, FU-3); money-spine B-Meter #57 | M1 touches spend seams — ground #572 metering first |
| **P6+ (Layers C/D/F, per domain)** | **Per-domain completion slices** | each domain's "next phase" (§5) by leverage: Portal invite verb → Marketplace install→chat+M1 → comms send on the bus → Analytics read adapter → Social pipeline (after P1) → Vibe Studio; Layer D specialist wiring; Layer F runtime-evidence read seam | each now drivable through the P4 lane → moves its ledger row toward `LIVE` | binding-ledger Phases 5–8 | one domain per slice; never widen; **Layer F visual is Claude Design's (§00)** |

**Why the keystone (P2) leads the build:** every domain survey's #1 gap is §2. One keystone build lights
up the event→action story for all twelve domains at once; building domain slices first would stack
features on a foundation that cannot fire them (§30 — don't layer on a foundation that structurally
doesn't work). **P1 precedes it only because it is a bounded, owner-named, non-colliding repository-health
repair that also unblocks the Layer G proof target** — and because P2 itself waits on #1157 landing
Layers A/B.

---

## 7. Authenticated-proof-lane feasibility determination (the one owner action)

The Phase-D proof lane — and the authenticated end-to-end discharge of Phase B/C — is blocked on
**exactly one owner action**, not on code, a migration, spend, or a new provider (per the substrate
survey + `docs/delivery/solo-test-tenant-spec.md`):

- The **tenant/membership/role half is already programmatic** — `provision_tenant_as(_owner uuid)`
  (service-role, SECURITY DEFINER, `20260808190000:528`).
- The **`auth.users` test user needs GoTrue auth-admin scope** (`admin.auth.admin.createUser`), which a
  headless session lacks (MCP Supabase exposes DB SQL, not GoTrue admin).
- **No viable non-prod target** exists headless (preview-branch concurrency/OOM; local from-empty replay
  broken by #275 + #1155; prod unreachable headless — the proxy forwards only tool/MCP hosts).

**Exact unblock (owner action, least-privilege):** provision a Solo test tenant + auth user
(`account_type='standalone'`, `parent_tenant_id` NULL, one `tenant_members` owner/active, base
`user_roles` only — **no** admin/operator/send/spend/cross-tenant authority), and set the CI secrets
**`LIVE_DRIVE_EMAIL`** / **`LIVE_DRIVE_PASSWORD`** (spec §3/§5/§7). No password value, owner credentials,
or customer data is ever committed or logged. **This is reported, not improvised** — per the owner's
standing constraint.

Phases B and C do **not** wait on this: they build and prove headlessly + via the deploy pipeline + the
event readback, and carry an honest `PROOF_OWED` on the authenticated end-to-end until Phase D runs it.

---

## 8. Collision map — in-flight PRs (do not step on)

| PR / issue | What it is | This program's posture |
|---|---|---|
| **#1157** | "Paige Unified Governed Execution + Capability Gateway Foundation (in progress)" = **Layer 1** | **Do not touch.** Phase B+ are *callers* of the gateway it lands. |
| #1153 | Vibe Studio governed media seam | avoid `services/visual-renderer` edits; Phase F Studio slice waits |
| #1148 | Solo Beta security | do not touch |
| #776 / #729 / #644 / #591 | Spine / Rail / receipt work | Phase B reuses `record_capability_run`; do **not** edit `capability-record.ts`/`paige_workspace_events` without coordinating |
| #572 | metering | Phase E M1 coordinates here |
| #574 | premerge-migration-proof fail-closed | do not edit `premerge-migration-proof.yml` |
| #1154 | `social_post` non-functional (undefined `content`) | Phase F Social slice |
| #1155 | `paige_social_posts` double-create breaks fresh replay | Phase F Social slice; does **not** block a *new* migration |

**Safe, non-colliding surfaces:** new `scripts/live-drive/*.mjs` flow definitions + new
`docs/evidence/ui-delivery/*.md` records (Phase D); new event producers + a new dispatcher act-execution
path that *calls* the existing executor (Phase B, on top of #1157).

---

## 9. How this Map stays true (§BRAIN.3 / §66 / §0)

This document is a derived view. On each phase merge, the **canonical record** changes in the same PR
and this Map is re-synced from it:
- a binding moves → `surface-binding-ledger.json` row + `npm run lint:binding-ledger`;
- a Spine verb is added → `registry.ts`;
- a provider changes → `integration-capability-registry.json` + `npm run lint:integration-registry`;
- platform truth changes → `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §4/§5;
- a ruling lands → `docs/brain/decision-log.md`.

If this Map and a canonical record ever disagree, **the canonical record wins** and the discrepancy is a
§13 correction logged here and there.

---

## 10. Immediate next action (directive §7) — ⚠️ SUPERSEDED 2026-09-13

> **SUPERSEDED by the owner ruling of 2026-09-13 (see the STATUS UPDATE in §0 and decision-log
> 2026-09-13): active Harness construction has STOPPED and this "immediate next action" plan no longer
> directs work.** It is retained below only as the pre-completion record of what the next phases *would*
> have been. The phases named here (P1/P2 and the per-domain slices) are parked for their own
> workstreams; Harness involvement is now support/review only.

Per the standing directive **as it stood on 2026-09-12**, the program then continued **phase by phase
under Gate A** — no manufactured approval pause. The next phase that proceeds **without duplicating
current merged or open work** was to be chosen by grounding the concrete open PRs first (#1157 Layers
A/B, the Social audit, Vibe Media) and avoiding a competing version:

- **P2 (the keystone, Layer C) waits on #1157 landing Layers A/B** — the act-execution engine must call
  the one kernel, never fork a second authority model (directive §1/§4).
- **P1 (fresh-replay repair, #1155 + #275)** is the bounded, owner-named (§3 "must be repaired"),
  non-colliding repository-health slice that can proceed now and also unblocks the Layer G proof target
  — provided no open PR already owns it.

The next working step is to ground #1157's real diff + the #1155/#275 state, then execute the first
clear non-colliding phase under Gate A, updating its canonical records in the same PR.
