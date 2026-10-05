# UI delivery evidence: Marketing email E3c — PAIGE writes email series from chat

The owner assigned E3c on 2026-10-05: "PAIGE creates and writes email sequences from Chat. Chat remains the
primary command layer. The Email/Automations UI remains observable/editable canonical state." It reuses E3
whole, with no new store, scheduler, worker or approval ledger. The owner's rulings recorded with it also
change the series screens:
- the two Welcome starters are worded apart;
- a paused series says people can still qualify, and how many are waiting to join;
- Stop says it is final before it is confirmed, and a stopped series offers Start a copy.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flows - (1) the owner asks PAIGE in chat for a series; she reads the business's series, links and prices, asks for any missing fact, and writes the whole series as a draft (who enters, every email and its wait, when people leave); (2) a link, price or fill-in nobody gave is refused before any write and named, and PAIGE asks; (3) the series appears in Marketing › Email › Automations when her turn ends, and an open series view shows her version, or asks the owner to choose when they have unsaved edits; (4) PAIGE files it for the owner's one approval; a person approves; the E3 tick and worker take over; (5) a series waiting for approval is refused, not withdrawn; a running series gets a new draft while the approved one keeps sending; a stopped series is refused and replaced with Start a copy; (6) paused: the page says people can still qualify and shows how many are waiting to join; (7) a member, another business or an agency account is refused
PAIGE_UI_DESIGN: PASS: Impeccable craft floor applied to the changed copy and states on the existing E3 series system (me-/mo- classes, token-only, gold only on Approve). Start a copy uses the primary indigo act, not gold. The independent compliance and Impeccable review is listed in the PR
MATERIAL_FLOW_CHANGE: YES: PAIGE can now write series from chat; the series view gains live readback after a chat turn, a paused disclosure with a waiting-to-join count, a final-Stop confirm and Start a copy; two starters are relabelled
FLOW_PROTOTYPE: PASS: not required as a new prototype. The surfaces are E3's, whose prototype the owner saw (https://claude.ai/artifact/3rs8JoFfqD851QcV3mMXH3), and the changes carry the owner's own 2026-10-05 rulings on wording and behaviour. Pre-launch (§4/§69) the build proceeds while the owner reviews the rendered frames
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner or admin; the primary act is asking PAIGE to write a series, then approving it
VISUAL_DIRECTION: PASS: unchanged E3 series view direction; new states reuse its notice, fact and button styles
AUTOMATED_EVIDENCE: PASS: src/__tests__/email-series-chat.test.ts (22) covers:; tools and descriptions; seat rule; the create key;; a whole new series written and read back; retry key;; refusals of an invented link, a foreign host, an unrecorded price and fill-ins, and acceptance of business, owner-given and existing links and prices;; missing waits; database refusals; a readback mismatch or an unexplained error is never reported as success;; filing succeeds only when the version is locked with its approval waiting; reads.; src/solo/marketing-email-series.render.test.tsx (21): paused disclosure and count; final Stop wording; Start a copy; PAIGE's change shown or conflict offered; the Automations list re-reads after a chat turn.; email-campaign-chat.test.ts and confirm-fingerprint.test.ts are updated for the shared seat rule and the series create key.; Each new guard, put back as a defect, fails its test: 4 adapter mutations and 3 UI mutations.; The full suite passed, 9389 tests.
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main; lint:action-risk, tool-catalogue, write-targets, migration-versions, definer-fns, governed-execution, capability-kit, capability-declaration, chat-tool-registry, paige-spine-registry, receipt-coverage, one-approval-gate and approval-direct-write all pass; the Impeccable detector passes on both changed UI files; eslint has warnings only (the same two as main)
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-series-drive.mjs 1152/1152 (Automations panel populated and first use, series draft, waiting, running, paused with "Waiting to join", needs attention, stopped with Start a copy, and changing, at the four Solo sizes, PAIGE docked and closed, light and dark: no overflow, no sideways scroll, AA small text, gold only on the approve act); paused, stopped and first-use frames inspected by eye
BEHAVIORAL_EVIDENCE: PASS: scripts/sql/email-series-chat-proof.sql run rolled back on the PR's preview database after migration 20270595000000 applied there, 40 results, including: create with three emails; a retry with the same key returns the same series;; another business is refused for reads and writes; no key, a bad goal and a bad wait are refused;; a change to two emails, matching, and leave-when-unmatched;; filing as PAIGE files one approval (source paige) and a second filing returns it; a change while waiting is refused;; a person approves; waiting to join counts 1 while running and while paused;; a change to the running series makes version 2 while the live emails are unchanged;; a stopped series is refused for change and filing; Start a copy makes a draft with the same emails and nobody in it;; autonomy rows default to confirm; activity wording.
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; asking PAIGE for a series in the signed-in app, approving it and receiving email 1 on production is owed
KEYBOARD_FOCUS: PASS: new controls are native buttons with the violet focus ring; the confirm dialogs are the browser's, as in E2/E3
ZOOM_REFLOW: PASS: the series view's container queries are unchanged; the drive's 900px frames reflow without overflow
REDUCED_MOTION: PASS: no new motion
STATE_COVERAGE: PASS: paused (waiting to join), stopped (Start a copy, copying, copy failed), PAIGE updated, PAIGE changed while editing (keep mine / show PAIGE's), plus every E3 state unchanged
TRUTHFUL_STATE_LABELS: PASS: A chat write is reported only after a fresh read shows it; anything else is unknown, never success.; "Waiting to join" is a live count computed the way the tick would enrol.; The Stop confirm says it cannot be restarted.
SOLO_UI: YES: Solo Marketing › Email › Automations and the series page, /solo/{account}/growth/email?series=

SOLO_1536X770_PAIGE_CLOSED: PASS: series drive
SOLO_1536X770_PAIGE_OPEN: PASS: series drive, docked
SOLO_1366X768_PAIGE_CLOSED: PASS: series drive
SOLO_1366X768_PAIGE_OPEN: PASS: series drive, docked
SOLO_1024X768_PAIGE_CLOSED: PASS: series drive
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: series drive
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: PAIGE writes complete email series from chat on the existing E3 system, without inventing facts, and files them for the owner's one approval (owner, 2026-10-05)
MUST_NOT_HAPPEN: PAIGE approving, starting or sending a series;; an invented link, price or fill-in saved into a series;; a pending approval silently withdrawn by PAIGE;; a running series' approved emails changed without a new approval;; a stopped series restarted;; a second store, scheduler, worker or approval ledger.
MUST_PRESERVE: E3's series view, tick, worker and one approval; E2b's campaign chat tools; the owner's own editing; the frozen Audience surface (§28)
ACCEPTANCE_CRITERIA: on the live app the owner asks PAIGE for a welcome series, sees the complete series in chat and in Automations, approves it, and a new contact receives email 1
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested: E2b's campaign tools and seat rule; read_email_sequence's consumers (series view, Automations); list_tool_autonomy and _workspace_event_display, rename-and-wrapped with the earlier rows kept.; proven: E3's owner functions, called unchanged.

INTERNAL_BUILD_IDENTITY: a116fb9466cb5a39695f05a5d2ea628a2524ea5a; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270595000000 applies through deploy-migrations.yml on merge after its rolled-back preview proof passed); edge=PROOF_OWED(paige-ai-chat deploys through deploy-edge-functions.yml on merge); evidence=src/__tests__/email-series-chat.test.ts (later commits carry review fixes and this record)
RELEASE_CHANNEL: development: verified locally and on the preview database; production on merge per the owner's standing instruction
RELEASE_CLASSIFICATION: internal-only: pre-launch, no customers
CUSTOMER_RELEASE_IDENTITY: none: pre-launch, no customers
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: verified by tests, the render drive and the rolled-back preview proof; the signed-in chat drive on production is owed
RELEASE_RECOVERY: position=revert the merge commit (the migration adds one nullable column, new functions and two rename-and-wraps, which stay inert once the tools are gone, so PAIGE simply stops offering series tools); reference=git revert of this PR merge commit
UNVERIFIED: the signed-in production flow of asking PAIGE for a series, approving it and receiving it (no tenant login in this session); offers, deadlines, guarantees and results are held only by PAIGE's instructions and business context, not by a check

