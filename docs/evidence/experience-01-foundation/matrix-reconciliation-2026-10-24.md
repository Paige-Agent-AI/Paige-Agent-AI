# E01 matrix reconciliation — 2026-10-24 (zCod)

Reconciles every original acceptance case across the ten-outcome and 23-case matrices
(`integrated-readiness-2026-10-17.md` + its addenda) against engineering state at main
`a9166be54` (PR6 #2769 `d90a04f7c`; PR7 #2780). Per the owner's directive,
each row separates **missing implementation**, **missing customer proof**, **dependency
owner**, and **next action** — a row is never "blocked" without naming who holds the
unblock. Truth levels unchanged: only OWNER ACCEPTANCE is globally absent.

**Engineering delta since the 2026-10-19 addendum** (all merged): unauthorized-control
removal + unobtrusive resume (#2438 `4f87f850b`); the interview second-turn authority
repair with LIVE authenticated proof (#2415 `8ada5c00e` — 5+ consecutive answers on the
real thread, governed proposal staged); Setup route verification (#2598 `daa6858bb`);
voice-first entry + honest Capabilities rows (#2611 `b9effc47d`) + repo audit unblock
(#2616); reliable interview resume + retirement (#2642 `4e339bc9e`); the Live
acknowledgement consent gate + per-account truthful status (#2657 `2748432e1`); MENTOR
remap (#2374 `628e0ce58`); PR5 verification frames (#2710 `94539db3b`); consent-fold
repair (#2721 `04edecb0f`); the owner-commissioned immersive Live stage (#2724
`2bf982e33f`); chat-continuity hardening + the four public behavior proofs (PR6 #2769
`d90a04f7c`); the first-governed-action journey proof (PR7 #2780, merged
`a9166be54`). Separately, main's composer-scope rearchitecture (draft sessions, reload
protection, controlled-sync state machine) closed the D1/D2/D4-class panel defects;
PR6 re-diagnosed and pinned that closure behaviorally.

## Part A — ten-outcome reconciliation

| # | Outcome | Missing implementation | Missing customer proof | Dependency owner | Next action |
|---|---|---|---|---|---|
| 1 | Authentic first/returning SOLO entry | **None.** Admission hydration, server-selected workspace, history rail, verified interview resume (`latest_solo_business_interview_thread`), stale-`?onboarding=1` retirement all merged. | Authenticated fresh signup + returning-login entry on the designated ordinary account. | Founder (single evaluation window). EXP00 owns the signup shell it hands over from. | Execute in the founder window; record per-case results against the register. |
| 2 | Natural conversation-led onboarding | **None.** Interview surface, per-turn Setup re-read, answer binding with claim-once, marker-supersession repair (#2390 + #2415) merged and live-proven. | A full fresh interview run by the owner (the live proof covered continuation, not a cold start). | Founder. | One cold-start interview in the window; D-case recording below. |
| 3 | Adaptive questions from confirmed context | **None.** `nextInterviewField` + comms question merged; ALG-02 grounded state production-verified. | Owner observing questions adapt to confirmed facts in the same run. | Founder. | Observe during the outcome-2 run. |
| 4 | Progressive editable business profile | **None.** Review editor, provenance, conflict/stale states, editable guidance questions merged. | Owner editing a fact and seeing the corrected value persist through readback. | Founder. | Exercise during the interview run (D5). |
| 5 | Governed Setup + Comms persistence | **None.** Canonical save/readback/correction; comms guidance + secure handoff; no chat write path (deliberate). | One real Setup save and one real preference toggle + readback by the owner. | Founder. | Steps 2–3 of the walkthrough. |
| 6 | Integrations/Connections/Vault guidance | **None.** Guidance prompt, three secure handoffs, truthful prerequisites merged. | Owner following one handoff round trip with honest status. | Founder. (Future provider connections = EXP10, out of E01 scope.) | Step 4 of the walkthrough. |
| 7 | Three/four relevant capabilities | **None.** Conversation-orchestrated projection (`capability_status`/`integrations_list`), 3–4 truthful framing, ALG-13 ranked actions panel merged. | Recommendation quality in a live model session. | Founder. | Step 4 of the walkthrough. |
| 8 | First governed action + durable Rail evidence | **None.** Full chain merged: prompt → `planning.assign_task` proposal (chatBinding LIVE, ordinary risk, chat-canonical approval, member seat) → server-issued fingerprinted approval → canonical Planning write → capability-run record → Rail/audit. PR7 #2780 pins the public-surface journey end to end. | The ONE real approved action + Rail receipt on the owner's account (the row-8 definition of first value). | Founder. | Step 5 of the walkthrough — the heart of the single evaluation. |
| 9 | Responsive Chat and Live speech | **Live activation only.** Architecture complete (one voice path; budget-gated through canonical chat; consent gate #2657; immersive stage #2724). Live STT/TTS usage persistence remains deliberately unpersisted — a platform budget-lane decision, not an E01 build. | Organic latency samples (p50/p95), a real interruption, and the founder's OWN acknowledgement → microphone → bidirectional audio. | **Founder holds activation + the personal Live steps (PROOF OWED — FINAL EVALUATION WINDOW, never manufactured).** Platform budget lane holds usage persistence (decision, no E01 action). INT-346 posture governs rollout. | Founder window: acknowledge, open Live, one short exchange with an interruption. |
| 10 | Durable resume/correction/recovery/later-session continuity | **None.** Checkpoint/correction/conflict contracts; reload draft retention + full transcript rehydration pinned by PR6 #2769; later-return of a settled approval pinned by PR7 #2780. | Owner sign-out/relogin persistence + later-session return to the SAME settled result. | Founder. | Steps 6–7 of the walkthrough. |

## Part B — 23-case reconciliation

Every C-case and D-case keeps its OWNER WINDOW / PROOF OWED disposition for the
*authenticated execution*; the table below adds only what the four separated dimensions
require. Cases C01–C10 and OP01 are verbatim from ANT-52; D1–D12 derived from the #2071
contract; the authoritative enumeration remains the owner's register (auth-gated) — any
divergence resolves to it.

| Case | Missing implementation | Missing customer proof | Dependency owner | Next action |
|---|---|---|---|---|
| C01 registration | None | Fresh-signup execution | Founder (agent signup not permitted — standing rule) | Window |
| C02 email verify/login | None | Real verify + login | Founder (no agent credential custody) | Window |
| C03 Solo provisioning | None | Real provision | Founder | Window |
| C04 workspace selection | None | Real selection | Founder | Window |
| C05 Setup + first-value onboarding | None | The full run | Founder | Window (steps 2–3) |
| C06 logout/relogin persistence | None | Real cycle | Founder | Window (step 7) |
| C07 business-module access | None | Real navigation + gates | Founder | Window |
| C08 unavailable data/disconnected providers | None | Honest states observed live | Founder | Window (step 4) |
| C09 subscription/account context | None | Real account view | Founder | Window |
| C10 first useful outcome + durable readback | None (chain source-live; journey pinned by #2780) | **The ONE real action + Rail receipt** | Founder | Window (step 5) |
| OP01 operator ≠ owner | None | Operator entry observed non-impersonating | Founder | Window |
| D1 interview opens privately | None | Real open | Founder | Window |
| D2 review suggested fact + provenance | None | Real review | Founder | Window |
| D3 confirm fact → canonical save | None | Real save | Founder | Window |
| D4 authoritative readback | None | Real readback | Founder | Window |
| D5 correct fact → conflict honored | None | Real correction | Founder | Window |
| D6 pause/skip retained | None | Real pause | Founder | Window |
| D7 resume in same thread | None (verified resume path #2642) | Real resume | Founder | Window |
| D8 honest inability before egress | None | Real refusal observed | Founder | Window |
| D9 cross-tenant/thread fencing | None (negatives in CI; panel continuity pinned #2769) | Real switch | Founder | Window |
| D10 3–4 truthful capability recs | None (ALG-02/13 core production-verified) | Live-model quality | Founder | Window (step 4) |
| D11 comms guidance + one real preference save | None | Real save round trip | Founder | Window (step 3) |
| D12 first action proposal→approval→task+Rail | None (pgTAP chain contracts; #2780 public journey) | Real approval + receipt | Founder | Window (step 5) |

**No case is missing implementation.** Every engineering-verifiable precondition is
green on main as of `d90a04f7c`, unchanged through `a9166be54`. The single class of missing customer proof is the
authenticated executions themselves, and one owner decision (Live activation) plus one
platform-lane decision (Live usage persistence) sit outside E01's authority.

## Part C — capability outcome map (canonical algorithm support)

Per the directive, canonical IDs with actual wiring and maturity explicit:

- **ALG-02 (grounded state)** — wired: `first-value-recommendation.ts` FIRST_VALUE_LOGIC_VERSION 1, reads the canonical `resolve_tenant_domain_identity`; surface: SoloFirstValue "Where you actually are". Maturity: production-verified (served bundle readback #2365). Authenticated recs = owner window.
- **ALG-13 (ranked first actions)** — wired: same module, ranked explainable actions with approved availability labels; dismissal honesty pinned. Maturity: production-verified. Live quality = owner window.
- **ALG-11 / ALG-12 (Model Fabric lanes)** — inspected where applicable: not wired into E01 surfaces by design; E01 consumes the platform model routing (Live turns included) without fabric-specific dials. Any E01-facing effect arrives through Model Fabric's own lane (INT-334), not EXP01.
- **ALG-03 (EXP02)** — not an E01 surface; excluded here.

## Part D — remaining blockers and owners (rollup)

1. **Founder Live steps — PROOF OWED, FINAL EVALUATION WINDOW** (owner's own acknowledgement → microphone → bidirectional audio; organic p50/p95; one interruption). Owner: Antonio. Engineering must not and does not manufacture these.
2. **The 23 authenticated executions** — Owner: Antonio (single evaluation window on the designated ordinary account; no new accounts, no credential custody, no impersonation).
3. **Live activation/rollout** — Owner: Antonio, under the INT-346 DRAINING posture (structural spend ceiling + #2657 consent gate in place).
4. **Live STT/TTS usage persistence** — Owner: platform budget lane (a new component decision; E01 deliberately builds no parallel meter).
5. **Nothing else is blocking E01 engineering.** PR6 #2769 and PR7 #2780 both merged; no open EXP01 implementation gap exists in the ten-outcome or 23-case matrices.

## Part E — the single founder evaluation walkthrough (final form)

1. Sign in with the ordinary SOLO account; select the workspace (C01–C04).
2. Open PAIGE Chat — the interview resumes in the private thread (D1); answer, review, correct, save; readback confirms (D2–D5). Observe questions adapt (D10 context).
3. Settings → People & email via "Open Communications"; one real preference toggle with honest save; return (D6–D7, D11).
4. "What can help?" — evaluate 3–4 truthful recommendations (D10, C08); one integration handoff round trip (C07).
5. **"Choose a first action" — review the proposal, approve the ONE bounded internal action, verify the saved result, its status, and the Rail receipt; probe replay/refusal honesty (D12, C10).** This is the row-8 definition of first value for a coach or consultant: useful authorized work accomplished and retained, not advice.
6. Read-aloud one message (progressive playback, Stop/Hold). If Live is activated for the window: acknowledge the disclosure, one short Live exchange with an interruption (the personal steps this packet owes).
7. Sign out and back in; confirm persistence and the same settled result (C06, D7, outcome 10).
