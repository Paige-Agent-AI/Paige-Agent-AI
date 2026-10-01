# Paige Agent AI — Consolidated Platform Audit

**Prepared:** 2026-07-20 by Cowork (session with Antonio) · **Current-main reconciliation:** 2026-09-12 by Codex. **Purpose:** one living rollup of current merged-main health plus clearly historical point-in-time audits. Historical findings are leads, never current truth without fresh corroboration.

> **This is a LIVING doc.** Section 1 is the pinned current-main health record. The source audits remain immutable point-in-time evidence for their lanes, but never override a freshly grounded current-main or production proof.

---

## 0. What this doc is (and isn't)

**Is:** a normalized view of what merged `main` proves, what is partial, and what still needs runtime or production proof. The newest pinned reconciliation below is current; later dated sections are historical context unless revalidated.

**Isn't:** a deletion or rewrite of prior audits. They remain historical evidence for their respective lanes and must be revalidated before reuse:

- `docs/paige-master-implementation-order.md` — the properly ordered master plan (spine → phases 1–10)
- `docs/assessments/PLATFORM_ASSESSMENT_2026-07-13.md` — the deep state-of-the-platform assessment (500+ lines, still ~85% valid — see §2 for what's changed since)
- `docs/assessments/DRIFT_AUDIT_2026-07-14.md` — the live-vs-repo drift audit (~55% valid — see §2 for critical items already remediated)
- `docs/security/PLATFORM_SEPARATION_AUDIT_2026-07-02.md` — the §9 platform-vs-tenant audit
- `docs/security/AUDIT_213c_RETRO_2026_07_03.md` — migration hygiene retro
- `docs/security/MIGRATION_B0_ROW_CLASSIFICATION_AUDIT.md` — data classification audit

**Discipline going forward:** preserve each pinned reconciliation as an immutable point-in-time snapshot. When a finding is repaired, append a new exact-SHA entry naming the change and the proof that closed it; never silently rewrite this snapshot. Do not promote a local branch, PR, workflow definition, historical audit, or source-only control to shipped/deployed truth. Keep proposed remediation separate until it merges, and deployment truth separate until the exact runtime is verified.

---

## 1. Current-main Platform Health & Security reconciliation — 2026-09-12

### Grounding and limits

- **Canonical repository:** `https://github.com/mrmogulmaker-bot/Paige-Agent-AI.git`.
- **Pinned merged `main`:** `9cac02d66ab068a7cff6a032bca267c9a928a3c6` (`2026-09-12T20:20:45-04:00`), “fix(fal): fetchResult tries the documented /response form first…”.
- **Audit timestamp:** `2026-09-12T20:23:44.2006964-04:00` (`America/New_York`). `main` advanced twice during the audit; the reconciliation was re-grounded on merged #1175 and then this one-file Vibe provider-readback fix. Earlier SHA/status snapshots were discarded.
- **Truth boundary:** only artifacts reachable from that commit establish current platform health. Open PRs/issues establish ownership or proof debt only.
- **CI/deploy artifacts:** exact-SHA CI run `34727731126` was `in_progress` at the last read. Exact-SHA UI Evidence `34727731188`, Security Audit `34727731290`, and Edge deployment `34727731169` succeeded. Prior-SHA CI runs were superseded/cancelled as `main` advanced. A workflow/run proves only the work and assertions it executed, not branch protection or full production inventory/readback.
- **Unavailable evidence:** no secrets, credentials, production database catalogue, deployed Edge inventory, authenticated tenant, provider account, or customer data were accessed. Production reachability/parity and authenticated behavior are therefore `UNVERIFIED` or `PROOF OWED`.
- **Local evidence:** `npm run lint:mcp-governed-door` and approval-gate lint passed; `lint:views` and `lint:chat-tool-registry` exposed the recorded gaps. Governed-execution lint could not start because this isolated worktree has no dependency tree; that is an environment limit, not a platform failure.

### Current platform health — merged `main` only

| Area | Truth label | Current state | Owner / collision |
| --- | --- | --- | --- |
| Runtime Harness | `PARTIAL` | Gateway/status, governed execution, receipts, events, proof and budget primitives exist; native events still record `acts_executed:false`. | Harness; PR #1173 owns Layer C. |
| Main Paige Chat | `PARTIAL` | Honest contact outcome/status and Capability Portfolio doctrine are merged; five tools remain hand-wired outside the registry contract; authenticated proof is owed. | Chat/Capability Portfolio; #1175 is merged direction, not runtime completion. |
| Tenant isolation | `PARTIAL` | Strong server-resolved patterns coexist with public/caller-selected identity and service-role seams below. Production RLS parity is unverified. | Platform Security; Conversations owns view/triage. |
| Migrations | `PROOF OWED` | Social replay bridge is merged; this exact SHA was not replayed from empty here and production-catalog parity was unavailable. | Database/Social; #1161 owns final schema reconciliation. |
| Providers / URL transport | `PARTIAL` | Canonical bounded `safeFetch` exists; URL ingestion and legacy automation bypass it. | Provider Gateway/Platform Security. |
| Billing / spend | `PARTIAL` | Vibe media credits fail closed; general model routing proceeds when budget accrual is unknown. Broader billing is in PR #899. | Shared Budget/Billing; no second ledger. |
| Events / automation | `PARTIAL` | Durable delivery exists; governed act execution is not on `main`; legacy direct webhook paths remain. | Harness Layer C; PR #1173. |
| Social | `PARTIAL` | Publication is server-contained and honestly unavailable; schema/runtime proof remains open. | Social; #1154/#1161. |
| Vibe | `PARTIAL` | Media credits are merged. A controlled provider generation succeeded; `fetchResult` now tries fal's `/response` form and its exact-SHA Edge deployment succeeded. Post-fix artifact readback remains proof owed. | Vibe/Media Provider. |
| Rail / receipts | `PARTIAL` | Canonical primitives exist and newer capabilities use them; universal adoption/reconciliation/owner proof is incomplete. | Harness evidence; PR #776 owns resolver work. |
| Tests / CI | `PARTIAL` | Two exact-SHA workflows succeeded; core CI remained in progress; local structural lints found live defects. | Platform CI; #1165 owns proof-vocabulary crosswalk. |
| Deployment | `PARTIAL` | Exact-SHA Edge deploy run `34727731169` succeeded for the latest change; deployed function inventory, database parity and post-deploy behavior/readback remain unavailable. | Release Operations. |
| Documentation | `PARTIAL` | Capability Portfolio routing is merged and this audit's stale opening is corrected locally; owning records still carry different grounding SHAs and must not be rounded up. | Second Brain/Harness Registry Steward. |

### Current-main findings

Each finding records exact source evidence, reachable boundary, current ownership, next proof, and the reusable control.

#### PH-SEC-01 — Public unsubscribe selects identity (`VERIFIED`, High)

- **Evidence / boundary:** `supabase/config.toml:230-231` sets `handle-unsubscribe` to `verify_jwt=false`; `handle-unsubscribe/index.ts:18,42-54,72-76` accepts `user_id` or resolves caller-supplied email/phone, uses admin/service-role authority, and upserts that user's preferences. Public request → identity/preferences write; deployed presence is `UNVERIFIED`.
- **Status / owner / collision:** safely repairable by Platform Security; no concrete PR owns this file.
- **Smallest next step / proof:** require authenticated server-resolved subject or signed, expiring, single-purpose authority; validate method/body and database errors. Prove forged user/email/phone denial and exact deployed readback.
- **Lesson/control:** public identity-changing endpoints require signed, expiring, purpose-bound authority; caller-supplied identity is never authority.

#### PH-SEC-02 — Legacy automation accepts caller authority and directly sends (`VERIFIED`, High)

- **Evidence / boundary:** `dispatch-stage-automation/index.ts:32-35,75-79,105-121,147-150` accepts tenant/contact/webhook target, reads with service role, posts directly, and attributes to the body tenant. `fire-outbound-webhooks/index.ts:18-31,47,67-74,86-94` accepts event data, reads active configurations globally, posts directly, and persists the target URL, full caller-supplied request payload, and up to 2,000 characters of provider response alongside its summary. Function caller → cross-tenant lookup/external action and durable log-storage boundary; deployed reachability is `UNVERIFIED`.
- **Status / owner / collision:** repair/retire under Harness Layer C. PR #1173 does not touch these files but owns the replacement event-to-act seam; do not fork its engine.
- **Smallest next step / proof:** require purpose-bound internal authority, server-claimed tenant/actor/target, canonical `safeFetch`, and payload/response minimization or redaction; then retire direct dispatch as Layer C adopts the events. Prove forged-tenant denial, replay/idempotency, redirect denial, readback/receipt/Rail, and that stored logs exclude raw sensitive request/provider payloads.
- **Lesson/control:** service-role functions derive tenant, actor, target, and authority server-side; an ordinary JWT is not internal-service authority.

#### PH-SEC-03 — URL ingestion bypasses canonical SSRF transport (`VERIFIED`, High)

- **Evidence / boundary:** `fetch-url-content/index.ts:57-97,118-133` uses hostname patterns, native redirect-following `fetch`, and full-body buffering before truncation. `_shared/ssrfGuard.ts:172-181,217-237` already provides DNS/IP validation, manual redirects, timeout and bounds. Authenticated URL → server network/memory; no live exploit was run.
- **Status / owner / collision:** safely repairable by Platform Security/Provider Gateway; no active PR touches the file.
- **Smallest next step / proof:** migrate to `safeFetch`; test redirect chains, IPv4/IPv6/DNS rebinding, credentialed URLs, timeout and size, then obtain deployed negative proof.
- **Lesson/control:** URL ingestion uses the canonical bounded SSRF transport, including redirect and response-size controls.

#### PH-SEC-04 — Tenant view does not preserve caller RLS semantics (`VERIFIED`; production exposure `UNVERIFIED`, High)

- **Evidence / boundary:** `20270115000000_conversation_labels.sql:102-111` creates `paige_unclassified_inbound` without `security_invoker`; `lint:views` fails. `paige-inbox-triage/index.ts:85` consumes it with service role. Tenant messages → view/triage; deployed SELECT grants are unavailable.
- **Status / owner / collision:** actively owned by Conversations issue #1140; no parallel inbox system.
- **Smallest next step / proof:** make it security-invoker or expose a server-resolved scoped RPC, revoke unintended grants, test two tenants, and inspect deployed view/grants/policies.
- **Lesson/control:** a view over tenant rows must preserve caller RLS deliberately; base-table RLS is not view-isolation proof.

#### PH-SEC-05 — Inbox triage hard-codes autonomous filing (`VERIFIED`; runtime `UNVERIFIED`, High)

- **Evidence / boundary:** `paige-inbox-triage/index.ts:78-81,139,143-161` hard-codes `defaultLane = "auto"`, applies labels as auto, and invokes `file_action`. Inbound customer content → durable labels/actions; cron/deploy reachability is unavailable.
- **Status / owner / collision:** Conversations/Harness; issue #1140 and PR #1173 bound the shared triage/act seams.
- **Smallest next step / proof:** fail closed unless current server-resolved Trust Compass authority permits the stable action; bind idempotency, approval and receipt. Prove off/confirm/auto, replay, cancel and scheduled deployment.
- **Lesson/control:** a catalogue default or code constant is not owner authority; resolve the governed lane at execution time.

#### PH-SEC-06 — Generic inbound webhook has global provisioning authority (`VERIFIED` source; deployed `UNVERIFIED`, High)

- **Evidence / boundary:** `handle-inbound-webhook/index.ts` combines a platform API-key lookup, service-role access, admin user creation and client updates without a tenant/action-bound callback contract. Global-key bearer → identity provisioning/customer mutation. No value or invocation was accessed.
- **Status / owner / collision:** owner decides retire versus redesign under Platform Security/Connections; no PR owns the file.
- **Smallest next step / proof:** inventory legitimate callers without exposing secrets; if retained, bind tenant, purpose, expiry, replay/idempotency and allowed fields, then prove cross-tenant provisioning denial.
- **Lesson/control:** global credentials do not confer arbitrary tenant or identity authority; callbacks are tenant-, purpose- and action-bound.

#### PH-SEC-07 — General model budget accrual fails open (`VERIFIED`, High cost risk)

- **Evidence / boundary:** `_shared/router-budget/mod.ts:30,170`, `_shared/claude.ts:577-578`, and `_shared/model-router.ts:203,215-216,885-895` explicitly proceed ungated when accrual is unknown; media budgeting separately fails closed. Tenant/model invocation → possible provider spend; incidents/provider reachability are untested.
- **Status / owner / collision:** owner policy decision in shared Budget/Billing; reuse the ledger/reservation model.
- **Smallest next step / proof:** define paid/consequential classes that fail closed on unknown accrual; enforce centrally and test outage, stale ledger, concurrency and usage/receipt reconciliation.
- **Lesson/control:** an observable warning is not enforcement; unknown spend authority fails closed unless the owner explicitly accepts otherwise.

#### PH-SEC-08 — Browser persists invitation bearer (`VERIFIED`, Medium)

- **Evidence / boundary:** `src/pages/JoinWorkspace.tsx:112-115` writes `paige_pending_invite` to `localStorage`; `src/lib/auth/resolveLandingRoute.ts:318-330` reads and clears it; `src/pages/Auth.tsx:404,491,508` clears it on terminal/non-invite paths. Origin script/XSS → invitation bearer/membership attempt; the clear paths mitigate lifetime but do not remove script-readable persistence.
- **Status / owner / collision:** safely hardenable under Auth/Invites after all resume-flow consumers are inventoried.
- **Smallest next step / proof:** use short-lived server-bound continuation or one-time exchange; test refresh, abandonment, expiry, reuse, wrong account and storage absence.
- **Lesson/control:** secret/bearer continuation material is not durable in script-readable browser storage.

#### PH-SEC-09 — SECURITY DEFINER feature read accepts arbitrary tenant (`VERIFIED`, Medium)

- **Evidence / boundary:** `20260701144912_324f9be7-bac9-4eee-b1cb-724cb74d451d.sql:59-73` grants authenticated callers `tenant_feature_enabled(_tenant_id,...)` with no in-body membership check. Authenticated caller → another tenant's configuration booleans; no customer rows/action are directly exposed.
- **Status / owner / collision:** safely repairable under Tenant Platform after generated-type/consumer inventory.
- **Smallest next step / proof:** validate membership in-body or replace browser access with scoped invoker read; test forged tenant/operator cases and deployed grants.
- **Lesson/control:** even low-sensitivity SECURITY DEFINER reads validate scope in-body; tenant parameters are not authorization.

#### PH-TRUTH-10 — Capability declarations exceed registry adoption (`PARTIAL`)

- **Evidence / boundary:** `lint:chat-tool-registry` reports `improvement_propose`, `improvement_list`, `improvement_decide`, `inbox_list`, and `integrations_list`; declarations/handlers remain inline at `paige-ai-chat/index.ts:5995-6075,11307-11383`. Chat declaration → handler → owner claim.
- **Status / owner / collision:** migrate under Chat/Capability Portfolio. Merged #1175 supplies routing doctrine but does not change these runtime lines.
- **Smallest next step / proof:** migrate one family at a time into the existing Gateway truth model; prove declared/executable/proven/owner-visible states, denial/setup/approval, readback and receipts through the existing proof lane.
- **Lesson/control:** a capability is not live until governed execution, readback, receipt/Rail and authenticated owner-visible proof agree.

#### PH-DB-11 — Replay and production catalogue are separate obligations (`PROOF OWED`)

- **Evidence / boundary:** the Social compatibility bridge is merged, both historical `paige_social_posts` lineages remain, and #1161 owns final reconciliation. No empty reset or production catalogue/apply read was available. Migration order/schema → tenant isolation/function compatibility/deployability.
- **Status / owner / collision:** Database/Social active work; old issues do not prove current breakage and merged SQL does not prove production parity.
- **Smallest next step / proof:** run exact-SHA from-zero replay; separately compare production migration history, columns, grants/policies and generated types; reconcile Social without fabricating ownership.
- **Lesson/control:** fresh replay truth and production-catalog truth are distinct; neither a migration nor unrelated green workflow proves both.

#### PH-EVIDENCE-12 — Authenticated/deployed proof is incomplete (`PROOF OWED`)

- **Evidence / boundary:** `scripts/live-drive/PROOF-LANE.md` and `docs/evidence/proof-lane/README.md` define seven flows, all proof owed pending a least-privilege tenant/approved secret path. Repository claim → real tenant/action/provider behavior.
- **Status / owner / collision:** preserve Harness Layer G; #1165 owns vocabulary crosswalk, not a second proof system.
- **Smallest next step / proof:** run the existing lane with exact build identity; add Edge/database inventory and negative tenant/provider/readback assertions; store no raw credentials/payloads.
- **Lesson/control:** a green workflow definition, structural test or source scan is not proof of a required gate or deployed behavior.

#### PH-OPS-13 — Tracked environment file is an unowned credential-history concern (`UNVERIFIED`)

- **Evidence / boundary:** `git ls-files --stage -- .env` confirms `.env` is tracked. Contents were deliberately not opened. Repository/history reader → potential secret material; actual secret presence, validity and exposure are unknown.
- **Status / owner / collision:** no confirmed owner record was found for this exact tracked-file seam. Do not associate it with a private issue, print values, rotate credentials, or rewrite history without owner authority.
- **Smallest next step / proof:** authorized scanner reports metadata only; owner decides rotation/history response only for confirmed live credentials.
- **Lesson/control:** record exposure metadata, never values; discovery does not authorize rotation or history rewriting.

#### PH-FIXED-14 — Historical MCP bypass warning is stale (`VERIFIED`, already fixed)

- **Evidence / boundary:** current `npm run lint:mcp-governed-door` reports “119 registered tools, 119 governed, one door, no bypass.” MCP declaration → governed adapter.
- **Status / owner / collision:** preserve the adapter/lint; no repair from the historical warning.
- **Smallest next step / proof:** keep the lint required and add representative deployed authenticated proof; investigate only a newly reproduced bypass.
- **Lesson/control:** historical findings are hypotheses until re-grounded; retire a warning when current source/enforcement disproves it.

#### PH-OPS-15 — Required UI evidence gate is an owner ruling, not verified enforcement (`PROOF OWED`)

- **Evidence / boundary:** merged #1175 records the exact required context `ui-delivery-evidence / Validate UI delivery evidence`, but also records a `403` on branch-protection readback and says the setting is not yet in force. Pull request → merge authority; the workflow file/run alone cannot block a merge.
- **Status / owner / collision:** awaiting repository-owner action under Release Operations; no code or workflow duplicate is needed.
- **Smallest next step / proof:** configure that exact context in `main` branch protection and read it back from the required-check list; then exercise a conforming and nonconforming UI PR.
- **Lesson/control:** a green workflow definition or run is not proof that a required merge gate is enforced.

#### PH-REG-16 — Two provider families lack canonical registry entries (`VERIFIED`)

- **Evidence / boundary:** merged `docs/doctrine/paige-capability-portfolio.md` records Upload-Post and fal.ai as provider-facing families with no Integration Capability Registry entry; `integration-capability-registry.json` assigns the Registry Steward to Harness but does not add them. Latest `main` `9cac02d6` changes the fal adapter without closing that entry debt. Provider name/config → connection/capability truth.
- **Status / owner / collision:** safely recordable by the Harness Registry Steward with the Social/Vibe domain owners; this does not authorize connection or provider execution.
- **Smallest next step / proof:** add canonical entries with code anchors, owner, connection/capability/autonomy truth and limitations; extend existing registry lint to validate anchors. Prove lint failure on missing/drifted anchors.
- **Lesson/control:** provider-facing code and documentation update the one Integration Capability Registry in the same change; listed never means connected or authorized.

#### PH-SEC-17 — Private credential-access remediation remains a separate owner packet (`UNVERIFIED`)

- **Evidence / boundary:** public issue #788 states only that a private in-tenant credential-access control is under review, row-level scoping held, and automatic rotation is prohibited because it could disconnect tenant operations. It explicitly withholds the affected seam and does not establish anonymous, public, cross-tenant, plaintext, `.env`, or repository-history exposure.
- **Status / owner / collision:** Connections/Security owns the private packet; audit agents must not infer its hidden implementation or merge it with PH-OPS-13.
- **Smallest next step / proof:** repository owner supplies the private handoff to an authorized repairer; any rotation, containment and verification sequence remains an owner decision. Public closeout reveals no secret or sensitive reproduction detail.
- **Lesson/control:** separate disclosed metadata from withheld security facts; a private credential finding never authorizes guessed scope or automatic rotation.

### Routed findings after the pinned reconciliation

#### PH-EVIDENCE-18 — Paige scroll-stability drive dies before its interaction (`VERIFIED` locally; Platform Health)

- **Evidence / boundary:** on branch head `6303012b0cf552540f68fc5d4ce775011966d922`, `node scripts/live-drive/paige-scroll-stability-react-drive.mjs` timed out after 30 seconds at `openTenant` line 112 while waiting for at least 40 hydrated transcript message nodes. The run reached 0/1 checks and never exercised the chat timeout interaction. Evidence harness → every lane relying on this rendered-flow signal.
- **Status / owner / collision:** routed to Platform Health under its trunk-signal trustworthiness charge. The Long-Form lane records the failure and does not repair the shared harness under park-and-route.
- **Smallest next step / proof:** reproduce from current `main`, identify why tenant hydration no longer reaches the script's fixed transcript precondition, and prove the repaired drive reaches its intended interaction at every declared viewport. Do not weaken the assertion merely to make the script green.
- **Lesson/control:** a rendered-evidence script that fails before the affected interaction is a harness defect, not evidence that the product change failed or passed.

#### PH-EVIDENCE-19 — Required app typecheck has an undocumented 12-error trunk baseline (`VERIFIED` locally; Platform Health)

- **Evidence / boundary:** `npx tsc --noEmit -p tsconfig.app.json --pretty false` exits 2 with exactly 12 diagnostics on current `main` `6bd8849d4b9bad7c8d331458cab03c00c61b87aa` and the Long-Form candidate. The identical set is two `StudioShell.tsx` TS2339 errors plus one each in `PaigeWorkspaceContext.tsx`, `useClientPortalBrand.ts`, `useMyActions.ts`, two in `customFields.ts`, and one each in `planning.ts`, `tenantLifecycle.ts`, `playbook/resolve.ts`, `CalendarAdmin.tsx`, and `Step1Welcome.tsx`. The lane introduced zero diagnostic drift.
- **Status / owner / collision:** routed to Platform Health as a trunk-signal defect. The Long-Form lane records the exact baseline and does not repair unrelated files under park-and-route.
- **Smallest next step / proof:** establish an owned baseline artifact or repair the 12 diagnostics on trunk, then require the app-config command in CI. The root `tsconfig.json` remains non-evidence because it checks no files.

#### PH-EVIDENCE-20 — Deno-ratchet self-test is not trustworthy on this Windows host (`VERIFIED` locally; Platform Health)

- **Evidence / boundary:** `npm run test:deno-ratchet` fails on both exact `main` and the Long-Form candidate. Deno-backed runner cases are abandoned with `spawnSync deno ENOENT`; an independent path-normalization assertion also fails because the same repo file is keyed twice under Windows worktree roots. The candidate changes no ratchet code.
- **Status / owner / collision:** routed to Platform Health; this lane does not install shared tooling or modify the cross-lane ratchet harness.
- **Smallest next step / proof:** provision the declared Deno executable for the test process, normalize repository-relative Windows paths once, and prove the complete self-test passes from both a normal checkout and a linked worktree.

#### PH-EVIDENCE-21 — Shared model router was not Deno-clean under its declared Tier vocabulary (`LOCALLY REPAIRED`; persisted release proof owed)

- **Evidence / boundary:** on current `main` `7ebdd9fea9832572e9d479b27e2a9c88e27b75ee` and the Long-Form candidate, `npx --yes deno-bin check --allow-import --node-modules-dir=none supabase/functions/paige-document-worker/index.ts` reaches the unchanged required dependency `supabase/functions/_shared/model-router.ts:888` and fails TS2367: `Tier` (`"frontier" | "open-fast" | "open-flexible"`) cannot equal `"reasoning"`. The new worker imports the canonical router as required; it does not fork provider invocation to evade this diagnostic.
- **Status / owner / collision:** the owner explicitly returned the repair to the Long-Form lane. Commit `d247abba47e386fa7426179a52c449550c41f7c4` changes only the impossible `tier === "reasoning"` comparison to the canonical `tier === "frontier"` mapping. No provider route, ceiling, or sensitive-call precedence changed.
- **Proof / remaining boundary:** real Deno checks return exit 0 with zero diagnostics for `_shared/model-router.ts`, existing `export-document/index.ts`, and new `paige-document-worker/index.ts`; focused router-budget plus document-production tests pass 20/20. The wider existing-consumer sweep still exposes five unrelated pre-existing Supabase generic diagnostics in `studio-visual-critique`; those are not attributed to this one-line repair and do not block the document worker. Persisted merge/Edge evidence remains owed.
- **Lesson/control:** a ratchet can preserve an inherited shared diagnostic for existing functions, but a new governed adopter exposes it as a release blocker. Repair the shared vocabulary and check the new adopter directly; do not bypass the router or hide the import graph to manufacture a green result.

### Proposed or local remediation — non-shipped

No runtime, schema, credential, provider, deployment or production change was made. This documentation PR can make the reconciliation canonical, but it does not ship any security repair or change the health claims above. Any local/proposed security patch remains explicitly non-shipped until separately merged and verified; this PR contains no such patch. Candidate repairs remain open; active PR #1173 is not absorbed. Merged #1175 is incorporated as current doctrine.

The decision packets for `handle-inbound-webhook`, unknown-budget fail-closed behavior, branch-protection readback, and credential remediation remain owner decisions. Audit agents preserve their evidence and options; they do not silently choose policy, rotate credentials, rewrite history, or assert enforcement.

### Ranked remediation program

1. Contain PH-SEC-01, then PH-SEC-02/06. Stop when every reachable seam has server-derived/purpose-bound authority or is disabled, with deployed negative proof.
2. Close PH-SEC-03/04. Stop on redirect/size/private-address tests and deployed two-tenant view/grant proof.
3. Complete shared authority through PH-SEC-05/07 and PR #1173. Stop on stable identity, current autonomy, idempotency, budget, readback, receipt/Rail, retry and cancellation through one engine.
4. Reconcile PH-TRUTH-10/PH-DB-11. Stop when Gateway adoption and exact-SHA replay plus production-catalog proofs agree; do not rebuild registries or Social ownership.
5. Close PH-OPS-15/PH-REG-16 through the existing release and registry controls; do not create a new gate or registry.
6. Discharge PH-EVIDENCE-12, PH-SEC-08/09, PH-OPS-13 and PH-SEC-17 only with least-privilege evidence and explicit owner decisions where credentials/history or spend policy are involved.

### Owner-readable closeout

- **What we learned:** the right shared primitives already exist; older caller-selected/direct-execution seams bypass them. The prevention rule is canonical adoption, not more architecture.
- **What changed on `main`:** #1175 merged Capability Portfolio routing, assigned the Harness Registry Steward, and recorded—but did not prove—the required UI-evidence branch setting. Latest `9cac02d6` fixes fal result retrieval after a controlled provider generation succeeded, and its Edge deploy run succeeded; post-fix artifact readback is still owed. Shared capability truth, honest Chat contact outcome, Social containment/replay bridge, Layer-G proof and Vibe media credits are also merged. MCP governance is structurally enforced; Layer-C act execution is not.
- **What still needs proof:** exact-SHA CI completion; post-fix Vibe artifact readback/receipt; empty replay; production catalogue/grants/function inventory; deployed denials for public/service-role/SSRF seams; seven authenticated flows; broader provider readback and build parity.
- **What decision is needed:** retire versus redesign `handle-inbound-webhook`; fail-closed policy for unknown general model accrual; configure/read back the exact required UI-evidence check; separately decide metadata-only investigation/remediation for tracked `.env` and the private #788 credential-control handoff. Neither credential packet authorizes automatic rotation or history rewriting.

---

## Historical baseline — end of 2026-07-20 session (not current truth)

**Brain build:**
- L1 (Observability / paige_llm_trace) — LIVE, tenant_id soft-FK silent-drop fixed via #146
- L4 (Reasoning — all 5 phases + engine) — LIVE
  - Phase-4 runReasoning engine (#144)
  - Phase-5 trace/learning seam (#145)
  - Phase-1 strategize (#147)
  - Phase-2 reflect (#148)
  - Phase-3 review (#150)
- L2 (Quality/Evals — Slice 1) — LIVE (#151), auth-gated verified
- L4↔L2 integration — LIVE (#152), first live `paige-strategist` trace confirmed
- L5 (Talent — Slice 1) — LIVE (#153), inert opt-in: crew-identity columns + 10 dormant review-crew rows + roster inspect + config.job_kind validation; verified in prod, edge redeploy confirmed byte-live
- §9 orchestrator security hardening (#149) — LIVE, closed cross-tenant IDOR + PostgREST injection + folded #206 funding leak; §32 exploit re-run against prod confirms all three attack vectors closed

**Brain-in-entirety COMPLETE (end 2026-07-20):** the full §34 build order shipped and is §32-verified live — L5 wiring (#156), L6 captureToMemory (#158), L7-S1 God-view dashboard (#160/#161), §16 10-department formalization (#162/#163), §8 two-way action-bus drainer (#164/#165). The §8 drainer runs on a */2 cron (post-deploy runtime check: fired + succeeded); the last brain layer is live.

**Move 2 — the platform-global `has_role('admin')` cross-tenant bypass: OPERATOR/SECURITY SURFACE CLOSED (2026-07-21, with proof).** The keystone (B1 super-admin escalation chain), the shared `can_access_contact` helper, the finance/credit cluster (F1–F5), and Slice 2 families 2a→2g all shipped, each crew-cleared + dual-layer §32-verified live. Remaining is NON-operator work that each needs its own grounding/crew + owner direction: tenant-scope DATA tables (#390/#391/#392/#394), RPC/edge-fn scoping (#386/#396), and product decisions (#388/#397/#399). **Standing rule (owner):** a HIGH-severity finding is corroborated against **live `pg_policies`** before it drives urgent work — never accepted from a chat transcript — and a HIGH-disproof is proof-by-exploit-reproduction (see the 2g §13 correction where a `super_admin`→`admin` mis-transcription invented a phantom HIGH on the MCP OAuth surface).

**Now in flight — Post-Brain Cleanup Queue (Lane F first):** Lane F CI quality gate — the first typecheck/build/test/lint gate the repo has had (PLATFORM_ASSESSMENT Move 4). See §2 + docs/OPS.md.

---

## 2. What changed since the last audit (2026-07-14)

**IA/Design cluster — Slice 1c (EPIC #404; source of truth = `docs/audits/platform-ia-slice-1c-handoff.md`, REVISED FINAL: 8-item nav, Marketplace elevated to #3 per CLAUDE.md §18 OS north-star; `docs/assessments/IA-SLICE-1C-BLUEPRINT.md` marked SUPERSEDED):**
- ✅ **Slice 1c-viii-c (#418, PR #196)** — **Clients container UI assembly** (UI-only, no migrations) — **1c-viii now fully wrapped.** Assembles the 42-line `ClientsHub` placeholder into the real **5-tab container** its own header comment named (§18 EXTEND — `ClientsHub.tsx` deleted; new `ClientsTabsLayout` + `ClientsSubTabs` mirror the proven 1c-vi `PaigeTabsLayout`/`PaigeSubTabs` 1:1 — pathless layout + `<Outlet/>`, gate-aware strip, indigo underline never gold §11, loading/current-path/§9-operator guards). All 5 tabs **REUSE** existing surfaces: **People** (default) = enhanced `ContactsAdmin` — the **Lifecycle × Temperature two-axis grid** (a Heat pill column consuming 1c-viii-a's `clients.temperature`, which had zero UI consumers; conscious §23 red→amber→indigo→gray ramp + distinct icons + Title-case labels; 7 view presets over RLS-scoped rows, Partners backed by a real `client_types` read §13); **Pipeline** = `PipelineAdmin` + funding quick-links wrapped in `<FundingGate>` (render only for a `funding_readiness` tenant, §2 never a default); **Delivery** = `CalendarAdmin`; **Conversations** = crafted §11 `EmptyState` (on-voice, no `return null`); **Client Portal** = `AdminOnly>PortalStudio`. **View modes** (My Queue/Team View/All) mirror the 1c-vii Command Center pattern (presentation-only, Team gated OFF, platform-owner business→mine anti-leak fallback; `useCommandCenterView` gained an optional `storageKey` so the two surfaces don't stomp each other, existing callers byte-identical). **Client 360 = reuse `ContactDetail`** (row-click → `/admin/contacts/:id`, §18 no duplicate; §13 — at-risk/sentiment/L6/rail-history NOT wired, no fake data). Legacy URLs resolve/301: `/admin/contacts`→clients-hub, `/admin/pipeline`→clients-hub/pipeline, `/admin/calendar`(+`/*`)→clients-hub/delivery. §9: zero client-supplied `tenant_id` (RLS-only). Crew (design architect → build engineer → adversarial verifier + compliance officer + design critic via Workflow): all three verify passes **SHIP**, no blockers; integrator folded the taste/compliance should-fixes. Local gates: eslint 0 · `npm run ci:tsc` 0 (baseline 22 — caught the `as ClientRow[]` overlap break → `as unknown as`) · build ✓. **HEADLESS honesty (§32):** compiles + lints clean but the authed `/admin/clients-hub` render was not driven — post-deploy live-check owed. Follow-ups logged: types.ts regen (#234), a dedicated StatePill heat token (heat-vs-error semantic separation).
- ✅ **Slice 1c-viii-b (#417, PR #194, squash bd5765b)** — **Portal Studio → Client Portal rename + relocate** (UI-only, no migrations). Renames the tenant-facing "Portal Studio" surface to **"Client Portal"** and moves its route home **under the Clients container**, preserving ALL functionality (incl. the live-preview panel) + every deep link. **Rename** (user-facing): `PortalStudio.tsx` hero eyebrows ×2 + `ClientsHub` CTA label → "Client Portal" (descriptive title "Your client's portal" left as-is); code-comment renames (§13) in `PortalStudio` header, `BrandControls`, `moduleNav`. **Relocate** (`Admin.tsx`): new home `<Route path="clients-hub/portal">` mounts `PortalStudio` inside `AdminOnly`+`Suspense`; old `/admin/portal` **and** `/admin/portal/*` now `<Navigate replace>` → `/admin/clients-hub/portal` (SPA 301, mirrors the `tasks→planning` precedent); `ClientsHub` CTA repointed; `AdminLayout` Clients-hub nav alias updated `/admin/portal`→`/admin/clients-hub/portal`. **§18: the surface MOVED, not duplicated** — component/file/imports + preview internals UNTOUCHED (one home). **Scope-surgical catch (§13):** `AppShell.tsx` (4 pre-existing eslint errors) + `AppNav.tsx` (1 pre-existing `any`) comment renames REVERTED — ci lints CHANGED files, so touching them would fail the gate on unrelated debt; their internal comments keep the old name (non-user-facing, acceptable). Crew (rename-relocate engineer + adversarial verifier + compliance officer via Workflow): both **SHIP**, no blockers; compliance should-fix folded (alias). Route-traced: new route present, both redirects wired, zero remaining user-facing "Portal Studio" strings. Local gates: eslint 0 · ci:tsc 0 (baseline 22) · build ✓; CI (ci + Security Audit) green. Remaining sub-slice: **1c-viii-c** (Clients container UI — its migration columns are now live).
- ✅ **Slice 1c-viii-a (#414, PR #192, squash 7196e46)** — **People data-model migration** (backend only). **Grounding reframed the spec (§18/§30):** there is **no `contacts` table** — the CRM person is `public.clients` (contacts are VIEWS), and `lifecycle_stage` already exists (17-value enum, populated). So this **extends `clients`** and leaves `lifecycle_stage` untouched. Adds `temperature` (hot/warm/cool/cold) + `disqualified` + `disqualified_reason` + `temperature_overridden_at` (backfill from `last_contacted_at`); new `client_types` §12 child (FK `contact_id`, own `tenant_id`) for multi-value relationship classification. §9: BEFORE-INSERT trigger server-derives `tenant_id` from the parent (forge-proof); RLS mirrors `client_notes`. `classify_client_temperature(uuid)` — recency recompute, 24h override, no notifications; §9-hardened (REVOKE public / GRANT service_role). **§18 compliance-crew BLOCKER (resolved):** dropped the spec's `client_activity_log` — the per-contact activity feed already exists as the Paige Context Rail (`paige_client_events`); the People surface reads that rail. Crew both ITERATE→resolved. **§32 dual-layer verified LIVE on prod** (fidelity: rolled-back pre-merge + applied/persisted post-merge; behavioral: forged-tenant overwrite + classifier grant-scope). **DEPLOY-INTEGRITY CATCH (§5/§13):** merge does NOT auto-apply migrations to prod (no CI `db push` exists) — prod was 2 behind (this + 1c-vi's `20260722010000`); both applied via MCP on merge day. **Root pipeline fix filed #415 (BLOCKS 1c-ix)** + a §32-persistence amendment; **1c-vi thumbs→L2 was non-functional on prod** in that window (0 rows landed) — logged #416. Remaining sub-slices: **1c-viii-b** (Portal Studio → Client Portal rename/relocate) · **1c-viii-c** (Clients container UI — depends on this migration, now live).
- ✅ **Slice 1c-vii (#412, PR #190, squash 5e45376)** — **Command Center reframe** (role-personalized views + drafts-awaiting panel + view toggle). Reframes `PracticeOverview` around **WHO is looking + WHAT is waiting**, on §9-safe seams with **ZERO new backend** (no migration → no #275 exposure). **Role→persona→view registry** (`src/lib/roleViews/commandCenterRegistry.ts`) — platform-default coaching-generic PRESENTATION config in **code, not a DB table** (a table would falsely imply per-tenant authorship + RLS for zero benefit; §9/§18 keep nav/lens config in code already): 6 active personas (owner/coach/sales/client_success/finance/viewer) + 5 `status:"planned"` DORMANT personas for 1c-ix (unmapped, never resolved until the enum role ships — **one `ROLE_TO_PERSONA` line each, no schema change** = the owner's "add role views without migration" ask). Honesty is STRUCTURAL (§13): `KpiKey`/`RailKey` unions list ONLY keys present on `PracticeMetrics`/`PracticeAttention`, so a no-source metric physically **cannot compile** into a tile — the 6 named-but-unsourced KPIs (show-rate/close-rate/cash-collected/calls/bookings/invoices-overdue) live in `DEFERRED_KPIS`, documented not rendered. §2-inclusive: coach heading = **"Client delivery"** not "Coaching". **Drafts-awaiting marquee** (`DraftsAwaitingPanel`) renders the ALREADY tenant-scoped `usePendingApprovals` queue (security_invoker view + RESTRICTIVE RLS — §9 substrate correct pre-existing) ranked by REAL columns only (SLA→priority→risk→due/age; no deal-value column → no "$ impact", §13); batch approve loops `execute-approval` per row (per-row idempotent claim lock §163) and reports the REAL per-row outcome, never a blanket "all approved"; leads ABOVE the KPI strip for approver personas (old gold "Review N approvals" header CTA removed — the panel supersedes it). **View toggle** (My work / Whole business; `CommandCenterViewToggle` + `useCommandCenterView`) — indigo active never gold (§11), persisted per user in localStorage (mirrors `RoleLensContext`; initializer intersects saved value with the persona's available set → no stale-chip flash), snap-to-valid. Business view = owner composition BUT `approvalScope` falls back to **"mine" for a PLATFORM owner** whose RLS spans tenants (`view==="business" && !isPlatformOwner ? "all" : "mine"`) — closes the cross-tenant-leak the verifier flagged (§9). **Team view gated off** (`TEAM_VIEW_ENABLED=false`) until its per-manager rollup exists (never backfilled from agency/operator RPCs, §9 tier seam). `ApprovalRow`: ADDITIVE `showDecline`+`onResolved` props (default off → existing Live-desk callers byte-identical, §18). Header KEPT `variant="hero"` verbatim (§28 — no silent restyle). Preserves Needs You Today + Open Pipeline (reframed) + OwnerWelcome + empty-book; AI Learning telemetry stays REMOVED. Crew (design engineer + adversarial verifier + compliance officer + design critic): converged SHIP, no blockers; should-fixes folded. Local gates: eslint 0 · `npm run ci:tsc` 0 (WHOLE-REPO RATCHET, baseline 22 unchanged — caught 2 ratchet-only issues pre-push: `StatRow cols=1` vs `2|3|4`, + 3 absorbed pre-existing anys) · build ✓; CI (verify + Security Audit) + Vercel green. Filed #413 (tiered financial-KPI RPC role-gate + Paige-callable `respond_to_approval` seam).
- ✅ **Slice 1c-vi (#410, PR #189, squash 6b06334)** — **Paige surface expansion** (sub-tabs + chat UX upgrade). New pathless `PaigeTabsLayout` wraps the EXISTING `/admin/playbook` · `/admin/sub-agents` · `/admin/actions` · `/admin/skills` routes as Paige sub-tabs — zero URL moves, per-child gates preserved (B5); gate-aware `PaigeSubTabs` (loading + current-path-visible + §9 operator-no-tenant guards; indigo underline, no gold §11). SetupHub interim CTAs removed (§18); 3 aliases moved Setup→Paige. CHAT UX (`PaigeAIChat`): stable per-message id+ts → hover `MessageMeta` (subtle timestamp + copy both roles + regenerate) · inline voice mic replaces the full board · `SlashCommandMenu` palette replaces always-visible chips · collapsible right rail persisted per user+tenant. THUMBS→L2: `response_quality_feedback` gains `tenant_id` (server-derived by a spoof-proof BEFORE-INSERT trigger — closes the §9 BLOCKER the verifier flagged) + a RESTRICTIVE own-tenant insert policy; `paige-eval` grows a `feedback_selector` + zero-cost `human_label` scorer. CI caught a real one post-push — the `as never` cast broke the whole-repo tsc RATCHET → typed via a narrow local shape (fix `1357e52`). Filed #411 (1c-x Analytics §9 grounding). §25 taste pass was code-level (headless — honest degrade).
- ✅ **Slice 1c-i (#184)** — closed two live §9 operator leaks: Legal Documents (`/admin/legal`) + Usage Analytics (`/admin/observability/usage`) → `PlatformStaffOnly` + God console; Insights tenant hub collapses to plain "Reports".
- ✅ **Slice 1c-ii (#185, squash b3d2ca4)** — Affiliates split: operator program → God (`/admin/platform/affiliates`, `PlatformStaffOnly`); tenant staff keep personal referrals (`MyReferralsPanel` on `/admin/affiliates`). NOTE: shipped paths are mirrored vs the handoff §10 wording (handoff specifies `/admin/my-referrals` for staff + `/admin/affiliates` for the operator program); functionally identical §9 split — flagged to owner, treated as canonical unless owner flips.
- ✅ **Slice 1c-v — nav-shell restructure to the 8-item target.** Landed the tenant top-nav in exact target order — **Paige · Command Center · Marketplace · Clients · Team · Growth · Analytics · Setup** (5 universal + 3 business-Playbook surfaces, §18). Label renames (content unchanged): Your Paige→**Paige** (URL stays `/admin/playbook`), Dashboard→**Command Center** (`/admin`; reframe = 1c-vii), Insights→**Analytics** (`/admin/analytics`, content stays Reports; full surface = 1c-x). Marketplace→#3. **Deleted the `... More` overflow** (tenant `moreNavItems` removed; `visibleMore` → `[]` for tenants; God console More untouched). **Clients/Team/Setup are §11 placeholder LANDINGS** (`/admin/clients-hub` [distinct from load-bearing `/admin/clients`, B3], `/admin/team` [also fixes the previously-dead `PaigeWhosHere` "View all" link], `/admin/setup`) — each a proper EmptyState whose CTAs link to every still-mounted surface it will absorb, so nothing is stranded (§11/§15); funding CTAs gated by `useTenantFeature("funding_readiness")` (§2), admin CTAs by `RoleGate fallback={<></>}`. **No `<Navigate>` redirects added — every legacy URL stays route-mounted (zero 404s);** the hub `aliases` keep the top-nav highlight + mobile title (`hubIsActive`, alias-aware) resolving on folded routes. §18 Growth Playbook seam preserved. Crew: design engineer + adversarial verifier + compliance officer, both **ITERATE→resolved**: fixed the confirmed **BLOCKER** (`RoleGate fallback={null}` renders a "Restricted" card — coaches would see it; corrected to `fallback={<></>}`), the **M2** nav-orphan gap (added funding + Sub-Agents/Actions/Skills + Lead Enrichment CTAs so no surface — incl. a funding tenant's — loses reachability), softened placeholder copy (§13), dropped the duplicate eyebrow/triple-icon (§25). Local gates green (eslint 0 / tsc 0 / build ✓).

  **Redirect/rename table (§24 first-class artifact — old→new for 1c-v):** RENAME-IN-PLACE (label only, URL+content unchanged): Your Paige→Paige (`/admin/playbook`) · Dashboard→Command Center (`/admin`) · Insights→Analytics (`/admin/analytics`). REORDER: Marketplace→#3. NET-NEW routes: `/admin/clients-hub` (Clients landing), `/admin/team` (Team landing), `/admin/setup` (Setup landing). MOUNTED (route unchanged, reached via placeholder CTA + hub alias, no redirect): `/admin/portal`, `/admin/contacts` (+`/:id`,`/:id/journey`), `/admin/leads/enrichment`, `/admin/clients` (+`/user/:userId`,`/internal/:clientId`, B3 untouched), `/admin/pipeline`, `/admin/funding` · `/admin/funding-pipeline` · `/admin/funding-lens` (funding-gated), `/admin/calendar` (+`/admin/bookings`), `/admin/planning` (+`/admin/tasks`), `/admin/workflows` · `/admin/sub-agents` · `/admin/actions` · `/admin/skills` · `/admin/integrations` · `/admin/signatures` · `/admin/social` · `/admin/notifications`, `/admin/agreement`, `/admin/agreements`, `/admin/coaches`, `/admin/members`, `/admin/affiliates`, `/admin/brokers` (funding+admin), `/admin/support`, `/admin/maintenance`, `/admin/settings`, `/admin/observability/*`. DELETED: tenant `... More` overflow (all items re-homed above). Note: `/admin/dashboard` and `/admin/insights` were never routes (Dashboard=`/admin` index; Insights=label-only) — no redirect needed. Interim: Planning is surfaced under Setup; its true home (Command Center 1c-vii vs Team 1c-ix) is a later call. Sub-Agents/Actions/Skills fold into the Paige surface in 1c-vi — surfaced under Setup only for interim reachability.
- ✅ **Slice 1c-iv — Growth container + Studio transition UX.** Stood up a **Growth** top-nav container (icon `Sprout`) absorbing **Campaigns** + **Vibe Studio** as sub-tabs; removed the two standalone hubs (Growth `href=/admin/campaigns`, never `/admin/growth` which redirects). Added the **§18 Playbook seam**: an optional `playbook?: "business"` marker on the `Hub` type + a no-op `activePlaybook` filter in `activeHubs` (business is the only Playbook today; Growth is business-scoped, not hardwired — one-line change when Playbooks multiply, same shape as the funding filter). Vibe Studio's immersive `isStudio` chrome is unchanged (child still navigates to `/admin/studio`). **Studio transition UX** (StudioLayout.tsx): relocated the buried footer "Back to Paige" → a prominent **top-of-rail "Back to Growth"** (→ `/admin/campaigns`) with an **Esc** shortcut (gallery-only, honest handler) and a one-shot **enter-fade** (`studio-enter`, Studio motion convention — class-gated, not OS-query). §21 preserved: the exit is a real link only on the gallery; inside a project it degrades to static "‹ Growth" context so the ProjectNavigator "All projects" stays the single session-level back. Also fixed a pre-existing bug: `/admin/studio/library` matched `:sessionId` → treated as a project; now excluded so the library is gallery-level (gets the exit + correct rail). Crew: design engineer + adversarial verifier (**PASS**) + compliance officer (**SHIP**) + design critic (**ITERATE**→folded: took the enter-fade not "optional", dropped the in-project "Vibe Studio" breadcrumb echo, made the Esc hint always-visible at reduced opacity). Portal Studio rename + Brand Kit unification deferred (owner-tightened scope). Local gates green (eslint 0 / tsc 0 / build ✓).
- ✅ **Slice 1c-iii — header profile dropdown.** Replaced the bare Sign-out icon with a `CircleUser` profile dropdown (desktop utilities): identity label + View-as (relocated from the brand-area pill — fixes a latent DropdownMenu-nested-inside-`<Link>` anchor-nav bug; `setLens()` enum untouched, §12) + Workspace settings (admin-gated → `/admin/settings`) + Sign out. Settings removed from tenant `moreNavItems` (desktop "More" + mobile) and re-homed; mobile drawer keeps an admin-gated Workspace-settings link so `/admin/settings` stays reachable (no reverse dead-end). `GOD_MORE` operator Settings untouched. Personal settings + Help/Docs deferred (no destination exists → #406, §11 no dead ends). Crew: verifier PASS (no blockers), compliance SHIP (should-fix: dropped the false "AdminViewBanner surfaces the lens" rationale — AdminViewBanner is `useImpersonation`-driven, not `useRoleLens` — before commit, §13). Follow-ups filed: #406 (Personal settings/Help destinations), #407 (person-level identity in label). Local gates green (eslint 0 / tsc 0 / build ✓).

**Remediated since PLATFORM_ASSESSMENT_2026-07-13 / DRIFT_AUDIT_2026-07-14:**
- ✅ **DRIFT_AUDIT C1** (`businesses` table cross-tenant leak) — VERIFIED FIXED in prod. `businesses.tenant_id` column exists, `tenant_isolation` RESTRICTIVE policy exists (2026-07-20 live check).
- ✅ **PLATFORM_ASSESSMENT §2/#206 funding cross-tenant leak** — CLOSED as part of #149 orchestrator fix (folded in, verified live).
- ✅ **Silent-drop on paige_llm_trace tenant_id FK** — CLOSED via #146 (Cowork-flagged this session, Claude Code diagnosed + fixed).
- ✅ **Orchestrator §9 IDOR + PostgREST injection** — CLOSED via #149.
- ✅ **Lane A2 Finding 1 — kb-search cross-tenant private-KB read IDOR** — CLOSED (PR #167). `match_tenant_knowledge` was SECURITY DEFINER + GRANTed to `authenticated` + filtered on caller-supplied `p_tenant_id`; any authenticated user could read another tenant's private Tier-2 KB chunks. Fixed with the #149/#361 JWT-caller guard + the edge fn now derives tenant from `current_user_tenant_id()` (never body). §32-verified live (own allowed / foreign 42501 / service-role trusted); both crew auditors returned SHIP. Out-of-scope siblings filed: #380 (Studio drafters' service-role guard bypass), #381 (kb-ingest-doc write side), #382 (or-filter sanitization).
- ✅ **Move 2 · Slice 2g (operator reference) → is_platform_owner() + §13 HIGH-disproof (migration 20260721143319).** Narrowed the standalone `has_role('admin')` to `is_platform_owner()` on the **doctrine_120 canonical registry** (`doctrine_120_canonical_columns`/`_enums`, 2 read policies) — operator-reference/registry data (no tenant_id), so a plain global admin reading the operator's canonical-column/enum drift registry is a §9 exposure; the policy already carried `is_platform_owner()`, so this drops the redundant admin disjunct. §32-verified live: Layer 1 0 residual admin; Layer 2 plain admin `is_operator=false` (DENIED, live BEFORE=true→AFTER=false), super_admin GRANTED. **§13 CORRECTION — the "#398 HIGH" was a mis-transcription, disproven by live-prod exploit reproduction.** The 2f compliance note claimed `paige_mcp_oauth_tokens`/`_clients` gate on flat `has_role('admin')` (→ "plain global admin can view/revoke cross-tenant MCP OAuth tokens"). Live `pg_policies` shows they gate on **`has_role(super_admin) OR <self>`** (operator + token/client owner), and `paige_mcp_connections` is `is_platform_owner()` (closed in Slice 2d). The adversarial verifier **reproduced the exploit** on prod impersonating the plain global admin `443e94a3` (admin+coach, not super): `token_view=FALSE`, `token_revoke=FALSE`, `client_view=NULL(denied)`, **0 foreign tokens visible** — the MCP OAuth surface was already correctly scoped by earlier work; there is no HIGH. Those correct policies were intentionally NOT touched (editing a working security surface to chase a phantom is the risk). **New §18 leftover filed #399:** `paige_skills`/`paige_skill_proposals` carry the same `is_platform_owner() OR has_role(admin)` idiom (no tenant_id, platform skills registry) — same class, needs an operator-vs-tenant-authored intent decision. **STANDING RULE (owner, 2026-07-21):** any HIGH-severity finding gets a §18 grounding pass against **live prod policy state** before it drives urgent work — severity is corroborated against deployed state (`pg_policies`), never accepted from a chat transcript; and HIGH-disproof is proof-by-exploit-reproduction, not proof-by-assertion. **With 2g, the operator/security surface of the platform-global `has_role('admin')` bypass is genuinely closed, with proof.** Remaining is tenant-scope DATA tables (#390/#391/#392/#394) + RPC/edge-fn scoping (#386/#396) + product decisions (#388/#397/#399) — each needs its own grounding/crew and owner direction.
- ✅ **Move 2 · Slice 2f (governance) → is_platform_owner() (migration 20260721062354).** Narrowed the standalone `has_role('admin')[/coach]` to `is_platform_owner()` on **8 platform-governance tables / 13 policies** where staff had CROSS-TENANT access (all `user_id`-keyed, NO `tenant_id`): `audit_logs`, `analytics_events` (permissive read + the RESTRICTIVE block-gate — narrowed together so operator passes both), `profiles` ("update ANY profile" → operator; self-edit policies untouched), the support desk (`support_tickets`/`support_ticket_messages`/`support_ticket_last_seen` — staff admin+coach cross-tenant → operator), and the feature board (`feature_requests`/`feature_request_votes` — kept the PUBLIC "view non-declined" + own-submission, narrowed only the staff see-declined/moderate terms). **Owner decision (2026-07-21):** operator-only is the §9-correct current-state fix — there is no per-tenant support routing today (no `tenant_id` on support_tickets); per-tenant staff-scoped support + feature moderation is a real future build, filed **#397**. Coach removal breaks nothing (all support/feature tables 0 rows; the coach grant was a pure cross-tenant leak). Self/submitter/public policies preserved verbatim. Crew: compliance **SHIP** + verifier **PASS** (restrictive-policy handling confirmed — operator passes both permissive+restrictive even without the plain admin role; affiliate WITH-CHECK trap covered on the profiles UPDATE + support_ticket_messages INSERT). §32-verified live: **Layer 1** 0 residual admin/coach across 12 policies; **Layer 2** plain global admin → audit/support DENIED, public feature-view preserved (declined operator-only), super_admin GRANTED. **NEW §18 findings filed #398** (operator-leftovers the sweep surfaced — HIGH: `paige_mcp_oauth_tokens`/`_clients` cross-tenant OAuth token view/revoke; LOWER: `doctrine_120` registry — both → is_platform_owner). **§2 pre-existing debt logged** (support_tickets/feature_requests `category` CHECK hardcodes credit/funding values — not introduced here, fix when support goes per-tenant #397). **Slice-2 operator/governance families now COMPLETE (2a–2f).** Remaining Move-2 tenant-scope deferrals: #390/#391/#392/#394/#395/#396/#398; edge-fn scoping #386.
- ✅ **Move 2 · Slice 2e (broker cluster + user_business_limits) → is_platform_owner() (migration 20260721055613).** Narrowed the standalone `has_role('admin')` to `is_platform_owner()` on the **6 platform broker/referral-program tables + `user_business_limits`** (16 policies). Both crew auditors grounded these as genuinely **platform-operator** (no tenant dimension anywhere: `broker_profiles` keys to `user_id`→`auth.users` with a platform `monthly_fee`/Stripe sub + operator-set application `status`; `user_business_limits` is a per-user platform quota driven by plan slug + `additional_business_monthly_fee`, operator-seeded). A tenant admin had no legitimate path into either — narrowing is a §9 tightening. **PURE NARROWING:** swapped only the admin operator-override; every broker-SELF clause (`EXISTS(broker_profiles bp WHERE bp.user_id=auth.uid())` with correct broker_id/referring/referred correlations), owner-self (`auth.uid()=user_id`), and the `user_business_limits` "Users view own" + service-role policies preserved VERBATIM. **Affiliate WITH-CHECK trap covered:** the verifier enumerated 6 ALL/UPDATE policies whose live WITH CHECK also carried `has_role(admin)` (a plain admin could still INSERT referral commissions / arbitrary broker team members = privesc) — all narrowed on BOTH USING+WITH CHECK, self-EXISTS kept in the WITH CHECK. Crew: compliance **SHIP** (FOLD-IN-AS-OPERATOR verdict on user_business_limits; §18 sweep clean) + verifier **PASS** (all self correlations confirmed; residual-avoidance list satisfied). §32-verified live: **Layer 1** 0 residual admin / 16 policies, broker-self EXISTS survived; **Layer 2** plain global admin (not super, not a broker) DENIED on operator + broker-self paths, super_admin GRANTED. **Follow-up #396:** the SECURITY DEFINER RPC `admin_set_user_business_limit` gates internally on `has_role(admin)` (RLS-bypassing, so the modal isn't broken) — narrow to `is_platform_owner()` in the RPC-scoping slice. §2: broker's `credit_coach`/`mortgage_broker` types are §2-permissible (opt-in operator-managed partner role, not a coaching-generic default). **Remaining Move-2 · Slice 2:** 2f (governance — `profiles`/`audit_logs`/`support_*`/`feature_*`/`analytics_events`/rag_documents — needs one grouped owner call); deferrals #390/#391/#392/#394/#395 unchanged.
- ✅ **Move 2 · Slice 2d (Family O — operator platform-internal) → is_platform_owner() (migration 20260721053737).** Narrowed the standalone `has_role('admin')` MANAGE/READ bypass to `is_platform_owner()` (super_admin operator ONLY) on **25 platform-operator infrastructure tables / 33 policies** — the F5 pattern extended platform-wide: `admin_app_settings`, `platform_api_keys`, `stripe_event_log`, `stripe_product_mappings`, `webhook_event_log`, `outbound_webhook_configs`, `paige_mcp_connections`, `paige_n8n_connections`, `paige_telegram_config`, `paige_social_posts`, `paige_bridge_auth_failures`, `security_canary_runs`, `corporate_entity_registry`, `account_modifications`, `affiliate_applications`, `elite_waitlist`, `rag_retrieval_log`, `platform_metered_events_dead_letter`, `courses`, `lessons`, `knowledge_base`, `build_milestones`, `legal_documents`, `extraction_quality_log` (read/update), `response_quality_feedback` (read/update). These have NO tenant_id and NO per-tenant ownership the admin policy respects — a tenant admin editing the platform's settings/credentials/billing/catalog was the §9 leak; only the super_admin operator should. Crew: compliance **SHIP** (grounded every ambiguous table as genuinely operator — tenant connectors live in separate `tenant_n8n_connections`/`tenant_workflows`; courses/lessons/knowledge_base are the single global platform curriculum; §18 sweep clean, no missing operator sibling) + verifier **PASS** (every self-access companion policy preserved — users keep own-application/own-quality-log reads; restrictive `analytics_events` correctly excluded; webhook inserts are service-role so narrowing is moot; `legal_documents`/`platform_metered_events_dead_letter` `admin OR super_admin` fold preserves super_admin). §32-verified live: **Layer 1** all 33 policies resolve to `is_platform_owner()` (0 residual plain-admin after the affiliate-UPDATE with-check fix); **Layer 2** plain global admin (is_admin=true, is_platform_owner=**false → DENIED**) / super_admin (**GRANTED**). **§13 CONSCIOUS EXCLUSION (#395):** the INSERT policies on `extraction_quality_log` (written by `useClientChatContext.ts:578`) and `response_quality_feedback` (written by `ResponseFeedback.tsx`) run under the active user's browser JWT during normal app use — narrowing them to super_admin-only would SILENTLY break telemetry capture; since these no-tenant telemetry tables have no cross-tenant dimension for Move 2 to close, their operator READ/UPDATE was narrowed but the INSERT was left as-is, filed as a design follow-up (service-role/authenticated write). **Deferred (unchanged):** broker cluster (#393 → Slice 2e), governance set profiles/audit_logs/support_*/feature_*/analytics_events (→ 2f), rag_documents published-doc read, #390/#391/#392.
- ✅ **Move 2 · Slice 2c (Family T — tenant_id-direct business tables) → Slice-1 template + §18 fold-in (migration 20260721051711).** Narrowed the standalone `has_role('admin')` on **26 tenant_id-direct tables / 30 policies** in two parts. **Part 1 (14 tables)** via the canonical Slice-1 template `is_platform_owner() OR (tenant_id = current_user_tenant_id() AND has_role(<staff>))` — no helper (tenant_id is on the row): deals, deal_activities (no tenant_id → scoped via `deal_id → deals.tenant_id` EXISTS-join, mirroring 2a's contact-join), pipelines, pipeline_stages, email_templates (3 policies), email_send_log, invitations, communications_consents, paige_approval_policies (admin-manage + read-for-routing), paige_coach_assignments, paige_ingestion_proposals, paige_subagent_factory_quota, paige_subagent_proposals (admin + coaches-read-own), paige_workflow_runs (view + insert). On the mixed admin-OR-coach policies (paige_coach_assignments, policies_read_for_routing, workflow insert) the whole staff group was tenant-scoped — **TIGHTENING the previously-unscoped coach**, closing the flagged coach cross-tenant leak (§31: tightening ≠ broadening); self-clauses (`proposed_by=auth.uid()`, `triggered_by_user_id=auth.uid()`) preserved VERBATIM. **Part 2 (12 §18 grep-sweep siblings the compliance ITERATE caught)** — tables that already carry a tenant term but leak via a bare `OR has_role('admin')` disjunct: growth_pages/growth_funnels/growth_funnel_steps/growth_forms/growth_external_sources/custom_field_definitions/client_custom_field_values (Shape A, role-less tenant term), growth_funnel_sessions (Shape C, bare admin+coach → operator escape), marketing_content/studio_deliverable/studio_library_items/paige_actions (Shape B, role-gated tenant term + trailing bare admin). Fix = drop the bare disjunct, add `is_platform_owner()`, tenant term preserved verbatim — the tenant's most valuable surfaces (Studio deliverables, growth funnels/forms, the §8 action bus). Crew: Part-1 verifier PASS (attacked all 18 policies; deal_activities join, communications_consents super_admin fold, coach tightening all confirmed); compliance ITERATE→resolved (the 12 folded in); Part-2 verifier confirmed the intended logic PASS on all 3 shapes. §32-verified live: **Layer 1 fidelity** 0 residual bare-admin across all 30 altered policies; **Layer 2 behavioral** cross-tenant global admin DENIED / super_admin GRANTED / own-tenant admin GRANTED-own + DENIED-cross-tenant, on all 4 shapes. **`tasks` EXCLUDED** (tenant_id NULL on 2/2 live rows → template dead-ends; a user_id-path table for a later slice, its NULL-tenant data issue flagged). **NULL-tenant caveat RESOLVED:** pipelines (3/9) + pipeline_stages (15/47) NULL rows are `is_default=true` platform seed templates, and both tables carry a permissive `tenant_isolation` ALL policy (`is_platform_owner() OR tenant_id IS NULL OR tenant_id = current`) that OR's in — so the narrowing loses zero access to the seeds, only closes cross-tenant admin write. **Filed #394** (pipelines/pipeline_stages standalone unscoped-coach SELECT + role-less tenant_isolation write grant — separate class, not this admin-bypass slice). Remaining Slice-2 families: 2d/2e (O operator + broker, ~30 → is_platform_owner, incl. #393), 2f (governance — needs one grouped owner call).
- ✅ **Move 2 · Slice 2b (Family U — user_id/client_user_id-keyed) → tenant_staff_owns_user (migration 20260721045609).** Narrowed the standalone `has_role('admin')` on **5 consumer tables** keyed by a user id (→ clients.linked_user_id): communication_log, communication_preferences, push_subscriptions, push_notification_log (user_id), outreach_drafts (client_user_id). Helper-reuse only (F1's `tenant_staff_owns_user`, no new helper). PURE NARROWING (§13): swapped only the admin term; owner-self + the outreach_drafts coach policy preserved verbatim. All standalone admin-only (no PART-B). Crew: verifier PASS; compliance SHIP (Family-U roster confirmed complete). §32-verified live: fidelity 0/5; cross-tenant global admin DENIED, own-tenant staff & super GRANTED. **Compliance §18 sweep flagged 4 Family-U-*shaped* but out-of-family tables (#393): `user_business_limits` (→businesses.owner_user_id) + broker cluster `broker_client_relationships`/`broker_profiles`/`broker_team_members` (→broker_profiles) — they carry the same admin bypass but don't reach via clients.linked_user_id, so they get their home in Slice 2e (operator/broker family), not here.**
- ✅ **Move 2 · Slice 2a (Family C — contact_id-keyed) → tenant_staff_owns_contact (migration 20260721043812).** First sub-slice of Slice 2 (the ~84-table tail). A dedicated §18 classification pass (read the actual policy text of all 84) grouped the tail into families: **C** (contact_id → helper), **U** (user_id → tenant_staff_owns_user), **T** (tenant_id → Slice-1 template), **O** (operator → is_platform_owner), **D** (deferred/new-helper/product-decision) — zero false-positives, all 84 placed, ship order severity-ranked. Slice 2a is Family C (highest severity, cleanest): narrowed the standalone `has_role('admin')` on **9 contact-keyed tables** — browser_use_sessions, paige_bookings, paige_enrichment_log, paige_health_snapshots, paige_messages_audit, paige_signature_envelopes, paige_skill_runs, paige_subagent_invocations, paige_subscription_events. **New helper `tenant_staff_owns_contact`** (contact_id analog of tenant_staff_owns_user; coach-less, admin-only). PURE NARROWING (finance-cluster discipline): swapped ONLY the admin term; coach terms (paige_health_snapshots exact assigned_coach EXISTS; paige_skill_runs insert has_role(coach)), is_platform_owner(), service_role, and owner-self preserved VERBATIM. **Deliberately did NOT use can_access_contact** (client-inclusive) — both crew auditors caught that routing these STAFF policies through can_access_contact would grant the CLIENT new read of internal logs + write of staff-authored rows (e.g. their own health snapshot); tenant_staff_owns_contact excludes the client. Crew: verifier PASS→resolved (client-broadening finding fixed); compliance ITERATE→resolved (signature-envelope over-broadening + client-read fixed by the coach-less helper). §32-verified live: fidelity 0/9; behavioral own-tenant admin & super GRANTED, cross-tenant global admin DENIED, and the differentiator — pure client `0b05d0b7` reads via can_access_contact=TRUE but tenant_staff_owns_contact=FALSE (client correctly excluded). **Compliance §18 sweep also flagged two unrostered cross-tenant leaks (different class — `admin OR coach` unscoped): `paige_admin_notifications` (redundant legacy bare policies to DROP) and `paige_coach_assignments` (`tenant_isolation` policy is OR'd so ineffective) — both to be closed in later Slice-2 families (T/D).** Remaining Slice-2 families queued: 2b (U, 5 tables), 2c (T, 15 tables), 2d/2e (O operator, ~30), 2f (governance — needs one grouped owner call: profiles/audit_logs/support_*/analytics_events); deferred #390/#391/#392 unchanged.
- ✅ **Move 2 · F5 — operator-catalog tables → is_platform_owner() (migration 20260721035753). FINANCE CLUSTER (#385) COMPLETE.** Narrowed the standalone `has_role('admin')` MANAGE bypass (a tenant admin could edit the PLATFORM's funding/lender/vendor/disclosure catalog) to `is_platform_owner()` (super_admin operator only — no tenant_id/agency clause, correct because these rows have no tenant) on **6 operator-catalog tables**, all verified to have ZERO tenant/user scoping columns: `funding_offers`, `lender_products`, `lender_bureau_preferences` (3 admin policies — all narrowed), + **3 grep-swept siblings the compliance §18 pass caught**: `vendor_offers` (twin of funding_offers), `naics_codes` (finance-adjacent reference consumed by funding_offers), `disclosure_templates`. READ policies (`is_active=true` / `true`) LEFT UNTOUCHED — no read regression (lender_products 50 rows / lender_bureau_preferences 20 rows stay tenant-readable). Crew: verifier PASS (7 plain global admins lose catalog write, only the 1 super_admin operator retains it; reads intact); compliance ITERATE→resolved (folded the 3 siblings in; confirmed §9 operator bar correct). §32-verified live (fidelity 0/6; plain global admin denied / super_admin granted). **§2 read-gate note (NOT fixed here — separate product decision):** the authenticated READ exposes the funding/lender catalog to all authenticated users regardless of funding opt-in — tracked under #176/#360, deliberately not force-changed inside a Move-2 security narrowing.
- ✅ **Move 2 · F4 — paige_readiness_* found ALREADY tenant-scoped (no migration, §13-honest).** Grounding the planned F4 tables (`paige_readiness_proposals`, `paige_readiness_scan_runs`) showed their admin term is already `(tenant_id = current_user_tenant_id()) AND (has_role(admin) OR has_role(super_admin) OR is_tenant_owner(...))` — the admin role is already PAIRED with the active-tenant check (the Slice-1 canonical shape), so there is no standalone global-admin bypass to narrow. F4 required NO migration; reported honestly rather than shipping a no-op. **Finance-cluster (#385) status: F1+F2+F3+F5 shipped, F4 already-compliant. Remaining deferrals tracked: #390 (business_certifications unscoped-coach), #391 (research subsystem author→tenant, needs new helper), #392 (same-shape NON-finance consumer-PII → Slice 2), + compliance-flagged F6 candidates absorbed into F5.**
- ✅ **Move 2 · F3 — remaining user_id-scoped consumer-finance tables (migration 20260721034858).** Third finance-cluster family: narrowed the standalone `has_role('admin')` bypass on **3 tables** — `credit_predictions` (user_id; 3 admin-only verbs + 1 admin-OR-coach PART-B SELECT), `financial_api_logs` (user_id), `funding_secured` (**client_user_id** = the consumer — NOT its other `user_id`/recorder column). **Helper-reuse only** (F1's `tenant_staff_owns_user`). PURE NARROWING (§13): admin term swapped, owner-self + coach terms preserved verbatim. Crew: verifier PASS (fidelity + behavioral: cross-tenant global admin `443e94a3` DENIED, own-tenant/super GRANTED) — and independently confirmed the deferral below is correct; compliance SHIP with one §18 tracking catch. §32-verified live (fidelity 0/3; cross-tenant denied / own / super granted). **Two conscious deferrals surfaced by the F3 crew:**
  - **#391 (research subsystem — needs a NEW helper):** `lender_research_results` + `research_runs` + `research_sources` are byte-identical author→tenant/**nullable-consumer** shape (`user_id`=staff author NOT NULL, `client_user_id`=consumer NULLABLE; the admin ALL policy's null with_check falls back to qual). Narrowing by consumer orphans unassigned rows as super_admin-only AND blocks admins authoring unassigned research — so it needs a bespoke `tenant_staff_owns_author(_actor,_author)` (actor+author same-tenant owner/admin), not a mechanical narrow. Both auditors confirmed deferral is correct. All 3 tables 0 rows.
  - **#392 (same shape, NON-finance — Slice 2 #384):** `client_goals`, `client_memory`, `chat_message_embeddings` carry the identical global-admin bypass over consumer PII but are coaching/AI data, not finance — they narrow cleanly with `tenant_staff_owns_user` but belong in Slice 2, not the finance F-series.
  - **Honest completeness statement:** F1+F2+F3 closes the consumer-finance *narrowable-by-consumer* pattern; the research subsystem (#391) and the non-finance same-shape family (#392) remain, tracked. F4 (paige_readiness_* — tenant_id direct) and F5 (operator catalog) are their own slices.
- ✅ **Move 2 · F2 — user_id-scoped consumer credit/build tables (migration 20260721033306).** Second finance-cluster family: narrowed the standalone `has_role('admin')` bypass on **11 tables** — credit-report core (6): `credit_accounts`, `credit_alerts` (keys `client_id`, a user id), `credit_negative_items`, `credit_report_personal_info`, `credit_report_uploads`, `funding_application_outcomes`; plus **5 grep-swept siblings the compliance §18 pass caught**: `manual_banking_entries` (banking PII missed by F1's finance-keyword grep — same class as F1), `tier_state` (funding-readiness tier), and the business-credit-build trio `build_progress` / `build_recommendations` / `user_build_milestones`. **Helper-reuse only** — reuses F1's `tenant_staff_owns_user(_actor,_user)` (`user_id → clients.linked_user_id → clients.tenant_id`), no new helper. **PURE NARROWING** (§13): swapped only the admin term; owner-self, the exact coach terms (`funding_application_outcomes` admin-OR-coach policies), and the `credit_report_uploads` `uploaded_by=auth.uid()` write-guard preserved verbatim. **PART-B handled**: `funding_application_outcomes` carries redundant admin-only AND admin-OR-coach policies on both SELECT+INSERT — permissive-OR means all four narrowed. The `build_*` trio uses a different sub-shape (admin bundled INLINE as `(user_id=auth.uid()) OR has_role('admin')` on every CRUD verb) — owner-self disjunct preserved, only admin swapped. Crew: verifier PASS (fidelity + behavioral proof on real actors: cross-tenant global admin `443e94a3` DENIED, own-tenant/agency/super GRANTED); compliance ITERATE→resolved (its §18 sweep found the 5 unrostered same-shape siblings — folded them in, the exact F1-miss avoided). §32-verified live (fidelity 0/11; cross-tenant admin denied / own / super granted). **Consciously deferred (#390):** `business_certifications` — its admin AND coach terms are BOTH unscoped (`has_role(admin) OR has_role(coach)`, no per-client predicate), so narrowing admin alone leaves a cross-tenant leak via unscoped coach; that needs a coach-scope product call, not F2's mechanical narrow. Remaining finance families in #385: F3 (user_id-only, reuses `tenant_staff_owns_user`), F4 (tenant_id direct, Slice-1 template), F5 (operator catalog → is_platform_owner).
- ✅ **Move 2 · F1 — user_id-scoped consumer-finance tables (migration 20260721024632).** First finance-cluster family: narrowed the standalone `has_role('admin')` bypass on **9 tables** (banking_relationships, business_credit_reports, financial_document_analyses, funding_applications, funding_journey_applications, funding_milestones, quickbooks_financials, quickbooks_connections, quickbooks_transactions) via a new coach-less helper `tenant_staff_owns_user(_actor,_user)` = super_admin OR tenant-admin/agency-parent of the consumer's tenant (resolved `user_id → clients.linked_user_id → clients.tenant_id`). **Sixth stale-audit correction:** these tables carry a `business_id` column but do NOT scope by it — the audit's "business_id → businesses.tenant_id" assumption for this family is wrong; the real path is `user_id → clients.linked_user_id`. **PURE NARROWING** (§13): only the admin disjunct was swapped; owner-self + exact coach terms preserved verbatim — both auditors flagged that bundling coach into the helper would silently broaden coach access on admin-only tables, so that was deliberately avoided and filed as a product decision (#388). Crew: verifier SHIP (dual-layer exploit: cross-tenant admin GRANTED pre-fix → DENIED post-fix; no residual disjunct); compliance ITERATE→resolved (pulled the 3 grep-missed tables quickbooks_connections/_transactions/funding_milestones into the slice; coach-less helper approved as the right §18 call). §32-verified live (fidelity 0/9; cross-tenant denied / own / agency / super granted). Remaining finance families in #385: F2 (client_id → clients.id, reuses `can_access_contact`), F3 (user_id-only via clients.linked_user_id, reuses `tenant_staff_owns_user`), F4 (tenant_id direct, Slice-1 template), F5 (operator catalog → is_platform_owner).
- ✅ **Move 2 · can_access_contact tenant-scope (migration 20260721020716).** The finance sub-slicing surfaced the real keystone of the consumer-PII cluster: the SHARED `can_access_contact` helper (used by 19 policies on 15 tables + 2 RPCs — `start_client_impersonation` & `client_onboarding_status`) carried its OWN tenant-blind global-admin bypass (`has_any_role(_user_id,['admin','super_admin'])`). Narrowed it to `is_super_admin OR tenant-admin-of-the-contact's-tenant OR agency-parent` (agency-aware via `agency_can_manage_child`, matching the Slice-1 template), closing ~7 helper-sole tables + both RPCs. **Fifth stale-audit correction:** the "finance cluster" is NOT the Slice-1 template — it's per-scoping-family (5 families, ~27 tables, mostly no `tenant_id`); and 10 of the 15 helper tables are non-finance (bookings/payments/signatures/conversations/intake), so the fix is named for the helper, not "finance." Crew: compliance ITERATE→resolved (added the agency clause + honest rename); **adversarial verifier caught a real BLOCKER** — the helper narrowing alone left the 5 finance `paige_*` tables (+3 others) wide open because their policies carry a *standalone* `has_role('admin')` disjunct that bypasses the helper — so PART B narrows that disjunct on all 8 (10 policies), unifying them onto the tenant-scoped helper. §32-verified live (fidelity: 0/10 policies still reference has_role; behavioral: cross-tenant admin denied / agency-parent granted / own granted / super_admin retained). Overlap check for the owner's gate: **no Lane E exists**, and the §2 amputation (task #7) targets legacy UI surfaces only — the finance *tables* are retained Paige IP behind the `funding_readiness` opt-in, so RLS hardening is additive, not conflicting. Remaining finance families filed in #385 (user_id/business_id credit tables via clients/business_id join; operator catalog tables → is_platform_owner).
- ✅ **Move 2 · Slice 1 — cross-tenant client-PII admin bypass narrowed (migration 20260721002907).** The keystone lane (former Lane A4+A5, merged): global `has_role('admin')` was narrowed to tenant-scoped on the 4 highest-severity client-PII tables — `client_notes`, `client_files`, `growth_form_submissions`, `paige_subagents` — plus a god-role ceiling on `sync_tenant_member_to_user_roles` (auto-sync can never mint super_admin/platform_admin/developer). **Canonical Move-2 template = the `businesses` DRIFT-C1 shape**: operator escape `is_platform_owner()` (super_admin only); tenant scope `tenant_id = current_user_tenant_id() AND has_role(<staff>)` (agency-aware; neuters the global admin role by pairing it with the validated active-tenant check). §32-verified live (own-tenant allowed / foreign denied / operator retained / active-tenant coupling enforced). Both crew auditors passed (verifier SHIP; compliance ITERATE→resolved to the `businesses` canonical shape). Remaining Move 2 filed: #384 (Slice 2 bulk tables + client_memory/goals/comms which need a clients-join), #385 (finance/credit cluster), #386 (Slice 3 = 21 B3 edge fns via requireTenantScope), #387 (change_user_role 'developer' gap + §17 operator-access audit trail).

**Tenant-scoping helpers — the Move-2 RLS primitive layer (§11 shared-primitive discipline applied to RLS).**
Move 2 narrows the platform-global `has_role('admin')` bypass to tenant scope. Rather than inline the same
tenant-resolution logic into every policy, the narrowing routes through a small set of canonical, audited
SECURITY DEFINER helpers. Two are parameterized by an explicit `_actor` (so they work where the policy can't use
`auth.uid()` directly — e.g. a helper called with a row's `_user_id`), and one pair is the `auth.uid()`-based
active-tenant template. **When to use which is decided by the row's KEY column:**

| Helper | Signature | Path it resolves | Use when the table keys on… | Families on it |
|---|---|---|---|---|
| `can_access_contact` | `(_user_id uuid, _contact_id uuid) → bool` | `contact_id → clients.id → clients.tenant_id` | a **contact_id** (FK to `clients.id`) | keystone cluster (15 tables + 2 RPCs: bookings/payments/signatures/conversations/intake + the 5 finance `paige_*`) |
| `tenant_staff_owns_user` | `(_actor uuid, _user uuid) → bool` | `_user → clients.linked_user_id → clients.tenant_id` | a **user_id / client_id that is a user id** (the consumer's auth uid) | F1 (9 banking/QB/funding tables), F2 (11 credit/build tables), F3 (3 tables) |
| `tenant_staff_owns_contact` | `(_actor uuid, _contact uuid) → bool` | `_contact → clients.id → clients.tenant_id` | a **contact_id / related_contact_id** (FK to `clients.id`), when the policy is STAFF-only (admin) — the coach-less write/read analog of `can_access_contact` | Slice 2a (9 contact-keyed tables) |
| `current_user_tenant_id()` + `is_platform_owner()` | `() → uuid` / `() → bool` | agency-aware active-tenant of `auth.uid()` | a **tenant_id column directly** | Slice 1 (client_notes/files/growth_form_submissions/paige_subagents), Slice 2c (26 tenant_id-direct tables incl. deals/pipelines/email_templates/growth_*/studio_*/paige_actions) |

Both parameterized helpers share the same tenant-authority core — **`is_super_admin(_actor)` (operator escape, super_admin
ONLY) OR agency-parent (`agency_can_manage_child`) OR active tenant-members owner/admin of the row's tenant** — and are
**coach-less by construction**: coach access is never folded into the helper (that would silently broaden coach reach on
admin-only tables), so each policy preserves its own exact coach term verbatim. Operator-catalog tables with no tenant
column (F5: `funding_offers`/`lender_products`/`lender_bureau_preferences`) use **`is_platform_owner()` only** — no
helper, no tenant clause. All helpers verified free of any `has_role('admin')` bypass (2026-07-21 live).

**Net-new since prior audits (this session):**
- L1 flight recorder + L1.1 text-path tracing (live and receiving rows)
- L4 reasoning engine + all 5 phases (inert opt-in code; L4↔L2 loop wired live into paige-deep-research)
- L2 quality/evals Slice 1 (4 tables, 10 deterministic scorers + frontier rubric_judge, auth-gated edge fn)
- L5 Talent Slice 1 + wiring (crew-identity columns, 10 dormant review-crew rows, roster inspect, per-agent job_kind swap)
- L6 captureToMemory, L7-S1 God-view intelligence dashboard, §16 10-department formalization
- **§8 two-way action-bus drainer (#164/#165)** — paige-action-worker on a */2 cron drains filed actions → drafts via the orchestrator → routes to approval; §16 tier-honoring (skips off-lane), idempotent approval insert, atomic claim. Brain-in-entirety complete.
- **Lane F CI quality gate Slice 1 (PLATFORM_ASSESSMENT Move 4)** — `ci.yml`: build + test hard gates, tsc signature-ratchet (baseline 22, fails on new only), changed-file eslint/gold, added-lines §3/jargon/policy regression lint. Grounding correction: the audit's "deploy ignores config.toml verify_jwt" item was already fixed by the 07-18 deploy-edge-functions.yml. Runbook: docs/OPS.md. **Owner action:** mark `ci / verify` a required status check in branch protection or the gate stays advisory.

**Still open from prior audits (highest severity first):**
- **PLATFORM_ASSESSMENT A1–A8 (money — no reachable Paige checkout, plan taxonomy fractured six ways, `platform_subscriptions` has zero writers, trial→paid conversion doesn't exist, entitlement bypass, Stripe idempotency inverted, `check-subscription` anon client, no dunning).** All still open. Antonio's ticket list does not surface these as go-live gates but PLATFORM_ASSESSMENT called them the top MVP blocker.
- **PLATFORM_ASSESSMENT B1 (privilege escalation).** ⚠️ **Two stale-audit corrections (live-grounded 2026-07-21):** (1) the **`→ super_admin` god-hop is ALREADY CLOSED** — the 07-13 emergency migration (`move1_privesc_emergency_core`) dropped the permissive `user_roles` "Admins can manage all roles" policy, so no plain admin can self-insert super_admin; only owner-gated writes + own-select remain, and `change_user_role`/`grant_tenant_member_role` block the god roles for non-owners. (2) What IS live: **public signup → global `app_role='admin'`** in 3 calls — but this is the *legitimate onboarding flow* (provision_tenant → tenant_members owner → sync trigger → global admin), inseparable from the B2 narrowing. Being closed by **Move 2** (admin global→tenant-scoped): Slice 1 shipped (above); god-role ceiling added to the sync trigger. Load-bearing; in progress.
- **PLATFORM_ASSESSMENT B2 (tenant tables cross-tenant readable/writable via `OR has_role(admin)` bypass).** ⚠️ **Stale-audit correction:** the blast radius is **231 live policies across ~150 tables**, not "~20" — a large undercount. Being closed by **Move 2**: Slice 1 shipped the 4 client-PII tables + set the canonical template; Slices 2/finance (#384/#385) cover the remainder.
- **PLATFORM_ASSESSMENT B3 (21 edge functions authorize with global admin then act via service-role client).** Still open — Move 2 Slice 3 (#386), `requireTenantScope` helper + retrofit. Same class as #149. Depends on the DB-layer narrowing landing first.
- **PLATFORM_ASSESSMENT C1 (password reset queued to Lovable worker that was never deployed).** Still open.
- **PLATFORM_ASSESSMENT C2 (QuickBooks OAuth callback 401s + unsigned state).** Still open.
- **PLATFORM_ASSESSMENT D1 (client portal cannot read own tenant's Playbook — every client sees generic default).** Still open — ~30 lines of SQL per the audit.
- ~~**PLATFORM_ASSESSMENT D2 (action bus has no drainer).**~~ ✅ **CLOSED** — §8 drainer shipped (#164/#165), paige-action-worker on a */2 cron, post-deploy runtime check confirmed fired + succeeded. This was the last brain layer.
- **PLATFORM_ASSESSMENT §2 violations (QuickStatsBar unconditional, OnboardingFlow credit-repair modal, Terms/Privacy CROA disclaimer, /app/credit routes unguarded).** Partially addressed via task #7 verticalization compliance debt (currently deferred per brain-first rule).
- **DRIFT_AUDIT C2 (`provision_tenant` loses agreement gate on rebuild) + C3 (`revoke_platform_access` re-widens on rebuild).** Latent regressions — prod correct, git armed to undo. Still open.
- **DRIFT_AUDIT H1 (agency_team_roles exists only in prod — 5 rows, 7 RPCs).** Still open — data loss on rebuild.
- **DRIFT_AUDIT §4 armed footgun (`db push` remediation trap — 124 ledger migrations exist in no git file).** Still open.

---

## 3. The layering map — "same concept, different names"

Antonio's concern was real. The schema has multiple parallel constructs for the same thing. Recorded here so any consolidation PR has one source to work from.

### 3.1 Skills
| Construct | Location | Status | Purpose |
|---|---|---|---|
| `paige_skills` | table (RLS on) | Live | Registry of skills Paige can invoke |
| `paige_skill_proposals` | table (RLS on) | Live | Proposed skills awaiting approval |
| `paige_skill_runs` | table (RLS on) | Live | Skill invocation log |
| `marketplace_items` | table (RLS on) | Live | Platform Marketplace catalog |
| `marketplace_item_versions` | table (RLS on) | Live | Marketplace versioning |
| `marketplace_installs` | table (RLS on) | Live | Which tenant installed which item |
| `marketplace_install_ledger` | table (RLS on) | Live | Install audit trail |
| `marketplace_install_bundle_links` | table (RLS on) | Live | Bundle relationships |
| `marketplace_vendors` | table (RLS on) | Live | Vendor registry |
| `skill-runner` edge fn | supabase/functions | Live | Executes a skill invocation |
| `skill-forge` edge fn | supabase/functions | Live | Authors new skills |

**Same concept problem:** the Marketplace items and paige_skills are separately-tracked registries. Cowork's earlier "add FDIC/NCUA as Marketplace skills" brief (task #6, deferred) assumed one concept; there are actually two. Any Marketplace-skill build needs to define whether it targets `paige_skills` (Paige's directly-invocable tools) or `marketplace_items` (tenant-installable products) or both. **PLATFORM_ASSESSMENT already flagged this — "Paige has no `skill_search`/`skill_run` tool" — meaning she cannot reach her own skills engine from chat.**

### 3.2 Actions / Automations / Workflows
| Construct | Location | Rows | Purpose |
|---|---|---|---|
| `paige_actions` | table | 16 | The action bus — filed/drafted/approved/executed |
| `paige_action_kinds` | table | seeded | Action-kind registry (draft_subagent_slug, etc.) |
| `paige_pending_approvals` | table | live | Approval queue for drafted actions |
| `paige_approval_policies` | table | live | Per-action-kind autonomy_lane rules |
| `paige_approval_comments` | table | live | Approval discussion thread |
| `paige_approval_queue_v` | view | 0 | Materialized approval-queue view (no RLS — it's a view) |
| `paige_workflow_registry` | table | live | Paige-authored workflow definitions |
| `paige_workflow_runs` | table | live | Workflow execution log |
| `tenant_workflows` | table | 200 | Tenant-authored workflows (probably n8n) |
| `paige_n8n_connections` | table | live | Paige's n8n connection state |
| `tenant_n8n_connections` | table | live | Tenant's n8n connection state |
| `stage_automation_rules` | table | live | Client-stage triggered automations |
| `stage_automation_events` | table | live | Stage automation execution log |
| `growth_automation_targets` | table | live | Growth-page/form automation targets |
| `growth_form_automations` | table | live | Growth-form triggered automations |
| `paige-orchestrator` edge fn | supabase/functions | Live | Sub-agent dispatch router |
| `paige-n8n` edge fn | supabase/functions | Live | n8n bridge |

**Same concept problem:** THREE parallel automation systems (`paige_workflow_*`, `tenant_workflows`, `stage_automation_*`, `growth_*_automation*`) plus TWO n8n connection tables (`paige_n8n_connections` and `tenant_n8n_connections`). §8's action bus and §14's automation-fabric are conceptually one — Paige orchestrates all automations across all surfaces. Right now the schema fragments this. **PLATFORM_ASSESSMENT D2 called this out:** the action bus has 16 real rows but no worker/cron picks up `filed` actions — so §8's core promise ("Client team detects a need → files an action → Owner team drafts → routes to approval") only happens when a human is chatting. This is the single highest-leverage missing piece.

### 3.3 Memory / Recall / Knowledge
| Construct | Location | Purpose |
|---|---|---|
| `paige_prompt_memory` | table | Semantic memory the reasoning engine writes to via `captureToMemory` |
| `paige_prompt_template` | table | Prompt template registry |
| `tenant_knowledge_docs` | table | Tenant-uploaded knowledge base docs |
| `tenant_knowledge_chunks` | table (0 rows) | Chunked+embedded KB content (EMPTY — never ingested) |
| `rag_retrieval_log` | table | RAG query audit |
| `paige_context_loads` | table | Context assembly log |
| `paige_conversations` | table | Conversation memory |
| `paige_chat_threads` (12 rows) + `paige_chat_turns` (103 rows) | tables | Paige chat history (actual conversation storage) |
| `kb-ingest-doc` / `kb-ingest-file` / `kb-ingest-url` / `kb-search` / `embed-text` | edge fns | KB ingestion + search stack |

**Same concept problem:** memory splits across at least THREE separate constructs — Paige's own semantic memory (`paige_prompt_memory`), tenant knowledge base (`tenant_knowledge_*`), and conversation history (`paige_chat_*` / `paige_conversations`). L6 in the brain roadmap says "captureToMemory wired end-to-end" — but memory into WHICH of these? Needs a scoping decision at L6 grounding time. Also: `tenant_knowledge_chunks` is EMPTY — the ingestion stack exists but has never actually ingested. Tenant KB is a hollow promise today.

### 3.4 Departments / Org
| Construct | Location | Status | Purpose |
|---|---|---|---|
| `paige_departments` | table | seeded, unread | §16 10-dept model |
| Hardcoded `["owner_ops","client_experience"]` | LLM tool schemas at paige-ai-chat:4228,4261,4863 | live | Actual routing |
| `paige_subagents` | table | shell + 10 dormant review-crew (L5) | The specialist registry L5 extends |
| `paige_subagent_proposals` | table | live | Forge proposals awaiting approval |
| `paige_subagent_factory_quota` | table | live | L5 forge quota gates |
| `paige_subagent_invocations` | table | live | Sub-agent invocation log |

**Same concept problem:** `paige_departments` was seeded with the 10-dept model **and never queried by any code path.** The LLM tool schemas hardcode 2 departments (owner_ops, client_experience) — so the 9 new departments seeded in the table cannot even be written. §16 is a table-shaped promise the executor was never built for. Building §16 = wire the executor to actually read `paige_departments` + expand the LLM tool schema beyond 2 fixed values.

### 3.5 Subscription plans — the six-way fracture (PLATFORM_ASSESSMENT A2)
Six different sources of truth for "what plan is a tenant on":
| Source | Slugs | Prices |
|---|---|---|
| `Pricing.tsx` (what you sell) | starter / growth / scale | $197 / $497 / $1,497 |
| `create-checkout` (only wired checkout) | starter / professional / premium / enterprise | $47 / $97 / $197 / $497 |
| `subscription_plans` (legacy) | consumer credit-repair | "5 disputes/month", etc. |
| `create-trial-checkout` (not wired) | starter | $49 |
| `stripe-webhook` | standard / premium / vip | — |
| `platform_subscription_plans` (§17-canonical, seeded, unread) | solo / agency / enterprise | $149 / $397 / — |

**Same concept problem:** already tracked by DOCTRINE_197_BILLING_LAYER_TAXONOMY. L1 = platform_subscription_plans (§17-canonical). L2 = the legacy subscription_plans (queued for deletion). Fix per PLATFORM_ASSESSMENT Move 3: make platform_subscription_plans the single source; retire the rest.

---

## 4. Antonio's ticket list — reconciled against master plan

Ticket numbers Antonio shared in chat map to `docs/paige-master-implementation-order.md` phases + PLATFORM_ASSESSMENT items. Not new work; existing plan under different numbering.

### 4.1 Go-live gates (Antonio's flag)
| Ticket | Master plan | Status |
|---|---|---|
| #185 Settings account security (password, 2FA, sign out everywhere) | Phase 2/Move 3 | Partial — #72 password work in-progress |
| #63 Email deliverability | Master Phase 7 #20 | Not started |
| #62 Post-signup welcome + onboarding sequence | Master Phase 7 #20 | Not started |
| #99 Branded tenant invite + signup page | Master security/hygiene | Not started |
| #189 Agency sub-account onboarding provisioning | Master Track S / signup work | Not started |
| #61 Landing copy sweep (broaden from coaching) | Master Phase 9 #22 | Deferred — partially in verticalization compliance debt (task #7) |

### 4.2 Security & §2/§9 compliance
| Ticket | Master plan | Status |
|---|---|---|
| #212 harden `current_user_tenant_id()` (self-writable active_tenant_id) | not explicit in master, load-bearing | OPEN — same class as #149 orchestrator IDOR just closed |
| #108 IDOR sweep across SECURITY DEFINER RPCs | Master Track S #2 | OPEN — the pattern the #149 fix was one instance of |
| #4 MMA OS RLS (22 tables exposed to anon) | Master Track S #3 | OPEN — biggest live security hole in the list |
| #194 admin_app_settings write-RLS + BrokersAdmin gating | Track S | OPEN |
| #206 funding-agents cross-tenant leak | Master §2/§9 #4 | ✅ CLOSED (folded into #149 this session) |
| #176 / #171 / #209 §2 finance-vocab leaks (staff bypass, MCP tagline, legal-doc registry) | Master §2/§9 #4 | OPEN — smaller, batchable |
| #197 nested-agency guard (sub-account self-upgrading child) | Track S | OPEN |

### 4.3 Brain items (already on brain roadmap under different names)
| Ticket | What it actually is | Status |
|---|---|---|
| #82 Paige command center | Surface for L4/L5 output + §16/§8 | Depends on §16/§8 |
| #83 Sales & prospecting suite | Brain application (Paige in Sales dept per §16) | Depends on L5 + insights ingest |
| #91 Multi-round agentic tool loop | L4 phase-4 extension | Partially done (runReasoning shipped; not yet wired as multi-round yet) |
| #93 / #117 Conversation memory + compaction | **This is L6.** | On brain roadmap |
| #204 EPIC: Operationalize $100M Org Blueprint | **This is §16.** | On brain roadmap |
| #190 Paige replicated at every level | L5 + §16 (per-tenant/agency/sub Paige) | On brain roadmap |
| #113 Billing Brain (dunning) | Brain application (Paige in Finance dept per §16) + PLATFORM_ASSESSMENT A8 | Depends on L5 + billing spine |
| #114 Meta lead-gen closed loop | Master Phase 3 #6 | Not started |
| #111 Client Heartbeat / at-risk save play | Master Phase 1 #3 (proof-of-spine play) | Not started — was originally the "prove the bus" moment |

### 4.4 Channels / connectors / infrastructure
| Ticket | Master plan | Status |
|---|---|---|
| #84 Voice / telephony | Master Phase 9 #22 | Not started |
| #64 per-tenant comms (Twilio, subdomains) | Master Phase 7 #20 | Not started |
| #167 / #49 Calendar OAuth (Zoom, Google two-way, Apple) | Master Phase 6 | Zoom done; Google token stored but never read (PLATFORM_ASSESSMENT); Apple not started |
| #173 Calendar polish | Master Phase 6 | Not started |
| #96 / #98 Voice chat config + inline UX | Master Phase 9 #22 | Not started |

### 4.5 Billing / growth (largely covered by PLATFORM_ASSESSMENT A1–A8)
| Ticket | Master plan | Status |
|---|---|---|
| #188 Self-serve plan upgrade | PLATFORM_ASSESSMENT A1 | OPEN — no reachable Paige checkout today |
| #27 Per-tier BYO merchant (Stripe Connect) | Master Phase 10 | L2 checkout exists (/store/:slug), no L1 |
| #113 Billing Brain (dunning) | Phase 2 #5 + PLATFORM_ASSESSMENT A8 | OPEN — first failed charge = silent downgrade today |
| #111 Client Heartbeat | Phase 1 #3 | OPEN |

### 4.6 Design / LMS / verticals / Studio waves
All pure front-end; independent lane; safe to run parallel to brain build; not blocking anything.

### 4.7 Hygiene batch
| Ticket | Notes |
|---|---|
| #79 / #130 Remove Lovable | Documented removed but still on auth-email hook path per PLATFORM_ASSESSMENT C1 |
| #170 Regenerate types.ts | Small, one-shot |
| #179 CI grep boundaries | Part of PLATFORM_ASSESSMENT Move 4 |
| #183 Copy button in chat | Small |
| #196 Mobile AccountSwitcher | Small |
| #195 Marketplace notify-me seam | Small |

### 4.8 The beast — #174 Client Experience epic
Marketplace populates tenant KB+functions · client-portal design + all portal functions live · invite→portal→onboarding→Paige-greets as one pipeline · "View as client" preview · one-click presets · readiness checklist. **This depends on L5 (specialist forge) + L6 (memory) + §16 (10-dept) + D1 fix (client portal can't read own tenant Playbook) + go-live UX pieces (#62/#99/#189).** Not parallelizable. Payoff of the brain build.

---

## 5. Recommended sequencing given both directives

Antonio has two directives that tension each other: (a) "build the brain in its entirety, then clean up everything else" and (b) "get real people on the platform is near-term." Reconciliation:

**Lane 1 — Brain build (current, do not interrupt).** Claude Code continues L5 → L6 → L7-S1 → §16 → §8 → insights → automations. Only a live-customer-facing prod bug interrupts. Currently on-mission.

**Lane 2 — Same-class-as-#149 security fixes (open in parallel, separate crew).** These are structural, not cleanup — every brain layer sits on them:
- #212 (self-writable `active_tenant_id`) — same IDOR class as #149
- #108 (IDOR sweep across SECURITY DEFINER RPCs) — same class
- #4 (MMA OS RLS on 22 anon-exposed tables) — largest live hole
- PLATFORM_ASSESSMENT B1 (global admin → super_admin escalation) — same auth-role class
- PLATFORM_ASSESSMENT B2 (20 tables cross-tenant readable via `OR has_role(admin)`) — same class
- PLATFORM_ASSESSMENT B3 (21 edge fns global-admin + service-role) — same class

**Lane 3 — Money spine + account recovery (open in parallel, separate crew).** These are PLATFORM_ASSESSMENT Move 3 (billing spine end-to-end) + C1 (password reset off Lovable to Resend) + C2 (QuickBooks OAuth). Without these, real people cannot self-serve — go-live is technically impossible.

**Lane 4 — CI pipeline (PLATFORM_ASSESSMENT Move 4).** Prerequisite for lanes 1–3 not silently regressing. Small effort, huge leverage.

**Lane 5 — §2 amputation (PLATFORM_ASSESSMENT Move 2 + task #7).** One PR. Every gate needed already exists. Fastest single move for §2 compliance + attack surface reduction + legal-exposure reduction.

**Sequence in absolute priority order (my recommendation):**
1. **Brain build (Lane 1) stays running** — L5 → L6 → L7-S1
2. **Lane 4 (CI pipeline) ships first among the parallel lanes** — 3–4 days, unblocks safe iteration for all other work
3. **Lane 5 (§2 amputation) ships next** — one PR, days
4. **Lane 2 (structural security) opens parallel** — pull #212 first (same class as #149, we know the pattern)
5. **Lane 3 (money spine + account recovery) opens parallel** — the go-live cash-register
6. **After brain L5+L6+§16 land AND lanes 2/3/5 ship**: unblock #174 Client Experience epic

**Lane 6 — Pure front-end (Studio waves 1–4, design uplift #103, scroll-wall #67, dark-mode #134, LMS #87, portal skins #88).** Fully independent, safe anytime, doesn't collide.

---

## 6. Deprecate / retire

Prior audits already flagged these as dead code / regression traps. Recording here so a consolidation PR can act:
- Second Plaid stack (PLATFORM_ASSESSMENT §3)
- `coaching-reminder-cron` (targets nonexistent table)
- `BrokerComingSoon`, `TasksAdmin` (dead front-end)
- LangGraph orchestrator branch (no seeded agent takes it)
- `complete-signup` (would classify every user into credit/funding persona)
- One of the two Stripe webhooks (they can't both verify against one secret)
- The `Dashboard.tsx` + `AppSidebar.tsx` + ~20 legacy credit components (routed nowhere, contain the hardcoded Personal Credit / Business Credit / BUILD Program / Funding Marketplace sidebar Cowork flagged in verticalization compliance debt task #7)
- `provision_tenant_profile_upsert_fix` — DRIFT_AUDIT explicitly says NEVER commit (recreates removed ungated overload)

---

## 7. Doctrine reminders (from PLATFORM_ASSESSMENT §7 handoff, still valid)

Load-bearing facts about this codebase that reading the code will not reveal:

1. **The Supabase CLI does not work here.** Deploy path is `./scripts/deploy-function.sh <slug> [--no-verify-jwt]`, one function per invocation. *(Note: edge functions now also auto-deploy on merge to `main` via CI — see `supabase/functions/CLAUDE.md` / root §24.)*
2. **`supabase/config.toml` is decorative** — deploy script doesn't read it. `verify_jwt` posture = whatever the human typed. 130 of 220 functions have no config entry.
3. **`docs/sprints/bootstrap-byo-schema.sql` is the real schema artifact.** 22,621 lines, ordered, extracted from prod 2026-07-05. Do not replay 479 migrations.
4. **`admin` is the tenant-owner role, NOT a platform role.** Every `has_role(auth.uid(),'admin')` is global and satisfied by every tenant owner. Correct platform predicate: `is_platform_owner()` / `super_admin`. This one collision is the root cause of most security blockers.
5. **`CLAUDE.md` is the spec, not a style guide.** §2 (no consumer finance in defaults), §3 (banned phrases), §9 (platform vs tenant seam), §10 (Paige-governable via RPC), §11 (primitive layer mandatory), §13 (fire is not a delivery).
6. **Two billing layers (L1 platform / L2 tenant-end-customer)** — `docs/security/DOCTRINE_197_BILLING_LAYER_TAXONOMY.md` is authority. Don't fix L2, build L1.
7. **`@/components/ui/page` is the design primitive layer** — mandatory on new/touched pages. Reference bars: `PracticeOverview.tsx` and `Marketplace.tsx`.
8. **There is no dark mode.** `next-themes` imported, never provided.
9. **The Anthropic gateway is `_shared/claude.ts`.** Legacy OpenAI/Gemini model strings get silently translated to `claude-haiku-4-5`. Paige's main tool loop is on the cheap tier by accident. Telemetry `p_model` is unreliable.
10. **`_shared/model-router.ts` cannot serve the streaming tool loop** — `routedChatCompletion` is non-streaming and returns null on tool use.
11. **RLS-filtered writes return success** — an UPDATE that matches zero rows because of a policy does NOT error. Several code paths log success, fire green toast, do nothing.
12. **`git log -S "<function-name>"` is your friend** — some "never wired" orphans are actually deleted callers.

---

## 7.6 Voice layer — architecture decisions locked (2026-07-20)

**Trigger:** Antonio + Cowork architecture conversation on voice agents post-brain-build. Decisions locked here so when the voice slice is sequenced (post-cleanup-queue, in the "Automations surface" tier of Tier 1 owner priorities), Claude Code has the design input ready and doesn't re-derive.

### 7.6.1 Middleware pick: Vapi

- Chosen over: Retell, ElevenLabs Conversational AI, OpenAI Realtime API, DIY Deepgram-Claude-Cartesia.
- Why: preserves Claude as the reasoning tier (§17), solves the real-time hard problems (WebRTC, VAD, sub-500ms latency, interruption handling), includes phone-number provisioning natively, cheaper per-minute than ElevenLabs Conversational AI, can still use ElevenLabs voices as the TTS backend.

### 7.6.2 Phone number provisioning: Vapi-native default; BYOT-Twilio as premium later

- **Default path (all tenants):** Vapi-provisioned numbers. One vendor, one API, one invoice. Perfect for the first cohort of tenants.
- **Premium path (advanced tenants):** Vapi supports bring-your-own-Twilio for tenants needing vanity toll-free, international coverage, SIP trunking, SMS-on-same-number. Add when a real tenant asks; not a Day-1 feature.
- **Explicitly NOT:** wire Twilio into the platform infrastructure directly. Vapi's telephony layer is enough.

### 7.6.3 Voice agent registry: extend `paige_subagents` with `voice_config`

- Add `voice_config jsonb` column to `paige_subagents` (voice_id, personality, tone, greeting_template, model tier).
- A "voice agent" is a sub-agent with voice metadata attached — no new table, no parallel architecture.
- Tenants create/customize via existing `subagent-forge` (L5, shipped) — same forge that already creates any other sub-agent.
- Persona resolution: existing `get_paige_persona_context` extended to return `voice_config` alongside persona → tenant renames Paige → voice agent inherits the new name automatically.
- Per §16, each of the 10 departments can carry a seeded default voice sub-agent (Sales = warm/professional outbound; Client Experience = welcoming/patient inbound; Finance = gracious/firm retainer reminders). Tenants override with their own via forge.

### 7.6.4 Phone number registry: new `tenant_phone_numbers` table + `/admin/phone-numbers` page

- **Schema:** `tenant_phone_numbers` (tenant_id, e164_number, provider, provider_ref, monthly_cost_cents, assigned_agent_slug, status, created_at).
- **Edge fn:** `provision-phone-number` — calls Vapi API, records the row, appends to tenant's L2 subscription add-ons (rides the money spine from Lane B).
- **UI:** new `/admin/phone-numbers` page — list currently-provisioned numbers, "Add a number" flow (search by area code / toll-free / country → select → provision), assign each number to a voice agent via dropdown.
- Also expose as a marketplace category — a tenant browsing `/admin/marketplace` sees "Phone Numbers" alongside skills, same install-through-subscription pattern as everything else. §12 organize: one home for all tenant-purchasable capabilities.

### 7.6.5 New action-kinds (with autonomy tiers)

Extend `paige_action_kinds` with:

- `voice.outbound-customer-call` — 🟡 confirm default (owner approves script + target pre-dial)
- `voice.outbound-internal-call` — 🟡 confirm default (calling internal team members: escalations, approval requests, urgency signal, distance-friendly reach)
- `voice.outbound-internal-call.c_suite` — 🔴 off default (C-suite outreach requires owner-explicit enable; trust here is graduated)
- `voice.inbound-answer` — 🟢 auto default (front-desk greeter picks up + intake)
- `voice.follow-up-call` — 🟡 confirm default (scheduled callbacks)
- `voice.emergency-escalation` — 🟡 confirm default (P0 incidents, immediate approval requests)

All route through the existing `file_action` → `paige-action-worker` → `advance_action` lifecycle (§8, shipped). Same drainer, same audit trail, same approval routing. Zero new architecture — voice is just a new modality on the existing action bus.

### 7.6.6 In-app voice-back (Paige speaks in the chat UI)

- Separate from the phone-call stack — different plumbing, different vendor path.
- New small edge fn `paige-tts` (Cartesia or ElevenLabs for voice quality) that streams Paige's chat responses as audio when the tenant toggles voice-output on.
- Not required for the phone-call features; optional user preference.

### 7.6.7 Cost + billing model

- Voice minutes metered per-tenant, aggregated per billing period.
- Rides the L2 subscription (Lane B money spine) — appears as a line item alongside plan + add-ons.
- Premium plan tiers get more included minutes; overage billed per-minute at a rate lower than Vapi's list price (small margin for the platform).
- Phone-number monthly cost is a separate line item under tenant's L2 subscription.

### 7.6.8 Sequencing when voice gets built (post-cleanup-queue)

Not blocking any current lane. When voice is sequenced (Tier 1 Automations surface phase), the natural slice order:

1. Vapi account setup + first API smoke test
2. Schema extension (`voice_config` on `paige_subagents` + `tenant_phone_numbers` table)
3. First action-kind (`voice.outbound-customer-call` to Sales dept, one path)
4. §32 live: one real outbound call to a test number, transcript captured, autonomy-lane approval flow verified end-to-end
5. Fan out: `voice.inbound-answer` + Client Experience dept
6. Then: `voice.outbound-internal-call` + management-department integration
7. Then: `/admin/phone-numbers` self-service UI + marketplace category
8. Then: `paige-tts` in-app voice-back
9. Then: BYOT-Twilio premium option

### 7.6.9 What this section does NOT change

- No brain-build layer changes. Voice extends what's shipped (`paige_subagents`, `paige_action_kinds`, action bus, drainer, persona resolver, marketplace, L2 billing) — no rearchitecture.
- The cleanup queue sequencing stands. Voice comes AFTER cleanup ships.
- Not in the pitch/prospectus as a current capability until it's actually built and §32-verified live per §7.5.3 honesty check.

---

## 8. Update rule for this doc

- End of every brain-build session: update §1 (state) + §2 (what changed).
- When a prior audit's finding is remediated: mark ✅ in §2, keep the original audit intact.
- When a new "layering" pattern is discovered: add to §3.
- When Antonio surfaces a new ticket list or reorganization: reconcile into §4 (don't create a fresh backlog).
- **Do not rewrite the source audits.** They capture point-in-time state and are still valuable as history.
- **Do not create new handoff docs for tactical fixes** — those go in the Cowork task list. Handoff docs are for cross-session load-bearing work only.

This is an update — a living rollup, maintained here, not re-derived each session.
