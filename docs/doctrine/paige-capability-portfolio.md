# Paige Capability Portfolio

**The one owner-vision portfolio artifact.** It holds the capability families and their intended
outcomes, and maps each family to its domain and shared Harness dependencies.

> **Every portfolio capability remains intended product direction; each becomes real only through the
> shared Harness path and its domain-specific completion proof.**

**The portfolio is BINDING product direction** (owner-approved, recorded 2026-09-12). Scope is not
optional. But scope is not availability: **this artifact claims no runtime availability for
anything.** It is deliberately **not** a second Binding Ledger, Integration Capability Registry,
Spine registry, or roadmap tracker — for current status and delivery proof it points at the records
that own those answers, and when this file and an owning record disagree, **the owning record wins
and this file is the bug.**

**"200" is never a score.** There is no "we are at N/200." The portfolio is intent; the canonical
records hold reality. Do not compute a delivery percentage or `LIVE`-coverage figure from it.

The binding rule is the Master Reference → **"Capability Portfolio — the One Paige Operating Platform
rule"**. The pre-edit gate that consumes this artifact is `../../AGENTS.md` → "Capability routing".

| The question | The record that OWNS the answer |
|---|---|
| Is this surface owner-visible, and how far? | `../binding-ledger/surface-binding-ledger.json` (+ `../binding-ledger/README.md`) |
| Is this provider connected / authorized / autonomous? | `../integration-registry/integration-capability-registry.json` |
| Is there a governed capability verb for this? | `supabase/functions/_shared/paige-spine/registry.ts` |
| Is the shared Harness layer this needs real yet? | `../delivery/harness-completion-map.md` (Layers A–G) |
| What actually shipped, and when? | `../PAIGE-MASTER-PROJECT-REFERENCE.md` §4.0 Shipped Delivery Log |
| Is this capability *done*? | `../brain/paige-brain-wiring-standard.md` §3 (the six-part ship-time checklist) |
| May this be announced to a customer? | `release-governance-and-customer-update-policy.md` |

---

## Part A — the portfolio: the capability families and their intended outcomes

**Binding product direction.** These families are what Paige is meant to become. Nothing here asserts
that any of it works today; intended outcomes are stated in the owner-approved language of each
surface's `intended_capability.completion_criterion` in the Binding Ledger, or of the Master
Reference where no ledger row exists. **Scope is binding. Availability is only ever what the owning
record proves** — Part B routes you to that record.

| # | Family | Intended outcome (product direction) | Domain | Shared Harness dependency |
|---|---|---|---|---|
| 1 | **Shared Harness / execution / proof** | One governed path every capability enters: identity and scope re-resolved, authority and budget applied, canonical write, verified readback, receipt + Rail, truthful explanation | Harness / CC | *is* the dependency (Layers A–G) |
| 2 | **Chat + Command Center** | The owner opens Paige from a surface and Paige **acts on that surface's real record** through a governed tool; the Command Center is where the owner discovers, directs, approves and understands the system | Chat / CC | A (kernel) · B (capability truth) · F (runtime evidence) |
| 3 | **Agents, skills, browser, sandbox, research** | Bounded specialists that are **members of one governed system** — dispatchable by a process, re-checking authority when they act, never a private agent with its own memory or tools | Harness (Layer D) | A (a specialist re-checks the kernel, §14) |
| 4 | **CRM · Sales · Clients · Campaigns** | Paige maintains a contact, coordinates a governed follow-up, moves a governed deal, and **can cite her own move** in her evidence — with the owner's own edits equally recorded | Solo CRM / Campaigns | A · C (events → acts) · Rail |
| 5 | **Calendar** | Paige **books or reschedules a real meeting** with truthful attribution and a verified Rail outcome — not merely reading bookings | Solo Clients | A · provider connection · approval |
| 6 | **Social** | Paige creates, schedules and (on approval or policy) **publishes real posts** through a connected system with a verified outcome | Social | A · C · provider auth · Rail |
| 7 | **Vibe / creative** | A brief becomes a **real, critiqued creative asset the tenant can ship** — the §19/§26/§33 creative loop, not a placeholder | Vibe | A · budget · approval · §33 critique gate |
| 8 | **Client Portal** | A tenant grants a real client **scoped** access; approved shared reads and permitted actions traverse the one governed path, failing closed where not permitted | Portal | A (re-resolved per client read) · Rail |
| 9 | **Vault** | Only OCR/DLP-inspected, reviewed facts become eligible knowledge Paige can use — **raw documents never cross** | Solo Settings | isolation is the contract |
| 10 | **Marketplace + integrations** | Paige recommends and, on confirmation, **installs** a marketplace item whose entitlement is verified; integrations build and activate real governed workflows | Marketplace / Integrations | A · B · tier eligibility · metering |
| 11 | **Billing + usage** | Paige surfaces true billing status and, on confirmation, drives a real billing action **within the §38 money boundary** | Billing | A · M1 metering · §38 |
| 12 | **Analytics + intelligence** | A real analytics finding drives a Paige-prepared, **owner-approved action** on the owning surface with a verified result | Analytics | A · C · canonical read adapters |
| 13 | **Communications** | Paige drafts and, on approval, **sends** a governed reply whose delivery is verified and Rail-logged — not a passive inbox | Comms | A · provider · approval · Rail (R8) |
| 14 | **Team / people** | Paige prepares and, on owner confirmation, **executes a real team change** (invite/role) with a verified outcome | Solo Settings | A · §51/§53 tier + operator seams |
| 15 | **Platform Operator · Agency · future scale** | Operator, agency and future-scale work runs through the same governed core, with the platform/tenant seam intact and God-tier remaining the source of truth (§57) | Platform Operator | A · §9/§53 seam · tier framework |

