# UI delivery evidence: Marketing email E3 — series that send by themselves

The owner's order of work was E1 → E2 → E2b → E3 ("Merge when green, then start E2B"; E1 ruling "sequences
separate (E3)"). E3 lets a Solo owner or admin build a welcome, nurture or win-back series in Marketing ›
Email › Automations, approve it once, and have it send each email at its wait, through the same sender,
daily limit, footer and unsubscribe as campaigns. PAIGE proposes; nothing sends without the owner's approval.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flows - (1) first use: no series, the three starters, one opens a draft series; (2) build: who enters (new contacts, or anyone who matches a rule or saved segment, with today's reach), emails with waits (add, move, delete, preview), leave rules, sender; saves as you type; (3) file for approval, refused with the owner's words for an empty email, no postal address, a sender that cannot send or more matches than the daily limit; (4) approve on the series page or from the shared approvals queue, or Make changes / Not now; (5) running: people in it, funnel, who left and why, recent people with Remove; (6) pause, resume, stop (final), edit a running series as a new version approved again; (7) a member, another business or a client is refused in the database
PAIGE_UI_DESIGN: PASS: Impeccable craft floor applied: built on the E2 editor's me-/mo- system, token-only CSS, gold only on Approve, layered surfaces, both themes; render drive measured AA on every small-text style and found ink-3 at 4.15:1, moved to ink-2
MATERIAL_FLOW_CHANGE: YES: a new surface (the series page) and a live Automations panel replacing E2's "built next" note; the "Plan a nurture series" starter now creates a nurture series instead of opening PAIGE chat
FLOW_PROTOTYPE: PASS: interactive flow prototype (Flow Prototype skill) published for the owner at https://claude.ai/artifact/3rs8JoFfqD851QcV3mMXH3 - panel empty and populated, series view in draft, waiting for approval, running, paused, needs attention and stopped, the edit-a-running-series path, the state map, motion and reduced-motion notes, and open questions; mocked and throwaway, not in the product. Pre-launch (§4/§69) the build proceeds while the owner reviews it; the PR names where the product differs from it
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner or admin; primary action is approving a series to start
VISUAL_DIRECTION: PASS: the E2 email editor's direction (me-* on the mo-* system), with a vertical spine of emails and waits
AUTOMATED_EVIDENCE: PASS: marketing-email-series.render.test.tsx (13: panel rows and starters, editing locked while emails are reordered until the re-read lands, draft editing and saves, review panel and approve, running live panel, paused, blocked, stopped, change banner, refusals); marketing-email-series-model.test.ts (wait words, timeline, states, approval summary); email-campaign-worker.test.ts (+2: the tick runs before claims; a failed tick still lets campaigns send); execute-approval-email-series.test.ts (3: a queued series approval is decided by email_sequence_approve as the person, the claim is released on refusal, the branch runs before any row flip); each guard reinstated as a defect fails its test
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main; lint:migration-versions (after renumbering to 20270570000000), lint_migrations.py, lint:definer-fns pass; eslint warnings only
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-series-drive.mjs 1152/1152 (panel populated and first use, series draft, waiting, running, paused, needs attention, stopped and changing, at the four Solo sizes, PAIGE docked and closed, light and dark: no overflow, no sideways scroll, AA small text, gold only on Approve and start, each state draws what it should); frames inspected by eye
BEHAVIORAL_EVIDENCE: PASS: rolled-back proofs on the PR's preview database (committed: scripts/sql/email-series-proof.sql and email-series-isolation-proof.sql) of every series path, plus the review fixes (rules the tick cannot run refused on save; one broken series marked needs attention while the others run; a leased email to someone who left cancelled before the provider; a segment deleted under an approved series) (create and starters, refusals, append/move/delete, filing locks edits, generic approval refused, approve builds hidden step campaigns, tick enrols and plans, worker claims a step, exits, waits, re-planning after an edit, dashboard excludes series, pause/resume/stop, delete only if never started, new-contacts-only entry, unmatched exit, a blocked step blocks the series); jsdom drives of the page
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; building, approving and receiving a series on production is owed
KEYBOARD_FOCUS: PASS: radios rove with arrow keys, every control is a native button or input with the violet focus ring, a new email focuses its subject and a moved email keeps focus
ZOOM_REFLOW: PASS: container queries at 1000 and 720px; the drive's 900px frames reflow without overflow
REDUCED_MOTION: PASS: transitions are disabled under prefers-reduced-motion; no motion carries meaning
STATE_COVERAGE: PASS: loading, could not load, empty (starters), populated, draft, saving/saved/not saved, waiting for approval, changing, running, paused, needs attention, stopped, postal address missing, refusals
TRUTHFUL_STATE_LABELS: PASS: "Nothing has been sent" at review; next send reads "Due now" once due; a send not confirmed is never resent and is named; a goal counts only after joining
SOLO_UI: YES: Solo Marketing › Email › Automations and the series page, /solo/{account}/growth/email?series=

