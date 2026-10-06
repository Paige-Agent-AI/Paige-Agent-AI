# 🧠 The Second Brain — master index & read-first orientation

**What this is.** A durable, verified index of Paige Agent AI's doctrine + platform state, so a
future session can answer *"do we have X?" / "where does Y live?" / "what did we already decide?"*
from a **document** instead of re-diagnosing a system that's already been built and documented.
This directory is the single entry point. Read this file first.

**Why it exists (§13/§30/§46).** The recurring, expensive failure is a session re-deriving a
pipeline, re-diagnosing a config, or rebuilding a surface that already exists — because the
knowledge lived only in a past chat that evaporated on context reset. The brain ends the guessing.
A hallucinated fact in here poisons every future session, so **every fact is either verified
this session (cited) or explicitly marked `⚠ unverified — confirm`.** Never assert into this
index what you have not checked.

**How to use it.**
- **Starting any substantive work?** Read this README, then jump to the domain doc(s) via the
  index below. If you're touching infra/integrations, read `config-registry.md`.
- **Asked "is X built / do we have Y?"** Answer from `codebase-map.md` (shipped routes/components/edge
  functions) + `config-registry.md` (integration wiring) + the index here + the cited source, not from
  memory. **A recorded "not built" counts** — see `decision-log.md` → "Known-unbuilt / spec-only status."
- **Need the meaning of a §-number, tier word, or VP name?** → `glossary.md`.
- **Need "what happened / what did we decide recently?"** → `decision-log.md`.
- **Adding or changing a department/domain, model, agent, skill, voice path, browser, proactive job,
  MCP server, or external tool?** → read the canonical Paige Runtime Harness decision in
  `../PAIGE-MASTER-PROJECT-REFERENCE.md` Section 3, then
  `paige-brain-wiring-standard.md`, `paige-spine-and-rail-state.md`, and the Integration Capability
  Registry when a provider or connected app is involved. No surface may invent a parallel runtime,
  authority seam, Brain, Rail, receipt store, registry, or “agent memory”; departments are
  capability domains within one shared Paige Harness.
- **Adding capability self-description, competitor comparison, replacement, consolidation, cutover,
  or migration advice?** → read the Master Runtime Harness subsection **“Paige Self-Knowledge &
  Migration Advisor”**, then `paige-brain-wiring-standard.md`, the Integration Capability Registry,
  and Surface Binding Ledger. Derive tenant truth from current server-owned sources; do not create a
  second capability registry, migration database, or customer-facing assistant.
- **Building ANY capability — where does it belong and what proof does it owe?** → the owner rule
  `../PAIGE-MASTER-PROJECT-REFERENCE.md` → "Capability Portfolio — the One Paige Operating Platform
  rule", then the routing map `../doctrine/paige-capability-portfolio.md`. Paige is one governed
  operating platform; every capability uses the one Gateway→authority→adapter→readback→receipt/Rail
  path. **The matrix routes, it does not rule:** per-surface truth stays in
  `../binding-ledger/`, per-provider truth in `../integration-registry/`, per-layer Harness truth in
  `../delivery/harness-completion-map.md`, and per-capability ship-time completion in
  `paige-brain-wiring-standard.md` §3. Do not copy portfolio records into the Brain — cite them.
- **Hit a weird recurring bug?** → `lessons-learned.md` (symptom → root cause → rule).
- **Opening/closing a PR, merging, deploying, versioning, or drafting a customer update?** →
  `../doctrine/release-governance-and-customer-update-policy.md`.
- **Checking what shipped, or preparing/closing a merge to `main`?** →
  `../PAIGE-MASTER-PROJECT-REFERENCE.md#40-shipped-delivery-log`; every `main` merge gets one verified chronological row.

<!-- RELEASE_GOVERNANCE_POLICY -->

**Closeout is TWO records, not one (owner-ruled 2026-09-02; shipped-log discipline clarified 2026-09-07).** A workstream is not complete until the
relevant brain file **and** `docs/PAIGE-MASTER-PROJECT-REFERENCE.md` are updated, whenever the work
changes product capability, platform truth, release status, architecture, owner flow, or a material
known limitation — or a collision-safe handoff names the exact section, proposed text, owner and
reason. Every merge to `main` also gets one verified row in Master Reference Section 4.0; a PR that
did not reach `main` records that log update as `N/A`. The rule and its reporting gate live in
`.claude/skills/second-brain/SKILL.md`.

A closeout-only PR used solely to record the preceding delivery's exact post-merge identity is not a recursive new shipped item. It may not carry product, policy, capability, or status change.

**How to keep it true (see proposed CLAUDE.md §BRAIN).** Any PR that ships a feature, changes
config, or lands a ruling updates the relevant brain file **in the same commit**. A stale brain is
worse than none — it lies with authority.

**Billing P0 current truth (2026-09-03):** authenticated owner setup FAIL; repair candidate, provider completion unverified. Secret presence confirmed without values. [Repair, flow boundaries and proof ledger](../delivery/billing-payment-setup-p0.md). Prepaid credits remain gated on payment setup verification and owner commercial approval.

