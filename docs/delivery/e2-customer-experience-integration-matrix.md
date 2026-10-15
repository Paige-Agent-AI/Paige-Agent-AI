# Experience 02 — Customer Experience Integration Matrix

**Directive:** the owner's Mandatory Customer-Visible Outcome Standard (2026-10-13). Every
customer outcome must be documented and verified along
**Conversation → Spine capability → Backend record → UI component → Visible state → Verified receipt**,
with missing work classified REUSE / EXTEND / REPAIR / NEW. The acceptance question: *can the
customer ask PAIGE to accomplish something, see the actual change in the correct part of the
platform, understand its status, and return later to verify the result?*

**SHELL:** SOLO. **State as of:** 2026-10-14. The continuation is grounded against main
`6428c2ba6` and preserves zCod's open E2-6 PR [#2128](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/2128)
at `99df65a3444f4526f34e417c07df4d3879ab0498`. E2-6a's caller-JWT UI transport
[#2123](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/2123) is already shipped.
The integrated continuation is **PARTIAL**; its authenticated customer acceptance is
**UNVERIFIED**, and final owner product review is **PENDING**. The
[continuation contract](e2-6-continuation-contract.md) records the routing and proof boundaries;
ANT-138 and ANT-147 are the existing coordination threads. Codex is the temporary sole E2
implementation lead; zCod does not independently modify E2-6 during this handoff.

**Preserved authenticated baseline:** the 2026-10-13 ordinary SOLO COO briefing repeat
returned **9 PASS / 0 FAIL** under
[#2102](https://github.com/mrmogulmaker-bot/Paige-Agent-AI/pull/2102), as recorded in the
ANT-138 handoff and continuation contract. The earlier **7 PASS / 2 FAIL** drive remains
historical evidence in the [acceptance protocol](e2-3-authenticated-first-briefing-acceptance.md).
Neither result substitutes for the supplemental E2-6 integrated drive below. E2-1 #2075,
E2-2 #2082, E2-3a #2092 and E2-3b #2110 remain shipped historical foundations.

## Outcome A — the conversational COO briefing (historical authenticated baseline, read-only)

*"How's my business doing, what needs attention, and what should we work on today?"*

| Link | Current truth |
|---|---|
| **Conversation** | The owner's typed message in the Solo Chat surface (`PaigeAIChat`); admitted as a conversational turn (INT-346 DRAINING) with the ANT-23 read-only admission |
| **Spine capability** | `business.operating_snapshot` (read, read_only, approval none, workspace-admin seat) → chat tool `get_business_snapshot` → `dispatchBusinessSnapshotChat` → `composeBusinessReview` → INT-340 issuer reads (`issue_analytics_evidence_bundle` / `resolve_analytics_evidence_reference`) on the caller's own session |
| **Backend records** | **Read, not written:** the departmental books behind the issuer (deals, clients, Systems Check findings, invoices) — figures re-read fresh every turn, never cached as a second source of truth. **Written:** the conversation's own canonical rows (`paige_chat_threads` with `interactive_admission='conversational'`; `paige_chat_turns` user + assistant rows) and the issuer's short-lived evidence references (internal bookkeeping, 15-minute, never customer-visible) |
| **UI component** | The Solo Chat transcript itself: the "Taking stock of your business" step chip while the read runs, then the briefing answer in the thread; the conversational banner states actions are off |
| **Visible state** | Step chip `running` → finished/failed label (no optimistic assumptions — the answer text is emitted only after the read returns; a degraded read renders its honest reason, and post-E2-3b an action request renders the truthful refusal as a normal completed answer, never a false "limit" chip) |
| **Verified receipt / readback** | The assistant turn persists to `paige_chat_turns` (settlement-issued) and reloads with the thread — verified in the first QA run's thread rows; the figures carry the to-the-second cutoff and re-read discipline ("Re-read for later turns; do not retain changing values as Memory") |

**Honest matrix gaps (classified):**

| Gap | Class | Plan |
|---|---|---|
| Owner-facing evidence beyond the chat transcript needs integrated acceptance | **NEW presentation / REUSE data:** E2-6 Executive calls shipped `paige-business-review` → the SAME composer/issuer. Candidate source binding exists; hosted and authenticated integrated proof remains owed |
| Navigation from a briefing to the owning departmental records needs integrated acceptance | **EXTEND:** candidate reuses E4 `paige_record_links`, the one canonical route map and current-account resolver; no URL is stored in a turn. Departmental and persisted-reference proof remains owed |
| The briefing names risks; the owner cannot yet act on them from chat (actions refused during INT-346) | **REUSE (already built, gated):** the governed action machinery — Spine executors, `paige_pending_confirmations` approval cards, Rail receipts, PlanInMotion — exists and activates with INT-346; no new machinery is needed or being built |

## Outcome B — the action request during DRAINING (historical authenticated refusal-by-design)

| Link | Current truth |
|---|---|
| **Conversation** | "Create a task to follow up on that." |
| **Spine capability** | None invoked (by design): effectful tools are withheld; per-call dispatch refuses anything a provider emits (`CONVERSATIONAL_MODE`) |
| **Backend record** | The refused turn's own canonical conversation rows only — no approval row, no action row, no provider call, no Rail receipt (verified in the QA window readback) |
| **UI component** | The chat transcript (the refusal sentence) + the truthful conversational banner |
| **Visible state** | A normal completed answer: the authored conversational refusal ("I can't create… nothing was run, created or sent") — post-E2-3b, never a misdescribed "limit" state |
| **Verified receipt** | The turn persists; the QA window readback proved zero unintended effects (no tasks, approvals, workflow runs, provider operations, Rail events) |

**Gap (classified):** when INT-346 activates, the proposal/approval/execution states must be
visible in the existing approval-card machinery and departmental views — **REUSE** (the cards,
`PlanInMotion`, and per-department views already render proposed → awaiting approval →
processing → completed/failed from canonical records; Experience 02 wires into them, builds
nothing parallel).

## Outcome C — the integrated Executive Command Center (PARTIAL; authenticated proof UNVERIFIED)

*"Explain how the company is doing, show me the actual evidence, and take me to the records and
recorded work that matter."*

| Link | Candidate source binding and proof boundary |
|---|---|
| **Conversation** | `ExecutiveOverview` hands the chosen-period briefing or sourced priority question to the existing PAIGE composer, clears previous surface selection and opens the same Chat fold. The owner sends it. Talk live remains the existing Chat/Live surface; presence reflects the actual UI read state and proves no provider audio |
| **Spine capability** | Existing `business.operating_snapshot` → `get_business_snapshot` → `dispatchBusinessSnapshotChat` → `composeBusinessReview`. Read/read_only, approval none, workspace-admin seat; no new capability or effect admission |
| **Canonical business records** | `useBusinessReview` invokes `paige-business-review` with the same reporting clock and period vocabulary as Chat. The caller JWT, composer and INT-340 issuer/resolver re-prove scope. Sales receipts/receivables and pipeline, Operations risks and Clients retain their owning adapters; no direct departmental table read or local metric math is added |
| **Visual Command Center** | `ExecutiveOverview` presents each requested domain, coverage, actual currency/window, source/freshness, act-before-watch priorities, canonical Strategic Plays, prepared work and recorded activity. `useBusinessGamePlanMissions`, `useSoloPendingActions` and `useSoloActivityFeed` remain their owning read contracts. Numeric goal metrics and missing producers are unavailable, not fabricated |
| **Departmental navigation** | E4 `record-links.ts` carries at most six sanitized semantic references. `canonical-app-url.ts` and `workspaceLinks.ts` resolve them for the current SOLO account; the destination re-authorizes its records. Links reach Executive, Finance, Sales pipeline/collections, Clients and Systems Check. The page also reaches Operations work, Business Game Plan, Trust Compass and Mind. Navigation grants no action permission |
| **Truthful status** | Loading, refused/unavailable, failed/retry, partial, zero and no-result states stay distinct. Exact filed-work count is independent of its ten-row bounded read/three-row preview; prepared is never completed. Human activity stays Person. Displayed review dates use the returned reporting zone; due-date judgement uses the separately configured business calendar or is held |
| **Persisted evidence / receipt** | The existing Chat settlement persists canonical turn rows and `bundle_ref.paige_record_links`; references contain no cached account URL and do not enter model context. Recorded activity consumes the existing resolver. Viewing, refreshing or navigating creates no business action or ACT receipt. Supplemental turn-row/link/reload/later-session and existing-receipt readback is still owed |

**Remaining integration work, preserving existing owners:**

| Work | Class | Acceptance owed |
|---|---|---|
| Canonical business review and shared Chat/Live | **REUSE** | Show the same scoped source semantics in Chat and Executive; preserve the dated 9/9 baseline |
| Executive evidence, priorities and strategy composition | **NEW presentation / EXTEND** | Complete rendered/interactive responsive checks and ordinary authorized customer review against actual evidence |
| Default/legacy entry, omitted requested domains, timezone labels, capped queue count and tab reachability | **REPAIR** | Regress bare/legacy routes, all requested domain states, actual-zone dates, full queue count and phone/keyboard navigation |
| Chat-to-record navigation and persisted references | **EXTEND** | Confirm current-account links, destination reads, reload and later-session recovery through E4's existing contracts |
| Strategy, Systems Check, Trust Compass, Mind, held work and activity | **REUSE / EXTEND presentation** | Verify canonical lifecycle and actor labels; retain the existing editing, authority, knowledge and receipt boundaries |
| Consequential approval/execution | **REUSE, restricted** | Preserve INT-346; no activation or success claim. Existing approved-action/readback/receipt flow remains the only future execution path |
| Numeric goals/KPIs and unimplemented domain producers | **UNAVAILABLE** | Name the missing owning contract; no E2-private schema, metrics store or provider inference |

The binding home is `command-center.executive = PARTIAL` in the existing
[Surface Binding Ledger](../binding-ledger/surface-binding-ledger.json). The four existing
Command Center rows retain their own states; adding navigation does not promote them.

## Complete E02 outcome contract — superseding owner directive, 2026-10-14

**All nineteen outcomes below are mandatory.** The owner's ANT-138/ANT-147 directive
supersedes any interpretation of this document as an E2-6-only completion contract.
Outcomes A–C above retain their historical evidence and bounded release meaning.
An unavailable, gated or unbuilt requirement remains required; it does not become optional.
E02 owns end-to-end delivery and integration. Existing technical owners retain their
active source leases. The owner subsequently clarified that older platform agents
are retired and this existing E02 lead must implement missing E02 outputs directly;
retired-agent availability is not a prerequisite or a staffing request. Current
Experience source collisions and canonical system contracts remain protected.
The owner also approved mission-linked F7 numeric targets and one bounded #2128
successor review; neither approves provider, consequential Chat or privileged QA
activation. The detailed customer-outcome audit is ANT-138 comment
`a3287d4b-b2a9-428b-811f-b31d280ce582`; ANT-147 and ANT-52 remain the integration
and acceptance homes. This expands the existing matrix, not a replacement registry.

**Release checkpoint, 2026-10-14:** #2128 reviewed
`594fcf3655a538d3c656db449d00f37f2bc9a8cd`, merged main
`bf0a8b60bee8d3a83c17c214655ea6425fc168d4`. The explicitly authorized bounded
successor nonauthor review is COMPLETE/SHIP; six exact-head workflows SUCCESS.
The earlier Weekly/Team failures remain historical, repaired in the final composition.
Web production `dpl_6PZKJTwWLQ8C5gGpFky9DaNWbemm` READY/exact merge and public
build `bf0a8b60bee8d3a83c17c214655ea6425fc168d4-mv8ojmxl`; trusted Edge
38647681553 SUCCESS/edge-live=bf0; 384/384 returned deployed files match source.
[Production receipt](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2128#issuecomment-6180003073).
Historical 9 PASS / 0 FAIL is unchanged. The preserved sixteen-case authenticated
Antonio SOLO supplement is **12 PASS / 0 FAIL / 4 BLOCKED**, recorded in the original
ANT-52 readiness gate and ANT-138 comment `7bdacc87-caac-4eea-9432-c4cdaeacf823`.
Ordinary owner scope, one persisted user/FINAL reply, six semantic department links,
reload/fresh-tab return and no business-effect writes are proven. Isolated auth return,
protected negative fixtures, exact native capture/zoom/full visual and continuity
variants remain owed. A 1536x770 DOM yielding a 1535x770 JPEG is not passing native proof.
The historical 390x844 capture hold is unchanged. No all-nineteen or final owner
acceptance, customer announcement, provider or consequential execution activation.

The table records the complete customer definition and the existing binding, not a
claim that the whole outcome is delivered. Shared-register IDs refer to the existing
Master Engineering Capability Register. D = deployed subset, not yet owner accepted;
L = local/open-PR integration; B = blocked by a shared output; P = planned, not built;
G = dormant/gated; U = acceptance or integration unknown. All final acceptance remains
PENDING. Each available subset must be tested independently of its remaining requirement.

| ID and required customer outcome | Canonical capability / technical owner / records | Product and conversation home | Current evidence and required completion |
|---|---|---|---|
| O01 Fresh conversational business briefing: actual figures, risks, grounded steps and named unknowns | S11–13; `business.operating_snapshot`, Fabric/Analytics and shared Chat; departmental books, issuer references, `paige_chat_threads/turns` | Existing SOLO Chat, `get_business_snapshot` → composer/issuer; #2075/#2082/#2092/#2110 | D bounded briefing; historical 9/0. Complete cross-domain briefing and released E2 integration/reload/owner acceptance owed |
| O02 Visual Executive and Chat agree on scope, source, period and currency | Same Fabric composer; caller-JWT `paige-business-review`; no second metric reader | #2123 transport; #2128 `ExecutiveOverview/useBusinessReview`; PAIGE draft handoff | L. Finish #2128 release and sixteen-case protected supplement |
| O03 Sales pipeline/performance with valid period comparisons and separate currencies | S39/S13; registered Sales metrics; Sales/Analytics; `deals/pipelines/pipeline_stages` | Executive, Chat and owning Sales board | D bounded reads / L visual. Authenticate actual figures, comparison limits, navigation and later readback |
| O04 Full financial and commercial intelligence: actual cash, collections, income, expense and profit source coverage | S39/S41/S13; Sales receipts/receivables in `paige_invoices/paige_invoice_payments`, business calendar; Finance-owned financial books and Analytics producer | Executive/Chat plus Finance and Sales collections | B full Finance output. Current receipt figures are not bank balance or profit. Obtain Finance domain contract, integrate and prove provider/source readiness separately |
| O05 Client health, lifecycle/onboarding and unified service-delivery progress/history | Client/CRM, Operations/Planning, Fabric/Analytics; `clients`, canonical work/task/delivery/acceptance records | Executive/Chat, Clients and Operations Work | D bounded client counts / B full health. Operations owns missing permission-filtered delivery projection; lifecycle/health producers and exact accepted-version evidence owed |
| O06 Inspect actual Systems Check findings, timestamps, coverage and severity | Existing Systems Check/Operations reader; `systems_check_snapshot`; `paige_systems_check_run/finding`, `paige_workflow_runs` | Systems Check drawer/page, Executive risks and Chat | D recorded checks / L Executive. Authenticate source freshness, finding navigation, negatives and reload |
| O07 Run real Systems checks and authorized corrective workflows with new result and receipt | Existing Systems Check runner, remediation domain writer, Spine/Harness/Trust/Rail; existing run/finding/action records | Systems Check → PAIGE/approval → canonical result | B on-demand consumer and verified runner owner. Current Refresh only rereads; Ask First only opens PAIGE. Bind actual run lifecycle and correction after authority, prove persisted outcome/reload |
| O08 Evidence-backed priorities, recommendations and useful next steps | Fabric/Analytics adapter evidence and severity; no priority store | Executive priorities and sourced Chat question | L visual / D bounded narration. Integrate full domain evidence and prove recommendation provenance; a recommendation is not execution |
| O09 Save direction and create/revise/transition the same Strategic Play truthfully | Existing Setup get/save RPCs; `tenants.brand.business_brief/tenant_setup_private_context`; `business_mission.create/revise/transition`, mission-system owner; missions/versions/mutation receipts | Business Game Plan forms, Plan in Motion, Chat and Executive projection | D manual records / L projection / G consequential Chat mutation. Prove stale revision, idempotency, unknown reconciliation, readback and continuity. Lifecycle Complete is not actual business work |
| O10 Numeric goals/KPI targets, matched actuals, periods and variance | F7 shared Game Plan/Fabric/Analytics contract; owner approved Play-linked targets in ANT-138 `41a29a57-2ded-4e4c-bf15-ae34116147ef` | Existing Strategic Play detail now has LOCAL target editing, actual/variance, lifecycle, history/receipt and original-request recovery controls; Executive and governed Chat/Live integration remain owed | L: #2167 foundation and separate local native consumer reuse canonical targets/immutable revisions, owner RPCs, incumbent receipts/Rail and issued actuals. Native source has62 focused tests and50 rollback-only target SQL assertions plus8 display assertions; no authenticated target write or accepted outcome. Review, exact-head CI, source release, rendered/native and customer proof remain required. No separate actuals store |
| O11 Actual Trust Compass tool policy controls constrained by platform restrictions | S05 Trust/Spine; list/resolve/set tool autonomy; `tenant_tool_autonomy` and platform policy | Trust Compass control/save/error/retry; Chat explanations | D controls. Authenticate role/scope restrictions, save/readback/reload and truthful executor availability; policy choice does not enable an excluded executor |
| O12 Actual held approval → authorized action → observed outcome/receipt | Existing approval/framework/domain owners; `paige_pending_approvals/paige_approval_queue_v`, Chat confirmations, stored command and canonical domain/Rail receipt | Game Plan/shared Chat approval cards; Executive held preview | D manual subsets / G complete action. Preserve stored-argument redemption, consent, replay and unknown handling; prove real outcome after legitimate activation. Filed `paige_actions` is not an approval grant |
| O13 Actor-attributed accountable activity and receipts | S06 Rail/INT-179; caller-scoped `get_solo_rail_activity`, `paige_client_events`, existing capability/domain receipts | Executive activity, Compass/System detail and owning records | D existing feed / L Executive. Integrate actual producers, prove human/PAIGE attribution and receipt readback. Viewing/refresh creates no action receipt |
| O14 Direct departmental records, current-account navigation and later return | E4 semantic reference/resolver/frame; `bundle_ref.paige_record_links` in canonical turns; destination reauthorization | Chat links; Executive → Finance/Sales/Clients/Work/System/Game Plan | L E2 extension. Authenticate destination focus, account switches, reload/later session and denied reads. Aggregate snapshots remain surface references; exact UUID links only where supported |
| O15 Mind/Knowledge/Memory context, provenance and appropriate privacy/correction/publication boundaries | S16–19; existing Mind/Memory/Knowledge owners; `read_tenant_knowledge`, knowledge docs/chunks and canonical memory contracts | Mind orb/drawer, Knowledge and Chat context | D bounded projections / B full integration. Identity/people readers and offer/full-memory bindings missing; no private memory or numeric-goal inference from operating decisions |
| O16 Chat/Live same evidence, interruption/recovery/continuity and usable responsive mobile parity | S10/S36 shared Chat/Voice INT-104; existing Live/thread/ticket/relay/settlement; canonical turns | Existing PAIGE fold/Chat/Talk live; Executive and all Command Center tabs | L responsive Executive / U E2 authenticated Live. Complete provider-authorized Live and phone/reflow/keyboard/reload proof; synthetic UI proof is separate |
| O17 Contextual canonical Conversations with real message/thread/approval/provider state and privacy | S29–33 E03/Communications; existing canonical message/thread/provider/approval records | Conversations owning home, permission-filtered E2/Chat projection | P E2 consumer integration. Agree E03 exact read port, integrate status and deep links, prove reload/privacy. No replacement inbox, send engine or personal-mail sharing |
| O18 Shared Deep Research with citations, persistence and later retrieval | S21–23; `research_knowledge.deep_research`, incumbent Research/Model Fabric/Knowledge owners; `research_runs/research_sources`, existing research read contracts | PAIGE question → existing Research card/library; separately approved Knowledge publication | G authorized run / P E2 context. Existing engine is not global unavailability; dormant R6B is not activation authority. Complete shared consumer after exact provider/cohort/spend/consent scope; prove cited persistence/retrieval |
| O19 Actual conversational follow-up/action execution and verification after legitimate activation, plus honest interim refusal | S02–06/S10 shared Spine/Harness/Trust/Kit/Rail/Chat and owning domain; confirmations, canonical records and receipts | Chat/Live proposal/approval/result, department and activity | D historical refusal / G positive execution. INT-346 restriction remains. Refusal cannot close the required positive outcome; activate only authorized pathway, prove action/readback/replay/continuity |

### Bounded delivery slices and ownership

1. **Release the existing Executive foundation** (O01–03, O06, O08, O13–14, O16
   subset): finish current-main composition with released owner-maintained CI repairs,
   one specifically authorized successor review, exact-head required CI, merge,
   web/affected-Edge source readback, paired Master/Second Brain shipped closeout and
   Central QA's preserved sixteen checks. This does not close the complete Experience.
2. **Complete domain intelligence** (O03–06/O08): Finance and Analytics own metric
   definitions/producers; Client/CRM and Operations own health/delivery/accepted-version
   projections. E02 owns composer consumer and Executive/Chat/navigation integration.
   Each producer declares caller scope, period/business date, currency, cutoff,
   total-versus-loaded coverage, evidence keys and honest unavailable states.
3. **Complete strategy and targets** (O08–10): reuse manual direction and mission
   mutations, then the owner-approved F7 shared contract. Actuals stay in the existing
   metric issuer. Build Game Plan editing and matched Executive/Chat progress with
   stale revision/idempotency/readback/reload proof.
4. **Complete risk-to-work and accountable execution** (O07/O11–13/O19):
   existing Systems runner and shared execution owners provide admitted ports and
   canonical receipts. E02 integrates finding → proposal → authorization → run →
   observed result → department/Rail → reload. Initial safe implementation and
   effects/provider/production activation have separate authority.
5. **Complete context, communications and Research** (O15/O17–18):
   consume existing permission-filtered Knowledge/Memory and E03 Conversations ports;
   use the incumbent Research engine/readback and existing citation/history identity.
   Preserve private mail, explicit audience and separate Knowledge-publication consent.
   Do not activate dormant adapters or spend from the product mandate alone.
6. **Complete Chat/Live/mobile and continuity across every outcome** (O01–19):
   shared Chat/Voice retains runtime ownership; E02 owns integrated responsive states,
   interruption/recovery, actual scoped evidence, record links and later retrieval.
   Run approved authenticated ordinary SOLO and required negative/fixture cases with
   Central QA. Source, released identity, authenticated behavior and final owner
   acceptance are separate columns of evidence for every row.

These are increments toward all nineteen outcomes, not a reduction in scope or a new
capability registry. Routine source/CI work proceeds within agreed leases. Genuine
decisions remain F7 storage/semantics, exceptional review scope, INT-346 activation,
provider/spend, privileged access and protected QA fixtures/real effects.

## Cross-experience shared components (no duplication)

- The Solo Chat transcript + step-chip machinery, the approval cards, and every departmental
  view (Sales, Clients, Systems Check, Game Plan) are **shared surfaces** across Experiences
  01–05; Experience 02 links INTO them and reads THROUGH the fabric — it introduces no
  departmental system, activity ledger, permission framework, or source of truth of its own
  (the one table-scale addition on the roadmap, goals/KPIs targets, is the F7 owner ruling,
  and would be a governed canonical structure shared with Game Plan, not an Experience-02
  private store).

## QA integration (appended, not replacing)

The authenticated acceptance protocol (`docs/delivery/e2-3-authenticated-first-briefing-acceptance.md`)
retains every historical test and its nine-point criteria. E2-6 appends, rather than replaces,
Chat → same Fabric evidence → Executive → owning department → truthful state → persisted
reference/readback checks. Use only the owner-authorized existing ordinary SOLO customer account;
isolated synthetic state/role/scope walkthroughs do not establish authenticated customer proof.
Exact-head independent review/CI, deployment identity/readback, authenticated behavior and owner
acceptance are separate evidence legs. No candidate result is marked PASS here before its own
evidence exists.
