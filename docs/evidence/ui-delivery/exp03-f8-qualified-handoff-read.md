# UI delivery evidence: Experience 03 F8 — what became of each opportunity

Experience 03 (Grow My Business), journey F8 "Progress to customer" and the owner's October-26 execution
command ("Complete F8's qualified-handoff read surface within your existing lane"). The qualified handoff
reads Sales' own records for each opportunity a campaign was credited with: who in Sales holds it, its stage
and status as they stand, its invoices as raw counts, and Sales' own close date when it is won. What the
records do not link is said out loud: agreements and booked calls are not linked to opportunities today, so
neither shows — and nothing here invents a deal, appointment, attendance, sale or delivered handoff.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: WAIVED: owner-decision=AGENTS.md mandatory routing with the #1280 waiver grammar; reason=the Flow-by-Flow skill is not installed in this agent environment, and the incumbent Brought-in flow (journey §9 S1d, the owner-approved collapsed disclosure) extended below carries the flow reading instead
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md and reference/craft-floor.md read this session — Operate mode, refinement-preserves: one additional text line per existing row in the owner-approved disclosure (the incumbent cl-via pattern), copy names the fact and its absence ("no one in Sales yet", "no invoice yet"), no layout, chrome, motion or token change, no craft-floor ban touched
MATERIAL_FLOW_CHANGE: NO: no new flow, state, transition or exit — the existing lead rows gain truthful facts Sales already recorded
FLOW_PROTOTYPE: NOT_REQUIRED: MATERIAL_FLOW_CHANGE is NO and the surface extends the owner-approved 2026-10-12 collapsed-leads design
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the Solo owner opening a campaign's leads sees where each opportunity stands and who holds it, without leaving the campaign; the primary action stays "open Sales", which owns the records
VISUAL_DIRECTION: PASS: the incumbent row classes and the desk's state palette — no new identity, color or type decision
AUTOMATED_EVIDENCE: PASS: src/solo/useCampaignLeads.test.tsx 31/31 — a new parser case (the recipient and invoice counts read when the server sends them; the name absent when it does not) and a progressLine block (who holds it or that no one does, only for an owner or admin; raw invoice counts including the partly-paid form; a won deal with the close date; nothing said for a lead with no opportunity; never the words agreement or booked) — mutation-checked: ungating the recipient phrase so a member would see "no one in Sales yet" fails the member case; supabase/tests/campaign_lead_attribution.sql F8 additions: the admin reads the recipient's name, the deal's two invoices with one paid, and no close date while open; a member reads the invoice counts but never the recipient; the agency manager in the sub-account likewise; and once Sales marks the deal won, the close date reads beside it as the date Sales recorded (the column is a date) before the fixture returns to open for the later blocks
STATIC_EVIDENCE: PASS: tsc reports nothing in the changed files; the read migration is mechanically derived from the incumbent in 20271025100000 (the sole definition, checked) with a proven diff of exactly four additions — the owner and close date in the lead CTE, the invoice lateral, the row fields, the profiles join
RENDERED_EVIDENCE: UNVERIFIED: no browser session in this environment — the line is the incumbent text pattern inside behaviorally pinned rows, with the rendered matrix owed below
BEHAVIORAL_EVIDENCE: PASS: the suite mounts the real Brought-in disclosure through the real parser; the pgTAP drives the real intake writer, the real read and real invoices as service-created records, and the cross-workspace and member refusals are the incumbent block's own
AUTHENTICATED_RUNTIME: UNVERIFIED: a signed-in owner's campaign with a real opportunity and invoice is owed at the next authenticated pass
KEYBOARD_FOCUS: PASS: no interactive element added; the disclosure and its focus behavior are the incumbent's
ZOOM_REFLOW: NOT_APPLICABLE: no layout change — one text line in an existing row that already wraps
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: open with and without a recipient, one and several invoices (paid, partly paid, none), won with Sales' close date, lost, no opportunity (nothing said), member (counts but never names), read failure (the incumbent retry), and the missing-links note stated once for every viewer
TRUTHFUL_STATE_LABELS: PASS: every fact is Sales' own record read as it stands — no causal claim that the campaign won it, no valuation, and the two things the records do not link (agreements, booked calls) are said in one sentence instead of implied
SOLO_UI: YES: Campaigns › dossier › Brought in › the leads (src/solo/campaign-leads.tsx, useCampaignLeads.ts, campaign-composition.tsx untouched)
UNVERIFIED: the rendered/browser matrix including the four Solo viewports, the authenticated owner view of a real opportunity with its recipient and invoices, production migration readback at release, and the founder run of the joined journey — none claimed complete by this record

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta

OWNER_INTENT: the October-26 execution command: complete F8's qualified-handoff read surface within the existing lane, making source, qualification, recipient, current status, missing information, refusal and recovery clear, without inventing a deal, appointment, attendance, sale or delivered handoff
MUST_NOT_HAPPEN: no name shown to a member or an agency manager in a sub-account — no invented link to an agreement or a booked call — no valuation of a deal or claim of revenue — no causal claim that a campaign won or converted anything — no writer, scheduler or CRM change
MUST_PRESERVE: the incumbent Brought-in counts, rows, disclosure behavior and copy; the read's existing authority, cross-workspace refusal and redaction; the S1e chat read untouched
ACCEPTANCE_CRITERIA: an owner opens a campaign's leads and, on each row with an opportunity, sees who in Sales holds it (or that no one does), its stage and status, its invoices as counts, and the close date when won; a member sees the same facts minus names; the disclosure says once that agreements and booked calls are not linked yet
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: get_campaign_brief_leads's existing shape (additive keys only, so the S1d-2 rows and the S1e chat read consume it unchanged); the deals, invoices and profiles stores (read only); the incumbent Brought-in tests

INTERNAL_BUILD_IDENTITY: 85440e9bf1e1a69c3ed15cb8878eede594bdef42; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271116010000_exp03_f8_progress_read awaits review CI and the normal production pipeline); edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp03-f8-qualified-handoff-read.md
RELEASE_CHANNEL: development: source release, production on merge (pre-launch, §4)
RELEASE_CLASSIFICATION: internal-only: a read surface inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release at this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source, behavioral and database proof complete once the spine run is green — the rendered matrix, authenticated runtime, production migration readback and founder acceptance remain separately owed
RELEASE_RECOVERY: position=reviewed forward release on green CI with the normal deploy-migrations persisted-apply readback; reference=docs/doctrine/release-governance-and-customer-update-policy.md
