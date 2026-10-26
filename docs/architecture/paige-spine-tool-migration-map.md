# PAIGE Spine Tool Migration Map

**Status: planning record. No tool was migrated, no handler was edited, no registry entry was
added, and nothing was merged or deployed to produce it.**

Grounded against `origin/main` `e35920898ec942e5e8abaf52a5daab9bb67e0820` on 2026-09-02, by running
the repository's own guards rather than reading a prior report.

**Re-grounded the same day.** PR #747 (*PAIGE Mind: read a recorded Pipeline outcome, and cite it*)
merged as `dcddf676` while this map was open. `main` was merged into this branch and every guard
re-run on the merged head: **105 inline tools · 1 registered capability · 62 classified actions —
all unchanged.** Three claims were corrected rather than left to drift: the Mind binding, one line
number, and the Wave 2 collision. Each correction is marked where it appears.

This map answers one question for every legacy Chat tool PAIGE can call: **what has to become true
before this capability is governed, owner-visible, and honestly callable `LIVE` — and if that
cannot happen, what happens to it instead.** It is the plan; it is not permission to execute any
part of it.

---

## 1. The verified baseline

| Measure | Value | Command run on `e3592089` |
|---|---|---|
| Inline legacy Chat tools | **105** | `npm run lint:chat-tool-registry` → `✓ 105 tool(s) inline, none added (baseline 105)` |
| Registered Spine capabilities | **1** | `node --experimental-strip-types scripts/ci/paige-spine-registry-lint.mjs` → `PASS (1 capability)` |
| Classified actions in the risk policy | **62** — 32 `ordinary`, 28 `high`, 2 `owner_only`, 5 exempt, 0 unclassified writes | `npm run lint:action-risk` |
| Declared tool count parsed from the handler | **105** | `grep -cE '^\s*name: "[a-z0-9_]+",\s*$' supabase/functions/paige-ai-chat/index.ts` |
| Baseline file entries | **105** | `grep -vc '^\s*#\|^\s*$' scripts/ci/chat-tool-baseline.txt` |

**The prior measured baseline of 105 is unchanged. There is no delta to explain** — the guard, the
handler parse and the frozen baseline file all return 105 independently, and the guard passes,
which means no tool has been added or removed since the baseline was frozen.

### Reconciliation — where the 62 and the 105 meet

The two numbers count different things, and the difference is itself a finding.

| Bucket | Count | Meaning |
|---|---:|---|
| `high` | 26 | irreversible, changes authority, reaches outside, spends money, or a client sees it |
| `ordinary` | 32 | reversible, in-tenant, effects stay in the workspace |
| `owner_only` | 2 | **refused in Chat at any approval strength** (`index.ts:7976`) |
| exempt, non-mutating | 5 | named in `NON_MUTATING_EXEMPT` with a reason |
| read | 40 | no classification needed; `MUTATION_VERB` reads them as queries |
| **Total declared tools** | **105** | |

`26 + 32 + 2 = 60` classified actions are declared Chat tools. The policy classifies **62**. The
two extra are **`marketplace_install` and `marketplace_uninstall`**, both classified `high` and
**neither declared as a Chat tool anywhere**. Grepped across `supabase/`, `src/` and `scripts/`,
they appear only in the risk policy and in two vestigial lookup sets inside the handler
(`TOOL_RESULT_IS_RECEIPT:2016`, `WRITE_TARGET:11134`). The real install path is the
`marketplace-install` edge function and `marketplace-checkout-session`, which the Chat gate never
sees — which is the mechanism behind issue **#740**.

**This was already on record and is confirmed here, not discovered here.** The Master Project File's
tool-confirmation entry already calls the pair *"containment tombstones with no tool definition and no
dispatch branch"*. That same entry's `MUTATING_TOOLS` count of **52** has since drifted — the set is
`mutatingTools()`, i.e. every risk-policy entry, and it is **62** today; the count was corrected in
place while writing this map.

Two further ghosts of the same shape already carry an in-file correction: `pipeline_create` and
`pipeline_add_stage` are named in `WRITE_TARGET` and `TOOL_RESULT_IS_RECEIPT` but are not tools.

### Related, and deliberately not duplicated

