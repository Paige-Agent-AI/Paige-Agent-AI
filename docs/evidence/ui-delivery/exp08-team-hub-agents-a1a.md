# UI delivery evidence: EXP08 Team Hub agents, increment A1a (storage, turn doors, tolerant parsers)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in docs/delivery/exp08-team-hub-agents-contract.md (A1a status block and §5 A1 proofs) and the tier-matrix "EXP08 Team Hub agents" entry; A1a touches the existing Team Hub flows only where they read conversation and message rows (first load, refresh, search labels, PAIGE's Team Hub reads)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md and Impeccable's reference/craft-floor.md read; A1a changes no markup, copy, token or style, so the design work it carries is the approved prototype v3 behaviour (§28) and the owner's 2026-10-27 APPROVED-FROZEN agent colours, both recorded in the contract for A1b to build
MATERIAL_FLOW_CHANGE: NO: no visible change; the two UI files only parse defensively — an unknown conversation kind or an agent-authored row is skipped and counted instead of emptying the list — and nothing can create an agent row until A1b gives the agents a voice
FLOW_PROTOTYPE: NOT_REQUIRED: no visible flow changes in A1a; the agent experience it prepares was approved as prototype v3 with the owner's rulings of 2026-10-27 (design approved, owners and admins assign, top-level replies, seven personalities, MERIT = sales and getting paid, agent colours and symbols approved) and is built in A1b
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: active teammates of a canonical SOLO workspace keep reading and posting in Team Hub exactly as before; the primary action (read a conversation, post into it) is unchanged
VISUAL_DIRECTION: PASS: unchanged; no --pg-* token, colour, gold use, layout or copy changes in this increment
AUTOMATED_EVIDENCE: PASS: npx vitest run src/solo/team-hub → 175 tests pass (3 files), including the tolerant-parser tests (reinstating whole-list parsing fails 3 vitest tests and 1 node test; dropping the agent-row filter fails the mocked-RPC test); supabase/tests/exp08_team_hub_agents_a1.sql on disposable PostgreSQL 16: proof complete, 24 of 24 mutants each fail their probe, controls hold; the eight other EXP08 Team Hub, lifecycle, co-owner and admin-scope proofs pass on base and branch
STATIC_EVIDENCE: PASS: npm run ci:tsc → no new type errors (baseline 10, current 0); lint:migration-versions, lint:title-authority, lint:binding-ledger, lint:tier-features and every lint:* step in ci.yml exit 0; C0b tests 249/249 with no pin change
RENDERED_EVIDENCE: PASS: STRUCTURAL / RENDERED-HARNESS, reused because A1a changes no markup or style: the increment 3 frames under [assets/exp08-team-hub-increment3](assets/exp08-team-hub-increment3/) render the same tree this branch renders for every conversation and message a workspace can hold today (no agent rows can exist before A1b)
BEHAVIORAL_EVIDENCE: PASS: jsdom MOCKED-RPC only — a conversation list containing an unknown kind and a message page containing an agent-authored row render the known rows and skip the rest, instead of showing an empty hub
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated session exists in this environment; the drive on the owner-designated SOLO account is owed and becomes meaningful when A1b makes agents reply
KEYBOARD_FOCUS: PASS: unchanged from increment 3 (no control, order or focus change in this increment)
ZOOM_REFLOW: PASS: unchanged from increment 3 (no layout change in this increment)
REDUCED_MOTION: PASS: unchanged; no motion added or changed
STATE_COVERAGE: PASS: first load, refresh and search with only known rows (unchanged), and with an unknown kind or agent row present (skipped and counted); all other Team Hub states unchanged
TRUTHFUL_STATE_LABELS: PASS: no new label; nothing claims an agent can speak — none can until A1b
SOLO_UI: YES: SOLO main menu destination teamhub (src/solo/team-hub/**, mounted from src/solo/SoloApp.tsx); Agency and Sub-account shells untouched
UNVERIFIED: authenticated runtime on the owner-designated SOLO account; the post-merge persisted apply of migrations 20271117010008 and 20271117010108 and of the six roster rows (owed after merge, §32); the two-session seat-end race on team_hub_open_agent_dm (defence in depth, not driven)

SOLO_1536X770_PAIGE_CLOSED: PASS: ev-1536x770-closed-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_1536X770_PAIGE_OPEN: PASS: ev-1536x770-open-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_1366X768_PAIGE_CLOSED: PASS: ev-1366x768-closed-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_1366X768_PAIGE_OPEN: PASS: ev-1366x768-open-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_1024X768_PAIGE_CLOSED: PASS: ev-1024x768-closed-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_1024X768_PAIGE_OPEN: PASS: ev-1024x768-open-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_900X1000_PAIGE_CLOSED: PASS: ev-900x1000-closed-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused
SOLO_900X1000_PAIGE_OPEN: PASS: ev-900x1000-open-files-dark.png / -light.png (increment 3) — markup unchanged by A1a, frames reused

OWNER_INTENT: PAIGE and her six agents become Team Hub participants with their own personalities (owner-approved 2026-10-27); A1a lays the storage and server doors for that without changing what anyone sees today
MUST_NOT_HAPPEN: an unknown row empties a teammate's conversation list; anyone posts as an agent without an accepted turn; an owner sees a member's private agent DM; any increment 1–3 behaviour changes
MUST_PRESERVE: every Team Hub behaviour and test from increments 1–3; production's eight re-emitted function bodies outside their marked A1 hunks (byte-identity proven); the approved prototype v3 and the frozen agent colours
ACCEPTANCE_CRITERIA: on the real platform Team Hub loads, refreshes and searches exactly as before; the two migrations and six roster rows read back on production after merge
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Team Hub list/message/search reads (tolerant parsing, tested); team_hub_post_message (eight-argument signature, every named and positional caller still resolves, proven); PAIGE's Team Hub reads in _shared/team-hub/chat.ts (tested); non-SOLO shells NONE_AFFECTED: no non-SOLO file changed

INTERNAL_BUILD_IDENTITY: e5dfa7a07a3d8e4a0c4540f61813746ddf14b278; deployment=none-PR-not-merged (head of claude/practical-davinci-ij8hb8, base origin/main 45111f9e5); environment=local; migrations=PROOF_OWED(20271117010008 and 20271117010108 apply through deploy-migrations.yml on merge, read back after); edge=PROOF_OWED(paige-ai-chat redeploys on merge through chat.ts and vp-address.ts, edge-live read back after); evidence=docs/evidence/ui-delivery/exp08-team-hub-agents-a1a.md
RELEASE_CHANNEL: development: branch claude/practical-davinci-ij8hb8; production on merge per the pre-launch stance (§4)
RELEASE_CLASSIFICATION: internal-only: storage and server doors with no visible change and no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: agents cannot speak until A1b and authenticated runtime is unproven
RELEASE_NOTE_REQUIRED: NO: nothing a customer can see changes in this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: agent storage and doors are LIVE on merge but unreachable from any screen; agent replies are UNAVAILABLE until A1b; the authenticated drive is PROOF OWED
RELEASE_RECOVERY: position=forward-fix by migration, since the new tables and columns are additive and every re-emitted body has its prior body in the chain; reference=docs/delivery/exp08-team-hub-agents-contract.md A1a status block

## Scope and collisions

- Classification: additive storage, server doors and defensive client parsing for the approved Team Hub agents design.
- Affected flows: Team Hub first load, refresh and search; PAIGE's Team Hub reads; MERIT and NEXUS addressing in PAIGE chat (remit text from the corrected roster).
- Neighboring regressions: all Team Hub, lifecycle, co-owner and admin-scope proofs; C0b tests; Team Hub vitest.
- Active-owner/file collisions: none; paige-ai-chat/index.ts, action-risk, the Spine registry and C0b are not touched (EXP05's window, ANT-161).
- Explicit exclusions: agent replies, the approval card, assignments and every visible agent element (A1b and later).

## Evidence index

- Proof: supabase/tests/exp08_team_hub_agents_a1.sql (in ci.yml), disposable PostgreSQL 16.15.
- Mocked-RPC and parser tests: src/solo/team-hub/TeamHubWorkspace.mocked-rpc.test.tsx, src/solo/team-hub/team-hub-contract.test.ts, supabase/functions/_shared/team-hub/chat.test.ts.
- Frames: reused from [assets/exp08-team-hub-increment3](assets/exp08-team-hub-increment3/); A1a changes no markup or style.

## Review and limitations

Two independent verifier rounds and a compliance pass. Their findings are fixed:
- the migrations sorted before production's newest, and were renumbered twice as main moved;
- the committed contract and personalities docs came from an older draft, and were rebuilt from the approved files;
- a reused request id could tie a turn to another question's reply, now refused, with UNIQUE on posted_message_id as the storage backstop;
- re-arms bypassed the 30-per-hour cap, and now count;
- five guards had no probe, and now have probes and mutants.

Remaining limitations are listed under UNVERIFIED.
