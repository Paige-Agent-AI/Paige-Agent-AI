# UI delivery evidence: Solo Marketing tabs to the owner's list (Audience, Content, Email, Ads) + Overview greeting removed

The owner gave the Marketing tab list on 2026-10-04 ("this is the actual subtab list that I want for
marketing ... these are the ones that I want dedicated to marketing, so we need to add these in there")
and asked that the Overview greeting go ("I don't need this. That's already available in the command
center", then "not just for my account. This is for every solo shell"). Frames are reproducible with
`node scripts/live-drive/marketing-views-drive.mjs` (gitignored `scripts/live-drive/artifacts/marketing-views/`).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding before editing - production read-only queries (marketing_content: 17 rows, all image/document drafts with no channel; clients.source: paige, manual, conversations); form submissions write source paige_form (growth-process-submission:413); Settings reads the sending identity through resolve_tenant_domain_identity and getManagedIdentityPresentation; no segment, broadcast, ad-account or spend table exists; the only other Solo greeting is Command Center's Business Game Plan (kept). Flows: reach each new tab by click, keyboard and deep link; read what exists for that job; follow the link to where the work lives (Clients, Settings › Connections, Lead capture, Vibe Studio); first use; failed read and retry
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; each Planned tab leads with real records before the not-built list; "Planned" is a quiet dashed pill (a state, not an act: never gold, never the violet that asks for a review); impeccable detect exit 0 on the changed UI files
MATERIAL_FLOW_CHANGE: YES: four tabs added to Marketing in the owner's order; the Overview greeting removed for every Solo account; Social's tab icon changed from people to send (Audience now carries the people icon)
FLOW_PROTOTYPE: PASS: the owner supplied the exact tab list and order; rendered frames are shown to the owner with this PR
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees, per marketing job, what their workspace already has and where to act on it; acts are links to the one home for each (Open Clients, Sending settings, Published work, Open Vibe Studio); no gold act is added
VISUAL_DIRECTION: PASS: existing Solo tokens and the Marketing primitives (mk-ledger, mo-panel, mo-rank, mk-flag); no hex; light and dark
AUTOMATED_EVIDENCE: PASS: marketing-planned.render.test.tsx (12 tests: tenant-scoped reads; floors on capped reads; counts from the full tally; email and ad copy filtered per channel on the server; published counts never shown as 0 before or after a failed read; a member told the library is admin-only instead of shown it empty; a sending identity resolved for another workspace refused; a stale workspace answer dropped; draft-first Ask PAIGE). The tenant filter, outcome label, published-count guard, identity-mismatch guard and stale-answer guard were each shown to fail with the defect reinstated. Tab order and registry tests updated (growth2.contract, growth2.render, sales-ops.contract, tierBranches); 936 tests across the Marketing, routing, Sales and Settings suites pass
STATIC_EVIDENCE: PASS: tsc ratchet no new errors (10/10); eslint 0 errors on changed files; impeccable detect exit 0; solo parity guard PASS after snapshot regeneration; gold-discipline lint reports one violation in src/components/dashboard/BusinessCreditDashboard.tsx:271, identical on the base commit and untouched here
RENDERED_EVIDENCE: PASS: marketing-views-drive 1756/1756 - Overview, Campaigns, Audience, Content, Email, Ads, Lead capture and Analytics x 4 viewports x 3 PAIGE postures x 2 themes plus first-use, loading and error states; now also fails any populated frame that shows an error state and asserts Email and Ads list only their own copy; first run caught the Planned pill at 3.95:1 (fixed to --ink-2); campaigns-nav-fit-drive 216/216 for the nine-tab strip (every tab reachable, selected tab on screen); marketing-overview-interaction-drive 25/25
BEHAVIORAL_EVIDENCE: PASS: render tests drive each tab's reads, links, retry and states; campaigns-nav-fit-drive checks every one of the nine tabs can be brought into view at every width and the selected tab is never off screen
AUTHENTICATED_RUNTIME: UNVERIFIED: this session has no tenant login for the deployed app; the harness stubs the Campaigns, briefs, offers reads and, for the Planned tabs only, the Supabase client; the signed-in check is owed to a browser-capable session (§32.c)
KEYBOARD_FOCUS: PASS: the tab strip's roving tabindex and arrow keys cover all nine tabs; each tab's accessible name includes ", Planned" where it applies; every act is a native button with the existing focus ring
ZOOM_REFLOW: PASS: panels 3 to 2 to 1 columns by container width; ledgers 4 to 2 to 1; list rows stack below 460px; the tab strip scrolls with the selected tab kept in view
REDUCED_MOTION: PASS: no new motion; loading shimmer is the existing skeleton, already off under reduced motion
STATE_COVERAGE: PASS: loading (skeleton), error with retry, first use (no contacts, no library, no sending identity), populated, capped reads (counts marked +), published work loading or failed (shown as an ellipsis or a dash with retry, never 0), a team member who cannot read the saved library (told it is visible to owners and admins), a workspace switch mid-read
TRUTHFUL_STATE_LABELS: PASS: every figure is a read of clients, marketing_content or the sending-identity RPC; segments, content calendar, scheduling, broadcasts, sequences, opens/clicks, ad accounts, spend and cost per lead are each listed as not available and never estimated
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/{audience|content|email|ads} and /overview

SOLO_1536X770_PAIGE_CLOSED: PASS: all eight driven tabs, both themes, overflow 0
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0; the strip scrolls with the selected tab in view
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Marketing carries exactly the owner's nine tabs in his order, with Audience, Content, Email and Ads marked Planned; the Overview greeting is gone for every Solo account (owner, 2026-10-04)
MUST_NOT_HAPPEN: a fabricated or estimated figure (reach, opens, spend, cost per lead); a read outside the active tenant; a second home for contacts, sending settings or creative work; gold on a state; the Command Center greeting removed
MUST_PRESERVE: Overview, Campaigns, Social, Lead capture and Analytics behaviour; the Sales redirects for old Offers, Sales and Pipeline addresses; the Command Center greeting; old Marketing aliases (active, performance, brand-kit, pages, funnels, forms, builders)
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing and sees the nine tabs in order, opens Audience, Content, Email and Ads and sees their own records and the honest not-built list, follows each link to its home, and sees no greeting on Overview
MOTION_PURPOSE: NONE: no motion added
PROTECTED_SEAMS: tested - tab registry round-trips and counts, Marketing tab order (contract + render + sales-ops), Overview figures, Sales redirects (legacySalesRoute untouched). Unaffected and named - Clients, Settings › Connections, Vibe Studio, Command Center

INTERNAL_BUILD_IDENTITY: 2decf57bd7a4c8bca7153a75b174f5e2149b1fdf; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge once CIS is green")
RELEASE_CLASSIFICATION: internal-only: four read-only Solo views over existing records and a copy removal
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: Audience, Content, Email and Ads read only existing data and are PROPOSED as features; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): the four tabs against a real Solo account, including a team member without marketing_content access.

## What would turn each Planned tab into a built one

These are the backend decisions from `docs/product/solo-marketing-ia-proposal.md` §4, unchanged:

- **Audience:** a segment-definition table and RPC owned by Clients.
- **Content:** a start date on campaign briefs, for a real calendar.
- **Email:** a broadcast record and an approval-gated send seam (sending spends money: owner decision).
- **Ads:** a tenant ad-account connection and spend ingestion (provider choice).
