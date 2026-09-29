# UI delivery evidence: a form's intake settings and submissions in the Catalog drawer (PR 2b)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: frame before edits — mode Build (extension of an existing surface), depth Standard, actor Solo owner or admin and Solo member on Growth → Catalog → a published form → Details; flows: set pipeline → stage and alert address → save → saved; turn routing off; clear the address; malformed address refused before sending; server refusal shown; read each visitor's answers; open the resulting contact and deal; page through older submissions; first use with nothing submitted and no pipeline
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode — extends the existing Catalog Details drawer and inherits the Solo world (tokens, pills, buttons, drawer); owner-approved frames (2026-09-29) built as drawn; craft floor read before edits
MATERIAL_FLOW_CHANGE: YES: the form Details drawer gains the intake section and the submissions list; the "Routing contract: Configured / Not configured" row is replaced by the actual pipeline, stage and alert settings it summarised
FLOW_PROTOTYPE: PASS: rendered design frames of every state (owner light and dark, unsaved invalid edit, member, first use, 390 px) sent to the owner and approved in session on 2026-09-29 ("approved") before the build
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo business owner decides where a form's leads go and reads what each visitor typed; primary action is Save changes
VISUAL_DIRECTION: PASS: Solo tokens only (surface, line, ink, violet for state, ok/warn/bad pills); no gold; violet switch for state; reduced-motion (harness: switch transition 1e-05s under reduce) and forced-colors handled
AUTOMATED_EVIDENCE: PASS: npx vitest run src/solo/form-intake.test.tsx src/solo/growth2.render.test.tsx — 44/44; npx vitest run src/solo — 133 files, 2,167 tests passed; the new tests were shown failing by reinstating main's growth2.tsx (drawer wiring: 2 fail), dropping the tenant filter (scope: 1 fail), dropping option labels / the removed-field note / the deal lookup (answers: 1 fail), and removing validation plus the member gate (2 fail)
STATIC_EVIDENCE: PASS: npx tsc --noEmit -p tsconfig.app.json clean for every changed file; npx eslint clean; lint:tier-features, lint:skeleton, lint:solo-parity, lint:alias-ratchet, lint:shadow-vars, lint:pg-tokens pass; lint:gold fails only on the pre-existing BusinessCreditDashboard.tsx:271; lint:impeccable reports the same 87 findings with and without this change, none in lines it adds
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/form-intake-settings/owner-1280-light.png, docs/evidence/ui-delivery/assets/form-intake-settings/owner-1280-dark.png, docs/evidence/ui-delivery/assets/form-intake-settings/editing-invalid-1280-light.png, docs/evidence/ui-delivery/assets/form-intake-settings/member-1280-light.png, docs/evidence/ui-delivery/assets/form-intake-settings/empty-1280-light.png, docs/evidence/ui-delivery/assets/form-intake-settings/owner-390-light.png — the real FormIntakePanel with the real Solo CSS in Chromium on a local Vite build, its Supabase reads and the save RPC answered by Playwright with synthetic, production-shaped rows (no real business, person or address)
BEHAVIORAL_EVIDENCE: PASS: Playwright drove the built panel: a malformed address was refused with "Enter a full address, like name@yourbusiness.com." and no request; a valid address plus a new stage sent growth_form_set_intake with {p_form_id, p_auto_create_deal: true, p_pipeline_id, p_stage_id: "s-call", p_notify_email} and showed "Saved"; no horizontal overflow and no page errors at 1280 or 390 px in any state
AUTHENTICATED_RUNTIME: UNVERIFIED: owed after merge — an owner saving a form's settings on production and the saved row read back; this sandbox has no authenticated production session
KEYBOARD_FOCUS: PASS: harness keyboard route from the close button: switch → pipeline → stage → email → first submission's summary → its first button; the drawer's focus trap now includes each submission's summary; switch is a real button with role switch and aria-checked; errors are tied to the field with aria-describedby and aria-invalid
ZOOM_REFLOW: PASS: 390 px renders without horizontal scroll; chips wrap
REDUCED_MOTION: PASS: switch and chevron transitions are removed under prefers-reduced-motion
STATE_COVERAGE: PASS: loading (skeleton), read failed (retry), form missing, owner editable, member read-only, routing off, no pipeline yet, unsaved, saving, saved, refused by server, malformed address, submissions: processing, lead created, in pipeline (named from the deal when loaded, else "In pipeline"), alert emailed, alert withheld with the reason, needs attention, left-blank answer, answer to a field no longer on the form, no submissions, more to load
TRUTHFUL_STATE_LABELS: PASS: "Saved" only after the server returns the saved row; a refusal shows the server's own sentence; chips come from the submission's recorded columns, never inferred
SOLO_UI: YES: Growth → Catalog → a published form → Details (src/solo/growth2.tsx, src/solo/form-intake.tsx, src/solo/form-intake-model.ts, src/solo/useFormIntake.ts, src/solo/solo-campaigns.css)
SOLO_1536X770_PAIGE_CLOSED: PASS: solo-1536x770-paige-closed.png — structural harness (scripts/live-drive/harness/form-intake-mount, real GrowthHub and drawer, stubbed reads; labelled "harness render · not live"): document overflowX 0, drawer inside the viewport, drawer body scrolls, last submission reachable, body overflowX 0
SOLO_1536X770_PAIGE_OPEN: PASS: solo-1536x770-paige-open.png — same measurements; the drawer is fixed to the right edge and covers the PAIGE dock while open, as it already does in the app
SOLO_1366X768_PAIGE_CLOSED: PASS: solo-1366x768-paige-closed.png — same measurements
SOLO_1366X768_PAIGE_OPEN: PASS: solo-1366x768-paige-open.png — same measurements; dark-1366x768-paige-open.png in dark with the same measurements
SOLO_1024X768_PAIGE_CLOSED: PASS: solo-1024x768-paige-closed.png — same measurements
SOLO_1024X768_PAIGE_OPEN: PASS: solo-1024x768-paige-open.png — same measurements
SOLO_900X1000_PAIGE_CLOSED: PASS: solo-900x1000-paige-closed.png — same measurements
SOLO_900X1000_PAIGE_OPEN: PASS: solo-900x1000-paige-open.png — same measurements
UNVERIFIED: an owner saving a form's settings on the production app and the saved row read back, and a real visitor submission appearing in the drawer (PR 3) — this sandbox has no authenticated production session and no submission has been made on production yet

