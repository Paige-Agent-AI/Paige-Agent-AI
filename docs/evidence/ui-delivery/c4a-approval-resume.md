# UI delivery evidence: c4a-approval-resume — an approval resumes the same objective (C4a)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow SKILL.md (references inlined) read by the C4 orchestrator; the pre-edit packet (mode Existing Project repair + New Feature, Deep, R3; flows F2 decide on a proposed action and F5 reopen a saved thread; changed-file boundary; regression map; failing-first plan) is summarised in docs/delivery/paige-conversational-loop-c4.md §1 and was re-verified line by line against the worktree before the first edit
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md, reference/operate.md (Operate mode) and reference/craft-floor.md read; impeccable context loaded PRODUCT.md (incumbent world undocumented, narrow refinement of existing code); the change draws the frozen C3 prototype frames a3/a4 with the incumbent tokens only; impeccable detect on the changed src files exits 0 with no findings (identical at base). Honest order: the craft floor was read after the first client edit and the rendered result was then checked against it in one batched round
MATERIAL_FLOW_CHANGE: YES: after Approve, the server now runs the exact approved act from its stored proposal and PAIGE continues in the same request; in the Solo chat and the PAIGE drawer a follow-up the server carried forward is drawn as one answer with the one that asked (one line that restarts on the running step and then reads What PAIGE did over the steps before and after the card, no seam), and a reload draws the same line, steps and report card
FLOW_PROTOTYPE: PASS: docs/design-references/prototypes/paige-turn-states-c3.html frames a3 (Approved — PAIGE resumes in the same answer) and a4 (Done — the act is confirmed), approved by the owner (Antonio Cook) 2026-10-05 and §28-frozen (docs/delivery/paige-conversational-loop-c3.md); C3 deferred exactly these frames to C4; the C4 owner order names them as the target
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the owner or a team member deciding a proposed action in the Solo PAIGE chat or the PAIGE drawer (Solo, sub-account, agency); primary action = Approve, then see the approved act run once and PAIGE carry on with the same request, without asking again
VISUAL_DIRECTION: PASS: incumbent Solo [data-pg] bubbles and the C3 status line kept; the seam between the two answers closed with the existing bubble tokens (no new colour, no gold); the running indicator stays the indigo --primary dot and sweep; gold remains only on Approve and the composer Send/Stop key (and the existing mobile New chat button)
AUTOMATED_EVIDENCE: PASS: client-memory-authz 650/0 after the review fixes (633/0 before them; base 597/0; group 39 and the declared updates are red on main — 21 failures — and 8 of the 17 review-fix checks are red on the pre-fix server); knowledge-scope stage1 420/0 (= base); Deno resume.test.ts 14/14; vitest PaigeAIChat.turnStates 23/23 (5 new), turn-view.test (4 new), paige-turn-reducer.test (3 new), approval-outcome.test, confirm-gate-containment-wiring.test (declared update: a second producer of the never-ran marker), continuation-loop.test; full npx vitest run after the review fixes: 617 files, 9278 tests — 9265 passed, 13 failed, all 13 in TenantCommandCenterShell.ownership, the load-timing flake that fails identically at base (13) and passes 30/30 run alone (the pre-review full run passed it: 9275 passed, 0 failed); base: 9251 passed, 13 failed (same suite), 2 skipped; npm run build green (38.5s after the review fixes); mutation tables below
STATIC_EVIDENCE: PASS: npm run -s ci:tsc ratchet baseline 10 = current 10; deno check supabase/functions/paige-ai-chat/index.ts 10 diagnostics vs base 11 (same kinds, one TS2345 fewer: the round reader now takes a typed Response); lint:approval-gate, approval-direct-write, governed-execution, action-authority, action-risk, chat-tool-registry, capability-declaration, write-targets, receipt-coverage, tier-features, solo-parity, mcp-governed-door, views, definer-fns, migration-versions all pass; lint:gold and lint:impeccable report the same pre-existing findings as base (BusinessCreditDashboard gold fill; three advisory grid backgrounds)
RENDERED_EVIDENCE: PASS: harness render · not live — 32 frames of the REAL PaigeAIChat via scripts/live-drive/harness/paige-chat-mount/solo.html with ?resume=1 (scripted SSE: paige_turn started → resumed → paige_step running/done → paige_approval_outcome → completed), light and dark, page and drawer, in docs/evidence/ui-delivery/assets/c4a-approval-resume/ with results.json; every frame: one status line, one resumed seam, no horizontal overflow, zero page errors, no synthetic decision bubble, no chain-of-thought, no "resume" wording in visible text; status text, meta and step rows ≥ 5.37:1
BEHAVIORAL_EVIDENCE: PASS: the real handler driven in Node against in-memory doubles (client-memory-authz group 39: approve with no model re-emit runs the stored act once and then calls the model with its result; a re-emit is refused as already handled, a drifted re-emit on a lane now auto becomes a card, not a second write; two concurrent approvals run once; another user/tenant/thread/client runs nothing; A→B→A refuses 409 in B and runs once back in A; expired, swept, expired-mid-flight, lane-off, role-lost, no-longer-offered and used-elsewhere outcomes are truthful; only a resumed turn tells PAIGE the act was attempted; Operator (no thread) is not resumed, a God-tier thread is; Studio resumes and a narrowed Studio scope leaves the approval unspent); the jsdom integration suite and the Playwright harness click Approve in the real component; all of it is a double of the server, not the deployed runtime
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session or test credentials in this build environment (the Solo QA tenant and LIVE_DRIVE_* secrets are an open owner decision, plan §9.2); a real approval on a Solo test workspace must be driven after merge, reading back paige_pending_confirmations.consumed_at, the written record and the turn's bundle_ref.paige_resume
KEYBOARD_FOCUS: PASS: Shift+Tab from the composer reaches the single status line of the combined answer (c4a-kbd-a4-line-page-dark): focus outline rgb(156, 143, 224) solid, the indigo --ring, 6.38:1 against the bubble; the report card keeps its own focus-on-mount behaviour unchanged
ZOOM_REFLOW: PASS: 200% zoom emulated as 683x384 at DPR 2 (c4a-zoom200-a4-page-light) and 320px reflow on the drawer (c4a-reflow320-a4-drawer-dark): no horizontal overflow on document or transcript; the combined bubble wraps
REDUCED_MOTION: PASS: with prefers-reduced-motion: reduce the running line has no sweep element (c4a-rm-a3-reduced-motion-page-light: zero [data-sweep]; full motion: one, animation ptl-sweep); no new motion was added by C4a
STATE_COVERAGE: PASS: resumed and running (a3), resumed and done (a4, trace open and closed), the report card Running → Done, a follow-up the server did not carry forward (unchanged C3 presentation, tested), reload of a resumed answer (tested: same line, steps and report card), a saved report outside the contract (no card drawn, tested); server outcomes ran / used elsewhere / expired / lane off / check unavailable are driven in the harness group, not rendered
TRUTHFUL_STATE_LABELS: PASS: the one-answer presentation is drawn only when the server said resumed (live paige_turn) or the record says turn_state.resumed (reload); nothing reads prose; the report card's sentences come from the server's closed set (one added: expiry) and the record keeps the wire frame verbatim, read back against the closed set; no visible text says resumed; a reader hears "Approved. PAIGE is working" only where no report card already speaks (the drawer)
SOLO_UI: YES: the Solo PAIGE chat (SoloPaigeWorkspace -> PaigeAIChat) and the tenant shell's PAIGE drawer (TenantCommandCenterShell -> PaigeAIChat), Solo / sub-account / agency
SOLO_1536X770_PAIGE_CLOSED: PASS: harness render · not live — c4a-matrix-a4-page-{light,dark}-1536x770.png; "closed" is the full-width PAIGE workspace; one line, one seam, no overflow
SOLO_1536X770_PAIGE_OPEN: PASS: harness render · not live — c4a-matrix-a4-drawer-{light,dark}-1536x770.png; the docked panel; no overflow
SOLO_1366X768_PAIGE_CLOSED: PASS: harness render · not live — c4a-matrix-a4-page-*-1366x768.png plus the a3/a4 frames at 1366x768
SOLO_1366X768_PAIGE_OPEN: PASS: harness render · not live — c4a-matrix-a4-drawer-*-1366x768.png plus c4a-a3/a4-*-drawer-*
SOLO_1024X768_PAIGE_CLOSED: PASS: harness render · not live — c4a-matrix-a4-page-*-1024x768.png; no overflow
SOLO_1024X768_PAIGE_OPEN: PASS: harness render · not live — c4a-matrix-a4-drawer-*-1024x768.png; no overflow
SOLO_900X1000_PAIGE_CLOSED: PASS: harness render · not live — c4a-matrix-a4-page-*-900x1000.png; no overflow
SOLO_900X1000_PAIGE_OPEN: PASS: harness render · not live — c4a-matrix-a4-drawer-*-900x1000.png; no overflow
UNVERIFIED: the authenticated deployed chat with a real approval; the real model's wording after the resumed act and its adherence to the neutral rule 1 and the turn-local resume note (the harness model is a stub); Studio in a browser (its server path resumes — harness 39.20 — but its client does not draw the resumed frame, C3b); Operator is NOT covered at all — its client sends no thread, so its approvals still depend on the model re-emitting them (harness 39.19; open work under owner gate 1); the real fonts (sandbox fallback); the shell chrome around the chat

