# UI delivery evidence: Experience 03 S1b — where a campaign-attached form's leads go

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §9 (S1b)
(Linear ANT-51 / ANT-147). Backend in the same PR: migration `20271026100000` (`_growth_form_campaign_route`,
`growth_attach_submission_default_deal`, `marketing.forms.unrouted_current`, `get_form_campaign_routes`).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet is the journey record §6 and §9 S1b (flow F3 "capture a prospect into the right pipeline": actor Solo owner/admin or member, entry Marketing › Overview / Analytics / a form's panel / a campaign's dossier, exit the stated destination); states: own route, campaign route, default route, no route, intake functions known undeployed
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md and Impeccable (Operate mode, refinement of the incumbent route line) and reference/craft-floor.md before the first UI edit
MATERIAL_FLOW_CHANGE: YES: a form attached to one campaign with a pipeline now states, and is counted as, routed to that campaign's pipeline on Overview (capture card, chain, Needs you, summary, Ask PAIGE), Analytics capture rows and the form panel; the dossier's pipeline row states the rule
FLOW_PROTOTYPE: PASS: no new layout; the destination uses the owner-approved route line of prototype v2 (record copy docs/prototypes/int342-marketing-convergence.html, approved 2026-10-10 per docs/product/int342-marketing-convergence.md line 3; the "(default) →" route line shipped in #1998/#2011 under the same approval) with one new value, "Campaign: <pipeline> → <stage>", worded classifier-first because the approved card clips the route line to one line (rendered: "Campaign: Advisory cons…" stays meaningful)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner sees where each form's leads land and is not told a campaign-routed form is unrouted; read-only statement, the existing "Route it"/route controls are unchanged
VISUAL_DIRECTION: PASS: incumbent route line (.mov-cp-r, .mva-row-t small, panel row) unchanged in style; tokens only; no gold; the card's line gains a title with the full destination
AUTOMATED_EVIDENCE: PASS: growth2.render.test.tsx (campaign route on Overview, panel and Analytics; own route first; default not overriding the campaign; the undeployed-intake gate), marketing-overview-model.test.ts (order and label), campaign-routes.test.ts (parser), campaign-briefs.contract.test.tsx (dossier sentence), src/__tests__/campaign-pipeline-routing.test.ts (static contract, 11) — mutation-checked: dropping the campaign route, ignoring the intake gate on Overview, ignoring it on Analytics, and dropping the Overview row label each fail a test; full unit suite 12,173 passed / 0 failed vs base 12,156 / 0 (before the review fixes, which add 1 render assertion block and 1 static test)
STATIC_EVIDENCE: PASS: eslint clean on the changed files (pre-existing warnings unchanged); tsc reports nothing in the changed files; lint:definer-fns, migration-versions, views, managed-schema, write-targets, tier-features, binding-ledger, release-governance, receipt-coverage, tool-catalogue, alias-ratchet, solo-parity
RENDERED_EVIDENCE: PASS: scripts/live-drive/campaign-route-drive.mjs through the real GrowthHub (marketing-mount harness, `?routes=campaign`): 324/324 checks, 9 frames x 3 views (Overview capture, form panel, Analytics capture) x 2 themes; without the fixture 126 fail (it bites); frames in scripts/live-drive/artifacts/campaign-route (gitignored)
BEHAVIORAL_EVIDENCE: PASS: the drive opens the form's panel from its Overview card; removing a form from a campaign in the dossier re-reads the shared Marketing read (render test, mutation-checked), so the other screens follow it; independent non-author review FIX-FIRST (2 MAJOR, 5 MINOR), both MAJOR and the MINOR within scope fixed, two consumers filed (#2079 realtime, #2080 publish preview); the server rule behind the stated destination is proven by supabase/tests/campaign_pipeline_routing.sql (database-contract), mutation-checked
AUTHENTICATED_RUNTIME: UNVERIFIED: the canonical QA account (PC-1, ANT-21) needs Auth/admin repair and a runner credential before any signed-in drive; production has no form linked to a campaign with a pipeline yet
KEYBOARD_FOCUS: PASS: no new control; the form panel is opened from its existing card button
ZOOM_REFLOW: PASS: reflow at 900px and 390px content widths; the card's route line clips as before with the classifier first
REDUCED_MOTION: PASS: no motion change
STATE_COVERAGE: PASS: campaign route; own route wins over a campaign route; default route when there is no campaign route; no route; intake functions known undeployed (no campaign or default destination claimed)
TRUTHFUL_STATE_LABELS: PASS: the dossier sentence is conditional ("While it has an open stage", not for an archived brief); PAIGE's brief tools say that linking a pipeline routes future leads; every screen states the destination from the server's own rule (get_form_campaign_routes), never from a per-lead tag; the dossier states the rule, not a per-lead claim; before the migration is applied the read is absent (PGRST202) and no campaign route is claimed, matching the server
SOLO_UI: YES: Marketing › Overview, Analytics, a form's panel, Campaigns › dossier (src/solo/marketing-overview.tsx, marketing-analytics.tsx, growth2.tsx, campaign-desk.tsx)
UNVERIFIED: authenticated runtime on production (PC-1 blocked); a real campaign-routed lead (none exists yet)

SOLO_1536X770_PAIGE_CLOSED: PASS: light/dark-1536x770-paige-closed-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_1536X770_PAIGE_OPEN: PASS: light/dark-1536x770-paige-open-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_CLOSED: PASS: light/dark-1366x768-paige-closed-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_OPEN: PASS: light/dark-1366x768-paige-open-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_CLOSED: PASS: light/dark-1024x768-paige-closed-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_OPEN: PASS: light/dark-1024x768-paige-open-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_CLOSED: PASS: light/dark-900x1000-paige-closed-*.png, three views, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_OPEN: PASS: light/dark-900x1000-paige-open-*.png, three views, no overflow, contrast >= 4.5:1

OWNER_INTENT: a business owner's prospects land in the campaign's pipeline they set up, and every screen says so (Experience 03: "prospect enters the correct Sales pipeline with source and campaign attribution")
MUST_NOT_HAPPEN: a form called unrouted while its campaign files its leads; a destination stated that the server would not use; a per-lead guess; a form's own route overridden; another business's pipeline followed; a Sales table changed
MUST_PRESERVE: own-route and default-route wording and behaviour, the "Route it" actions, Needs you items for genuinely unrouted forms, the Audience dashboard (APPROVED-FROZEN §28)
ACCEPTANCE_CRITERIA: an owner attaches one form to a campaign that names a pipeline; with no route of its own, the form's card, panel and Analytics row read "Campaign: <pipeline> → <stage>"; a prospect submits it and the opportunity opens in that pipeline's first open stage
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Overview/Analytics own and default route tests unchanged and passing; the processor (growth-process-submission) unchanged; S1a proof (campaign_lead_attribution.sql) still passes

INTERNAL_BUILD_IDENTITY: 5cf68c6767b5a62367f5b7bf75886a59ebeacfc9; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271026100000 is applied by deploy-migrations on merge, production readback after merge); edge=PROOF_OWED(description strings in _shared/paige-spine/domains/campaigns.ts redeploy the functions that import it on merge, edge-live readback after merge); evidence=scripts/live-drive/campaign-route-drive.mjs
RELEASE_CHANNEL: development: production on merge (pre-launch, §4)
RELEASE_CLASSIFICATION: internal-only: routing and wording inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: routing and screens ship; authenticated drive PROOF OWED; PAIGE's lead-funnel chat read reads one pipeline (#2077, INT-346)
RELEASE_RECOVERY: position=a forward migration restoring the 20271021042001 definitions (the rule function then unused) and reverting the screens; reference=this record