**Brain-internal files**
| File | What it holds | When to read |
|---|---|---|
| `README.md` (this) | Master index of every doc + orientation | First, every session |
| `../PAIGE-MASTER-PROJECT-REFERENCE.md#40-shipped-delivery-log` | **The sole chronological Shipped Delivery Log** — every `main` merge, why it shipped, exact identity/evidence, proof boundary, and customer-release eligibility | Before claiming delivery; update after every merge to `main` |
| `codebase-map.md` | Shipped surface area — routes (3 routers), component folders, edge-fn theme groups, feature gates, integration entry points | "Do we have surface/feature X **built**?" |
| `config-registry.md` | Infra/integration state — Twilio (incl. ISV/subaccount), ElevenLabs (3 voice systems), Stripe, Supabase, CI, MCP, signup, third-party (NAMES/IDs only, no secret values) — Voice: exact #1073 account-inspection and #1077 larger-Presence release identities and unchanged provider/owner proof gates are in the [canonical Live closeout](../evidence/ui-delivery/paige-live-conversation-mvp.md#prs-1073-and-1077-production-closeout-2026-09-08-carried-forward-2026-09-21-from-stale-pr-1078-under-int-108) | Touching any integration or deploy |
| `roles-permissions.md` | How roles actually work: the three stores, the owner→global-admin amplifier, which helper to use, live counts, what's not built | 2026-08-18 |
| `decision-log.md` | Chronological one-liners: PRs #375+, dated rulings, wave decisions | "What changed / what did we decide?" |
| `lessons-learned.md` | Recurring traps: symptom → root cause → rule | Before a class of work that's bitten us before |
| `paige-brain-wiring-standard.md` | **The Second Brain versus Runtime Harness distinction, one-runtime/many-capability-domains rule, Self-Knowledge & Migration Advisor consumption boundary, and six-part checklist every capability must satisfy** — knowledge record + callable seam + context feed + tool registration + tier availability + modality-neutral acceptance. Includes the running coverage ledger while routing current Harness authority to the Master decision | **Before department/domain, capability answer, comparison/migration, model, agent, skill, voice, browser, proactive-job, or external-tool work; and when shipping ANY capability** |
| `cd-pack-port-playbook.md` | How to port a Claude Design pack surface to a live tier: the 7-step procedure + the 6 traps that have actually cost us. Written from the operator port so Agency/Sub-account/Solo/Enterprise don't re-learn them | Before porting any pack surface to any tier |
| `design-system.md` | Palette · gold discipline · type · depth · motion · layout · taste — and where each source lives | ANY design work, or "what is our design system?" |
| `../doctrine/paige-attention-register.md` | **Where a platform finding lives so it is never lost** — the five records and what each is for, the register's nine fields and eight views, the eleven delivery statuses and what each one means, intake and closeout rules, the board's acceptance criteria, and the honest record that the GitHub Project does not exist yet | **Whenever a finding is discovered outside the current assignment's scope**, or before closing out any workstream |
| `../doctrine/paige-capability-portfolio.md` | **Where a capability belongs and what proof it owes** — the fifteen portfolio families mapped to current truth label, domain owner, shared dependencies, the canonical records to update, and the completion proof required. A routing and sequencing map that CITES the Binding Ledger / Integration Registry / Spine / Rail / Harness Completion Map and replaces none of them | **Before building any capability**, or when asked "where does this go / what must it not duplicate?" |
| `../doctrine/one-approval-gate.md` | **How Paige proves the operator said yes — and the rule that no slice builds its own version.** How to add a gated action (classify it, stop), what is forbidden and why each shipped once, and how to rewrite a slice that built its own channel | **Before adding ANY action Paige performs on the operator's behalf**, or touching the confirm gate |
| `../doctrine/surface-cards/` | **The Solo surface cards** — one per department, ten required fields, a truth label. `README.md` carries the schema and maps the Alignment Standard's named documents to what actually exists | Before changing ANY Solo department |
| `../delivery/solo-setup-persistence-release.md` | Solo Setup durable-save diagnosis, exact migration evidence classes, release truth, and authenticated-runtime proof debt | Before changing or releasing Solo Settings → Setup |
| `../handoff/solo-setup-business-context-spine-handoff.md` | Safe-field proposal and exclusions for a Setup → Spine/Mind projection. **PARTLY REALISED 2026-09-03** by `business_context.readiness`, which ships a deliberately NARROWER contract than this doc approves — status + provenance for four fields, never a raw value (this doc permits the public website value itself). Its exclusions still bind everything not in that contract | Before connecting Setup context to PAIGE, Mind, Spine, or Rail |
| `../doctrine/canonical-solo-parity-matrix.md` | **The canonical Solo parity matrix** — every Solo route, branch, sub-tab, Settings destination and PAIGE entry point, each marked canonical / needs-auth-comparison / needs-UI-repair / backend-owned / Spine-owned / intentionally-unavailable / parked. Carries the Wave 0 finding that 3 of 7 Solo tenants do not receive the canonical shell at all, and the sequenced wave plan | Before ANY Solo parity work; "is Solo surface X canonical yet?" |
| `../doctrine/solo-shell-contract.md` | **The canonical Solo shell contract** — one shell for every Solo tenant, address-vs-authority, the CSS-clip interaction policy, the four-viewport proof bar, and the map of what already enforces each rule | Before ANY Solo shell, routing, layout, page-host, responsive or PAIGE-workspace change |
| `solo-settings-scroll-and-release-playbook.md` | Shipped Solo Settings scroll/reachability contract: one real owner, visible-scroll scope, reset/focus, reproduced-shell proof, actual-`SoloApp` gaps, harness cleanup and exact-head release labels | Any Solo Settings reachability, scrolling, contextual-rail, PAIGE-fold or release-proof work |
| `../delivery/solo-social-command.md` | **The Social data-point map** — every value on Campaigns › Social with its source, whether a human can edit it, whether PAIGE can read/write it, and how far it reaches into Spine/Mind/Rail/chat. Carries the honest position on live provider connections and what they would require | Any Social, social-handle, or provider-connection work |
| `../delivery/platform-operator-command-center.md` | **The Platform Operator Command Center Phase 0 map** — where the Command Center lives (the owner-locked v3 console, not a new shell), the reuse map onto existing seams, the collision map against the owner's in-flight streams, the §58 Team-Pulse displacement record, the ten AGENTS.md capability-routing answers, and the phase slice ledger | Any Platform Operator console work, before any operator-surface slice |
| `solo-people-contact-upsert-playbook.md` | Solo Clients / People contact ownership, tenant-safe human + PAIGE upsert flow, form-fit guardrail, two-context viewport proof, and exact-head Gate 2 discipline | Any People contact create/edit, Clients form-fit, contact mutation, or PAIGE contact-update work |
| `glossary.md` | §-anchors, tier vocab, VP roster, wave/slice names, project jargon | Any unfamiliar term |
| `goat-anchor-registry.md` | The intellectual DNA of Paige's professional intelligence — WHOSE proven framework anchors WHICH domain (v1, 13 anchors). Branded names OK in docs; **code = mechanic-descriptive only** | Seeding a skill / authoring a methodology anchor / investor IP disclosure |
| `paige-skills-inventory.md` | What Paige DOES at professional level — the 12-category, ~100-skill inventory (v1). The S2 seeding target list; complements the GOAT registry (what she executes vs whose thinking she reasons from) | Seeding a skill / S2 wave / investor IP disclosure |
| `pipeline-identity-contract.md` | Draft Pipeline UUID/PPL identity, zero-deal duplicate catalogue, truthful provenance, and exact-reference governed archive contract | Any Pipeline catalogue, create, rename, stage-management, archive, or Paige Pipeline-tool work |
| `docs/delivery/solo-pipeline-empty-delete.md` | Bounded Solo Owner empty-pipeline deletion; dependency inventory, exact-reference confirmation, proof and release ledger | Any Pipeline deletion or deletion-caller work; also read `docs/doctrine/surface-cards/pipeline.md` |
| `paige-spine-and-rail-state.md` | **Verified Spine + Rail current state, and the existence-vs-reachability rule.** Three registered capabilities (`pipeline.deal_stage_evidence`, `business_context.readiness`, `team.authority`) against 105 inline Chat tools (and why `business_context.readiness` is workspace-level without the Rail Change Request — a live read is a different evidence class from a Rail signal); why most departments cannot be added without a Change Request; and why owner-visible Solo Rail activity is UNAVAILABLE rather than empty | "Is department X connected to PAIGE?" · before any Spine capability · before reading anything into an empty Solo activity feed |
| `paige-operating-fabric-contract.md` | **The PAIGE Operating Fabric: grounded current-state map + the Domain Snapshot / Business Operating Snapshot contract** (2026-10-06, `8b7f975`). It has a per-domain row for 40+ domains (canonical source, tenant-safe read, Spine key, Chat/Live reach, period support, truth status, verified against prod), plus what is connected end to end, what is stranded (UI-only analytics RPCs, tenant Systems Check, Business Vault, the governed memory seam), and the exact missing cross-domain contracts. It covers the Chat ↔ Live shared-runtime path, the business-wide memory scope gap, Game Plan state, and the bounded PR sequence F1–F9. The seam is `_shared/paige-context/snapshot.ts` | Before answering "do we have X in PAIGE's reach?" for any business domain · before building a business review, briefing, or cross-domain read · before adding a context source |
| `paige-memory-contract.md` | **The governed continuity contract for Paige MEMORY** — the four memory concepts kept apart (Rail activity · Spine current evidence · Mind knowledge · Memory continuity), which type lives in which store (extend `paige_owner_memory`/`client_memory`, never fork), the §10 callable seam (`record_/get_/forget_paige_memory`, §59-clean), the six governance fields per item, and the honest deferred/follow-up list | Any work that stores/retrieves/corrects/deletes what Paige remembers · before adding a memory type or a memory write path |
| `../doctrine/release-governance-and-customer-update-policy.md` + `../release-governance/release-record.schema.json` | **The canonical release identity and customer-update contract** — separates exact internal build identity, release channel, and earned customer version/name; defines the `0.x.y` Solo Preview model, announcement gate, What's New format, machine-readable record, and release-aware behavior of the existing signed-in update banner. <!-- RELEASE_GOVERNANCE_POLICY --> | Before opening/closing a PR, merge, deployment, staged rollout, version decision, customer update, or answering “What changed?” |
| `solo-tenant-brain.md` | **The Solo Tenant Brain boundary and current vertical slices** — governed composition over canonical tenant records, never a new store or transcript brain. Records the Business Mission flow from caller-scoped context through canonical readback to post-verification Rail, with Mind/Memory unavailable | Any Solo Tenant Brain, Mission context/outcome, cross-lane retrieval, or tenant-brain completion claim |
| `codebase-map.md` → “Business Vault Phase 2 security foundation” + `decision-log.md` → 2026-09-06 Vault ruling | The owner/admin Vault surface, tenant/RLS boundary, provider-neutral quarantine contract, disabled binary-release state, proof ledger, and #724/#917 collision handoff | Before any Vault, document intake, inspection/OCR/DLP, Vault-to-Mind, retention, client publishing, or Settings-mount work |