OWNER_INTENT: Antonio Cook, 2026-10-05 (C4 order): after Approve the server carries the exact approved work forward — the model never regenerates it — and PAIGE continues the same objective; one approval gate, the stored fingerprint and arguments; no approved flag, no model-authored confirmation, no second approval store, no hidden bypass; render the resumed state per the frozen C3 frames a3/a4
MUST_NOT_HAPPEN: no act running twice (double click, refresh, reopen, a second tab, a model re-emit); no act running without spending its approval (a lane moved to auto); no act from another user, workspace, thread or client; no fresh card minted for an act that already ran; no "done" without the act's own success result; no change to declines, door proposals, Live refusals or document turns; no visible "resumed" wording; no new gold
MUST_PRESERVE: the decide card, the decided record, the report card and its Ask Paige again / check links, the hidden decision sentence still sent and saved, C3's presentation for any follow-up the server did not carry forward, the C2b step lifecycle, saved-thread reload, the composer scope and request fence, the client-side CRM and pipeline lanes (C4b)
ACCEPTANCE_CRITERIA: on the signed-in Solo chat a human (1) asks for an approvable act, sees the card, presses Approve, and sees the act run once and PAIGE continue in the same answer without asking again; (2) presses Approve twice quickly and the act still runs once, the second report saying it can't confirm; (3) reloads and sees the same line, steps and report card; (4) switches workspace and back and nothing from the other workspace runs
MOTION_PURPOSE: none added — the existing C3 sweep restarts on the same line while the carried-forward act runs (state, not decoration) and stops when it is done; reduced motion: no sweep
PROTECTED_SEAMS: tested — the stream dispatch (PaigeAIChat.stream), approval recovery and report cards (approvalRecovery), C3 turn states incl. the unchanged non-resumed continuation, reload hydration, composer scope; the general approval gate, claim, decline, door lanes, Live refusal and the turn-frame audit in client-memory-authz and knowledge-scope; unaffected and named — PaigeConfirmCard, PaigeTurnStatus, PaigeResearchCard, PaigeCrmResultCard, Studio and Operator clients, usePaigeThreads, crm-command, sales and growth-publish doors, every migration

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 5307015f617f546f7ceccb5822f959740a372fce; deployment=none-uncommitted-worktree; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat deploys from main on merge and the edge-live readback is owed); evidence=docs/evidence/ui-delivery/c4a-approval-resume.md (base commit; the branch head is set when the change is committed)
RELEASE_CHANNEL: development: uncommitted worktree on branch c4-resume; PR, independent review and merge follow
RELEASE_CLASSIFICATION: internal-only: the approval path finishes what the person already approved; no new capability, permission or data class
CUSTOMER_RELEASE_IDENTITY: none: no customer release record; deployment-only change pre-launch
RELEASE_NOTE_REQUIRED: NO: internal runtime and presentation change pre-launch; a customer note belongs to the eventual release of the conversational loop
RELEASE_TRUTH_BOUNDARY: PARTIAL: test-proven against the real handler with in-memory doubles and harness-rendered against scripted frames; the deployed signed-in behaviour is PROOF OWED; ask-user, durable work and door proposals are UNAVAILABLE in this slice by design (C4b–C4d)
RELEASE_RECOVERY: position=git revert of the merge commit restores the model-re-emit approval path and C3's presentation, with no table, column or migration to undo (turns it saved keep extra bundle keys that old readers ignore); reference=docs/delivery/paige-conversational-loop-c4.md

