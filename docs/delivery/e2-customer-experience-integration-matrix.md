# Experience 02 — Customer Experience Integration Matrix

**Directive:** the owner's Mandatory Customer-Visible Outcome Standard (2026-10-13). Every
customer outcome must be documented and verified along
**Conversation → Spine capability → Backend record → UI component → Visible state → Verified receipt**,
with missing work classified REUSE / EXTEND / REPAIR / NEW. The acceptance question: *can the
customer ask PAIGE to accomplish something, see the actual change in the correct part of the
platform, understand its status, and return later to verify the result?*

**SHELL:** SOLO. **State as of:** 2026-10-13, main `c4a68eb38` (E2-1 #2075, E2-2 #2082,
E2-3a #2092, E2-3b #2110 all merged and deployed; repeat authenticated QA requested on #2102).

## Outcome A — the conversational COO briefing (LIVE, read-only)

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
| No owner-facing briefing surface beyond the chat transcript | **NEW** (roadmap slice E2-6, Impeccable-gated): a COO view grounded in the SAME canonical records — it must read through the fabric/issuer, never a second data path |
| Cannot navigate from a briefing figure to the departmental record/view it came from (a pipeline number → Sales; a Systems Check risk → Systems Check; a client count → Clients) | **EXTEND** (with E2-6): links/anchors from briefing lines to the existing departmental views — reuse the views, do not duplicate them |
| The briefing names risks; the owner cannot yet act on them from chat (actions refused during INT-346) | **REUSE (already built, gated):** the governed action machinery — Spine executors, `paige_pending_confirmations` approval cards, Rail receipts, PlanInMotion — exists and activates with INT-346; no new machinery is needed or being built |

## Outcome B — the action request during DRAINING (LIVE, refusal-by-design)

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
gains the matrix-validation legs recorded in its "Customer-visible validation" section —
persist/reload verification of the briefing, visible-state checks, and the navigation
expectation recorded as the known E2-6 gap. Prior tests are unchanged.
