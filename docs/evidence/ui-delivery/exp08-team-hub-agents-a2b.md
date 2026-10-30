# UI delivery evidence: EXP08 Team Hub agents, A2b — approval cards read and redeemed through the hub's own wiring (ZION hand-over and cancel, NEXUS page publish, PAIGE the union)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: contract docs/delivery/exp08-team-hub-agents-contract.md section 5 A2 (slices 2–4) and flow 6 (an agent proposes an action); grounding read before the harness was built: src/solo/team-hub/useTeamHub.ts (readCardStates, actOnCard, the 3 s working poll), src/solo/team-hub/team-hub-agents.ts (parseCardStates, parseCardAct, cardActLine, REDIRECT_LINE), src/solo/team-hub/TeamHubWorkspace.tsx (onApprovalAct falls back to hub.actOnCard; Open DM keyed on the redirect line), supabase/functions/_shared/team-hub/card-tools.ts (CardProvenance.summary), card-act.ts (doneNote, DONE_NOTE, FAILED_REASON, OUTCOME_LINE), growth-publish-command/contract.ts (previewSummary) and team_hub_card_states in supabase/migrations/20271121140008_exp08_team_hub_a2b_cards.sql
PAIGE_UI_DESIGN: PASS: no redesign; the A2 card design is APPROVED-FROZEN (§28) and TeamHubApproval.tsx, PaigeConfirmCard.tsx and team-hub.css are unchanged in this work; A2b only feeds the frozen card from the server read; the one new visible element (review fix 2, the line under a card whose act didn't go through) reuses the existing .th-fail row style with no CSS change; measured in every frame of report.json: gold only on Approve (goldOutsideApprove false in 77/77 shots, Approve background equals --pg-gold-fill; in the PAIGE DM frames the other gold is PAIGE's own identity strip and plate, counted apart as goldUse.paigeIdentity), agent colour only in the strip (agentColourInFooter empty in every card)
MATERIAL_FLOW_CHANGE: YES: the asker's Approve and Not now in an agent DM now redeem the card (A2 drew a refusal where no seam existed); a shared conversation answers an act with a Suggest plus the server's redirect line and an asker-only Open DM; a refusal that leaves the card undecidable (not_yours, not_visible, conversations_off) now shows the card's own refusal instead of a live Approve, and could_not_start keeps Approve with a visible line under the card
FLOW_PROTOTYPE: PASS: the A2 card frames are the approved design (docs/evidence/ui-delivery/exp08-team-hub-agents-a2a.md and docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2/); the A2b states are rendered for the owner in docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/ (77 measured frames plus 6 focus, Enter, zoom and reduced-motion frames, 83 PNG files) before any deploy
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the owner or an admin of a SOLO workspace who asked ZION, NEXUS or PAIGE for a hand-listed act (task hand-over, task cancel, page publish) in their own agent DM; the one primary action is Approve (gold), with Not now beside it; nobody else is offered a control
VISUAL_DIRECTION: PASS: frames docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/a2b-*-1366-dark.png and -light.png; WCAG contrast measured over the composited background (report.json cards[].contrast), 1366 dark/light: kind line 10.91/5.48 (ZION), 5.90 light (NEXUS), 6.42 light (PAIGE), summary 16.01/14.78, expiry note 11.68/10.10, footer status 12.02/10.28, Approve label 9.04/7.37, Not now 12.02/10.28, failed reason 8.55/5.23, the could_not_start line under the card 8.84/5.26 (12 px, measured separately with the same method) — all at or above 4.5:1
AUTOMATED_EVIDENCE: PASS: npx vitest run src/solo/team-hub — 9 files, 350 passed, 0 failed (2026-10-28 15:59, includes the A2b block in src/solo/team-hub/TeamHubAgents.mocked-rpc.test.tsx and src/solo/team-hub/team-hub-cards.test.ts, with five new review-fix tests and one updated); each of the three review fixes was reverted in place and its tests failed (6 failures), then restored; node --test supabase/functions/_shared/team-hub/card-act.test.ts card-tools.test.ts card-binding.test.ts — 42 passed, 0 failed
STATIC_EVIDENCE: PASS: npm run ci:tsc — no new type errors (baseline 10, current 0); npx eslint on the five changed Team Hub files — 0 problems; npm run build and the other lint:* guards were not run (lint:gold fails on src/components/dashboard/BusinessCreditDashboard.tsx:271, a file this work does not touch); the harness compiles and serves under vite 5.4.21 with zero page errors in every shot
RENDERED_EVIDENCE: PASS: RENDERED-HARNESS docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/ (vite on 127.0.0.1:4793, Chromium 1243 headless): the REAL TeamHubWorkspace, useTeamHub, TeamHubApproval and PaigeConfirmCard with NO onApprovalAct (as src/solo/SoloApp.tsx mounts it), only the Supabase transport and tenant context substituted; cards arrive only through rpc team_hub_card_states and acts go only through functions.invoke paige-ai-chat with { teamHubCardAct }, both answered by the in-memory double src/mock-supabase.ts in the shapes parseCardStates and parseCardAct read; rail, command row and PAIGE panel are labelled stand-ins; report.json generated by harness/shoot.mjs
BEHAVIORAL_EVIDENCE: PASS: RENDERED-HARNESS — every click in the state frames is a real Playwright pointer click through its actionability checks (in the PAIGE-overlay frames the overlay stand-in is hidden while the hub is driven and shown again for the frame, because a real click cannot reach the hub under it); Approve by keyboard sent exactly { teamHubCardAct: { conversationId: c-dm-zion, messageId: zion-card, act: approve, fingerprint: 3f9a1c07d2b84e65 } } (report.json interactions keyboard-tab-approve-notnow-enter); the card read Running while the answer was held, then Done with the server's note, and the outcome message appeared as 1 reply in the card's thread; Not now pressed twice by Enter sent one decline; failed showed the server's reason as a sentence; already_decided was announced and the card shows Done; not_yours was announced and the card then showed its own refusal with no Approve; could_not_start was announced and the line showed under the card with Approve kept; PAIGE's DM drew the same hand-over card and settled Done; the redirect's Open DM called team_hub_open_agent_dm for zion and opened that DM
AUTHENTICATED_RUNTIME: UNVERIFIED: no live-drive credentials exist in this session and the A2b branch is not deployed, so no signed-in drive was possible; owed after deploy: on the owner's Solo account, ask ZION in a DM to hand a task over, Approve it, and confirm the task's assignee changed in Operations and the outcome line posted in the card's thread
KEYBOARD_FOCUS: PASS: RENDERED-HARNESS 1366×768 dark — after a click on the stand-in rail, Tab reaches Approve in 19 presses, the next Tab reaches Not now, Shift+Tab returns to Approve, each with :focus-visible and a solid 2px violet outline rgb(155, 141, 224) offset 2px, fully in view (frames a2b-a-handover-waiting-1366-dark-focus-approve.png and -focus-notnow.png); Enter on Approve sent the act above and the card settled Done, and focus moved to the card's own message row (article #th-msg-zion-card, 2px violet outline rgb(155, 141, 224)) instead of the document body (a2b-a-handover-waiting-1366-dark-enter-approve.png, review fix 3)
ZOOM_REFLOW: PASS: RENDERED-HARNESS 200% zoom of 1366×768 (683×384 CSS px at device scale 2), dark: page and hub horizontal overflow 0 px, no clipped text, the waiting card 539 px wide with Approve fully visible and reached by Tab in 5 presses; the Done card also fits (a2b-a-handover-waiting-zoom200-dark.png, a2b-b-handover-done-zoom200-dark.png)
REDUCED_MOTION: PASS: RENDERED-HARNESS with reducedMotion reduce on the Running card: matchMedia true, zero running animations, the Running spinner's animation computes to none and 1e-05s; without the preference the same frame runs one spin animation (a2b-b-handover-working-1366-dark-reduced-motion.png, report.json reduced-motion-working-card)
STATE_COVERAGE: PASS: RENDERED-HARNESS waiting (hand-over, cancel, publish, PAIGE hand-over), Running, Done (hand-over, publish with address, publish without address, PAIGE hand-over, and as read on a fresh page load of a double seeded already settled), declined, failed, already_decided, not_yours, could_not_start, the channel Suggest with the redirect line for the asker and for a teammate, Open DM pressed, and a teammate's own agent DM; expired and couldn't-confirm are covered by the A2 frames and the mocked-rpc tests, not re-shot here
TRUTHFUL_STATE_LABELS: PASS: nothing reads Done before the act's answer says done (the held answer stays Running); the done line is the server's note, the failed line is the server's reason, the publish without an address says to check rather than claiming a live link; every displayed server string is copied from source (listed in the evidence index)
SOLO_UI: YES: SOLO main menu destination teamhub (src/solo/team-hub/TeamHubWorkspace.tsx, useTeamHub.ts, team-hub-agents.ts), mounted by src/solo/SoloApp.tsx with no onApprovalAct; fictional workspaces 3855 and 4120 (t=b), both standalone SOLO
UNVERIFIED: authenticated runtime on the deployed platform (no credentials, branch not deployed); the real tenant shell (frames use labelled stand-ins for the rail, command row and PAIGE panel, not SoloApp); the server's decide, run and settle (answered by the double, proved only by the unit tests and supabase/tests/exp08_team_hub_a2b_cards.sql, which was not run here); npm run build, ci:tsc, eslint and lint guards; screen-reader speech (live-region text read from the DOM only); a fresh independent §39 read of the A2b diff
SOLO_1536X770_PAIGE_CLOSED: PASS: RENDERED-HARNESS stand-in frame, rail 216 px, dark: waiting, Done, publish Done and the channel redirect (a2b-*-1536-closed-dark.png): page overflow 0 px, card inside the viewport, no clipped text, no raw ids, gold only on Approve
SOLO_1536X770_PAIGE_OPEN: PASS: RENDERED-HARNESS stand-in frame, PAIGE inline 399 px stand-in: same four states (a2b-*-1536-open-dark.png), page overflow 0 px, card inside the viewport, no clipped text
SOLO_1366X768_PAIGE_CLOSED: PASS: RENDERED-HARNESS stand-in frame, rail 72 px, every state in dark and light (48 frames a2b-*-1366-dark.png and -light.png) plus tenant b: page overflow 0 px, no clipped text, no raw ids, gold only on Approve; the tenant-b card read carried p_expected_tenant t-harness-b
SOLO_1366X768_PAIGE_OPEN: PASS: RENDERED-HARNESS stand-in frame, PAIGE inline 340 px stand-in: four key states (a2b-*-1366-open-dark.png), page overflow 0 px, card inside the viewport
SOLO_1024X768_PAIGE_CLOSED: PASS: RENDERED-HARNESS stand-in frame: four key states (a2b-*-1024-closed-dark.png), page overflow 0 px, card inside the viewport, no clipped text
SOLO_1024X768_PAIGE_OPEN: PASS: RENDERED-HARNESS stand-in frame with the PAIGE overlay stand-in (410 px with scrim) as the A2 harness draws it: four key states (a2b-*-1024-open-dark.png), page overflow 0 px; the overlay covers part of the hub by design and is hidden only while the hub is driven
SOLO_900X1000_PAIGE_CLOSED: PASS: RENDERED-HARNESS stand-in frame: four key states (a2b-*-900-closed-dark.png), page overflow 0 px, card inside the viewport, no clipped text
SOLO_900X1000_PAIGE_OPEN: PASS: RENDERED-HARNESS stand-in frame with the PAIGE overlay stand-in: four key states (a2b-*-900-open-dark.png), page overflow 0 px; the overlay covers part of the hub by design and is hidden only while the hub is driven

