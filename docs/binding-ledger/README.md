# Surface Binding Ledger — the Paige OS Integration release/regression contract

**Read this before claiming any surface is "Paige-connected," and before designing, sequencing, or
building any Spine / Rail / Mind / Memory / Chat / surface binding.**

Grounded 2026-09-06 against `origin/main` `0b48f26df84e84c781c427f46e06023a6371f366`.

## What this is

The **single, machine-readable + human-readable ledger** of how every meaningful Solo surface binds
to Paige, across one governed chain:

```
canonical source → server-resolved tenant scope → safe Paige-readable context → authority
  → governed write/action → verified outcome → Rail evidence → Mind eligibility → Memory retention
```

The authoritative machine-readable form is **`surface-binding-ledger.json`** (this directory). This
README is its human-readable companion: the vocabulary, the release rule, the honest platform
position, and a compact per-surface summary. **The JSON is the source of truth for full per-field
detail** (safe facts, prohibited fields, per-link status, linked PRs/issues, next slice, grounding
sources). **CI (`lint:binding-ledger`) validates the JSON only** — it enforces the JSON's structural
completeness and honesty invariants; it does not parse this README, so the summary table below is a
hand-maintained companion that must be updated alongside the JSON (§BRAIN.3).

## What this is NOT

- **Not a fork of existing docs.** It is the *unifying index*. Each row cites its grounding source:
  `docs/architecture/paige-mind-integration-matrix.md` (the Mind axis + safe/forbidden facts),
  `docs/brain/paige-spine-and-rail-state.md` (Spine/Rail state), the Spine registry
  (`supabase/functions/_shared/paige-spine/`), `docs/doctrine/canonical-solo-parity-matrix.md`
  (routing/parity), and the per-department `docs/doctrine/surface-cards/`. When those change, the
  ledger row is updated in the same commit (§BRAIN.3) — it never restates them from memory.
- **Not authorization.** A row is an observation about the contract, never permission to build.
  Implementation is assigned by the owner.
- **Not a design record.** Per §00, this ledger records what *works* / is *wired*; it holds zero
  opinion about how any surface looks. The retired orbital PaigeMark → current Command Mark is a
  design decision owned by Claude Design and is deliberately absent here.

## The six states (never let a UI, a badge, a prototype, or an "Open Paige" button masquerade as a binding)

| State | Meaning |
|---|---|
| `LIVE` | the full intended binding is real **and proven by authenticated end-to-end runtime** |
| `PARTIAL` | some binding links are real; the exact remaining gaps are named |
| `READ_ONLY_CONTEXT` | Paige can safely understand this surface but cannot act on it |
| `INTENTIONALLY_ISOLATED` | sensitive data on this surface must not enter Paige/Mind/Memory |
| `UNAVAILABLE` | the required Paige-binding contract does not exist yet |
| `PROOF_OWED` | the binding is implemented and reachable in code, but authenticated/runtime proof is absent |

## Two dimensions per surface — proven-today vs the operating target (owner ruling, 2026-09-06)

Every surface carries **two independent answers**, and the second must never be shrunk by the first:

1. **`state` — what is PROVEN today.** The six-state vocabulary above. Strictly truthful about current
   proof; the CI guard forbids overclaiming it.
2. **`intended_capability` — the product operating TARGET.** Paige is built to help *run the company
   through real governed actions*, not to report passively. So each surface also declares, across the
   five **authority lanes** (mapped to §16 🟢 auto / 🟡 confirm / 🔴 off and §67 per-process grants):

   | Lane | What it declares |
   |---|---|
   | `read` | what Paige may safely read and understand (enumerated safe facts; never raw payload/secrets) |
   | `draft` | what she may draft, model, organize, prepare, or recommend — a proposal with **no side effect** |
   | `auto` | what she may **execute autonomously** within a tenant-approved policy (🟢) |
   | `confirm` | what requires **owner confirmation** before execution (🟡, via `paige_pending_confirmations`) |
   | `prohibited` | what is **permanently isolated/prohibited** — raw secrets, credentials, unreviewed files, authority escalation (🔴) |
   | `completion_criterion` | the **real action/outcome** that proves the surface is done — never merely "open" or "summarize" it |

   **An absent current proof (`state`) never erases the intended target (`intended_capability`).** The
   ledger describes the *gap* between present proof and the full operating goal — it does not narrow the
   goal to what happens to be built today.

### Standing delegated authority — `auto` is not `None` for consequential work (owner ruling, 2026-09-06)

