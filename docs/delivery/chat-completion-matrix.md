# Paige Chat Completion Matrix — the owner cockpit, family by family

**What this is.** A Chat‑lens navigation + delivery artifact: for every capability family the owner
expects to reach *through Paige Chat*, it records the **actual source‑backed status on fresh `main`**,
the **canonical Harness/merged seam** it rides, the **missing work**, and the **required proof**. It is
a map over the canonical homes — the Surface Binding Ledger (`docs/binding-ledger/`), the Integration
Capability Registry (`docs/integration-registry/`), the Spine tool‑migration map + state
(`docs/architecture/paige-spine-tool-migration-map.md`, `docs/brain/paige-spine-and-rail-state.md`),
the memory contract (`docs/brain/paige-memory-contract.md`), the Secure Browser audit
(`docs/audits/paige-secure-browser-audit-2026-09-06.md`), and the 2026‑09‑12 Harness Reconciliation
(`docs/delivery/harness-upgrade-reconciliation-2026-09-12.md`). **It is NOT a new registry, Brain,
Spine, or Gateway, and NOT an owner‑approval gate.**

**Grounding.** Base fresh `main` `b0e0cf0e` (PR #1166), read by a five‑specialist read‑only crew +
integrator on 2026‑09‑12. Scope = what the owner can drive from the conversational cockpit
(`supabase/functions/paige-ai-chat/index.ts`), NOT from `paige-mcp` or the `/admin/*` React hubs (which
are separate, often richer, surfaces).

**Truth labels (strict §13/§947).** `LIVE` = wired + in the prod chat path with honest degrade AND the
governed path genuinely works. `PARTIAL` = works in one dimension, named gaps. `PROOF_OWED` = code
complete + deployed‑on‑merge but **no authenticated runtime proof** (the default for most chat
surfaces — see the universal proof gate below). `UNAVAILABLE` = not wired in the chat path (a seeded
row, an admin‑UI‑only or MCP‑only capability, or a gated‑off worker is UNAVAILABLE *in chat*, §13/§947).

## Status preamble — exact, not inferred

- **#1166 is MERGED and edge‑deployed** (`b0e0cf0e`; `deploy-edge-functions` run #281 SUCCESS; `edge-live`
  = `b0e0cf0e`, zero drift on the changed functions). It shipped: the grounded capability manifest (the
  honest "what can you do here?" block + `capability_status` tool through one shared gatherer), the
  stable approval fingerprint, execute‑once compare‑and‑set, and the non‑loop repair.
- **Its authenticated owner‑facing behavior is PROOF_OWED** until the least‑privilege Solo test tenant +
  approved `LIVE_DRIVE_*` secrets permit the proof‑lane run (below). This is true of the whole cockpit,
  not just #1166.
- **Open/draft PRs are NOT shipped dependencies.** Until a capability's real runtime path is **merged and
  verified on `main`**, Chat presents it as unavailable / setup‑required / proof‑owed / route‑only —
  never executable. In‑flight (NOT depended on, NOT waited on): #1044 (text‑chat skills + intentful
  interview), #1046 (Secure Browser owner MVP), #1162 (Social Operations Gate A), #591/#754 (knowledge),
  #921/#917 (agent registry / orchestration), #576 (chat‑runtime correctness — touches `index.ts`).
  (#1164 Social‑publishing server‑side containment has since merged — consistent with the manifest
  marking `social.publish` "not a governed action yet".)

## The universal proof gate (one owner action unblocks every PROOF_OWED row)

