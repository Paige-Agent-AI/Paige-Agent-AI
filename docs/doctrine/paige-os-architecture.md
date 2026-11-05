# Paige OS Architecture

> **Current owner North Star (2026-11-05).** This file is a DERIVED architecture reference; root AGENTS.md and CLAUDE.md now carry the single EXP/PO-EXP complete-prelaunch rule. The original **Orchestration Layer** coordinates one PAIGE AI COO, Team Hub, six existing specialist agents, native business records and eligible external tools; **Model Fabric** remains separate AI model routing. EXP10 owns shared connection admission/Vault/revocation, while each consuming EXP and corresponding company PO-EXP owns its business action and real customer/company proof. Third-party examples are ClickFunnels, licensed Zoom webinars/events, WebinarJam/EverWebinar, existing Zapier/n8n/Make, and customer-owned API/MCP apps. Zernio remains the selected social aggregator only. These are candidate/partial integrations, never implied available or authorized external effects. All approved EXP00–19 and PO-EXP01–30 customer/company outcomes must be accepted before public commercial launch. Development skills: **Flow by Flow, then Impeccable for UI/UX**; other routed procedures are subordinate. Historical architecture and dated findings below are not current delivery assignments. No agent activation, selected-outcome override or direct provider action is authorized by this documentation.

> **Status and authority.** This document is a derived architecture reference. The
> directives in `CLAUDE.md` remain canonical. If this synthesis and `CLAUDE.md`
> differ, `CLAUDE.md` governs. The linked organization and growth-map documents
> remain canonical for their respective details; this document points to them
> rather than duplicating them.
>
> **Current routing override — 2026-09-08:** read the **Paige Runtime Harness** decision in
> `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` before using this synthesis for any model, agent,
> skill, voice, browser, department, or external-tool work. Departments are capability domains
> inside one shared governed Harness. Historical “agent team” language below means optional
> bounded workers in a Paige-led job, never separate Brains, memory, authority, operating logic,
> job systems, cost controls, or disconnected tool access.

## Purpose

Paige is designed as one connected operating system, not a collection of unrelated
AI features. This reference explains how the client portal, bounded specialist work, department
model, action bus, autonomy controls, growth model, and long-range context expansion
fit together. It grounds future work adjacent to `CLAUDE.md` §§7, 8, 14, 16, 17,
35, and 36, and provides an architectural foundation for the future beta investor
pitch without replacing doctrine.

The architecture has a deliberate progression:

1. Paige meets people through an intelligent, tenant-authored portal today (§7).
2. Paige runs substantive work through one Runtime Harness, optionally using bounded specialists (§14).
3. Capability domains coordinate through that Harness and a two-way action bus (§8, §16).
4. Default autonomy lanes inform—but do not grant—the authority that the Spine re-resolves
   for every action at execution time (§16).
5. The same operating primitives support the revenue and governance map (§17).
6. The SMB beachhead can later expand into additional contexts—including
   households, portfolios, and devices—without changing Paige's identity as the
   operating layer (§35).
7. Every surface must remain understandable within five minutes; agent-driven,
   draft-first, one-click interaction is the moat that keeps the system usable as
   its capabilities grow (§36).

## 1. What Paige is

### The product today: an intelligent, two-way portal

Paige's current-scope north star is the client portal that **reasons, suggests,
and acts**, rather than a static place where information is merely stored (§7).
It is one intelligence facing two directions:

- For the client, Paige onboards, answers, probes, nurtures, and acts from the
  client's perspective (§7).
- For the business team, Paige identifies what each client needs, drafts the next
  move, flags risk, and either proposes or executes action according to policy
  (§7).

The portal experience is tenant-authored. Persona, questions, journeys, and
templates come from each tenant's Playbook rather than a hard-coded industry
default (§7). That makes the portal both the immediate product surface and the
first expression of the broader OS: Paige understands a context, coordinates work
inside it, and presents the right next action to the right participant.

### The trajectory: an operating system, not a feature bundle

The long-range north star names Paige as the operating system (§35). The SMB
business is the beachhead, not the architectural ceiling. Later waves may apply
the same context-and-action model to households, portfolios, and device-mediated
experiences (§35).