## Mutation proofs

Server (`scripts/client-memory-authz`, each: reinstate the defect, run the whole harness, restore):

| Mutant | Result |
|---|---|
| M1 resume disabled (main's behaviour) | 20 fail (run before 39.8a existed): 13.6b2, 18.H12, 18.H15, 18.7h, 39.1–39.1e, 39.2, 39.2b, 39.3–39.3d, 39.7b, 39.8, 39.8b, 39.9, 39.10 |
| M2 thread predicate dropped from the resume selection | 2 fail: 13.6b2, 39.4 another thread |
| M3 no already-handled guard | 7 fail incl. 39.2, 18.H12, 18.H15 |
| M4 a lane moved to auto skips the claim | 1 fail: 39.10 |
| M5 a consumed row at selection is skipped | 1 fail: 39.3d |
| M6 a failed resumed claim falls through to a fresh card | 2 fail: 39.3, 39.3b |
| M7 the resumed round counted as a no-progress signature | 1 fail: 39.2b |
| M8 the lookup may spend a handled approval / act | 1 fail: 18.7h |
| M9 no `paige_resume` record | 2 fail: 39.8, 39.8b |
| M10 the record without the wire report | 1 fail: 39.8b |
| M11 the server-only pin ignored | harness aborts (detected) |
| M12 the resumed round counted as a model round | 1 fail: 39.8a (added after this mutant first survived) |
| M13 no `resumed` frame on the wire | 1 fail: 39.1d |

Review-fix round (verifier + compliance FIX_FIRST), whole harness, 650 checks at head:

| Mutant | Result |
|---|---|
| MV1 integrity check dropped from the resume selection | 1 fail: 39.15 (survived review) |
| MV4 tenant predicate dropped | 2 fail: 13.6b2, 39.4 |
| MV5 lane `off` overridden for a resumed act | 1 fail: 39.11 |
| MV6 subject-key re-emit refusal removed | 1 fail: 39.14 (survived review) |
| MV7 consumed-at-selection not marked used elsewhere | 1 fail: 39.3d |
| MV8 the lookup's skip of resume-handled approvals removed | 1 fail: 39.17b (survived review) |
| MV9 expired rows resumed | 2 fail: 39.9, 39.9b |
| MV10 never-the-same-request predicate dropped | 1 fail: 13.6b2 |
| MV11 `!liveRuntimeScope` dropped | **survives — equivalent**: a Live request carrying any approval is refused 403 at the top of the handler (~L1120), so the clause is always true when reached |
| MV15 door tools treated as resumable | 1 fail: 39.21 (survived review in the harness; Deno caught it) |
| MV16 no suspended turn id | 1 fail: 39.8 |
| N1 issuing-request narrowing dropped | 1 fail: 39.16 |
| N2 capability-fingerprint check dropped | 3 fail: 39.17, 39.17b, 39.20b |
| N3 same-tool confirm clamp dropped | 1 fail: 39.13 |
| N4 a swept row read as used | 1 fail: 39.9b |
| N5 claim-time expiry read as lost | 1 fail: 39.9c |
| N6 resume note on every turn | 1 fail: 39.12b |
| N7 no resume note | 1 fail: 39.12 |
| N8 rule 1 claims the act ran | 2 fail: 39.12, 39.12b |
| N9 catch does not roll back `approvalTokenTool` | **survives**: observable only when an approved-set lookup also failed in the same turn (the card would then say "Paige didn't run this" instead of "something went wrong checking"); not driven |
| N10 withheld reported as not attempted | 3 fail: 39.17, 39.17b, 39.20b |

Client (`PaigeAIChat.turnStates.test.tsx`):

| Mutant | Result |
|---|---|
| C1 resumed never detected | 2 fail (live one-answer; wire = persist = reload) |
| C2 reload drops the saved report | 1 fail (wire = persist = reload) |
| C3 the resumed flag not sticky past the terminal | 2 fail |
| C4 the asking answer's steps not merged | 1 fail (wire = persist = reload) |
| C5 reload ignores `turn_state.resumed` | 1 fail (wire = persist = reload) |
| C1' the merge loosened to any decision (survived review) | 1 fail ("only an APPROVAL is drawn as the same answer") |

## Review and limitations

- The harness draws the chat inside a minimal [data-pg] host; the Solo nav, history rail and tabs are not drawn.
- The first answer of the combined bubble keeps its own timestamp and copy / listen row (it is still its own saved turn, and copy / listen are shipped capabilities, §58); the owner may prefer one row at the end — named for the live look.
- Independent review (spec compliance, adversarial verifier, Impeccable critic, compliance officer) has not run on this change yet.
- Fixtures are illustrative (Reyes & Co., invented); no real account (§63).