The authenticated‑proof machinery already exists and must not be rebuilt (§18): the proof‑lane
(`scripts/live-drive/PROOF-LANE.md`, #1163) + `live-drive.mjs` + the least‑privilege Solo test‑tenant
spec (`docs/delivery/solo-test-tenant-spec.md`). Every auth‑gated drive self‑skips honestly until **one
owner action**: provision the dedicated least‑privilege Solo test tenant + user and set the two CI
secret *names* (`LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD`). Until then authenticated‑runtime rows stay
`PROOF_OWED` by construction — not by omission. This is the #1 dependency for the whole workstream's
step‑5 proof.

---

## Family 1 — Persistent conversation & task continuity

| capability | current implementation (fresh `main`) | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Durable chat history | every turn persisted via `paige_chat_turn_append` (`index.ts:4750`, assistant `:4888`) → `paige_chat_turns`/`paige_chat_threads`, RLS `(tenant_id,user_id)` | **LIVE** | `paige_chat_turns` + RPC | auth per‑tier drive owed |
| Resume after interruption | `usePaigeThreads` reloads transcript by `seq`; rename/archive/delete | **PROOF_OWED** | `usePaigeThreads` → turns/threads | close→reopen→continue drive |
| Truthful compaction | `foldThreadSummary` (`index.ts:4646`), token‑aware, returns `"compacted"` only after the row stores | **PROOF_OWED** | `foldThreadSummary` + `token-estimate.ts` | long‑thread fold drive |
| Operating memory ("what you're carrying") | `paige_operating_memory()` composed live, no tenant arg, errors render NOTHING (honest) | **LIVE** | `paige_operating_memory()` RPC | auth drive owed |
| Durable tasking (task↔thread link) | `crm_create_task` stamps `tasks.source_thread_id` from a SERVER‑VALIDATED thread claim (caller's own thread in the resolved tenant; RLS read on the caller‑JWT client); foreign/forged/expired/absent → NULL. Rule in one home `_shared/source-thread-link.ts` (§18). **→ HARDENED in Slice 2 (2026‑09‑13)** from the prior raw‑body‑stamp §9 hole. | **PARTIAL** | `tasks` + the validated link | proven by unit + source‑assertion + SET‑ROLE RLS proof (`source_thread_link_scope.sql`, in the `database-contract` CI job); authenticated e2e chat drive §32.c OWED; deep‑link UI is §00/CD |
| Task status in chat | `action_list`/`action_get` → `list_actions` RPC | **PROOF_OWED** | `paige_actions` action bus | status‑in‑chat drive |
| Handoff (delegate) | `delegate_to_subagent` → `paige-orchestrator` (role‑gated, Rail `subagent_invoke`) | **PARTIAL** | `paige-orchestrator` | runs service‑role; downstream ungoverned; synchronous not durable |

## Family 2 — Skills & guided work

**Headline: skills are NOT wired into Paige Chat.** No skill tool in the chat tool list, no skills
family in the manifest, no `skills.*` Spine domain. `paige_skills` executes only via `paige-mcp`
`run_skill` and `/admin/skills`. The ~100 seeded rows are an **inventory** (§13/§947: seeded ≠ LIVE;
master ref grades it PARTIAL).

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Skill discovery in chat | none (no tool) | **UNAVAILABLE** (in chat) | would twin `paige-mcp list_skills`, filtered to tier + confirmed allowed path | add a governed discovery tool; model skills in `signals.ts` |
| Intentful interview / recommendation | none in chat | **UNAVAILABLE** | reuse `prompt-forge`/voyage | intent→skill recommender gated on real paths |
| Skill selection / execution / state cards / result | none in chat (LIVE only via MCP/admin) | **UNAVAILABLE** (in chat) | `skill-runner` + `skill-interpreter` (engine LIVE, not chat‑reachable; does NOT route `decideGovernedExecution`) | chat `run_skill`/`get_skill_run` twins; route through the shared seam |
| Honest unavailable/setup | honest by omission (skills not modeled) | **LIVE** (honesty holds) | resolver | model skills so unavailable/needs‑setup resolves like other families |

*Collision:* #1044 is building text‑chat skills + intentful interview — **in‑flight, not a dependency**.
Until it merges, Chat presents skills as UNAVAILABLE/route‑to‑admin.

## Family 3 — Search, public research & web browsing

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| In‑chat web search (`web_search`) | `index.ts:8768` → `paige-web-search` (Firecrawl v2), honest `configured:false` | **LIVE code / PROOF_OWED** on live results (`FIRECRAWL_API_KEY` prod presence unconfirmed) | `paige-web-search` edge fn | confirm key; one cited drive |
| Public research w/ citations (`deep_research`) | `index.ts:8797` → `paige-deep-research` (plan→search→read→cite), anti‑fabrication, persists `research_runs`/`research_sources` | **LIVE code / PROOF_OWED** on live sourcing | `paige-deep-research` | cited run + persisted rows |
| `web_fetch` model tool | **functional (PR #1227)** — routes to the hardened `fetch-url-content`, injection‑fenced (`RETRIEVED_KNOWLEDGE_UNTRUSTED_NOTICE` + `sanitizeUntrustedText`), provenance `{url,title,fetched_at,truncated}`, honest refusal/failure; all seats incl. **client** (owner ruled do‑NOT‑retire) | **LIVE (merged `1a5d8020`, edge-deployed, zero drift); operator/tenant-owner seat OWNER-PROVEN LIVE 2026-09-13** (real public URL fetched + summarized, honest follow-up, no SSRF/redirect/fake-success/injection) **/ PROOF_OWED** on the narrower client‑portal‑seat drive | `fetch-url-content` (on `_shared/ssrfGuard.ts safeFetch`) | authenticated **client‑portal‑seat** `web_fetch` live‑drive owed (§32.c/§70; operator seat discharged 2026-09-13) |
| Auto URL‑fetch on pasted link (non‑client tier) | `index.ts:1390` → `fetch-url-content` (now `safeFetch`‑guarded), https‑only, injection‑fenced | **LIVE** (non‑client) | `fetch-url-content` | SSRF caveat RESOLVED (PR #1227 migrated it onto `_shared/ssrfGuard.ts safeFetch`; the remaining #138 DNS‑rebind is the documented ssrfGuard TOCTOU residual, not the old regex gap) |
| Secure‑browser session (`browser-use`) | request boundary LIVE but **worker gated OFF** → 503 `secure_worker_under_setup`; no chat/UI entry point | **UNAVAILABLE** | `_shared/secure-browser-authority.ts` | clear vendor gates, wire worker, add entry point (#1046 in‑flight) |
| `browse_public_url` skill | full chain wired; gated by `PAIGE_BROWSER_WILDCARD_ENABLED`; reachable only via `run_skill`, not the chat loop | **PARTIAL/PROOF_OWED** | interpreter → `skill-runner` → `paige-browser` → `paige_browser_usage` | verify flag prod value; expose in chat; §32.c drive |
| Read‑only egress fence | `_shared/ssrfGuard.ts` + worker fence, exercised against real Chromium in CI | **LIVE (CI‑proven)** | ssrfGuard + `paige-browser/ssrf-guard.mjs` | `fetch-url-content` migrated onto it (PR #1227, + a `smoke:web-fetch-hardening` CI gate); `kb-ingest-url` migrated onto it (PR #1241, squash `127e2de7`, edge-live=`127e2de7` zero drift; + a `smoke:kb-ingest-url-ssrf` CI gate) |

*Doc gap (§66):* the tier‑matrix carries no Surface‑ledger row for this family.

## Family 4 — Sandboxed execution & artifacts

**Headline: there is NO sandboxed code/analysis execution — a DECISION/PLAN only**
(`outputs/paige-at-cowork/08-sandboxed-research-external-execution.md`). The shipped slice is document
generation → real artifact.

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Sandboxed code/analysis task (plan/status/files/cancel) | does not exist | **UNAVAILABLE** (plan only) | planned S‑R3 cloud service | build + prove isolation invariants |
| Create a document in chat (`document_generate`) | `index.ts:10935` — 8 types, refuses `[PLACEHOLDER]`, gates success on a real `content_id` | **LIVE** | `save_marketing_content` → `marketing_content` | auth drive owed |
| Export → `md` | `export-document` → `doc-render` md serializer (pure, headless‑tested) + 30‑day signed URL | **PARTIAL** (serializer proven; download drive owed) | `export-document` → `studio-deliverables` | live download drive |
| Export → `pdf`/`docx`/`pptx` | renderers exist, each fail‑closed `needs_config`; never runtime‑driven on Deno | **PROOF_OWED** | same | post‑deploy render proof |
| Export → `xlsx` / native Google | not offered / no Google Docs client | **UNAVAILABLE** | — | new renderer / Drive OAuth scope |
| Artifact download control in chat | `download_url` is **model‑narrated text only**; no clickable card affordance | **UNAVAILABLE** (gap; CD per §00) | extend `PaigeArtifactCard` | add a download affordance |
| Artifact receipt (Rail) | `export-document` calls `record_capability_run` | **PARTIAL/PROOF_OWED** | `record_capability_run` | 0 prod rows — a real receipt |
| Cancellation of a task | none | **UNAVAILABLE** | — | bound to durable‑job states |

## Family 5 — Knowledge & Second Brain

*(Disambiguation: `docs/brain/` = the CC/dev index; the PRODUCT Second Brain = tenant‑scoped
`tenant_knowledge_docs`/`_chunks`, voyage‑3@1024.)*

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Retrieve tenant‑private knowledge in chat | `match_tenant_knowledge` over caller JWT, scope re‑confirmed fail‑closed, injection‑fenced | **LIVE** (auth e2e PROOF_OWED) | `tenant_knowledge_*` + RPC | cross‑tenant negative drive |
| Retrieve platform canon + RAG | `knowledge_base` (keyword‑only) + `match_rag_documents`, fenced | **LIVE** | `knowledge_base`/`rag_documents` | global canon has no embeddings |
| Cross‑session memory | client + operating memory LIVE per‑thread; durable cross‑chat `paige_owner_memory` schema exists but **unwired** (slice 4b) | **PARTIAL** | `client_memory`/`paige_operating_memory`; owner‑memory unwired | wire owner‑memory writer/reader |
| Explain provenance / freshness | web‑dossier + FRED carry citations/freshness; **tenant Second Brain carries NONE** (`match_tenant_knowledge` returns no source/date) | **PARTIAL** (dossier LIVE; tenant‑KB **UNAVAILABLE**) | `paige-deep-research` dossier; no seam on `match_tenant_knowledge` | **⚠ clearest uncited‑assertion risk** — thread source/date through retrieval + a citation affordance |
| Distinguish fact vs inference | honest‑degrade + "record wins over recollection" LIVE; no retrieval‑time label | **PARTIAL** | prompt rules + operating‑memory split | retrieval‑time grounded‑vs‑inferred label |
| Save to KB from chat (`save_to_knowledge_base`) | `index.ts:11850` → `kb-ingest-doc`; §15 confirm‑gated; §13 deletes the orphan doc if zero chunks embed | **LIVE** | `kb-ingest-core` (`ingestDoc`) | auth drive + embedder‑down case |
| Organize knowledge (edit/retag/delete from chat) | none in chat; UI has create/tag/delete/share but **no edit path anywhere** | **UNAVAILABLE** (chat; §10 gap) | `tenant_knowledge_docs` | a chat‑callable organize seam |
| One embedding space (voyage‑3@1024) | `_shared/voyage.ts`, no rival embedder on the knowledge path | **LIVE** | voyage | — |

## Family 6 — Agent & workflow control

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Plan (plans/milestones/tasks/reminders) | `plan_*` tools → SECURITY DEFINER RPCs, reminders fired by cron | **LIVE** | `plan_*` + action bus | — |
| Delegate a specialist | `delegate_to_subagent` → `paige-orchestrator` (role‑gated, classified `high` → approval card; soft+local) | **LIVE** (soft+local) · `langgraph` **UNAVAILABLE** (503) | `paige-orchestrator` + `subagent_invoke` receipt | downstream runs service‑role, not re‑governed |
| No inherited authority | soft agents structurally tool‑less; local runs service‑role (governed by its own surface) | **PARTIAL** | `decideGovernedExecution` (not adopted by orchestrator) | route local execution through the shared seam |
| Forge / register a specialist | `forge_subagent` → `subagent-forge` propose (soft auto‑joins; hard→approval) | **LIVE** (propose) | `subagent-forge` | `approve_subagent_proposal` not in chat (MCP/admin only) |
| Monitor running work | `action_list`/`action_get`, `get_client_rail` | **PARTIAL** | action bus + Rail | no subagent/skill‑run monitor in chat |
| Pause / retry / cancel a run | **none in chat** | **UNAVAILABLE** | durable‑job contract | make subagent/skill runs durable jobs; governed chat controls |
| Approve | fingerprint‑bound confirm loop (`paige_pending_confirmations`) + action‑bus `paige_pending_approvals` | **LIVE** | confirm loop + action bus | no chat path to approve a *queued specialist proposal* |

## Family 7 — Universal governed action surface (the substrate everything mounts on)

| capability | current implementation | truth | canonical seam | missing work / proof |
|---|---|---|---|---|
| Truthful "what can you do here?" | per‑turn manifest block + `capability_status` via one gatherer (#1166); models CRM/Connections/Pipeline/Comms/Social/Team/Campaigns/n8n | **PARTIAL** | `paige-capability-status` resolver/signals/render | **under‑claims** — omits research, document‑creation, save‑to‑knowledge, planning, **delegation/agent‑team** (all genuinely governed in chat); maturities all PARTIAL; CRM hardcoded‑LIVE (documented) |
| Capability Gateway (admissibility) | `decideGatewayEntry` maps availability→disposition; emits only 2 read tool‑defs | **PARTIAL** | `paige-capability-gateway/gateway.ts` | availability‑gated emission for the ~51 mutating tools NOT wired (deferred §51/§58) |
| The 8 dispositions | executable/draft/approval‑card/setup/connection/unavailable modeled; **"proof owed" + "no applicable capability" are NOT first‑class** | **PARTIAL** | resolver enum | add the two missing dispositions |
| Stable stored approval identity | `confirmFingerprint` + `paige_pending_confirmations` (#1166) | **LIVE** | confirm‑fingerprint | batch‑approve auth drive |
| "Approved—run it" binds once / executes once / no loop | channel‑1 card fingerprints + `claimConfirmation` compare‑and‑set + non‑loop repair (#1166) | **LIVE** | `paige_pending_confirmations` | double‑submit auth drive |
| Reads back before success | per‑tool Rail mirror on genuine success; **no universal post‑write read‑back** | **PARTIAL** | `record_rail_event`/`record_capability_run` | per‑capability readback wiring |
| Governed execution seam convergence | `decideGovernedExecution` exists, door‑blind, but **chat uses a parallel inline gate**; the seam has **7 callers** (`crm-command` directly, plus write‑back, social, skill‑runner, MCP, native‑event‑dispatch, execute‑approval via adapters) — *corrected 2026‑09‑23, this row previously said "adopted only by the MCP adapter"* | **PARTIAL** | `_shared/paige-spine/governedExecution.ts` | **scoped — see `governance-seam-convergence-plan.md`** (one chokepoint at `paige-ai-chat/index.ts:8295`; chat already delegates its 33 CRM tools to the seam at `:8336`) |
| Rail / receipt evidence | chat emits Rail/`record_capability_run` per tool | **PROOF_OWED** | Rail/receipt contract | 0 prod rows — a real action→Rail‑row drive |

---

## Cross‑cutting findings (§13)

1. **The capability manifest under‑claims.** `buildCapabilitySignals` models 8 families but omits several
   genuinely‑governed chat capabilities — **research, document‑creation, save‑to‑knowledge, planning, and
   delegation/agent‑team** — so "what can you do here?" stays silent about real capabilities. Honest‑by‑
   omission for skills (none in chat), but an **under‑claim** for the rest. *(This is the first slice.)*
   **→ RESOLVED in this PR (Slice 1).** All five are modeled now (research gated on the real
   `FIRECRAWL_API_KEY` signal; the four governed writes on their real lanes); skills‑in‑chat +
   secure‑browser are honest UNAVAILABLE; the two missing dispositions (`proof_owed`,
   `no_applicable_capability`) are first‑class; and the dropped `integrations.n8n_run_workflow` signal
   was re‑added. The grounding analysis above is retained as the snapshot that motivated the slice.
2. **`decideGovernedExecution` is not the chat runtime path** — chat runs a parallel inline gate.
   "One pathway, whichever door" is unrealized for chat.
   **→ SCOPED (2026‑09‑23):** `docs/delivery/governance-seam-convergence-plan.md` carries the plan —
   the chokepoint, the divergence table ranked by migration risk, a parity phase before any
   behaviour moves, and the three decisions that are not a lane's to make. **§13 correction:** this
   finding previously said the seam "is adopted only by the MCP adapter." It has **seven** callers;
   chat itself already routes its 33 CRM tools through it (`paige-ai-chat/index.ts:8336` →
   `crm-command/index.ts:342`). The convergence is finishing a started job, not beginning one.
   *Recorded rather than silently corrected, per §58.*
3. **The Gateway governs only 2 reads** — the ~51 mutating tools' admissibility is still inline.
4. **Uncited‑knowledge risk** — retrieved tenant knowledge reaches the owner with no source/date; the RAG
   rule weaves it as uncited natural assertion. Fabrication is fenced; attribution is not.
5. **Dead tool — RESOLVED (PR #1227):** `web_fetch` is now functional (hardened routing to `fetch-url-content`, injection‑fenced, client‑seat enabled); authenticated client‑seat live‑drive still PROOF_OWED.
6. **Chat is the thinnest of three surfaces** — skills execution and run‑monitor/cancel/approve‑proposal
   exist on MCP + admin UI but not in the cockpit.

## Delivery plan — dependency order, Gate A, Chat‑owned, merged‑seam only

Each slice mounts on the ONE shared governed Harness path; none depends on an open PR; each is proven by
headless tests now and an authenticated drive when the test tenant lands.

1. **Truthful capability discovery (foundation, family 7) — ✅ DELIVERED (this PR, Slice 1).** Extended the
   manifest to cover every genuinely‑governed chat capability it omitted (research, document‑creation,
   save‑to‑knowledge, planning, delegation/agent‑team), each grounded in its real merged seam; marked the
   unwired/gated ones (skills‑in‑chat, secure‑browser) honest UNAVAILABLE; added the two missing first‑class
   dispositions (`proof_owed`, `no_applicable_capability`); re‑added the dropped `integrations.n8n_run_workflow`
   signal. Pure core + gatherer wiring, decision core unchanged (§18). 67/67 capability+fingerprint tests
   green; research‑key honesty verified against the real tools. Authenticated owner‑drive still OWED (row 6).
   *(Continues #1166.)*
2. **Persistent tasks/history:** wire a chat tool to set `tasks.source_thread_id` and a truthful
   task‑status/resume readback (the durable‑tasking gap).
3. **Research/browser presentation:** ~~retire or route the inert `web_fetch`~~ ✅ DONE (PR #1227 — routed + hardened + client‑enabled, authenticated drive PROOF_OWED); remaining: surface `web_search`/
   `deep_research` state + citations truthfully (provider‑config‑honest); route‑only to Secure Browser
   until its worker merges.
4. **Knowledge presentation:** thread source/date into tenant‑KB retrieval + a citation affordance
   (close the uncited‑assertion risk); a chat‑callable organize seam (§10).
5. **Agent‑control surfaces:** chat monitor + governed pause/retry/cancel bound to durable‑job states;
   a chat path to approve a queued specialist proposal.
6. **Authenticated proof (cross‑cutting):** once the owner provisions the Solo test tenant + `LIVE_DRIVE_*`,
   run the proof‑lane across every PROOF_OWED row.

Skills execution in chat (family 2) and Secure Browser (family 3) wait on their in‑flight backend PRs
(#1044, #1046) merging and verifying on `main` — until then Chat presents them route‑only/unavailable.