OWNER_INTENT: the owner can ask ZION, NEXUS or PAIGE for a governed act in their own DM, see exactly what it will do on the approved card, press Approve or Not now, and see what really happened on the card and in its thread, while teammates are never handed a control
MUST_NOT_HAPPEN: a Done before the server says done; an Approve offered to anyone but the asker; a card in a shared conversation; gold anywhere but Approve; any change to the frozen A2 card files (§28); a real owner business account in sample data (§63); any consumer-finance wording (§2)
MUST_PRESERVE: the frozen A2 card design and its 350 passing Team Hub tests; the asker-only binding; the server's own outcome strings
ACCEPTANCE_CRITERIA: in the asker's agent DM, a waiting card shows its kind, the server's summary and its expiry time with Approve and Not now; Approve sends the four keys and the card moves Running then to the server's outcome; Not now settles it declined; a refused act is announced and visible (the card's own refusal, or a line under it when trying again is right); a channel act ends with the redirect line and only the asker gets Open DM
MOTION_PURPOSE: the Running spinner says the act is in progress; it stops under reduced motion
PROTECTED_SEAMS: TeamHubApproval.tsx, PaigeConfirmCard.tsx and team-hub.css (frozen, unchanged); SoloApp.tsx (unchanged, mounts the hub with no onApprovalAct); the card read and the card act request shapes

