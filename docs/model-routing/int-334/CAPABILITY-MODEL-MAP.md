# Best-case capability → cognitive class → model map (OpenRouter primary)

**Status: DESIGN STUDY / PROOF OWED (2026-11-17).** This is a routing *study*, not a benchmark result and not a live-capability claim. It maps real, declared Spine capabilities to the three Fabric cognitive classes and the exact OpenRouter model ids that serve them. No model is claimed to be "best" by measured score; "best-case" means the highest-confidence class assignment available under the owner's 2026-10-06 class policy. Nothing here grants authority — see the binding rules at the end.

## 1. The one routing ladder

```
thread state → intent → capability → governance → cognitive class → provider/model → execution → readback
```

The **business area** (Operations, Social, Marketing, Sales, Advertising, Integrations) is context, not the decision. The Turn Route (`supabase/functions/_shared/paige-turn/route.ts`) decides the cognitive class from state + intent + capability + governance; the Fabric (`model-fabric.ts`) then serves that class from `CLASS_POLICY`. A capability may be served at `cheap` on one turn and `frontier` on another. This map states the **default/best-case class per capability**, not a fixed binding.

## 2. The three serving classes (exact, verified OpenRouter ids)

| Cognitive class | OpenRouter model (verified on `GET /api/v1/models`, 2026-11-17) | Role | Fallback chain behind it |
|---|---|---|---|
| `cheap` | `openai/gpt-6-luna` | classification, extraction, tagging, summarisation, routing support, simple status/lookups | `openai/gpt-6-luna` → featherless → groq → `claude-haiku-4-5` |
| `operational` | `openai/gpt-6.1-sol` | normal conversation, tool reasoning, planning, synthesis, drafting, multi-step orchestration | `openai/gpt-6.1-sol` → `claude-sonnet-5-5` |
| `frontier` | `openai/gpt-6-astra` | hard ambiguity, long-horizon orchestration, deep research, large documents, high-stakes synthesis | `openai/gpt-6-astra` → `claude-sonnet-5-5` |

`gpt-6.2-astra` and the `-pro` variants exist on OpenRouter but are **not** adopted by any class. No unproven or renamed id is used. A missing `OPEN_ROUTER_AI_API` secret (the configured Edge name; `OPENROUTER_API_KEY` is a back-compat alias), an unattributed tenant, or an excluded class makes the OpenRouter candidate fail closed and skipped; the fallback chain above serves the turn. An explicitly empty `OPENROUTER_CANARY_TENANTS` is the kill switch.

## 3. Capability map by business area

Every key below is an **actual declared Spine capability** (`supabase/functions/_shared/paige-spine/registry.ts` and its `domains/` modules). There is no dedicated `model.*` Spine key: model routing is a Harness seam, so this study declares `UNAVAILABLE` for a provider-specific Spine capability rather than inventing one.

### Operations
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `business.operating_snapshot` | `operational` | `openai/gpt-6.1-sol` | synthesis across live business facts into an honest operating picture |
| `automations.weekly_commitment_draft` | `operational` | `openai/gpt-6.1-sol` | draft a weekly plan under existing commitment/seat rules |
| `automations.weekly_schedule_review` | `frontier` | `openai/gpt-6-astra` | reconcile a schedule against constraints and conflicts |
| `automations.owner_task_history` | `cheap` | `openai/gpt-6-luna` | summarise an already-authoritative task history |
| `crm_clients.task_read` | `cheap` | `openai/gpt-6-luna` | read/summarise an authoritative task list |
| `planning.list` | `cheap` | `openai/gpt-6-luna` | structured retrieval/summary |
| `calendar.agenda_read` | `cheap` | `openai/gpt-6-luna` | structured retrieval/summary |
| `comms.messages_read`, `comms.support_cases_read` | `cheap` | `openai/gpt-6-luna` | classify and summarise message/case state |
| `team.authority`, `integrations.health` | `cheap` | `openai/gpt-6-luna` | status classification only — never an authority decision |

### Social
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `social.presence` | `operational` | `openai/gpt-6.1-sol` | compose/publish reasoning with platform context and tone constraints |
| `comms.message_content_read` | `cheap` | `openai/gpt-6-luna` | classify message content before any draft decision |

