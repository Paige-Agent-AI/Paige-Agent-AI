# UI delivery evidence: Experience 03 S1d-1 — the campaign map's Brought in lane

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §6 and §9
(Linear ANT-51 / ANT-147). Backend: PR #2068 (migration `20271025100000`, read `get_campaign_brief_leads`).
The per-lead list (S1d-2) is a separate slice held for an owner ruling; it is not in this change.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet is the journey record §3–§6 and §9 (flow F6 "Report verified lead": actor Solo owner/admin or member, entry Marketing › Campaigns › Open dossier, exit close dossier or "see them in Sales"; states loading, populated, member, no leads with a form, no leads and no form, read failed)
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md and Impeccable (Operate mode, refinement of the incumbent dossier) and reference/craft-floor.md before the first UI edit
MATERIAL_FLOW_CHANGE: YES: the campaign map gains its third lane, Brought in (leads credited, opportunities, revenue routed to Sales), and the Recorded outcome stage moves from Not available to Partly available
FLOW_PROTOTYPE: PASS: the Brought in lane is part of the owner-approved prototype v2 (record copy docs/prototypes/int342-marketing-convergence.html, "Campaign map": Reach → Land → Brought in), approved 2026-10-10 per docs/product/int342-marketing-convergence.md line 3; two disclosed wording changes, both to stay true: "leads tagged CB-…" becomes "leads credited to this campaign" (since #2068 the campaign's form credits leads too, so "tagged" would undercount) and "see them in Sales" becomes "open Sales" (Sales is not filtered to a campaign, so the owner could not "see them" there)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner opening a campaign sees how many leads it brought in and how many became opportunities, and opens Sales to work them; read-only, no act
VISUAL_DIRECTION: PASS: the approved map's outcome lane in the incumbent lane grammar (cc-lane, cc-h, cc-row frame): counts lead at 18px/700 tabular figures, labels quiet, revenue row dashed and unfilled because it is a pointer, not a value; tokens only; no gold
AUTOMATED_EVIDENCE: PASS: src/solo/useCampaignLeads.test.tsx 16/16 and src/solo/growth2.render.test.tsx + campaign-briefs.contract.test.tsx 88/88 (local, 2026-10-12); mutation-checked, each fails a test: counting listed rows instead of the server total; hiding the uncredited disclosure; routing to the wrong surface; removing the stale-read guards; dropping focus on retry; ignoring archived campaigns; treating a draft form as live; letting Recorded outcome make a bare brief "Live-backed" in the portfolio Source filter. Full unit suite 12,142 passed / 0 failed vs base 12,125 / 0
STATIC_EVIDENCE: PASS: eslint clean on the changed files; tsc on the app project reports nothing in the changed files
RENDERED_EVIDENCE: PASS: scripts/live-drive/brought-in-drive.mjs through the real GrowthHub (marketing-mount harness, only the leads read stubbed): 594/594 checks, 9 frames x 5 states x 2 themes; frames in scripts/live-drive/artifacts/brought-in (gitignored)
BEHAVIORAL_EVIDENCE: PASS: the drive opens the Spring campaign's dossier from the Campaigns list and reads the lane in every state; Try again and "open Sales" are reached by keyboard; the route to Sales, the portfolio Source filter and focus after retry are unit/render-tested; the server rules behind the counts are proven by supabase/tests/campaign_lead_attribution.sql (database-contract). Independent non-author review: FIX-FIRST (2 MAJOR, 6 MINOR, 4 NIT), all MAJOR and MINOR fixed in this PR
AUTHENTICATED_RUNTIME: UNVERIFIED: the canonical QA account (PC-1, ANT-21) needs Auth/admin repair and a runner credential before any signed-in drive; no production lead exists yet (0 submissions)
KEYBOARD_FOCUS: PASS: both controls ("open Sales", Try again) are reached by Tab and show a 2px violet ring, measured after transitions settle (--violet, because the shell's --ring holds bare HSL, issue #2070); pressing Try again moves focus to the lane's heading instead of dropping it to the page
ZOOM_REFLOW: PASS: reflow proven at 900px and 390px content widths (nothing clipped or pushed, no sideways scroll); 200% zoom of a 1366 viewport (683 CSS px) falls between them
REDUCED_MOTION: PASS: the lane adds no motion; frames rendered with reducedMotion: reduce
STATE_COVERAGE: PASS: loading (skeleton; never another campaign's counts), populated owner, member, no leads with a live form, no leads and no live form, archived campaign (its forms no longer credit it), read failed with retry (no zero drawn for a read that failed); singular and plural; Sales link hidden at zero opportunities; leads that fit two campaigns disclosed, with or without credited leads
TRUTHFUL_STATE_LABELS: PASS: counts are the server's over every credited lead, never the listed rows; revenue is never valued here ("Revenue lives in Sales"); Recorded outcome reads Partly available with "Revenue isn't credited to campaigns yet."; Launch readiness' attribution row now agrees with the lane (form or tag at arrival) and says Analytics' per-campaign figure is still tag-only
SOLO_UI: YES: Marketing › Campaigns › campaign dossier › What this campaign uses (src/solo/campaign-composition.tsx, src/solo/campaign-desk.tsx)
UNVERIFIED: authenticated runtime on production (PC-1 blocked); real leads (none exist yet)

SOLO_1536X770_PAIGE_CLOSED: PASS: light/dark-1536x770-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1536X770_PAIGE_OPEN: PASS: light/dark-1536x770-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_CLOSED: PASS: light/dark-1366x768-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_OPEN: PASS: light/dark-1366x768-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_CLOSED: PASS: light/dark-1024x768-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_OPEN: PASS: light/dark-1024x768-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_CLOSED: PASS: light/dark-900x1000-paige-closed-*.png, all five states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_OPEN: PASS: light/dark-900x1000-paige-open-*.png, all five states, no overflow, contrast >= 4.5:1

OWNER_INTENT: an owner sees what a campaign brought in, verified at the source (Experience 03 first slice: "PAIGE reports the verified lead and its attribution")
MUST_NOT_HAPPEN: no fabricated count; no revenue figure; no names anywhere in the lane; no gold; no act that contacts a lead or moves an opportunity
MUST_PRESERVE: the Reach and Land lanes' behaviour, Steps and results, Source-linked evidence, the dossier's actions, and the portfolio Source filter (a bare brief stays under "No live source"; render-tested); disclosed changes: Launch readiness' attribution row (Not available → Partly available, wording matched to the lane) and the dossier's quiet lines (.dw .cc-foot, .dw .cc-empty, .cc-h span) from --ink-3 (4.15:1 on the light surface, under AA) to --ink-2; Calendars reuses .cc/.cc-empty and is not affected
ACCEPTANCE_CRITERIA: an owner opens a campaign with a form attached; a prospect submits it; the lane counts one lead credited to the campaign and, once Sales files it, one opportunity with a route to Sales
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: growth2.render.test.tsx (the dossier's other sections, plus a new Source-filter test) passes with the leads hook doubled; campaign-briefs.contract.test.tsx updated on purpose for the Recorded outcome stage; Audience and Overview not touched; the harness stub matcher now ignores Vite's ?t= query (it had silently loaded the real client after a file change)

INTERNAL_BUILD_IDENTITY: f2bc5656b22c11a8413e3b17988924d5fd29f90d; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/brought-in-drive.mjs
RELEASE_CHANNEL: development: production on merge (pre-launch, §4)
RELEASE_CLASSIFICATION: internal-only: a read-only lane inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: lead credit at arrival ships with #2068; this lane is PROOF OWED until authenticated drive; revenue attribution UNAVAILABLE
RELEASE_RECOVERY: position=revert the lane's mount in campaign-composition.tsx; reference=this record