INTERNAL_BUILD_IDENTITY: 47bb4210a6aaa3a05a8d1f88edc74921c3dd10b9; deployment=none, local worktree on branch exp08-a2b at this commit with the migration header edit and the review fixes uncommitted, not pushed; environment=local; migrations=PROOF_OWED(20271121140008_exp08_team_hub_a2b_cards is not applied to production by this record, it applies through deploy-migrations.yml on merge); edge=PROOF_OWED(paige-ai-chat with the card-act branch deploys through deploy-edge-functions.yml on merge); evidence=docs/evidence/ui-delivery/exp08-team-hub-agents-a2b.md and docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/report.json
RELEASE_CHANNEL: development: local branch exp08-a2b on origin/main 9c05b9769, not pushed or deployed
RELEASE_CLASSIFICATION: internal-only: pre-launch Team Hub increment with no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only increment, not deployed, and the signed-in drive has not run
RELEASE_NOTE_REQUIRED: NO: internal-only pre-launch increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the A2b cards render and redeem as described in a rendered harness against in-memory doubles of the card read and the card act; nothing is deployed, the server's decide, run and settle were not driven here, and the signed-in drive on the owner's Solo account is owed after deploy
RELEASE_RECOVERY: position=revert the A2b merge commit and re-emit the rollback the migration header names (re-create the ten-argument team_hub_post_agent_message and the prior team_hub_accept_agent_turn, drop the three card functions and team_hub_message_cards, restore ZION and NEXUS scope version 1); reference=supabase/migrations/20271121140008_exp08_team_hub_a2b_cards.sql header and docs/evidence/ui-delivery/exp08-team-hub-agents-a2b.md

