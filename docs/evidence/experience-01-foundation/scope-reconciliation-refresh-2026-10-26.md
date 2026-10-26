# E01 scope reconciliation refresh — 2026-10-26 (zCod, per execution command)

Supersedes the "only founder evaluation remains" reading of the 2026-10-24 packet. Every original outcome and case re-verified against **current main `e0263aac0`** (not assumed from any release), with the COO-FIT chain walked seam-by-seam. Classifications use the commanded buckets: **implemented / proof owed / confirmed missing behavior / genuine external dependency / accepted**, each with its current evidence. The 2026-10-24 matrix's rows remain the base; this refresh records what changed, what was re-verified, and the honest corrections.

## COO-FIT chain walk (all seams verified at `e0263aac0`)

| # | Seam | Verification at current main | State |
|---|---|---|---|
| 1 | Legitimate owner context | `get_solo_business_context` consumed by workspace + chat (source); owner_full scope checks in panel RPC flows | Implemented; authenticated proof owed |
| 2 | Natural conversation and Setup | Interview surface + `latest_solo_business_interview_thread` resume (#2642) + Setup save/readback contracts — unchanged by all merges since | Implemented; authenticated proof owed |
| 3 | Relevant existing departmental capability | Chat per-turn capability manifest (projection over emitted tools + Spine + workspace authority + readiness; wiring pinned by `capability-status-tool-wiring.test.ts`; injected per turn; `capability_status` offered as read tool) | Implemented — **re-verified in depth by the Access-column investigation (companion record)** |
| 4 | Scoped approval | Chat-canonical fingerprinted approvals; PR7 #2780 public-surface journey (proposal→approve→wire→settled outcome→durable return) | Implemented; authenticated proof owed |
| 5 | Authorized action | `planning.assign_task` chatBinding LIVE / ordinary / chat-canonical / member (planning_writes.ts, re-verified at this head) | Implemented |
| 6 | Original domain result + Work/Rail receipt | `record_capability_run` → `paige_workspace_events` with enforced `capability_key` (20261212000000); owner rail read `get_solo_rail_activity` — created 20261042000000 over client events, extended to workspace events by 20261201000200/20261201000800 and finalized in 20261212000000:514+ (UNION of both streams with `_workspace_event_display`); it feeds the Solo Systems-Check workspace rail + PaigeSidebar (`useSoloActivityFeed`, safe-fields-by-construction); chat outcome cards (PR7) | Implemented structurally end-to-end — **upgraded from 'cited in source' to traced through every table/RPC/render hop** |
| 7 | Discoverable status, exception, recovery | Rail feed (above), approvals badge (`usePendingApprovals` in shell), `ScreenLoadBoundary` download recovery (#2884, deployed), composer/Rail continuity proofs (#2769) | Implemented; authenticated proof owed |
| 8 | Durable return | Reload draft retention, full-transcript rehydration, settled-proposal return — all pinned by #2769/#2780 suites at this head | Implemented; authenticated proof owed |

## Ten-outcome refresh (deltas from 2026-10-24 only)

1. **First/returning entry** — IMPROVED beyond the packet: #2884 deployed (SoloEntry 2,609.64→385 kB raw live on prod, readback 6408119367; lazy screens; download recovery). Classification: implemented (+ deployed, verified); authenticated first-entry proof owed. The 85% figure is the **SoloEntry increment only** — the ~1.18 MB app shell loads first for every route, before and after; stated plainly per command.
2. **Conversational onboarding** — unchanged; implemented; proof owed.
3. **Adaptive questions** — unchanged; implemented (ALG-02 core production-verified); live-quality proof owed.
4. **Editable profile** — unchanged; implemented; proof owed.
5. **Setup + Comms persistence** — unchanged; implemented; owner-save proof owed.
6. **Integrations/Connections/Vault guidance** — unchanged; implemented; proof owed.
7. **Three/four capabilities recommendation** — unchanged; implemented (verified deeper this pass — seam 3); live-model quality proof owed.
8. **First governed action + Rail evidence** — seam 6 UPGRADED to fully traced (this refresh); implemented; the ONE real action + receipt = founder window.
9. **Chat/Live responsiveness** — Live activation + personal audio + organic latency: **genuine external dependency (owner-held under INT-346 posture)**; architecture implemented and test-proven.
10. **Resume/correction/recovery** — strengthened since the packet (#2769 proofs; #2884 recovery boundary deployed); implemented; sign-out/relogin proof owed.

## 23-case refresh

All C01–C10, OP01, D1–D12 re-classified **implemented / proof owed (founder window)** with their original evidence intact — with these honest corrections and additions:

- **No confirmed missing behavior in any case** after this pass's re-verification (previously-untraced seam 6 now traced end-to-end).
- **Real-customer performance for the code-split** joins the proof-owed set: bundle reduction is deterministic fact; the 35.8s→17.5s figure is **synthetic local throttled-browser timing, not measured authenticated customer performance** — so stated per command.
- **Capabilities truthfulness (coordinator 4f9b5860)** — RESOLVED by companion record `capabilities-access-truthfulness-2026-10-26.md`: display correct, source-grounded; no repair required; one structural seam named (no client-callable capability-manifest door — existing owner: the capability-status/Chat seam; extending it is theirs, not EXP01's); two proof-owed legs (live row readback — no DB seam this window; authenticated panel view).

## Canonical ALG support (actual wiring / signals / output / maturity)

- **ALG-02 (grounded state)**: wired — `first-value-recommendation.ts` FIRST_VALUE_LOGIC_VERSION 1 (re-verified at this head), signals = canonical tenant-domain identity + saved business context, output = the "Where you actually are" grounded panel (mounted via SoloFirstValue in the interview surface), maturity = production-verified source + rendered evidence (#2365, #2710 eras); authenticated recs proof owed.
- **ALG-13 (ranked first actions)**: wired — same module and signals; output = explainable ranked actions with honest availability labels; maturity = production-verified; live quality proof owed.
- **ALG-11 / ALG-12 (Model Fabric)**: **NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — VERIFICATION OWED**: not wired into any E01 surface by design; E01 consumes platform model routing without fabric dials. Any E01-facing effect would arrive through INT-334's own verified wiring, which does not exist for E01 surfaces today.
- **ALG-03 (EXP02)**: excluded (not an E01 surface).

## Remaining external dependencies (exact, with owner)

1. Founder window (Antonio): 23 authenticated executions; personal Live consent→audio→interruption; real-customer performance legs; final acceptance.
2. Live activation: owner-held (INT-346 posture).
3. Live STT/TTS usage persistence: platform budget lane.
4. DB seam for live row readbacks: channel limitation this session (Supabase MCP absent); recorded, not manufactured.
5. Linear MCP: reporting-channel limitation only — ANT-50 resumption acknowledgment + these records post when access returns; **no ANT-50 acknowledgment is claimed until it actually exists.**

No other blockers. No confirmed missing implementation in the original scope.