---

## Verified platform snapshot (this session, 2026-08-09)

**Current Solo-shell delivery correction (verified on production 2026-09-07):** the eligibility
query now returns **4 active top-level standalone Solo tenants; all 4 have
`features.solo_shell_enabled=true`; 0 eligible tenant is served the legacy shell**. The older
7/4/3 count below and in the parity matrix is retained as historical rollout evidence, not current
platform truth. This count does not by itself prove every authenticated surface or user journey.

All figures below were checked live this session; how each was verified is in `config-registry.md`.

- **Supabase project ref:** `xygzykjyynhzqytbqnzu` (verified: `config.toml`, Supabase MCP).
- **Migrations:** **764** applied on prod = 764 `.sql` files in repo → **zero drift**; latest
  `20260813000000` (verified 2026-08-09: `supabase_migrations.schema_migrations` via MCP `count`/`max`
  = 764/`20260813000000` + repo `ls`; incl. #408 `20260812000000` + #409 `20260813000000`, §32.a-confirmed).
- **Edge functions:** **243** function directories under `supabase/functions/` excl. `_shared/`
  (verified: `ls -d */`). Count churns as functions ship — see `codebase-map.md` for the theme groups.
- **Tenants on prod:** ~~**11** — 10 `account_type='standalone'`, 1 `'agency'`~~ (verified 2026-08-09: MCP query) — **SUPERSEDED 2026-09-02: now 13** — 2 `agency`, **7 top-level `standalone` (Solo)**, 4 `sub_account` (verified: MCP query). Of the 7 Solo tenants, only **4** carry `features.solo_shell_enabled`, so 3 do not receive the canonical Solo shell — see `../doctrine/canonical-solo-parity-matrix.md` §0.
- **Stripe account:** `acct_1TvndiLUcYKxolNa` "Paige Agent AI" (verified: Stripe MCP).
- **Active platform plans:** DB `platform_subscription_plans` = solo · agency · enterprise (all
  `is_active`); **live Stripe active prices = Solo + Agency only** (Enterprise has no active Stripe
  price yet — see `config-registry.md`).
- **CI pipelines:** 6 — `ci`, `deploy-migrations`, `deploy-edge-functions`, `migration-lint`,
  `premerge-migration-proof` (**DISABLED** since 2026-08-24 — does not run; #574), `security-audit` (verified: `.github/workflows/`). Plus two RLS
  drift-guard npm scripts wired into `ci.yml`: **`lint:views`** (VIEW `security_invoker` drift, #116/PR #447)
  + **`lint:definer-fns`** (`SECURITY DEFINER` fn granted to anon w/o exempt escape, #117/PR #448) —
  the anon/cross-tenant-reach class is now guarded at both Postgres object types. See `config-registry.md` → CI.
- **Paige voice identity:** server-resolved through the approved `paige_default_voice` profile and
  immutable session revision. Historical literal/request overrides were superseded by the
  2026-09-07 Live Conversation delivery. Provider-backed realtime audio remains `PROOF OWED`; see
  `config-registry.md` → Voice.
- **Live Conversation admission (2026-09-24, migrations `20270420000000` then `20270422000000`):**
  eligibility is a question about the tenant's TIER (`live_conversation_tier_allows`, the server twin
  of `SOLO_FEATURES`, pinned to it by a test), so every Solo account satisfies it the moment it is
  provisioned — no per-account row, no operator action, and a MISSING `paige_live_tenant_availability`
  row now means "follow the scope" rather than "refused". *Who may speak today* is ONE setting,
  `paige_voice_readiness.pilot_rollout_scope` (`'off' | 'solo_tier'`), which names no person, login or
  workspace and ships `'off'`; `paige-voice-profile-admin` has one additive action to turn it. The
  three admission edge functions used to read the availability row themselves and refuse before ever
  consulting the predicate, which made the tier change inert in every product path until an
  adversarial read caught it; those duplicate reads are gone and the predicate is the one home.
  HONEST GAP: no surface calls `paige_live_accept_terms()` yet, so opening the scope gives a Solo user
  nothing to press. Admission used to be an identity predicate pinned to one `super_admin` user id,
  which made every other Solo account structurally incapable of Live — see
  `lessons-learned.md` and
  [the evidence record](../evidence/ui-delivery/int-104-live-rollout-is-configuration.md). The
  provider gate is unchanged and still shut; a multi-tenant build is not the restriction lifting.
- **Operator Communications:** live on prod — PR #408 (`2ee92903`), §32.a confirmed
  (`operator_conversations`/`operator_messages`). Inert until A2P MG SID + inbound token pasted.
- **Wave 4a:** CLOSED — 4a.1 Agent right-rail (#405) · 4a.2 L8 Memory Fabric (#406) · 4a.3 chat
  compaction/persistence/tasking (#407) · 4a.4 Analytics primitive (#411, `c40f76d3`).
- **Root law now includes** `§BRAIN` (Second Brain discipline) + a "Voice Configuration" reference
  section, both in `CLAUDE.md` as of #409/this PR.

---

## Doctrine index — the "how we build & how Paige runs" law

Root law is `CLAUDE.md` (§1–§39 + §50–§53 + §56 + `§BRAIN` + a "Voice Configuration" reference
section; see `glossary.md` for the full anchor map). The docs below are the long-form doctrine that
`CLAUDE.md` sections point to. **§56 (2026-08-10) — the pre-build tier-matrix gate:** before ANY
build, open `docs/doctrine/tier-matrix.md`, name which account type(s) the change is for, and decide
per-tier whether the feature belongs (a "every tier" capability must render regardless of
empty-book/branch/route accident). See `lessons-learned.md` #11 for the anchoring bug. **§61
Standing Tier Distribution Default (2026-08-11, PROPOSED)** (same doc, tier-matrix.md §61): don't ask
the owner "which tier?" — every new feature defaults to **God = YES · Solo = YES · Sub-account = YES ·
Agency = RESELL** (resells to sub-accounts via Marketplace, does NOT operator-use it) **· Enterprise =
YES + RESELL** (hybrid). Deviations need an owner ruling + a code comment; matching features ship noting
"§61 default: no exception". Preserved exceptions: `customer_portal_invite` (Solo+Sub+Enterprise),
`growth`/`studio` (Solo+Sub+God, Agency excluded).

| Path | One-line | When to read |
|---|---|---|
| `docs/doctrine/100M-org-blueprint.md` | Paige's canonical 10-department operating model (§16) | Building anything into the org/departments model |
| `docs/doctrine/1B-growth-map.md` | $1B ARR revenue + governance north star (§17) | Placing a revenue feature on the engine/stage map |
| `docs/doctrine/canonical-build-order.md` | The authoritative wave/slice build sequence | Deciding what to build next / where a slice sits |
| `docs/doctrine/tier-matrix.md` | The canonical six tiers + resolution/RLS per tier (§51) + the §56 pre-build gate | **BEFORE any build (§56)**; any tenant-scoped change; every §37/§51 check |
| `docs/doctrine/skills-vocabulary.md` | The 4 "skill"-adjacent concepts (paige_skills recipe · marketplace add-on · paige_subagents specialist · methodology anchor) + their tier availability | Any work touching skills/skill-runner/skill-forge/subagents/marketplace — disambiguate "skill" first |
| `docs/doctrine/compliance-checklist-template.md` | Tier-matrix compliance checklist to run per crew | Compliance pass on a tenant-scoped surface |
| `docs/doctrine/producer-inventory-template.md` | §37 × tier producer-inventory worksheet | Hardening/altering any endpoint contract |
| `docs/doctrine/money-spine-architecture.md` | Full money architecture — Paige-held vs facilitated rails (§38) | Any payment/billing surface |
| `docs/doctrine/command-center-four-surfaces.md` | The four Command Center sub-tabs as four parts of ONE machine — Game Plan (what should we do) · Systems Check (can the systems do it) · Trust Compass (can I trust the agent) · Mind (what does Paige know) — plus the loop between them, Trust Compass's three-fact status, and the rule that a Solo tenant never learns the platform posture | Any Command Center sub-tab work; before assuming two of them overlap |
| `docs/doctrine/governed-execution-seam.md` | **The shared governed execution seam** — the one pathway a capability runs through from Chat, an automation, an agent, a skill or MCP, and the door-blindness property that stops a different door meaning more permission. Records why it does NOT wrap the unwired #711 module | Before routing ANY capability through the Spine, or adding a non-Chat caller that performs an action |
| `docs/doctrine/paige-modality-neutrality.md` | **One Paige workspace and one governed execution path across modalities** — text, Live Conversation, future phone/SIP, Secure Browser, handoffs, and cards may receive/present differently but never fork tenant resolution, Spine, authority, canonical tools, readback, receipts, Rail, or durable-knowledge eligibility | Before adding or changing ANY Paige surface, modality, conversation card, voice path, browser companion, or phone/SIP entry |
| `docs/doctrine/surface-context-handoff-contract.md` | **The Surface Context Handoff Contract (Paige OS Integration Phase 1, CONTRACT PUBLISHED — not yet adopted)** — the one server-safe way a surface opens the dedicated Paige workspace with a structured INTENT (never raw page payload or authority); the three gaps it closes (raw `clientContext` prose, the dropped prompt #771, no surface identity); reuse of the JWT tenant resolution + `paige_pending_confirmations` gate + Spine registry (no second approval system); the two regression guards + migration sequence | Before touching `paige:open`, `paigeClientScope`, `clientContext`, or how any surface opens Paige |
| `docs/doctrine/connections-rail-contract.md` | The Page/Rail/PAIGE/Brain contract for Connections & A2P — what may reach the rail, what PAIGE may read/do, and the 4 missing shared contracts (C-1…C-4) nobody may substitute for | Any provider-setup, readiness, A2P or communications-outcome work |
| `docs/doctrine/relationship-context-and-governed-memory-contract.md` | **The source-of-truth + handoff contract for client RELATIONSHIP context** — four separated layers (canonical CRM facts owned by People/Clients via §202 · governed relationship context owned by Mind/Memory via the Release C seam · future Conversations/Transcription evidence ingestion · Marketplace templates), the exact canonical fields People/Clients must own, the governed memory types + evidence rules, ingestion requirements, and collision boundaries. Authorizes no schema/UI/pipeline — the map future pieces join onto | Any work touching client relationships across CRM, memory, transcripts, imports, or engagement templates — read before proposing a relationship-fact source |
| `docs/brain/comms-capability-map.md` | What A2P / numbers / voice actually exist, and the difference between code that exists, is deployed, and is reachable. The stranded-surface backlog and the resurfacing order | "do we have comms X?" · any A2P, number, or voice work |
| `.claude/skills/README.md` | What lives in `.claude/skills/` and why nothing third-party does: the MIT notice for the §69 skill can neither be fetched nor reconstructed without inventing a copyright holder, and what would unblock it. **Carries the 2026-09-01 correction** — the "half-install" an earlier revision described is NOT real; the synced bundle inlines every reference and is self-contained | Any software task here — §69 makes the skill mandatory · before vendoring or updating it |
| `.claude/skills/second-brain/SKILL.md` | **Ours.** Read the brain BEFORE work and update it BEFORE done — both bookends. Step 1 says which file answers which question; steps 3–4 record what the task taught and sweep for the claims it falsified (§0 master ref · §BRAIN.3 brain · §66 tier matrix each bind a DIFFERENT file). Loads on every fresh container | One of the FIRST steps of any task here, and again as one of the LAST |
| `docs/doctrine/paige-ui-delivery-standard.md` | The canonical Experience-Quality Layer standard of the one Paige Runtime Harness — the mandatory skill order, design + evidence contracts, the Solo viewport matrix, truth labels, and the **five composable quality skills** it is executed through (`paige-owner-intent-fidelity` · `paige-visual-immersive-quality` · `paige-interaction-geometry-accessibility` · `paige-protected-behavior-regression` · `paige-release-acceptance-evidence`, each a `.agents`/`.claude` skill pair routing back here) | Any visible-interface change; authoring or invoking any of the five quality modules |
| `docs/delivery/harness-upgrade-reconciliation-2026-09-12.md` | Phase-1 current-state reconciliation of the one Runtime Harness across its three layers (Runtime Capability · Experience Quality · Owner Operations & Learning) — cites the canonical homes, records what is LIVE/PARTIAL/UNAVAILABLE/PROOF OWED per function, the verified governance-guard reds on `main`, and the affected-flow/collision + protected-seam assessment | Grounding any Harness-upgrade phase; "what is the Harness's real state?" |
| `docs/doctrine/paige-c-suite-roster.md` | Proposed VP presentation and capability-ownership roster (VERA/NEXUS/CURA/…); every VP/specialist remains inside one Paige Runtime Harness with no separate memory or authority | Referencing or forging a Paige VP/sub-agent |
| `docs/doctrine/paige-os-architecture.md` | Paige-as-OS architecture (§35) | OS-shaped primitive decisions |
| `docs/doctrine/paige-practice-blueprints-2026-07-29.md` | One-click vertical "Blueprint" install layer | Playbook/Blueprint/vertical-preset work |
| `docs/doctrine/paige-unified-comms-substrate-2026-07-29.md` | §49 unified comms substrate spec | Comms/messaging/channel work |
| `docs/doctrine/L8-memory-fabric-workstream.md` | L8 owner-memory fabric scope brief | Memory-layer / `paige_owner_memory` work |
| `docs/doctrine/wave5-phase1-phase2-sequencing.md` | Wave 5 phase-1-then-2 sequencing standard | Planning Wave 5 |
| `docs/paige-master-implementation-order.md` | Master implementation order | Cross-wave sequencing |
| `docs/paige-roadmap-action-bus.md` | Action-bus era feature roadmap (§8) | Action-bus / cross-team coordination work |
| `docs/paige-n8n-orchestrator-brain-doctrine.md` | Paige→n8n orchestrator authoring doctrine | Authoring n8n workflows via Paige |
| `docs/n8n/*.json` | Authored n8n workflow JSON (e.g. `paige_stage_change_dispatcher_v2.json`) — the actual workflow artifacts | "Do we have n8n workflows built?" |

## Security doctrine index (DOCTRINE_190–213 + related)

| Path | One-line | When to read |
|---|---|---|
| `docs/security/DOCTRINE_190_191_192.md` | §190/191/192 Phase-B codification | Platform-separation / billing phase-B context |
| `docs/security/DOCTRINE_194_MONITORING_ONLY.md` | §194 — credit **monitoring**, NEVER credit repair | Any credit/monitoring surface (§2 boundary) |
| `docs/security/DOCTRINE_197_BILLING_LAYER_TAXONOMY.md` | §197 — L1/L2/L3/L4 billing-layer taxonomy | Any billing/metering feature |
| `docs/security/DOCTRINE_198_LEGACY_DEPRECATION.md` | §198 — legacy data deprecation protocol | Deprecating a table/column/function |
| `docs/security/DOCTRINE_198_ADDENDUM_DEPRECATION_REQUIRES_CUTOVER.md` | §198 addendum — deprecation requires cutover | Same, when a live cutover is involved |
| `docs/security/DOCTRINE_200_PLATFORM_INDEPENDENCE.md` | §200 — platform independence from the reference tenant | Anything that could hardcode a tenant's content into platform |
| `docs/security/DOCTRINE_201_PUBLIC_LANGUAGE.md` | §201 — public-facing language discipline | Public/marketing copy sweeps |
| `docs/security/DOCTRINE_202_MULTI_ENTITY_CONTACTS.md` | §202 — multi-entity contact relationship model | Contacts / clients data model |
| `docs/security/DOCTRINE_203_LANE_SEPARATION_RUNTIME.md` | §203 — product-lane separation runtime enforcement | Coaching-generic vs funding-lane runtime seams |
| `docs/security/DOCTRINE_205_METERING_SAFETY_NET.md` | §205 — metering fire-and-forget + dead-letter reconciliation | Metering event emission |
| `docs/security/DOCTRINE_208_SHAPE_DELTA_DISCIPLINE.md` | §208 — migration shape-delta discipline | Writing a schema migration |
| `docs/security/DOCTRINE_210_L2_L3_SCOPE_BOUNDARIES.md` | §210 — L2 subscription-state vs L3 metering boundary | Billing state vs usage events |
| `docs/security/DOCTRINE_213_MIGRATION_SHAPE_DISCIPLINE.md` | §213 — migration shape discipline | Writing a schema migration |
| `docs/security/AUDIT_213c_RETRO_2026_07_03.md` | §213.c retro — DO-block snapshot isolation | Migration DO-block patterns |
| `docs/security/OPERATOR-ACCESS-MODEL.md` | Which account operates the platform (operator seam) | Operator/God-tier access questions |
| `docs/security/PLATFORM_SEPARATION_AUDIT_2026-07-02.md` | Platform-separation audit snapshot | §9 platform/tenant seam history |
| `docs/security/SECURITY_DEFINER_CATALOG.md` | Catalog of `SECURITY DEFINER` functions in `public` | Auditing/adding a DEFINER function (§39 IDOR risk) |
| `docs/security/612-clients-linking-integrity.md` | #612 clients-linking integrity (§9) | Client-linking / ownership integrity |
| `docs/security/p1c-privacy-multiowner-prescope.md` | P1c privacy + multi-owner pre-scope (research) | Multi-owner/privacy scoping |
| `docs/security/MIGRATION_B0_ROW_CLASSIFICATION_AUDIT.md` | Migration B.0 row-level layer classification | Billing-migration B lineage |
| `docs/security/MIGRATION_B0_RECONCILIATION_ADDENDUM.md` | Migration B.0 reconciliation-responses addendum | Same lineage |
| `docs/security/MIGRATION_B_SHAPE_PROPOSAL.md` | Migration B shape proposal (§208) | Same lineage |
| `docs/security/MIGRATION_B_SHAPE_PROPOSAL_PATH_B_FINAL.md` | Migration B shape proposal — Path B FINAL | Same lineage |
| `docs/sprints/SPRINT_211_212_ENFORCEMENT.md` | §211 — zero brand references in code enforcement | Brand-in-code sweeps |

## Architecture index

**Tenant Client Portal routing (owner correction 2026-09-08):** before adding or changing any
client-facing model, skill, message, request, approval, task, document, portal tool, provider, or
external action, read the Master Runtime Harness decision first, then
`docs/product/BRD-MVP-2026-08-08.md`,
`docs/product/customer-portal-owner-trilogy-taxonomy-matrix.md`,
`docs/strategy/client-experience-workstream-2026-07-21.md`, and
`docs/handoff/two-way-client-portal-audit.md`. The Tenant Client Portal is a `PARTIAL` MVP
capability projected through the one shared Harness. It is not a separate Brain/agent/runtime, and it
is distinct from any later Paige Enterprise Success Portal for Paige's own enterprise customers.

| Path | One-line | When to read |
|---|---|---|
| `docs/architecture/CANONICAL-SYSTEM-ARCHITECTURE-2026-08-08.md` | Canonical system architecture (newest, 2026-08-08) | First stop for "how is the system wired?" |
| `docs/architecture/platform-operator-tenant-200.md` | §200 platform-operator tenant / operator workspace | Operator-tenant model |
| `docs/architecture/tenant-domain-and-communications-spine.md` | Tenant domain + comms spine | Domain/email/comms routing |
| `docs/architecture/ECOSYSTEM_DATA_OWNERSHIP_MAP.md` | Who owns which data across the ecosystem | Data-ownership seam questions |
| `docs/architecture/ECOSYSTEM_FULL_STACK_BOUNDARIES.md` | Full-stack boundary map | Cross-boundary integration |
| `docs/architecture/MARKETPLACE-DATA-MODEL.md` | Marketplace data model | Marketplace tables/RLS |
| `docs/architecture/SPRINT_C1_TENANT_READINESS.md` | Sprint C.1 non-MMA tenant readiness gate | Tenant-readiness onboarding |
| `docs/architecture/paige-spine-tool-migration-map.md` | **Every one of the 105 legacy Chat tools, with one disposition each** (13 Migrate · 79 Spine Change Request · 3 Keep unavailable · 10 Retire), nine sequenced waves, the verified baseline and its reconciliation, the CI-ratchet proposal, and the ten-condition `LIVE` standard. Records why the Spine's evidence contract carries enumerated events and not records | Before adding a Chat tool, migrating one to the Spine, or answering "is department X connected to PAIGE?" — read `paige-spine-and-rail-state.md` first for the *state*, this for the *plan* |
| `docs/integration-registry/README.md` + `integration-capability-registry.json` (+ `expense-and-operations-report.md`) | **The Integration Capability Registry** — the one authoritative, living catalogue + taxonomy of every third-party provider/API/connector/Marketplace service/external-execution platform Paige may use, and how each is governed (taxonomy · tier eligibility · authority lane · cost-track dependency · canonical provider receipt · Rail/Mind/Memory boundary · six-word status LIVE/PARTIAL/PROPOSED/UNAVAILABLE/DEFERRED/PROOF OWED). **v1.1 API Expense & Operations Layer** adds per-provider cost responsibility · billing/operational owner · pricing model + dated official source · cost driver · rate limits · renewal/deprecation · data/privacy/retention · money-movement + M1 dependency · receipt/reconciliation/Rail/pause-revoke, with a derived 4-section `expense-and-operations-report.md` and the **"M1" disambiguation** (`cost_tracks`: internal LLM-cost metering vs M1 real-money spend control — spend-capable providers always the real-money track). Cardinal rule: listed ≠ connected/available/autonomous. Marketplace entries = global metadata only. CI-enforced (`lint:integration-registry`). Distinct from `config-registry.md` (wiring names/IDs), `provider-result-contract.md` (runtime per-tenant state), and the Spine/`tenant_mcp_connections` code registries (§18) | **MANDATORY before proposing/implementing/opening a PR for/changing ANY provider integration; update the entry (incl. its expense_and_operations block) before merge (delivery rule)** |
| `docs/binding-ledger/README.md` + `surface-binding-ledger.json` | **The Surface Binding Ledger (Paige OS Integration Phase 0)** — the single machine-readable + human-readable ledger of how every Solo surface binds to Paige across the full chain (source → tenant scope → safe context → authority → governed write → verified outcome → Rail → Mind → Memory), with TWO dimensions per surface — `state` (proven today, six-state vocab) AND `intended_capability` (the operating TARGET across five authority lanes read/draft/auto/confirm/prohibited + a real-action `completion_criterion`, §16/§67) so absent proof never shrinks the target — and a CI-enforced release contract (`lint:binding-ledger`): no surface is LIVE without authenticated runtime proof, and every surface must declare its intended capability. The unifying index that CITES the Mind matrix / Spine-Rail state / surface cards, never forks them | Before claiming any surface is "Paige-connected"; before sequencing any Spine/Rail/Mind/Memory/Chat/surface binding |
| `docs/architecture/paige-mind-integration-matrix.md` | **Every Solo surface, and whether it can safely give PAIGE evidence** — two separate axes so a `PARTIAL` can never be read as a working capability: readiness under the shipped contract, and whether authenticated tenant-safe evidence actually flows today (it does not, anywhere). Carries the four structural constraints, the per-surface forbidden fields, and why the Rail — 9 rows platform-wide, readable only through a `SECURITY DEFINER` lens — gates the whole programme | Before proposing, sequencing or building ANY Mind capability · when asked "can PAIGE know X?" |

## Strategy · Audits · Assessments index

| Path | One-line | When to read |
|---|---|---|
| `docs/strategy/owner-trilogy-2026-07-26.md` | The Owner Trilogy — AI COO for coach/consultant/agency | Owner-trilogy positioning |
| `docs/strategy/twin-capabilities-landscape-2026-07-26.md` | Twin-capabilities landscape research | Digital-twin capability scoping |
| `docs/strategy/systems-check-and-analytics-landscape-2026-07-26.md` | Systems-check + owner analytics + competitive intel | Analytics/competitive-intel work |
| `docs/strategy/business-vault-partner-landscape-2026-07-26.md` | Business Vault partner + regulatory landscape | Business-vault/partner scoping |
| `docs/strategy/agency-surface-competitive-research-2026-07-25.md` | Agency surface competitive research + proposal | Agency-surface features |
| `docs/strategy/marketplace-competitive-landscape-2026-07-22.md` | Marketplace competitive landscape | Marketplace positioning |
| `docs/strategy/monetization-rollout-2026-07-21.md` | Monetization rollout strategy | Monetization sequencing |
| `docs/strategy/client-experience-workstream-2026-07-21.md` | Tenant Client Portal MVP vertical plus separately gated later client-experience expansion (§7/§8) | Client-portal experience work, after the Master Harness decision and locked portal matrix |
| `docs/audits/paige-secure-browser-audit-2026-09-06.md` | Paige Secure Browser / Twin Phase-0 audit — current-state matrix (research LIVE/PARTIAL, credentialed modes UNAVAILABLE, no browser provider wired), collision packet vs the owner-locked five-slice plan, provider evaluation (the two distinct "Twin" vendors twin.so vs twin-browser.com disambiguated with dated sources; Browserbase/Anchor/Steel evidence), three-mode security architecture, Phase 0–4 roadmap; **owner-ruled 2026-09-07** — owner-direct-login + provider-held-persistent-session custody (opaque reference only), Browserbase adopted as PROPOSED Phase-1 candidate pending review | Any Secure Browser / Twin / connected-account-via-browser / owner-assisted-login / bounded-crawl work; "do we have a browser capability?" |
| `docs/audits/money-spine-lane-b-i-discovery-2026-07-25.md` | Money Spine Lane B-i revenue-plumbing discovery | Money-spine build |
| `docs/audits/b-iv-38-connect-posture-2026-07-26.md` | B-iv §38 Connect-posture diagnostic (spike, no code) | Stripe Connect posture (§38) |
| `docs/audits/phase2b-privileged-function-audit-2026-07-25.md` | Privileged edge-function posture audit | Edge-function security posture |
| `docs/audits/phase2d-undeployed-function-disposition-2026-07-25.md` | Undeployed edge-function disposition | Dead/undeployed function cleanup |
| `docs/audits/people-model-strategy-2026-07-21.md` | People-model strategy draft | Team/People-department model |
| `docs/audits/platform-ia-slice-1c-handoff.md` | Slice 1c IA restructure handoff (revised final) | IA-restructure context |
| `docs/audits/pr-304-tenant-domain-doctrine-verification-2026-07-30.md` | PR #304 tenant-domain doctrine verification | Tenant-domain doctrine history |
| `docs/assessments/CONSOLIDATED_PLATFORM_AUDIT.md` | **Canonical current-main Platform Health & Security reconciliation** — exact-SHA health matrix and finding register first; proposed/local remediation and historical audits kept explicitly separate | Before asserting platform health, reopening an old security finding, or planning shared-platform remediation |
| `docs/assessments/DRIFT_AUDIT_2026-07-14.md` | Live-vs-repo drift audit (2026-07-14) | Drift history |
| `docs/assessments/IA-SLICE-1C-BLUEPRINT.md` | Locked target-IA blueprint (Slice 1c) | IA target state |
| `docs/portfolio/PORTFOLIO_SCOPE_BRIEFING.md` | Portfolio scope briefing (authoritative) | Portfolio-context scoping (§35) |

## Product specs index (docs/product/*)

| Path | One-line | When to read |
|---|---|---|
| `docs/product/BRD-MVP-2026-08-08.md` | Business Requirements Doc — MVP (newest) | Scope/requirements source of truth |
| `docs/product/agent-ui-placement-spec.md` | LOCKED — Paige agent UI placement (right-rail + ⌘K) | Agent-UI surface work |
| `docs/product/customer-portal-owner-trilogy-taxonomy-matrix.md` | LOCKED — customer-portal owner-trilogy taxonomy | Portal taxonomy |
| `docs/product/interactive-analytics-ui-spec.md` | LOCKED — interactive analytics UI | Analytics UI build |
| `docs/product/paige-multichannel-comms-and-deliverable-workflow-spec.md` | LOCKED — multi-channel comms + deliverable workflow | Comms/deliverable build |
| `docs/product/promo-account-type-spec.md` | LOCKED — promotional account type | Promo-account work |
| `docs/product/systems-check-operating-readiness-spec.md` | Systems Check as an operating-readiness console — the CLOSED eight-word status vocabulary, why the finding store cannot express two of them, the `suspended` vocabulary hole, the grounded Refresh contract, and 101 signals grounded against live production | Any Systems Check work; before adding ANY status word; before touching `systems_check_snapshot` |
| `docs/product/provider-result-contract.md` | The shape + rules a provider workstream publishes into Systems Check (A2P, Zapier/n8n, email domain) — and the rule that stops "not started" being reported as "waiting on a provider" | Owning any provider seam that Systems Check reports on |

## Design references index (docs/design-references/*) — §25 visual source of truth

| Path | One-line | When to read |
|---|---|---|
| `docs/design-references/README.md` | The source-of-visual-truth overview | Any design/taste pass |
| `docs/design-references/CHEESY-TELLS.md` | Enumerated anti-pattern catalog (binds the critic, §25/§33) | Every design-critic pass |
| `docs/design-references/CSS-EFFECTS.md` | Premium CSS techniques catalog | Building premium effects |
| `docs/design-references/DESIGN-CRITIC-PROMPT.md` | Design-critic operating brief (SHIP/ITERATE/BLOCK) | Running the design critic |
| `docs/design-references/OPERATOR-COMMAND-CENTER-IA.md` | Operator Command Center surface hierarchy | Command-center IA |
| `docs/design-references/STUDIO-VISUAL-QA-HANDOFF.md` | Studio visual-QA handoff (Chrome MCP) | Studio visual QA |
| `docs/design-references/gallery/{attio,cal-com,framer-marketing,linear,notion,retool,stripe-dashboard,superhuman,vercel-dashboard}/{README,SCREENSHOTS}.md` | Per-reference taste annotations + screenshot capture lists | Comparing a surface to best-in-class |
| `docs/design-references/prototypes/solo-business-game-plan-strategy-desk.html` (+ `…-GATE1.md`) | Gate 1 prototype — reimagines the Solo Business Game Plan as the owner's strategy desk (Systems Check demoted to a supporting dependency; horizon navigator; Plan-with-Paige propose→approve loop; owner+Paige-editable areas). **Owner-approved 2026-09-06 → Slice A SHIPPED** (production `SoloGamePlanWorkspace`/`useSoloGamePlan` replaced in place; editable Plan Brief persists via the setup-brief seam; PR #988; §32.c owner live-drive owed — see `decision-log.md`). Prototype kept as the design reference | Reference for the shipped strategy desk; deferred net-new stores (strategic-plan/pillars/Mission System) |

## Comms index (docs/comms/*)

| Path | One-line | When to read |
|---|---|---|
| `docs/comms/SEND-MESSAGE-CONTRACT.md` | LOCKED `send-message` contract (C-2 + C-1.5 seam) | Touching `send-message` edge fn |
| `docs/comms/C2-SURFACE-BUILD-PLAN.md` | LOCKED Comms C-2 surface build plan | Building the C-2 comms surface |
| `docs/comms/C2-SURFACE-DECISIONS.md` | LOCKED Comms C-2 owner decisions | Same |

## Studio index (docs/studio/* + Studio state docs)

| Path | One-line | When to read |
|---|---|---|
| `docs/studio/CREATIVE-ENGINE-SPEC.md` | Owner creative-engine spec (verbatim) | Vibe Studio creative-engine work |
| `docs/studio/UPGRADE-U3-session-memory-spec.md` | Studio U3 session-memory spec (not yet built) | Studio session-memory |
| `docs/PAIGE-CREATIVE-MEMORY.md` | Studio creative-memory overview (§26) | Prompt-forge / creative memory |
| `docs/PAIGE-STUDIO-PAUSE-STATE-2026-07-19.md` | Studio pause-state snapshot | Resuming Studio work |
| `docs/VIBE-STUDIO-HANDOFF-2026-07-14.md` | Studio handoff state (2026-07-14) | Studio history |

## Grounding reports index (§34 phase-0 groundings + intelligence)

| Path | One-line | When to read |
|---|---|---|
| `docs/PAIGE-INTELLIGENCE-GROUNDING-REPORT.md` | §34 intelligence-infra grounding (7 departments + build state) | Any §34 intelligence-layer PR (cite it) |
| `docs/L4-REASONING-GROUNDING.md` | §34 L4 reasoning department grounding | Reasoning-engine work |
| `docs/L7-SLICE-1-GROUNDING.md` | L7 God-view intelligence dashboard grounding | L7 dashboard work |
| `docs/RESEARCH-VERIFIER-FDIC-NCUA-GROUNDING.md` | Research-verifier + FDIC/NCUA skills grounding | Research-verifier / lender-data skills |
| `docs/PAIGE-CALLABLE-SEAMS.md` | Inventory of Paige-callable seams (§10) | "Is this Paige-governable?" checks |
| `docs/PLATFORM-FUNCTION-INVENTORY-2026-07-19.md` | Platform function inventory — built / bar / next | Broad "what's built" reference |

## Ops & handoffs index

| Path | One-line | When to read |
|---|---|---|
| `docs/OPS.md` | Pipeline & CI runbook (automations, `/edge-drift`, deploy) | Any ops/deploy question (§24) |
| `docs/DONE.md` | Completed-task archive (§24 hygiene) | History of shipped tasks |
| `docs/doc-render-decision.md` | HTML→PDF rendering microservice decision (Lane C) | PDF/rendering pipeline |
| `docs/handoffs/money-spine-lane-b-handoff-2026-07-25.md` | Money Spine Lane B handoff | Money-spine continuation |
| `docs/delivery/paige-secure-browser-mvp-plan.md` | **Paige Secure Browser owner-complete MVP plan** — a PAIGE-OWNED capability (UI/policy/control-plane/tenant-isolation/Vault Connected Accounts/receipts/skills); layered architecture with Browserbase as a REPLACEABLE bootstrap worker behind a provider-neutral internal contract; phases 0–4; extends the five-slice plan (§18) | Any Secure Browser build/design/phasing work |
| `docs/handoff/paige-secure-browser-build-handoff.md` | **The EXACT Secure Browser builder handoff** — leads with the owner-complete in-chat UI flow (open → take control → sign-in+MFA → observe → approve/stop → results+receipt → close/connect → Vault manage/revoke), then the required backend (provider-neutral internal contract, control plane, Vault Connected Accounts schema+RLS, §10/§68 governance, security prerequisites); §00 visual design = Claude Design | Before building any Secure Browser slice |
| `docs/audits/paige-secure-browser-provider-review-browserbase-2026-09-07.md` | **Browserbase worker-provider review + go/no-go** — read-only desk review of public materials (no account/login/API/session/crawl; the `BROWSERBASE_API_KEY` value never touched). Verdict **CONDITIONAL GO**: strong technical/contract fit (every internal contract op maps to a documented primitive; Contexts custody = "no raw credentials submitted"), credentialed wiring gated on **seven owner-side vendor gates** (SOC 2 Type II report/BAA/DPA/subprocessors under NDA; spend bounding — vendor says "No caps. No cut-offs"; Live-View debug-URL security; Context authorization/no-replay; US region pin per-session; Zero-Data-Retention per-session flag; deletion SLA). 8-dimension findings (KNOWN/UNCONFIRMED) + contract-fit table (drive REST, not the thin MCP) | Before adopting/wiring Browserbase as the Secure Browser worker; "is Browserbase go/no-go?"; the seven gates the owner must clear |
| `docs/handoff/paige-secure-browser-builder-starting-packet.md` | **Dedicated-builder STARTING PACKET** — the kickoff brief: read order, the one order rule (build the owner-complete in-chat UI first, then control plane + worker behind it), CONDITIONAL GO, what MAY be built now (audit §4.3 security prerequisites; provider-neutral contract + control plane; read-only Phase-1 flow flagged OFF; the in-chat surface via CD/flow-prototype), what is GATED on the seven vendor confirmations, and the hard do-NOTs | When a dedicated Secure Browser builder session starts |
| `docs/delivery/solo-sales-usability-r1.md` | Solo Sales usability repair — commercial terms, working drawer exits/discard, canonical source returns, source privacy boundary and separate evidence ledger; implementation in PR #903 | Current Sales capability and proof status; PR #895 date fixes do not close UX or legal agreements. Read before Release 2 prototype work, which requires rendered owner approval |
| `docs/delivery/sales-agreements-source-contract.md` | **What `tenant_client_agreements` may and may not expose to Spine, Rail or Mind** — the column-by-column may-cross / may-never-cross classification, the "a count of one is an identity" rule, and the **three** authorization traps a resolver inherits (a denied read is byte-identical to an empty one — `200`/`[]`/no error; a **partial** read is byte-identical to a complete one, so a coach's row-filtered read yields a false *aggregate*, not a false zero; and the gate must be `is_tenant_admin` on the **resolved** tenant, never a tenant-agnostic global role, which both wrongly admits and wrongly refuses) | Before registering any Spine capability, Rail projection or Mind evidence over Solo Sales agreements — the placement decision itself is Spine item 4's (issue #890) |
| `docs/delivery/canonical-readiness-contract.md` | **The canonical readiness contract** — one meaning for "is this business fact on file", shared by every Spine reader that reports it: the eight-state vocabulary (including `legacy_sourced`/`legacy_brand`, the state whose absence made two readers contradict each other about two real workspaces), the fact shape `fact_key · state · source · as_of · reason · next_action · tenant_id`, the six never-infer rules, why `stale` is defined and deliberately never emitted, why the two readers keep DIFFERENT caller gates and derive from one unreachable internal resolver instead of calling each other, the third A2P reader left divergent on purpose, and the measured before/after across all 14 production tenants | Before changing `get_business_context_readiness`, `tenant_comms_readiness`, `business_identity_readiness`, any Systems Check business-context runner, or any surface that renders whether a business fact is on file |
| `docs/delivery/paige-spine-mind-handoff.md` | First PAIGE Mind slice: the Pipeline evidence projection, the approved citation SCR, the client-scope seam, proof by class, and the collision-safe Second Brain blocks owed while PR #729 holds `decision-log.md` and `lessons-learned.md` | Any Mind, Spine, Pipeline-evidence or PAIGE-client-scope work |
| `docs/delivery/parked-follow-ups-2026-09-02-mind-slice.md` | Three verified defects parked during the Mind slice: a Rail feed reading a table the browser cannot select from, an undefined extraction function swallowed by a catch, and a possibly-unlistened `paige:open` dispatch | Picking up Rail, Chat-runtime or `paige:open` work — check here before re-diagnosing |
| `docs/delivery/billing-foundation-c-design.md` | Billing Foundation C — the Solo Billing screen: the presentation contract (which states are reachable from which records), why the plan catalogue is not an input, what is genuinely interactive, and the evidence classes | Any change to Solo Settings › Billing, or any work that wants to render a plan, price, renewal, trial or promotional state |
| `docs/delivery/billing-foundation-a-design.md` | Billing Foundation A design + security packet (v3.1): workspace billing identity, Owner-only authority, primary billing contact / billing delegate designations (functional, never ownership), the notification ledger with no sender, proofs, residuals, rollback | Any platform-billing, Stripe-customer, billing-notice or billing-contact work — read before touching `customer-portal`, `stripe-webhook`, or the Solo Billing view |
| `docs/handoff/platform-billing-spine-source-contract.md` | SHIPPED source contract for Spine readers (PR #816, `f455d8a5`): the safe billing-status fields, the notice event vocabulary, what never leaves Billing, and unavailable behaviour while no sender exists | Any Spine/Rail work that wants to show billing state or billing activity |
| `docs/delivery/platform-billing-gate1-packet.md` | **Platform Billing Gate 1 packet (Phase 1, read-only, nothing built)** — the Platform-vs-Client billing boundary, the audit of what exists (A1 email-keyed portal · A2 ungated paid install · A3 undiscriminated invoice webhook arms · A4 sub-account misreport · A5 finance unit in the default plan JSON), the eight beta decisions D1–D8 as ruled/deferred at Gate 1 (§4.2), the three beta access offers and the entitlement model (§4.3), the Promotional Beta Access policy (§4.4), the five-step MVP sequence, the eight-field meter contract | Any Settings → Billing, plan, price, allowance, add-on, meter, or Stripe-platform work — read BEFORE touching a Stripe object |
| `docs/delivery/agent-control-capability-map.md` | **Agent-control capability map — PROPOSED / NOT BUILT (owner-accepted 2026-09-13)** — the read-only seam map for a future owner-facing agent-control monitor: the Layer-C approve→resume→readback fabric as the canonical seam to REUSE, the real state vocabulary, and the per-control verdict (status-list PARTIAL, resume/readback REUSE NATIVE-only, cancel/retry PARTIAL, **pause UNAVAILABLE**), the autonomy/approval lanes, and the **#1234 collision gate** (build waits for CRM/Pipeline to merge + re-ground on fresh main) | Any agent-control / monitor / pause-retry-cancel / act-status work — read BEFORE grounding or building it, and do NOT build until #1234 merges |
| `docs/handoff/platform-billing-marketplace-addon-handoff.md` | Marketplace paid add-ons as a Platform Billing consumer: the 5-step order (operator defines → workspace sees price → authorized decision → verified payment → entitlement from that state), finding A2, the proposed item contract, the nine add-on states | Any Marketplace purchase/entitlement work |
| `docs/prototypes/platform-billing-gate1.html` | Throwaway Gate 1 prototype — 34 billing states, boundary diagram, operator config flow; no network beyond fonts, no mutation | Gate 1 review of Billing only; delete or absorb after approval |
| `docs/tenants/mma/tenant-kb-marketing-copy.md` | MMA tenant marketing/positioning KB (tenant-scoped) | MMA-tenant copy (never a platform default, §9) |
| `docs/PULL_REQUEST_TEMPLATE.md` / `docs/PULL_REQUEST_TEMPLATE.md` | PR template | Opening a PR |

---

*Index generated 2026-08-09 from a full uncapped `find docs -name '*.md'` — **121 files, all indexed,
zero gaps** (completeness-audited this pass) — plus a codebase feature inventory (`codebase-map.md`) and
live MCP/Stripe/git recon. If you add or move a doc/route/edge-fn, add its row here (or in
`codebase-map.md`) in the same commit (§BRAIN.3).*

Sales usability is **PARTIAL**, with R1 implementation in PR #903 and authenticated production proof owed; see `docs/delivery/solo-sales-usability-r1.md`. Legal documents, signatures and sends remain outside this commercial-terms record and require the Release 2 rendered-prototype approval.

Sales schedule detail (PR #895; dates only, not Sales UX closure): `docs/delivery/solo-sales-agreement-schedule.md` records renewal visibility, calendar-date handling, acceptance and proof owed. The Sales-to-Spine disclosure boundary remains `docs/delivery/sales-agreements-source-contract.md`; this change registers no capability.


### Solo Sales workbench (2026-09-03)

Current implementation: commercial terms first, a five-row canonical offer finder with server name search/paging and exact selected-offer references, compact payment handling and expandable source-backed form/payment activity. Terms search/status filters explicitly cover the latest 200 loaded records; client identity remains the existing bounded directory, not all-history search. Catalog baseline prices, writes, six Campaigns tabs and Pipeline stay unchanged. No documents/signatures/payment collection added.

Owner superseded competing Sales PR #905; its separate Clients fix remains with that owner. R1 #903 is merged at `c198d8ae` and its production revision was verified; the older pending-release wording describes the pre-release ledger. Workbench release checks and exact deployment evidence: [Sales workbench](../delivery/solo-sales-workbench.md). Local Chromium covers all four widths/both themes and simulated 1/80/80000 offers; authenticated persistence and production large-catalog performance remain **Proof Owed**. Broader Sales remains **PARTIAL**.


## 2026-09-06 current Business Game Plan delivery frame

The Business Mission canonical-write/readback/Rail foundation remains `LIVE`. PR #1038 released the owner-complete `Command Center -> Business Game Plan` vertical: the existing Plan Brief supplies direction and canonical Mission records appear as owner-facing Strategic Plays, with no Mission sub-tab and no parallel store or approval system. The web, migration, and affected Edge graph are production-deployed at feature merge `cc1e86f5`; because the signed-in owner flow has not yet been browser-proven, the surface and Solo Tenant Brain remain `PARTIAL`. Authenticated owner, denied-role, workspace-switch, canonical Mission and matching Rail browser proof remain `PROOF OWED`; Mission Mind and durable Memory remain `UNAVAILABLE`.

### 2026-09-07 Tenant Brain index addition

`solo-tenant-brain.md` now also owns the Verified Campaign Brief with Paige lane: exact canonical id/version/lifecycle/field readback before successful Rail evidence, with Campaign Brief Mind and durable Memory unavailable.

PR #1047 released that backend lane as referenced production merge `ae0a16a0`: persisted migration and affected Edge deployment are proven, both live tags match, and both production version endpoints report the merge build. The backend verified-create/revise plus Rail contract is `LIVE`; the owner-visible lane stays `PARTIAL`, authenticated browser proof stays `PROOF OWED`, and Campaign Brief Mind/Memory stay `UNAVAILABLE`.

### 2026-09-12 Harness Layer G — proof-lane framework

The authenticated-proof framework: **`scripts/live-drive/PROOF-LANE.md`** (the framework + proof-status vocabulary + the one owner action) and **`docs/evidence/proof-lane/README.md`** (the committed verified-vs-`PROOF_OWED` evidence record). It extends `scripts/live-drive/live-drive.mjs` (no fork) and turns an authenticated governed flow into data + a runner that reports `VERIFIED` only when a real drive asserts, `PROOF_OWED` otherwise. PR #1163. All 7 governed flows (contact-create, tenant isolation, capability truth, approval, readback, retry, account-switch) are `PROOF_OWED` until a capable session has the least-privilege Solo test tenant + `LIVE_DRIVE_*` CI secrets. Proof-lane's runtime verdict vocabulary maps to the binding-ledger release-accounting states (a proof-lane `VERIFIED` = the `authenticated_runtime` evidence that moves a ledger row `PROOF_OWED → LIVE`; see `PROOF-LANE.md`).

### 2026-09-12 current-main Platform Health & Security reconciliation

`docs/assessments/CONSOLIDATED_PLATFORM_AUDIT.md` is the one current-health record. Its pinned snapshot is merged `main` `9cac02d66ab068a7cff6a032bca267c9a928a3c6`, audited at `2026-09-12T20:23:44.2006964-04:00`. It incorporates merged #1175's Capability Portfolio routing and the later fal result-readback fix while separating verified source health from production/authenticated proof debt and non-shipped remediation. The high-risk rules are: public identity changes require signed purpose-bound authority; service-role code resolves scope server-side; URL ingestion uses canonical `safeFetch`; views preserve tenant RLS deliberately; consequential automation resolves live authority; unknown spend authority follows explicit fail-closed policy; and capability-live claims require execution, readback, receipt/Rail and authenticated proof.

### 2026-09-13 — Solo Beta acquisition and live billing binding

| Record | Owns | Read before |
|---|---|---|
| `docs/evidence/ui-delivery/solo-beta-acquisition.md` | The shipped Solo-only public journey plus live server-owned Stripe offer binding, verified/fenced fulfillment, current Solo handoff, production readback, and separated proof boundaries | Any public CTA/pricing/signup/auth callback/onboarding/checkout/webhook/enrollment-status or new-Solo destination change |

Production binding shipped in PR #1200 (`4ccb8a9a`): live Product/Price, migration, Edge, webhook, Vercel, fail-closed probes, and signed-out public rendering are verified. First authorized customer Checkout/fulfillment/current-shell and lifecycle proof plus live Billing Portal configuration remain `PROOF OWED`; capability stays `PARTIAL`. PR #899 ordering and PR #724 destination remain carried forward; existing authorized non-Solo access is not re-enrolled.
