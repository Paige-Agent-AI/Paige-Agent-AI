# UI delivery evidence: INT-298/INT-342 MBC slice 2c — Marketing Overview reads Marketing's server figures

Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized; INT-298, INT-342, Linear
ANT-15), slice 2, Overview half. 2b moved Analytics onto the server producer shipped in 2a; Overview still counted
leads, opportunities and sources from the latest 200 submissions and saw failures only among those. Now an owner's
Overview takes those figures from the server, over every lead in its 30 days, and states processing health the
server counts. Frames: `DRIVE_TABS=overview node scripts/live-drive/marketing-views-drive.mjs`; key frames in
`assets/int298-mbc2c-overview-server-figures/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against marketing-overview.tsx and its model (which parts are figures and which are drawn from rows), the 2a producer's eleven keys (the four lead keys and marketing.submissions.failed_current, its current-snapshot range and failed/stalled items), the shared issuer's argument rules, parseMetricResult, the 2b Analytics consumer and its hook, and every test that mounts Overview (growth2.render, sales-ops.contract, TenantCommandCenterShell.ownership, catalog-offers.contract). Flows: an owner reads how many leads came in and where from; an owner whose read is full; an owner whose forms have older or waiting submissions; a member reads the same page; Route it from the chain and Needs you
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; no new pattern, the approved Overview design is kept (§28); one note line under the chart and one under Needs you, both the existing .mov-note; independent non-author review of the real diff returned SHIP with four P2s, all taken: Overview no longer reads a previous period it never draws (four reads, not eight); processing health is a statement under Needs you rather than two rows with nothing to act on, which also stops them pushing a Route it row past the five shown; the chart note names what Overview draws (each form's recent submissions, not top forms); both hooks tested against the real validator
MATERIAL_FLOW_CHANGE: YES: an owner's summary, chain and source mix become exact for the 30 days instead of floors; failures older than the latest 200 and submissions still waiting after 15 minutes become visible; nothing previously shipped is removed (§58)
FLOW_PROTOTYPE: PASS: no prototype stage: the approved design is kept and fed from the server; pre-launch stance (CLAUDE.md §4, §69 pre-launch override)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin reads exact lead figures and sees every processing failure; a member keeps the page they had (the server refuses members, as for Analytics, Sales and Settings figures)
VISUAL_DIRECTION: PASS: unchanged Solo tokens and classes (.mov-note for both notes); both themes; no gold
AUTOMATED_EVIDENCE: PASS: marketing-analytics-metrics.test.tsx: the health answer; Overview's current-only read (four calls, no comparison); the health read's arguments and five-minute end through the real validator; a member's refusal logs nothing; another department's answer and a foreign epoch are errors (logging a member's refusal, or removing the owner check, each fails these). marketing-overview-model.test.ts: the overlay keeps the record-drawn chart and forms; the shared period start. growth2.render.test.tsx: an owner on a full read (412 exact, the chart note) and Needs you's health statement with the form's own Review kept; both fail against the previous Overview. Whole unit suite on the change: 731 files, 10,856 tests passed, none skipped; on base e7f0df4 in a separate worktree: 729 files passed and 2 skipped, 10,843 tests passed and 4 skipped. The first change run found 63 new failures in TenantCommandCenterShell.ownership and catalog-offers.contract (Overview's new reads refused by the unit network guard); both now stub the two hooks as a refused seat, 106/106
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on base e7f0df4 measured in a separate worktree (none in changed files); eslint 0 errors on changed files (2 warnings, both pre-existing react-refresh warnings in marketing-overview.tsx)
RENDERED_EVIDENCE: PASS: DRIVE_TABS=overview 446/446 on the final code, at 4 viewports x 3 PAIGE postures x 2 themes plus states: populated asserts the server was read and Needs you states the older and waiting submissions; a full read asserts 340 exact in the summary and chain, the chart note, and no floor note; a member asserts the page kept its own counts; frames in both themes looked at
BEHAVIORAL_EVIDENCE: PASS: the drive opens Route it from the chain into the form panel; the render tests read the summary, chain, source rows and Needs you
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the producer itself is proven on a production-schema clone in database-contract (slice 2a)
KEYBOARD_FOCUS: PASS: no new control
ZOOM_REFLOW: PASS: both notes reflow at every drive viewport
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: loading (the page's own counts until the server answers), owner, member (refused), failed read (logged, the page's own counts), full read, no leads, older failures, waiting submissions, failures only among the latest records
TRUTHFUL_STATE_LABELS: PASS: exact figures carry no "+"; the chart and recent submissions stay floors and the note says so; "nothing has failed" is claimed only when the server says so, and only of the latest 200 when it was not asked; older failures and waiting submissions are stated, never offered as a control that cannot act
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/overview

SOLO_1536X770_PAIGE_CLOSED: PASS: Overview both themes, overflow 0 (DRIVE_TABS=overview)
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=overview)
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0, including the full-read and member states (DRIVE_TABS=overview)
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=overview)
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=overview)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=overview)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Marketing KPIs come from Marketing's server producer, not the browser; no 200-row cap read as the whole period; failed and stalled processing stated with an explicit definition
MUST_NOT_HAPPEN: a member shown owner figures; a floor shown as exact or an exact figure shown as a floor; "nothing has failed" when the server counts a failure; a Needs-you row with nothing to act on; a redesign of the approved Overview
MUST_PRESERVE: the approved Overview layout; a member's read of the page (owner ruling S1d); the record-drawn chart, capture points and latest leads; Route it on the chain and in Needs you
ACCEPTANCE_CRITERIA: on the live app a Solo owner with more than 200 leads in 30 days sees the exact count in the summary and chain, a note that the chart is drawn from the latest 200, and any older or waiting submissions stated under Needs you; a member sees the page as before
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - Overview render and drive, Analytics render (shares the hook, still reads the previous period), sales-ops.contract, TenantCommandCenterShell.ownership, catalog-offers.contract; unaffected and named - the INT-340 issuer, resolver and validator (consumed, not changed), Campaigns, Audience, Content, Social, Email, Ads (marketing-ads.tsx untouched)

INTERNAL_BUILD_IDENTITY: 22ab6a46a5047bb3e4f52ad337874d9b81667973; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view now reading a shipped server producer
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the 2c commits - frontend only, no migration or edge change; reference=git revert of ac3db6a, 05bc651 and d9d9f78
UNVERIFIED: authenticated production runtime (§32.c): Overview against a real Solo owner and member; no tenant login exists in this session. Known and recorded, not fixed here: the server figures and processing health read once per tenant and day while the records can refresh, so a failure arriving after the page opened is listed by its form but not in the server's statement until the page is reopened; a member's page issues five refused reads.