Paige is a real operating agent. With owner or authorized-representative authority she may execute
**consequential** actions — payments, purchases, ad-spend, bookkeeping, defined team-role changes,
client operations, and connected-tool work — **autonomously within a bounded standing policy** (scope,
caps, time window, provider authority, stop conditions, audit), not by confirming every act. `confirm`
is the **escalation lane** for actions above the granted threshold, never a blanket ban. A surface whose
`auto` lane covers such work carries `"consequential": true`, and its `auto` must declare that
scoped-autonomy target — a bare `auto: "None"` is a regression the guard rejects.

`prohibited` is fenced to only the genuinely non-delegable: §38 merchant-of-record / holding tenant
funds / routing tenant→client money through the platform (connected-provider payments run on the
**tenant's own** rails); §53 platform-tier escalation; and actions blocked by law, provider, or an
explicit owner prohibition. The full contract is `docs/doctrine/autonomy-architecture.md` §10 (§67.2).
**Honest note (§13/§32):** high-impact acts still clamp `auto`→`confirm` at runtime today. The
standing-policy substrate (RE-1 — `paige_automations` + `resolve_automation_autonomy`) is **live and
wired into `paige-ai-chat`**; what is not built is **RE-2** — lifting the consequential-act *floor*
under a valid standing policy (the floor is `confirm` by the `paige_action_kinds` CHECK +
`resolve_tool_autonomy`, so no grant currently lifts a `high` act). Until RE-2 ships, consequential
surfaces keep their current `state` while `intended_capability` declares the target.

## The release/regression contract (CI-enforced)

> A surface may not be reported `LIVE` / "Paige-connected" without a **complete** ledger entry whose
> state is `LIVE` **and** whose `evidence_class` includes `authenticated_runtime`.

`scripts/ci/binding-ledger-lint.mjs` (`npm run lint:binding-ledger`) fails CI when:
- a surface claims `LIVE` without `authenticated_runtime` evidence, or with a `none` canonical source / safe context;
- a surface claims `PROOF_OWED` while also claiming `authenticated_runtime` (that would be `LIVE`);
- `INTENTIONALLY_ISOLATED` carries no `isolation_note`;
- any entry is structurally incomplete (missing chain link, empty `sources`, unknown state/evidence class, duplicate id);
- a surface omits `intended_capability` or any of its five authority lanes + `completion_criterion` (the target must be declared, not dropped);
- a `completion_criterion` names no real action/outcome — i.e. it reads as merely "open" or "summarize" the surface;
- a `"consequential": true` surface regresses its `auto` lane to a bare "None" instead of declaring scoped autonomy ("within policy" + caps/scope) or a genuine hard fence (§38/§53/law/provider) — standing delegated authority, owner 2026-09-06.

This is the mechanical form of §13 (honest reporting) + §32 (a green build is not a working render),
applied to the binding chain. A ledger a session can quietly edit to say "LIVE" without proof is worse
than none.

## Honest platform position (grounding SHA)

**No surface is `LIVE`.** Mind axis-B — authenticated, tenant-safe evidence flowing for a real owner —
is `NO` for every surface (per the Mind integration matrix). Concretely:

- **`PROOF_OWED`** (safe read-context implemented + chat-injected + unit-tested; authenticated runtime
  proof absent): `campaigns.pipeline` · `campaigns.social` · `settings.setup` · `settings.team`.
- **`PARTIAL`** (some links real, gaps named): `command-center.business-game-plan` (the Business
  Mission governed write — create/revise/transition — is wired + chat-bound via #983; canonical
  readback now gates a capability-run Rail write, while auth-runtime remains owed and the composite-plan
  Mind lens still needs #647) · `command-center.trust-compass`
  (authority governed server-side; the visible dial is a non-authoritative fixture) ·
  `settings.integrations` (n8n writes wired to the Rail capability-run write; zero rows in prod) ·
  `settings.billing` (safe status source contract shipped, not injected; secrets isolated) ·
  `clients.portal` (real external-client gateway/linkage/shell/action substrate; complete
  client-scoped shared records, authority, revoke/switch, verification and runtime proof remain) ·
  `paige.workspace` (handoff carries client scope but drops the intended prompt, #771, and still
  accepts raw prose).
- **`INTENTIONALLY_ISOLATED`**: `settings.vault` · `settings.security-data`.
- **`UNAVAILABLE`** (contract not built, sourceless, or awaiting a Spine Change Request): the rest —
  Command Center (Systems Check / Mind tab), Clients People/Conversations/Calendar, Catalog, Sales, Overview,
  Performance, Analytics, Marketplace, Connections, Vibe Studio, and the intentionally-separate
  Operator console.

`paige.workspace` is recorded `PARTIAL`, not PROOF_OWED — the workspace is the *consumer* of bindings;
its own gap is the handoff seam Phase 1 addresses.

The Self-Knowledge & Migration Advisor is an intended read-only consumer of `paige.workspace`, not a
new surface or binding row. Its end-to-end runtime is `UNAVAILABLE`: current binding facts remain
distributed and do not yet form a server-owned tenant capability manifest or migration plan. A later
implementation updates `paige.workspace` in place only when actual context, read, draft, confirm,
verification, receipt, or Rail behavior changes and is proven. Architecture approval alone does not
change the JSON state. Comparison or migration advice must cite binding state without treating a
surface as connected, authorized, proven, or released.

## Per-surface summary

The **Completion target** column is the surface's intended `completion_criterion` — the real governed
action + verified outcome + Rail evidence that marks it done (the JSON is the source of truth). It is a
separate dimension from **State** (what is *proven today*): an `UNAVAILABLE`/`PROOF_OWED` state never
shrinks the target — it names the gap between present proof and the full operating aim (owner ruling).

| Surface | State | Completion target (real action) | Why / gap | Next slice |
|---|---|---|---|---|
| Paige workspace | `PARTIAL` | Paige acts on a surface's real record via a governed tool, outcome recorded | sole chat surface, server-safe scope; no surface identity, prompt dropped (#771), raw `clientContext` prose | Phase 1: adopt the Surface Context Handoff Contract |
| Command Center → Business Game Plan | `PARTIAL` | Owner manages Strategic Plays and Paige acts through canonical readback + Rail | #1016 Mission/Rail backend is LIVE; #1038 deployed Mission-backed cards, lifecycle drawer actions, safe selected-plan Paige handoff, and verified readback ordering. Production web/migration/Edge markers are confirmed; authenticated runtime remains unproven, and Mind/Memory remain unavailable | Drive the production signed-in owner flow, workspace switch, denied role, canonical revision, and matching Rail row |
| Command Center → Systems Check | `UNAVAILABLE` | A failing check drives a real Paige remediation the next scan verifies | safe lens exists, unwired; needs SCR-2 + SCR-3 | Phase 4.4 read-only context |
| Command Center → Mind tab | `UNAVAILABLE` | Reviewed facts enter the governed Memory seam and Paige can recall them | a knowledge visualization, not the PAIGE Mind contract | none until #647 |
| Trust Compass | `PARTIAL` | The visible control performs the real governed autonomy change (or is plainly read-only) | authority governed server-side; visible dial is a non-authoritative fixture | Phase 4.3: reconcile dial to real governed action or mark read-only |
| Campaigns → Overview | `UNAVAILABLE` | Paige launches/adjusts a real campaign with a verified outcome | no tenant-authorized campaign source | none |
| Campaigns → Catalog | `UNAVAILABLE` | Paige publishes a working page/funnel/form and wires its capture, verified live | real source, no Paige lens; SCR-1/2 | reference `get_pipeline_routing_evidence` shape |
| Campaigns → Sales | `UNAVAILABLE` | A capture becomes a governed follow-up / recorded outcome, verified + Rail-logged | Rail producer dead (#787) | none until #787 decided |
| Campaigns → Pipeline | `PROOF_OWED` | Paige moves a governed deal, recorded, and cites her own move (#755) | the one Mind lens; authenticated drive never run + signal never produced | produce one real Rail row, then drive |
| Campaigns → Social | `PROOF_OWED` | Paige publishes real posts via a connected system with a verified outcome | `social.presence` read+write wired/tested; no auth drive (supersedes the pre-2026-09-05 matrix) | authenticated drive |
| Campaigns → Performance | `UNAVAILABLE` | Real metrics drive an owner-approved Paige action with a verified result | no metrics source; the model for how Mind should decline | none; point Mind away |
| Campaigns → Vibe Studio | `UNAVAILABLE` | A brief becomes a real critiqued creative asset the tenant can ship | creative overlay, not a data binding | out of scope (§26 creative memory) |
| Clients → People | `UNAVAILABLE` | Paige coordinates a governed follow-up whose outcome is recorded (owner UI edits also Rail-visible) | no Mind-safe lens; owner's own UI write emits no Rail (#757 "do not start") | resolve producer gap first |
| Clients → Conversations | `UNAVAILABLE` | Paige sends a governed reply, delivery verified + Rail-logged | message bodies forbidden to Mind | future transcript-evidence ingestion |
| Clients → Calendar | `UNAVAILABLE` | Paige books/reschedules a real meeting, truthful attribution, verified Rail outcome | FU-3 Rail contract absent; attribution untruthful (#786); six-PR collision | resolve #786 + FU-3 |
| Clients → Portal | `PARTIAL` | Tenant grants a client-scoped portal experience through the one Harness; meaningful actions verify and emit Rail | real external portal substrate; complete shared records, revoke/switch, approval and authenticated isolation proof remain | dedicated Client Portal MVP build, only after owner start |
| Settings → Setup | `PROOF_OWED` | Paige helps complete real business context, verified on save | `business_context.readiness` deployed + injected; owner UI-flow proof owed | Phase 4.4 authenticated proof |
| Settings → Team | `PROOF_OWED` | Paige executes a real team change (invite/role) on confirmation, verified | `team.authority` wired; PAIGE can act (capability PARTIAL); auth proof owed | Phase 5 |
| Settings → Connections | `UNAVAILABLE` | Paige completes a real provider/comms connection the next check verifies (never a secret) | safe subset unwired; credentials isolated; private finding #788 | Phase 5 |
| Settings → Integrations | `PARTIAL` | Paige activates a real n8n workflow; its capability_run Rail row renders | n8n readiness + 12 mgmt capabilities wired; zero capability_run rows in prod | authenticated drive → first Rail row |
| Settings → Vault | `INTENTIONALLY_ISOLATED` | Only OCR/DLP-inspected reviewed facts become eligible knowledge; raw docs never cross | Phase 2 owner/admin foundation + quarantined intake shipped (#986); raw docs/credentials never cross | Phase 7: OCR/DLP-inspected promotion of reviewed facts |
| Settings → Billing | `PARTIAL` | Paige drives a real billing action within the §38 boundary, on confirmation | safe status source contract shipped, not injected; secrets isolated | Phase 8 bind safe status only |
| Settings → Security & data | `INTENTIONALLY_ISOLATED` | Posture controls perform the real governed change (or are plainly read-only) | autonomy authority is non-Chat (§67/§68) | none as a write binding |
| Settings → Analytics (six views) | `UNAVAILABLE` | A real analytics finding drives an owner-approved action, verified | Shared issuer/resolver; 22 per-reading LIVE/PARTIAL/UNAVAILABLE keys, five unsupported producers; PAIGE binding not proven | #1837 Chat/Live governed read PROOF OWED; existing Mind restrictions retained |
| Marketplace | `UNAVAILABLE` | Paige installs a marketplace item whose entitlement is verified | the most blocked; SCR-1/2/3 | bind safe install-state only |
| Operator / Platform | `UNAVAILABLE` (out of Solo scope) | _Out of Solo scope_ — intentionally separate, tenant-less tree | intentionally separate tree, tenant-less | out of scope; no subaccount/operator work without release |

## How to keep it true (§BRAIN.3 / §66)

Any PR that ships a binding, changes a surface's source/scope/authority/outcome/Rail/Mind/Memory
posture, or lands an owner ruling **updates the relevant `surface-binding-ledger.json` row in the same
commit**, and re-runs `npm run lint:binding-ledger`. Record the honest state
(`LIVE`/`PARTIAL`/`READ_ONLY_CONTEXT`/`INTENTIONALLY_ISOLATED`/`UNAVAILABLE`/`PROOF_OWED`) — never
imply a capability is live because a UI or prototype exists — and the next owning workstream + the
dependency it must read first.

## Sequenced remainder (Phases 2–8 — bounded implementation slices, MVP cadence)

Phase 0 (this ledger) and Phase 1 (the handoff contract, `docs/doctrine/surface-context-handoff-contract.md`)
are published. The implementation of individual bindings continues as bounded slices, each of which
updates its ledger row on merge.

> **BUSINESS GAME PLAN + MISSIONS MVP (owner-approved 2026-09-06; authenticated proof owed).** It must
> demonstrate an **actual governed Paige action with a verified outcome and Rail evidence** — Paige
> creating / revising / sequencing / advancing a real Business Mission on this surface — **not merely a
> richer context handoff.** The governed write (`business_mission.create/.revise/.transition`, #983) is
> already wired and chat-bound. Current source now resolves the caller tenant and persisted-thread-selected Mission before reasoning,
> verifies the requested change through a fresh canonical read, and only then calls the existing
> capability-run Rail writer with a stable request id. This remains `PARTIAL`: authenticated deployed
> Mission and Rail proof is owed, standing-policy auto execution remains dark, and Mind/Memory are
> explicitly unavailable. This one lane never makes the Solo Tenant Brain complete.

- **Phase 2** — verified action outcome + Rail backbone (`governedExecution.ts` seam adoption beyond the
  MCP door; `record_capability_run` fed by real acts; owner-visible outcome reading, #746).
- **Phase 3** — Mind/Memory eligibility (the Memory seam shipped in Release C; the Spine SCRs — SCR-1
  workspace-outcome projection, SCR-2 non-client subject, SCR-3 record/list shape — remain unraised).
- **Phase 4** — Game Plan ↔ Missions; Pipeline governed action loop (#755); Trust Compass; Systems Check.
- **Phases 5–8** — Team/Connections; Campaigns subtabs; Mind/Vault; Billing/Analytics/Marketplace/Clients/Calendar/Portal.
