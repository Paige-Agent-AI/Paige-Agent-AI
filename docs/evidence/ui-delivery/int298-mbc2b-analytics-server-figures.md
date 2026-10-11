# UI delivery evidence: INT-298/INT-342 MBC slice 2b — Marketing Analytics reads Marketing's server figures

Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized; INT-298, INT-342, Linear
ANT-15), slice 2 of 6, second half: the Analytics surface moves its headline figures, funnel and source mix onto the
server producer shipped in 2a (`_marketing_metric_bundle`, through INT-340's `issue_analytics_evidence_bundle`), so an
owner's figures count every lead in the range instead of the latest 200 submissions. Frames:
`DRIVE_TABS=analytics node scripts/live-drive/marketing-views-drive.mjs`; key frames in
`assets/int298-mbc2b-analytics-server-figures/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against marketing-analytics.tsx and its model (which parts are figures and which are drawn from rows), the 2a producer and contract (keys, item keys `src:`/`brief:`/`tag:`/`_other`/`_untagged`, exclusions), the shared issuer's argument rules (range key is a label; end must be at or before the server's clock; re-issuing on one key revokes the earlier reference), parseMetricResult, the Sales precedent (useSalesPerformanceMetrics), growth-process-submission's routing precedence, and every test and harness that mounts Analytics (sales-ops.contract mounts it and needed the hook stubbed). Flows: an owner reads how many leads came in and where from; a member reads the same page; an owner whose read is full; change the range; open a form from Overview's Route it
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; no new pattern, the approved Analytics design is kept; one note line added for opportunities that no longer exist; tile sparklines are left out only when the tile is exact and the read is full; independent non-author review of the real diff returned SHIP-WITH-FIXES, no blocking: both should-fixes taken (a clock-ahead device silently losing the server figures; a form whose own route is skipped being sent to a panel that cannot fix it) and the truthfulness nits taken (sparklines under exact tiles, a brief the page doesn't list, ambiguous and folded tag rows, UNAVAILABLE drawn as zero, deleted opportunities undisclosed, a stale tier-matrix line)
MATERIAL_FLOW_CHANGE: YES: an owner's headline figures, funnel and source mix become exact for the range and their comparison with the period before returns when the read is full; a form with its own pipeline route and an enabled automation without a pipeline step now reads "No pipeline" (it never reached one) and says what to change; nothing previously shipped is removed (§58)
FLOW_PROTOTYPE: PASS: no prototype stage: the approved design is kept and fed from the server; pre-launch stance (CLAUDE.md §4, §69 pre-launch override)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin reads exact lead figures; a member keeps the page they had (the server refuses members, as for Sales and Settings figures)
VISUAL_DIRECTION: PASS: unchanged Solo tokens and classes (.mva-cap for the new note); both themes; no gold
AUTOMATED_EVIDENCE: PASS: marketing-analytics-metrics.test.tsx (10): the four answers against the real parseMetricResult, the overlay, tag rows the page can't name, deleted opportunities, the eight issued reads, a member's refusal, no session, a foreign epoch, a clock ahead of the server retried, UNAVAILABLE never drawn (the retry and UNAVAILABLE tests shown to fail with each fix removed); growth2.render.test.tsx: the owner overlay (shown to fail with the server path disabled), a member, both route cases (the skipped-route case shown to fail before the routing fix). Full unit suite on the change: 728 files, 10,814 tests passed; on base 64a646f in a separate worktree: 725 passed and 2 skipped, 10,803 passed and 4 skipped. sales-ops.contract failed 48 tests before its stub was added (unmocked transport), 95/95 after
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on base 64a646f measured in a separate worktree (none in changed files); eslint 0 errors on changed files (5 warnings, all pre-existing: 6 on base in the same files); impeccable@4.1.0 detect exit 0 on the changed UI files
RENDERED_EVIDENCE: PASS: DRIVE_TABS=analytics 376/376 on the final code, at 4 viewports x 3 PAIGE postures x 2 themes plus states: populated asserts the server was read and the headline, first funnel step and outcome ring agree when the read is complete; full read asserts 340 exact in the headline, funnel and summary, the ring a floor (200+), and the note naming which is which; a member asserts the server refused and the page kept its own counts; frames in both themes looked at
BEHAVIORAL_EVIDENCE: PASS: the drive changes the range (Week moves the summary) and opens a capture point's form panel; the render test opens Route it on a skipped-route form and reads the panel's instruction
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the producer itself is proven on a production-schema clone in database-contract (slice 2a)
KEYBOARD_FOCUS: PASS: no new control
ZOOM_REFLOW: PASS: the note and tag rows reflow at every drive viewport
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: loading (the page's own counts until the server answers), owner, member (refused), failed read (logged, the page's own counts), full read, no leads, deleted opportunities, ambiguous tags, folded tags, an unlisted brief
TRUTHFUL_STATE_LABELS: PASS: exact figures carry no "+"; parts drawn from the read stay floors and the note says which; an UNAVAILABLE answer is never drawn as zero; leads matching several briefs are shown and credited to none; a member is never shown owner figures
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/analytics and /growth/overview

SOLO_1536X770_PAIGE_CLOSED: PASS: Analytics both themes, overflow 0 (DRIVE_TABS=analytics)
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=analytics)
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0, including the full-read and member states (DRIVE_TABS=analytics)
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=analytics)
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=analytics)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=analytics)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Marketing KPIs come from Marketing's server producer, not the browser; no 200-row cap read as the whole range; definitions, completeness and unavailable states honest
MUST_NOT_HAPPEN: a member shown owner figures; a floor shown as exact or an exact figure shown as a floor; an UNAVAILABLE reading drawn as zero; a redesign of the approved Analytics
MUST_PRESERVE: the approved Analytics layout; a member's read of the page (owner ruling S1d); the record-drawn trend, outcome ring, capture points and heatmap; Week/Month/Quarter
ACCEPTANCE_CRITERIA: on the live app a Solo owner with more than 200 leads in a range sees the exact count in the headline, funnel and source mix, the comparison with the period before, and a note saying which parts are drawn from the latest 200; a member sees the page as before
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - Analytics render and drive, Overview routing render, sales-ops.contract; unaffected and named - the INT-340 issuer, resolver and validator (consumed, not changed), Campaigns, Audience, Content, Social, Email, Ads (marketing-ads.tsx untouched)

INTERNAL_BUILD_IDENTITY: f729d4090ac9adb0c0878ccf92f8a0d5bb80ba48; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view now reading a shipped server producer
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Analytics against a real Solo owner and member; no tenant login exists in this session. Known and recorded, not fixed here: the server figures do not refresh while the page stays open (the records can); a member's page issues eight refused reads per range; the four other produced keys (daily series, snapshots, email) are not yet drawn from the server, and Overview still counts from its own read (MBC 2c).