OWNER_INTENT: the owner sets each form's pipeline, stage and alert address, and sees exactly what each visitor submitted, with links to the resulting contact and deal
MUST_NOT_HAPPEN: a member changing where leads or alert emails go; success shown for a save the server refused; answers from another form or another workspace; a visitor able to read the alert address
MUST_PRESERVE: the Catalog drawer for pages and funnels unchanged; the drawer's close, Escape, focus return and workspace-switch behaviour; the existing ?person= and ?deal= deep links
ACCEPTANCE_CRITERIA: an owner opens a published form's Details, chooses a pipeline and stage and an alert address, saves, sees "Saved", and sees each submission's answers with links to the contact and the deal
PROTECTED_SEAMS: growth_form_set_intake() is the only write (owner/admin re-checked on the server); reads are the growth_forms row and growth_form_submissions for that form, filtered by workspace and scoped by RLS; the public read growth_public_form() is unchanged and returns no address or ids beyond the form's own

INTERNAL_BUILD_IDENTITY: 9d2dd0cc4a6fdc3cae1fef15e1def0cea8eb029f plus this PR; deployment=local-vite-dev-server; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/assets/form-intake-settings
RELEASE_CHANNEL: development: verified on a local build before merge; production deploy follows the merge to main through Vercel
RELEASE_CLASSIFICATION: internal-only: owner surface completing public form intake, no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: no customer release is being published
RELEASE_NOTE_REQUIRED: NO: internal-only work with no customer release
RELEASE_TRUTH_BOUNDARY: PARTIAL: the surface ships on merge; an owner saving it on production and a real submission (PR 3) are owed
RELEASE_RECOVERY: position=revert the PR merge commit on main; reference=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/1580

## Scope and collisions

- Classification: Solo owner and admin (edit), Solo member (read); the form's own workspace only.
- Affected flow: Growth → Catalog → a published form → Details.
- Deleted: the form drawer's "Routing contract: Configured / Not configured" row, replaced by the settings it summarised (the page and funnel drawers keep their rows).
- Owner ruling recorded 2026-09-29: forms, pages and funnels will share one publish lifecycle (unpublished in Vibe Studio, published in the Catalog). This PR does not change which forms the Catalog lists; that work follows owner approval of its frames.