Those later contexts are **aspirational doctrine, not a statement of shipped
capability**. They should influence boundaries—portable identity, explicit context,
permissions, event-driven actions, and channel-independent interaction—but they do
not justify building speculative household, portfolio, or hardware products ahead
of the current business experience (§35). New contexts arrive as Playbook/context
additions around stable OS primitives, not as competing Paige products (§35).

## 2. How Paige runs work

Paige's operating model has three connected layers: orchestration, organizational
execution, and governed coordination.

### Layer 1: Paige composes registered capabilities through one Harness

Paige is the orchestrator; the Second Brain is her governed, scoped knowledge layer (§14).
For every non-trivial job, the Harness composes eligible registered skills, tools, adapters, and,
when useful, bounded specialist workers; Paige integrates the verified outcome (§14).

Research, internal design, and verification are registered capabilities, with verification on
anything that ships (§14). When no eligible capability fits, Paige may propose a versioned skill
or bounded-worker registration for review and may source patterns, skills, tools, and connectors
for that proposal (§14). Any sourced capability that requires new executable code still follows
the hard approval path; sourcing does not authorize silent code execution (§14).

Orchestration is driven by real signals and performance data, not intuition alone
(§14). Any bounded worker uses the Harness's shared model router to select a cost-appropriate
model for its task, and Paige reports only work the team actually performed (§14). The governing
question is: **Did one Paige use the shared Harness, execution-time Spine authority, canonical
verification, and receipts/Rail?** A bounded worker is optional; bypassing the governed path is not.

### Layer 2: the Harness coordinates ten capability domains

The 10-department operating model defined in `CLAUDE.md` §16 is a capability and ownership
map inside one Paige Runtime Harness, not a roster of isolated AI products. The full organization
map, department mandates, roles, KPIs, and growth-stage rollout live in
[`docs/doctrine/100M-org-blueprint.md`](./100M-org-blueprint.md); this document does
not restate them.

The department model provides three things (§16):

1. **Awareness — Second Brain organizational context.** Eligible, scoped knowledge gives Paige
   ownership, RACI, KPIs, and escalation paths without creating another Brain.
2. **Execution — shared Harness capability domains.** A domain registers versioned skills,
   adapters, canonical-record access, scoped tools, and optional bounded workers; Paige may
   traverse multiple domains in one continuous job.
3. **Governance — execution-time Spine authority.** Existing `autonomy_lane` values remain
   policy inputs: `auto` for eligible AI-performed work, `confirm` for AI-drafted and
   human-approved work, and `off` for human-only work with AI briefing. The effective lane and
   every other authority constraint are re-resolved for each action when it executes.

The model extends existing primitives rather than creating a parallel department
system (§16). Every task must answer three questions: which capability domains and canonical
records it uses, which registered skills/tools or bounded workers it needs, and how the shared
Spine resolves authority and verification for each consequential action (§16).

### Layer 3: the action bus coordinates both sides of the portal

The two-way portal becomes operational through the action bus (§8). Paige initially
organizes work into two coordinated teams:

- **Owner Ops** works for the business owner on pipeline, follow-up, billing
  operations, campaigns, scheduling, risk triage, and the daily brief (§8).
- **Client Experience** works for each client on onboarding, conversational intake,
  expert probing, answers, nurture, and the personalized portal (§8).

These are coordinated views of the 10-department organization, not a competing org
chart (§8, §16). The 10 departments establish durable ownership and execution; the
two teams describe how work crosses the owner/client boundary.

For example, Client Experience detects a need, creates an action for Owner Ops, and the shared
Harness may use a bounded specialist to draft the move. The Spine then resolves active tenant,
actor, workspace, role, tool scope, provider state, approval rule, budget, lane, and verification
requirements for that action before the result returns to the client-facing context (§8, §16).
In the other direction, Owner Ops establishes a play and Client Experience personalizes it for
the individual client (§8). This remains one Paige-led job with attributable evidence, not an
exchange between autonomous department systems.

### The end-to-end work contract

Taken together, the canonical sections imply one reusable execution path:

```text
goal, signal, or conversation
  → tenant-safe context assembly in the shared Paige Runtime Harness
  → classify one or more capability domains and select registered skills/tools or bounded workers
  → resolve Spine authority separately for every read, tool call, job step, or action
  → execute, request approval, or brief a human through canonical seams
  → verify canonical readback and record attributable receipts/Rail for consequential steps
  → Paige integrates and truthfully reports the actual result
  → eligible reviewed learning may enter the governed improvement path
```

