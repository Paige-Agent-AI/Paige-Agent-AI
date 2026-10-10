# PAIGE Conversational Loop + Dynamic Capability Awareness — R0 grounding

## 2026-10-10 CL-3 slice — the authorized durable-continuation eligibility read (C4d)

The C4d foundation's missing runtime half: `projectDurableContinuation` had zero runtime
callers because nothing selected the envelope's internal fields under fresh authorization.
Migration `20270602000412_int304_durable_continuation_read.sql` adds
`read_paige_durable_continuation(thread, intent, work)` — authenticated-only, validating
exactly like the frozen durable-observation reader (owned active thread with the CURRENT
intent, caller-bound work row, the document/research class, CURRENT owner/admin permission,
exactly-one durable_accepted protected effect) and returning the pinned envelope fields with
the canonical objective read from the frozen request payload. The edge adapter
`_shared/durable-job/continuation-read.ts` adds the observation-style identity re-read and
fills the projection's context booleans from REAL sources only: the budget ladder
(`resolveCeiling`/`accruedSpendToday`/`enforceBudget` — unknown accrual is never allowed),
Spine `action.chatTool` registry membership, and the SQL-derived approval-pending
(blocked + approval_expired). `interrupted`/`superseded`/`alreadyContinued` are false by
construction and said so in-source: the SQL refuses a superseded intent before returning, a
stable status read carries no interruption brake, and no continuation-consumption seam
exists yet — that seam is the gated C4d runtime. The interactive status path's
`durable_work` block now carries `continuation {eligibleForContext, state, reason}`:
bounded terminal CONTEXT (e.g. "the document finished and verified — the objective can be
continued"), never dispatch, wake, settlement or continuation permission. INT-346 stays
DRAINING; effectful continuation remains disabled. Proofs: native read check
`scripts/int304-continuation-read-check.mjs` (20 cases: field derivation, permission/
tenant/actor/intent/archival gates, approval-pending only from a real expired approval,
blank objective refused, duplicate-effect lineage refused, foreign capability class,
service/anon refused) CI-wired; adapter vitest 17/17; Deno clean; tsc ratchet 10=10.
Also folds the CL-2 review's P3: the observation reader now returns the record's own
`kind` instead of a hardcoded literal, so the future `refused_before_dispatch` producer
reads correctly without touching this reader.

## 2026-10-10 CL-2 slice — canonical failure observation (the non-application record)

The first #1807 continuation slice by the new agent: the canonical refusal/non-application
record `classifyPipelineObservation` has been waiting for. Migration
`20270602000430_int1807_pipeline_non_application.sql` (renumbered from 411 after the production frontier advanced to `…0423` mid-flight — the chronic frontier race; clears main, prod, and open-PR claims through `…0428`; originally numbered above main `…0304`, the
deployed production frontier `…00401` and open-PR claims through `…0410`) adds the
`pipeline_metadata_non_application` table (RLS on, no policies, all client grants revoked;
one record per effect), a service-only write
`record_pipeline_metadata_non_application(thread, intent, token, sqlstate)` and an
authenticated-only read `read_pipeline_metadata_observation(thread, intent, effect)` that
composes the frozen discovery + original resolvers before returning classifier-shaped
evidence for an exactly-matching record. Exactly ONE provably-safe producer class is wired:
a database-ANSWERED refusal of the single-RPC Pipeline door call (`databaseAnswered`/
`refusedByDatabase` doctrine — one transaction rolled back whole), recorded best-effort at
the C4a pinned dispatch seam where the card token is held. Transport failures, timeouts and
lost answers are never recorded and stay `outcome_unknown`; `refused_before_dispatch` needs
the door's own typed vocabulary (Pipeline-owned) and stays reserved. The status path now
upgrades an unknown readback through
`_shared/pipeline-metadata-observation.ts` (triple scope recheck; the classifier's
scopeEpoch comparison is tautological by design and said so — the five caller-known fields
carry the real cross-check). Observations remain observations: nothing settles, retries,
releases or activates, the successor-write brake stays controlling, and recording the
gated model-emit path (non-pinned calls) is a named follow-up. INT-346 remains DRAINING.
Proofs: native rollback check `scripts/int1807-non-application-check.mjs` (derivation,
idempotency, transport-code refusal, lineage-gated reads, drifted-record refusal, ACLs;
`--negative-control` fails without the migration), handler composition
`scripts/int1807-observation-handler-check.mjs` (failing-first against the unmodified
handler: `actual: 'outcome_unknown'`), adapter unit 18/18, family vitest 71/71, tsc ratchet
10=10, no new Deno diagnostics. Both checks are CI-wired beside their siblings.

## 2026-10-10 program acceptance matrix — handoff grounding, before any code change

INT-304 handoff grounding by the new Conversational Loop agent, verified read-only against
main `024df3e3e` (the live rollout row re-read the same day: `active=false`,
edge_head/drain_evidence_sha256/activated_at NULL, zero threads holding
`interactive_executor_intent`, one owner conversational-admission thread from his own prod
test). GitHub at grounding: #1807 CLOSED (its automatic-settlement objective remains partial —
see the row below), #1822 OPEN (the security gate), #1832 OPEN (the QA principal). LIVE =
merged and mounted with its guards; PARTIAL = proven subset with the missing part named;
BLOCKED = complete but gated on an external dependency. Every authenticated-runtime claim
stays PROOF OWED under #1832; no row below upgrades one.

