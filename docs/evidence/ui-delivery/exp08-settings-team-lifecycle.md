# UI delivery evidence: EXP08 Settings → Team, the team lifecycle screens

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet is the tier-matrix ledger "EXP08 team lifecycle" (docs/doctrine/tier-matrix.md: the authority rule, the per-tier table, the departure-review hand-over contract naming each existing writer, and what a suspension does to mailboxes and approvals) plus "Solo Settings → Team: the screens for the team lifecycle" added in this PR; the flows are suspend, reinstate, the Team conversations switch (row and invitation form), departure review → hand-over → remove, Team Hub with conversations off, and accept-invite refused for a held seat; backend for all of them merged and applied in #2912 (e0263aac0)
PAIGE_UI_DESIGN: PASS: Impeccable's reference/craft-floor.md and .agents/skills/paige-ui-design/SKILL.md applied (Solo verification: four viewports PAIGE closed and open, both themes, states, keyboard, reflow, reduced motion), recorded below; the owner saw the rendered design and approved it on 2026-10-26, then asked for "a touch more color", applied token-only
MATERIAL_FLOW_CHANGE: YES: Settings → Team gains a row menu (Edit details, Suspend access…, Reinstate, Remove from team…), a suspend confirmation, a per-person Team conversations switch and the same switch on the invitation form, Invited rows folded into the roster, a departure-review drawer with item-by-item hand-over before removal; Team Hub gains a conversations-off state; accept-invite gains the held-seat refusal
FLOW_PROTOTYPE: PASS: owner approved the rendered prototype on 2026-10-26 in the EXP08 Claude Code session ("I approve the design" / "Yes they are approved"), committed as assets/exp08-settings-team/approved-prototype.html and recorded APPROVED-FROZEN (§28) in docs/brain/decision-log.md; the only change since is the owner's requested colour touch
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the owner or an admin of a SOLO workspace manages who is on the team and what they can reach; primary actions are Invite someone (ink fill) and, in the departure review, Remove (the destructive act, after hand-over); gold is not used on any of these controls
VISUAL_DIRECTION: PASS: approved prototype on --pg-* tokens; colour pass uses existing tokens only (permission pills --pg-violet / --k-agent / neutral; avatar hues from --pg-violet, --k-automation, --k-template, --k-integration; Invited/Pending in --k-automation; the old gold Pending pill removed); contrast re-measured in this step with the colour-pass script: every text pair ≥ 4.51:1 light and ≥ 4.60:1 dark, icons ≥ 3.80:1 (non-text needs 3:1)
AUTOMATED_EVIDENCE: PASS: npx vitest run src/solo src/pages/AcceptInvite on this branch before the menu fix → 390 files, 6600 tests passed, 7 skipped (jsdom with mocked RPCs, named so); after the menu fix npx vitest run src/solo/team-workspace.lifecycle.test.tsx → 21 passed, and the new "⋯ menu … Home and End" test fails when the Home/End handling is removed (run in this step, then restored)
STATIC_EVIDENCE: PASS: tsc -p tsconfig.app.json with an 8 GB heap → no error in any touched file (the remaining errors are in untouched files the CI ratchet tracks); lint:pg-tokens, lint:shadow-vars, lint:solo-parity, lint:tier-features pass; lint:gold fails only on the existing src/components/dashboard/BusinessCreditDashboard.tsx finding, not in this change
RENDERED_EVIDENCE: PASS: RENDERED-HARNESS, not the real shell and not authenticated — a Vite build of the real SoloTeamWorkspace and TeamHubWorkspace with the Supabase client and tenant hook replaced by in-memory doubles (harness under assets/exp08-settings-team/harness); frames in assets/exp08-settings-team/: 16 viewport frames, 18 state frames, 4 zoom frames; every frame reports 0 px horizontal overflow (viewports-report.json, states-report.json)
BEHAVIORAL_EVIDENCE: PASS: two classes, kept apart. (1) jsdom tests against the real components with mocked RPCs: suspend through a confirmation, reinstate from the row and from the notice, the switch saving and re-reading the roster, refusals keeping state and offering Retry, an act whose function is missing saying so, admin limits, Invited rows with resend/withdraw, the departure review and hand-over outcomes, accept-invite's refusal. (2) RENDERED-HARNESS drives in Chromium: run-1280-dark.png shows a hand-over run to completion against the doubles
AUTHENTICATED_RUNTIME: UNVERIFIED: this session has no credentials for the owner-designated SOLO account (LIVE_DRIVE_EMAIL / LIVE_DRIVE_PASSWORD are not set), so no flow was driven on the live platform; owed: suspend and reinstate a member, switch Team conversations off and see Team Hub refuse, invite with the switch off, run a departure review and hand one Work item over, remove, and see a held seat refused at accept-invite
KEYBOARD_FOCUS: PASS: RENDERED-HARNESS at 1366×768 (a11y-report.json) — Tab walks the tabs, Invite someone, Review roles, search, the Show picker, then per row the name, the Team conversations switch and the ⋯ button, each :focus-visible with a solid 2px outline; Enter on ⋯ opens the menu with focus on its first item, ArrowDown/ArrowUp/Home/End move, Esc closes and returns focus to ⋯; the departure review opens as aria-modal with focus inside and Esc returns focus to ⋯. Defect found in this step and fixed: on a row's first open the menu took no focus (it renders hidden until placed); before the fix focus stayed on ⋯ and the arrows did nothing
ZOOM_REFLOW: PASS: RENDERED-HARNESS — 200% zoom on a 1280×800 window (640×400 CSS px): roster and departure review both 0 px horizontal overflow in light and dark, the review reachable by keyboard (ev-zoom200-1280-roster-*.png, ev-zoom200-1280-review-*.png); 390 px frames show the roster and review as single columns (roster-390-light.png, review-390-dark.png)
REDUCED_MOTION: PASS: RENDERED-HARNESS — with the departure review open, prefers-reduced-motion: no-preference gives stw-drw 0.24s, stw-spin 0.9s, stw-sheen 1.4s and 0.15–0.2s transitions; reduce gives all three animations at 0.001s and no transitions (a11y-report.json)
STATE_COVERAGE: PASS: first use (owner only, invitation to bring the first teammate), loading (skeleton rows), error (didn't load, nothing changed, Try again), populated, suspended row (Reinstate only, "Takes effect when reinstated" on its switch), Invited row, switch notice, suspend confirmation, refusal with Retry, function-not-deployed, admin viewer (no acts on admins or the owner), invitation form with the switch off and its review, departure review with hand-over choices and its run, Team Hub conversations off, accept-invite held-seat refusal
TRUTHFUL_STATE_LABELS: PASS: every row and notice shows what the roster re-read returned after a write, never what the click assumed; a missing function says the act isn't available yet; hand-over reports each item's own outcome (saved, needs confirmation, changed by someone else, failed) because it is several separate writes, not one transaction; approvals and connected mailboxes are listed with what will actually happen to them because no writer can move them; the PAIGE panel lists suspend, remove and the switch under "Coming to Paige, not yet available"
SOLO_UI: YES: SOLO Settings → Team (src/solo/team-workspace.tsx, team-controls.tsx, team-departure.tsx, team-handover.ts, settings.tsx/settings.css) and the Team Hub destination (src/solo/team-hub/**); src/pages/AcceptInvite.tsx is shared by every invitation; Agency and Sub-account shells untouched
UNVERIFIED: authenticated runtime on the owner-designated SOLO account for every flow named in AUTHENTICATED_RUNTIME; the real Settings shell around the page (the harness draws a 72 px rail stand-in, a header stand-in and a PAIGE stand-in sized like the Solo shell: 399 px inline at 1536, 340 px inline at 1366, a 410 px overlay at 1024 and 900); a real screen reader was not run; one 404 on the harness's first cold load was not reproduced warm and is not from the page under test
SOLO_1536X770_PAIGE_CLOSED: PASS: ev-1536x770-closed-roster-light.png / -dark.png — page 1464 px, 7 row menus, 0 px overflow
SOLO_1536X770_PAIGE_OPEN: PASS: ev-1536x770-open-roster-light.png / -dark.png — PAIGE stand-in 399 px inline, page 1065 px, 0 px overflow
SOLO_1366X768_PAIGE_CLOSED: PASS: ev-1366x768-closed-roster-light.png / -dark.png — page 1294 px, 0 px overflow
SOLO_1366X768_PAIGE_OPEN: PASS: ev-1366x768-open-roster-light.png / -dark.png — PAIGE stand-in 340 px inline, page 954 px, 0 px overflow
SOLO_1024X768_PAIGE_CLOSED: PASS: ev-1024x768-closed-roster-light.png / -dark.png — page 952 px, 0 px overflow
SOLO_1024X768_PAIGE_OPEN: PASS: ev-1024x768-open-roster-light.png / -dark.png — PAIGE as a 410 px overlay with a blurred backdrop over the 952 px page; the page keeps its layout beneath it
SOLO_900X1000_PAIGE_CLOSED: PASS: ev-900x1000-closed-roster-light.png / -dark.png — page 828 px, 0 px overflow
SOLO_900X1000_PAIGE_OPEN: PASS: ev-900x1000-open-roster-light.png / -dark.png — PAIGE overlay 410 px over the 828 px page, as at 1024

OWNER_INTENT: the owner or an admin can put someone on hold and bring them back, keep a spot-job contractor out of team conversations, and before removing someone see everything they hold and hand it over — all from Settings → Team, with every act limited by who may act on whom
MUST_NOT_HAPPEN: an act offered to someone the rule forbids; a row showing a state the server did not return; removal without the review; a hand-over through anything but the item's own writer; gold on any of these controls; an approval or mailbox shown as handed over when nothing moved it
MUST_PRESERVE: the approved design (APPROVED-FROZEN, §28); existing invite, permission and work-profile flows and their tests; Operations' work-update seam (submitOperationsWorkUpdate gains only an additive conflict flag); crm-command's confirmation card for every CRM hand-over
ACCEPTANCE_CRITERIA: on the live platform the owner suspends a member and sees them held, reinstates them, turns a contractor's Team conversations off and sees Team Hub refuse them, invites someone with the switch off, removes a member after handing their Work to someone else, and an admin cannot act on another admin or the owner
MOTION_PURPOSE: the review drawer slides in (stw-drw 0.24s) to tie it to its row; the spinner and sheen show work in flight during hand-over; all off under reduced motion
PROTECTED_SEAMS: get_solo_team_workspace, suspend_/reinstate_solo_team_member, set_solo_team_member_team_hub_access, team_member_holdings, remove_solo_team_member, solo-team-invitations (teamHubAccess), plan_update_item_versioned via submitOperationsWorkUpdate, crm-command task.assign / contact.assign_coach / contact.assign_owner / deal.assign_owner, accept-invite's seat_not_active; non-SOLO shells NONE_AFFECTED: no non-SOLO shell file changed

INTERNAL_BUILD_IDENTITY: ce8022c704d71ab22eba8eb97f8473b18a360142; deployment=none (branch claude/practical-davinci-ij8hb8; the menu focus fix, its test and this record are the next commit on top); environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp08-settings-team-lifecycle.md
RELEASE_CHANNEL: development: branch build; ships to production on merge to main per the pre-launch stance (§4)
RELEASE_CLASSIFICATION: internal-only: pre-launch platform with no live customers; no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only pre-launch work, authenticated runtime not yet proven
RELEASE_NOTE_REQUIRED: NO: internal-only; a customer-facing note waits for the authenticated drive and an owner decision
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the backend these screens call is LIVE (merged #2912, applied and read back 2026-10-26); the screens themselves are proven by jsdom tests, static checks and rendered-harness frames and drives only, and stay PROOF OWED until the authenticated drive on the owner's SOLO account
RELEASE_RECOVERY: position=revert the merge commit, which restores the previous Settings → Team because this change is client-only (no migration, no edge function) and the lifecycle backend from #2912 stays in place; reference=docs/doctrine/tier-matrix.md "Solo Settings → Team: the screens for the team lifecycle"

## Evidence index

- Harness: [assets/exp08-settings-team/harness](assets/exp08-settings-team/harness/). From the repo root: `npx vite --config docs/evidence/ui-delivery/assets/exp08-settings-team/harness/vite.config.mjs --port 4792 --host 127.0.0.1`, then `OUT=<dir> PW_EXECUTABLE_PATH=<chromium> node docs/evidence/ui-delivery/assets/exp08-settings-team/harness/{viewports,shoot,a11y}.mjs`.
- Frames: `ev-<viewport>-<closed|open>-roster-<light|dark>.png`; state frames `<state>-<width>-<theme>.png`; `ev-zoom200-1280-{roster,review}-{light,dark}.png`.
- Reports: `viewports-report.json`, `states-report.json`, `a11y-report.json`.
- Tests: `src/solo/team-workspace.lifecycle.test.tsx`, `team-workspace.remove-member.test.tsx`, `team-workspace.invite-workspace.test.tsx`, `team-workspace.member-editor.test.tsx`, `src/pages/AcceptInvite.refusal.test.tsx`, `src/solo/team-hub/TeamHubWorkspace.mocked-rpc.test.tsx`.
- Approved design: `assets/exp08-settings-team/approved-prototype.html`.

## Limitations

Everything in UNVERIFIED above. The harness frame is not the tenant shell and the doubles are not the database or the edge functions, so none of these frames or drives is authenticated runtime proof.

## October30 §5.8 original owner-demotion integration — local, release HOLD

The earlier client-only release/recovery statements describe that historical increment. The local
successor candidate also changes the original `revoke_co_owner` backend: original Billing cleanup
must precede demotion in the same transaction, with original strict last-primary protection and
current authority. No layout, approved tokens/personality or new confirmation/approval UI changes.
Original entity/owner controls and full current authenticated interaction proof remain owed.

`docs/delivery/exp08-co-owners-entity-owners-contract.md` records exact original producer ABI,
native fixtures, failed-before cases, causal mutants, drift/replay controls and source-review repair.
Thirteen isolated native Billing/Team cases pass after four additional applicability failures exposed
the initial sub-account/parented regression. These are minimal-schema original-writer tests,
not rendered or authenticated customer evidence. The original Billing public writer fails its
three-session authority-loss assertion; its existing source owner acknowledged repair responsibility
in ANT138/5d9652a0. That failure remains in the complete native suite, not waived by green old CI.

PR3130/421e has all13 checks SUCCESS but remains HOLD for the actual integration finding.
Local child source is not that published head. Final producer/source composition, whole-head
review/tests/CI, supported replacement/readback of the own disposable managed Preview, normal
release and authenticated owner/role/tenant/recovery outcomes are UNVERIFIED/owed. Do not infer
activation or owner acceptance from the earlier harness frames or these native component tests.