This flow is a synthesis of §§7, 8, 14, and 16. It does not create a new workflow
engine or autonomy model. Builds should extend the existing Harness, action kinds, capability
registrations, approvals, audit records, and Playbook configuration that those sections govern.

## 3. How Paige stays intuitive

Capability alone is not the moat. Paige must make the operating system feel obvious
within the five-minute test established by §36. A user should quickly understand
what Paige knows, what she recommends, what will happen next, and where human choice
is required (§36).

Five mechanical patterns produce this feel (§36 — every user-facing build must use
at least one, ideally several):

1. **Proactive surfacing.** Paige tells the user what needs doing; the user doesn't
   hunt for it. Work lands in a queue the user opens by default, not a menu the
   user learns to find.
2. **Draft-first.** Paige does the work, human approves (`autonomy_lane = "confirm"`
   per §16). The user reviews a completed draft, not a blank prompt.
3. **Domain-expert framing.** Paige speaks the user's business language (per
   Playbook), not agent language — never "I'll invoke the tool" or "let me query
   the database."
4. **One-click approval.** *Approve* is a button, not a prompt reformulation. The
   one-click path handles the 80%; drill-down handles the edge case.
5. **§14 team framing.** The user manages a team, not drives a tool. Affordances
   reinforce that mental model: "Paige drafted this for your approval," "Paige
   noticed X and flagged it," "Paige is working on Y for you."

Intuitiveness therefore depends on architecture, not cosmetic simplification.
Tenant-authored context reduces irrelevant choices (§7); department routing hides
organizational complexity (§16); specialist orchestration hides tool complexity
(§14); the action bus puts work in the correct person's queue (§8); and autonomy
lanes make consequence and approval visible (§16). The five-minute test fails when
the user must reconstruct any of those systems manually (§36). Dev-tool-flavored AI
products — blank prompt windows, requiring the user to know what skill exists
before asking, revealing capability only after the user knows to ask — abandon this
moat by design (§36).

## 4. Where Paige is going

### Growth runs on the same operating primitives

The $1B Growth Map is the canonical revenue and top-down governance reference
(`CLAUDE.md` §17). Its full engine, stage, and governance detail lives in
[`docs/doctrine/1B-growth-map.md`](./1B-growth-map.md); this document does not
duplicate it.

Architecturally, growth is not a separate application layered beside Paige. Revenue
features must locate themselves within the existing billing taxonomy; agency
expansion uses the account model; model routing protects margin; and scaled
governance extends autonomy lanes, audit, RLS, sovereignty patterns, two-key
controls, and explicit break-glass access (§17).

The Commerce Line remains hard: Paige powers operators and monetizes operating
rails, but does not become the consumer marketplace or aggregate demand away from
the operator who owns the customer (§17). Every revenue build must identify its
engine, governing law, and existing primitive before it is ready (§17).

### Context expansion preserves the same Paige

Section 35 extends the destination beyond the SMB beachhead to later household,
portfolio, and device contexts. The reusable asset is not a particular dashboard;
it is the pattern already established in the present product:

- explicit context and ownership (§7, §35);
- a standing orchestrated team (§14);
- department-aware work routing (§16);
- actions that travel between the people and agents responsible for them (§8);
- governed autonomy and auditable execution (§16, §17); and
- an interaction model that passes the five-minute test (§36).

Expansion should happen only when a new context can reuse those primitives without
weakening tenant isolation, owner control, governance, or the Commerce Line (§17,
§35). Device presence is therefore a future channel for Paige's operating model,
not permission to couple the core architecture to speculative proprietary hardware
today (§35).

## 5. Design implications for every build

Any build adjacent to this architecture must satisfy the following traceability
questions.

**Product and context**

- Whose context is this, and how is it authored? The current portal is
  tenant-authored; do not hard-code a vertical or a tenant's Playbook into the
  platform (§7).
- Is this current scope or a later-wave context? Household, portfolio, and
  device contexts are directional unless separately approved and implemented
  (§35).

**Work and organization**

- Which registered skills/tools or bounded workers perform the substantive work inside the
  shared Harness? Paige must orchestrate rather than solo non-trivial execution (§14).
- Which capability domain owns it? Route it through the 10-department model instead of
  inventing an unowned feature silo (§16).
