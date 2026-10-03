# UI delivery evidence: Solo Marketing › Overview redesign (charts, KPI cards, next step)

The owner supplied a dashboard reference on 2026-10-03 ("upgrade the overview design to look more like
this", then "graphs and charts"). This record covers the rebuild of Marketing › Overview to that
reference. Frames are reproducible with `node scripts/live-drive/marketing-views-drive.mjs` (writes to
the gitignored `scripts/live-drive/artifacts/marketing-views/`).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding read before editing - the Overview's existing reads (useSoloCampaigns: pages, funnels, forms, latest 200 submissions with utm_json; useSoloCampaignBriefs: briefs with createdAt and lifecycle) and what they cannot support (no email, ads, visits or spend source; no publish date on pages); flows covered: read the department at a glance, change the period, create a brief from Overview, drill into Campaigns, Lead capture, Analytics and Pipeline, act on the recommended next step, first use
PAIGE_UI_DESIGN: PASS: Impeccable context loaded and craft-floor.md read before the UI edit (Operate mode; the owner's brief earns the KPI-card scaffold); dataviz skill applied - form per job, one y-axis, fixed categorical order validated with validate_palette.js in light and dark, legends with values, screen-reader table; impeccable detect exit 0 on the changed UI files
MATERIAL_FLOW_CHANGE: YES: Overview is rebuilt to the owner's reference; its Offers and Pipeline links follow the account's menu (Sales for a standalone Solo account, Marketing's own tabs otherwise)
FLOW_PROTOTYPE: PASS: the owner supplied the reference design itself (2026-10-03 screenshot); rendered frames of the built page were shown to the owner for approval before merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees in one screen what Marketing produced in the period, where leads came from, what is stuck and the one next move; primary act is Create campaign brief (gold), the next-step band carries the recommended move (violet)
VISUAL_DIRECTION: PASS: the existing Solo Mineral/Obsidian world (solo-tokens.css) with the owner's reference layout; chart colours are new --chart-1..4, --chart-other and --chart-untagged tokens in solo-tokens.css, light and dark; no hex in the new component rules; gold only on Create campaign brief
AUTOMATED_EVIDENCE: PASS: marketing-overview-model.test.ts (9 tests: day bucketing, previous-period coverage, floor, case-insensitive source folding, form ranking, brief statuses, a US daylight-saving change, a future-stamped lead, a full read reaching past the period) and growth2.render.test.tsx Marketing views (13 tests: figures, floors on every panel, period switch, brief hand-off, next step, Pipeline routing by tier, first use); the daylight-saving, future-row and coverage tests were each shown to fail with the defect reinstated
STATIC_EVIDENCE: PASS: tsc ratchet no new errors; eslint 0 errors on changed files (one pre-existing warning in growth2.tsx, line 24); gold-discipline lint clean; impeccable detect exit 0
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-views-drive.mjs = 764/764 checks: Overview, Campaigns, Lead capture and Analytics x 4 viewports x 3 PAIGE postures x 2 themes plus first-use, loading, error and read-only; new for Overview - both donuts, the bars and the opportunities line drawn in every frame (24 checks), measured WCAG contrast of every new text element saved to geometry.json (worst 5.65:1, the gold act); frames captured with reduced motion so charts show their final state
BEHAVIORAL_EVIDENCE: PASS: render tests drive Last 7 days (recounts and presses), Create campaign brief to the Campaigns builder, View pipeline to /growth/pipeline when the menu has no Sales and to /sales/pipeline when it does, first-use Offers link; a failed chart load is caught by ChartBoundary, logged and shown as a sentence while the rest of Overview stays up
AUTHENTICATED_RUNTIME: UNVERIFIED: this session has no tenant login for the deployed app; the render harness stubs only the Campaigns, briefs, offers and owner-profile reads; the signed-in check is owed to a browser-capable session (§32.c)
KEYBOARD_FOCUS: PASS: every link, task row, period button and act is a native button with a visible violet focus ring; recharts' own accessibility layer is turned off so charts add no unlabelled focus stops; the time chart is aria-hidden and backed by a caption-labelled screen-reader table; donuts carry an aria-label listing every slice
ZOOM_REFLOW: PASS: Overview sizes to its own container (.mk-view container queries): KPI cards 4 to 2 to 1 columns, chart rows 2 to 1, the lower row 3 to 2 to 1; no horizontal overflow at any measured width down to 439px
REDUCED_MOTION: PASS: charts disable their entrance under prefers-reduced-motion; the loading shimmer and row hover transition stop; nothing else moves
STATE_COVERAGE: PASS: resolving, loading (skeleton), error with retry, first use (guided, one act), populated, read-only member (no create act), no leads in the period, no sources, no forms with leads, no briefs, a full 200-row read (every count marked with +), a chart that fails to load
TRUTHFUL_STATE_LABELS: PASS: every figure is a read of campaign_briefs, published and draft pages, funnels and forms, or growth_form_submissions (source from utm_json); a previous-period comparison appears only when the read covers that whole period, as a count when the previous value was 0; email and paid ads named as not connected; no invented sources, reach, spend, conversion or revenue
SOLO_UI: YES: Solo Marketing › Overview, /solo/{account}/growth/overview

SOLO_1536X770_PAIGE_CLOSED: PASS: content column 1320px; both themes; overflow 0; charts drawn; frames overview-*-1536x770-closed.png
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px; overflow 0; charts drawn; frames overview-*-1536x770-docked.png
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px; overflow 0; charts drawn
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px (tightest); KPI cards reflow to 2 and 1 columns; overflow 0; charts drawn
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px; overflow 0; charts drawn
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed at 952px; overflow 0
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px; overflow 0; charts drawn
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed; overflow 0

OWNER_INTENT: upgrade Marketing › Overview to look like the owner's reference dashboard, with graphs and charts (owner, 2026-10-03)
MUST_NOT_HAPPEN: a fabricated figure (a delta the read cannot support, an email, ads, spend or reach number, an invented source); a link that lands an account on a department its menu hides; the Marketing tab strip changed (the Sales lane owns removing Offers, Sales and Pipeline from it); gold spent on anything but the act
MUST_PRESERVE: first-use guidance; the Create campaign brief hand-off to the Campaigns builder; the attention items (awaiting review, blocked, not routed, not published); each in-progress brief's written timing (now under Campaign status); Lead capture, Analytics, Campaigns, Social, Offers, Sales and Pipeline tabs unchanged
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing and sees the greeting, the four cards, leads over time, leads by source, top capture points, campaign status with brief timing, needs your attention and a next step, all from their own records; switching to Last 7 days recounts; every link lands where the menu says it should
MOTION_PURPOSE: PURPOSEFUL: chart entrance only (recharts default), so a reader sees the data arrive once; disabled under reduced motion
PROTECTED_SEAMS: tested - the Campaigns snapshot read (unchanged), briefs read (unchanged), the brief hand-off (render test), Analytics figures (now share Overview's period definition; Analytics render test), Systems Check destinations (unchanged). Unaffected and named - Campaigns desk, Lead capture, Social, Pipeline desk, Sales workspace, operator analytics

INTERNAL_BUILD_IDENTITY: 1e92581f2ce98e4f4e04c9ef8e30d4779cffd4c1; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production follows the owner's approval of the rendered frames and the merge to main
RELEASE_CLASSIFICATION: internal-only: redesign of an existing Solo surface from records it already reads
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: briefs, published and draft pages, funnels and forms, submissions and their tracking tags are real reads; email, paid ads, spend, visits and revenue by campaign are unavailable and say so; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c), owed to a browser-capable session: Overview against a real Solo account's records, the period switch, and the Pipeline and Offers links for a standalone account (Sales) and a sub-account (Marketing).

## Independent review (§5 / §39) and what changed because of it

- **Adversarial verifier.** No build or test break. Fixed because of it:
  - day boundaries are now built from calendar dates, so a daylight-saving change can no longer drop a day from the chart or shift the period off midnight;
  - a lead stamped ahead of the device's clock is counted as today, and the "200+" floor is decided by the oldest row, not by an upper bound;
  - each lazily loaded chart sits in a boundary that logs and degrades in place instead of unmounting the app;
  - recharts' accessibility layer is off (no stray focus stops, no interactive element inside role="img");
  - the floor marker now appears on the source donut, its legend and the capture-point ranking;
  - "N new" became "N briefs created in the period"; Published work shows its page, funnel and form counts beside the unpublished count;
  - the model re-derives when the day turns; chart colours are read before first paint.
- **Compliance officer.** BLOCK, cleared. Fixed because of it:
  - the drive now captures charts in their final state and asserts both donuts, the bars and the line are drawn;
  - Pipeline and Offers links route by the account's own menu: Sales only where the shell shows Sales (standalone Solo), Marketing's own tabs for every other account, decided by tenantShellDestinationsForPath through a prop from SoloApp;
  - Overview and Analytics now share one "last 30 days" definition and both merge source tags case-insensitively;
  - Draft and Paused have their own tones; grey is left to Other sources and No tracking tag;
  - chart colours moved into solo-tokens.css; the duplicate gold rule was removed;
  - the next-step copy no longer promises result tracking;
  - measured contrast is saved per frame in geometry.json.
- **§58 call-outs for the owner.** The old Overview's "Channels" panel is folded in: forms and pages are the Published work card, Social keeps its own tab, and email and paid ads are one line under Leads by source (Analytics still lists every unavailable measure). The "Campaigns in progress" list with each brief's timing is kept, now under Campaign status.
- **Deferred, recorded:** a deal-open date for opportunities (they are charted on the day the lead arrived, as the panel says); per-asset lead counts for pages and funnels (they collect through their forms).