| stage | verdict | evidence |
|---|---|---|
| C0a capability projection | LIVE | #1697; projection manifest + CI declaration lint |
| C0b registration burn-down | PARTIAL | #1874/#1877/#1878 registered the incumbent adapters (declaration baseline 80→61 at #1874, →1 at #1877 — only the Operator `propose_action` producer remains at this ref); convergence continues incrementally — no rebuild |
| C1 turn contract + C1b shared reader | LIVE | #1710/#1716; `paige_turn` frames, `_shared/paige-turn`, `src/lib/paige-stream` |
| C2a/C2b tool lifecycle steps | LIVE | #1719/#1729; per-tool running/done steps pinned by `c2-working-lifecycle` and the handler suites |
| C3 living response | LIVE | #1744; owner-approved frozen design (§28); C3b parity items open (Studio/operator client wording, craft residuals) |
| C4a approval resume | LIVE (harness) | #1762; authenticated drive owed (#1832) |
| C4b governed door resume | LIVE (harness) | #1766; CRM door driven real, Sales/publish doors modelled; preview-bound proposals and the crm cycle-nonce fix open |
| C4c ASK_USER resume | LIVE (harness) | #1771; Studio reply binding and Operator prose questions open |
| C4d durable-work continuation | PARTIAL | `projectDurableContinuation` is a pure eligibility projection with zero runtime callers (by design); `read_paige_durable_observation` is live (#1874); effectful continuation is blocked by INT-346 |
| C4e Deep Research durable adoption | PARTIAL | `prepare_paige_research_work` blocked envelope live (#1862, `research_execution_not_enabled`); no worker or dispatch path by design |
| C4f authenticated acceptance | BLOCKED | `scripts/proof/int304-authenticated-observation.mjs` complete and unit-tested; requires the #1832 QA fixture |
| C5 specialist coordination | PARTIAL | roster-driven labels shipped (`specialist-step-label.ts`, `SUBAGENT_FRIENDLY` retired); delegation-status events, refusal propagation and parallel consults open; D2 owner-reserved |
| C6 contextual intelligence | PARTIAL | 4/5 ORIENT sources wired (owner memory confirmed-only, Research metadata ≤3 rows, Knowledge, business context; Mind domain-scoped Integrations Mind only); INT-326 C6 consumption dials not yet applied |
| INT-346 server-issued settlement | LIVE / DRAINING | #1823 receipts live; rollout `active=false` |
| INT-346 typed-Chat P0 restoration | LIVE / OWNER-ACCEPTED | #1899 conversational admission; the owner tested production typed Chat 2026-10-10 |
| #1807 unknown-effect reconciliation | PARTIAL | classifier + canonical original discovery + authenticated readback + dispatch brake live (#1859/#1871/#1874/#1878); the failure/refusal observation producer and every settlement/release path are absent (gated) |

Standing gates, unchanged: #1822 blocks PATH A activation (per-execution authoritative
shutdown records for pre-rollout generations including v358, or a Supabase control-plane
attestation); #1832 blocks every authenticated-runtime PASS; D2 (tool-less consult authority)
is owner-reserved. Nothing in this matrix re-litigates them.

## Final C0b owner-only model exposure correction

The existing owner-only gate never permits automation_set_grant or automation_set_state from
Chat: auto clamps to confirm, confirm refuses before fingerprint/approval redemption, and off
refuses before dispatch. Both obsolete model schemas are retired. Exactly thirty schema lines
are removed; owner Settings, catalogue, backend dispatchers, labels and classifications remain
unchanged. Injected or historical calls remain denied. The original eight non-vacuous exposure
checks failed before the deletion (1005 PASS/8 FAIL) and the completed handler passes1013/0.
Focused document/resource tests pass29; declaration census is187 surfaced/186 declared/1 legacy/
0 disagreements, with94 retained inline model declarations.

The policy guard initially failed two stale-definition checks. It now recognizes only these two
retained owner-only denials after validating the actual policy import, unconditional clamp,
off brake, early owner-only continue and later retained dispatcher. Re-exposure, missing denial,
classification downgrade and changed control bindings fail. The existing policy and all owner
surfaces are retained, not deleted or weakened. Five new frozen-source controls cover re-exposure,
clamp, refusal and policy downgrade; only twenty-eight verified context fingerprints change.
The one remaining legacy registration is the Operator pending-decision producer propose_action;
Operator is outside this Solo assignment and its approval authority is not reinterpreted.

## Final incumbent document registration correction

Current-source tests first failed on the missing document submission descriptor and discovery
parity. The completed metadata-only correction passes twenty-nine focused tests, strict adapter
types and six source mutations covering caller receiver, intent, thread, raw payload and Studio
authority. The declaration guard reports189 surfaced/186 declared/3 legacy/0 disagreements.
This release now registers fifty-eight incumbent tools. The canonical long_form outcome remains
unchanged; same-intent submission may wake an existing worker, and neither submission nor a lost
response proves artifact completion or an exactly-once external effect. No runtime dispatch or
permission changes are included. Final composition review, exact-head CI, merge, deployment and
authenticated acceptance remain separate release gates.

## Original C6: prior recorded Research metadata in ORIENT

The remaining Agent Intelligence source contract stays with its existing owner. Current
PlatformIntelligence consumes operator-only fleet metrics and trace-tail; trace-tail also writes
an audit row. Solo Sub-Agents supplies inventory, not advice. Existing prompt memory has no
surface-owned projection of dated, attributable workspace advice with evidence eligibility.
Those interfaces are not substituted for tenant ORIENT. Generalized Mind and Research findings
also retain their existing source-owner contracts; no parallel intelligence projection is added.

The existing caller-JWT `list_workspace_research(3,0)` now supplies a bounded historical metadata source to the existing tenant Chat context. It retains the canonical workspace-wide member/agency/admin standing of `current_user_tenant_id`; fresh caller, current workspace and active caller-RLS tenant checks surround two consistent canonical reads. No initiating-actor-only permission is invented over the existing Research workspace read.

At most three quoted, sanitized titles/dates and recorded labels cross into ORIENT with the shared untrusted-data notice and protected-content hold. These are prior stored metadata, not findings, source verification, current objective completion or permission to dispatch/resume. Empty history supplies no metadata. Failed or revoked reads retain a typed degraded result and an explicit fixed availability notice. Client and Operator seats perform no history read. Research owns the producer, result/citation eligibility and durable linkage; this change does not alter them or generalize Pipeline/Integrations Mind.

Failing-first metadata-source stub RED10/34 then GREEN38/38; loaded actual handler missing-wiring RED984 PASS/2 FAIL then GREEN986/0. Independent preliminary review requested explicit degraded-notice and Operator no-read controls. That run exposed three unchanged C2 streaming regressions (986 PASS/3 FAIL): a fixed unavailable notice incorrectly triggered private-evidence holds. The guard now holds only actual available metadata; final actual-handler GREEN989/0 preserves the existing streaming assertions. Strict adapter types and diff checks pass. Fresh-main composition, independent NON-AUTHOR final-head review, required CI, deployment/readback and genuine authenticated acceptance remain separate gates. Existing INT-304/R0 owns this integration; no new program record, architecture or provider lane is created. INT-346 remains DRAINING; effectful C4d/C4e, C4f authenticated acceptance, owner-reserved C5 D2 and broader five-source C6 acceptance are not claimed complete.
## 2026-10-09 original-operation discovery release

PR #1878 merged as `35fbb19aa8892862f8dfd5c34325fcf8565141c7`, reviewed head `e3873d6a5e83953cd43c92c34be15035e171b446`. Independent NON-AUTHOR SHIP, all eleven exact-head checks and both Vercel statuses passed against fresh main `2f9e6e36`. Ordinary status now derives the original governed Pipeline effect from protected terminal/card lineage and independently reads its authoritative outcome. A late authorization change withholds the result; ownership is never settled or released by an observation.

Migration15 and its stable, authenticated-only function ACL/body are verified in production (body MD5 `018249f6c56b7ce701d0aa59672b55f1`). Migration deployment run `37871845445` and Edge run `37871845364` succeeded. Chat v374 retains JWT verification; three changed deployed source hashes match the reviewed tree. Vercel production `dpl_26VJxZNT4LXTXm6xQrKazeCDvCpx` is READY at the exact merge. Full source hashes and test evidence are recorded in PR #1878 comments `6072492010`, `6072506824`, `6072628980`, `6072653986`.

Rollout `active=false`, `activated_at=null`: INT-346 remains DRAINING. Authenticated Solo/Live acceptance and owner acceptance remain UNVERIFIED. This does not complete #1807 automatic settlement, effectful C4d/C4e continuation or the original program.

## Continued original C0b convergence — incumbent adapters only

The final safe composition also includes the original C6 historical Research context integration above, within this same release candidate. Incoming Model Fabric/read-only status ancestry and the new context source are verified with narrowly updated context fingerprints; all incumbent metadata and original dependency pins are retained. The source suite now passes147 controls, with eleven prepared authenticated-driver controls,38 Research metadata units and989 loaded-handler checks. Genuine source-helper mutation and streaming failures were repaired without widening executor authority. Final immutable review, hosted CI, merge, deployment/readback and authenticated acceptance remain distinct release gates.

Required CI initially rejected modifying the previous release’s attestation: this gate requires a newly added evidence record. The historical durable-observation record is restored from main; the mandatory current attestation is docs/evidence/ui-delivery/conversational-loop-incumbent-capabilities.md, within existing INT-304. No new program record or check waiver.

This candidate registers existing CRM, Pipeline, Team, Calendar, business-profile, Research,
Communications, specialist, Funding and Studio adapters without changing their implementations.
Existing risk, canonical approval, current seat, readiness and hidden-tool visibility remain the
contract. Recording a callable adapter is not authenticated customer acceptance. Provider calls,
cache writes, transcript persistence, expiring archive tokens, proposal staging and partial outcomes
are described explicitly; no new retry guarantee, receipt, provider route or execution authority is
introduced. Frozen legacy-to-Spine projection regressions compare current seats and autonomy lanes.

Routing remains the existing Harness/Spine/Orchestration/Trust/Rail path: Conversational Loop owns
registration and result consumption; each department retains artifact/provider production. The
same declarations support the shared capability interface rather than a second conversation
framework. The existing read-only authenticated acceptance runner is prepared, not executed.
Its genuine session and caller/tenant checks do not activate or settle a held executor.

The initial fifty-seven-registration candidate retained four legacy contracts. Current-source
verification corrected one stale historical explanation: document_generate is excluded from
Studio's tool scope, absent from its auto list and explicitly refused by its handler. Its existing
caller-JWT document submission can therefore be registered without changing approval or dispatch.
The additional descriptor retains the Research/Knowledge discovery category and leaves the
canonical long_form durable outcome row unchanged. At that intermediate head three exact
contracts remained unreduced. The two owner_only automation setters are now retired from model
exposure as described above, while their refusal policy and owner surfaces remain intact;
propose_action also persists only a pending operator decision and intentionally skips preconfirmation; the current Spine mutation contract cannot represent that producer without duplicating approval. Its eventual send retains the separately governed execute-approval/send-message path.
No risk/type/approval expansion or guard exemption is used to erase that debt. Deep Research's
incumbent Chat branch still calls its synchronous provider endpoint; the canonical durable
preparation contract is available separately. The conversational preparation/dispatch/resume
handoff remains unimplemented and gated, with Research retaining its provider/result production.
INT-346 clearance, C4f signed-in acceptance and C5 D2 are separate from this metadata delivery.

Fresh composition with main163cca44 and reviewed observation14 passes127 source-contract controls plus11 authenticated-driver doubles (138 total), fourteen affected unit suites147 tests, four existing projection/continuation suites124 tests, actual conversational memory/approval/interruption/Metrics handler976 tests, declaration189/185/4/0, registry192 and strict adapter types. The independent exact65c06c7b1 review is SHIP after EOF whitespace repair; the subsequent c022895b6 merge adds only reviewed Preview recovery evidence from the observation release. Hosted exact-head CI, merge, deployment and authenticated acceptance remain owed.


## 2026-10-08 C0b existing-capability convergence and durable status consumption

This nineteen-registration/read-only observation slice shipped in PR #1874 at main6e1fbb6cc38a525fd4bf02ae50664b68d1be6996. Independent SHIP and exact-head required CI passed; migration14, reviewed function ACL/body and four changed Edge module sources are verified in production, Vercel READY. Rollout active=false/activated_at=null; INT-346 remains DRAINING. Authenticated acceptance and effectful continuation are UNVERIFIED. The candidate wording below records its original bounded implementation, not a claim of complete runtime continuation.

The next candidate consumes conversation-bound durable observations in the incumbent status
path, with no execution/resume authority. See the C4 record and durable-job contract for exact
binding, artifact lineage and failing-first race evidence. Document's derived work intent is
preserved; Research requires canonical work-linked sources and results rather than inference.

C0b converges existing Planning/action-bus and stored-state reads into Spine. Existing Chat
emission, caller-JWT execution, role admission, readiness and discovery visibility are preserved.
Declarations carry explicit seat authority; old gates remain conservative fallbacks. Existing
declaration omissions are recorded additively in the incumbent discovery baseline, while new
missing or weakened seat declarations fail lint. `action_get` remains excluded from self-description.
Inline stored reads point to their existing Edge handler, not a newly invented public executor.
AST proof binds the actual dispatch branch, unshadowed caller-JWT factory, allowed read methods,
scope pins and closed projections; write/provider/client-substitution mutants fail.

Current batch: nineteen existing tools converged; domain debt72→53, declaration baseline80→61.
The five existing Planning writers retain ordinary risk, canonical Chat approval, member Chat
admission and their narrower RPC rules; update remains hidden. Their declarations explicitly
record absent create deduplication and update/rearming retry limits, rather than inventing safety.
Planning declarations RED9→GREEN9; combined registration/projection proof84 tests and native
binding mutation proof13 tests PASS. Declaration self-test39 PASS; actual188 surface/127 declared/
61 baseline/zero disagreements and registry134 PASS, including the registry mutation self-test.
Metadata `chatBinding: LIVE` records an existing callable seam; maturity remains PARTIAL and does
not establish signed-in acceptance. This work changes no department implementation or activation.
Merge, migration persistence, deployment, production readback and authenticated acceptance remain
separate pending evidence states for this candidate. Original C4 effectful runtime and owner-reserved
C5 D2 remain gated, and five-source C6 coverage is not claimed complete.

## 2026-10-08 safe runtime composition — C4 observation and C6 eligible memory

The existing authenticated interactive status branch now optionally observes the original Pipeline
effect through the reviewed caller-bound canonical resolver/readers. The six deterministic status
tests failed three assertions against legacy behavior and pass after enrichment; real-handler
controls cover DRAINING, held executors, foreign tenant/actor, stale versions, missing receipts,
revoked permissions and forged effects with zero writes, provider calls or executor releases.
Executor settlement remains solely canonical and independent of outcome observation.

C6's owner-memory ORIENT projection now admits explicit confirmed knowledge only. Candidate,
corrected, retired and unclassified rows and data accompanying read errors are excluded. Original
source identity/time and captured server scope remain typed; the existing workspace fence clears
both prompt and typed data. Owner preference priority preserves its zero value; client recall and
automatic proposed writes are unchanged. Actual-handler RED: 953 passed/3 failed, priority RED:
957 passed/1 failed; final GREEN: 958 passed/0 failed. Adapter/context tests: 24 passed, strict types
passed. This does not implement or claim all five C6 source integrations.

This candidate is independently safe while INT-346 drains, but does not complete #1807 automatic
settlement, C4d/C4e effectful continuation, authenticated C4f acceptance or the original C0a–C6
program. Review/exact-head CI/merge/deployment are recorded as they occur. Signed-in Solo and owner
acceptance remain UNVERIFIED. The broader C5 D2 authority decision remains reserved to the owner.

**What this is.** The R0 grounding return for the owner handoff of 2026‑10‑04 ("PAIGE Progressive
Conversational Turn Experience" + "dynamic capability awareness"). Grounding and architecture only —
**no runtime code changes in this PR.** It is a delivery record over the canonical homes (Spine
registry, Capability Kit, capability‑status resolver, durable‑job contract, chat completion matrix),
**not** a new registry, Harness, orchestrator or source of truth.

**Read on.** `main` = `39d5c956` (#1692), 2026‑10‑04. Five read‑only specialists (turn lifecycle ·
client consumers · approvals/durable/sub‑agents · capability manifest · registries) + integrator.
Every load‑bearing claim below was either cited by a specialist with file:line or re‑checked by the
integrator; the integrator's own re‑checks are marked **[verified]**. Production numbers come from
read‑only queries against prod (`xygzykjyynhzqytbqnzu`) on 2026‑10‑04.

**Method (Flow‑by‑Flow).** Mode: Existing Project / Audit. Depth: **Deep** (cross‑flow state, a
major UI change ahead, persistence, authority). Product paradigm: `app`. UI work (C3) is gated on
**Impeccable** + a `flow-prototype` the owner sees before production (owner instruction 2026‑10‑04,
§00).

---

> **Status (2026-10-04).** R0 accepted by the owner; sequence C0a→C6 approved with rulings (decision log).
> **C0a** delivered in PR #1697 — projection-based capability awareness, tenant-role authority, discovery CI.

## 0. The five findings that decide the design

1. **The handoff's named "under‑claim" was closed — and has re‑opened in a new shape.** Research,
   documents, save‑to‑Knowledge, planning and delegation were added to the manifest on 2026‑09‑12
   (`chat-completion-matrix.md` cross‑cutting #1). But the manifest is still a **hand‑written array
   of 21 families** (`_shared/paige-capability-status/signals.ts:139-249`), and it has drifted again
   since: it calls `team.manage` "planned" while `member_grant_role` (`index.ts:5990`) and
   `team_invite_member` (`:6076`) ship **[verified]**; it says "no governed move‑a‑deal write" while
   `deal_move_stage` is in `crm-command/catalog.ts:22` **[verified]**; it offers
   `crm.advance_journey_stage` in chat although no chat tool of that name exists **[verified]**; it
   calls `comms.send` planned while `calendar_link_send`, `agreement_send`, `billing_send_invoice`
   ship; it omits Studio/Vibe, Sales invoices, ~30 CRM writes, calendar, agreements, automations.
   **The owner's thesis is proven by the repository's own history: a hand list drifts every time a
   tool ships.**
2. **The right descriptor already exists — nothing reads it.** The Capability Kit
   (`_shared/capability-kit/types.ts`, `defineCapability()`) carries almost exactly the handoff's §7
   descriptor (identity/domain/owner/human surface/description · input schema · effect · risk ·
   approval · required permission · server tenant scope · availability resolver · provider binding ·
   idempotency/readback · receipt). 17 declarations; its only runtime reader is
   `sales-invoice-command`. The Spine registry (91 capabilities, 85 with a `chatTool`) is the
   canonical *existence + governance* list but has **no** model‑facing description, availability or
   role field. The manifest reads neither (it looks up Spine `maturity` for 11 keys, three of which
   don't exist in Spine). `governance-seam-convergence-plan.md` §4a records the same gap from the
   execution side.
3. **CI already forces registration of new tools.** `lint:chat-tool-registry` (inline tool names
   may only shrink, baseline 96), `lint:capability-declaration` (every model‑surface tool has a
   Spine `chatTool` or sits in a shrink‑only baseline of **80**), `lint:action-risk`,
   `lint:tool-catalogue`, `capability-kit-lint`. So the "adoption contract" the handoff asks for is
   ~70 % built. **The missing 30 % is that the manifest — what PAIGE believes she can do — is not
   derived from what CI forces developers to declare.** Close that and new capabilities appear in
   PAIGE's self‑knowledge with no conversation‑layer change.
4. **The dead air is mostly self‑inflicted buffering, not missing architecture.** On the main tool
   path every model round is read to completion before anything is forwarded (`consumeRound`,
   `index.ts:8514`); a no‑tool answer is stored (`finalChunks = allChunks`, `:14626`) and replayed in
   one burst after the loop (`:15009-15010`) **[verified]**. Prod, 30 days: the `chat` model call
   takes **p50 3.65 s / p90 12.8 s** to *finish* (trace measures to end of stream, `claude.ts:683`)
   — so a plain answer shows **zero characters** for that whole time, on top of unmeasured context
   assembly (up to 4 sequential embeddings, persona/context RPCs, an optional pre‑flight fold at
   p50 4.2 s). Each further tool round adds p50 3.4 s / p90 13.9 s. Only the tools‑free closing call
   streams live. There is no acknowledgement frame of any kind.
5. **There is no "resume the same objective".** Approval is a new turn in which the model must
   re‑emit the call (`index.ts:9366-9433`) while the system prompt simultaneously tells it never to
   re‑emit an approved action (`:5438`) **[verified]**; durable document work completes by inserting
   a canned "Your document is ready" turn without re‑invoking PAIGE (migration `20270418000000:460`);
   the only ask‑the‑user tool (`ask_choices`) exists in Studio only. Deep Research (another lane,
   build in progress past M0) is contracted to adopt the same `paige_durable_work` envelope
   (`docs/brain/paige-durable-job-contract.md` §3), so **the loop's resume design is the seam Deep
   Research plugs into** — it must land as one shared mechanism, not two.

---

## 1. Current `paige-ai-chat` turn lifecycle

`supabase/functions/paige-ai-chat/index.ts` (16,267 lines; one file). In order:

1. `serve` (784) → JWT auth (790–812) → trace ctx (868–887) → rate limit 20/min (890–901) → zod body
   (477–590, parsed 903–915; 50‑message window).
2. Optional Live runtime (917–981) → client‑scope authorization (1043–1102; refusal returns a fixed
   3‑frame SSE at 1167–1189) → portal Rail event (1204–1237) → session‑summary JSON mode (1240–1434).
3. Attachments/documents (1440–1647) → actor tier `getActorTier` (1670) → URL auto‑fetch (1677–1706)
   → client + operating memory, preference detection (1729–1955).
4. Persona/workspace `get_paige_persona_context` (1982–2009) → context reads incl. KB/RAG/tenant
   knowledge with three embeddings (2033–2350) → protected‑content latches (2391–2732) → domain
   identity, departments (2741–2918).
5. Prompt constants (2929–4597) → autonomy resolvers (4604–4635) → **capability manifest gathered**
   (4663–4717; block built 4844–4852 only for a tenant, non‑client seat) → team/readiness/presence/
   authority/social/mission/n8n/integrations blocks (4727–4834).
6. `aiMessages` assembly (4910–4936): persona → voice → core → context blocks → **capability block
   (4928)** → core prompt → narration instruction (4935). Operator briefing spliced at 2 (4956–4961).
7. User turn persisted `paige_chat_turn_append` (5132–5142) → pre‑flight compaction fold (5165) →
   Studio swap (5181–5262) → rolling summary (5283–5296) → admin operator context (5339–5558) →
   message mapping (5571–5645).
8. Tool list built (5647–7308) → declined confirmations cancelled (7567) → Studio `ask_choices` +
   narrowing (8271–8306) → `substantiveTurn` model pick (8344) → pre‑egress scope check (8357).
9. **First model call** (8411–8433). `Response` returned at 15230 with a `ReadableStream` that runs
   the tool loop (8510–15230). Document turns take a separate no‑tool path (15233–15600).
10. Close: final scope check (15106) → client‑seat withhold (15135) → `releaseContent` (15160) →
    assistant turn persisted via `waitUntil` (15175; `persistAssistantTurn` 5307–5334).

## 2. Current SSE frame taxonomy (server → client)

All `data: <json>\n\n`. Producers in `index.ts` unless noted.

| frame | shape | producer | notes |
|---|---|---|---|
| content delta | OpenAI `{choices:[{delta:{content}}]}` | replayed provider chunks 15010; closing stream 15033; doc stream 15578; fixed sentences (14832, 15057, …) | provider chunks from tool rounds are parsed, never forwarded |
| `[DONE]` | sentinel | 1182, 14866, 15049, … | |
| `paige_step` | `{id, round, seq, kind:"thought"\|"action", label, group, status, detail?, ts}` | 14503 (`emitStep`), 14692 (via `emitContent`) | see §3 |
| `paige_phase` | `"writing"` | 15008, 15535, 15576 | only value emitted |
| `paige_compacting` | `{state, pct?}` | collected 5166, flushed 14602/15275 | only pre‑answer frame that exists |
| `paige_confirm` | `{tool, summary, fingerprint?, command?, idempotency_key?}` | 14972 | approval card |
| `approval_queued` | `[{id, summary, category, contact_id}]` | 14969 | action‑bus lane |
| `paige_approval_outcome` | `{actions:[{fingerprint, outcome, note?}], note?}` | 14579 | once per approval turn |
| `paige_crm_result` | `{action, outcome, readback, receipt_recorded, …}` | 14973 | |
| `paige_artifact` | `{kind,id,title,url[,artifactType,tenant_id]}` | 14976 / 14988 | |
| `paige_choices` | `{prompt, options[], multi, allow_other}` | 14659 | Studio turn‑ender |
| `paige_preview` | `{kind,title,blocks,theme}` | 14980 | Studio |
| `extraction_proposal`, `sync_status` | — | 15003; doc path | |
| `client_scope` | `{status:"refused",…}` | 1180 (14597/15272 unreachable) | |
| `paige_withheld` | `true` | 15147, 15453 | client‑seat withhold |
| `paige_live_error` / `paige_live_output` | — | 15201 / `_shared/paige-live-runtime-proof.ts:97` | Live only |
| `paige_thinking` | — | `claude.ts:636,649` | **never requested** (`STUDIO_THINKING_ENABLED=false`, 8333) — private reasoning is not forwarded today |

No in‑stream generic error frame; pre‑stream errors are JSON responses.

## 3. Current `paige_step` producers

- **Thought** (14681–14693): `id "t:<round>"`, label = `summarizeThought(content)` (14360–14376:
  strips snake_case/§/uuids/markup, caps 200 chars) — i.e. a sanitized summary of the model's own
  *visible* round text, produced only on rounds that call tools. Held on protected turns.
- **Action** (14759–14766): label/group/detail from `describeStep` (169–405), which suppresses noise
  (`web_fetch`, policy rejections, `needs_confirm`, forbidden seats, internal drafts). **Emitted after
  the whole round's tools finish** (loop 14728–14768), never as a tool starts. Never held.
- No other producers (searched `supabase/functions` for `paige_step`, `paige_phase`).
- Labels for sub‑agents come from a hard‑coded 3‑entry `SUBAGENT_FRIENDLY` map (164–168).

## 4. Current client consumers

**Four independent hand‑written SSE parsers for the same endpoint** (plus Broker's own, other endpoint):

| parser | file | frames handled | live? |
|---|---|---|---|
| `PaigeAIChat.streamTurn` | `src/components/dashboard/PaigeAIChat.tsx:1030-1544` | all of the table above except Studio frames | Solo workspace + Command Center |
| `PaigeChat` | `src/components/app/PaigeChat.tsx:449-484` | step, phase, sync_status, withheld, delta | client portal `/app` |
| `useOperatorChat.run` | `src/operator/data/useOperatorChat.ts:168-226` | `paige_confirm`, delta (drops the rest) | `/operator` |
| `useStudioChat.send` | `src/solo/studio/useStudioChat.ts:137-211` | step (appended, not upserted), choices, artifact, confirm, approval_outcome, preview, delta | Solo Vibe Studio |

- `PaigeThinkingIndicator` (`src/components/paige/chat/PaigeThinkingIndicator.tsx`) renders only
  `kind:"thought"` steps, collapsed; returns `null` when not active. In Solo it receives `thoughts={[]}`
  (`PaigeAIChat.tsx:2440`).
- `PaigeStepTrace` (`src/components/dashboard/PaigeStepTrace.tsx`): `upsertStep`, `StepTimeline`,
  `PaigeReasoningStrip` (one‑line strip + bottom sheet). `ReasoningDeck` is **dead** (only importer is
  the dead `PaigeWorkspace` ← `PlaybookAdmin`, zero importers).
- **Steps live in component state, not on the message**; cleared at each send; earlier turns' traces
  are discarded and never persisted.
- One evolving assistant message per turn in `PaigeAIChat` (single `assistantId`, 1098) — the
  "one living turn" shape already exists for text; steps/phase are sidecar state.

## 5. Current first‑token latency path

Everything from 790 to 8433 is awaited before the `Response` returns (§1), including up to four
sequential `embedText` calls (1743, 1937, 2122, 2268), the optional fold LLM call (5099) and deferred
document extraction (8380). Then: **tool path = per‑round buffering** (finding 4). No early frame
except `paige_compacting` on long threads. Document path streams live unless protected (every
document turn is protected, 2397). Prod p50/p90 above.

## 6. Tool‑round / continuation loop

- `MAX_ROUNDS = 5`, `MAX_TOTAL_TOOL_CALLS = 12`, wall clock 360 s (13986, 153); `deep_research`
  costs 3.
- Sequential execution in `executeToolCalls` (8571–13981): per call scope revalidation (8614) → Studio
  scope → client seat → Sales‑invoice door → CRM door → quote check → autonomy gate (8923) → ~106
  `if/else` branches → "Unknown tool" (13977).
- Results fed back as `assistant{tool_calls}` + tool messages, next call `tool_choice:"auto"`
  (14769–14786).
- Stops: duplicate call signature, over‑cap/over‑time/last round (cap can be exceeded in the final
  round), scope invalidated, non‑OK follow‑up.
- Continuation wrapper `MAX_CONTINUATIONS = 3` (14456) for action‑looking requests that ended in
  prose without a terminal signal (14797–14814).

## 7. Final synthesis

Natural stop → replay of the buffered last round (no separate call). Forced termination / Live → one
tools‑free streamed "close" call over the bare `convo` (14847–14853), **no synthesis instruction
added**. Fallback sentences for close failure / exception / scope change.

## 8. Approval interruption / resume

- Confirm lane → fingerprint + `recordConfirmation` into `paige_pending_confirmations` (single‑use,
  30‑min expiry, `issued_in_request` nonce, `server_issued_at`, browser‑read‑only) → tool result
  `needs_confirm` → `paige_confirm` frame after the loop.
- Decision rides the **next POST** as `approvedConfirmations`/`declinedConfirmations`; CRM and
  pipeline lanes are executed client‑side before the turn and appended to the user text as
  `[Card result — …]` (`PaigeAIChat.tsx:1629-1787`).
- General gate: the model must **re‑emit** the call; the gate claims the row and overwrites args with
  the stored ones (9366–9433). Contradiction with the prompt at 5438 **[verified]** (recorded already
  as a family in §10, 2026‑09‑26 #1450).
- Self‑approval guards are strong (body‑only approvals, per‑request nonce, server‑issued rows,
  single‑use CAS, scope re‑check, Live turns cannot carry approvals).
- **No objective state is saved and re‑fed.** Decline = `cancelConfirmations` (7495–7566), then a
  normal turn.

## 9. Sub‑agent delegation

- `list_subagents` (6931) and `delegate_to_subagent` (6948, free‑string slug) → `paige-orchestrator`
  with service role (`tool_search` / `tool_invoke`), gated on global admin role (13229–13235),
  `delegate_to_subagent` classified **high** → approval card every time.
- Roster is **dynamic** (read from `paige_subagents`, enabled, `tenant_id IS NULL OR = X`); prod has
  **33 rows, all enabled**. Orchestrator `inspect` (233–278) returns health derived from
  `paige_subagent_invocations`; chat never calls it.
- Runs are **synchronous**, one tool result, no progress.
- **Latent defect [verified]:** the `deep-research` sub‑agent cannot run via delegation —
  `invokeLocal` posts `{input, context}` (`paige-orchestrator/index.ts:457-481`) but
  `paige-deep-research` reads top‑level `body.question`/`body.user_id` and 400s
  (`index.ts:1531-1533`). Prod: 0 invocations ever, so unhit. **Belongs to the Deep Research lane;
  routed there, not fixed here.**

## 10. Durable‑work resume

- `paige_durable_work` envelope (`20270417000000`) + document adapter (`20270418000000`, pg_cron
  worker every minute) is the **adopted** contract (`docs/brain/paige-durable-job-contract.md`):
  canonical states incl. `blocked` with a named waiter; approval expiry → `blocked/approval_expired`;
  *"fresh approval resumes the existing work identity"*.
- `requestIntentId` (body 556) is consumed only by `document_generate` (12047–12223) → returns
  `accepted` + `work_id` immediately.
- Completion inserts a fixed assistant turn; PAIGE is not re‑invoked; nothing narrates progress.
- Searched `paige_jobs`, `job_steps`, `harness_job`, `paige_objective`, `resume_turn`,
  `continuation_token` — none exist. Deep Research is synchronous today (60–90 s bound), not durable.

## 11. Thread persistence

- Server is the single writer: user turn before inference, assistant turn after the stream via
  `paige_chat_turn_append`. `bundle_ref` (**jsonb**, free‑form, accepted by the RPC —
  `20261020100000_chat_turn_append_tenant_scope.sql:109-174`) stores `approval_queued`,
  `paige_confirm`, `paige_crm_result`, surfaces; artifacts via durable work.
- **Steps/trace and interim narration are not persisted**; reload restores text, settled confirms,
  CRM results, artifacts.
- Client portal and operator chats keep no thread.

## 12. Workspace‑switch / scope fences

- `PaigeAIChat`: scope identity = tenant/user/focused client/mission; `createComposerRequestFence`
  aborts on epoch change; every frame checked with `ticketAccepted`; reset clears thread/messages/
  steps. Solo additionally remounts on `activeTenantId`. Thread cache keys include tenant.
- Server: tenant is re‑resolved per request from the JWT; per‑call scope revalidation in the loop.
- **Gaps:** `useStudioChat` aborts only on unmount/session change and carries no tenant fence;
  `useOperatorChat` and `PaigeChat` have no abort controller.

## 13. Current capability manifest architecture

`_shared/paige-capability-status/`: `signals.ts` (facts → 21 hand‑written `CapabilitySignal`s),
`resolver.ts` (most‑restrictive‑wins: tier → evidence → maturity → package → connection → proof_owed →
lane), `render.ts` (prompt block, "authoritative / OVERRIDES"), `gatherer.ts` (a 1‑binding Layer‑C
resolver, **not** the chat gatherer). The chat gatherer is inline: `gatherCapabilityManifest`
(`index.ts:4663-4717`). Same truth feeds the prompt block (4928) and the `capability_status` tool
(12672–12680) → "what can you do?" is one truth, by design. ~3.0 k chars per turn. Computed **every
request**, no cross‑request cache, no fingerprint.

## 14. Exact gatherer inputs (chat path)

Tier (`get_actor_access` via `getActorTier`, fail‑closed to client) · tenant (`get_paige_persona_context`)
· owner‑ops role (global `user_roles` admin/super_admin — **not tenant‑scoped**) · lanes for **8
hard‑coded tool keys** via `resolve_tool_autonomy` (Trust ceiling applied in SQL) + `clampLaneByRisk`
· Spine `maturity` for 11 keys (3 absent from Spine → "planned") · n8n readiness RPC · env
`FIRECRAWL_API_KEY`. **Not read:** any other connection (email, calendar, GHL, Zapier, Twilio, social),
tier features, package entitlement, Studio scope, the Integration Capability Registry.

## 15. What the manifest currently omits or gets wrong

Under‑claims: Studio/Vibe build tools (11+), Sales invoices (6), ~30 CRM‑command writes, calendar
(12), agreements (4), business missions, automations, Zapier/GHL, n8n management beyond run, comms
numbers, action bus, team management (contradiction), deal moves (contradiction), sends
(contradiction). Over‑claims: `crm.advance_journey_stage` in chat; n8n `available ≠ connected`
(`n8nReadiness.ts:20-37`); CRM rows on Studio turns that cannot use them. Honesty bugs: block shown to
non‑admin members while the tool is admin‑only, with "not for this account type" as the stated reason
when the real cause is role. Stale docs: matrix row 146/148.

## 16. Spine registry coverage

`PAIGE_SPINE_CAPABILITIES` (`_shared/paige-spine/registry.ts:50`): 91 capabilities from 22 domain files,
self‑validating at load; all `maturity: PARTIAL`; 85 declare a `chatTool`. **84 of the 164 chat tools
are covered.** Fields: key, domain, owner (team), humanSurface (route), evidence, action{classification,
executor, chatTool, idempotency, riskPolicyKey, approvalAuthority}, outcome, chatBinding, mindBinding,
maturity. **No** description/schema, availability, tier, role or specialist field. Runtime readers:
manifest maturity lookup, Mind evidence, migration advisor. One dead binding (`integrations_health`).

## 17. Inline vs registered gap

Chat offers **~164 tools** (96 inline names + 39 spread from domain modules − 9 spliced + 32 CRM catalog
+ 6 Sales). 104 are mutating. Coverage: action‑risk 104/104 · `list_tool_autonomy` 104/104 · receipt
ledger 104/104 (most `seeded_undeclared`) · Spine 84/164 · Kit 15 · Gateway 2. **80 tools are on the
surface with no Spine entry** (38 mutating, 42 read — exactly the shrink‑only
`capability-declaration-baseline.json`). Kit bypass baseline: 297 entries (125 direct tool defs, 150
direct risk entries, 22 direct bindings/receipts).

## 18. Capability Gateway coverage

`_shared/paige-capability-gateway/gateway.ts` (no edge function exists): `decideGatewayEntry` maps
availability → disposition; it owns **2 tools** (`capability_status`, `contact_event_status`), both
emitted with hard‑coded `live`. Per‑caller withholding "deliberately NOT yet wired" (219–224). **No
tool is filtered by tenant or provider availability before the model sees it**; client seats are
refused at dispatch only (8634) despite a "hidden AND enforced" comment.

## 19. Agent‑roster discovery

Dynamic and correct at the data layer (`paige_subagents`, tenant overrides by row, health from
invocations, Studio capability scope in `config`). Not dynamic at the presentation layer
(`SUBAGENT_FRIENDLY`, 3 labels) and not in the manifest beyond one `agentteam.delegate` row.

### Ownership map — who answers each concern today

| concern | owner today | divergence |
|---|---|---|
| A existence | de facto the chat `toolDefs` assembly; Spine is canonical for 84 | ⚠ 80 surface tools unregistered; MCP has its own 117‑tool list |
| B model‑facing description | inline literals + domain `*_TOOLS` arrays + CRM/Sales catalogs; Kit has `description`; Spine has none | ⚠ |
| C tenant availability | manifest (21 families), Gateway (2, hard‑coded), Studio scope, client‑seat allowlist, conditional spreads | ⚠ |
| D provider readiness | n8n RPC, env key, `tenant_mcp_connections`, Integration Registry (docs only) | ⚠ three vocabularies |
| E actor authority | inline per door; Kit `requiredPermission`; no per‑tool role in Spine | ⚠ |
| F trust/autonomy | `resolve_tool_autonomy` + Trust ceiling + `clampLaneByRisk`; action kinds; §67 process grants | ⚠ action‑kind vs tool lane for journey advance |
| G risk | **`action-risk.ts` canonical**, mirrored and CI‑checked | converged |
| H execution binding | inline dispatch chain + command doors; Spine `executor` is declarative only | ⚠ |
| I specialist owner | `paige_action_kinds.draft_subagent_slug`; "owner" means team in Spine/Kit | ⚠ |
| J human surface/label | Spine `humanSurface`, Kit, catalogue labels, `TOOL_LABELS`, manifest labels | ⚠ four label sets |
| K evidence/Rail | Spine `outcome`, receipt ledger, Kit `receipt`, seam `outcomeChannel` | ⚠ declared vs `seeded_undeclared` |

---

## 20. Proposed dynamic capability source of truth — no new registry

**Principle.** *The manifest becomes a projection, not a list.* What PAIGE believes she can do on a
turn is computed from (a) the tools actually emitted to the model on that turn, (b) their canonical
declarations, and (c) named availability resolvers. Nothing in the conversation layer enumerates
capabilities.

- **Existence + governance:** the **Spine registry** (already canonical; CI already forces new chat
  tools into it).
- **Per‑capability declaration:** the **Capability Kit** shape (already has description, permission,
  availability resolver id, provider binding, receipt). Where a Spine entry has a Kit declaration, the
  projection reads it; where it doesn't yet, the projection falls back to Spine + `action-risk` +
  `list_tool_autonomy` label + the emitted tool's own `description` — so **all 164 tools are visible
  on day one**, before the 80‑tool registration migration finishes.
- **Availability:** a small, closed **resolver registry** keyed by the ids the Kit already names
  (`CapabilityAvailabilityResolverId`, `seams.ts`): e.g. `always`, `provider:n8n`, `env:research`,
  `connection:mcp:<provider>`, `role:owner_ops`, `studio_scope`. A new *kind* of readiness adds one
  resolver; a new capability of an existing kind adds **nothing** outside its own declaration.
- **Lane:** unchanged canonical path — `resolve_tool_autonomy` (Trust ceiling in SQL) +
  `clampLaneByRisk`, resolved for **every emitted mutating tool** (batched), not 8 hand‑picked keys.
- **Families/grouping:** derived from Spine `domain` (+ an optional owner‑facing family label on the
  declaration), not hard‑coded render order.
- **Non‑tool capabilities** (skills‑in‑chat, Secure Browser — honest "not yet"): stay as an explicit,
  small *overlay* of planned rows, each pointing at a real gate.
- **Specialists:** the manifest's agent‑team section lists enabled, healthy `paige_subagents` for the
  tenant (name, domain, role) — read, not hard‑coded; step labels come from the same row
  (`rail_display_name`/`name`), retiring `SUBAGENT_FRIENDLY`.
- **Executable truth == advertised truth:** the projection runs **over the post‑narrowing tool
  surface** (Studio scope, client seat, funding/marketplace), so the manifest can no longer offer what
  the turn cannot call. Availability‑gated *emission* (withholding a `needs_setup` tool from the model)
  is a later, separate step under §58 — it changes behaviour; the projection does not.

### 20.1 Who said it: capability truth vs what the owner says vs operator scope (owner addition 2026-10-05)

**Owner ruling (Antonio, 2026-10-05, binding).** In a Solo workspace the owner said the dev team is
building Marketing and Sales. PAIGE replied *"I'm tracking that the dev team is wiring Marketing and
Sales into this platform"*. She was repeating what they had told her, but it sounded like she was reading
program state. The three sources stay apart:

1. **What she can do now** comes only from this turn's projection (§20): emitted tools × declaration ×
   lane × workspace role × readiness. Each tool lands in one of these states: available now; available
   but approval-gated; needs setup; can attempt but not proven here (`proof_owed`); not for this person;
   or not something she can do yet.
2. **What the owner tells her about future development is their account.** She acknowledges it as theirs
   ("Based on what you're telling me…"). She never presents it as her own knowledge, never treats it as a
   live capability, and never says she is tracking the build.
3. **Platform roadmap, delivery, release and program state is operator scope.** A workspace chat never
   must never receive it, even when the person in the workspace is the platform owner. Being that person
   is not operator authority (§9/§52/§53). As built, this holds for every source except per-user client
   memory; see the known gap below.

If the owner says a capability is live and the projection places it in another state (needs approval,
needs setup, needs the owner or an admin, not proven here), she answers with that state. Only when the
projection does not offer it at all does she keep to it with: *"That's the direction you've given me, but
this workspace does not currently expose that capability to me yet."*

**As built (no new store, no capability list, no new memory):**

- **The rule (one home).** It is `CAPABILITY_TRUTH_RULE` in
  `_shared/paige-capability-status/render.ts`. It is printed inside the projected capability block, and
  `capability_status` returns the same constant as `note`, so the two cannot disagree. The rule names
  no capability, so a newly shipped, emitted tool reads CAN DO NOW with no edit to it (scenario C). It
  refers to "this capability report", a referent true both in the block and in the tool's `note`. The
  `capability_status` tool description points at that note rather than restating the rule (§18).
- **Rolling thread summary.** This was the leak path: a summary folded owner remarks such as "the dev
  team is building…" into prose. That prose was read back as *"things you already know"*. On prod,
  5 tenant-thread summaries carried dev/roadmap claims as fact, one of them an action Paige never took.
  - The read-back is now labelled as her recollection of what was said, not a record of what exists or
    of what she can do.
  - The summarizer is told to attribute plans to the owner ("the owner said…") and never to record a
    promise to pass something on as an action taken.
  - Existing summary rows are not rewritten. The new label changes how they are READ. Re-attribution is
    NOT guaranteed: the next fold feeds the old summary back as PRIOR SUMMARY, so its wording can
    survive, and a thread nobody returns to keeps its old text.
  - The continuity block (earlier conversations, from `paige_operating_memory`) no longer says it is
    "from the record"; its footer carves the recalled conversations out of "what the platform actually
    holds". The data loaded is unchanged.
- **Thread-tenant check (§9) — a leak closed.** Every use of the request's `threadId` (user-turn append,
  pre-flight fold, the summary read, Studio and image-anchor reads, assistant append, title, post-turn
  fold) keyed on the id alone, on the caller's client. RLS admits the platform owner to every thread, so
  a super_admin whose active workspace is a Solo tenant could name a platform-lens thread (tenant_id
  NULL) and its operator summary reached the Solo prompt — a verifier proved it by probe. `paige-ai-chat`
  now reads the thread's `tenant_id` once, right after the persona read and before any use, and refuses
  the turn with 409 `ACTIVE_ACCOUNT_CHANGED` when it is not the turn's workspace (null matches only
  null) or when the read fails. This is the rule the Live path already applied
  (`.eq("tenant_id", scope.tenantId)`). A thread the caller cannot read at all is left as before: every
  later thread read is on the same RLS-bound client and returns nothing, the append RPC carries its own
  workspace predicate, and the service-role writes are already pinned to the active tenant.
  - §37 consumers of the code: `PaigeAIChat` reads it through `parsePaigeChatError` and shows the
    server's message; `useStudioChat` shows its generic failure line. No edge function sends a
    `threadId` to `paige-ai-chat`, and `useOperatorChat` sends none. The thread rail is already scoped
    by workspace (`usePaigeThreads`), so a legitimate client only reaches this on a mid-flight switch.
  - Both directions are refused: a workspace turn naming a platform thread (38.10–38.11) and a
    tenant-less operator turn naming a workspace's thread (38.16).
  - **Known edge, not live today.** The front end shows the platform desk when a staff user's
    `profiles.active_tenant_id` is null, but the persona resolver falls back to a linked client row or
    the first active membership. A super_admin with either would see the platform desk yet get a
    workspace persona, and every desk turn would now be refused instead of running degraded. Prod has
    neither for any operator (read-only check at review), so nothing breaks now; aligning the two
    definitions of "platform mode" is a named follow-up.
  - Not addressed: the check compares workspace only. Inside one workspace a caller whom RLS already
    admits to a coworker's thread can name it; that is not an escalation (they can read it directly)
    and writes still require `caller_user_id = auth.uid()`.
  - An unknown turn scope (the persona read failed, so its null tenant only looks tenant-less) never
    matches a readable thread, so it is refused too (38.17). Before this, a null-tenant platform thread
    would have matched it, and its summary could be folded before the later scope re-check refused the
    turn.
  - **Also newly refused (§58, latent):**
    - The check compares against the persona tenant, but `paige_chat_thread_create` stamps
      `current_user_tenant_id()`. The persona resolver reads a linked `clients` row first, so a user
      with a linked client row in another workspace would now be refused in their own threads. Prod has
      0 users with `linked_user_id`. Reconciling the two is part of the "platform mode" follow-up.
    - A platform owner opening another workspace's Studio chat is now refused; `paige_studio_thread_ensure`
      admits them there. Refusing is consistent with this rule, and it is declared here.
- **Known gap, not closed here: per-user client memory is not workspace-scoped.** With no client in
  scope, the recent `client_memory` read keys on `client_user_id` and `match_paige_memory` keys on the
  user id; neither filters by workspace, and `chat_message_embeddings` has no tenant column. So a
  preference stated on the operator desk could be recalled in that person's Solo chat (and a person in
  two workspaces carries memories between them). Prod: 0 `client_memory` rows and 0 embeddings for any
  platform operator, so it is latent. Scoping it means deciding what happens to rows with no workspace
  and adding a tenant to the embeddings store — a memory-contract change, proposed to the owner as its own follow-up task (not yet tracked in the repo).
  Until it lands, "operator context never reaches a workspace chat" holds for the briefing, owner
  memory, doctrine, continuity and thread summaries, not for per-user client memory.
- **§52 operator briefing.** It already required a tenant-less persona plus `is_platform_operator()`.
  It now also requires that the persona read succeeded (`proposalScopeResolved`). Before this, a failed
  read defaulted to a null tenant, which looked tenant-less.
  - Measured at base: that turn was already refused before the model (409 `ACTIVE_ACCOUNT_CHANGED`), so
    this was not a leak that reached a model.
  - The change stops the owner-memory, metrics and doctrine reads from running on a turn whose scope is
    unknown.
  - The operator surface itself is unchanged (scenario D control).
- **`client_memory` extraction is unchanged.** It records only what the client expressed
  (preferences, commitments, open loops). It is read back as tone/format data, and only the client app
  (`AppShell` → `PaigeChat`) drives that mode.

**Scenario D, the operator program projection.** None exists: there is no Spine domain, table or tool
for program, delivery or release state. The tenant-less operator turn gets the §52 briefing and no
capability block, and that stays as it is. Building an operator program/delivery projection would be
new backend work, a named follow-up that is not built here.

**Evidence.**

- **Automated:** `test:client-memory-authz` group 38 (38.1–38.17) and 20.4d. It reads the real system
  prompt the handler sent for a Solo owner who is also a platform operator (actor tier `god`):
  - the contract is beside the capability block;
  - no briefing, doctrine index, platform snapshot or owner-memory row is present;
  - the block names only emitted tools, under projection headings;
  - the tenant-less operator still gets the briefing and no block;
  - a failed persona read loads no briefing;
  - the summary label and the summarizer instruction are present;
  - a super_admin in Solo naming a platform-lens thread, another workspace's thread, or a thread whose
    owner could not be read is refused 409 before any model call, with nothing written to the thread;
    their own Solo thread, and the operator's own platform thread on the tenant-less surface, still work;
  - the carrying block's header no longer calls the recollection the record (20.4d).
- **Vitest:** `paige-capability-projection.test.ts` covers the "surface-aware self-knowledge" scenarios
  A/E, B and C, plus the `proof_owed` tool description.
- **Mutation-proven:** each assertion fails when its change is reverted.
- **UNVERIFIED:** what a real model *says* for scenarios A, B and E. The harnesses use scripted model
  doubles. `paige-eval` scores stored outputs only and holds no datasets.
  - Follow-up: a rubric dataset over post-deploy `paige_llm_trace` replies, or a scenario runner (new
    §34 work).
- **OWED:** an authenticated Solo drive by the owner.

## 21. Manifest refresh / invalidation contract

Today it is already recomputed every request (good), with three real staleness windows: inside a
long tool loop, across a suspended objective, and across durable work.

- **Capability fingerprint:** `hash(tenant, workspace scope epoch, actor, tier, role, trust rung,
  registry build revision, sorted (key, availability, lane))`. Computed with the manifest; stamped
  into the assistant turn's `bundle_ref.turn_state`, onto suspended objectives (§22) and compared to
  the durable work envelope's existing `authority_context`/`scope_epoch`.
- **Inside a turn:** a tool whose declaration marks it `invalidatesCapabilities` (connect a provider,
  change autonomy, change a member's role) triggers a re‑gather before the next round. Everything
  else uses the per‑request memo.
- **On resume** (approval, answer, durable completion): always re‑gather; if the fingerprint changed,
  PAIGE is told *what* changed ("n8n is now connected") rather than silently given a new list.
- **Authority is never cached:** every act still re‑resolves tenant/actor/scope/lane at execution
  (existing per‑call gate). The fingerprint governs what PAIGE *believes*, not what she is *allowed*.
- **Workspace switch:** client epoch abort already exists for `PaigeAIChat`; the server binds tenant
  per request. Gaps to close: Studio and operator parsers (§12).

## 22. Proposed conversational turn state machine

The conversational loop owns **dialogue**; the existing tool loop / Harness owns **work**. A small
pure reducer (`_shared/paige-turn/`) observes the loop and decides what the user sees and what is
recorded; it never chooses tools.

```
RECEIVED → ORIENT → (ACKNOWLEDGE) → WORK ⟲ [act → observe → evaluate]
   evaluate → CONTINUE | ASK_USER | WAIT_APPROVAL | WAIT_WORK | BLOCKED | SUFFICIENT
   SUFFICIENT / forced → SYNTHESIZE → FINAL
   ASK_USER | WAIT_APPROVAL | WAIT_WORK → (suspended; turn_state persisted) → RESUMED → WORK
```

Mapping onto existing code: RECEIVED = 784–915 · ORIENT = context assembly · first model call =
plan · loop 14450–14836 = WORK/EVALUATE · continuation wrapper = CONTINUE · `needs_confirm` =
WAIT_APPROVAL · `document_generate accepted` = WAIT_WORK · `ask_choices` = ASK_USER · close call =
SYNTHESIZE · natural stop = FINAL.

**Response mode is observed, not predicted.** No extra classifier call (it would add latency). Mode
starts `pending` and is set by what the model actually does: no tool call in round 0 → `fast_answer`;
research‑domain tools → `research`; mutating tools → `action`; Studio build tools → `build`;
`delegate_to_subagent` → `multi_agent`; a question → `clarify`; resume handle present → `resume`.
Domains come from the registry, so a future Operations tool sets its mode with no loop change.

**Resume handle** = `thread_id` + `turn_state` in the assistant turn's `bundle_ref` (objective
summary, mode, status, pending fingerprints, `work_id`s, capability fingerprint). On the next request
that answers it (approval, choice, durable completion), the server injects "you are resuming objective
X; outcome Y; continue" and the **same** loop finishes the objective — fixing the re‑emit
contradiction by making the server, not the model, carry the approved call forward.

## 23. Proposed safe narration contract

Three channels; every visible event has a real producer:

| channel | producer | surface | persisted |
|---|---|---|---|
| **Private reasoning** | provider thinking | **never** (stays unrequested / unforwarded) | no |
| **Work activity** | real tool start/finish, sub‑agent invoke, durable‑work transitions | `paige_step` → expandable "What PAIGE did" | yes, compact, in `bundle_ref.turn_trace` |
| **Conversational narration** | the model's own *visible* text before/between tool calls | inline in the one living assistant turn | acknowledgement + material discoveries kept; the rest collapses into the trace |
| **Final answer** | final round / close call | the turn body | yes (as today) |

Rules: (1) stream round text **live** instead of buffering it — the model's own "Let me check the
agreement against what was invoiced" *is* the acknowledgement, authored by PAIGE, not manufactured;
(2) the existing narration instruction (4935) is rewritten to the handoff's §12 standard — one short
sentence before work on a work turn, nothing on a fast turn, speak again only on a meaningful
discovery, never name tools; (3) `paige_step` action steps are emitted **as each tool starts and
finishes** (`running` → `done`/`error`), still filtered by `describeStep`; (4) no client timers invent
steps (the 10 s "still thinking" cue is honest elapsed time and stays); (5) protected‑content holds
apply to narration exactly as to answers (`emitContent`).

**Minimum frame additions:** one new frame, `paige_turn {event, state, mode, segment?}` with events
`started | segment | waiting | resumed | completed`. `started` is written the moment the stream opens
(before context assembly finishes, if the stream is moved earlier) so the client can show PAIGE is
present truthfully; `segment` marks interim vs final text. Everything else reuses `paige_step`,
`paige_confirm`, `paige_choices`, `paige_approval_outcome`, `paige_phase`.

**One shared client parser** (`src/lib/paige-stream/`) replaces the four, so the new contract lands
once.

## 24. Minimal PR sequence

Each slice is independently shippable, mounts on existing seams, and is pre‑launch merge‑on‑verified
(§4) except where a gate is named.

| slice | scope | gate |
|---|---|---|
| **C0a — manifest as projection** | Build the projection (§20) over the emitted surface + Spine/Kit/action‑risk/catalogue + resolver registry; parity test old vs new; fix the drifts it exposes (team, deals, sends, journey over‑claim, n8n connected, Studio scope, role‑vs‑tier reason); new CI rule: every emitted tool appears in the projection; mutation tests for acceptance A–D, J | none beyond §39 + CI |
| **C0b — registration burn‑down** | Register the 80 baseline tools in Spine by domain batch (team, plan, documents/knowledge, research, comms, action bus…), shrinking `capability-declaration-baseline.json`; reverse lint (Spine `chatTool` with no surface tool, e.g. `integrations_health`) | batches; coordinate #1615 |
| **C1 — turn contract** | `_shared/paige-turn/` reducer + `paige_turn` frame + shared client parser (PaigeAIChat + Studio first) + `bundle_ref.turn_state/turn_trace` | none (no visible change) |
| **C2 — server streaming** | Live round streaming on unprotected turns; per‑tool running/done steps; `started` early; observed mode; narration instruction rewrite; parallelize the 4 embeddings; measure TTFB before/after | must preserve protected holds; latency proof |
| **C3 — living‑response UI** | One evolving PAIGE turn, acknowledgement, meaningful updates, expandable trace, persisted "What PAIGE did" | **Impeccable + `flow-prototype`, owner sees it before production** |
| **C4 — interrupt/resume** | Server‑carried approval resume; `ask_user` in main chat (generalize `ask_choices`); durable‑work resume via thread (+ progress from envelope transitions) | **joint seam with the Deep Research lane** |
| **C5 — multi‑agent** | Dynamic specialist labels/roster in manifest; sub‑agent progress as steps; parallel consults | open decision D2 below |
| **C6 — intelligence enrichment** | Mind/Knowledge/Memory/Agent Intelligence/Deep Research feed ORIENT; no loop change | after C4 |

## 25. Migrations required

- **C0–C3: none expected.** Registry/Kit/resolvers are TS; turn state and trace ride
  `paige_chat_turns.bundle_ref` (jsonb, free‑form through `paige_chat_turn_append`).
- **C4: likely one.** A resume marker per thread (or reading the latest `turn_state`), and changing
  `complete_paige_document_work` from inserting a canned turn to marking the thread resume‑pending.
  Server‑side model invocation on completion is **not** proposed: resume runs on the owner's next
  JWT‑bearing request (or a client‑triggered resume when the thread is open), so authority stays
  caller‑derived (§9).
- Possibly an index for "latest suspended turn per thread" — decide at C4 with a measured query.

## 26. Collision / open‑PR review

| PR / lane | touches | relation |
|---|---|---|
| #1615 knowledge governed CRUD (draft) | `paige-ai-chat/index.ts` (+134), Spine registry + `domains/knowledge.ts`, `capability-kit-lint` | **helps C0b** (registers knowledge); sequence C0a after or rebase onto it |
| #1608 knowledge summary scope (draft) | `paige-ai-chat/index.ts` (+97) | merge‑conflict risk only |
| #1556 operator member threads private (draft) | `PaigeAIChat.tsx`, `usePaigeThreads.ts` | C1/C3 client parser; coordinate |
| #1321, #1315 | — | **no merge base with main** — stale; not dependencies |
| Deep Research lane (M0 merged #1689; later phases off‑main) | `paige-deep-research`, durable work | **joint seam at C4**; owns the sub‑agent input defect (§9) |
| Governance seam convergence (Platform Reach lane) | `governedInputsFor`, chat chokepoint | C0a reads the same declarations — must not fork; share the declaration reader |
| Vibe Studio V2 lane (#1680–#1692) | `useStudioChat`, Studio scope | C1 parser consolidation; Studio scope is an input to C0a |

## 27. Proof plan

- **Baseline first (§71.3):** record current TTFB per mode from instrumented runs + the prod
  `paige_llm_trace` distribution above; same measurement after C2.
- **Capability acceptance A–J as pure tests** with fixture registries: register a fake read capability
  → appears; disable → disappears; disconnect provider → `needs_setup`, tool not executed; member vs
  admin → different rows; lane change → next decision uses it; workspace change → fingerprint changes
  and no row carries over; new sub‑agent row → listed and delegable; retire → gone. **Each mutation‑
  tested** (reinstate the defect, watch the test fail).
- **Stream contract tests:** frame order through the loop with a mocked provider (existing
  `__checks__` harness), incl. protected‑turn holds and the single‑living‑turn invariant.
- **Self‑description test (handoff §17):** "What can you help me with?" answered from the projection
  only — snapshot per tier/role/connection fixture.
- **Rendered proof (C3):** Impeccable audit + prototype frames, both themes, Solo viewports.
- **Authenticated runtime (§32.c / §70.1):** the handoff §28 scenario ("why aren't these leads
  converting") on the live Solo workspace. Blocked on the universal proof gate recorded in
  `chat-completion-matrix.md` (least‑privilege Solo test tenant + `LIVE_DRIVE_*`); until then
  **UNVERIFIED** and said so.

---

## Open decisions for the owner (material only)

- **D1 — Where interim narration lives after completion.** Recommendation: keep the acknowledgement
  and any material discovery visible; collapse the rest into "What PAIGE did". Decided finally at the
  C3 prototype, where the owner can see it.
- **D2 — Should consulting a tool‑less specialist require approval?** `delegate_to_subagent` is `high`
  today, so every specialist consult is an approval card — which makes the §21 multi‑agent turn
  ("I'll look at pipeline, marketing and follow‑up") stop three times. Recommendation: split consult
  (read‑only, `soft` runtime, no tools) from delegate‑to‑act; consult becomes `ordinary`/read. This is
  an authority change → owner's call.
- **D3 — Approval continuation shape.** Recommendation: after Approve, the outcome and PAIGE's
  conclusion continue in the **same** assistant turn (no "Approved — run it." user bubble). Shown in
  the C3 prototype.

## Evidence classes in this return

- **Static (code read):** everything with a file:line.
- **Production read‑only:** 626 turns / 17 threads / 59 confirmations / 33 enabled sub‑agents in 30
  days; LLM latency percentiles; 0 `deep-research` sub‑agent invocations.
- **Automated / runtime / authenticated:** none — this is R0; nothing was changed or driven.

### C5 bounded composition implementation — 2026-10-08

Current engineering candidate implements dynamic specialist step labels using the existing tenant-scoped roster, now retaining canonical slug beside rail_display_name. The manifest already consumed the live scoped roster; this slice does not rebuild discovery. Chat START and FINISH use a request-local resolver, replacing the three-entry hard-coded label table. Only the safe roster name labels the specialist; unknown, ambiguous or unsafe names fall back to generic wording. Finish distinguishes synchronous response, refusal, unconfirmed response and accepted LangGraph dispatch. No parallel execution, provider route, risk, approval or role authority changes.

Failure-first behavioral evidence: dynamic-name assertion failed with generic wording (exit 1). GREEN: 8 new specialist-label cases plus 9 existing step-start cases passed, 17/17. Strict helper/test TypeScript and diff whitespace checks passed. Existing extraction test now injects the actual shared helper rather than the retired hard-coded table. Independent review, full Edge/CI, fresh rendered composition, authenticated orchestration and production acceptance remain PROOF OWED; historical C3 evidence cannot prove this candidate.

Flow Prototype is not required for this bounded copy/data correction: it retains the approved C3 step interaction and introduces no material goal, choice, state, exit, control or layout. Impeccable clarity checks preserve concise truthful labels and incumbent presentation; its local detector package was unavailable, so detector/finish review is not claimed. Evidence stays in docs/evidence/ui-delivery/c3-living-response.md. D2 is still owner-reserved; approval-free tool-less consulting and parallel consults remain outside this implementation.