- How does it cross the owner/client boundary? Use the action bus when work moves
  between Owner Ops and Client Experience (§8).
- Which execution-time authority decision governs each action? Treat `auto`, `confirm`, and
  `off` as policy inputs, re-resolve the full authority context through the Spine, and do not
  create a competing approval vocabulary (§16).

**Experience**

- Can a new user understand the value and next action within five minutes? If
  not, simplify around agent-driven, draft-first, one-click interaction (§36).
- Does the interface reveal consequence and approval clearly? One-click does
  not mean ungoverned; it means the safe next step is obvious (§16, §36).

**Growth and governance**

- Which revenue engine does it support? Use the canonical billing and revenue
  map rather than creating an unclassified money flow (§17).
- Which governance law binds it? Tenant isolation, audit, autonomy, model
  routing, two-key controls, and break-glass rules scale with the system (§17).
- Does it cross the Commerce Line? Paige may power the operator's marketplace
  activity but must not become the consumer marketplace (§17).
- Which existing primitive does it extend? Architecture grows by extending the
  portal, Playbooks, Harness registrations, action bus, departments, autonomy lanes, audit, and
  billing rails—not by creating duplicate homes (§8, §16, §17).

## 6. Current-state agentization audit and operating map

This audit is grounded on first-parent `main` at `610e609c` (2026-09-08), the
Surface Binding Ledger, Spine Registry, Integration Registry, Runtime Harness
doctrine, Skills inventory, C-suite roster, Brain wiring and decision records,
and the actual source and migrations behind the candidate capabilities. It
does not activate agents or change product behavior.

The governing architecture is:

`One Paige -> one shared governed Runtime Harness -> coordinated work across many platform domains.`

### 6.1 Current-state agentization inventory

Truth labels describe current agentization eligibility, not visual completeness.
`LIVE` requires a callable, governed, verified path. `PARTIAL` means useful
substrate exists but one or more Harness, authority, provider, record, or
evaluation seams remain. `PROOF OWED` means implementation is asserted but
required runtime evidence is missing. `UNAVAILABLE` means no agent claim is
permitted.