## Scope and collisions

- Classification: EXP08 A2b, Team Hub cards (slices 2–4 of contract section 5 A2).
- This record covers the screen: the card read, Approve / Not now through `{ teamHubCardAct }`, the outcome in the thread, the refused-act announcement and the redirect's Open DM. The server half is covered by the unit tests named above and by `supabase/tests/exp08_team_hub_a2b_cards.sql` (not run here).
- Frozen and untouched: `TeamHubApproval.tsx`, `PaigeConfirmCard.tsx`, `team-hub.css`.

## What each frame shows (1366×768; every state dark and light)

| Frame | State | Exact strings on screen |
|---|---|---|
| a2b-a-handover-waiting | ZION hand-over, waiting, asker | Task hand-over · Hand “Weekly client report” over to Sam Rivera. · Expires at 10:12 AM. · Needs your OK · Not now · Approve |
| a2b-b-handover-working | after Approve, answer held | Task hand-over · Running… · Hand “Weekly client report” over to Sam Rivera. |
| a2b-b-handover-done (and -reread) | Done (clicked; and on a fresh page load of a double seeded as already settled, not a read-back of that session's own write) | “Weekly client report” is handed over to Sam Rivera. · Done · Approved by you · 10:04 AM · 1 reply |
| a2b-b-handover-done-thread | outcome in the thread | Done. “Weekly client report” is handed over to Sam Rivera. |
| a2b-c-cancel-waiting | ZION cancel, waiting | Task cancel · Cancel “Venue walkthrough checklist”. · Expires at 10:12 AM. |
| a2b-d-cancel-declined | Not now | Cancel “Venue walkthrough checklist”. · You chose Not now at 10:04 AM. Nothing was changed. |
| a2b-e-handover-failed (-thread) | failed | The task changed after I read it. · Didn't run · Approved by you · 10:04 AM; thread: That didn't run: the task changed after I read it. Nothing was changed. |
| a2b-f-publish-waiting | NEXUS publish, waiting | Page publish · Publish the page "Spring Open House" at /p/harbor-pine-studio/spring-open-house. Anyone with the link can open it. The forms on it go live too. · Expires at 10:12 AM. |
| a2b-f-publish-done (-thread) | Done with address | The page is live at /p/harbor-pine-studio/spring-open-house.; thread: Done. The page is live at /p/harbor-pine-studio/spring-open-house. |
| a2b-f-publish-done-noaddr | Done, no address | The page is published. Its address didn't come back, so open it from your pages to check. |
| a2b-g-refused-not-yours | refused; the card loses its binding | card: Hand “Weekly client report” over to Sam Rivera. · Expires at 10:12 AM. · This card can no longer be approved, so nothing has changed. Ask again for a fresh one. (no Approve); live region: Only the person who asked can approve this card. |
| a2b-g-refused-already-decided | refused, card shows Done | live region: That card was already decided. It shows what happened. |
| a2b-g-refused-could-not-start | didn't go through; Approve kept | under the card: That didn't go through just now. Try again.; live region: the same |
| a2b-h-redirect-asker | channel Suggest | …a good one to hand him first. · I can do that with you in our DM. · Open DM with ZION |
| a2b-h-redirect-teammate | same, as Priya | the same reply, no Open DM; her Direct messages list shows Morgan Reyes |
| a2b-h-redirect-asker-opened-dm | Open DM pressed | the asker's ZION DM, with the asker's own request in its box, unsent (owner ruling 2026-10-28): "Hand the weekly client report over to Sam, he's taking it from Monday." |
| a2b-i-teammate-own-zion-dm | Priya's own ZION DM | Ask ZION anything (empty); Morgan's DM is not listed for her and no card read was made; her Direct messages list shows Morgan Reyes |
| a2b-j-paige-handover-waiting | PAIGE (the union) hand-over, waiting | Task hand-over · Hand “Weekly client report” over to Sam Rivera. · Expires at 10:12 AM. · Needs your OK · Not now · Approve |
| a2b-j-paige-handover-done | PAIGE hand-over, Done | “Weekly client report” is handed over to Sam Rivera. · Done · Approved by you · 10:04 AM · 1 reply |

The agents' replies above the cards and the Suggest sentence are hand-written stand-ins for model text; every card, note, outcome and redirect string is the server's, copied from source. The live-region text is mirrored into the stand-in command row (`mirror=1`) only so a frame can show it; in the product it is visually hidden.

## Review fixes in this pass (non-frozen source, harness and record only)

1. **Failed reason is a sentence on the card.** `parseServerCard` (team-hub-agents.ts) says a failed card's server reason through `cardReasonSentence`: capital first, full stop last ("The task changed after I read it."), matching the approved a2-failed frame. The server keeps its clause for the outcome line, so the thread still reads "That didn't run: the task changed after I read it. Nothing was changed."
2. **A refused act is visible, not only announced.** `actOnCard` (useTeamHub.ts) puts the card back without its binding on not_yours, not_visible and conversations_off, so the frozen card draws its own refusal instead of a live Approve. On could_not_start the binding is kept (trying again is right) and TeamHubWorkspace.tsx shows the line under the card in the existing `.th-fail` row; it clears when the card is acted on again.
3. **Focus no longer falls to the page.** When Approve or Not now leaves the card, focus moves to the card's own message row (already `tabIndex=-1`), and only when nothing else holds focus.
4. **Harness:** the teammate's Direct messages list now names Morgan, not Priya herself; a PAIGE scenario (`s=b2-paige-handover`) renders the union's hand-over card waiting and Done through the same read and act path; `act=could_not_start` added; the state frames use real pointer clicks.

## Left open (frozen design or server copy), and the two owner rulings

1. **Focus order runs right to left in the footer.** DOM order is Approve then Not now; on screen Not now is left of Approve (the frozen PaigeConfirmCard; the approved A2 frames are the same).
2. **The publish summary mixes quotation styles and wraps the address at a hyphen.** The door's summary (growth-publish-command/contract.ts previewSummary) uses straight quotes ("Spring Open House") while task cards use curly ones; at 1366 the address breaks as "spring-open-" / "house", and it is a path, not a link.
3. **The done card and its thread say the same sentence twice** (by design in card-act.ts: the line is "Done. " plus the note).
4. **Open DM from a channel redirect: RULED 2026-10-28 by the owner, prefill.** The DM opens with the asker's own request (that agent's mention removed, first word capitalised when the mention led) in its box, unsent; `dmRequestPrefill` in team-hub-agents.ts, only from a person's own message on screen; tests in team-hub-cards.test.ts and the mocked-rpc Open DM case (fails with the change reverted).
5. **The could_not_start line under the card: APPROVED by the owner 2026-10-28** (a2b-g-refused-could-not-start).