**The families are the portfolio's stable unit — not a count.** New capabilities join an existing
family, or a new family is added by owner ruling. A capability that appears to need its own Harness,
authority engine, registry, job system, memory or orchestrator is a **routing conversation, not a
build** (Master Reference, the prohibited list).

---

## The platform position you must not round up (§13)

*This section exists so no reader mistakes binding SCOPE for shipped AVAILABILITY.*

**Each source carries its OWN grounding SHA, and they are not the same day.** Read 2026-09-12, but:
the binding ledger is itself grounded at `ae0a16a0` / generated 2026-09-07 (file last touched
`69df6923`); the integration registry at `3bdd26c2` / 2026-09-08; the Harness Completion Map at
`b17599cd` / 2026-09-12. **Merges after those SHAs are not reflected in the labels below.** Always
re-read the owning record; never cite this file's label as current.

- **Zero of the 29 binding-ledger surfaces are `LIVE`.** The counts are **14 `UNAVAILABLE` · 8
  `PARTIAL` · 5 `PROOF_OWED` · 2 `INTENTIONALLY_ISOLATED`**. The ledger says it plainly:
  *"As of the grounding SHA, NO surface is LIVE."*
- **27 Spine capability keys** exist across **9 domains** — and **15 of the 27 are `integrations.*`**
  (12 of those are n8n workflow verbs). Breadth of the Spine is not breadth of the platform.
- **The act-execution engine does not exist.** Harness map §2: the governed *request* path is real;
  the governed *event→action* path is not. The dispatcher delivers events and writes
  `result.acts_executed:false`.

So the honest reading of every row below is **"this is where it goes," not "this works."** A family
with a rich record set can still be `UNAVAILABLE`.

---

## Part B — routing: where a family goes, and what proves it real

Truth labels are the owning record's own words. `—` means no record of that class exists yet, which
is itself the finding.