| Existing capability | Classification | Current evidence and boundary | Truth |
|---|---|---|---|
| Paige workspace and chat | Paige orchestrator responsibility; platform surface | The single owner-facing entry point exists. It remains the only primary intelligence and cannot imply that every routed capability is callable. | `PARTIAL` |
| Paige Runtime Harness | Shared execution architecture | Job, authority, tool, evaluation, budget, receipt, and recovery contracts are documented; central implementation and end-to-end proof are incomplete. | `PARTIAL` |
| Paige Spine | Authority layer | Registered capability envelopes exist, but coverage and proof vary by action. Every specialist action must re-resolve authority here. | `PARTIAL` |
| Trust Compass | Platform authority/governance surface; Paige orchestrator responsibility | Server action-risk policy and approval gates are authoritative. The visible dial/numbers remain non-authoritative fixtures without a complete server seam; Paige never raises her own authority. | `PARTIAL` |
| Rail and receipts | Canonical evidence layer | Bounded receipts exist for some flows; universal job-to-action-to-readback coverage is not proven. | `PARTIAL` |
| Second Brain | Shared scoped context | The one business-context source for Paige and specialists; not a per-agent memory store. Coverage is incomplete. | `PARTIAL` |
| Mind and Memory | Eligibility-controlled learning layers | Governance, stores, and bounded substrate are `PARTIAL`; specialist runtime Mind admission and confirmed-only Memory projection/integration are `UNAVAILABLE` until implemented and proven. Doctrine prohibits inference, raw transcript promotion, and unverified research promotion. No specialist receives a private Mind or Memory. | `PARTIAL` substrate; `UNAVAILABLE` specialist runtime projection |
| Skills catalogue and runner | Skills | 112 seeded S2 recipe rows and a generic interpreter exist, with only a small bespoke execution set. Seeded or active rows are inventory, not blanket callable proof. | `PARTIAL` |
| Legacy `paige_subagents` substrate | Specialist-agent precursor | Invocation/proposal tables and vertical functions exist. Old names and stored cap columns do not prove a coordinated Harness team or enforced limits. Do not create `paige_agents` or a second registry. | `PARTIAL` |
| Business Game Plan, Missions, Strategic Plays, operating reviews | Platform domain; skills; Operating Strategy candidate | Game Plan binding is partial; some Mission actions are Spine-registered. Strategic and review workflows need unified Harness jobs and evaluation. | `PARTIAL` |
| Command Center Systems Check | Platform readiness domain; Paige orchestrator responsibility; existing specialist support only | The shipped domain/runner/UI and caller-scoped safe-lens substrate are `PARTIAL`, but no Paige binding is built. Counts require enumerated bounds; finding text, ids, registry internals and triggering actor remain excluded. Remediation stays with the owning surface and its own authority gate. | `PARTIAL` domain/safe-lens substrate; `UNAVAILABLE` Paige binding/specialist activation |
| Clients, relationships, conversations, follow-up, health, requests | Platform domain; Client Success candidate | People, Conversations, and Calendar bindings remain unavailable and active design/workstream boundaries apply. | `UNAVAILABLE` |
| Tenant Client Portal | MVP platform domain and client-scoped experience | Not an agent. A real external-client substrate exists; calls to Paige or specialists must use constrained client authority and the same evidence path. Recipient binding, revocation, record convergence, governed tools, and authenticated isolation/recovery proof remain gated. | `PARTIAL` |
| Campaign Briefs, offers, audience, content planning | Platform domain; skills; Growth candidate | Campaign Brief actions have bounded Spine/Rail seams; the broader six-tab Campaigns domain has mixed unavailable/proof-owed bindings. | `PARTIAL` |
| Social operations | Platform domain; tools; Growth candidate | Presence is partial and social surfaces owe proof. No posting or provider action is authorized by this audit. | `PROOF OWED` |
| Opportunities, deal health, pipeline movement, follow-up | Platform domain; skills; Sales candidate | Deal-stage evidence is Spine-registered, while the Pipeline surface owes proof and governed mutation is not established. | `PARTIAL` |
| Research and intelligence | Skills; tools; Research candidate | Source-grounded synthesis patterns exist, but governed job, citation, evaluation, and Memory-promotion controls are incomplete. | `PARTIAL` |
| Paige Self-Knowledge & Migration Advisor | Paige orchestrator responsibility; skills | A current-main read-first architecture contract separates capability manifest, tenant inventory, external evidence, and migration-plan records. Distributed primitives are `PARTIAL`; the end-to-end advisor is not callable. It is not a separate specialist identity. | `UNAVAILABLE` |
| Secure Browser | Tool and execution channel | The shipped prerequisite/public-browser substrate is `PARTIAL`; the customer Secure Browser capability remains `UNAVAILABLE`. PR #1046 is an unmerged candidate and collision, not current-main proof. It is an execution layer, never an assistant identity. | `UNAVAILABLE` capability; `PARTIAL` prerequisite substrate |
| Live Conversation | Modality and execution channel | Current main includes the organic Paige Presence and actual played-output reaction. Provider-backed realtime audio remains `PROOF OWED`; local test audio is not provider speech. The modality uses the same Harness, Spine, Rail, and context boundary. | `PARTIAL` |
| Vibe Studio and creative production | Platform domain; skills/tools; Paige-assembled Creative Production Team candidate | Existing creative-authoring/session/version capability is `PARTIAL` substrate only. Binding Ledger `campaigns.vibe-studio`, the Paige/Harness binding, and all seven worker-role activations remain `UNAVAILABLE`; presence is not callable-agent proof. NEXUS owns creative/growth outcomes, MENTOR owns Studio platform/config/readiness, and Paige orchestrates the bounded team. | `PARTIAL` authoring substrate; `UNAVAILABLE` binding and team activation |
| Analytics and outcome learning | Platform domain; skills | The Analytics binding is unavailable. Metrics require source, provenance, date range, and honest availability. | `UNAVAILABLE` |
| Plan usage, model/voice/browser/job/provider consumption and forecasts | Platform concern; Cost Advisor candidate | Billing is partial and provider registry entries are mixed. No canonical cross-provider cost ledger, rate proof, or anomaly evaluation is complete. | `PARTIAL` |
| Vault and Security & Data | Platform domains; constrained context source | Intentionally isolated. Specialists receive only explicitly approved safe projections, never raw secrets or unrestricted Vault context. | `UNAVAILABLE` for specialist access |
| Settings, Connections, Integrations, Setup, Team, Public Presence | Platform domains; tools and authority inputs | Integration and billing bindings are partial; other bindings are unavailable or proof owed. Registry listing is not connection or action proof. | `PARTIAL` overall |
| Marketplace and MCP door | Platform domain; tool channel | Marketplace is bounded and the MCP door is read-only/refuses mutation. Neither is a specialist identity nor permission to add products or providers. | `PARTIAL` |
| Platform Operator and Fleet | Internal platform domain; future operator candidates | Operator routes and records exist, but public-tenant agentization is forbidden and workflows need Platform Operator gates and proof. | `UNAVAILABLE` |