## Evidence index

### New task-read freshness P1 — repair under review, October 30, 2026

Automated review `5707385501` on #3108/`98c4a26022` found a real authority-snapshot gap
(`PRRT_kwDOSAAXqM6x0z0D`). **Release held.** Prior source-only reviews did not identify it;
the successful Preview and local SQL do not waive it. No customer incident is asserted.
Four new regression cases reproduced **120 PASS / 4 FAIL** before the repair: demotion before
dispatch, during read, after the final answer, and absent native staging. The application now
re-resolves current actor/workspace/seat/admin/DM/stored scope before and after each A2b read,
before provider attempts and before publication; a lost scope ends the turn without a post.
The final host suite passes **126/126**, including additional shared-Fabric pre-attempt refusal
and roster-change cases. The combined original agent/card/specialist suites passed **310/310**
before those final two test-only cases were added. These are author-run engineering tests.

Forward migration `20271126030008` extends the ORIGINAL accepted-token read-context guard for
PAIGE/ZION/NEXUS. Original MERIT/CURA/VERA logic is byte-exact after removing the marked A2b
branch and restoring the original three-agent predicate; the complete original OID/metadata/
ACL guard and metadata inverse remain. New native body MD5 `a75a322d43e4cde08f5142d1eabf6ddb`.
Original applied `26020008` and E04 applied history are unchanged. Staging and posting remain
the same original path; there is no second authority engine or attestation store.

