# Solo Functional Inventory & Certification Map (PR4)

**Program:** PAIGE Solo Completion — PR4 of the canonical-parity train.
**Grounded on:** `main` @ `9f548334` (merge of PR #1271, 2026-09-17). Read-only source trace; no runtime claim below depends on a delivery note.
**Machine-readable authority:** [`docs/delivery/solo-completion-matrix.json`](./solo-completion-matrix.json) — 85 capability rows, 22 orphan-registry entries, 12 acceptance scenarios. Counts in this doc are **derived** from that file by [`src/__tests__/solo-completion-matrix.test.ts`](../../src/__tests__/solo-completion-matrix.test.ts); nothing hand-written here is authoritative.

**Mission:** determine exactly what remains before the owner can say "the Solo product is where I want it to be" — inventorying the rendered customer-facing product, not its routing shell.

---

## 1. Method and status vocabulary

Six read-only domain sweeps (Command Center & approvals; PAIGE workspace/chat; Settings/Team/Billing; comms/integrations/CRM; campaigns/social/vibe/analytics; Mind/memory/calendar/work), each tracing **route → rendered owner UI → data source → authority/tenant scope → capability/backend seam → provider/native execution → readback → receipt/Rail evidence → failure/recovery**, cross-referenced against the Surface Binding Ledger (`docs/binding-ledger/surface-binding-ledger.json`, 30 surfaces — used as a checklist only; several of its states are stale, e.g. `settings.setup` PROOF_OWED was resolved by PR #1269, `campaigns.vibe-studio` predates the rebuild).

| State | Meaning |
|---|---|
| LIVE | owner UI → tenant-safe authority → canonical seam → real execution → readback → truthful outcome → receipt, every leg traced in source |
| PARTIAL | journey renders, at least one required leg missing, defective, or subset-scoped |
| UNAVAILABLE | no working owner journey on current main (includes honest placeholders) |
| NOT_CONNECTED | live connection seam, no completed per-tenant provider authorization |
| PROOF OWED | code exists; authenticated runtime proof owed before any completion claim |
| BLOCKED | parked behind another open workstream or an owner-recorded gate |
| NOT APPLICABLE | out of scope for Solo by owner ruling |

The words "done" and "mostly done" do not appear as verdicts anywhere in this program.

## 2. Headline counts

<!-- solo-inventory:totals total=85 LIVE=48 PARTIAL=20 UNAVAILABLE=7 NOT_CONNECTED=2 PROOF_OWED=2 BLOCKED=3 NOT_APPLICABLE=3 P0=0 P1=2 P2=10 P3=12 orphans=22 -->

**85 capabilities inventoried** across shell, Command Center, PAIGE workspace, Settings (setup/team/billing/security/vault/connections/integrations), comms/phone, CRM/sales, calendar, work/actions/approvals, Mind/memory, growth/campaigns/social/vibe/marketplace, analytics, artifacts/files, and research — plus one row for the certification capability itself.

Reading of the distribution:

- **48 LIVE** — the load-bearing product (conversation + confirm gate, governed CRM executor, action bus + approvals, business missions, calendar engine, billing reads, team, vault, comms stack, media/image lane, knowledge, evidence analytics) is built on canonical seams with receipts. These are the **DO-NOT-REBUILD** surfaces (§5).
- **20 PARTIAL** — mostly *adoption gaps on shipped seams* (improvements loop unreachable outside chat, owner-memory auto-write unwired, export control unmounted) plus a small number of real defects (§4).
- **7 UNAVAILABLE** — of which only **contacts-export** remains an adoption gap (**security-data** moved to PARTIAL by PR-C: the canonical AccountSecurityPanel is mounted, the personal-data export rides the shared seam with exact-scope labeling, and both personal-data deletion (processor not deployed — INT-070 debt) and workspace deletion are honestly labeled unavailable); the rest are honest placeholders or by-design boundaries (music, performance analytics, other lenses, public-presence provenance, live-conversation audio, Google two-way sync). The legacy contact-delete endpoint that formerly sat in this state was **retired by PR-A** (the governed `contact.hard_delete` is the one delete path) and now counts as NOT_APPLICABLE.
- **2 NOT_CONNECTED** (Zapier, social) are owner-side authorization acts, not build gaps; **3 BLOCKED** are parked behind open PRs (#917 import, #1046 secure browser) or the recorded MCP Phase C gate (#1255/#1262); **2 NOT APPLICABLE** by owner ruling.
- **2 PROOF OWED** where the code truth cannot be certified without a runtime act: Vibe video artifact readback, and the certification harness itself.

## 3. Authority & tenant-isolation audit (cross-cutting)

- **Server-derived authority is the norm.** Every consequential seam re-derives tenant from the caller JWT (`current_user_tenant_id()`, persona context, membership proofs); client-supplied `expected_tenant_id` values are cross-check/refusal-only; responses are tenant-echo-checked; scope-epoch/request fences drop late answers after a workspace switch (chat, team, vault, billing, pipeline, setup all verified).
- **The one P0 exception found was resolved by PR-A:** `crm.contact-delete-legacy` — the deployed `delete-contact` edge gated on a *global* role check with **no tenant predicate** on a cascading service-role delete. **Retired:** edge, config block, chat tombstone, and baseline entry deleted; the deploy workflow now deletes retired functions at the provider so the merge itself undeploys the endpoint. The governed `contact.hard_delete` executor is the one tenant-safe delete path.
- **Capability auto-adapt audit:** no capability keys on tenant ID, account number, customer name, creation date, or a historical per-customer flag. `isLegacyRelationshipOwner` keys on the route tab slug (legacy-address compat), not identity; `solo_beta_offer_code` is a server-verified entitlement; vault access, setup scopes, and billing exclusions are server-side entitlement/scope decisions. **No architecture defects found.**
- One flagged follow-up (P3, recorded in the matrix row): the legacy inbox's realtime subscription is unfiltered on `messages`; initial reads are RLS-scoped, but realtime-authorization config should be verified during the certification drive.

## 4. Top gaps by priority

### P0 — broken correctness / tenant isolation (0)

> All PR4 P0 findings are resolved. The former second P0 — `command-center.business-game-plan` (`MISSION_WRITE_OUTCOME_UNKNOWN` rendered as a generic failure + retry minting a fresh `request_key`, allowing a possibly-succeeded consequential write to be applied twice) — was **closed by PR-B**: distinct owner-visible reconcile state, stable request-key identity per logical intent (retry = replay of the original operation), truthful transport-vs-business failure separation.

> Resolved by PR-A: `crm.contact-delete-legacy` (the former second P0 — deployed `delete-contact` edge with a global role gate, no tenant predicate, cascading hard delete) was **retired**: edge, config block, chat tombstone, and baseline entry deleted; the governed `contact.hard_delete` executor is the one tenant-safe delete path.

### P1 — core paid-product capability incomplete/misleading (3)

> Resolved by PR-C to **PARTIAL**: `settings.security-data` (the former P1 — copy-only placeholder tab while the real panel existed unmounted) now mounts the canonical `AccountSecurityPanel` unmodified and offers the exact-scope personal-data export. Personal-data deletion is **fail-closed OFF the surface** (provider truth: the request intake is deployed but its processor is not, and nothing schedules it — offering intake as if end-to-end deletion were operational would be false); the deletion lifecycle returns only after INT-070 (secure the processor with an internal-caller gate → deploy → schedule → provider-verify → controlled end-to-end proof). Workspace deletion remains honestly unavailable (no capability exists on main).
4. **`vibe.video-generation`** — money correctness: the authorized proof consumed 90 credits for a video whose artifact copy lapsed pre-patch (truthfully reconciled to failed); the post-fix live artifact readback is owed before the flag may open. Requires owner authorization for any paid proof. → **PR-D**.
5. **`certification.authenticated-acceptance`** — the repo's own universal proof gate: no least-privilege Solo test tenant and no live-drive secret set exist. Every LIVE verdict above is source-trace truth, not an authenticated runtime proof. → **certification lane**.

### P2 (10) / P3 (12)

P2: approvals `ApprovalRow` Edit/View mis-wired to `/choose-account` (`command-center.game-plan-approvals`); Systems Check on-demand re-run (`command-center.systems-check`); Mind domain wiring (`command-center.mind`); gateway withholding (`paige.capability-gateway`); improvements surface (`paige.improvements-loop`); legacy-address inbox composer honesty (`comms.inbox-legacy`); contacts export mounting (`crm.contacts-export`); Google two-way sync (`calendar.google-two-way-sync`); PAIGE booking reschedule/cancel/reminder (`calendar.paige-booking-writes`); owner-memory auto-write (`mind.owner-memory`). P3: label/copy corrections, notes-tasks legacy panels, companies shape, live-conversation lane, marketplace details, typed ContextBundle consolidation, learning-loop apply lanes, n8n orchestration dispatch slice. Full detail: matrix rows with matching `priority`.

## 5. DO NOT REBUILD — proven-mature surfaces (adoption/proof gaps only)

The following are canonical, receipt-bearing, and verified in source; any remaining work on them is **adoption or proof**, never a parallel system:

1. **PAIGE conversation runtime** — `paige-ai-chat` (context assembly, scope fences, thread persistence, confirm gate with stored-args execution).
2. **Governed CRM command executor** — service-only `execute_crm_command` with tenant lineage, replay, destructive previews (143 pgTAP assertions).
3. **Action bus + approvals + execute-approval** — filed→drafted→approval-lane state machine; approve-AND-act with real sends.
4. **Business mission foundation** — verified mutations, idempotency, mutation receipts.
5. **Calendar capability** — preset lifecycle RPCs, native booking engine, public booking page, guest manage, link sharing (all CI-proven).
6. **Comms stack** — number search/purchase with money guards, the one `send-message` seam (pre-send pipeline, A2P gate, DLR), TrustHub registration product, Resend domains + webhook receipts.
7. **Media substrate** — `paige-media` governed ladder (estimate/hold/approve/webhook/sweeper) + append-only credit ledger.
8. **Billing reads + Stripe portal lane** — workspace authority RPCs, payment setup state-nonce, beta portal with recovery.
9. **Team workspace** — invite authority proof, delivery trail, removal refusal vocabulary.
10. **Business Vault** — access-gated RPC surface + quarantine upload/compensation.
11. **Memory seams** — governed owner-memory record/get/forget; resource-scoped `match_paige_memory` (hardened, pgTAP-proven).
12. **Analytics evidence contract** — versioned bundle with strict client validation.
13. **Knowledge bucket** — ingest/search/promote with provenance.
14. **Social Command containment** — pure-truth model; no fabricated reach numbers exist anywhere.
15. **Durable-job contract** — claimed/succeeded/failed/blocked/cancelled/expired/outcome_unknown with reconcile-never-blind-retry adopters.

## 6. Orphaned / dead surfaces → Cursor lane (23 registry entries)

Full registry in the matrix (`orphans` array). Highlights: the unmounted second chat consumer (`src/solo/agent.tsx` + `useSoloChat.ts` — drops confirm frames; drift hazard), `social-studio.tsx` (only reader of a table nothing writes), the unrouted `src/pages/admin/*` page shells (VibeStudio, StudioHome, CampaignsHub/GrowthHub, Marketplace, AnalyticsDashboard, MarketplaceOperatorAdmin, PracticeOverview/AgencyBoard, ContactsAdmin lane, BookingsAdmin + Cal.com edges), Solo fixture screens (`market.tsx`, `setup.tsx`, `team*.tsx`, `calendar*.tsx`, `healthmap.tsx`, `knowledge.tsx`, `settings-setup.tsx`), the documented-unwired `toolConfirmation.ts` predecessor, dead Twilio brand/campaign stubs, and root prototype artifacts. **Caution:** `src/components/admin/studio/` is *not* wholesale-dead — live chat code imports `loadDocument`/`DocumentPreview` (PaigeArtifactCard) and `draftPage`/`STUDIO_ERROR_COPY` (useGeneratePage) from it; only the unrouted page shells and unconsumed studio modules are deletion candidates. Entries marked `cursor-lane-pending-verification` must be checked for dynamic imports and their containment-test source-grep references updated in lockstep. The ContactsAdmin lane is plain `cursor-lane` now that PR-A retired the edge it called. The `solo_shell_enabled` dead flag remains a Cursor-lane item per the PR2 ruling.

## 7. Collisions and dependencies

- **#917** (orchestration/contacts import) owns import — Solo import stays BLOCKED until it lands or closes.
- **#1046** (Secure Browser) owns the browser-use boundary — no chat/UI entry point may precede it.
- **#1255** (chat/knowledge scope, owner-parked) + the **#1262** entry gate own MCP Phase C wiring; #1268 is only a migration-version neighbor.
- **#1268, #1267, #907, #905, #899, #921** — neighboring open PRs (MCP Phase C docs, knowledge-scope fix, pipeline/billing/design lanes): no overlap with a read-only inventory PR or with PR-A/PR-B.
- The working tree carries **foreign uncommitted Platform Operator work** (tenant-shell/operator files) owned by another workstream; it is not part of this PR and must not be committed.

## 8. Proposed Solo PR train (order)

| Order | PR | Priority | Scope (narrow) |
|---|---|---|---|
| 1 | **PR-A** — **EXECUTED (#1273)** | P0 | ~~Bound or delete the `delete-contact` edge…~~ Retired outright (Option A): edge + config block + chat tombstone + baseline entry deleted, deploy workflow deletes retired functions at the provider, governed `contact.hard_delete` proven canonical; Cursor may now remove the orphaned UI lane. |
| 2 | **PR-B** | P0 | Mission outcome-unknown truthfulness: distinct owner copy for `MISSION_WRITE_OUTCOME_UNKNOWN`; retry reuses the original `request_key` so idempotency catches the replay. |
| 3 | **PR-C** | P1 | Security & data: mount `AccountSecurityPanel` + surface the data-deletion request path (or retitle the tab honestly). |
| 4 | **PR-D** | P1 | Vibe video artifact-readback proof — one owner-authorized paid run proving artifact copy + ledger consume + receipt; flag stays OFF until it passes. |
| 5 | **PR-E** | P2 | Truth/UX corrections bundle: ApprovalRow rewire, Systems Check re-run, legacy-address inbox send honesty, Vault PROPOSED label, growth pipeline-tab label. |
| 6 | **PR-F** | P2 | Adoption bundle: improvements-proposals surface, owner-memory auto-write slice, contacts-export mounting, gateway withholding increment, Mind domain wiring. |
| 7 | **PR-G** | P2 | Calendar remainder: PAIGE reschedule/cancel/reminder verbs; Google two-way sync worker against stored tokens. |
| 8 | **PR-H** | P3 | Polish: typed ContextBundle consolidation, chat references, live-conversation lane, setup public-presence provenance, billing notices/invoice polish, companies shape, learning-loop apply lanes, notes-tasks panel migration, orchestration n8n slice, marketplace details — the full P3 set lives in the matrix rows. |
| — | **Cursor lane** | — | The orphan registry (§6), mechanical deletions with containment-test lockstep. |
| — | **Certification lane** | P1 | The acceptance matrix (§9) on a least-privilege Solo test tenant with live-drive secrets; may begin after PR-A/PR-B and absorbs every per-capability PROOF OWED item. |

## 9. Authenticated acceptance matrix (certification gate)

Executed authenticated on a real tenant before the owner may declare Solo accepted — machine copy in the matrix (`acceptance_matrix`):

| Scenario | Pass criteria |
|---|---|
| Fresh Solo account | gates resolve in order; canonical shell renders; no fixture surface |
| Established account | real rows everywhere; no fabricated states |
| Setup incomplete | redirect to setup; marker clears only on a real revision bump |
| Setup complete | marker flips in-commit; gate opens in-session |
| Connected provider | connected only after provider readback |
| Disconnected provider | truthful disconnected; honest `needs_config` degrades |
| Permitted user | governed acts succeed with readback |
| Restricted user | server refusals surface as authored copy |
| Consequential action requiring approval | stored args execute once; verified readback; rail receipt; decline cancels |
| Failed provider action | failed/blocked/outcome-unknown distinguished; credit closure correct; no silent retry |
| Account switch | late answers dropped; no cross-tenant readback |
| Degraded dependency | fail-closed honest degrades; no fabricated success |

## 10. PROOF OWED (standing register)

1. **Certification harness** — least-privilege Solo test tenant + live-drive secrets; executes §9 (blocks the "accepted" declaration, not daily truth).
2. **Vibe video** — one post-fix artifact readback run (PR-D).
3. **Per-capability runtime drives** recorded in LIVE rows: booking-preset browser drive, in-chat preset verbs, calendar-link §32.c trio, tenant browser-call drive, first production A2P filing, n8n OAuth owner consent — all absorbed by the certification lane.
4. **Security & data** — any authenticated control at all (PR-C removes or resolves this).

---

**Boundaries honored:** read-only inventory; no production migration; no broad runtime implementation; no Platform Operator or Agency work; Solo is NOT marked ACCEPTED; PR4 returns to the coordinator before any next implementation PR.
