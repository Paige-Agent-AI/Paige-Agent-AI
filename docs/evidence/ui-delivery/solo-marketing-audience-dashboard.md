# UI delivery evidence: Solo Marketing › Audience rebuilt as a dashboard

The owner shared a reference dashboard on 2026-10-04 ("this is how I want to reimagine the audience subtab"),
then said "build". This record covers the rebuilt Audience tab: six figures, the composition donut, lifecycle
stage bars, a growth area, source and tag shares, PAIGE's observations with a draft-first next action, and the
largest tagged groups with Draft a message. Every figure is derived from the workspace's own contacts; anything
in the reference the data cannot support (open rates, revenue by audience, saved segments) is not drawn.
Frames: `node scripts/live-drive/marketing-views-drive.mjs`, plus full-length frames in
`assets/solo-marketing-audience-dashboard/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding before editing - production read-only queries (authenticated holds SELECT on clients and client_contact_methods, column privileges cover email, phone, tags, last_contacted_at; client_contact_methods is readable only alongside its contact; live lifecycle stages new_lead, hot_lead, client_active and sources paige, manual, conversations all have labels); the reference image was mapped field by field to what the data holds. Flows: open Audience by click, keyboard and deep link; change the period; read each figure and chart; open Clients; ask PAIGE for the next action; draft a message for a tagged group; first use; failed read and retry
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; figures lead, charts below, observations last; one accent per chart via --chart tokens; Ask PAIGE is a quiet button (an act that only drafts, never gold); impeccable detect exit 0 on the changed UI files
MATERIAL_FLOW_CHANGE: YES: Audience moves from a ledger of counts to a dashboard with a 7/30/90-day period, charts and observations; the shared chart and stat primitives move to src/solo/marketing-ui.tsx so Overview and Audience use one copy
FLOW_PROTOTYPE: PASS: the owner supplied the reference design; rendered frames in both themes and at 900px are shown to the owner with this PR
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees who their audience is, how it is growing and who has gone quiet, and acts through PAIGE (draft-first) or Open Clients; no gold act is added
VISUAL_DIRECTION: PASS: existing Solo tokens and Marketing primitives (mo-panel, mo-stat, mo-donut, mo-rank, mo-next); stage colours by group (leads, qualified, clients, former) from --chart tokens; no hex; light and dark
AUTOMATED_EVIDENCE: PASS: marketing-audience-model.test.ts (5 tests: period and previous-period counts, comparisons only on a complete read, reachability excludes opted-out contacts, stage grouping and order, growth line, stale contacts) and marketing-audience.render.test.tsx (3 tests: tenant-scoped reads with merged contacts excluded, figures, period switch, draft-first Ask PAIGE, first use, failed read and retry). Shown to fail with each defect reinstated: merged-contact filter removed, opted-out contacts counted reachable, the PAIGE prompt allowed to send, a capped read compared. Solo and routing suites: 2593 tests across 162 files pass
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on the base commit (none in changed files); eslint 0 errors on changed files; impeccable detect exit 0; solo parity guard PASS; tier-feature lint PASS; gold-discipline lint reports one violation in src/components/dashboard/BusinessCreditDashboard.tsx:271, identical on the base commit and untouched here
RENDERED_EVIDENCE: PASS: marketing-views-drive DRIVE_TOTAL across all eight driven tabs x 4 viewports x 3 PAIGE postures x 2 themes plus states; Audience frames now also assert six figures, the composition donut, stage bars and growth area are drawn, and the new small text meets 4.5:1; the first frames caught a truncated legend label, stage names running together at narrow widths, a growth axis that did not start at zero and two awkward lines of copy, all fixed before this record; campaigns-nav-fit-drive NAV_TOTAL
BEHAVIORAL_EVIDENCE: PASS: render tests drive the period control, Open Clients, Ask PAIGE prefill (never sends), retry after a failed read
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harness stubs the Supabase client for the Audience read; the grant and columns it needs were confirmed on production by query
KEYBOARD_FOCUS: PASS: the period control is native buttons with aria-pressed; Open Clients, Ask PAIGE and Draft a message are native buttons with the existing focus ring; charts carry a text label naming every value
ZOOM_REFLOW: PASS: figures 6 to 3 to 2 to 1 columns by container width; chart rows 3 to 2 to 1; share rows keep name, bar, percent and count aligned
REDUCED_MOTION: PASS: chart entrance animation is off under reduced motion (isAnimationActive follows useReducedMotion)
STATE_COVERAGE: PASS: loading (skeleton), error with retry, first use (no contacts), populated, a read beyond 5,000 contacts (figures marked + and comparisons withheld), undated contacts (comparisons withheld), a workspace switch mid-read
TRUTHFUL_STATE_LABELS: PASS: every figure is a count of clients or client_contact_methods; a comparison appears only when the read covers both periods; saved audiences and a contact's tracking tag are listed as not available yet
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/audience

SOLO_1536X770_PAIGE_CLOSED: PASS: all eight driven tabs, both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Audience looks and works like the owner's reference dashboard, built on real data only, with no header and no Planned marker (owner, 2026-10-04)
MUST_NOT_HAPPEN: a fabricated or estimated figure; a comparison drawn from a partial read; a read outside the active workspace; merged contacts counted twice; opted-out contacts counted as reachable; PAIGE sending anything from this tab
MUST_PRESERVE: Overview, Campaigns, Content, Social, Email, Ads, Lead capture and Analytics behaviour; the nine-tab order; no header on the four tabs
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing › Audience, sees their own contacts as figures and charts, switches between 7, 30 and 90 days, and asks PAIGE for a draft without anything being sent
MOTION_PURPOSE: NONE: only the existing chart entrance, off under reduced motion
PROTECTED_SEAMS: tested - Overview figures and charts (shared primitives moved, Overview render tests pass), tab registry and order (growth2.contract, growth2.render, sales-ops.contract). Unaffected and named - Clients, Content, Email, Ads, Vibe Studio

INTERNAL_BUILD_IDENTITY: 2f71b281c4c11fbb9223b0d821583a3c4aadc85e; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge when CI is green")
RELEASE_CLASSIFICATION: internal-only: a read-only Solo view over existing records
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: Audience reads only existing data; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Audience against a real Solo account.
