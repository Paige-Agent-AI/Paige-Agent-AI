# UI delivery evidence: EXP03 Marketing › Email no longer promises a daily sending limit

Branch `worktree-agent-a55b63b75992b79b7`:
- 26fe2f10e: the database and chat change (migration then numbered 20271120140003).
- 99b7c9130: merge of origin/main f2ba3d6ff.
- 2c16883cb: the screens, the series approval card, the C0b renewal and the worker comment.
- 5631b9653: this record's first version and frames.
- 660eadac2: merge of origin/main 37244873a.
- c50895108: review fixes. The migration is renumbered `20271121120003` (above production's and main's `20271121110019` then), and before merge again to `20271121140003` (after EXP04's `20271121131304`, applied on production, and its reserved `131404`–`131604`). The claim is fair across businesses. The series "Ready to start" facts grid fits its three facts. Stale comments are corrected.
- 5a2b0b372: this record's update and the re-rendered frames.
- 2d44bd5dc: the migration-version lint also refuses a version older than main's newest (the B1 shape).
- 7th commit on `claude/great-heisenberg-u7kyd9`: round-3 review MAJOR. The fair claim keys on when a business was last claimed, not on its last successful send: a deferred, failed or outcome-unknown send writes no `sent_at`, so the first key could leave such a business first on every pass. A follow-up keeps the key across all of a business's campaigns (no status filter), so a small campaign claimed and settled in one pass still counts. Database and proof only; no screen changed, so the frames and the UI build identity below are unchanged.

Owner ruling 2026-10-27 (billing): each business's own usage is billed uncapped against a 25% contribution target, and PAIGE imposes no spending or sending stop. Once the database stopped enforcing 500 a day, every screen that still said "up to 500 a day" promised a limit that no longer existed. This change removes that copy. It adds no new element.

What a person sees change in Marketing › Email (Solo and Sub-account):

- **Dashboard footer.**
  - Was: "Up to 500 marketing emails a day through PAIGE’s sender; 352 left in the last 24 hours."
  - Now: "148 marketing emails sent or sending in the last 24 hours." This is the real count (`used_last_24h`), and it reads "1 marketing email" for one. The count covers every sender, which is why "through PAIGE’s sender" is gone.
- **Automations panel.** The note "Series share the 500-a-day limit with your campaigns. Series emails that don’t fit today wait; they’re never dropped." is removed.
- **Campaign editor.**
  - The audience warning "Today’s limit leaves room for N. Narrow the audience or send tomorrow." is removed.
  - The managed sender choice reads "PAIGE’s sender · opens and clicks reported" (it was "· up to 500 a day ·").
  - The over-limit refusal text is gone, because the database no longer raises it.
- **Series view.**
  - The "Daily limit" fact row on Ready to start is removed. Its three remaining facts (Who enters · Emails · From) now span the card (`me-facts is-3`), not 3 of 4 columns. Narrower than 1000px they wrap two to a row.
  - The summary ends at the sender (it used to add "Up to 500 emails a day across all your marketing email.").
  - The running-series notice "Today’s 500 are used up …" is removed.
  - "all within today’s limit" is removed from the resume toast, and "within today’s limit" in the start toast is now "shortly after they join".
  - "If an email waits for the daily limit, the next one waits for it." is removed from the Emails panel.
  - The series sender choice drops "· up to 500 a day ·".
- **PAIGE’s series approval card** (paige-ai-chat): "One approval covers everyone who enters this version, until you pause or stop it." The words "within the daily limit," are gone.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow trace in this record and in the pre-edit packet of commit 26fe2f10e — actor = the business owner or an admin seat (Solo/Sub-account) in Marketing › Email; goal = file and send a campaign or series to everyone they chose without being told of a limit that no longer exists; flows touched = read the dashboard, choose an audience in the editor, file and approve a series, read a running series, approve a series from PAIGE's card; every one keeps its RPCs, states and gold act (render tests in src/solo/marketing-email.render.test.tsx and src/solo/marketing-email-series.render.test.tsx)
PAIGE_UI_DESIGN: PASS: .claude/skills/impeccable craft floor applied as removal — no element, token or colour added; the one layout change is the review's own facts grid fitting three facts (`.me-facts.is-3`, three equal columns; two per row under the existing 1000px container query) so the card has no empty quarter (frames docs/evidence/ui-delivery/assets/exp03-no-email-send-allowance/exp03-no-allowance-series-pending-{light,dark}-1366x768.png and -900x1000.png, looked at); `npx --yes impeccable@4.1.0 detect` reports no findings on the five TS/TSX files and the same 162 advisories on src/solo/solo-campaigns.css before and after (design-system radius/font-size/colour across the whole file, none on the added rule)
MATERIAL_FLOW_CHANGE: YES: owners can now file and send a campaign or series to more than 500 people a day (migration 20271121140003), and the screens stop warning, holding or telling them to wait for tomorrow
FLOW_PROTOTYPE: WAIVED: owner-decision=owner billing ruling 2026-10-27 (no PAIGE-imposed sending stops); reason=copy removal of a retired limit, no layout change
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the business owner and admin seats running marketing email (Solo and Sub-account); primary actions unchanged (Review and send, Approve and send, Approve and start); purpose = the screen tells the truth about sending now that PAIGE imposes no daily allowance (docs/brain/decision-log.md, October28 entry)
VISUAL_DIRECTION: PASS: no visual change beyond removed text and the three-fact grid — same classes (mo-note me-cap for the footer count), same tokens, 0 colour literals added; `node scripts/gold-discipline-lint.mjs` on the five files passes; `npm run lint:shadow-vars` passes (2932 files)
AUTOMATED_EVIDENCE: PASS: 8 new or updated render/model tests fail on the old UI (8 of 60 in src/solo/marketing-email.render.test.tsx, src/solo/marketing-email-series.render.test.tsx, src/__tests__/marketing-email-series-model.test.ts) and pass after (60/60); the three-fact grid assertion fails on 2c16883cb's series view and passes on c50895108; SQL proof supabase/tests/exp03_email_send_allowance_removed.sql 36/36 on a fresh replay of all 1506 migrations (old production bodies: 20 of 36 fail; only the pre-fairness claim reinstated: the two fairness assertions fail, passes ash,ash,ash); round 3, fresh reset to 20271121110019 then the migration, proof now 37 assertions: this head 37/37; the claim key filtered to scheduled/sending 36/37 (only the finished-campaign case fails); the earlier sent_at-keyed body 35/37 (the two fairness assertions fail when Birch's first batch is deferred rather than sent); email and marketing suites 14 files / 296 tests pass; node --test scripts/ci/c0b-*.test.mjs 249/249 after the renewal (2 failed with the card edit before renewal); NODE_OPTIONS=--max-old-space-size=7000 npm run ci:tsc — no new type errors (baseline 10, current 6)
STATIC_EVIDENCE: PASS: grep of src/solo for daily_cap, remaining_today, over_daily, "a-day", "500 a day", "Daily limit", "used up", "within today" returns only one code comment in src/solo/marketing-email-model.ts; eslint on the changed files: no change from origin/main (UI files 0 errors; paige-ai-chat/index.ts 418 errors before and after, all pre-existing); C0b decomposition of all 29 dispatch aggregates: only enclosing identity[15] moved (scripts/ci/c0b-incumbent-resource-binding.mjs renewal note)
RENDERED_EVIDENCE: PASS: scripts/live-drive/exp03-no-email-allowance-drive.mjs renders the real GrowthHub through scripts/live-drive/harness/marketing-mount — dashboard, editor (draft), series waiting for approval, running and draft, light and dark at 1366x768, PAIGE closed, reduced motion: 10/10 frames render with no page error and no limit wording, the footer count shows, gold only on Approve and start (docs/evidence/ui-delivery/assets/exp03-no-email-send-allowance/exp03-no-allowance-*.png and exp03-no-allowance-frames.json); the same drive on the old UI fails all 10 on limit wording (before-exp03-no-allowance-*.png, before-exp03-no-allowance-frames.json)
BEHAVIORAL_EVIDENCE: PASS: scripts/live-drive/marketing-series-drive.mjs 1152/1152 checks, re-run after the grid fix (every series state, four Solo sizes, both themes, PAIGE docked and closed: renders, no overflow, AA on small text, gold only on the one approve act); scripts/live-drive/marketing-views-drive.mjs with DRIVE_TABS=email 442/472 on this branch and 442/472 on the old UI with the identical 30 failures (a stale "seven tabs" expectation and three campaign-desk checks, none on email copy)
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in drive of the deployed Marketing › Email in this session and nothing is deployed (no push); a signed-in Solo owner reading the dashboard count and filing past 500 is owed to a §32.c session after merge and the migration apply
KEYBOARD_FOCUS: NOT_APPLICABLE: no control added, removed or reordered — only text inside existing paragraphs, a fact row and toasts changed; the sender choice buttons keep their labels' first line and the existing roving-focus test passes (src/solo/marketing-email.render.test.tsx "the sender group is one tab stop")
ZOOM_REFLOW: PASS: removing text only shortens content; marketing-series-drive.mjs checks no horizontal overflow and nothing pushed past the right edge at 1536, 1366, 1024 and 900 wide (1152/1152); browser 200%/400% zoom not exercised
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed; frames rendered with prefers-reduced-motion: reduce (scripts/live-drive/exp03-no-email-allowance-drive.mjs)
STATE_COVERAGE: PASS: dashboard populated (count line), editor draft with audience counted (render test with 900 people and the old 400 figure), series waiting for approval, running with the old figure at zero, draft, paused, blocked, stopped and a change (marketing-series-drive.mjs); refusals keep their owner words (render test "a refusal from the database reads in the owner's words")
TRUTHFUL_STATE_LABELS: PASS: the footer states the real 24-hour count from used_last_24h (sent, or handed off and in flight, so it says "sent or sending"); no screen states a limit, a remainder or a wait for tomorrow that nothing enforces; the start toast says "shortly after they join" instead of a limit
SOLO_UI: YES: Marketing › Email (src/solo/marketing-email*.tsx) for every Solo and Sub-account business; no account-specific path
SOLO_1536X770_PAIGE_CLOSED: PASS: marketing-series-drive.mjs frames at 1536x770 PAIGE closed for every series state, checks pass; dashboard and editor at this size exercised by marketing-views-drive.mjs DRIVE_TABS=email with failures identical to the old UI (none on email copy)
SOLO_1536X770_PAIGE_OPEN: PASS: marketing-series-drive.mjs at 1536x770 PAIGE docked, checks pass (harness dock geometry); dashboard and editor via marketing-views-drive.mjs as above
SOLO_1366X768_PAIGE_CLOSED: PASS: exp03-no-allowance-*-{light,dark}-1366x768.png (10 frames, re-rendered from c50895108) plus marketing-series-drive.mjs at this size; checks pass
SOLO_1366X768_PAIGE_OPEN: PASS: marketing-series-drive.mjs at 1366x768 PAIGE docked, checks pass; dashboard and editor via marketing-views-drive.mjs as above
SOLO_1024X768_PAIGE_CLOSED: PASS: marketing-series-drive.mjs at 1024x768 PAIGE closed, checks pass (no screenshot kept at this size by that drive)
SOLO_1024X768_PAIGE_OPEN: PASS: marketing-series-drive.mjs at 1024x768 PAIGE docked, checks pass (harness dock geometry)
SOLO_900X1000_PAIGE_CLOSED: PASS: marketing-series-drive.mjs at 900x1000 PAIGE closed, checks pass; exp03-no-allowance-series-pending-{light,dark}-900x1000.png shows the three facts two to a row
SOLO_900X1000_PAIGE_OPEN: PASS: marketing-series-drive.mjs at 900x1000 PAIGE docked, checks pass (harness dock geometry)
UNVERIFIED: the authenticated app (no signed-in drive, nothing deployed); production apply of 20271121140003 and a real send past 500; the dashboard and editor were framed only at 1366x768 (other sizes covered by the views drive's checks, not by kept frames); PAIGE's series approval card was changed in source and C0b-proven, not rendered

OWNER_INTENT: owner ruling 2026-10-27 (billing) — target actor = the business owner sending marketing email; required outcome = no PAIGE-imposed sending stop, and nothing on screen that says otherwise
MUST_NOT_HAPPEN: a screen or card that says "up to 500 a day", "left today", "used up" or "send tomorrow"; a crash where a screen read daily_cap/remaining_today (the database still returns them; the screens no longer read them); any new control or layout element
MUST_PRESERVE: every RPC call and its arguments (render tests unchanged and passing); the one gold act per surface; the postal-address, sender, consent and member refusals in owner words; the series review card's who-enters, emails and from facts
ACCEPTANCE_CRITERIA: in Marketing › Email no text promises or counts down a daily limit; the dashboard shows the real 24-hour count; the editor, series view and PAIGE's series card file and approve exactly as before
PROTECTED_SEAMS: read_email_marketing_dashboard, email_audience_preview and read_email_sequence response shapes unchanged (§37; the screens simply stop reading daily_cap/remaining_today); paige-ai-chat dispatch pins (C0b) renewed with every branch, control, helper and import unchanged
<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: c50895108e39dcaa85c4a0dd278b7e9cce097a99; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271121140003 applied only to a fresh local replay, production apply and readback after merge); edge=PROOF_OWED(paige-ai-chat and email-campaign-worker deploy on merge through deploy-edge-functions.yml); evidence=docs/evidence/ui-delivery/assets/exp03-no-email-send-allowance/exp03-no-allowance-frames.json and scripts/live-drive/exp03-no-email-allowance-drive.mjs
RELEASE_CHANNEL: development: code on branch worktree-agent-a55b63b75992b79b7, not pushed; the frontend deploys to production on merge (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: copy removal on existing Marketing › Email screens, following the database change in the same branch
CUSTOMER_RELEASE_IDENTITY: none: no customer release is assigned; the platform is pre-launch and the owner decides a customer release and its note
RELEASE_NOTE_REQUIRED: YES: marketing email no longer has a 500-a-day limit — the owner decides whether and how to tell businesses, and whether to mention the provider's own ceiling on PAIGE's managed sender
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the screens are correct in source, tests and harness frames; live only after merge, the migration apply and the edge deploy, and a signed-in drive has not observed them
RELEASE_RECOVERY: position=forward-fix preferred — reverting the screen commits alone would bring back copy that promises a limit the database no longer enforces, so restoring the limit means a new migration that re-emits the prior bodies plus a revert of 26fe2f10e, 2c16883cb and c50895108 together; reference=branch worktree-agent-a55b63b75992b79b7 commits 26fe2f10e, 2c16883cb and c50895108; prior bodies' md5 recorded in supabase/migrations/20271121140003_exp03_no_email_send_allowance.sql

## Scope and collisions

- Classification: UI copy removal in five Marketing › Email files, one chat card string, a C0b pin renewal for that string, and one worker comment.
- **§58 call-out.** The 500-a-day sending limit (owner ruling 2026-10-04, "Paige's Resend, capped") was a shipped, owner-approved capability. It is removed by the owner's later ruling of 2026-10-27. These go with it: the editor's "today's limit" warning, the series "used up" notice and the Daily limit fact.
- Not changed: `src/solo/systems.tsx` line 39 shows a sample "Throttle the sending" fix with `daily_cap: 400`. It is static sample content about domain warm-up, not PAIGE's allowance. The lead-reply drafting limits in `src/solo/form-intake-model.ts` are also unchanged; they are classified in the decision log and left for the owner.

## Evidence index

- Drive: `scripts/live-drive/exp03-no-email-allowance-drive.mjs` (new; the existing marketing harness, port 5241).
- Frames, after: `docs/evidence/ui-delivery/assets/exp03-no-email-send-allowance/exp03-no-allowance-{dashboard,editor-draft,series-pending,series-running,series-draft}-{light,dark}-1366x768.png`, re-rendered from c50895108, and `exp03-no-allowance-series-pending-{light,dark}-900x1000.png` (from marketing-series-drive.mjs).
- Frames, before: the same names prefixed `before-`, rendered from the old UI files.
- Results: `exp03-no-allowance-frames.json` (after) and `before-exp03-no-allowance-frames.json`.
- Data: synthetic harness fixtures only (Northfield Advisory). No secrets or customer data.


## October29 sole-successor composition (current checkpoint)

The predecessor evidence above is retained as historical, not rerun proof. Owner supplied the final before/after pending-series images: the image without Daily limit is the intended preserved reference. No redesign or new control is introduced.

Original3037/74a4 remains preserved with failed Preview; successor current-main branch forwards exact SQL to20271126010014 through CLI2.109.1 generated carrier. Mainb696ea038 and production body hashes/ACL match the recorded starting bodies. Original Preview120003 remains untouched. New exact review/CI/Preview/release/readback are owed; full EXP03 remains STILL CODING. No authenticated/customer/provider acceptance, invoice correctness or billing maturity is inferred.

Pre-edit routing: owner outcome=uncapped governed Marketing email; domain=EXP03 Marketing, E08 presentation/peers retained; Harness=existing campaign human approval + durable worker/native records; Spine=email_campaigns.draft/request_approval and series equivalents; provider=existing SendGrid registry/actual readiness, no activation; authority=ordinary reversible draft/file, human-only campaign approval and unchanged consent/suppression/security; job=existing email-campaign-worker, no scheduler; receipt=existing campaign recipient/receipt/meter plus record_capability_run, acceptance !=delivery; surface=existing /solo/:account/growth/email, no truth-label promotion; live proof=actual ordinary owner/role/cohort/reload and authorized provider send still owed.

Current automated/static/rendered/behavioral/release results are appended only after execution. Original frames remain historical and explicitly synthetic. The successor pin-reproduction runner initially failed due to Node's default output buffer and then a Map-shape setup error; neither is product failure or passing proof.