The disposable PostgreSQL proof passes all original 16 sections/16 mutants plus new guard
replay, whole-peer-body inverse, current admin staging, demotion/roster/account-change refusal,
browser attestation refusal, authorized PAIGE/ZION/NEXUS publication and out-of-scope source
refusals. An additional native mutant removes the authority guard, demonstrates the forbidden
post, then rolls back; the unmutated guard refuses it. No original assertion was removed.
An independent read-only reviewer found no actionable source issue in the repair; they did not
rerun tests or certify hosted/authenticated behavior. Renewed exact-head review/CI, application
of the new forward migration, native readback and actual authorized customer proof remain owed.

Reusable lesson: offer-time authorization is not permission to use a service-role read later.
Revalidate around the read and provider continuation, and serialize current authority with the
original publication transaction. Private-read staging admits at most three distinct sources
per turn, matching the original protocol; this is a scope/technical bound with a follow-up path,
not a monetary allowance or a change to uncapped consuming-tenant billing.

### Hosted failure disposition and sequential carrier — October 30, 2026

Original #3041 is preserved at successor integration head
`6a629d8f1435274e74075c755ca99fa1c8d0fcfc`, including its original Preview and history.
Fresh check `123849303546` failed explicitly: "Remote migration versions not found in local
migrations directory." Readback confirms the old Preview still has applied `20271121140008`.
No reset, ledger edit, applied-file rewrite or deletion was used. The sequential successor
branch carries the same original ancestry and reviewed forward migration into a fresh ordinary
PR Preview based on current main. This is a replacement release carrier for one implementation,
not a parallel feature build. Original #3041 failure evidence remains valid and unwaived.