Secure Browser and Live Conversation are execution/modality layers. The Tenant
Client Portal is a platform domain and constrained client experience. None is
an independent assistant identity.

### 6.2 Domain-to-skill-to-tool-to-specialist matrix

Provider status must be resolved from the Integration Registry at execution
time. A listed provider is not necessarily connected, authorized, or usable.

| Platform domain | Skills or methods | Registered tools or channels | Accountable specialist candidate | Present eligibility |
|---|---|---|---|---|
| Cross-domain owner operations | intent framing, decomposition, synthesis, verification | Paige workspace, Harness jobs, Spine, Rail | Paige Orchestrator / COO | `PARTIAL` |
| Game Plan, Missions, Strategic Plays | planning, decision framing, operating review | Brain reads; registered Mission actions | Operating Strategy and Planning | `PARTIAL` |
| Command Center Systems Check | readiness interpretation, remediation ordering and draft steps | `systems_check_snapshot`, n8n readiness; mutations remain in owning surfaces | Paige Orchestrator coordinating existing VERA compliance and MENTOR operations capability domains | `PARTIAL` domain/safe-lens substrate; `UNAVAILABLE` Paige binding/specialist activation |
| Trust Compass | authority-posture explanation and denial-safe routing | platform ceiling resolver, Rail activity, server action-risk policy and approval gates | Paige Orchestrator / COO; authority cannot be delegated | `PARTIAL`; visible control remains non-authoritative |
| Clients and Tenant Client Portal | relationship synthesis, follow-up drafting, request triage | client records, conversations, calendar, constrained Portal calls | Client Success and Relationship | `UNAVAILABLE` as an agent; Portal domain `PARTIAL` |
| Campaigns and approved social work | brief creation, audience/offer planning, content planning, performance interpretation | Campaign Brief actions; authorized provider channels only | Growth and Campaign | `PARTIAL` |
| Sales and Pipeline | deal evidence, follow-up drafting, stage-change preparation | pipeline records; registered deal-stage evidence | Sales and Pipeline | `PARTIAL` |
| Research and intelligence | source collection, citation, synthesis, contradiction handling | approved search/browser/model tools | Research and Intelligence | `PARTIAL` |
| Self-knowledge and migration advice | capability interpretation, Paige-first comparison, staged migration planning | planned/unavailable derived-manifest and plan/evidence adapters; existing tenant/source records only where separately proven | Paige Orchestrator with Research and Strategy support | `UNAVAILABLE` end to end; distributed primitives `PARTIAL` |
| Vibe Studio — Creative Brief and Strategy Specialist | versioned brief covering business goal, audience, offer, message, campaign, channel, asset and success evidence | planned Studio brief/version lineage; approved research/model tools only after registration and proof | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Funnel and Conversion Copy Specialist | sourced landing-page, offer, ad, email, CTA, follow-up and conversion-copy variants | planned Studio copy/version lineage; no send, publish or spend authority | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Forms and Conversion Flow Specialist | qualifying forms, intake logic, routing, consent, follow-up, conversion, validation and recovery specifications | planned Studio flow/version lineage; no silent publish, live-routing, website, form, schema or product change | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Long-Form Publishing Specialist | editable governed eBooks, guides, manuals, pamphlets, proposals, lead magnets and marketing collateral | planned Studio document/version lineage; no publication, syndication or sending authority | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Visual Asset Specialist | brand-aware concepts and variations within brand, rights and quality boundaries | planned Studio asset/version lineage; generation tools only after separate registration, authority, budget and proof | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Video Production Adapter | provider-neutral scripts, shot lists, storyboards, render requests and returned-asset reconciliation | planned neutral adapter/version lineage; Higgsfield is an unverified example only; no provider call, spend, upload or external-account change without separate gates | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Vibe Studio — Creative Quality Reviewer | owner-intent fidelity, brand/visual quality, funnel coherence, truthful claims, accessibility, version comparison and owner-ready presentation | canonical version lineage plus a role-specific approved creative evaluation contract; review grants no approval or execution authority | NEXUS creative/growth owner; MENTOR Studio platform/config/readiness owner; Paige orchestrates the temporary team | `UNAVAILABLE` |
| Usage and economics | consumption reconciliation, forecasting, anomaly review, optimization proposal | canonical usage records; verified provider rates and invoices | Cost and Usage Advisor | `PARTIAL` |
| Skill lifecycle | outcome review, evaluation design, versioned proposal | Skills catalogue, evaluations, owner corrections | Skills Steward / Skill Evolution | `UNAVAILABLE` |
| Platform operations | tenant health, support, release, fleet, entitlement, incident and margin operations | operator-only tools and records | Platform Operator specialists | `UNAVAILABLE` |

