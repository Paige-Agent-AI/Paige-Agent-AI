# UI delivery evidence: Solo Marketing › Email — dashboard and campaign editor (E2)

The owner asked for Email next, to his reference image of 2026-10-04 ("this is the direction I want to go with
email, with all of this inclusive"), designed with Impeccable and built into PAIGE's real capabilities. E1 (#1700,
merged and confirmed live the same day) is the backend: campaigns, frozen versions, one bounded approval and a
durable dispatcher. E2 is the screen on it: the dashboard and the editor where a campaign is written, addressed,
previewed, sent for approval, approved, watched and read back.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flows - (1) owner reads how marketing email is doing over 7/30/90 days; (2) owner starts a campaign, newsletter, welcome or re-engagement and lands in its editor; (3) owner writes, addresses and previews it, sends it for approval, approves it, and watches it send; (4) owner declines or changes a version awaiting approval; (5) owner fixes a paused send and tries again; (6) owner saves, edits, deletes and emails a segment. Regression map - Marketing tab strip, Audience (frozen, untouched), Content (still lists saved email copy), the Drafts batch approve guard from E1, growth2 routing, the shared chart file used by Overview and Audience
PAIGE_UI_DESIGN: PASS: Impeccable read (SKILL.md, routing, craft-floor, operate) before the UI edits; Operate mode; the reference image is the pinned brief, so its icon tiles stand; one accent spent on the act (gold on Approve and send only); token-only colours; no eyebrows, no gradient text
MATERIAL_FLOW_CHANGE: YES: the Email tab changes from a read-only summary of saved copy to a dashboard and a full campaign editor with sending through the one bounded approval
FLOW_PROTOTYPE: PASS: the owner's reference image of 2026-10-04 is the approved direction; rendered frames of the dashboard, editor, segment drawer and first use are shown with this PR for his live review
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner or admin; primary action is starting a campaign, then Review and send and Approve and send
VISUAL_DIRECTION: PASS: the Marketing Overview/Audience card and panel system (mo-*), extended as me-*; violet for selection and focus, gold only for approval; light and dark
AUTOMATED_EVIDENCE: PASS: marketing-email-model.test.ts, email-markup.test.ts (includes a parity test that the editor's preview renders byte-for-byte what email-campaign-worker sends), marketing-email.render.test.tsx (views driven through their RPCs: dashboard read and period, create and open, re-engagement starting audience, refused create, autosave then Review and send calling save then request approval, Approve and send, refusal words). editor leave-while-unsaved (Back saves first; unmount saves; the browser asks before closing), segment in use refused, drawer Tab trap, sender arrow keys; the worker renderer closes open tags and drops hidden elements (style, textarea, title, script, link). Reinstated defects (no save before review; a changed refusal sentence; a drifted footer; no save on leave; no Tab trap; the old comment-only renderer) each failed. Full vitest: count recorded in the PR
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main; lint:definer-fns and lint:migration-versions pass; lint_migrations passes on 20270550000000; production build passes
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-views-drive.mjs 1780/1780 - every Marketing tab at 1536x770, 1366x768, 1024x768 and 900x1000, PAIGE docked, expanded and closed, light and dark, plus first-use, loading, error and read-only states; Email asserts five figures, six ways to start, the campaigns table and the drawn rate chart; worst Email small-text contrast 6.03:1 (the drive caught two type chips under AA, fixed); overflow 0 everywhere
BEHAVIORAL_EVIDENCE: PASS: harness clicks (segment drawer opens from a segment row; editor opens from ?campaign=); jsdom drives of create, autosave, review, approve and refusals
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the owner's live look at /solo/{account}/growth/email is owed, and a real send is owed until he sends one
KEYBOARD_FOCUS: PASS: every control is a native button, input, textarea or link with the violet focus ring; chips use aria-pressed; senders are a radio group with one tab stop and arrow keys that choose; the segment drawer is role=dialog aria-modal, focuses its first field, keeps Tab inside, closes on Escape and returns focus to the opener
ZOOM_REFLOW: PASS: figures 5 to 3 to 2 to 1 columns by container width; panels 2 to 1; editor form and preview side by side then stacked with the preview un-stuck; table scrolls inside its own region
REDUCED_MOTION: PASS: tile lift, chip and drawer transitions and the progress bar are off under prefers-reduced-motion; charts honour it
STATE_COVERAGE: PASS: loading skeleton, read error with Try again, first use (no sends: rates "—" and why; postal address missing banner), populated, member refused (database refusal shown in words), campaign states draft / new draft after a send / awaiting approval / scheduled / approved waiting to send / sending / sent / partly sent (failed and not confirmed counted apart) / not sent / paused / cancelled, declined-version note, not found, unsaved changes on leave
TRUTHFUL_STATE_LABELS: PASS: rates only over email that reports opens and the rest named; no rate on a day with nothing sent; comparisons only when an earlier period had something; conversions exactly the owner's 7-days-after-a-click rule, a contact counted once, cancelled bookings excluded; cost labelled an estimate and under a cent reads "less than $0.01"; PAIGE prompts say she cannot save or send campaigns yet; Automations says series are built next
SOLO_UI: YES: Solo Marketing › Email, /solo/{account}/growth/email

SOLO_1536X770_PAIGE_CLOSED: PASS: content column 1320px, light and dark, overflow 0, all assertions
SOLO_1536X770_PAIGE_OPEN: PASS: docked 797px and expanded 521px, overflow 0, all assertions
SOLO_1366X768_PAIGE_CLOSED: PASS: content column 1150px, overflow 0
SOLO_1366X768_PAIGE_OPEN: PASS: docked 685px and expanded 439px, overflow 0
SOLO_1024X768_PAIGE_CLOSED: PASS: content column 952px, overflow 0
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: content column 828px, overflow 0
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: the owner can see how his marketing email is doing and send a campaign himself, from writing to approved to sent to results, with PAIGE able to do the same (owner, 2026-10-04, reference image and architecture rulings)
MUST_NOT_HAPPEN: a send without the one approval; approving a version other than the one shown; a sender switched silently; a rate presented as measured when it was not; another business's campaign or figures shown; Audience changed (frozen)
MUST_PRESERVE: Audience as approved; Content listing saved email copy; Drafts batch approve leaving campaign sends alone; every other Marketing tab's render and figures
ACCEPTANCE_CRITERIA: on the live app the owner opens Email, creates a campaign, writes it, sees the preview with his postal address, sends it for approval, approves it, and sees it sending and then its results
MOTION_PURPOSE: tile lift on hover says the tile is a door; the drawer slides from the edge it lives at; the progress bar moves with sends; all off under reduced motion
PROTECTED_SEAMS: tested - every Marketing tab in the drive, Drafts batch approve test, worker renderer parity, E1 functions corrected here (sender cost and route for a Resend connection, the not-contacted rule, segment in use) proven on production in a rolled-back transaction; unaffected and named - Audience (frozen file unchanged except an import of its exported labels), Overview charts (new export only)

INTERNAL_BUILD_IDENTITY: dd582794ace6da8eea322520efd124bc44a26ee5; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270550000000 applies through deploy-migrations.yml on merge after its rolled-back production proof passed); edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge it when green, then start the email dashboard")
RELEASE_CLASSIFICATION: internal-only: pre-launch Solo screen with a send path behind one approval, no customers yet
CUSTOMER_RELEASE_IDENTITY: none: pre-launch, no customers
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: dashboard and editor verified in the harness and jsdom; the reads verified on production in a rolled-back transaction; the signed-in screen and a real send owed
RELEASE_RECOVERY: position=revert the merge commit, the migration only adds three read functions; reference=git revert of this PR's merge
UNVERIFIED: the signed-in Email tab on production and a real provider send (no tenant login in this session); PAIGE's chat tools for email (E2b, next).

## Scope and collisions

- Classification: new Solo surface on an existing tab; read-only migration.
- Affected flows: the six above.
- Neighboring regressions: other Marketing tabs, Drafts batch approve, Audience.
- Active-owner/file collisions: none found on main at the time of writing.
- Explicit exclusions: PAIGE's chat tools for email (E2b); sequences (E3); the sub-account tree's Email screen.
- Moved, not removed (§58): the old Email tab's sender line (which address sends) now lives in the editor's From panel, which lists every connection and PAIGE's sender with its health, and the dashboard's Sending settings button opens Connections. The old tab's list of saved email copy is still on Content.

## Evidence index

- Frames (harness): dashboard light/dark, draft editor, awaiting approval, segment drawer, first use — attached to the PR conversation.
- `node scripts/live-drive/marketing-views-drive.mjs` → 1780/1780.
- Production proof (rolled back): see the PR. The segment guard was proven as a copy without its delete line, because this session's database tool waits for a confirmation on any statement containing a delete; the delete line itself is unchanged from E1.

## Review and limitations

An independent adversarial review of the diff runs before merge; its findings and fixes are listed in the PR.
