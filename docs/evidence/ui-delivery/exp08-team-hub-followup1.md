# UI delivery evidence: EXP08 Team Hub, follow-up 1 (Codex review fixes)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: same flow packet as increment 1 (docs/delivery/exp08-team-hub-collaboration-contract.md §1/§5); this follow-up changes three behaviours inside existing flows and adds no flow: send recovery (flow 5), loading (all flows) and refresh merging (flows 5 and 6)
PAIGE_UI_DESIGN: PASS: Impeccable's reference/craft-floor.md read before round 3's edits; .claude/skills/paige-ui-design routes to .agents/skills/paige-ui-design/SKILL.md (Solo verification: four viewports PAIGE closed and open, both themes, states, keyboard, reflow, reduced motion), applied below
MATERIAL_FLOW_CHANGE: NO: three defect fixes from the Codex review of PR #2764 inside existing Team Hub flows; no layout, control, copy or navigation change (the restored draft reuses the composer and the existing refusal message)
FLOW_PROTOTYPE: PASS: not required for a material-flow-free defect fix; the approved prototype v2 (2026-10-24, frozen under §28) is unchanged and this restores behaviour it already shows (a refused send keeps its text)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: active teammates of a canonical SOLO workspace coordinate in channels, DMs and threads; the primary action is reading a conversation and posting into it, with Create channel and Add people as the two act moments
VISUAL_DIRECTION: PASS: approved prototype v2 on --pg-* tokens only (Obsidian dark / Mineral light); gold fill only on the Create channel and Add N people submits (text --pg-env on dark, --pg-ink on light where --pg-env measures 1.78:1 and ink 7.37:1, as client-portal-access.css does); Send is ink; disclosures (Add people toggle, visibility toggles) are neutral; no banner
AUTOMATED_EVIDENCE: PASS: npx vitest run src/solo/team-hub → 79 tests pass; three new mocked-RPC tests, each shown to FAIL with its fix reverted: (1) loads under React StrictMode, (2) a retry the server refuses puts the text back in the composer, (3) a message sent between an absence and the refresh no longer hides the gap
STATIC_EVIDENCE: PASS: npx eslint src/solo/team-hub → clean; NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.app.json → the same 6 baseline errors in untouched files (PaigeWorkspaceContext.tsx, customFields.ts ×2, planning.ts, tenantLifecycle.ts, CalendarAdmin.tsx), none in src/solo/team-hub
RENDERED_EVIDENCE: PASS: STRUCTURAL / RENDERED-HARNESS, reused from increment 1 because this follow-up changes no markup or style: the 38 frames under [assets/exp08-team-hub-increment1](assets/exp08-team-hub-increment1/) were re-captured 2026-10-24T16:15Z against code whose rendered tree is identical to this change outside the three behaviours, which are proven by the mocked-RPC tests, not by a frame
BEHAVIORAL_EVIDENCE: PASS: jsdom MOCKED-RPC only (supabase.rpc replaced by an in-memory double): StrictMode double mount renders the stream; transport failure then `invalid` on Retry restores the body to the composer with the refusal shown; one held message + 60 arrivals + a local send + a focus refresh replaces the held list and offers Load earlier messages while keeping the sent message
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated session exists in this environment; the drive on the owner-designated existing SOLO account owed for increment 1 covers these behaviours too
KEYBOARD_FOCUS: PASS: composer is role=combobox with aria-activedescendant over the listbox (ArrowUp/Down, Enter/Tab pick, Esc closes; mocked-RPC test); opening a thread moves focus to the reply box once loaded; Esc is handled by the hub inside React and marked handled, so the shell's window Esc does not fold PAIGE (mocked-RPC test with a window listener stand-in, and the same observed in the Chromium harness); the window-level thread listener was removed, so Esc outside the hub no longer closes the thread; panes under the drawer are inert; the private leave confirmation puts focus on Stay and returns it to Leave on Stay or Esc; after join/leave, create, DM, retry and delete focus returns to a real control
ZOOM_REFLOW: PASS: RENDERED-HARNESS, re-run this round — 200% zoom on a 1280×800 window (640×400 CSS px, hub 580px) renders the one-column conversation with no horizontal overflow and the stream scrolling on its own (ev-zoom200-1280-light.png); the 390px phone (hub 330px) list, conversation, unread conversation and thread reflow likewise
REDUCED_MOTION: PASS: RENDERED-HARNESS, re-run this round — with prefers-reduced-motion: reduce the overlay drawer's computed animation-name is none and button transitions are 0s; without it the drawer runs th-slide; the skeleton pulse runs only under no-preference
STATE_COVERAGE: PASS: loading under StrictMode; send failed then refused on Retry (draft restored, refusal shown once); refresh after an absence with a local send (gap offered); all other states unchanged from increment 1
TRUTHFUL_STATE_LABELS: PASS: no new label; a refused retry no longer drops the text silently, and a refresh with a hidden gap now says so through Load earlier messages
SOLO_UI: YES: SOLO main menu destination teamhub (src/solo/team-hub/**, mounted from src/solo/SoloApp.tsx); Agency and Sub-account shells untouched and refused by the server as unavailable
UNVERIFIED: authenticated runtime on the owner-designated SOLO account; the StrictMode behaviour in a real development browser (proven in jsdom only); the gap rule against a real 50-message page under live traffic

SOLO_1536X770_PAIGE_CLOSED: PASS: ev-1536x770-closed-dark.png / -light.png — hub 1320px, grid 232 | 748 | 340 with the thread inline; three panes each scroll on their own
SOLO_1536X770_PAIGE_OPEN: PASS: ev-1536x770-open-dark.png / -light.png — PAIGE inline 399px (26vw), hub 921px, grid 212 | 709 with the thread drawer overlaying (container query, not viewport); also ev-state-addpeople-1536open-light.png
SOLO_1366X768_PAIGE_CLOSED: PASS: ev-1366x768-closed-dark.png / -light.png — default compact rail 72px, hub 1294px, thread inline; also first use (ev-state-firstuse-1366-light.png), create form with stacked actions, act first (ev-state-createchannel-1366-dark.png), unavailable (ev-state-unavailable-1366-dark.png)
SOLO_1366X768_PAIGE_OPEN: PASS: ev-1366x768-open-dark.png / -light.png — PAIGE 340px, hub 954px, thread overlays; with the rail expanded (216px) the hub is 810px (ev-1366x768-navexpanded-open-*.png), still two columns plus overlay drawer; also ev-state-addpeople-1366open-dark.png
SOLO_1024X768_PAIGE_CLOSED: PASS: ev-1024x768-closed-dark.png / -light.png — hub 952px, thread overlays; failed send with Retry and Remove in view (ev-state-sendfailed-1024-light.png)
SOLO_1024X768_PAIGE_OPEN: PASS: ev-1024x768-open-dark.png / -light.png — the shell turns PAIGE into a 410px overlay with a blurred backdrop over the 952px hub (the harness stand-in uses the shell's z-index 7/8); the hub keeps its layout underneath and its overlay drawer stays inside the hub's own stacking context
SOLO_900X1000_PAIGE_CLOSED: PASS: ev-900x1000-closed-dark.png / -light.png — hub 828px, 212 | 616 with the thread drawer overlaying, drawer cast with the shell's side-panel elevation (--pg-e3)
SOLO_900X1000_PAIGE_OPEN: PASS: ev-900x1000-open-dark.png / -light.png — PAIGE overlay 410px over the 828px hub, as at 1024

OWNER_INTENT: an active teammate never loses a message they typed, Team Hub loads in development as in production, and a long absence never hides messages without offering them
MUST_NOT_HAPPEN: a refused retry discards the text; a development double mount leaves the hub on its skeleton; a local send hides a refresh gap; no other increment-1 behaviour changes
MUST_PRESERVE: every increment-1 behaviour and test (79 Team Hub tests green); the SOLO nav order and Settings → Team route (untouched files)
ACCEPTANCE_CRITERIA: the three new tests pass and fail with their fix reverted; on the real platform a refused retry leaves the text in the composer, and after an absence plus a send, Load earlier messages appears
MOTION_PURPOSE: none added or changed
PROTECTED_SEAMS: useTeamHub's send/retry contract (SendOutcome unchanged); the refresh merge for stream and thread; non-SOLO shells NONE_AFFECTED: no non-SOLO file changed

INTERNAL_BUILD_IDENTITY: 43e9b4b28cc93c04dad329d07c74c7612a8e4989; deployment=none-follow-up-PR-not-merged (head is the follow-up PR commit on claude/practical-davinci-ij8hb8 that carries this record, base origin/main at the SHA given, which contains merged PR #2764); environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp08-team-hub-followup1.md plus the increment-1 frames under docs/evidence/ui-delivery/assets/exp08-team-hub-increment1/
RELEASE_CHANNEL: development: branch claude/practical-davinci-ij8hb8 on main 43e9b4b28; nothing is deployed by this record
RELEASE_CLASSIFICATION: internal-only: pre-launch defect fixes with no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: no approved release record and authenticated runtime is unproven
RELEASE_NOTE_REQUIRED: NO: internal-only increment; a customer-facing note waits for the authenticated drive and owner decision
RELEASE_TRUTH_BOUNDARY: PROOF OWED: mocked-RPC and static evidence complete for the three fixes; every authenticated flow remains proof owed as for increment 1, so nothing here is LIVE
RELEASE_RECOVERY: position=revert the follow-up merge, since the change is client-only and confined to src/solo/team-hub with no migration; reference=docs/delivery/exp08-team-hub-collaboration-contract.md §6 release rows


## Scope and collisions

- Classification: defect fixes in the existing SOLO Team Hub surface, from the Codex review of PR #2764.
- Affected flows: send recovery (Retry), loading, refresh merging for the stream and thread replies.
- Neighboring regressions: all 79 Team Hub tests; no nav, shell or SQL file changed.
- Active-owner/file collisions: none; only src/solo/team-hub/** and this record change.
- Explicit exclusions: everything listed as later increments in the contract.

## Evidence index

- Mocked-RPC tests: src/solo/team-hub/TeamHubWorkspace.mocked-rpc.test.tsx (three new tests named in AUTOMATED_EVIDENCE).
- Frames: reused from [assets/exp08-team-hub-increment1](assets/exp08-team-hub-increment1/); this change alters no markup or style.

## Review and limitations

Findings from the Codex review of PR #2764 (all P2, each a defect in increment 1's own code): the hook's liveness ref was never set back after React StrictMode's development cleanup, so every response was dropped; a retry the server refused removed the pending row without restoring its text; the refresh gap rule compared against the newest held message, which a local send makes newer than anything listed, hiding a real gap. Limitations: every item in UNVERIFIED above.