### 6.3 Delegation and evidence path

`Owner request -> Paige orchestrator -> scoped specialist job(s) -> approved skills/tools -> Spine authority -> canonical action/readback -> receipt/Rail -> Paige synthesis -> owner-visible result`

Paige owns goal interpretation, decomposition, conflict resolution, delegation,
verification, synthesis, and the single owner-facing response. A specialist
owns only its accepted job contract and accountable outputs. Specialists may
run asynchronously as durable Harness jobs, but may not hold uncontrolled raw
agent-to-agent conversations, create private untracked memory, bypass canonical
readback or Rail, or act beyond separately resolved authority.

`Owner -> Paige -> [Strategy | Client Success | Growth | Sales | Research | Creative | Cost | Steward | Operator] -> governed evidence -> Paige -> Owner`

**Vibe Studio creative path:**

`Owner request → server-derived tenant/workspace/actor context → Paige assembles approved specialist job team → scoped skills/tools → drafts and versions → quality review → owner approval → separately authorized publish/provider execution → verified receipt/Rail outcome`

NEXUS owns creative/growth outcomes, MENTOR owns Studio platform/config/readiness,
while Paige remains the orchestrator. The owner has one conversation with Paige.
Paige selects the smallest fixed,
approved role set for that accepted job; the workers are temporary job roles,
not seven permanent agents, user-facing identities, departments, or private
conversation threads. They receive explicit context, skill/tool versions,
budget, time, retry and concurrency ceilings, create drafts and review evidence
only, and end with the job. The summary path’s terminal “publish/provider
execution” means post-review external delivery; it does not authorize or hide a
provider-backed draft-generation call. When a visual or video draft requires a
provider, that call first needs a fresh Spine decision, registered provider,
enforced budget and applicable approval. Its result must be written and read
back canonically with a generation receipt/Rail before role-specific creative
review. Text or local drafts likewise require canonical write/readback and an
attributable job receipt/Rail before review. The reviewer’s finding/version is
also read back and receipted before Paige reports an owner-ready bundle.
Owner approval and later publish/send/upload/live-site authority remain separate
Spine decisions; the reviewer cannot self-approve, publish, call a provider or
retain private memory.

### 6.4 Activation roadmap

**Cohort 0 - mandatory Harness completion gate**

No specialist becomes a production agent until the shared Harness proves:
server-derived tenant/workspace/actor/role context; scoped Second Brain reads;
version-pinned skills and registered tools; per-action Spine decisions;
enforced spend/time/concurrency limits; durable jobs, retries and cancellation;
canonical write/readback; receipts and Rail; evaluation; recovery; and explicit
Mind/Memory eligibility. Cross-tenant, wrong-account, denied-authority, missing-
provider, timeout, duplicate, abandonment, and retry paths must fail closed.

**Cohort 1 - proposed first activation after Cohort 0**

1. Operating Strategy and Planning - read, analyze, draft, and propose only.
2. Research and Intelligence - source-grounded evidence packets only; no
   automatic Memory promotion.
3. Cost and Usage Advisor - reconcile verified usage/rates and recommend only;
   never invent rates, bills, charges, savings, or forecasts.
4. Skills Steward - evaluate and propose versioned changes only; never silently
   rewrite, activate, or deploy.

Their current labels remain `PARTIAL`, `PARTIAL`, `PARTIAL`, and
`UNAVAILABLE` respectively until every role-specific roster gate is met.