**`docs/brain/paige-spine-and-rail-state.md`** is the verified **state** record — what the Spine and
Rail are today, and why an empty Solo activity feed must not be read as "nothing happened". It landed
on `main` as `f0fcd2dd` (#743) while this map was open, and it reports the same three baselines this
map measured — **1 capability · 105 inline tools · 62 classified actions** — reached independently.
**Read it first.** This map is the *plan*; that file is the *state*, and it explicitly says it is not
a backlog. Neither should grow into the other (§18).

`docs/delivery/PAIGE-CHAT-DELIVERY-MAP.md` is a Full Project Audit of the PAIGE Chat surface grounded
2026-08-31. It maps the Chat **estate** — front doors, slices, seams, the attribution row. This map
covers a different axis: what each declared tool must become under the Spine contract. Neither
supersedes the other, and neither should grow into the other (§18).

---

## 2. What the Spine can and cannot carry today — verified, not inherited

Every constraint below was read directly out of the shipped source for this map. They are not
preferences; they are what the code enforces, and they decide every disposition in section 4.

**C1 — the Rail is per-client at three independent layers.**
`paige_client_events.contact_id` is `uuid NOT NULL REFERENCES public.clients(id)`
(`20260712163259_paige_context_rail_step1_foundation.sql:80`); `record_rail_event` raises
`contact not in tenant` (same file, `:176`); and the Chat emitter returns early at
`if (!contactId) return` (`paige-ai-chat/index.ts:11273`). **A workspace-level outcome has nowhere
to be recorded.**

**C2 — the resolver accepts one subject type.** `resolveEvidence.ts:40` rejects any row where
`input.subject_type !== "client"`.

**C3 — the safe summary is a CONSTANT, and every fact must be an enumerated scalar.**
`resolveEvidence.ts:45` rejects any row whose `safe_summary` is not byte-identical to the
capability's declared `safeSummary`; `safeFacts` rejects any fact value not present in the
declared `factValues`.

**C4 — Spine evidence loads only inside a client-scoped Chat turn** (`paige-ai-chat/index.ts:1115`,
guarded by `scopedClientRef`). A general business question reaches no Spine evidence at all.

**The consequence, and it is the single most important sentence in this document:**

> **The current Spine evidence contract is an EVENT-SIGNAL contract, not a data-read contract.** It
> can express *"an event of an enumerated kind happened to this client, with these enumerated
> scalar facts."* It cannot express a record, a list, a name, a title, a count, a status string, or
> any free text. **Therefore not one of the 40 read tools can migrate as-is** — they are record and
> list reads, not event signals.

Migration is therefore **not** "move 105 tools into the Spine." It is: each domain declares (a) its
**evidence** as an enumerated event-signal projection of what PAIGE may know, and (b) its **action**
with an exact Chat tool, risk class, idempotency and Rail outcome. The 105 tools remain the
execution mechanism until each is re-fronted by the Chat-owned bounded adapter.

### The outcome gap, measured

Of the 60 classified actions PAIGE can perform from Chat:

| Outcome path | Tools | Owner can see it today |
|---|---:|---|
| `paige_audit_log` **and** a per-client Rail event | **13** | **No** — the Rail row is written, but production `authenticated` has no `SELECT` on `paige_client_events` (#746) |
| `paige_audit_log` only | **47** | **No** — `paige_audit_log` has no Solo reader at all |

**Leg 7 of the platform build path — *owner can see the truthful result* — is closed for 100% of
PAIGE's writes.** 47 by design, because no Rail producer exists for a workspace-level act; 13 by
the missing grant. This is why no mutating capability can be registered `LIVE` today regardless of
how well it is built: the registry requires `outcome.railVisibility` for a mutating capability, and
the visibility does not exist.

---

## 3. Migration waves

Waves are **domain-coherent and strictly sequential**. Within the one domain that can move first,
risk tiers are ordered stages, because the assignment's read → governed-write → high-risk ordering
is the right ordering and a domain boundary should not smuggle a `high` action in beside a read.

### Wave 0 — Foundation prerequisites (no tools; blocks every other wave)

| Item | State | Why it blocks |
|---|---|---|
| **#746** — Context Rail history read cannot execute in production | OPEN, RELEASE-BLOCKING | Leg 7 for all 13 Rail-emitting tools. Until it lands, a migrated capability's outcome is invisible and `LIVE` would be a false claim |
| **#729** — repair of the five unresolved review findings on Spine #728 | OPEN PR, blocked from Gate 2 by #746 | first owner flow on the Spine |
| **#735** — PR #644 revokes the SELECT the Rail read depends on | OPEN | the grant-vs-RPC seam decision must be made *with* #644, not around it |
| **SCR-1 — workspace-level outcome projection** | **RAISED, APPROVED AND BUILT as `SCR-2026-09-05`** (2026-09-05) — see `paige-spine-foundation.md`. Exercised on the MCP integrations, the fallback-carrying domain Wave 3's rationale names. The other ~47 actions still need their own `capability_key` copy, wave by wave. | C1. Required by 47 of 60 actions and by every wave from 3 onward |
| **SCR-2 — non-client subject types in the resolver** | **not requested, not started** | C2/C4. Required by every read capability and every workspace-subject act |
| **SCR-3 — a record/list evidence shape** | **not requested, not started** | C3. Without it no read tool can ever migrate |
| **Ratchet hardening** (section 5) | partially shipped | the existing guard freezes the count; it does not yet prevent the four bypasses named in section 5 |

**On the `SCR-n` labels.** The repository's real convention is `SCR-<date>`, and one request is
already **approved**: `SCR-2026-09-02` (the Chat-facing block may carry the safe `rail:` citation),
recorded in `docs/architecture/paige-spine-foundation.md`. `SCR-1`, `SCR-2` and `SCR-3` in this map
are **shorthand for three requests that have not been raised** — they are not identifiers, not
approved, and must not be cited as though they were. Whoever raises them gets a real dated name.

**Nothing after Wave 0 may begin before SCR-1 and SCR-2 exist as approved requests.** Waves 1 and 2
may be *specified* before then; they may not be built.

### Wave 1 — Clients & CRM (17 tools)

Three ordered stages. **1a** four client-subject reads; **1b** seven `ordinary` client-subject
writes; **1c** six `high` client-subject writes.

- **Why they belong together** — the client is the only subject the Spine contract accepts (C2), so
  this is the only domain that can move without SCR-2. All 13 writes here already emit a per-client
  Rail event, so they are the only acts in the platform whose outcome has a producer.
- **Dependencies** — #746 for every stage; stage 1b never starts before 1a's evidence declaration
  is proven; 1c never starts before 1b, because `crm_delete_contact`, `crm_assign_coach`,
  `crm_assign_contact`, `program_enroll`, `crm_file_document` and `calendar_book_meeting` are
  irreversible, move authority, or reach a real person.
- **Collisions** — PR **#591** edits `paige-ai-chat/index.ts` (active-tenant Knowledge isolation);
  PR **#729** edits `src/hooks/useRailEvents.ts`.
- **Owner flow** — Solo → Clients. The owner adds or edits a client, PAIGE acts, and the act
  appears on that client's activity feed.
- **Risks** — `crm_update_pipeline_stage` and `crm_assign_coach` write `clients` and `audit_logs`
  directly rather than through an RPC, so their tenant scope rests entirely on RLS.
- **Chat-workstream role** — owns the bounded adapter and the approval treatment for 1b and 1c.
- **Required Rail/Mind outcome** — per-client Rail events already exist; Mind stays `UNAVAILABLE`.
- **`LIVE` criteria** — the ten conditions in section 4, with #746 closed and an authenticated
  owner drive per stage.
- **Why not before Wave 0** — 13 correct writes whose outcome nobody can read is exactly the
  `PARTIAL` this map exists to stop being called `LIVE`.

### Wave 2 — Pipeline & Deals (7 tools)

- **Why together** — one domain, one governance defect set, tracked as **#755**.
- **Dependencies** — **#755 is a hard block.** Three findings recorded there: `deal_move_stage`
  never consults `move_policy`; it writes `public.deals` with the service-role client and emits no
  Rail event, so PAIGE cannot see her own move in her own evidence; `pipeline_move_approvals` is
  write-only, so a held request is unresolvable and permanently increments the archive dependency
  count. Also SCR-1, because a pipeline is workspace-level.
- **Collisions** — PR **#747 MERGED** into `main` as `dcddf676` while this map was open; it changed
  `paige-spine/domains/pipeline.ts` and `chatEvidence.ts` and is no longer a collision, but its Mind
  projection is now part of this wave's starting state. PR **#706** builds Solo Pipeline creation.
- **Owner flow** — Solo → Growth → Pipeline.
- **Chat role** — the Pipeline move-approval reconciliation the Spine foundation names as required
  before any Pipeline mutation joins the Spine.
- **Why not before Wave 1** — Pipeline already has a registered read capability and a domain-held
  approval model that disagrees with the canonical gate. Reconciling two approval models is harder
  than migrating a domain that has one.

### Wave 3 — Communications (8 tools)

- **Why together** — one provider seam, one readiness resolver (`tenant_comms_readiness`), one set
  of workspace-level outcomes.
- **Dependencies** — SCR-1 (a phone number is not a client); the existing `connections-rail-contract.md`
  C-1…C-4 contracts; issues **#639** and **#647** (Systems Check ↔ comms readiness seams).
- **Collisions** — PR **#674** (Communications: two capabilities that shipped and were never
  reachable).
- **Risks** — `comms_buy_number` spends real money on a recurring charge and `comms_set_primary_number`
  changes what every client sees; both are `high` and both currently write only `paige_audit_log`.
- **Why not before Wave 2** — it is the first wave that cannot move at all without SCR-1, so it
  should not start until SCR-1 has been exercised once on a domain that has a fallback.

### Wave 4 — Team & Access (10 tools)

- **Why together** — every tool here moves authority or describes who holds it; `user_roles` is a
  global table with no `tenant_id` (§59's global-role trap).
- **Dependencies** — SCR-1; the Team surface card's owner decision that a Rail event may not carry
  a null `contact_id`.
- **Risks** — `team_invite_member` and `team_invite_resend` email a real stranger, which no undo
  inside the product can reach. `member_grant_role` touches a global table.
- **Why not before Wave 3** — an access grant is the least reversible class of act in the platform,
  and it should not be the wave that first exercises a new outcome primitive.

### Wave 5 — Growth, Campaigns & Studio (11 tools)

- **Why together** — one authoring pipeline: generate → save draft → publish, plus the Studio
  artefacts that feed it.
- **Dependencies** — SCR-1; the publishing spine (PR **#312**).
- **Risks** — `growth_page_publish` and `growth_funnel_publish` put content at a public URL.
- **Why not before Wave 4** — publishing is externally visible and irreversible in practice.

### Wave 6 — Work management: Plans · Action bus · Automations (17 tools)

- **Why together** — all three are PAIGE's own coordination substrate rather than tenant domain
  data, and §67 governs the autonomy half.
- **Dependencies** — SCR-1; §67/§68 (`docs/doctrine/autonomy-architecture.md`); issue **#739**
  (`paige_pending_approvals` base RLS carries no `tenant_id` predicate — isolation is client-side
  only), which `propose_action` writes to directly.
- **Risks** — `automation_set_grant` and `automation_set_state` are `owner_only` and are refused in
  Chat; see their Retire disposition.
- **Why not before Wave 5** — #739 is an isolation defect on the table this wave's central tool
  writes.

### Wave 7 — External providers & delegation (16 tools)

- **Why together** — every one of these dispatches work that executes **outside** the approval
  gate, at n8n, at Zapier, or in a service-role sub-agent.
- **Dependencies** — SCR-1 plus an **external-outcome contract**: a durable record of what the
  provider actually did. `n8n_execution_get` exists precisely because a fire is not proof of
  delivery, which is the shape the contract must generalise.
- **Risks** — `delegate_to_subagent` runs as service role against the orchestrator, so whatever the
  specialist then does is ungoverned. `zapier_run_action`'s `WRITE_TARGET` is the honest string
  `external_provider`, because there is no row in this database at all.
- **Why not before Wave 6** — it needs a contract no other wave needs, and it is the only wave
  whose outcomes are not in this database.

### Wave 8 — Workspace context & catalogue (11 tools)

- **Why together** — workspace-level reads and identity writes that answer "what is this business,
  and what does it have" rather than acting on a subject.
- **Dependencies** — SCR-2 and SCR-3; issue **#749** (`runGeneralDocumentExtraction` is called at
  `paige-ai-chat/index.ts:1212` and defined nowhere) blocks the two document tools.
- **Why not before Wave 7** — it is the wave that most needs SCR-3, the least specified of the
  three requests.

### Retired / de-scoped (10 tools)

Never Spine capabilities. Kept separate so the ratchet's target floor is honest.

---

## 4. The `LIVE` acceptance standard

A capability is not `LIVE` because it exists in source, appears in a menu, has a migration, passes
a fixture test, or is deployed. It becomes `LIVE` only when **every applicable** condition holds:

1. The server resolves tenant and subject; the caller cannot choose another tenant or client.
2. The evidence contract exposes only safe, minimal facts.
3. The capability is declared in `supabase/functions/_shared/paige-spine/registry.ts`.
4. PAIGE Chat reaches it through the canonical bounded adapter, not a new direct hand-wire.
5. The action-risk classifier and the single approval gate govern every write.
6. Writes are idempotent and handle partial success, rejection, retry and abandonment truthfully.
7. The owner can see a durable, safe outcome through the Rail or an approved outcome projection.
8. The human page/workflow and PAIGE's behaviour agree.
9. Automated, static, rendered, authenticated-runtime and production evidence are reported
   separately.
10. A real authenticated owner flow has been driven.

**If one condition is missing, the truthful label is `PARTIAL` or `UNAVAILABLE`.** Today condition
7 fails platform-wide, so **no** mutating capability in this map can be `LIVE` at the time of
writing, and this document does not promote anything.

---

## 5. CI-ratchet plan — proposal only, not implemented here

**What already exists on `main`, and must not be described as missing.**
`scripts/ci/chat-tool-registry-lint.mjs` (wired as `lint:chat-tool-registry` in `ci.yml`) already:
freezes the inline set at `scripts/ci/chat-tool-baseline.txt`; **fails on any added tool name**;
fails on a removal until the baseline is updated in the same PR; fails closed if it parses zero
declarations or cannot inspect the registry; and prints, for an added tool, whether a canonical
Spine capability declares it. That is the ascending half of the ratchet and it works.

**What is missing.** Four bypasses, each of which would let the real coupling grow while the number
stays flat or falls.

| # | Bypass | Proposed guard | Where |
|---|---|---|---|
| B1 | **Rename.** Delete `crm_add_note`, add `crm_note_add`. The guard sees one removal and one addition and fails — but a PR that also edits the baseline passes, because a removal is *expected* to update the baseline | Require the baseline diff to be **removal-only**. A PR may delete baseline lines; it may never add one. A rename then fails as an unexplained addition | `chat-tool-registry-lint.mjs`, compare baseline old/new as sets |
| B2 | **Generated alias.** A tool name built by interpolation or spread rather than a literal `name: "x",` line is invisible to the parser, which matches only a literal on its own line | Add a **shape guard**: fail if the tools array contains a `name:` whose value is not a string literal, or if a spread appears inside it | same lint, second regex pass over the tools array |
| B3 | **Dead-code shim.** A tool is removed from the array, the baseline shrinks, but the dispatch branch and its RPC stay reachable through another caller — the count falls without a migration | A baseline **removal** must be accompanied by either (a) a registry capability whose `action.chatTool` equals the removed name, or (b) an explicit `# retired: <reason>` line in the baseline file. Otherwise fail | same lint, reusing `registeredChatToolsFromSources`, which already resolves that mapping |
| B4 | **Second approval channel.** A migrated capability re-implements approval outside the canonical gate | Already guarded by `scripts/ci/one-approval-gate-lint.mjs`. Extend its fixture set with the migration lane's shapes; do not build a second guard | `one-approval-gate-lint.mjs` |

**Descent rule.** The baseline shrinks by one line only when, in the same PR: the tool is gone from
the handler; a registry capability declares `action.chatTool` with that exact name; that capability
is `mutate`/`external_effect` with `approvalAuthority: "chat-canonical"`, an `ordinary`/`high`
`riskPolicyKey`, non-empty `idempotency`, and `outcome.railVisibility`; and `chatBinding` is `LIVE`
— which the registry already refuses to accept without the rest. Every one of those checks is a
property the **existing** registry validator enforces at import, so the lint reads them rather than
re-deriving them.

**Retired tools need their own line, or the floor is a lie.** Ten tools in this map are Chat-local
primitives or dead scaffolds that will never be Spine capabilities. Without the `# retired:` escape
in B3, the ratchet's implied target of zero is unreachable and the guard eventually gets weakened to
match. The honest target floor is **10 + whatever the owner rules stays Chat-local**, and the
baseline file should carry those lines in a separate, commented block.

**No big-bang refactor is required by any of this.** Every change above is inside two existing lint
scripts and one text file.

---

## 6. Durable wave issues

| Wave | Issue |
|---|---|
| Wave 0 — Foundation prerequisites | [#756](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/756) |
| Wave 1 — Clients & CRM | [#757](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/757) |
| Wave 2 — Pipeline & Deals | tracked by existing [#755](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/755) |
| Wave 3 — Communications | [#758](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/758) |
| Wave 4 — Team & Access | [#759](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/759) |
| Wave 5 — Growth, Campaigns & Studio | [#760](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/760) |
| Wave 6 — Work management | [#761](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/761) |
| Wave 7 — External providers & delegation | [#762](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/762) |
| Wave 8 — Workspace context & catalogue | [#763](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/issues/763) |
| Retired / de-scoped | recorded in this map; owner decision required, no issue |

The PAIGE Attention Register Project does not exist at the time of writing, so these are linked
here rather than added to it. Adding them remains pending.

---

## 7. The complete inventory — 105 tools, 105 rows

Every tool the guard counts appears exactly once. Row numbering runs 1–105 and the disposition
tally is **13 Migrate · 79 Spine Change Request · 3 Keep unavailable · 10 Retire**.

Column notes, so the table is read correctly:

- **Line** — the `name:` declaration line in `supabase/functions/paige-ai-chat/index.ts` at
  `e3592089`. Line numbers drift; the tool name is the stable identifier.
- **Server target** — what the dispatch branch actually calls, read from source, not from the tool
  name. `call:fetch` means an outbound HTTP call rather than a database seam.
- **Outcome path** — every classified action writes a `paige_audit_log` row; only the 13 that
  resolve to a contact additionally emit a per-client Rail event.
- **Owner can see it today** — the answer is **No** for all 60 actions, for the two distinct reasons
  in section 2.
- **Tenant/subject resolution** — the Chat handler builds its Supabase client from the anon key plus
  the caller's `Authorization` header (`index.ts:575`), so RLS and `current_user_tenant_id()` apply
  to every tool below. Thirteen call sites pass `p_tenant_id: personaCtx?.tenant_id`; the RPCs that
  receive it derive the tenant from `current_user_tenant_id()` for a JWT caller and **raise on a
  mismatch** rather than trusting the parameter (`assign_contact`,
  `20260711160000_paige_onboarding_tools.sql:12-14` is the shape). Server-side isolation is
  therefore **proven at the seam** for the RPC-backed tools and **RLS-only** for the tools whose
  target column shows `table:` with no `rpc:`. Per-tool proof beyond this was not attempted and is
  `UNVERIFIED`.
- **Mind status** — `UNAVAILABLE` for all 105 **tools**. **Corrected 2026-09-02 after PR #747 merged
  (`dcddf676`):** the one declared capability's `mindBinding` is now `PARTIAL`, not `UNAVAILABLE` —
  `_shared/paige-spine/mindEvidence.ts` projects the resolver result into a bounded, attributable
  Mind record. That changes nothing for the 105, because the capability maps to **no Chat tool**;
  but the earlier flat "`UNAVAILABLE` everywhere" reading is no longer true of the Spine. See
  `docs/delivery/paige-spine-mind-handoff.md`.
- **Spine status** — `UNREGISTERED` for all 105. The registry declares one capability,
  `pipeline.deal_stage_evidence`, which is an evidence read and maps to **no** Chat tool.

### W1 Clients & CRM — 17 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `crm_get_contact_summary` | 5705 | read | read | table:clients · table:communication_log · table:deal_activities · table:deals · table:tasks | — (read) | n/a | SCR-3 | **Spine Change Request** | 1a |
| 2 | `get_client_rail` | 6400 | read | read | rpc:get_client_rail | — (read) | n/a | #746 · #748 | **Spine Change Request** | 1a |
| 3 | `crm_list_documents` | 5636 | read | read | table:client_files | — (read) | n/a | SCR-3 | **Spine Change Request** | 1a |
| 4 | `crm_list_tasks` | 5862 | read | read | table:tasks | — (read) | n/a | SCR-3 | **Spine Change Request** | 1a |
| 5 | `crm_create_contact` | 4993 | write | ordinary | rpc:create_contact · rpc:find_duplicate_contacts · table:clients | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 6 | `crm_update_contact` | 5018 | write | ordinary | rpc:upsert_contact | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 7 | `crm_update_pipeline_stage` | 4944 | write | ordinary | table:audit_logs · table:clients | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 8 | `crm_log_activity` | 5668 | write | ordinary | table:communication_log | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 9 | `crm_add_note` | 5619 | write | ordinary | table:client_notes · table:clients | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 10 | `crm_create_task` | 4975 | write | ordinary | table:tasks | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 11 | `update_client_data` | 4779 | write | ordinary | call:fetch | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1b |
| 12 | `crm_delete_contact` | 5236 | write | high | edge:delete-contact | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Retired (PR-A)** — edge + tombstone deleted; governed `crm_hard_delete_contact` is the one delete path | 1c |
| 13 | `crm_assign_coach` | 4960 | write | high | table:audit_logs · table:clients | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1c |
| 14 | `crm_assign_contact` | 5580 | write | high | rpc:assign_contact | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1c |
| 15 | `program_enroll` | 5604 | write | high | rpc:enroll_contact_in_program | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1c |
| 16 | `crm_file_document` | 5651 | write | high | table:client_files · table:clients | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1c |
| 17 | `calendar_book_meeting` | 5251 | external action | high | rpc:create_internal_booking | audit + per-client Rail | **No** — Rail unreadable (#746) | #746 | **Migrate** | 1c |

### W2 Pipeline & Deals — 7 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 18 | `pipeline_catalogue` | 5772 | read | read | rpc:get_pipeline_catalogue | — (read) | n/a | #755 | **Spine Change Request** | 2 |
| 19 | `crm_list_deals` | 5719 | read | read | table:deals | — (read) | n/a | #755 | **Spine Change Request** | 2 |
| 20 | `deal_create` | 5736 | write | ordinary | table:clients · table:deal_activities · table:deals · table:pipeline_stages | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | #755 | **Spine Change Request** | 2 |
| 21 | `deal_move_stage` | 5756 | write | ordinary | table:deal_activities · table:deals · table:pipeline_stages | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | #755 | **Spine Change Request** | 2 |
| 22 | `pipeline_configure` | 5811 | write | ordinary | rpc:configure_tenant_pipeline_as_paige · rpc:replay_pipeline_folder_archive_as_paige · table:pipeline_archive_confirmations · table:pipeline_folder_archive_confirmations · table:pipeline_folders · table:pipelines | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | #755 | **Spine Change Request** | 2 |
| 23 | `pipeline_archive_preview` | 5785 | read | exempt | rpc:prepare_pipeline_archive_as_paige | — (read) | n/a | #755 | **Spine Change Request** | 2 |
| 24 | `pipeline_folder_archive_preview` | 5799 | read | exempt | rpc:prepare_pipeline_folder_archive_as_paige | — (read) | n/a | #755 | **Spine Change Request** | 2 |

### W3 Communications — 8 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 25 | `comms_connection_summary` | 6280 | read | read | rpc:list_tool_autonomy · rpc:tenant_comms_readiness | — (read) | n/a | #639 · #647 | **Spine Change Request** | 3 |
| 26 | `comms_list_numbers` | 6288 | read | read | table:tenant_phone_numbers | — (read) | n/a | SCR-2 | **Spine Change Request** | 3 |
| 27 | `comms_search_numbers` | 6296 | external read | read | edge:comms-search-numbers | — (read) | n/a | SCR-2 | **Spine Change Request** | 3 |
| 28 | `comms_registration_status` | 6357 | read | read | rpc:tenant_comms_readiness | — (read) | n/a | #639 | **Spine Change Request** | 3 |
| 29 | `comms_buy_number` | 6314 | external action | high | edge:comms-purchase-number | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 3 |
| 30 | `comms_name_number` | 6330 | write | ordinary | rpc:tenant_phone_number_rename | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 3 |
| 31 | `comms_set_primary_number` | 6345 | external action | high | rpc:tenant_phone_number_set_primary | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 3 |
| 32 | `comms_draft_registration` | 6365 | external action | ordinary | edge:comms-a2p-draft · table:user_roles | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 3 |

### W4 Team & Access — 10 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 33 | `crm_list_team` | 5552 | read | read | rpc:list_team_members | — (read) | n/a | SCR-2 | **Spine Change Request** | 4 |
| 34 | `presence_who_online` | 5560 | read | read | rpc:presence_list_online | — (read) | n/a | SCR-2 | **Spine Change Request** | 4 |
| 35 | `presence_is_online` | 5568 | read | read | rpc:presence_check_user | — (read) | n/a | SCR-2 | **Spine Change Request** | 4 |
| 36 | `member_grant_role` | 5102 | write | high | rpc:grant_tenant_member_role | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 · §59 global-role trap | **Spine Change Request** | 4 |
| 37 | `member_revoke_role` | 5117 | write | high | rpc:revoke_tenant_member_role | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 · §59 global-role trap | **Spine Change Request** | 4 |
| 38 | `team_set_work_profile` | 5155 | write | ordinary | rpc:set_solo_team_member_work_profile | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 4 |
| 39 | `team_set_permission` | 5172 | write | high | rpc:set_solo_team_member_permission | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 4 |
| 40 | `team_invite_member` | 5188 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 4 |
| 41 | `team_invite_resend` | 5206 | external action | high | edge:solo-team-invitations | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 4 |
| 42 | `team_invite_revoke` | 5221 | write | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 4 |

**Added after this map was drawn, and outside its count (EXP08 team lifecycle, 2026-10-26; LIVE on
merge, authenticated runtime UNVERIFIED).** Seven Team tools are born Spine-declared, so they
are not migration backlog: `team_list_members` (read, `public.get_solo_team_workspace`),
`team_member_holdings` (read, `public.team_member_holdings`), and the `high` writes
`team_suspend_member`, `team_reinstate_member`, `team_remove_member`, `team_set_conversations`
(the four lifecycle definers of `20271115040008`) and `team_handover_work`
(`public.plan_update_item_versioned`). Declared in `_shared/paige-spine/domains/team_lifecycle.ts`,
entering Chat through the adapter spread (no inline tool), dispatched last in the chain on the caller's
JWT by `_shared/team-lifecycle/chat.ts`, and each write outcome with a persona workspace is a capability receipt
(`recordCapabilityRun`) besides the `paige_audit_log` row, whose `target_id` is now the membership or
work row the definer answered about. The Rail gap above (no workspace-level outcome projection) is
unchanged for them.

### W5 Growth, Campaigns & Studio — 11 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 43 | `growth_list` | 5382 | read | read | table:growth_pages · table:tenants | — (read) | n/a | SCR-2 | **Spine Change Request** | 5 |
| 44 | `growth_page_generate` | 5390 | read | exempt | edge:growth-page-draft | — (read) | n/a | SCR-1 | **Spine Change Request** | 5 |
| 45 | `growth_page_save` | 5405 | write | ordinary | rpc:growth_form_upsert · rpc:growth_page_upsert · table:growth_forms | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |
| 46 | `growth_page_publish` | 5424 | external action | high | rpc:growth_page_publish | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 · #312 | **Spine Change Request** | 5 |
| 47 | `growth_funnel_generate` | 5438 | read | exempt | edge:growth-funnel-draft | — (read) | n/a | SCR-1 | **Spine Change Request** | 5 |
| 48 | `growth_funnel_build` | 5452 | write | ordinary | rpc:growth_form_upsert · rpc:growth_funnel_upsert · rpc:growth_page_upsert · table:growth_forms · table:growth_funnels · table:growth_pages | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |
| 49 | `growth_funnel_publish` | 5472 | external action | high | rpc:growth_funnel_publish · rpc:growth_page_publish · table:growth_funnel_steps · table:growth_funnels | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 · #312 | **Spine Change Request** | 5 |
| 50 | `draft_marketing_content` | 5292 | external action | ordinary | edge:content-draft | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |
| 51 | `generate_image` | 5274 | external action | ordinary | edge:generate-image | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |
| 52 | `content_save` | 5309 | write | ordinary | rpc:link_session_artifact · rpc:save_artifact_version · rpc:save_marketing_content | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |
| 53 | `document_generate` | 5326 | external action | ordinary | rpc:save_marketing_content | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 5 |

### W6 Work management — 17 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 54 | `plan_list` | 6004 | read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 6 |
| 55 | `plan_create` | 5907 | write | ordinary | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 56 | `plan_add_milestone` | 5928 | write | ordinary | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 57 | `plan_assign_task` | 5947 | write | ordinary | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 58 | `plan_update_item` | 5969 | write | ordinary | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 59 | `plan_remove_item` | 5990 | write | high | rpc:resolve_tool_autonomy | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 60 | `plan_set_reminder` | 5887 | write | ordinary | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 61 | `action_list` | 5524 | read | read | rpc:list_actions | — (read) | n/a | SCR-2 | **Spine Change Request** | 6 |
| 62 | `action_get` | 5540 | read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 6 |
| 63 | `action_file` | 5486 | write | ordinary | rpc:file_action | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 64 | `action_advance` | 5505 | write | ordinary | rpc:advance_action | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 6 |
| 65 | `propose_action` | 6098 | read | exempt | table:paige_pending_approvals · table:user_roles | — (read) | n/a | #739 | **Spine Change Request** | 6 |
| 66 | `automation_list` | 6466 | read | read | rpc:resolve_automation_autonomy · table:paige_automations | — (read) | n/a | SCR-2 | **Spine Change Request** | 6 |
| 67 | `automation_triggers_list` | 6474 | read | read | table:paige_automation_triggers | — (read) | n/a | SCR-2 | **Spine Change Request** | 6 |
| 68 | `automation_draft` | 6482 | write | ordinary | rpc:resolve_automation_autonomy · table:paige_automation_acts · table:paige_automation_triggers · table:paige_automations | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 · §67 | **Spine Change Request** | 6 |
| 69 | `automation_set_grant` | 6510 | write | owner_only | rpc:resolve_automation_autonomy · table:paige_automations | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | §67 red line — refused in Chat | **Retire** | 6 |
| 70 | `automation_set_state` | 6525 | write | owner_only | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | §67 red line — refused in Chat | **Retire** | 6 |

### W7 External providers & delegation — 16 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 71 | `n8n_list_workflows` | 6117 | external read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 72 | `n8n_get_executions` | 6125 | external read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 73 | `n8n_execution_get` | 6216 | external read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 74 | `n8n_validate_workflow` | 6228 | read | read | — | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 75 | `n8n_activate_workflow` | 6140 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 76 | `n8n_deactivate_workflow` | 6152 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 77 | `n8n_run_workflow` | 6164 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 78 | `n8n_create_workflow` | 6181 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 79 | `n8n_update_workflow` | 6198 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 80 | `n8n_archive_workflow` | 6245 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 81 | `n8n_delete_workflow` | 6257 | external action | high | edge:paige-n8n | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 82 | `zapier_list_actions` | 6377 | external read | read | edge:call-zapier-action | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 83 | `zapier_run_action` | 6385 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | external-outcome contract | **Spine Change Request** | 7 |
| 84 | `list_subagents` | 6023 | external read | read | call:fetch · table:analytics_events · table:clients · table:user_roles | — (read) | n/a | SCR-2 | **Spine Change Request** | 7 |
| 85 | `forge_subagent` | 6059 | external action | ordinary | call:fetch · table:user_roles | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 7 |
| 86 | `delegate_to_subagent` | 6041 | external action | high | — | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | runs as service role outside the gate | **Keep unavailable** | 7 |

### W8 Workspace context & catalogue — 11 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 87 | `crm_search_contacts` | 5686 | read | read | table:clients | — (read) | n/a | SCR-3 | **Spine Change Request** | 8 |
| 88 | `crm_pipeline_summary` | 5879 | read | read | table:clients · table:deals · table:tasks | — (read) | n/a | SCR-3 | **Spine Change Request** | 8 |
| 89 | `program_list` | 5596 | read | read | rpc:list_tenant_programs | — (read) | n/a | SCR-2 | **Spine Change Request** | 8 |
| 90 | `list_event_kinds` | 6415 | read | read | rpc:list_event_kinds | — (read) | n/a | SCR-2 | **Spine Change Request** | 8 |
| 91 | `author_event_kind` | 6427 | write | ordinary | rpc:upsert_tenant_event_kind | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 8 |
| 92 | `update_business_profile` | 5078 | write | ordinary | rpc:stage_solo_business_brief_proposal · table:tenants | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 8 |
| 93 | `propose_business_brief_update` | 5053 | write | ordinary | rpc:stage_solo_business_brief_proposal | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 8 |
| 94 | `save_to_knowledge_base` | 6080 | write | ordinary | call:fetch | `paige_audit_log` only | **No** — no Rail row; audit log has no reader | SCR-1 | **Spine Change Request** | 8 |
| 95 | `marketplace_browse` | 4897 | read | read | rpc:marketplace_catalog_for_tenant | — (read) | n/a | SCR-2 · #740 | **Spine Change Request** | 8 |
| 96 | `document_pending_reviews` | 6446 | read | read | table:credit_report_uploads | — (read) | n/a | #749 | **Keep unavailable** | 8 |
| 97 | `document_resume_review` | 6454 | read | read | table:credit_report_uploads | — (read) | n/a | #749 | **Keep unavailable** | 8 |

### R Retired / de-scoped — 8 tools

| # | Tool | Line | Behaviour | Risk class | Server target | Outcome path | Owner sees it today | Blocker / related | Disposition | Stage |
|---|---|---|---|---|---|---|---|---|---|---|
| 98 | `web_fetch` | 4764 | external read | read | — | — (read) | n/a | — | **Retire** | R |
| 99 | `web_search` | 4911 | external read | read | call:fetch | — (read) | n/a | — | **Retire** | R |
| 100 | `deep_research` | 4928 | external read | read | call:fetch | — (read) | n/a | — | **Retire** | R |
| 101 | `get_current_rates` | 4861 | external read | read | call:fetch · table:economic_rates_cache | — (read) | n/a | — | **Retire** | R |
| 102 | `search_regional_lenders` | 4810 | external read | read | call:fetch | — (read) | n/a | — | **Retire** | R |
| 103 | `search_sba_lenders` | 4840 | external read | read | call:fetch | — (read) | n/a | — | **Retire** | R |
| 104 | `ask_choices` | 7349 | read | read | — | — (read) | n/a | — | **Retire** | R |
| 105 | `search_funding_marketplace` | 4878 | external read | read | — | — (read) | n/a | scaffold — both branches return "coming soon" | **Retire** | R |

---

## 8. The ten Retire dispositions, and what "Retire" means for each

"Retire" in this map means **removed from the Spine migration lane**. Two of the ten additionally
warrant removal from the handler, and that is an **owner decision, flagged rather than taken** —
§58 requires that a removal be named explicitly and signed off, never done quietly inside another
change.

| Tool | Kind of retirement | Why |
|---|---|---|
| `web_fetch` · `web_search` · `deep_research` | **De-scope.** Stays a Chat-local primitive | Model utilities over public data. No tenant record, no domain owner, no outcome. There is nothing for a domain to declare |
| `get_current_rates` · `search_regional_lenders` · `search_sba_lenders` | **De-scope.** Stays a Chat-local primitive | Public regulator/FRED reads. Same shape as above, and funding content is opt-in per tenant (§2), so they must never become a platform-default capability |
| `ask_choices` | **De-scope.** Stays a Chat-local primitive | A conversation-shaping affordance, not an act on tenant data |
| `search_funding_marketplace` | **Remove — recommended, owner decision** | A scaffold. Both branches of `index.ts:8811` return `status: "coming_soon"`; the enabled branch is a `TODO`. It is a declared capability that can never do anything, which is the class of claim §13 exists to stop |
| `automation_set_grant` · `automation_set_state` | **Remove from the tool surface — owner decision, NOT recommended without a replacement** | Both are `owner_only`, and `index.ts:7976` refuses them flatly in Chat at any approval strength (§67's red line: PAIGE may never raise her own autonomy). They are two declared tools that are guaranteed never to execute. Removing them shrinks the baseline by two with **zero** capability loss — but it also removes PAIGE's ability to recognise the request and point the owner at Settings. The honest options are (a) remove them and handle the intent in the system prompt, or (b) keep them and mark them permanently Chat-local in the baseline. **This map does not choose** |

**The three `Keep unavailable` dispositions, for completeness:**

| Tool | Why it is unavailable rather than migratable |
|---|---|
| `delegate_to_subagent` | Dispatches work that runs as service role against the orchestrator, so whatever the specialist then does is outside the approval gate entirely. Until the sub-agent runtime is itself governed, delegating **is** the authority decision and cannot be safely fronted |
| `document_pending_reviews` · `document_resume_review` | Their producer is broken: `runGeneralDocumentExtraction` is called at `paige-ai-chat/index.ts:1212` and **defined nowhere** in `supabase/` (issue **#749**). A capability whose evidence source does not exist cannot be declared |

---

## 9. Evidence classes for this document

| Class | What was done |
|---|---|
| **Automated** | `lint:chat-tool-registry` (105/105, pass) · `lint:action-risk` (62 classified, 0 unclassified writes) · `paige-spine-registry-lint.mjs` (PASS, 1 capability) |
| **Static** | Direct source reads of `paige-ai-chat/index.ts`, `_shared/action-risk.ts`, `_shared/paige-spine/{registry,contracts,resolveEvidence,chatEvidence}.ts`, `domains/pipeline.ts`, the Context Rail migrations, and `20260711160000_paige_onboarding_tools.sql`. Every constraint in section 2 was read out of source for this map rather than carried over from another report |
| **Rendered** | none. No surface was rendered |
| **Authenticated runtime** | **none.** No product surface was driven, no provider was contacted, no production data was read or written |
| **Production** | **none** |
| **`UNVERIFIED`** | Per-tool tenant-isolation proof beyond the seam pattern in section 7 · per-tool idempotency behaviour · whether each `table:`-only write is adequately covered by RLS · every runtime claim about what an owner actually sees |

**Nothing in this document was proven in a browser or against production.** It is a plan built from
source and from the repository's own guards.

---

## 10. What this work taught — and two collision-safe handoffs

**Two Second Brain files could not be written without introducing a merge conflict into another
agent's open PR.** Both records are therefore carried here in full, each with the four-part handoff.
Neither is deferred, and neither is dropped.

### Handoff A — the two lessons, for `docs/brain/lessons-learned.md`

The two lessons below belong in `docs/brain/lessons-learned.md`. **They are not written there, because
appending to that file introduces a merge conflict with three active PRs.**

**Measured, not assumed** (`git merge-tree --write-tree`, run against each PR head on 2026-09-02):

| PR | `lessons-learned.md` vs `origin/main` today | vs this branch |
|---|---|---|
| #754 Second Brain release close | clean | **CONFLICT** — introduced by this change |
| #731 Solo Setup PARTIAL record | clean | **CONFLICT** — introduced by this change |
| #729 Spine #728 hotfix | clean | **CONFLICT** — introduced by this change |
| #648 Calendar pre-merge state | **already conflicts** | already conflicts (pre-existing, not this change) |

All four append to the same end-of-file region. `docs/brain/README.md` and
`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` were checked the same way and **conflict with nothing**, so
both carry their records normally. `docs/brain/decision-log.md` already conflicts with #751
independently of this change and is not made worse by it, so its record is written.

#### The four-part handoff (A)

- **Target file and section** — `docs/brain/lessons-learned.md`, appended at end of file, as two new
  `##` entries.
- **Owner of the follow-up** — whichever of #754, #731, #729 or #648 merges **last**. That author is
  the only one who can add these without conflicting with the other three.
- **Reason it could not be in this PR** — appending would conflict with three PRs that are clean
  against `main` today. Resolving another agent's file is out of scope for this assignment, and
  omitting the record entirely is not acceptable either — so the text is written here in full.
- **Proposed text** — exactly the two entries below, verbatim.

---

### Entry 1 (proposed for `lessons-learned.md`)

> ## "Migrate the tools into the Spine" is the wrong mental model — the contract carries events, not records
>
> **Symptom.** A plan to move PAIGE's 105 legacy Chat tools onto the governed Spine reads as a
> mechanical port: register each tool, front it with an adapter, shrink the baseline. Estimate the
> work that way and every read tool looks easy.
>
> **Root cause, read out of `_shared/paige-spine/resolveEvidence.ts` on 2026-09-02.** The evidence
> contract validates four things that together make it an **event-signal** contract:
>
> - `input.subject_type !== "client"` → rejected (`:40`). One subject type, ever.
> - `input.safe_summary !== evidence.safeSummary` → rejected (`:45`). The summary is a **constant
>   declared in the registry**, not producer text.
> - `safeFacts` rejects any fact value not present in the capability's declared `factValues`. Every
>   fact is an enumerated scalar.
> - Spine evidence loads only inside a client-scoped Chat turn (`paige-ai-chat/index.ts:1115`).
>
> So the contract can express *"an event of an enumerated kind happened to this client, with these
> enumerated scalar facts"* — and **nothing else**. Not a record, a list, a name, a title, a count, a
> status string, or any free text. **None of the 40 read tools can migrate as-is**, because they are
> record and list reads, not event signals.
>
> **Rule.** Before estimating a Spine migration for any capability, ask what SHAPE its evidence is.
> If the answer contains a name, a title, a count or a list, the capability needs a shared-primitive
> change (a Spine Change Request), not a port. A capability's disposition is decided by the shape of
> its evidence and the subject of its outcome — never by how hard its current tool looks.

### Entry 2 (proposed for `lessons-learned.md`)

> ## An audit row is not an outcome — 78% of PAIGE's writes have no Rail producer at all
>
> **Symptom.** "PAIGE records what she does" is true and misleading. Every classified action writes a
> `paige_audit_log` row, so a source read suggests the outcome leg is covered.
>
> **Root cause, counted on `main` `e3592089`.** Of the 60 classified actions PAIGE can perform from
> Chat, only **13** additionally emit a per-client Rail event — the ones in `RAIL_CRM_TOOLS` /
> `RAIL_ACTION_TOOLS` or whose `WRITE_TARGET` is `clients` (`paige-ai-chat/index.ts:11065`–`11069`,
> `:11266`). The other **47** write `paige_audit_log` and nothing else, and **`paige_audit_log` has
> no Solo reader**. The 13 that do emit are unreadable in production for a different reason:
> `authenticated` has no `SELECT` on `paige_client_events` (#746).
>
> **So Leg 7 of the platform build path — *owner can see the truthful result* — is closed for 100% of
> PAIGE's writes,** by two independent mechanisms. Neither is visible from reading one tool's code.
>
> **Rule.** "Does the owner see this?" is answered by naming the **reader**, not the writer. A durable
> row with no surface reading it is not owner visibility, and a written row the browser may not select
> is not either. When a capability claims an outcome, follow it forward to a rendered surface before
> believing it.

---

### Handoff B — the decision-log entry, for `docs/brain/decision-log.md`

**Added 2026-09-02, at final verification.** This entry WAS written into
`docs/brain/decision-log.md` and has been removed again, because the collision changed under it.

**What changed.** At first measurement, PR **#751** already conflicted with `main` on
`decision-log.md`, so appending there added nothing new and the entry was written. #751 then merged
`main` into itself (`019ab5ac`, 16:02 UTC), clearing its own conflict — and both appends now land at
the same end-of-file point, so mine had become the one **introducing** a conflict. Measured with
`git merge-tree --write-tree`: #751 vs `main` = 0 conflicts, #751 vs this head = 1, in
`docs/brain/decision-log.md`. The file is reverted to `main` and the record moved here.

**This is worth recording on its own:** a collision result is only true at the moment it is measured.
A "pre-existing, therefore safe to append" judgement expires as soon as the other PR syncs, so it
must be re-measured at final verification rather than carried forward from the first pass.

#### The four-part handoff (B)

- **Target file and section** — `docs/brain/decision-log.md`, appended at end of file, as one new
  `##` dated entry.
- **Owner of the follow-up** — whichever of **#751** or this PR merges **second**; whoever is last
  adds it without conflict.
- **Reason it could not be in this PR** — appending introduces a merge conflict with #751, which is
  clean against `main` as of 16:02 UTC today. Resolving another agent's file is out of scope for this
  assignment; omitting the record is not acceptable, so the text is here in full.
- **Proposed text** — exactly the entry below, verbatim.

---

>
> ## 2026-09-02 · PAIGE Spine Tool Migration Map — the 105 legacy Chat tools each get one disposition
>
> **Planning record only. No tool migrated, no handler edited, no registry entry added, nothing merged
> or deployed.** Grounded on `origin/main` `e35920898ec942e5e8abaf52a5daab9bb67e0820`.
>
> **Baseline re-measured, not assumed.** `lint:chat-tool-registry` → 105 inline (baseline 105, pass) ·
> `paige-spine-registry-lint.mjs` → 1 capability · `lint:action-risk` → 62 classified (32 ordinary, 28
> high, 2 owner_only, 5 exempt, 0 unclassified writes). **No delta from the prior audit** — the guard,
> the handler parse and the frozen baseline file all return 105 independently.
>
> **Reconciliation.** 62 classified but only **60** are Chat tools. The two extras are
> `marketplace_install` and `marketplace_uninstall`. **This was already on record** — the Master Project
> File's tool-confirmation entry calls them "containment tombstones with no tool definition and no
> dispatch branch". The map re-derived it independently and confirms it; it is not a new find. The same
> entry's `MUTATING_TOOLS` count of 52 has since drifted to 62 and was corrected in place.
>
> **The map** — `docs/architecture/paige-spine-tool-migration-map.md`. Every tool carries exactly one
> disposition; "no decision yet" appears nowhere. **13 Migrate · 79 Spine Change Request · 3 Keep
> unavailable · 10 Retire.** Nine sequenced waves, a CI-ratchet proposal naming four bypasses the
> existing guard does not cover, and the ten-condition `LIVE` standard.
>
> **The migration rule this establishes.** A capability's disposition is decided by two properties of
> the shipped contract, never by the shape of its current tool: **the shape of its evidence** (the
> Spine carries enumerated event signals with a constant safe summary — not records, lists, names or
> free text) and **the subject of its outcome** (the Rail is per-client at three independent layers, so
> a workspace-level act has nowhere to be recorded). A capability failing either is a Spine Change
> Request, not a port.
>
> **Three Spine Change Requests identified, all unrequested and unstarted:** SCR-1 workspace-level
> outcome projection · SCR-2 non-client subject types · SCR-3 a record/list evidence shape. Every wave
> after the foundation depends on at least one.
>
> **Wave issues:** #756 (foundation) · #757 · #755 (existing, Pipeline) · #758 · #759 · #760 · #761 ·
> #762 · #763. The PAIGE Attention Register Project does not exist yet, so they are linked from the map
> rather than added to it; that addition remains pending.
>
> **Re-grounded after #747 merged (`dcddf676`), same day.** `main` was merged into the branch and every
> guard re-run on the merged head: 105 inline · 1 capability · 62 classified, all unchanged. Three claims
> were corrected rather than left to drift — the Pipeline capability's `mindBinding` is now `PARTIAL`
> (not `UNAVAILABLE`), one cited line number shifted, and #747 stopped being a collision. Also recorded:
> `SCR-2026-09-02` is the repo's first **approved** Spine Change Request and sets the `SCR-<date>` naming
> convention; the map's `SCR-1/2/3` are shorthand for three requests that have **not** been raised.
>
> **Collision-safe handoff owed.** Two lessons from this work belong in `lessons-learned.md` and are
> **not** written there: appending introduces a merge conflict with #754, #731 and #729, all three of
> which are clean against `main` today (measured with `git merge-tree --write-tree`). The full proposed
> text, the named owner (whichever of those PRs merges last) and the reason are in section 10 of
> `docs/architecture/paige-spine-tool-migration-map.md`. `README.md` and the Master Project File were
> checked the same way, conflict with nothing, and carry their records normally.

*(End of proposed text. When it is written, add one line noting it arrived via this handoff rather
than in the map's own PR — otherwise its "carry their records normally" sentence reads as though the
decision log did too, and it did not.)*