Any actual external publish remains a governed external effect: it stays behind the one approval gate and the canonical send rail. Model choice never lowers that gate.

### Marketing
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `marketing.draft_content` | `operational` | `openai/gpt-6.1-sol` | everyday copy drafting with brand/business context |
| `long_form.document_authoring` | `frontier` | `openai/gpt-6-astra` | long-horizon structure and coherence |
| `research_knowledge.document_generate` | `frontier` | `openai/gpt-6-astra` | synthesis across retrieved source material |
| `vibe_studio.page_generate` | `operational` | `openai/gpt-6.1-sol` | structured page generation under a template contract |
| `vibe_studio.funnel_generate` | `frontier` | `openai/gpt-6-astra` | multi-step funnel planning with dependencies |

**Honest limit:** document-*bearing* chat turns are currently served by Anthropic, not the Responses adapter (`messagesCarryDocument` → `unsupported_document` skip; INT-334 Gap 2 / ANT-46). A `frontier` class assignment above does not mean OpenRouter carries PDF/file turns today. Migrating those callers is separate owner-gated work.

### Sales
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `sales.crm_pipeline_summary`, `sales.pipeline_catalogue` | `cheap` | `openai/gpt-6-luna` | summarise an authoritative pipeline read |
| `sales.crm_list_deals` | `cheap` | `openai/gpt-6-luna` | structured retrieval |
| `pipeline.deal_stage_evidence` | `operational` | `openai/gpt-6.1-sol` | weigh stage evidence and explain a recommendation |
| `client.engagement_status` | `cheap` | `openai/gpt-6-luna` | status classification |
| `sales.pipeline_archive_preview` | `frontier` | `openai/gpt-6-astra` | preview a consequential restructure before approval |

### Advertising
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `ads.lead_funnel` | `frontier` | `openai/gpt-6-astra` | reason over funnel/lead trade-offs and sequencing |
| `ads.creative_feature` | `cheap` | `openai/gpt-6-luna` | simple state classification (feature/unfeature) |

Ad spend itself is real money and binds `m1_real_money_spend_control`; a model selecting a creative is not authority to spend.

### Integrations
| Spine capability key | Best-case class | Serving model | Why |
|---|---|---|---|
| `integrations.list`, `integrations.n8n_readiness`, `integrations.ghl_list_actions` | `cheap` | `openai/gpt-6-luna` | classify connection/readiness state |
| `integrations.n8n_list_workflows`, `integrations.n8n_get_workflow` | `cheap` | `openai/gpt-6-luna` | describe an already-known workflow |
| `integrations.n8n_validate_workflow` | `frontier` | `openai/gpt-6-astra` | validate a workflow graph against intent |
| `browser.browse_public_url` | `frontier` | `openai/gpt-6-astra` | plan a bounded public browse under the browser authority seam |

A connected provider is a separate per-tenant authorization fact (registry rule R1: listed is never connected). Choosing OpenRouter never makes an integration connected or autonomous.

## 4. Binding rules (unchanged by this study)

- **Sensitive/final/send/approval lanes stay Anthropic.** The pinned judge carve-out, terminal send/approval decisions, and approved-card deterministic execution are not routed by `CLASS_POLICY`. OpenRouter serves read/draft/reasoning work only.
- **No authority transfer.** A provider chosen here grants no tool authority, no approval, no tenant access, and no provider connection. Every tool call still passes the governed gate and the one approval gate; RLS and Trust-Compass lanes are unchanged.
- **Narrow fallback only.** The next candidate is tried only on a proven health failure *before* semantic output. Text a person has seen is never unsaid, and a tool call is never re-run unless proven unexecuted.
- **Truthful readback.** Only a real `paige_llm_trace` row with `provider='openrouter'` proves OpenRouter served a turn. Until that exists on an authenticated production Chat turn (after merge, deploy, and key configuration), this whole map is `PROOF_OWED`, not `LIVE`.

Grounding: `docs/model-routing/int-334/EVIDENCE.md`, `docs/brain/config-registry.md`, `docs/integration-registry/integration-capability-registry.json`.