**Cohort 2 - domain action readiness**

Client Success, Growth, and Sales follow only after their canonical surfaces,
provider seams, write/readback paths, evaluations, and owner/client authority
boundaries are proven. Mixed surface status cannot be averaged into a claim.

**Cohort 3 - specialized production and internal operations**

Creative Production follows governed Studio and asset/outcome proof. Its first
future MVP sequence is: (1) Creative Brief and Strategy Specialist plus Creative Quality
Reviewer; (2) Funnel and Conversion Copy Specialist plus Forms and Conversion Flow Specialist;
(3) Long-Form Publishing Specialist plus Visual Asset Specialist; and (4) the provider-neutral Video
Production Adapter only after provider, rights, security, budget and evidence
gates. The smallest proof accepts one bounded brief; server-resolves tenant,
workspace and actor context; selects a fixed approved role set; pins skills,
tools, budget and concurrency; creates attributed versioned drafts in canonical
artifact lineage; verifies matching artifact/version ids by canonical readback;
runs the role-specific approved creative evaluation; writes and reads back the
attributed review; records job receipts/Rail for the drafts and review; and
returns one coherent bundle to Paige for owner approval. If provider-backed
asset generation is needed, it first receives its own Spine, provider, budget
and approval decision, then canonical result readback and generation receipt.
Only later may a separately authorized publish/send/upload/live-site effect run
with its own canonical readback and receipt/Rail. Acceptance also requires proof
that denial, tenant/account switch, retry, cancellation and provider-unavailable
paths fail closed. Each stage remains draft/version/review-only until those gates
pass.

Platform Operator specialists remain future internal dogfood behind operator
tenancy, role, entitlement, break-glass, incident, and release controls; they
are never public tenant agents.

### 6.5 Active collision and ownership map

| Surface | Active owner/collision | Audit rule |
|---|---|---|
| Competing agent registry/roster | PR #921 | Do not merge its proposed `paige-agent-registry.md` as canonical. Reconcile useful evidence into existing homes only. |
| Text-chat skills and interviews | PR #1044 | Preserve its Binding Ledger/chat/Game Plan ownership; this audit changes no runtime. |
| Secure Browser | PR #1046 | Preserve browser UI/control-plane ownership; classify only. |
| Live Conversation canonical base | PR #1068 merged as `610e609c` | Preserve its product, evidence, Master, decision-log, config, and provider-registry records; provider audio remains `PROOF OWED` and this audit classifies the modality only. |
| Orchestration and contact import | PR #917 | Preserve tool/job/chat/migration ownership; do not duplicate it. |
| Rail and Spine | PRs #729 and #776 | Preserve recovery and evidence workstreams; no schema or product edits here. |
| Brain and doctrine | PRs #754 and #1040 | Documentation overlap requires rebase/reconciliation before merge. |
| Client Portal, Platform Operator, social operations | Existing active/paused canonical workstreams | Keep their gates and truth labels; this audit grants no release or activation authority. |

This documentation delivery is R2 collision-sensitive but behaviorally inert.
Any conflicting canonical-doc change must be rebased and reconciled; a clean
textual merge does not prove semantic compatibility.

## Canonical references

- `CLAUDE.md` §7 — intelligent, tenant-authored, two-way client portal.
- `CLAUDE.md` §8 — Owner Ops, Client Experience, and the action bus.
- `CLAUDE.md` §14 — Paige's standing specialist team and orchestration rule.
- `CLAUDE.md` §16 — the 10-department model and autonomy layers.
- [`docs/doctrine/100M-org-blueprint.md`](./100M-org-blueprint.md) — canonical
  organization blueprint; consult it for the full department map, roles, KPIs, and
  rollout.
- `CLAUDE.md` §17 — revenue engines, scaled governance, and the Commerce Line.
- [`docs/doctrine/1B-growth-map.md`](./1B-growth-map.md) — canonical growth map;
  consult it for the full engine, stage, and governance model.
- `CLAUDE.md` §35 — Paige OS north star and later-wave context expansion.
- `CLAUDE.md` §36 — intuitiveness moat and five-minute test.

This reference should be updated only when its canonical sources change. Proposed
product ideas belong in plans or owner-review documents until they become doctrine;
they must not be presented here as shipped capability or canonical direction.

---

Co-authored-by: Codex <codex@openai.com>