SOLO_1536X770_PAIGE_CLOSED: PASS: series drive
SOLO_1536X770_PAIGE_OPEN: PASS: series drive, docked
SOLO_1366X768_PAIGE_CLOSED: PASS: series drive
SOLO_1366X768_PAIGE_OPEN: PASS: series drive, docked
SOLO_1024X768_PAIGE_CLOSED: PASS: series drive
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: series drive
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: welcome, nurture and re-engagement series that send by themselves once the owner approves them, on the one send substrate, within the shared daily limit (owner, 2026-10-04: "sequences separate (E3)", "PAIGE proposes, never blasts", "one bounded approval", "Paige's Resend, capped")
MUST_NOT_HAPPEN: a series email sent without the owner's approval of that version; the same email twice to one address; a resend of an unconfirmed send; a series started without a postal address; a series' hidden step campaign changed or shown through the campaign screens; a false success from the approvals queue
MUST_PRESERVE: the E2 dashboard and editor and E2b's chat tools; campaigns' one approval; the worker's claim, eligibility, limit, footer and receipts; the frozen Audience surface (§28)
ACCEPTANCE_CRITERIA: on the live app the owner opens Marketing › Email › Automations, starts a welcome series, writes its emails, approves it, and a new contact receives email 1
MOTION_PURPOSE: hover and press feedback only
PROTECTED_SEAMS: tested - worker claim path with the tick before it, execute-approval's campaign branch (unchanged, series branch added after it), the E2 editor render suite; redefined with a series filter and proven - dashboard, campaign reads, settle, open envelopes, segment delete

INTERNAL_BUILD_IDENTITY: 59a246c905ca1c3138984e6f6a6faf5c905672e8; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270570000000 applies through deploy-migrations.yml on merge after its rolled-back preview proofs passed); edge=PROOF_OWED(email-campaign-worker and execute-approval deploy through deploy-edge-functions.yml on merge); evidence=src/solo/marketing-email-series.render.test.tsx (this commit carries every executable change; later commits change only this record)
RELEASE_CHANNEL: development: verified locally; production on merge per the owner's standing instruction
RELEASE_CLASSIFICATION: internal-only: pre-launch, no customers
CUSTOMER_RELEASE_IDENTITY: none: pre-launch, no customers
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: verified by tests, the render drive and rolled-back preview proofs; the signed-in production drive is owed
RELEASE_RECOVERY: position=revert the merge commit and pause any running series (the migration adds tables, two nullable columns, functions and redefinitions of existing functions, and reverting the code leaves the tables inert); reference=git revert of this PR's merge commit
UNVERIFIED: the signed-in production flow of building, approving and receiving a series (no tenant login in this session).

## Scope and collisions

- Classification: new Solo surface plus an additive migration and two edge function changes.
- Affected flows: the seven above.
- Neighboring regressions: E2 dashboard counts and campaign lists (series step campaigns are filtered out), the approvals queue, the worker.
- Active-owner/file collisions: Sales took migration 20270566000000 on main first; E3 was renumbered to 20270570000000.
- Known limits (master reference §4.0 E3): durable-work attempt ceiling for often-paused series, an approver who leaves the business, the daily limit checked only at filing, claim cost with large series.
- Explicit exclusions: PAIGE building series from chat (E3c); starter emails written for the owner (E3c); a designed Stop dialog and Undo for a deleted email (the browser confirm is used, as in E2); the sub-account tree's Email screen.

## Evidence index

- `npx vitest run src/solo/marketing-email-series.render.test.tsx src/__tests__/marketing-email-series-model.test.ts src/__tests__/email-campaign-worker.test.ts src/__tests__/execute-approval-email-series.test.ts`.
- `node scripts/live-drive/marketing-series-drive.mjs`.
- Preview-database proofs (rolled back): see the PR.

## Review and limitations

An independent adversarial verifier and a compliance officer reviewed the diff; their findings and fixes are listed in the PR. Where the product differs from the prototype is listed in the PR for the owner.
