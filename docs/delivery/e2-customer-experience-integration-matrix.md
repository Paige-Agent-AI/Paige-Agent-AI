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
