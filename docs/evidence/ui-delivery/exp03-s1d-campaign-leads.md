# UI delivery evidence: Experience 03 S1d — a campaign shows the leads it brought in

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §6 and §9
(Linear ANT-51 / ANT-147). Backend: PR #2068 (migration `20271025100000`, read `get_campaign_brief_leads`).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet is the journey record §3–§6 and §9 (flow F6 "Report verified lead": actor Solo owner/admin or member, entry Campaigns › Open dossier, exit close dossier; states loading, populated, member, empty with forms, empty without form, read failed)
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md and Impeccable (context run on src/solo/campaign-desk.tsx, Operate mode, refinement of the incumbent dossier) and reference/craft-floor.md before the first UI edit
MATERIAL_FLOW_CHANGE: YES: the dossier gains a new state the owner reads (who the campaign brought in and where each lead stands in Sales) and the Recorded outcome stage moves from Not available to Partly available
FLOW_PROTOTYPE: OWNER_DECISION_PENDING: rendered design review sent to the owner 2026-10-12 (scratchpad campaign-leads-design-review.png: owner light/dark/phone, member, both empty states, read failed); this record is finalized only after the owner's ruling
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner opening a campaign sees which leads it brought in, how each was credited and where each stands in Sales; read-only, no act
VISUAL_DIRECTION: PASS: the incumbent dossier grammar (dw-sec, cc-row rows, loop-state chips with the desk's st-* palette, never gold on a status); one tally line instead of metric tiles; tokens only
AUTOMATED_EVIDENCE: PASS: src/solo/useCampaignLeads.test.tsx 12/12 (mutation-checked: member name leak and pipeline-once each fail it); src/solo/growth2.render.test.tsx and the Marketing suites 129/129; full unit suite on the change 12,119 passed / 0 failed vs base 12,107 / 0 (local, 2026-10-12)
STATIC_EVIDENCE: PASS: eslint clean on the changed files; tsc ratchet baseline 10 = current 10; gold lint: the one violation (BusinessCreditDashboard.tsx:271) is pre-existing and identical on the base
RENDERED_EVIDENCE: PASS: scripts/live-drive/campaign-leads-drive.mjs through the real GrowthHub (marketing-mount harness, only the leads read stubbed): 576/576 checks, 9 frames x 5 states x 2 themes; frames in scripts/live-drive/artifacts/campaign-leads (gitignored)
BEHAVIORAL_EVIDENCE: PASS: the drive opens the Spring campaign's dossier from the Campaigns list and reads the section in every state; the error state's Try again is reached by keyboard and pressed; the server rules behind it are proven by supabase/tests/campaign_lead_attribution.sql (database-contract)
AUTHENTICATED_RUNTIME: UNVERIFIED: the canonical QA account (PC-1, ANT-21) needs Auth/admin repair and a runner credential before any signed-in drive; no production lead exists yet (0 submissions)
KEYBOARD_FOCUS: PASS: the only control (Try again) is reached by Tab and shows a 2px violet ring (measured after the .btn 150ms transition); the section is otherwise read-only text
ZOOM_REFLOW: PASS: reflow proven at 900px and 390px content widths (rows restack to one column, nothing clipped or pushed, no sideways scroll); 200% zoom of a 1366 viewport (683 CSS px) falls between them
REDUCED_MOTION: PASS: the section adds no motion; frames rendered with reducedMotion: reduce
STATE_COVERAGE: PASS: loading (skeleton), populated owner, member (names withheld), empty with forms attached, empty with no form, read failed with retry; lead states open-at-stage, won, lost, being filed, couldn't be filed, no contact yet; leads that fit two campaigns disclosed
TRUTHFUL_STATE_LABELS: PASS: counts are the server's; Recorded outcome reads Partly available with "Revenue isn't credited to campaigns yet."; a lead with no contact says so instead of reading as hidden
SOLO_UI: YES: Marketing › Campaigns › campaign dossier (src/solo/campaign-desk.tsx, src/solo/campaign-leads.tsx)
UNVERIFIED: authenticated runtime on production (PC-1 blocked); real leads (none exist yet)

SOLO_1536X770_PAIGE_CLOSED: PASS: light/dark-1536x770-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1536X770_PAIGE_OPEN: PASS: light/dark-1536x770-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_CLOSED: PASS: light/dark-1366x768-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_OPEN: PASS: light/dark-1366x768-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_CLOSED: PASS: light/dark-1024x768-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_OPEN: PASS: light/dark-1024x768-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_CLOSED: PASS: light/dark-900x1000-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_OPEN: PASS: light/dark-900x1000-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1

OWNER_INTENT: an owner sees the verified leads a campaign brought in and their attribution (Experience 03 first slice: "PAIGE reports the verified lead and its attribution")
MUST_NOT_HAPPEN: no fabricated count or credit; no names to members; no gold on status; no change to the Audience dashboard (APPROVED-FROZEN §28); no act that contacts a lead or moves an opportunity
MUST_PRESERVE: What this campaign uses, Steps and results, Launch readiness, Source-linked evidence and the dossier's actions, unchanged
ACCEPTANCE_CRITERIA: an owner opens a campaign with a form attached; a prospect submits it from a link tagged with the campaign's reference; the dossier shows that lead with "Campaign form, tagged link", its pipeline stage, and the tally counts it; a member sees "A lead" with the same stage
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: growth2.render.test.tsx (the dossier's other sections) passes with the leads hook doubled; campaign-briefs.contract.test.tsx updated on purpose for the Recorded outcome stage; Audience and Overview not touched

INTERNAL_BUILD_IDENTITY: 3eeddbb01259605edb8c245715b2adbf37f9ad02; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/campaign-leads-drive.mjs
RELEASE_CHANNEL: development: held for the owner's design ruling (§00)
RELEASE_CLASSIFICATION: internal-only: a read-only dossier section inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: lead credit at arrival is source-shipped with #2068; this view is PROOF OWED until authenticated drive; revenue attribution UNAVAILABLE
RELEASE_RECOVERY: position=revert the section's mount in campaign-desk.tsx; reference=this record