Fresh comms boundary job `123848855368` passed 1,051 tests and failed loading one test file:
`card-tools.test.ts` still read the old migration path (ENOENT at line 18). That loader now reads
the actual forward migration `20271126020008`, retaining all assertions; the focused suite passes
**16/16**. Latest composed UI/document cases pass **157/157** and agent-turn **120/120**.
The normal TypeScript ratchet completed baseline 10/current 6/no new errors, consistent with
the direct compiler diagnostic comparison. Required fresh carrier checks/Preview, final review,
release/readback and authenticated proof remain owed. Full assignment remains **STILL CODING**.

### Successor integration checkpoint — October 30, 2026

**STILL CODING.** Local integration commits `3d2c30918` and `aa58f08fc` preserve original
PR #3041 history and receive main through `b763e1937366376dd35a7fe1d1f21da6652f0b27`.
The later peer payment-plan and removal-of-email-allowance changes are retained.
The original and current-main C0b inspectors each reproduced all 29 dispatch bindings
with no findings (126 and 128 dependency paths respectively). Only the composed dispatch
fingerprint scalars were renewed; peer source pins, inspector and negative controls remain.
All **222/222** binding/negative tests passed on the composition. Direct TypeScript execution
completed with six diagnostic signatures, all within the existing baseline; no baseline grew.

The source reviewer identified lost private planning/commercial visibility wording in the
composed agent prompt. The original clauses are restored; three new cases first reproduced
the defect and then passed. They cover MENTOR, MERIT and CURA DMs and private-source omission
in a shared channel even with a poisoned offered-tool list. The complete agent-turn suite
passes **120/120**. The independent reviewer confirmed that bounded P2 resolved by source
inspection; this is not authenticated runtime or full SQL approval.

Migration `20271126020008` is the forward candidate. The exact original Preview-applied
`20271121140008` is preserved in this evidence packet's `migration-history/` directory
(SHA256 `03a4c78a530c3bd97f2134dece27a09666c7a78f35b1e98234c3a0e18da1b766`).
The candidate retains E04's current read-context revalidation and EXP10's NEXUS connection
read, and retains service-only trusted settlement. The original disposable PostgreSQL proof
passes all 16 sections and kills all 16 mutants, including replay and whole-body inverse
comparisons. The fixture uses actual peer prerequisite migrations, not replacement writers.
Migration-order lint passes 1,528 files. These are local engineering results.

The supported Preview rebase API returned success, but SQL readback still showed 1,510
applied migrations, frontier `20271121140008`, original A2b post body `c9d9dc13…`, and no
E04 scope function. Therefore Preview reconciliation is **UNVERIFIED**, not successful.
No production migration, ledger repair, reset, branch deletion or authenticated action was
performed. Fresh hosted exact-head checks, final review, deployment/readback and customer
proof remain owed; historical red checks are not waived. A2c, specialist action waves,
goal/workshop/initiative integration and the full original lifecycle matrix remain open.

### Sole-successor recovery checkpoint — October 29, 2026

Status: **STILL CODING**. The sole Codex successor retains the original branch and PR #3041
at `f7867db12b6eb7d9e53b8add5a657e28ce42406c`, composing current main
`b696ea038b6e26b43c8d1787dc65c59da5c89b86` locally. No successor release or authenticated A2b
proof is claimed. The owner supplied the interrupted Claude transcript: it preserves the approval
of the retry line and unsent channel-to-DM prefill and the every-specialist action-wave plan.
It does not establish that the old cloud session had no other unsaved work; that session remains
preserved. Full custody/amendment ACK and narrow source ownership are saved in ANT-161's description
because new comments returned the issue's 2,000-comment quota error. Readback confirmed the ACK.

