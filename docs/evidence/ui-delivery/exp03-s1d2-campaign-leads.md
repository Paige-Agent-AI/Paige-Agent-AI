# UI delivery evidence: Experience 03 S1d-2 — the leads from this campaign

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §9 (S1d-2).
Reads the existing `get_campaign_brief_leads` (migration `20271025100000`, S1a); no backend change. The proof
`supabase/tests/campaign_lead_attribution.sql` gains the agency-manager case (block 3b2).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet is the journey record §6 and §9 S1d (flow F5 "see what a campaign brought in": actor Solo owner/admin, member, or an agency manager working in the sub-account; entry Campaigns › a campaign's dossier › Brought in; exit the newest leads with how each was credited and where it stands in Sales); states: owner open/closed, member open, unnamed lead (being saved / not saved), several pipelines, truncated, no leads, read failed
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md and Impeccable (Operate mode, a disclosure under an approved summary) and reference/craft-floor.md before the first UI edit
MATERIAL_FLOW_CHANGE: YES: the approved Brought in lane gains a collapsed "Show the N newest leads" disclosure listing each lead (who where the viewer may see it, when, how it was credited, which form, its stage)
FLOW_PROTOTYPE: PASS: the owner explicitly approved the reviewed design on 2026-10-12 ("The owner explicitly APPROVES the proposed collapsed 'Leads from this campaign' list (S1d-2) … No further owner-design approval is required for that design"), from the rendered review sheet of owner light/dark open and closed, member open and phone frames; the shipped rows match that sheet
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner sees which people a campaign brought in and where each stands; read-only, the primary action stays "open Sales" in the lane above
VISUAL_DIRECTION: PASS: rows on --surface-2 with --line-soft hairlines, the desk's state palette for status (no gold, §11), quiet text on --ink-2 (the --ink-3 shortfall is #2073), a violet focus ring on the toggle; tokens only
AUTOMATED_EVIDENCE: PASS: src/solo/useCampaignLeads.test.tsx gains 8 render tests (closed until asked with aria-expanded/aria-controls; owner names with one pipeline named once; member gets no names because the server sent none; unnamed leads; per-row pipeline when several; truncation note against the server count; rows read only; no list with no leads), 24/24 — mutation-checked: a member shown an owner's wording, the list open by default, and the pipeline repeated on every row each fail tests; supabase/tests/campaign_lead_attribution.sql block 3b2: an agency owner acting inside the sub-account reads counts and stages with no names or ids (mutation-checked: admitting agency managers to the admin branch fails it)
STATIC_EVIDENCE: PASS: eslint clean on the changed files; tsc reports nothing in the changed files
RENDERED_EVIDENCE: PASS: scripts/live-drive/brought-in-drive.mjs through the real GrowthHub (marketing-mount harness, only the leads read stubbed): 1008/1008 checks, 9 frames x 7 states x 2 themes (adds the list opened by an owner and by a member); a member shown an owner's wording fails 36 checks (it bites); frames in scripts/live-drive/artifacts/brought-in (gitignored)
BEHAVIORAL_EVIDENCE: PASS: the drive opens the list from the keyboard (Tab to the toggle, Enter) and checks 7 rows, aria-expanded true and the controlled region present; the rows carry no button, link or input; the server's redaction is proven for a member (3b) and an agency manager in a sub-account (3b2), and another workspace is refused (3c)
AUTHENTICATED_RUNTIME: UNVERIFIED: the canonical QA account (PC-1, ANT-21) needs Auth/admin repair and a runner credential before any signed-in drive; production has no credited lead yet
KEYBOARD_FOCUS: PASS: the toggle is reached by Tab with a 2px violet ring (measured after transitions settle) and opens with Enter; the rows are not focus stops (read only)
ZOOM_REFLOW: PASS: rows restack to one column below 480px; reflow at 900px and 390px content widths with nothing spilling from the dossier
REDUCED_MOTION: PASS: no motion; the list appears without animation
STATE_COVERAGE: PASS: closed, open (owner), open (member), unnamed lead being saved or not saved, one pipeline and several, truncated at 200, no leads (no toggle), read failed (no toggle)
TRUTHFUL_STATE_LABELS: PASS: names come only from the server (null for members and agency managers in a sub-account); a member is told owners and admins see who; "Being filed" and "Couldn't be filed" read the processing state; a truncated list says the counts cover all; nothing values a deal
SOLO_UI: YES: Campaigns › dossier › Brought in (src/solo/campaign-leads.tsx, campaign-composition.tsx, useCampaignLeads.ts, solo-campaigns.css)
UNVERIFIED: authenticated runtime on production (PC-1 blocked); a real credited lead (none exists yet)

SOLO_1536X770_PAIGE_CLOSED: PASS: light/dark-1536x770-paige-closed-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_1536X770_PAIGE_OPEN: PASS: light/dark-1536x770-paige-open-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_CLOSED: PASS: light/dark-1366x768-paige-closed-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_1366X768_PAIGE_OPEN: PASS: light/dark-1366x768-paige-open-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_CLOSED: PASS: light/dark-1024x768-paige-closed-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_1024X768_PAIGE_OPEN: PASS: light/dark-1024x768-paige-open-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_CLOSED: PASS: light/dark-900x1000-paige-closed-*.png, all seven states, no overflow, contrast >= 4.5:1
SOLO_900X1000_PAIGE_OPEN: PASS: light/dark-900x1000-paige-open-*.png, all seven states, no overflow, contrast >= 4.5:1

OWNER_INTENT: an owner sees the people a campaign brought in and where each stands, without leaving the campaign (Experience 03: "monitoring and recommendations"; owner approval 2026-10-12)
MUST_NOT_HAPPEN: a member or an agency manager in a sub-account shown a name or record id; a name filled in on the screen that the server did not send; a row that contacts a lead or moves an opportunity; the lane's counts recomputed from the listed rows
MUST_PRESERVE: the approved Brought in lane (counts, "open Sales", revenue in Sales, the notes), its error and empty states, the S1a server read and its grants
ACCEPTANCE_CRITERIA: an owner opens a campaign's dossier, presses "Show the 7 newest leads" and sees each lead's name, date, credit, form and stage; a member sees "A lead" with the same dates and stages and is told owners and admins see who
MOTION_PURPOSE: NONE: no motion
PROTECTED_SEAMS: the Brought in lane's existing render tests and its 5 drive states pass unchanged; get_campaign_brief_leads unchanged

INTERNAL_BUILD_IDENTITY: branch claude/stoic-archimedes-pv4r8u; deployment=none-pre-merge; environment=development; migrations=none; edge=none; evidence=scripts/live-drive/brought-in-drive.mjs
RELEASE_CHANNEL: development: production on merge (pre-launch, §4)
RELEASE_CLASSIFICATION: internal-only: a read-only view inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: the list ships and is proven rendered and server-redacted; authenticated drive PROOF OWED
RELEASE_RECOVERY: position=revert the four UI files (the read is unchanged); reference=this record