## Scope and collisions

- Classification: chat capability on an existing Solo surface, plus an additive migration and paige-ai-chat wiring.
- Affected flows: the seven above.
- Neighbouring regressions:
  - E2b campaign chat tools share the seat set (union) and the activity and autonomy wrap chains;
  - read_email_sequence is wrapped, not rewritten.
- Active-owner/file collisions:
  - open C4b (#1766) and INT-326 (#1764) touch paige-ai-chat/index.ts in disjoint regions;
  - no open PR touches action-risk, fingerprint, workspace-authority or execute-approval;
  - migration 20270595000000 is above prod and main (20270588326001) with headroom.
- Explicit exclusions:
  - pause, resume, stop and approve from chat;
  - a per-form audience;
  - a server-side check for offers, deadlines, guarantees and results;
  - a Marketing missing-fact resume store (C4c is shared work);
  - the four E3 hardening debts.

## Evidence index

- `npx vitest run src/__tests__/email-series-chat.test.ts src/solo/marketing-email-series.render.test.tsx src/__tests__/email-campaign-chat.test.ts src/__tests__/confirm-fingerprint.test.ts`.
- `node scripts/live-drive/marketing-series-drive.mjs`.
- `scripts/sql/email-series-chat-proof.sql` on a preview branch seeded by `scripts/sql/email-series-preview-seed.sql`.

## Review and limitations

An independent adversarial verifier and a compliance and Impeccable officer reviewed the real diff. Their findings and the fixes are listed in the PR.