Original failed `ci` run `40742041076` is not waived. Its failure-attribution artifact
`12842231828` was downloaded and independently matched to SHA256
`5349d99b3900507a3096ccbc23a662dde48d4142b2033ba0f88f654f9db2c42e`.
It identifies three document-tool source-contract failures; all three reproduced locally in the
composed source (43 passed, 3 failed). A2b moved the canonical `growth_list` definition before
`document_generate`, making the tests' string slices empty. The repair selects the original document
definition with the test's existing TypeScript AST predicate, retaining every assertion and the
original import-binding checks. The same suite then passed **46/46**. No document writer changed.

The combined A2b agent/card and original MERIT/CURA/MENTOR/VERA/NEXUS/ZION adapter suites passed
**303/303** using the repository's Node preload. The composed agent-turn suite includes **117** of
those tests. The MENTOR refusal case now verifies the A2b unavailable/non-applied envelope, no offered
writer, no executed writer and no fabricated card rather than the superseded blanket A1 action line.
These are scripted engineering tests, not authenticated customer proof. Original Test-step full-log
downloads failed transport; the verified attribution artifact and local reproduction are the bounded
diagnostic evidence. Initial Windows temporary-directory test startup failure is retained separately;
it executed no tests and is not counted as a product failure or passing proof.

The database-contract log for `40742041226` first refused production ACL reconciliation because the
branch lacked production media-asset objects; numerous later permission failures follow. It remains
**FAIL**, requiring fresh replay and exact-head CI after composition. Read-only production inspection
found A2b `20271121140008` absent and frontier `20271126010011`; the original PR Preview has A2b
`20271121140008` applied. Production's original ten-argument post body is now
`d9739dd46a7c93a73a3d054a7cf098da` and accept-turn is `f28f30095f96a0c58e1206cbe61340d2`.
Their peer read-context/publication changes must survive reconciliation. No migration was applied,
renamed or rewritten at this checkpoint. Binding-literal reproduction/review, final integration,
settlement-trust thread disposition, migration strategy, technical review, hosted exact-head gates,
release/readback and authenticated result/reload/recovery remain open.

The full original matrix/five people journeys, A2c standing-authority/channel work, all specialist
action waves, shared goal/workshop/privacy integration and evaluation obligations remain in scope.
This local repair is not full-assignment coding completion or owner acceptance.

- Harness: docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/ (index.html, vite.config.mjs, src/main.tsx, src/mock-supabase.ts, src/mock-tenant.ts, shoot.mjs). Serve `npx vite --config docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/vite.config.mjs`, then `node docs/evidence/ui-delivery/assets/exp08-team-hub-agents-a2b/harness/shoot.mjs` (PW_EXECUTABLE_PATH defaults to /opt/pw-browsers/chromium-1243/chrome-linux64/chrome).
- Scenario query: `s=b2-handover|b2-cancel|b2-publish|b2-handover-done|b2-handover-failed|b2-publish-done|b2-publish-done-noaddr|b2-redirect|b2-paige-handover`, `act=done|hold|failed|not_yours|already_decided|done-noaddr|could_not_start`, `as=priya`, `t=b`, `theme=dark|light`.
- Server strings copied from: card-tools.ts CardProvenance.summary and REDIRECT_LINE; card-act.ts doneNote, DONE_NOTE.page_publish, FAILED_REASON.changed, OUTCOME_LINE; growth-publish-command/contract.ts previewSummary; team-hub-agents.ts cardExpiryNote and cardActLine.
- Each run's first page logs one console 404 that matches no page response (the response listener saw none; consistent with the browser's favicon fetch); no other console error in any shot.
- Fictional cast only: Harbor & Pine Studio, Morgan Reyes (owner, the asker), Priya Shah, Sam Rivera, Marcus Hale.