| # | Portfolio family | Status TODAY — a POINTER, not a claim (owning record) | Domain owner | Shared dependencies | Canonical records to update | Completion proof required |
|---|---|---|---|---|---|---|
| 1 | **Shared Harness / execution / proof** | **No ledger row.** Layers: A `PARTIAL (#1157)` · B `PARTIAL/ABSENT (#1157)` · C **`ABSENT at the act boundary — THE KEYSTONE`** · D `PARTIAL — substrate, not wired` · E `PARTIAL` · F `PARTIAL — read seams only` · G `PARTIAL — blocked on one owner action` | Harness / CC | — it *is* the dependency | Harness Completion Map; Master §3 | Layer C executing a real act end-to-end, then the Layer G authenticated lane discharging the `PROOF_OWED` it leaves |
| 2 | **Chat + Command Center** | Paige workspace `PARTIAL` · Business Game Plan `PARTIAL` · Systems Check `UNAVAILABLE` · Mind tab `UNAVAILABLE` · Trust Compass `PARTIAL` | Chat / CC (cockpit) | Layers A/B; approval gate; Rail | Ledger rows; Spine; Master §4.0 | Authenticated owner drive of the actual conversation → act → receipt, not a rendered panel |
| 3 | **Agents, skills, browser, sandbox, research** | **No ledger row, no §5.x assessment.** Layer D `PARTIAL — substrate, not wired`. Providers: `paige-browser-research` `PARTIAL` · `browserbase` `PROPOSED` · `paige-mcp-door` `LIVE` · `zapier-mcp` `PARTIAL` | Harness (Layer D) | Layer A kernel — a specialist **re-checks** authority when it acts (§14) | Integration Registry; Harness map; a ledger row **once owner-visible** | A specialist dispatched *by a process*, re-resolving authority, leaving a receipt |
| 4 | **CRM · Sales · Clients · Campaigns** | Clients→People `UNAVAILABLE` (Conversations → see family 13) · Pipeline `PROOF_OWED` · Campaign Brief `PARTIAL` · Catalog/Sales/Overview/Performance `UNAVAILABLE` | Solo CRM / Campaigns | `contact.created` bus; approval gate; Rail | Ledger rows; Spine (`campaign.*`, `pipeline.*`, `contact.event_status`); §4.0 | Authenticated create→readback→receipt, from a genuinely empty state |
| 5 | **Calendar** | `Clients -> Calendar / Bookings` **`UNAVAILABLE`** | Solo Clients | Provider connection; approval gate | Ledger row; Integration Registry (`google-calendar` `PARTIAL`); Spine (**no `calendar.*` key exists**) | A real booking written and read back on a connected tenant calendar |
| 6 | **Social** | `Campaigns -> Social` **`PROOF_OWED`**; publication **server-side contained** (PR #1164) | Social workstream | Provider auth; containment seam; Rail | Ledger row; Integration Registry; Spine (`social.presence`) | A tenant-authorized publish with a provider receipt — **blocked while containment stands** |
| 7 | **Vibe / creative** | `Campaigns -> Vibe Studio` **`UNAVAILABLE`**; media seam config-gated **OFF** | Vibe workstream | Media provider layer; budget; approval | Ledger row; **Integration Registry**; Spine (**no `vibe.*` key**) | Ledger next_slice is **"None in this program"** — deliberately out of binding scope, NOT a queued completion. If it is later scoped: a governed generation with budget accounted and a provider receipt |
| 8 | **Client Portal** | `Clients -> Portal` **`PARTIAL`** — the §7 MVP differentiator | Portal workstream | Client-scoped projection; Layer A re-resolution per client read | Ledger row; Master §3 portal subsection | An external client completing the 8-step vertical, failing closed where not permitted |
| 9 | **Vault** | `Settings -> Vault` **`INTENTIONALLY_ISOLATED`** | Solo Settings | **Isolation is the contract** — content must not enter Paige/Mind/Memory | Ledger row (isolation_note required) | Proof of *non-reach*: the isolation holds. Do not "complete" this into Paige access |
| 10 | **Marketplace + integrations** | Marketplace `UNAVAILABLE` ("most blocked") · `Settings -> Integrations` `PARTIAL` · `Settings -> Connections` `UNAVAILABLE` | Marketplace / Integrations | Registry; MCP door; tier eligibility (§60/§61) | **Integration Registry (mandatory)**; ledger rows; Spine (`integrations.*`, 15 keys) | Install→chat-reachable→metered, with the provider entry updated in the same commit |
| 11 | **Billing + usage** | `Settings -> Billing` **`PARTIAL`**; public Solo Beta acquisition **`PARTIAL`**; Billing P0 authenticated owner setup **FAIL** (brain README) | Billing | Stripe (`PARTIAL`); §38 money boundary; M1 metering | Ledger rows; Integration Registry; `../brain/config-registry.md`; §4.0 | Authenticated owner setup and test-provider Solo enrollment succeeding — and **M1**: `paige_llm_trace → platform_metered_events` |
| 12 | **Analytics + intelligence** | `Settings → Analytics` **`PARTIAL`** for PAIGE binding; completed Settings UI remains separate | Analytics / Platform Reach | Canonical issuer/resolver; bounded current-turn context; Mind signal boundary preserved | Ledger row; Spine (`analytics.metric_read`); #1837 | A real figure traced to canonical evidence through authenticated Chat/Live — automated wiring is not production acceptance |
| 13 | **Communications** | `Clients -> Conversations` `UNAVAILABLE`; operator SMS works, **tenant SMS hard-blocked** | Comms | Twilio (`PARTIAL`); A2P registration; approval gate | Ledger row; Integration Registry; Spine (`comms.messages_read`) | A tenant-scoped send with a provider receipt and a Rail outcome (R8) |
| 14 | **Team / people** | `Settings -> Team / Roles & Access` **`PROOF_OWED`** | Solo Settings | Role stores; §53 operator tiers; §51 tier matrix | Ledger row; Spine (`team.authority`); `../brain/roles-permissions.md`; **tier matrix (§66)** | Authenticated role change proven across tiers — including a tier you did not build on (§51) |
| 15 | **Platform Operator · Agency · future scale** | `Operator / Platform console` **`UNAVAILABLE`** (intentionally separate) | Platform Operator | §9/§53 seam; §57 God-tier source of truth; §60/§61 tier framework | Ledger row; tier matrix; `../architecture/platform-operator-tenant-200.md` | Operator action proven without crossing the tenant seam; §57 derivation intact |

---

## Part C — the ledger mirror (CI-VERIFIED — do not hand-edit)

Agents route without opening the JSON, so the states below are mirrored here. **A copy of a
CI-enforced field that CI does not check is a second source of truth** — the "maintained live list"
failure the Attention Register §1 prohibits. So this mirror is *mechanically guarded*:
`scripts/ci/binding-ledger-lint.mjs` (`npm run lint:binding-ledger`) fails the build if any pair
below disagrees with the ledger, names an id that is not a surface, or omits one. **It cannot drift.
If it disagrees, the matrix is the bug and the ledger is right.**

This is a mirror, not a claim, and not a score: **zero of these are `LIVE`.**

<!-- LEDGER-SNAPSHOT:BEGIN (generated from surface-binding-ledger.json; verified by scripts/ci/binding-ledger-lint.mjs) -->
```
sales.department = PROOF_OWED
finance.department = PROOF_OWED
paige.workspace = PARTIAL
command-center.business-game-plan = PARTIAL
command-center.systems-check = UNAVAILABLE
command-center.mind = UNAVAILABLE
command-center.trust-compass = PARTIAL
campaigns.campaign-brief-planning = PARTIAL
campaigns.overview = UNAVAILABLE
campaigns.catalog = UNAVAILABLE
campaigns.sales = UNAVAILABLE
campaigns.pipeline = PROOF_OWED
campaigns.social = PROOF_OWED
campaigns.performance = UNAVAILABLE
campaigns.vibe-studio = UNAVAILABLE
clients.people = UNAVAILABLE
clients.conversations = UNAVAILABLE
clients.calendar = UNAVAILABLE
clients.portal = PARTIAL
settings.setup = PROOF_OWED
settings.public-presence = PROOF_OWED
settings.team = PROOF_OWED
settings.connections = UNAVAILABLE
settings.integrations = PARTIAL
settings.vault = INTENTIONALLY_ISOLATED
settings.billing = PARTIAL
settings.security-data = INTENTIONALLY_ISOLATED
analytics = PARTIAL
marketplace = UNAVAILABLE
operator.platform = PARTIAL
platform.promotional-solo-access = PARTIAL
public.solo-beta-acquisition = PARTIAL
```
<!-- LEDGER-SNAPSHOT:END -->

---

## Two families have no registry entry, and that is a live finding (§13)

Recorded here because the matrix must not imply coverage the records do not have. Both were merged
provider-facing changes that updated every documentation home **except** the controlling one:

- **Upload-Post** (14-platform social aggregator, `6e35c60e`, 2026-09-11) — **no Integration Capability
  Registry entry.**
- **fal.ai** (Vibe media provider layer, `d5387376` / #1153, 2026-09-12) — **no entry**, though it did
  add `../brain/config-registry.md`, tier-matrix and due-diligence records.

Under the registry's own delivery rule both owe an entry.

**Registry Steward — ASSIGNED to the Harness workstream** (owner ruling 2026-09-12). It is a
governance and consistency role, **not** a feature-development bottleneck and **not** an approval
queue: Harness owns the canonical registry contract, the allowed truth states, cross-domain
reconciliation, and escalation of unowned or unsafe entries. **Domain workstreams keep ownership of
their own provider adapters and propose their own capability/connection entries** — nobody waits on
the Steward to build, and the per-entry `owner` field still names the domain owner. No new registry,
approval queue or dependency chain is created by the assignment.

So the escalation path is now executable. **What is still missing is the mechanism, not the owner:**
nothing in CI couples a provider-touching diff to its registry entry, which is why these two were
caught by review rather than by a gate (see Enforcement below).

---

## How to use this artifact

1. Find the family. Read **its owning records**, not this row — this row is an index entry.
2. Answer the ten `../../AGENTS.md` pre-edit routing questions out loud.
3. Build on the shared dependency. If the dependency is absent, **say so** — do not route around it.
   An absent Layer C is why an act cannot be claimed, not a reason to build a second executor.
4. Update the canonical records **in the same commit** (§0 / §66 / §BRAIN.3).
5. Claim only the evidence class you actually reached. `PROOF_OWED` and `UNVERIFIED` are correct
   answers; a false `LIVE` never is.

## How this artifact stays true

It carries no independent facts, so it goes stale only by drifting from its sources. Any PR that
changes a family's ledger state, Spine registration, provider status, or Harness layer updates the
matching row **in the same commit**. If you find a row contradicting its owning record, **fix the
row** — the owning record is not wrong because this file says so.

---

## Enforcement — what CI actually checks, and what it deliberately does not

Grounded by a dedicated CI survey of the existing lint suite, then adversarially verified. **The
headline finding: most of the enforcement this standard needs already exists.** Building parallel
checks would have been the §18 violation this standard exists to prevent, so this delivery **extends
the scripts that already own each subject** and adds no new lint, no new npm script, and no new
workflow file.

**Already enforced (do not rebuild):**

| Concern | Owning check |
|---|---|
| Visible capability work vs. Binding Ledger | `lint:binding-ledger` + `ui-delivery-evidence.mjs` |
| Provider work vs. Integration Registry | `lint:integration-registry` |
| Consequential tool/action work | `lint:action-risk` · `lint:approval-gate` · `lint:governed-execution` · `lint:mcp-governed-door` · `lint:mcp-destructive-confirm` · `lint:chat-tool-registry` · `lint:tool-catalogue` · `lint:action-authority` · `lint:write-targets` · `paige-spine-registry-lint` |
| Fixture / release-claim honesty | `ui-delivery-evidence.mjs` · `lint:release-governance` · `lint:skeleton` |

**Added by this delivery — both inside `scripts/ci/binding-ledger-lint.mjs`, no new entry point:**

1. **Dead code anchors.** The ledger cites 31 real repo paths in `owner_component` /
   `canonical_source`; a rename left a row asserting its state while pointing at a deleted file, and
   nothing checked it. Measured false-positive risk: **zero** — the check is clean on current `main`,
   so it blocks nothing today and only fires on a genuine future break.
2. **Mirror parity (Part C).** The ledger snapshot in this artifact must match the ledger exactly, or
   CI fails. This is what keeps Part C from becoming an unguarded second source of truth. It also
   **fails loudly if this file goes missing** rather than silently passing — a guard that no-ops when
   its target is renamed reports green forever, which is the §32 false-green class. Proven four ways:
   clean, drifted-state, omitted-row, missing-file.

**Deliberately NOT built, with the reason:**

- **A diff-coupled Integration Registry gate.** The registry's delivery rule ("the same PR must
  create or update that entry") has **no enforcement**, and the survey found no mechanically sound
  trigger — every candidate was high false-positive, because the registry schema carries no code
  anchor a diff can be correlated against. The honest fix is a **schema** change first: add an
  optional `code_anchors` field per provider and validate that each resolves on disk (the same
  pattern as check 1). Recorded as a separate scoped slice, not guessed at here. **This is why the
  two missing provider entries below were caught by review and not by CI.**
- **A WRITE_TARGET coverage ratchet.** Worth stating precisely, because the first measurement was
  wrong and the adversarial pass corrected it: **122 classified tools, 122 mapped, 2 uncovered**
  (`automation_set_grant`, `automation_set_state` — both `owner_only`), not the 10 first reported.
  A real but small hole; a ratchet is sound, and it is sequenced rather than rushed.
- **A fixture/mock code-layer lint.** Measured: all 10 `MOCK`/`SAMPLE`/`DEMO`/`FAKE`/`PLACEHOLDER`/
  `STUB` constants in non-test `src` + `functions` are legitimate. A lint there would be almost
  entirely false positives. **This gap stays open deliberately** — human review owns it.

**Owner rulings 2026-09-12, both recorded here:**

- **Registry Steward → the Harness workstream** (above). Governance and consistency; never a
  build bottleneck.
- **`ui-delivery-evidence` becomes a REQUIRED status check for merges to `main`.** Its scoped
  behaviour is preserved: a UI-affecting change must carry the evidence record; a non-UI change
  passes honestly as not-applicable. The required-check context string is
  **`ui-delivery-evidence / Validate UI delivery evidence`** (workflow name / job name — the job
  name alone will not match, and a wrong string silently protects nothing).
  **Status: NOT YET IN FORCE — this is a repository branch-protection setting, not a file.** A
  headless agent session cannot read or write branch protection (`GET
  /branches/main/protection` → `403 Resource not accessible by integration`, measured
  2026-09-12), so neither the change nor its verification can be made from here. Workflow YAML is
  **never** proof that merges are blocked. Owner action: Settings → Branches → `main` → Require
  status checks to pass → add that exact context, then confirm it appears in the required list.
  Until that is confirmed, this check remains **advisory** and this line must not be edited to
  say otherwise (§13).
